import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type {
  CandidatePatch,
  ModelReceipt,
  RunComparison,
  StressRun,
} from '../src/shared/types.js';
import { loadBundledFontFaceCss } from './renderer.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ExportBundleInput {
  originalRun: StressRun;
  candidate?: CandidatePatch | null;
  candidateRun?: StressRun | null;
  comparison?: RunComparison | null;
  receipts: ModelReceipt[];
  artifactsDir: string;
}

let cachedCompiledEvaluatorCore: string | null = null;

/**
 * Compiles server/evaluator-core.ts directly into standalone ES2022 JavaScript
 * so the exported repro runner executes the exact same inspection and assertion
 * engine as the application server — zero duplicated rule logic.
 */
function getCompiledEvaluatorCoreMjs(): string {
  if (cachedCompiledEvaluatorCore) {
    return cachedCompiledEvaluatorCore;
  }
  const esbuild = require('esbuild') as {
    transformSync: (
      input: string,
      options: Record<string, unknown>
    ) => { code: string };
  };
  const evaluatorTsPath = path.join(__dirname, 'evaluator-core.ts');
  const sourceTs = fs.readFileSync(evaluatorTsPath, 'utf8');
  const { code } = esbuild.transformSync(sourceTs, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
    keepNames: false,
  });
  cachedCompiledEvaluatorCore = code;
  return code;
}

