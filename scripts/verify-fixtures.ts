import path from 'node:path';
import {
  CHECKOUT_CORRECTED_REFERENCE_CSS,
  CHECKOUT_FRAGILE_CSS,
  CHECKOUT_FRAGILE_HTML,
  CHECKOUT_STARTER_SCENARIOS,
} from '../src/shared/fixtures.js';
import { analyzeAndSanitizeComponent } from '../server/sanitizer.js';
import { closeSharedBrowser, executeStressRun } from '../server/renderer.js';
import { compareStressRuns } from '../server/comparison.js';

async function main() {
  const artifactsDir = path.join(process.cwd(), 'artifacts');
  const analysis = analyzeAndSanitizeComponent(
    CHECKOUT_FRAGILE_HTML,
    CHECKOUT_FRAGILE_CSS
  );

  console.log('1. Executing fragile checkout fixture in Playwright Chromium...');
  const fragileRun = await executeStressRun({
    runId: 'verify_fragile_checkout',
    role: 'original',
    componentName: 'Checkout Order Summary Card (Fragile)',
    html: CHECKOUT_FRAGILE_HTML,
    css: CHECKOUT_FRAGILE_CSS,
    slots: analysis.slots,
    assertions: analysis.suggestedAssertions,
    scenarios: CHECKOUT_STARTER_SCENARIOS,
    artifactsDir,
  });

  console.log(
    `   Fragile Summary: ${fragileRun.summary.passedScenarios}/${fragileRun.summary.totalScenarios} scenarios passed, ${fragileRun.summary.failedScenarios} failed (${fragileRun.summary.failedAssertions} assertion failures) [${fragileRun.browserVersion}]`
  );
  for (const sc of fragileRun.results) {
    const failedList = sc.assertions
      .filter((a) => a.status !== 'pass')
      .map((a) => `${a.assertionId}: ${a.summary}`);
    console.log(
      `   - [${sc.status.toUpperCase()}] ${sc.scenarioId} (${sc.viewport.width}x${sc.viewport.height})${
        failedList.length ? `\n       ${failedList.join('\n       ')}` : ''
      }`
    );
  }

  console.log('\n2. Replaying EXACT same scenario & assertion pack against reference corrected CSS...');
  const correctedRun = await executeStressRun({
    runId: 'verify_corrected_checkout',
    role: 'candidate',
    componentName: 'Checkout Order Summary Card (Fragile)',
    html: fragileRun.html,
    css: CHECKOUT_CORRECTED_REFERENCE_CSS,
    slots: fragileRun.slots,
    assertions: fragileRun.assertions,
    scenarios: fragileRun.scenarios,
    artifactsDir,
  });

  const comparison = compareStressRuns(fragileRun, correctedRun);
  console.log(
    `   Corrected Summary: ${correctedRun.summary.passedScenarios}/${correctedRun.summary.totalScenarios} scenarios passed, ${correctedRun.summary.failedScenarios} failed`
  );
  console.log(
    `   Comparison (packHash=${comparison.packHash}, exactMatch=${comparison.packMatchesExactly}): ${comparison.summary.scenariosFixed} scenarios fixed, ${comparison.summary.assertionsFixed} assertions fixed, ${comparison.remainingFailures.length} remaining failures.`
  );

  await closeSharedBrowser();

  if (fragileRun.results[0].status !== 'pass') {
    throw new Error('Expected baseline-ideal scenario on fragile fixture to pass!');
  }
  if (fragileRun.summary.failedScenarios < 4) {
    throw new Error('Expected fragile fixture to fail adversarial stress scenarios!');
  }
  if (correctedRun.summary.failedScenarios !== 0 || correctedRun.summary.errorScenarios !== 0) {
    throw new Error(
      `Expected corrected fixture to pass all scenarios, but got remaining failures: ${JSON.stringify(
        comparison.remainingFailures,
        null,
        2
      )}`
    );
  }
}

main().catch(async (err) => {
  console.error(err);
  await closeSharedBrowser();
  process.exit(1);
});

