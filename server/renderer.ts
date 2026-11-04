import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright';
import type {
  AssertionResult,
  AssertionRule,
  BoundingBox,
  RunSummaryCounts,
  ScenarioRunResult,
  StressRun,
  StressScenario,
  TextSlot,
} from '../src/shared/types.js';
import {
  analyzeAndSanitizeComponent,
  applyValidatedSlotMutations,
} from './sanitizer.js';
import {
  computeComponentHash,
  computeCssHash,
  computePackHash,
} from './hashing.js';
import {
  aggregateStatus,
  buildBrowserInspectionExpression,
  buildIsolatedRenderDocumentWithFonts,
  collectInspectionTargetIds,
  evaluateSingleAssertion,
  type RawPageInspection,
} from './evaluator-core.js';

const require = createRequire(import.meta.url);

const requestedConcurrency = Number(process.env.BREAKIT_RENDER_CONCURRENCY || 3);
const MAX_CONCURRENT_CONTEXTS = Number.isFinite(requestedConcurrency)
  ? Math.max(1, Math.min(3, Math.floor(requestedConcurrency))) : 3;
const SCENARIO_RENDER_TIMEOUT_MS = 12000;
const MAX_SCENARIOS_PER_RUN = 16;

let sharedBrowserPromise: Promise<Browser> | null = null;
let cachedFontCss: string | null = null;

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }
}

const renderSemaphore = new Semaphore(MAX_CONCURRENT_CONTEXTS);

export function loadBundledFontFaceCss(): string {
  if (cachedFontCss !== null) {
    return cachedFontCss;
  }

  const rules: string[] = [];
  const tryEmbedFont = (pkgSubpath: string, family: string, weight: number) => {
    try {
      const resolved = require.resolve(pkgSubpath);
      const b64 = fs.readFileSync(resolved).toString('base64');
      rules.push(
        `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; font-display: block; src: url('data:font/woff2;base64,${b64}') format('woff2'); }`
      );
    } catch {
      // Fallback gracefully to system fonts if optional font file is absent
    }
  };

  for (const weight of [400, 500, 600, 700]) {
    tryEmbedFont(`@fontsource/inter/files/inter-latin-${weight}-normal.woff2`, 'Inter', weight);
    tryEmbedFont(`@fontsource/inter/files/inter-latin-ext-${weight}-normal.woff2`, 'Inter', weight);
  }
  for (const weight of [400, 600]) {
    tryEmbedFont(
      `@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${weight}-normal.woff2`,
      'JetBrains Mono',
      weight
    );
  }

  cachedFontCss = rules.join('\n');
  return cachedFontCss;
}

export async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium
      .launch({
        headless: true,
        args: [
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--no-first-run',
          '--hide-scrollbars',
        ],
      })
      .catch((err) => {
        sharedBrowserPromise = null;
        throw err;
      });
  }
  return sharedBrowserPromise;
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowserPromise) {
    const b = await sharedBrowserPromise.catch(() => null);
    sharedBrowserPromise = null;
    if (b) {
      await b.close().catch(() => undefined);
    }
  }
}

export function buildIsolatedRenderDocument(
  mutatedHtml: string,
  sanitizedCss: string
): string {
  return buildIsolatedRenderDocumentWithFonts(
    mutatedHtml,
    sanitizedCss,
    loadBundledFontFaceCss()
  );
}

export interface ExecuteStressRunInput {
  runId: string;
  role: 'original' | 'candidate';
  componentName: string;
  html: string;
  css: string;
  slots?: TextSlot[];
  assertions: AssertionRule[];
  scenarios: StressScenario[];
  artifactsDir: string;
  candidateId?: string;
  /** Internal test hook to simulate render timeout/fault handling cleanly */
  simulateTimeoutMs?: number;
}

