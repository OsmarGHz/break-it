import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type {
  AssertionRule,
  CandidatePatch,
  ModelReceipt,
  ScenarioCategory,
  StressRun,
  StressScenario,
  TextSlot,
} from '../src/shared/types.js';
import { getServerConfig, redactSecrets } from './config.js';
import { computeUnifiedCssDiff } from './comparison.js';
import { computeCssHash } from './hashing.js';
import { MAX_CSS_BYTES, MAX_MUTATION_LENGTH, sanitizeCssInput } from './sanitizer.js';

export class SparkApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSING_API_KEY'
      | 'UPSTREAM_HTTP_ERROR'
      | 'SPARK_VALIDATION_ERROR'
      | 'SPARK_NETWORK_ERROR',
    public readonly statusCode: number = 502
  ) {
    super(message);
    this.name = 'SparkApiError';
  }
}

const VALID_CATEGORIES = new Set<ScenarioCategory>([
  'baseline',
  'long_name',
  'unbroken_token',
  'multilingual',
  'narrow_viewport',
  'combined_stress',
]);

const RawSparkScenarioPackSchema = z.object({
  scenarios: z
    .array(
      z.object({
        id: z.string().min(2).max(80),
        name: z.string().min(3).max(120),
        category: z.enum([
          'long_name',
          'unbroken_token',
          'multilingual',
          'narrow_viewport',
          'combined_stress',
        ]),
        viewportWidth: z.number().int().min(280).max(1440),
        viewportHeight: z.number().int().min(360).max(1200),
        mutations: z
          .array(
            z.object({
              slotId: z.string().min(1).max(64),
              value: z.string().min(1).max(400),
            })
          )
          .min(1)
          .max(12),
        rationale: z.string().min(8).max(400),
      })
    )
    .min(6)
    .max(12),
});

const RawSparkCssPatchSchema = z.object({
  patchedCss: z.string().min(20).max(MAX_CSS_BYTES),
  rationale: z.string().min(15).max(1500),
  targetedFailures: z.array(z.string().min(3).max(240)).min(1).max(16),
});

/**
 * Validates and bounds raw JSON content returned by Muse Spark for scenario generation.
 * Rejects unknown slotIds, empty values, executable payloads, or out-of-range counts.
 */
export function validateSparkScenarioOutput(
  rawContent: string,
  validSlots: TextSlot[]
): StressScenario[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new SparkApiError(
      'Muse Spark returned malformed JSON for scenario generation.',
      'SPARK_VALIDATION_ERROR',
      502
    );
  }

  const result = RawSparkScenarioPackSchema.safeParse(parsed);
  if (!result.success) {
    throw new SparkApiError(
      `Muse Spark scenario output failed schema validation: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      'SPARK_VALIDATION_ERROR',
      502
    );
  }

  const slotIds = new Set(validSlots.map((s) => s.id));
  const usedScenarioIds = new Set<string>(['baseline-ideal']);
  const validated: StressScenario[] = [
    {
      id: 'baseline-ideal',
      name: 'Baseline — Original Sample Copy',
      category: 'baseline',
      viewport: { width: 460, height: 540, label: 'Baseline (460×540)' },
      mutations: [],
      rationale: 'Unmodified baseline control case rendered prior to adversarial mutations.',
      source: 'baseline',
    },
  ];

  for (const rawSc of result.data.scenarios) {
    let baseId = rawSc.id
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    if (!baseId) baseId = 'spark-case';
    let finalId = baseId;
    let suffix = 2;
    while (usedScenarioIds.has(finalId)) {
      finalId = `${baseId}-${suffix++}`;
    }
    usedScenarioIds.add(finalId);

    const cleanMutations = rawSc.mutations.map((m) => {
      if (!slotIds.has(m.slotId)) {
        throw new SparkApiError(
          `Muse Spark referenced unknown slotId "${m.slotId}". Allowed slots: ${Array.from(slotIds).join(', ')}`,
          'SPARK_VALIDATION_ERROR',
          502
        );
      }
      const cleanVal = m.value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, MAX_MUTATION_LENGTH);
      if (!cleanVal) {
        throw new SparkApiError(
          `Muse Spark proposed empty text for slot "${m.slotId}".`,
          'SPARK_VALIDATION_ERROR',
          502
        );
      }
      return { slotId: m.slotId, value: cleanVal };
    });

    const cat: ScenarioCategory = VALID_CATEGORIES.has(rawSc.category)
      ? rawSc.category
      : 'combined_stress';

    validated.push({
      id: finalId,
      name: rawSc.name.trim().slice(0, 100),
      category: cat,
      viewport: {
        width: Math.min(1440, Math.max(280, rawSc.viewportWidth)),
        height: Math.min(1200, Math.max(360, rawSc.viewportHeight)),
        label: `${rawSc.viewportWidth}×${rawSc.viewportHeight}`,
      },
      mutations: cleanMutations,
      rationale: rawSc.rationale.trim().slice(0, 320),
      source: 'muse_spark',
    });
  }

  return validated;
}

/**
 * Validates and sanitizes raw JSON content returned by Muse Spark for CSS candidate patch.
 */
export function validateSparkCssPatchOutput(
  rawContent: string,
  originalCss: string
): { patchedCss: string; rationale: string; targetedFailures: string[]; unifiedDiff: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new SparkApiError(
      'Muse Spark returned malformed JSON for CSS patch proposal.',
      'SPARK_VALIDATION_ERROR',
      502
    );
  }

  const result = RawSparkCssPatchSchema.safeParse(parsed);
  if (!result.success) {
    throw new SparkApiError(
      `Muse Spark CSS patch failed schema validation: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      'SPARK_VALIDATION_ERROR',
      502
    );
  }

  // Reject HTML tags accidentally returned inside CSS
  if (/<\/?(?:style|script|div|html|body)\b/i.test(result.data.patchedCss)) {
    throw new SparkApiError(
      'Muse Spark returned HTML markup inside patchedCss; only pure CSS rules are accepted.',
      'SPARK_VALIDATION_ERROR',
      502
    );
  }

  const report = {
    strippedTags: [],
    strippedAttributes: [],
    strippedExternalUrls: [],
    strippedCssConstructs: [],
    warnings: [],
  };
  const cleanCss = sanitizeCssInput(result.data.patchedCss, report).trim();

  if (!cleanCss.includes('{') || !cleanCss.includes('}')) {
    throw new SparkApiError(
      'Muse Spark patchedCss did not contain valid CSS rule blocks.',
      'SPARK_VALIDATION_ERROR',
      502
    );
  }

  const unifiedDiff = computeUnifiedCssDiff(originalCss, cleanCss);

  return {
    patchedCss: cleanCss,
    rationale: result.data.rationale.trim(),
    targetedFailures: result.data.targetedFailures.map((t) => t.trim()),
    unifiedDiff,
  };
}

