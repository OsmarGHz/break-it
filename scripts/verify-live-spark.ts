import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import type { CandidatePatch, ModelReceipt, StressRun } from '../src/shared/types.js';
import { CHECKOUT_FRAGILE_CSS, CHECKOUT_FRAGILE_HTML } from '../src/shared/fixtures.js';
import { getPublicHealthStatus, redactSecrets } from '../server/config.js';
import { analyzeAndSanitizeComponent } from '../server/sanitizer.js';
import { closeSharedBrowser, executeStressRun } from '../server/renderer.js';
import { generateScenariosWithSpark, proposeCssPatchWithSpark } from '../server/spark.js';
import { compareStressRuns } from '../server/comparison.js';
import { buildReproducibleZipBundle } from '../server/exporter.js';

const execFileAsync = promisify(execFile);

/**
 * Custom HTML/CSS component outside bundled fixtures (Priority 5):
 * An Airline Boarding Pass & Gate Advisory card with zero pre-existing data-breakit-id attributes
 * and realistic layout fragility:
 * - Passenger header flex row without min-width: 0 + nowrap status pill
 * - Fixed height: 42px; overflow: hidden gate advisory banner
 * - Unbroken e-ticket / PNR code without overflow-wrap
 * - Rigid footer button row (flex-wrap: nowrap; min-width buttons) that overflows on 320px viewports
 */
const CUSTOM_BOARDING_HTML = `
<article class="boarding-card">
  <header class="boarding-header">
    <div class="passenger-meta">
      <span class="cabin-kicker">AeroLatam · Flight LA-4082</span>
      <h2 class="passenger-name">Mateo Vega</h2>
    </div>
    <span class="gate-pill">Gate B14 · Boarding</span>
  </header>

  <div class="route-strip">
    <div class="airport-col">
      <span class="iata-code">MEX</span>
      <span class="city-label">Ciudad de México</span>
    </div>
    <div class="seat-col">
      <span class="seat-label">Seat</span>
      <strong class="seat-number">14A</strong>
    </div>
    <div class="airport-col airport-right">
      <span class="iata-code">MAD</span>
      <span class="city-label">Madrid Barajas</span>
    </div>
  </div>

  <div class="pnr-row">
    <span class="pnr-label">E-Ticket / PNR</span>
    <code class="pnr-token">ETKT-045-9981204471-MX</code>
  </div>

  <p class="gate-advisory">
    Doors close 15 minutes before departure. Present passport at biometric gate.
  </p>

  <footer class="boarding-actions">
    <button type="button" class="btn-secondary">Change Seat</button>
    <button type="button" class="btn-primary">Show QR Pass</button>
  </footer>
</article>
`.trim();

const CUSTOM_BOARDING_CSS = `
.boarding-card {
  width: 100%;
  max-width: 410px;
  background: #ffffff;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
  font-family: 'Inter', sans-serif;
}

.boarding-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px dashed #cbd5e1;
}

.passenger-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.cabin-kicker {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
}

.passenger-name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
  color: #0f172a;
}

.gate-pill {
  padding: 5px 10px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.route-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 0;
}

.airport-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.airport-right {
  text-align: right;
}

.iata-code {
  font-size: 22px;
  font-weight: 800;
  color: #0f172a;
}

.city-label {
  font-size: 12px;
  color: #475569;
  white-space: nowrap;
}

.seat-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 12px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.seat-label {
  font-size: 10px;
  text-transform: uppercase;
  color: #64748b;
}

.seat-number {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.pnr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  background: #f8fafc;
  border-radius: 10px;
  margin-bottom: 12px;
}

.pnr-label {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  white-space: nowrap;
}

.pnr-token {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #0f172a;
  white-space: nowrap;
}

.gate-advisory {
  margin: 0 0 16px;
  height: 40px;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.45;
  color: #475569;
}

.boarding-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
}

.btn-secondary {
  min-width: 145px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #1e293b;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.btn-primary {
  min-width: 185px;
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  background: #2563eb;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
`.trim();

