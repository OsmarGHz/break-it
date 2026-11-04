import { createTwoFilesPatch } from 'diff';
import type {
  AssertionDelta,
  DeltaOutcome,
  RunComparison,
  ScenarioComparisonItem,
  StressRun,
  VerificationStatus,
} from '../src/shared/types.js';

export function computeUnifiedCssDiff(
  originalCss: string,
  candidateCss: string
): string {
  const normOrig = originalCss.replace(/\r\n/g, '\n').trim() + '\n';
  const normCand = candidateCss.replace(/\r\n/g, '\n').trim() + '\n';
  return createTwoFilesPatch(
    'component.original.css',
    'component.candidate.css',
    normOrig,
    normCand,
    'Original CSS',
    'Candidate CSS',
    { context: 3 }
  );
}

function classifyDelta(
  before: VerificationStatus,
  after: VerificationStatus
): DeltaOutcome {
  if (after === 'error' || after === 'inconclusive') {
    return 'inconclusive_or_error';
  }
  if (before === 'fail' && after === 'pass') {
    return 'fixed';
  }
  if (before === 'pass' && after === 'fail') {
    return 'regressed';
  }
  if (after === 'fail') {
    return 'still_failing';
  }
  if (before === 'error' || before === 'inconclusive') {
    return after === 'pass' ? 'fixed' : 'inconclusive_or_error';
  }
  return 'still_passing';
}

export function compareStressRuns(
  originalRun: StressRun,
  candidateRun: StressRun
): RunComparison {
  const packMatchesExactly =
    originalRun.packHash === candidateRun.packHash &&
    originalRun.componentHash === candidateRun.componentHash &&
    originalRun.scenarios.length === candidateRun.scenarios.length;

  if (!packMatchesExactly) {
    throw new Error(
      `Cannot claim valid comparison: scenario/assertion pack or HTML slots changed between runs (original pack=${originalRun.packHash}, candidate pack=${candidateRun.packHash}).`
    );
  }

  const candScenarioMap = new Map(
    candidateRun.results.map((r) => [r.scenarioId, r])
  );

  const items: ScenarioComparisonItem[] = [];
  const remainingFailures: RunComparison['remainingFailures'] = [];

  const summary = {
    scenariosFixed: 0,
    scenariosRegressed: 0,
    scenariosStillFailing: 0,
    scenariosStillPassing: 0,
    scenariosInconclusiveOrError: 0,
    assertionsFixed: 0,
    assertionsRegressed: 0,
    assertionsStillFailing: 0,
    assertionsStillPassing: 0,
  };

  for (const origSc of originalRun.results) {
    const candSc = candScenarioMap.get(origSc.scenarioId);
    if (!candSc) {
      throw new Error(
        `Candidate run is missing scenario "${origSc.scenarioId}" from the original pack.`
      );
    }

    const candAssertMap = new Map(
      candSc.assertions.map((a) => [a.assertionId, a])
    );

    const assertionDeltas: AssertionDelta[] = origSc.assertions.map((origA) => {
      const candA = candAssertMap.get(origA.assertionId);
      if (!candA) {
        throw new Error(
          `Candidate scenario "${origSc.scenarioId}" is missing assertion "${origA.assertionId}".`
        );
      }
      const outcome = classifyDelta(origA.status, candA.status);
      if (outcome === 'fixed') summary.assertionsFixed += 1;
      else if (outcome === 'regressed') summary.assertionsRegressed += 1;
      else if (outcome === 'still_failing') summary.assertionsStillFailing += 1;
      else if (outcome === 'still_passing') summary.assertionsStillPassing += 1;

      if (candA.status !== 'pass') {
        remainingFailures.push({
          scenarioId: origSc.scenarioId,
          scenarioName: origSc.scenarioName,
          assertionId: candA.assertionId,
          assertionLabel: candA.assertionLabel,
          afterStatus: candA.status,
          summary: candA.summary,
        });
      }

      return {
        assertionId: origA.assertionId,
        assertionLabel: origA.assertionLabel,
        assertionType: origA.assertionType,
        beforeStatus: origA.status,
        afterStatus: candA.status,
        outcome,
        beforeSummary: origA.summary,
        afterSummary: candA.summary,
      };
    });

    const scOutcome = classifyDelta(origSc.status, candSc.status);
    if (scOutcome === 'fixed') summary.scenariosFixed += 1;
    else if (scOutcome === 'regressed') summary.scenariosRegressed += 1;
    else if (scOutcome === 'still_failing') summary.scenariosStillFailing += 1;
    else if (scOutcome === 'still_passing') summary.scenariosStillPassing += 1;
    else summary.scenariosInconclusiveOrError += 1;

    items.push({
      scenarioId: origSc.scenarioId,
      scenarioName: origSc.scenarioName,
      category: origSc.category,
      viewport: origSc.viewport,
      beforeStatus: origSc.status,
      afterStatus: candSc.status,
      outcome: scOutcome,
      beforeScreenshotUrl: origSc.screenshotUrl,
      afterScreenshotUrl: candSc.screenshotUrl,
      assertionDeltas,
    });
  }

  return {
    originalRunId: originalRun.runId,
    candidateRunId: candidateRun.runId,
    packHash: originalRun.packHash,
    packMatchesExactly: true,
    summary,
    items,
    remainingFailures,
  };
}