function buildRunnableReproScript(): string {
  return `#!/usr/bin/env node
/**
 * BREAK IT — Full-Parity Chromium Reproduction Runner.
 * Uses the exact compiled evaluator-core.mjs + bundled WOFF2 fonts + isolated
 * Chromium context settings as the application server.
 *
 * Unknown, inconclusive, or errored assertions are NEVER treated as passes;
 * any non-passing scenario exits with code 1.
 *
 * Usage:
 *   node repro/reproduce.mjs --target original
 *   node repro/reproduce.mjs --target candidate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  aggregateStatus,
  buildBrowserInspectionExpression,
  buildIsolatedRenderDocumentWithFonts,
  collectInspectionTargetIds,
  evaluateSingleAssertion,
} from './evaluator-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundleRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const targetIdx = args.indexOf('--target');
const target = targetIdx >= 0 && args[targetIdx + 1] ? args[targetIdx + 1] : 'candidate';

const instrumentedHtml = fs.readFileSync(path.join(bundleRoot, 'component', 'instrumented.html'), 'utf8');
const cssFile = target === 'original' ? 'original.css' : 'candidate.css';
const cssPath = path.join(bundleRoot, 'component', cssFile);

if (!fs.existsSync(cssPath)) {
  console.error(\`Requested stylesheet component/\${cssFile} does not exist in this bundle. Try --target original.\`);
  process.exit(2);
}

const css = fs.readFileSync(cssPath, 'utf8');
const fontFaceCss = fs.existsSync(path.join(__dirname, 'fonts.css'))
  ? fs.readFileSync(path.join(__dirname, 'fonts.css'), 'utf8')
  : '';
const scenarios = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'pack', 'scenarios.json'), 'utf8'));
const assertions = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'pack', 'assertions.json'), 'utf8'));
const slots = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'pack', 'slots.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'manifest.json'), 'utf8'));
const rootTargetId = manifest.rootTargetId || 'card-root';

const enabledAssertions = assertions.filter((a) => a.enabled);
if (enabledAssertions.length === 0) {
  console.error('No enabled assertions in pack/assertions.json — refusing to report pass.');
  process.exit(1);
}

const slotMap = new Map(slots.map((s) => [s.id, s]));
const targetIds = collectInspectionTargetIds(rootTargetId, slots, enabledAssertions);
const browserInspectionExpr = buildBrowserInspectionExpression(targetIds, rootTargetId);

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--no-first-run',
    '--hide-scrollbars',
  ],
});

let passedCount = 0;
let nonPassingCount = 0;

console.log(\`\\n=== BREAK IT Full-Parity Repro Runner (target: \${target}, browser: Chromium \${browser.version()}) ===\`);

try {
  for (const sc of scenarios) {
    const vpWidth = Math.min(1600, Math.max(240, Math.round(sc.viewport.width)));
    const vpHeight = Math.min(1600, Math.max(320, Math.round(sc.viewport.height)));

    const expectedSlotTexts = {};
    for (const s of slots) {
      expectedSlotTexts[s.id] = s.originalText;
    }

    const context = await browser.newContext({
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

    await context.route('**/*', (route) => {
      const u = route.request().url();
      if (u === 'about:blank' || u.startsWith('data:image/') || u.startsWith('data:font/')) {
        return route.continue();
      }
      return route.abort('blockedbyclient');
    });

    try {
      const page = await context.newPage();
      const baseDoc = buildIsolatedRenderDocumentWithFonts(instrumentedHtml, css, fontFaceCss);
      await page.setContent(baseDoc, { waitUntil: 'load', timeout: 12000 });

      // Apply validated textContent-only mutations identically to server/sanitizer.ts
      const cleanMutations = [];
      for (const mut of sc.mutations || []) {
        if (!slotMap.has(mut.slotId)) {
          throw new Error(\`Invalid mutation target slotId "\${mut.slotId}"\`);
        }
        const cleanVal = String(mut.value ?? '')
          .replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, '')
          .slice(0, 280);
        if (!cleanVal.trim()) {
          throw new Error(\`Mutation for slot "\${mut.slotId}" cannot empty out required text.\`);
        }
        expectedSlotTexts[mut.slotId] = cleanVal.replace(/\\s+/g, ' ').trim();
        cleanMutations.push({ slotId: mut.slotId, value: cleanVal });
      }

      if (cleanMutations.length > 0) {
        const mutPayload = JSON.stringify(cleanMutations);
        await page.evaluate(\`(() => {
          const list = \${mutPayload};
          for (const m of list) {
            const el = document.querySelector('[data-breakit-id="' + m.slotId + '"]');
            if (!el) throw new Error('Target element [data-breakit-id="' + m.slotId + '"] not found');
            el.textContent = m.value;
          }
          return document.body ? document.body.offsetHeight : 0;
        })()\`);
      }

      await page.evaluate('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true');
      const inspection = await page.evaluate(browserInspectionExpr);

      const results = enabledAssertions.map((rule) => {
        try {
          return evaluateSingleAssertion(rule, inspection, rootTargetId, expectedSlotTexts, slotMap);
        } catch (err) {
          return {
            assertionId: rule.id,
            assertionLabel: rule.label,
            assertionType: rule.type,
            status: 'error',
            summary: \`Assertion evaluation error: \${err instanceof Error ? err.message : String(err)}\`,
          };
        }
      });

      const overallStatus = aggregateStatus(results.map((r) => r.status));
      if (overallStatus === 'pass') {
        passedCount += 1;
        console.log(\`  PASS  \${sc.id} (\${vpWidth}x\${vpHeight})\`);
      } else {
        nonPassingCount += 1;
        const nonPassDetails = results
          .filter((r) => r.status !== 'pass')
          .map((r) => \`[\${r.status.toUpperCase()} \${r.assertionId}] \${r.summary}\`)
          .join(' | ');
        console.log(\`  \${overallStatus.toUpperCase()}  \${sc.id} (\${vpWidth}x\${vpHeight}): \${nonPassDetails}\`);
      }
    } catch (err) {
      nonPassingCount += 1;
      console.log(\`  ERROR \${sc.id} (\${vpWidth}x\${vpHeight}): \${err instanceof Error ? err.message : String(err)}\`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(\`\\nSummary (\${target}): \${passedCount}/\${scenarios.length} scenarios passed, \${nonPassingCount} non-passing.\\n\`);
process.exit(nonPassingCount > 0 ? 1 : 0);
`;
}