export async function executeStressRun(
  input: ExecuteStressRunInput
): Promise<StressRun> {
  if (input.scenarios.length === 0) {
    throw new Error('At least one scenario is required to execute a stress run.');
  }
  if (input.scenarios.length > MAX_SCENARIOS_PER_RUN) {
    throw new Error(`Maximum ${MAX_SCENARIOS_PER_RUN} scenarios allowed per run.`);
  }

  const startedAtDate = new Date();
  const analysis = analyzeAndSanitizeComponent(input.html, input.css);

  const reviewedSlotMap = new Map((input.slots || []).map((s) => [s.id, s]));
  const effectiveSlots: TextSlot[] = analysis.slots.map((s) => {
    const reviewed = reviewedSlotMap.get(s.id);
    return reviewed ? { ...s, required: reviewed.required, label: reviewed.label || s.label } : s;
  });
  const slotMap = new Map(effectiveSlots.map((s) => [s.id, s]));

  const enabledAssertions = input.assertions.filter((a) => a.enabled);
  if (enabledAssertions.length === 0) {
    throw new Error('At least one assertion rule must be enabled.');
  }

  const runArtifactsDir = path.join(input.artifactsDir, 'runs', input.runId);
  fs.mkdirSync(runArtifactsDir, { recursive: true });

  const browser = await getSharedBrowser();
  const browserVersion = `Chromium ${browser.version()}`;

  const targetIdList = collectInspectionTargetIds(
    analysis.rootTargetId,
    effectiveSlots,
    enabledAssertions,
    analysis.interactiveTargets.map((t) => t.id)
  );
  const browserInspectionExpr = buildBrowserInspectionExpression(
    targetIdList,
    analysis.rootTargetId
  );

  const runSingleScenario = async (
    scenario: StressScenario
  ): Promise<ScenarioRunResult> => {
    const scStart = Date.now();
    await renderSemaphore.acquire();

    const blockedRequests: string[] = [];
    const vpWidth = Math.min(1600, Math.max(240, Math.round(scenario.viewport.width)));
    const vpHeight = Math.min(1600, Math.max(320, Math.round(scenario.viewport.height)));

    let context: Awaited<ReturnType<Browser['newContext']>> | null = null;
    try {
      const { mutatedHtml, appliedMutations, expectedSlotTexts } =
        applyValidatedSlotMutations(
          analysis.instrumentedHtml,
          effectiveSlots,
          scenario.mutations
        );

      const renderDoc = buildIsolatedRenderDocument(
        mutatedHtml,
        analysis.sanitizedCss
      );

      context = await browser.newContext({
        viewport: { width: vpWidth, height: vpHeight },
        deviceScaleFactor: 2,
        javaScriptEnabled: false,
        acceptDownloads: false,
        serviceWorkers: 'block',
        locale: 'es-MX',
        timezoneId: 'America/Mexico_City',
        reducedMotion: 'reduce',
        colorScheme: 'light',
      });

      await context.route('**/*', async (route) => {
        const reqUrl = route.request().url();
        if (
          reqUrl === 'about:blank' ||
          reqUrl.startsWith('data:image/') ||
          reqUrl.startsWith('data:font/')
        ) {
          await route.continue();
          return;
        }
        blockedRequests.push(reqUrl);
        await route.abort('blockedbyclient');
      });

      const page = await context.newPage();
      page.setDefaultTimeout(SCENARIO_RENDER_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(SCENARIO_RENDER_TIMEOUT_MS);

      page.on('popup', (popup) => {
        popup.close().catch(() => undefined);
      });
      page.on('dialog', (dialog) => {
        dialog.dismiss().catch(() => undefined);
      });

      if (input.simulateTimeoutMs && input.simulateTimeoutMs > 0) {
        await new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Render timed out after ${input.simulateTimeoutMs}ms`)),
            input.simulateTimeoutMs
          )
        );
      }

      await page.setContent(renderDoc, {
        waitUntil: 'load',
        timeout: SCENARIO_RENDER_TIMEOUT_MS,
      });

      await page.evaluate(
        `document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true`
      );

      const inspection = (await page.evaluate(
        browserInspectionExpr
      )) as RawPageInspection;

      const safeScenarioFile = `${scenario.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
      const absScreenshotPath = path.join(runArtifactsDir, safeScenarioFile);
      await page.screenshot({
        path: absScreenshotPath,
        fullPage: true,
        animations: 'disabled',
      });

      const assertionResults: AssertionResult[] = enabledAssertions.map((rule) => {
        try {
          return evaluateSingleAssertion(
            rule,
            inspection,
            analysis.rootTargetId,
            expectedSlotTexts,
            slotMap
          );
        } catch (err) {
          return {
            assertionId: rule.id,
            assertionLabel: rule.label,
            assertionType: rule.type,
            targetId: rule.targetId,
            status: 'error',
            summary: `Assertion evaluation error: ${err instanceof Error ? err.message : String(err)}`,
            measurements: {},
            highlightBoxes: [],
          };
        }
      });

      const elementBoxes: Record<string, BoundingBox> = {};
      for (const [id, info] of Object.entries(inspection.elements)) {
        if (info.rect) {
          elementBoxes[id] = info.rect;
        }
      }

      const overallStatus = aggregateStatus(assertionResults.map((a) => a.status));

      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        category: scenario.category,
        status: overallStatus,
        durationMs: Date.now() - scStart,
        screenshotUrl: `/artifacts/runs/${input.runId}/${safeScenarioFile}`,
        screenshotPath: `artifacts/runs/${input.runId}/${safeScenarioFile}`,
        viewport: { width: vpWidth, height: vpHeight, label: scenario.viewport.label },
        appliedMutations,
        documentMetrics: {
          scrollWidth: inspection.scrollWidth,
          scrollHeight: inspection.scrollHeight,
          viewportWidth: inspection.viewportWidth,
          viewportHeight: inspection.viewportHeight,
        },
        elementBoxes,
        assertions: assertionResults,
        blockedRequests: [
          ...analysis.sanitization.strippedExternalUrls,
          ...blockedRequests,
        ],
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorAssertions: AssertionResult[] = enabledAssertions.map((rule) => ({
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId: rule.targetId,
        status: 'error',
        summary: `Scenario render error prevented evaluation: ${errorMsg}`,
        measurements: {},
        highlightBoxes: [],
      }));

      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        category: scenario.category,
        status: 'error',
        durationMs: Date.now() - scStart,
        screenshotUrl: null,
        screenshotPath: null,
        viewport: { width: vpWidth, height: vpHeight, label: scenario.viewport.label },
        appliedMutations: [],
        documentMetrics: null,
        elementBoxes: {},
        assertions: errorAssertions,
        blockedRequests: [
          ...analysis.sanitization.strippedExternalUrls,
          ...blockedRequests,
        ],
        renderError: errorMsg,
      };
    } finally {
      if (context) {
        await context.close().catch(() => undefined);
      }
      renderSemaphore.release();
    }
  };

  const results = await Promise.all(input.scenarios.map((sc) => runSingleScenario(sc)));

  const summary: RunSummaryCounts = {
    totalScenarios: results.length,
    passedScenarios: results.filter((r) => r.status === 'pass').length,
    failedScenarios: results.filter((r) => r.status === 'fail').length,
    inconclusiveScenarios: results.filter((r) => r.status === 'inconclusive').length,
    errorScenarios: results.filter((r) => r.status === 'error').length,
    totalAssertions: 0,
    passedAssertions: 0,
    failedAssertions: 0,
    inconclusiveAssertions: 0,
    errorAssertions: 0,
  };

  for (const r of results) {
    for (const a of r.assertions) {
      summary.totalAssertions += 1;
      if (a.status === 'pass') summary.passedAssertions += 1;
      else if (a.status === 'fail') summary.failedAssertions += 1;
      else if (a.status === 'inconclusive') summary.inconclusiveAssertions += 1;
      else summary.errorAssertions += 1;
    }
  }

  const completedAtDate = new Date();
  const runRecord: StressRun = {
    runId: input.runId,
    role: input.role,
    componentName: input.componentName,
    componentHash: computeComponentHash(analysis.instrumentedHtml, effectiveSlots),
    packHash: computePackHash(input.scenarios, enabledAssertions),
    cssHash: computeCssHash(analysis.sanitizedCss),
    browserVersion,
    startedAt: startedAtDate.toISOString(),
    completedAt: completedAtDate.toISOString(),
    durationMs: completedAtDate.getTime() - startedAtDate.getTime(),
    html: input.html,
    instrumentedHtml: analysis.instrumentedHtml,
    css: analysis.sanitizedCss,
    rootTargetId: analysis.rootTargetId,
    slots: effectiveSlots,
    assertions: enabledAssertions,
    scenarios: input.scenarios,
    sanitization: analysis.sanitization,
    summary,
    results,
    candidateId: input.candidateId,
  };

  fs.writeFileSync(
    path.join(runArtifactsDir, 'run.json'),
    JSON.stringify(runRecord, null, 2),
    'utf8'
  );

  return runRecord;
}