interface MetaChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    finish_reason?: string;
    message?: {
      role?: string;
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

async function callMetaChatCompletions(params: {
  operation: 'generate_scenarios' | 'propose_css_patch';
  reasoningEffort: 'low' | 'medium' | 'high';
  messages: Array<Record<string, unknown>>;
  responseFormat: Record<string, unknown>;
  imagesAttached: number;
  customRoot?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ content: string; receipt: ModelReceipt }> {
  const cfg = getServerConfig(params.customRoot);
  if (!cfg.modelApiKey) {
    throw new SparkApiError(
      'MODEL_API_KEY is missing. Add MODEL_API_KEY to .env.local (server-side only) to invoke Muse Spark 1.3.',
      'MISSING_API_KEY',
      503
    );
  }

  const endpoint = `${cfg.metaBaseUrl}/chat/completions`;
  const started = Date.now();
  const doFetch = params.fetchImpl || fetch;

  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.modelApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.metaSparkModel,
        reasoning_effort: params.reasoningEffort,
        max_tokens: 12288,
        messages: params.messages,
        response_format: params.responseFormat,
      }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (err) {
    const safeMsg = redactSecrets(
      err instanceof Error ? err.message : String(err),
      params.customRoot
    );
    throw new SparkApiError(
      `Network error calling Meta Model API (${endpoint}): ${safeMsg}`,
      'SPARK_NETWORK_ERROR',
      502
    );
  }

  const rawBody = await res.text();
  if (!res.ok) {
    const safeBody = redactSecrets(rawBody.slice(0, 500), params.customRoot);
    throw new SparkApiError(
      `Meta Model API HTTP ${res.status}: ${safeBody}`,
      'UPSTREAM_HTTP_ERROR',
      res.status >= 400 && res.status < 500 ? 502 : 502
    );
  }

  let data: MetaChatCompletionResponse;
  try {
    data = JSON.parse(rawBody) as MetaChatCompletionResponse;
  } catch {
    throw new SparkApiError(
      'Meta Model API returned a non-JSON HTTP response.',
      'SPARK_VALIDATION_ERROR',
      502
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new SparkApiError(
      `Meta Model API returned empty message content (finish_reason: ${data.choices?.[0]?.finish_reason || 'unknown'}).`,
      'SPARK_VALIDATION_ERROR',
      502
    );
  }

  const receipt: ModelReceipt = {
    receiptId: `rcpt_${crypto.randomUUID().slice(0, 12)}`,
    operation: params.operation,
    provider: 'meta_model_api',
    endpoint,
    requestedModel: cfg.metaSparkModel,
    respondedModel: data.model || cfg.metaSparkModel,
    responseId: data.id || 'unreported',
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    reasoningEffort: params.reasoningEffort,
    imagesAttached: params.imagesAttached,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
    finishReason: data.choices?.[0]?.finish_reason,
  };

  return { content, receipt };
}

export async function generateScenariosWithSpark(params: {
  instrumentedHtml: string;
  css: string;
  slots: TextSlot[];
  assertions: AssertionRule[];
  customRoot?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ scenarios: StressScenario[]; receipt: ModelReceipt }> {
  const scenarioSchema = {
    type: 'json_schema',
    json_schema: {
      name: 'AdversarialScenarioPack',
      schema: {
        type: 'object',
        properties: {
          scenarios: {
            type: 'array',
            description: '8 realistic adversarial UI content and viewport stress cases.',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Kebab-case identifier such as es-compound-name or narrow-320-cta',
                },
                name: {
                  type: 'string',
                  description: 'Concise human-readable title of the stress scenario',
                },
                category: {
                  type: 'string',
                  enum: [
                    'long_name',
                    'unbroken_token',
                    'multilingual',
                    'narrow_viewport',
                    'combined_stress',
                  ],
                },
                viewportWidth: {
                  type: 'integer',
                  description: 'Viewport width in CSS pixels between 320 and 600',
                },
                viewportHeight: {
                  type: 'integer',
                  description: 'Viewport height in CSS pixels between 460 and 720',
                },
                mutations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      slotId: {
                        type: 'string',
                        description: 'Exact slotId from the provided component slots list',
                      },
                      value: {
                        type: 'string',
                        description: 'Plain text replacement (1 to 220 characters, no HTML)',
                      },
                    },
                    required: ['slotId', 'value'],
                    additionalProperties: false,
                  },
                },
                rationale: {
                  type: 'string',
                  description: 'Specific geometric or CSS layout weakness this case probes',
                },
              },
              required: [
                'id',
                'name',
                'category',
                'viewportWidth',
                'viewportHeight',
                'mutations',
                'rationale',
              ],
              additionalProperties: false,
            },
          },
        },
        required: ['scenarios'],
        additionalProperties: false,
      },
    },
  };

  const slotSummary = params.slots.map((s) => ({
    slotId: s.id,
    role: s.role,
    tagName: s.tagName,
    required: s.required,
    originalText: s.originalText,
  }));

  const assertionSummary = params.assertions
    .filter((a) => a.enabled)
    .map((a) => ({
      id: a.id,
      type: a.type,
      targetId: a.targetId,
      tolerancePx: a.tolerancePx,
    }));

  const systemPrompt =
    'You are an adversarial frontend layout QA engineer. Inspect the provided static HTML/CSS component and its declared text slots. Propose 8 realistic, high-signal adversarial stress scenarios that expose real CSS layout bugs (missing min-width: 0 in flex/grid children, white-space: nowrap overflow, fixed-height vertical clipping, unbroken reference tokens/IDs, localized Spanish/English text expansion, and 320px-360px narrow mobile viewports). Use ONLY exact slotId values from the provided slot list. Never output HTML tags or executable code inside slot values.';

  const userPrompt = JSON.stringify(
    {
      task: 'Generate 8 diverse adversarial content + viewport stress scenarios (6 to 10 allowed). Include realistic Spanish and English strings, compound Latin American names, unbroken payment/reference tokens, multi-line disclosures, narrow 320px mobile viewports, and at least one combined worst-case scenario.',
      componentHtml: params.instrumentedHtml,
      componentCss: params.css,
      availableSlots: slotSummary,
      activeAssertions: assertionSummary,
    },
    null,
    2
  );

  const { content, receipt } = await callMetaChatCompletions({
    operation: 'generate_scenarios',
    reasoningEffort: 'medium',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    responseFormat: scenarioSchema,
    imagesAttached: 0,
    customRoot: params.customRoot,
    fetchImpl: params.fetchImpl,
  });

  const scenarios = validateSparkScenarioOutput(content, params.slots);
  return { scenarios, receipt };
}