export async function buildReproducibleZipBundle(
  input: ExportBundleInput
): Promise<Buffer> {
  const zip = new JSZip();

  const candidateProvenance = input.candidate
    ? {
        candidateId: input.candidate.candidateId,
        basedOnRunId: input.candidate.basedOnRunId,
        source: input.candidate.source,
        originalCssHash: input.candidate.originalCssHash,
        candidateCssHash: input.candidate.candidateCssHash,
        sparkGeneratedCssHash: input.candidate.sparkGeneratedCssHash ?? null,
        modifiedAfterSparkProposal:
          input.candidate.source === 'muse_spark_modified',
        directModelReceiptId: input.candidate.receipt?.receiptId ?? null,
        startingPointOriginReceiptId:
          input.candidate.originReceipt?.receiptId ?? null,
      }
    : null;

  const manifest = {
    tool: 'BREAK IT',
    exportedAt: new Date().toISOString(),
    componentName: input.originalRun.componentName,
    componentHash: input.originalRun.componentHash,
    packHash: input.originalRun.packHash,
    rootTargetId: input.originalRun.rootTargetId,
    browserVersion: input.originalRun.browserVersion,
    originalRunSummary: input.originalRun.summary,
    candidateProvenance,
    candidateRunSummary: input.candidateRun?.summary ?? null,
    comparisonSummary: input.comparison?.summary ?? null,
    remainingFailures: input.comparison?.remainingFailures ?? null,
    scopeNotice:
      'Layout assertions verify geometric bounds, visibility, control separation, and overflow for the tested scenarios only. Passing does not certify full WCAG accessibility, security, or application logic.',
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('component/original.html', input.originalRun.html);
  zip.file('component/instrumented.html', input.originalRun.instrumentedHtml);
  zip.file('component/original.css', input.originalRun.css);

  if (input.candidate) {
    zip.file('component/candidate.css', input.candidate.patchedCss);
    zip.file('component/patch.diff', input.candidate.unifiedDiff);
    if (
      input.candidate.sparkGeneratedCss &&
      input.candidate.source === 'muse_spark_modified'
    ) {
      zip.file(
        'component/spark-original-proposal.css',
        input.candidate.sparkGeneratedCss
      );
    }
    zip.file(
      'evidence/candidate-metadata.json',
      JSON.stringify(
        {
          ...candidateProvenance,
          rationale: input.candidate.rationale,
          targetedFailures: input.candidate.targetedFailures,
          createdAt: input.candidate.createdAt,
          directReceipt: input.candidate.receipt ?? null,
          originReceipt: input.candidate.originReceipt ?? null,
        },
        null,
        2
      )
    );
  }

  zip.file('pack/scenarios.json', JSON.stringify(input.originalRun.scenarios, null, 2));
  zip.file('pack/assertions.json', JSON.stringify(input.originalRun.assertions, null, 2));
  zip.file('pack/slots.json', JSON.stringify(input.originalRun.slots, null, 2));

  zip.file('evidence/original-run.json', JSON.stringify(input.originalRun, null, 2));
  if (input.candidateRun) {
    zip.file('evidence/candidate-run.json', JSON.stringify(input.candidateRun, null, 2));
  }
  if (input.comparison) {
    zip.file('evidence/comparison.json', JSON.stringify(input.comparison, null, 2));
  }
  zip.file('evidence/model-receipts.json', JSON.stringify(input.receipts, null, 2));

  for (const res of input.originalRun.results) {
    if (!res.screenshotPath) continue;
    const rel = res.screenshotPath.replace(/^artifacts[\\/]/, '');
    const abs = path.join(input.artifactsDir, rel);
    if (fs.existsSync(abs)) {
      zip.file(`evidence/screenshots/original/${res.scenarioId}.png`, fs.readFileSync(abs));
    }
  }
  if (input.candidateRun) {
    for (const res of input.candidateRun.results) {
      if (!res.screenshotPath) continue;
      const rel = res.screenshotPath.replace(/^artifacts[\\/]/, '');
      const abs = path.join(input.artifactsDir, rel);
      if (fs.existsSync(abs)) {
        zip.file(`evidence/screenshots/candidate/${res.scenarioId}.png`, fs.readFileSync(abs));
      }
    }
  }

  zip.file('repro/evaluator-core.mjs', getCompiledEvaluatorCoreMjs());
  zip.file('repro/fonts.css', loadBundledFontFaceCss());
  zip.file('repro/reproduce.mjs', buildRunnableReproScript());
  zip.file(
    'repro/README.md',
    `# BREAK IT Reproducible Evidence Bundle

## Contents
- \`manifest.json\` — Component hash, scenario/assertion pack hash, candidate provenance, Chromium version, and measured run summaries.
- \`component/\` — \`original.html\`, \`instrumented.html\`, \`original.css\`, \`candidate.css\` (if generated), \`spark-original-proposal.css\` (if manually edited after Spark generation), and \`patch.diff\`.
- \`pack/\` — Exact \`scenarios.json\`, \`assertions.json\`, and \`slots.json\`.
- \`evidence/\` — Full measured Chromium JSON logs, candidate provenance, secret-free model receipts, and before/after PNG screenshots.
- \`repro/evaluator-core.mjs\`, \`repro/fonts.css\`, & \`repro/reproduce.mjs\` — Exact compiled evaluation engine, embedded WOFF2 fonts, and Playwright runner matching the BREAK IT server.

## Reproduce from Terminal
From any directory where \`playwright\` is installed (such as the BREAK IT repo):

\`\`\`bash
# Verify expected failures on original CSS (exits with code 1 when any failure, error, or inconclusive rule occurs)
node repro/reproduce.mjs --target original

# Verify candidate CSS against the exact same scenario + assertion pack (exits with code 0 only if 100% pass)
node repro/reproduce.mjs --target candidate
\`\`\`
`
  );

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