function appendReceiptToDisk(artifactsDir: string, receipt: ModelReceipt) {
  const receiptsPath = path.join(artifactsDir, 'receipts.json');
  let list: ModelReceipt[] = [];
  if (fs.existsSync(receiptsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(receiptsPath, 'utf8'));
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  if (!list.some((r) => r.receiptId === receipt.receiptId)) {
    list.push(receipt);
  }
  fs.writeFileSync(receiptsPath, JSON.stringify(list, null, 2), 'utf8');
}

function appendCandidateToDisk(artifactsDir: string, candidate: CandidatePatch) {
  const candidatesPath = path.join(artifactsDir, 'candidates.json');
  let list: CandidatePatch[] = [];
  if (fs.existsSync(candidatesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const idx = list.findIndex((c) => c.candidateId === candidate.candidateId);
  if (idx >= 0) {
    list[idx] = candidate;
  } else {
    list.push(candidate);
  }
  fs.writeFileSync(candidatesPath, JSON.stringify(list, null, 2), 'utf8');
}

async function runExportParityCheck(params: {
  zipPath: string;
  zipBuf: Buffer;
  expectedOrigPassed: number;
  expectedOrigTotal: number;
  expectedOrigAllPass: boolean;
  expectedCandPassed: number;
  expectedCandTotal: number;
  expectedCandAllPass: boolean;
}) {
  fs.writeFileSync(params.zipPath, params.zipBuf);
  const tmpDir = `${params.zipPath}_extracted`;
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const zip = await JSZip.loadAsync(params.zipBuf);
  for (const [relPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const outPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, await entry.async('nodebuffer'));
  }

  const runTarget = async (target: 'original' | 'candidate') => {
    try {
      const res = await execFileAsync(process.execPath, [
        path.join(tmpDir, 'repro', 'reproduce.mjs'),
        '--target',
        target,
      ]);
      return { exitCode: 0, stdout: res.stdout };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: e.code ?? 1,
        stdout: `${e.stdout || ''}${e.stderr || ''}`,
      };
    }
  };

  try {
    const origRepro = await runTarget('original');
    const candRepro = await runTarget('candidate');

    const expectedOrigLine = `${params.expectedOrigPassed}/${params.expectedOrigTotal} scenarios passed`;
    const expectedCandLine = `${params.expectedCandPassed}/${params.expectedCandTotal} scenarios passed`;

    const origMatches =
      origRepro.stdout.includes(expectedOrigLine) &&
      (params.expectedOrigAllPass ? origRepro.exitCode === 0 : origRepro.exitCode === 1);
    const candMatches =
      candRepro.stdout.includes(expectedCandLine) &&
      (params.expectedCandAllPass ? candRepro.exitCode === 0 : candRepro.exitCode === 1);

    if (!origMatches || !candMatches) {
      throw new Error(
        `Export parity mismatch!\nOriginal (${origRepro.exitCode}):\n${origRepro.stdout}\nCandidate (${candRepro.exitCode}):\n${candRepro.stdout}`
      );
    }

    return {
      zipBytes: params.zipBuf.length,
      originalReproExitCode: origRepro.exitCode,
      candidateReproExitCode: candRepro.exitCode,
      exactParityVerified: true,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runFullLiveFlow(params: {
  flowKey: string;
  componentName: string;
  html: string;
  css: string;
  artifactsDir: string;
}) {
  console.log(`\n=== [${params.flowKey.toUpperCase()}] ${params.componentName} ===`);
  const analysis = analyzeAndSanitizeComponent(params.html, params.css);
  console.log(
    `1. Sanitized & analyzed component: ${analysis.slots.length} slots, ${analysis.suggestedAssertions.length} assertions.`
  );

  console.log('2. Calling Muse Spark 1.3 to generate adversarial scenarios...');
  const { scenarios, receipt: scenarioReceipt } = await generateScenariosWithSpark({
    instrumentedHtml: analysis.instrumentedHtml,
    css: analysis.sanitizedCss,
    slots: analysis.slots,
    assertions: analysis.suggestedAssertions,
  });
  appendReceiptToDisk(params.artifactsDir, scenarioReceipt);
  console.log(
    `   -> Received ${scenarios.length} scenarios (1 baseline + ${scenarios.length - 1} Spark) | receipt=${scenarioReceipt.receiptId} responseId=${scenarioReceipt.responseId} model=${scenarioReceipt.respondedModel} (${scenarioReceipt.durationMs}ms)`
  );

  const origRunId = `live_spark_${params.flowKey}_orig`;
  console.log(`3. Executing locked pack in Chromium (${origRunId})...`);
  const origRun: StressRun = await executeStressRun({
    runId: origRunId,
    role: 'original',
    componentName: params.componentName,
    html: params.html,
    css: params.css,
    slots: analysis.slots,
    assertions: analysis.suggestedAssertions,
    scenarios,
    artifactsDir: params.artifactsDir,
  });
  console.log(
    `   -> Original result: ${origRun.summary.passedScenarios}/${origRun.summary.totalScenarios} passed, ${origRun.summary.failedScenarios} failed (${origRun.summary.failedAssertions} assertion failures)`
  );

  console.log('4. Calling Muse Spark 1.3 to propose scoped CSS patch (with real failure PNGs)...');
  const sparkCandidate = await proposeCssPatchWithSpark({
    failedRun: origRun,
    artifactsDir: params.artifactsDir,
  });
  if (sparkCandidate.receipt) {
    appendReceiptToDisk(params.artifactsDir, sparkCandidate.receipt);
  }
  appendCandidateToDisk(params.artifactsDir, sparkCandidate);
  console.log(
    `   -> Spark candidate=${sparkCandidate.candidateId} source=${sparkCandidate.source} cssHash=${sparkCandidate.candidateCssHash} imagesAttached=${sparkCandidate.receipt?.imagesAttached ?? 0} responseId=${sparkCandidate.receipt?.responseId} (${sparkCandidate.receipt?.durationMs}ms)`
  );

  const candRunId = `live_spark_${params.flowKey}_cand`;
  console.log(`5. Replaying EXACT locked pack against unmodified Spark CSS (${candRunId})...`);
  const candRun: StressRun = await executeStressRun({
    runId: candRunId,
    role: 'candidate',
    componentName: params.componentName,
    html: origRun.html,
    css: sparkCandidate.patchedCss,
    slots: origRun.slots,
    assertions: origRun.assertions,
    scenarios: origRun.scenarios,
    artifactsDir: params.artifactsDir,
  });

  const comparison = compareStressRuns(origRun, candRun);
  console.log(
    `   -> Candidate replay result: ${candRun.summary.passedScenarios}/${candRun.summary.totalScenarios} passed, ${candRun.summary.failedScenarios} failed | scenariosFixed=${comparison.summary.scenariosFixed}, assertionsFixed=${comparison.summary.assertionsFixed}, scenariosRegressed=${comparison.summary.scenariosRegressed}, remainingFailures=${comparison.remainingFailures.length}`
  );
  if (comparison.remainingFailures.length > 0) {
    console.log('   -> Honest remaining failures after first Spark CSS pass:');
    for (const rf of comparison.remainingFailures) {
      console.log(`      * [${rf.scenarioId}] ${rf.assertionId}: ${rf.summary}`);
    }
  }

  const allFlowReceipts: ModelReceipt[] = [
    scenarioReceipt,
    ...(sparkCandidate.receipt ? [sparkCandidate.receipt] : []),
  ];
  const zipPath = path.join(params.artifactsDir, `live-spark-${params.flowKey}-bundle.zip`);
  console.log(`6. Exporting reproducible bundle & verifying reproduce.mjs parity (${path.basename(zipPath)})...`);
  const zipBuf = await buildReproducibleZipBundle({
    originalRun: origRun,
    candidateRun: candRun,
    candidate: sparkCandidate,
    comparison,
    receipts: allFlowReceipts,
    artifactsDir: params.artifactsDir,
  });

  const parity = await runExportParityCheck({
    zipPath,
    zipBuf,
    expectedOrigPassed: origRun.summary.passedScenarios,
    expectedOrigTotal: origRun.summary.totalScenarios,
    expectedOrigAllPass:
      origRun.summary.failedScenarios === 0 &&
      origRun.summary.errorScenarios === 0 &&
      origRun.summary.inconclusiveScenarios === 0,
    expectedCandPassed: candRun.summary.passedScenarios,
    expectedCandTotal: candRun.summary.totalScenarios,
    expectedCandAllPass:
      candRun.summary.failedScenarios === 0 &&
      candRun.summary.errorScenarios === 0 &&
      candRun.summary.inconclusiveScenarios === 0,
  });
  console.log(
    `   -> Export parity VERIFIED (orig exit=${parity.originalReproExitCode}, cand exit=${parity.candidateReproExitCode}, zipBytes=${parity.zipBytes})`
  );

  return {
    flowKey: params.flowKey,
    componentName: params.componentName,
    slotsCount: analysis.slots.length,
    assertionsCount: analysis.suggestedAssertions.length,
    scenariosCount: scenarios.length,
    scenarioReceipt,
    patchReceipt: sparkCandidate.receipt ?? null,
    candidateId: sparkCandidate.candidateId,
    candidateSource: sparkCandidate.source,
    sparkGeneratedCssHash: sparkCandidate.sparkGeneratedCssHash,
    rationale: sparkCandidate.rationale,
    targetedFailures: sparkCandidate.targetedFailures,
    originalRunId: origRun.runId,
    candidateRunId: candRun.runId,
    packHash: comparison.packHash,
    packMatchesExactly: comparison.packMatchesExactly,
    originalSummary: origRun.summary,
    candidateSummary: candRun.summary,
    comparisonSummary: comparison.summary,
    remainingFailures: comparison.remainingFailures,
    exportBundle: {
      zipFile: `artifacts/${path.basename(zipPath)}`,
      ...parity,
    },
  };
}

async function main() {
  const health = getPublicHealthStatus();
  console.log('Health check (secret-free):', JSON.stringify(health));
  if (!health.metaConfigured) {
    throw new Error('MODEL_API_KEY is not configured in .env.local.');
  }

  const artifactsDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(path.join(artifactsDir, 'runs'), { recursive: true });

  const checkoutResult = await runFullLiveFlow({
    flowKey: 'checkout',
    componentName: 'Checkout Order Summary Card (Fragile)',
    html: CHECKOUT_FRAGILE_HTML,
    css: CHECKOUT_FRAGILE_CSS,
    artifactsDir,
  });

  const customResult = await runFullLiveFlow({
    flowKey: 'custom_boarding',
    componentName: 'Custom Airline Boarding Pass (Outside Bundled Fixtures)',
    html: CUSTOM_BOARDING_HTML,
    css: CUSTOM_BOARDING_CSS,
    artifactsDir,
  });

  const report = {
    verifiedAt: new Date().toISOString(),
    health: getPublicHealthStatus(),
    flows: {
      bundledCheckout: checkoutResult,
      customBoardingPass: customResult,
    },
  };

  const reportPath = path.join(artifactsDir, 'live-spark-verification.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nSaved secret-free verification report to ${reportPath}`);
}

main()
  .catch((err) => {
    const safeMsg = redactSecrets(err instanceof Error ? err.stack || err.message : String(err));
    console.error('Live Spark verification failed:', safeMsg);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeSharedBrowser();
  });