export async function proposeCssPatchWithSpark(params: {
  failedRun: StressRun;
  artifactsDir: string;
  customRoot?: string;
  fetchImpl?: typeof fetch;
}): Promise<CandidatePatch> {
  const failingScenarios = params.failedRun.results.filter(
    (r) => r.status === 'fail' || r.status === 'error'
  );
  if (failingScenarios.length === 0) {
    throw new SparkApiError(
      'The selected run has no failing scenarios to repair.',
      'SPARK_VALIDATION_ERROR',
      400
    );
  }

  const failureDigest = failingScenarios.map((sc) => ({
    scenarioId: sc.scenarioId,
    scenarioName: sc.scenarioName,
    viewport: sc.viewport,
    mutations: sc.appliedMutations,
    documentMetrics: sc.documentMetrics,
    failedAssertions: sc.assertions
      .filter((a) => a.status !== 'pass')
      .map((a) => ({
        assertionId: a.assertionId,
        type: a.assertionType,
        targetId: a.targetId,
        summary: a.summary,
        measurements: a.measurements,
      })),
  }));

  // Attach up to 3 real PNG failure screenshots from disk as base64 data URLs inside the user message
  const imageBlocks: Array<Record<string, unknown>> = [];
  for (const sc of failingScenarios.slice(0, 3)) {
    if (!sc.screenshotPath) continue;
    const relFromArtifacts = sc.screenshotPath.replace(/^artifacts[\\/]/, '');
    const absPath = path.join(params.artifactsDir, relFromArtifacts);
    if (fs.existsSync(absPath)) {
      const stat = fs.statSync(absPath);
      if (stat.size > 0 && stat.size < 2 * 1024 * 1024) {
        const b64 = fs.readFileSync(absPath).toString('base64');
        imageBlocks.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${b64}`,
          },
        });
      }
    }
  }

  const patchSchema = {
    type: 'json_schema',
    json_schema: {
      name: 'CssPatchCandidate',
      schema: {
        type: 'object',
        properties: {
          patchedCss: {
            type: 'string',
            description: 'Complete replacement stylesheet (pure CSS only) that fixes the measured layout failures while preserving visual hierarchy and baseline aesthetics.',
          },
          rationale: {
            type: 'string',
            description: 'Clear engineering explanation of the root CSS causes and exact layout changes made.',
          },
          targetedFailures: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of specific failure modes addressed by this CSS candidate.',
          },
        },
        required: ['patchedCss', 'rationale', 'targetedFailures'],
        additionalProperties: false,
      },
    },
  };

  const systemPrompt = `You are a staff CSS layout engineer repairing measured browser layout failures.
Return a complete, clean CSS stylesheet in patchedCss (do NOT modify HTML).
CRITICAL ANTI-EVASION RULES (enforced by automated Chromium verification):
1. NEVER hide, remove, or collapse any element (no display: none, visibility: hidden, opacity: 0, font-size < 9px, or transparent colors).
2. NEVER rely on overflow: hidden or text-overflow: ellipsis to silently clip required text slots unless an explicit ellipsis exception is listed as true.
3. Preserve visual design polish on baseline desktop viewports while allowing flex/grid children to shrink (min-width: 0), wrapping long names and unbroken tokens (overflow-wrap: anywhere; word-break: break-word; white-space: normal), replacing rigid fixed heights with min-height + height: auto, and letting action bars wrap cleanly on narrow 320px viewports so CTAs remain 100% inside the card container and separated from sibling buttons.`;

  const textPayload = JSON.stringify(
    {
      task: 'Produce a complete CSS replacement that resolves all measured Chromium layout failures and passes exact replay of the scenario pack.',
      componentHtml: params.failedRun.instrumentedHtml,
      originalCss: params.failedRun.css,
      activeAssertions: params.failedRun.assertions,
      failingScenariosAndMeasurements: failureDigest,
    },
    null,
    2
  );

  const userContent: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: `Analyze the component HTML, original CSS, exact Chromium failure measurements, and attached failure captures, then return the repaired stylesheet JSON:\n\n${textPayload}`,
    },
    ...imageBlocks,
  ];

  const { content, receipt } = await callMetaChatCompletions({
    operation: 'propose_css_patch',
    reasoningEffort: 'high',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    responseFormat: patchSchema,
    imagesAttached: imageBlocks.length,
    customRoot: params.customRoot,
    fetchImpl: params.fetchImpl,
  });

  const validated = validateSparkCssPatchOutput(content, params.failedRun.css);
  const sparkCssHash = computeCssHash(validated.patchedCss);

  return {
    candidateId: `cand_${crypto.randomUUID().slice(0, 10)}`,
    basedOnRunId: params.failedRun.runId,
    originalCssHash: params.failedRun.cssHash,
    candidateCssHash: sparkCssHash,
    patchedCss: validated.patchedCss,
    unifiedDiff: validated.unifiedDiff,
    rationale: validated.rationale,
    targetedFailures: validated.targetedFailures,
    source: 'muse_spark',
    createdAt: new Date().toISOString(),
    sparkGeneratedCss: validated.patchedCss,
    sparkGeneratedCssHash: sparkCssHash,
    receipt,
  };
}

