import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  Cpu,
  Download,
  Eye,
  FileDiff,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Receipt,
  ShieldAlert,
  Sparkles,
  SplitSquareHorizontal,
  Wrench,
  XCircle,
} from 'lucide-react';
import { BUNDLED_FIXTURES } from './shared/fixtures';
import type {
  ApiHealthStatus,
  AssertionRule,
  CandidatePatch,
  ModelReceipt,
  RunComparison,
  SanitizationReport,
  StressRun,
  StressScenario,
  TextSlot,
  VerificationStatus,
} from './shared/types';
import { api } from './api';
import { BaselinePreview } from './components/BaselinePreview';
import { CssDiffViewer } from './components/CssDiffViewer';
import { ScreenshotOverlay } from './components/ScreenshotOverlay';

type WorkspaceTab = 'setup' | 'matrix' | 'candidate' | 'proof';

function StatusBadge({ status }: { status: VerificationStatus }) {
  return (
    <span className={`status-pill-badge status-pill-badge--${status}`}>
      {status === 'pass' && <CheckCircle2 size={12} />}
      {status === 'fail' && <XCircle size={12} />}
      {(status === 'error' || status === 'inconclusive') && <AlertTriangle size={12} />}
      {status.toUpperCase()}
    </span>
  );
}

export const App: React.FC = () => {
  const defaultFixture = BUNDLED_FIXTURES[0];

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('setup');
  const [health, setHealth] = useState<(ApiHealthStatus & { recentReceiptsCount: number }) | null>(
    null
  );
  const [receipts, setReceipts] = useState<ModelReceipt[]>([]);
  const [showReceiptsModal, setShowReceiptsModal] = useState(false);

  // Component editor & analysis state
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>(defaultFixture.id);
  const [componentName, setComponentName] = useState<string>(defaultFixture.name);
  const [htmlInput, setHtmlInput] = useState<string>(defaultFixture.html);
  const [cssInput, setCssInput] = useState<string>(defaultFixture.css);
  const [sanitizedPreview, setSanitizedPreview] = useState<{
    html: string;
    css: string;
    sanitization: SanitizationReport | null;
  }>({
    html: defaultFixture.html,
    css: defaultFixture.css,
    sanitization: null,
  });

  const [slots, setSlots] = useState<TextSlot[]>([]);
  const [assertions, setAssertions] = useState<AssertionRule[]>([]);
  const [scenarios, setScenarios] = useState<StressScenario[]>(defaultFixture.starterScenarios);
  const [editorPane, setEditorPane] = useState<'html' | 'css'>('css');

  // Execution & AI states
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<{ title: string; detail: string } | null>(null);
  const [noticeBanner, setNoticeBanner] = useState<string | null>(null);

  // Original run & inspector state
  const [originalRun, setOriginalRun] = useState<StressRun | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [focusedAssertionId, setFocusedAssertionId] = useState<string | null>(null);
  const [showOverlays, setShowOverlays] = useState<boolean>(true);

  // Candidate patch & comparison state
  const [candidate, setCandidate] = useState<CandidatePatch | null>(null);
  const [candidateCssDraft, setCandidateCssDraft] = useState<string>('');
  const [candidateDiffDraft, setCandidateDiffDraft] = useState<string>('');
  const [candidateRun, setCandidateRun] = useState<StressRun | null>(null);
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [selectedProofScenarioId, setSelectedProofScenarioId] = useState<string | null>(null);

  const refreshHealthAndReceipts = useCallback(async () => {
    try {
      const [h, r] = await Promise.all([api.getHealth(), api.getReceipts()]);
      setHealth(h);
      setReceipts(r.receipts);
    } catch {
      // API might still be booting
    }
  }, []);

  const runAnalysis = useCallback(async (html: string, css: string) => {
    try {
      const res = await api.analyzeComponent(html, css);
      setSlots(res.slots);
      setAssertions(res.suggestedAssertions);
      setSanitizedPreview({
        html: res.instrumentedHtml,
        css: res.sanitizedCss,
        sanitization: res.sanitization,
      });
      setErrorBanner(null);
    } catch (err) {
      setErrorBanner({
        title: 'Component Analysis Error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    refreshHealthAndReceipts();
    runAnalysis(defaultFixture.html, defaultFixture.css);
  }, [defaultFixture.css, defaultFixture.html, refreshHealthAndReceipts, runAnalysis]);

  const handleSelectFixture = async (fixtureId: string) => {
    setSelectedFixtureId(fixtureId);
    setOriginalRun(null);
    setCandidate(null);
    setCandidateRun(null);
    setComparison(null);
    setErrorBanner(null);
    setNoticeBanner(null);

    if (fixtureId === 'custom') {
      setComponentName('Custom Static Component');
      return;
    }

    const found = BUNDLED_FIXTURES.find((f) => f.id === fixtureId);
    if (!found) return;
    setComponentName(found.name);
    setHtmlInput(found.html);
    setCssInput(found.css);
    setScenarios(found.starterScenarios);
    await runAnalysis(found.html, found.css);
  };

  const handleToggleSlotRequired = (slotId: string) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === slotId ? { ...s, required: !s.required } : s))
    );
    // Sync corresponding text_not_clipped assertion enabled state
    setAssertions((prev) =>
      prev.map((a) =>
        a.type === 'text_not_clipped' && a.targetId === slotId
          ? { ...a, enabled: !a.enabled }
          : a
      )
    );
  };

  const handleToggleAssertion = (assertionId: string) => {
    setAssertions((prev) =>
      prev.map((a) => (a.id === assertionId ? { ...a, enabled: !a.enabled } : a))
    );
  };

  const handleToggleEllipsisException = (assertionId: string) => {
    setAssertions((prev) =>
      prev.map((a) =>
        a.id === assertionId
          ? {
              ...a,
              exception: {
                ...a.exception,
                allowEllipsis: !a.exception?.allowEllipsis,
                notes: !a.exception?.allowEllipsis
                  ? 'User-approved single-line text-overflow: ellipsis'
                  : undefined,
              },
            }
          : a
      )
    );
  };

  const handleGenerateSparkScenarios = async () => {
    setBusyAction('Generating adversarial scenarios with Muse Spark 1.3…');
    setErrorBanner(null);
    setNoticeBanner(null);
    try {
      const { scenarios: sparkScenarios, receipt } = await api.generateSparkScenarios({
        html: htmlInput,
        css: cssInput,
        slots,
        assertions,
      });
      setScenarios(sparkScenarios);
      setNoticeBanner(
        `Muse Spark 1.3 generated ${sparkScenarios.length - 1} adversarial scenarios (+1 baseline control) in ${(
          receipt.durationMs / 1000
        ).toFixed(1)}s [Receipt ${receipt.responseId}].`
      );
      await refreshHealthAndReceipts();
    } catch (err) {
      setErrorBanner({
        title: 'Muse Spark Scenario Generation Failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      await refreshHealthAndReceipts();
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadLocalStarterPack = () => {
    const found =
      BUNDLED_FIXTURES.find((f) => f.id === selectedFixtureId) || BUNDLED_FIXTURES[0];
    if (selectedFixtureId === 'custom') {
      // Build generic deterministic stress pack targeting discovered slots
      const firstHeading = slots.find((s) => s.role === 'heading') || slots[0];
      const firstCode = slots.find((s) => s.role === 'code' || s.role === 'text') || slots[0];
      const firstCta = slots.find((s) => s.role === 'cta') || slots[slots.length - 1];
      const customPack: StressScenario[] = [
        {
          id: 'baseline-ideal',
          name: 'Baseline — Current Copy',
          category: 'baseline',
          viewport: { width: 460, height: 520, label: 'Desktop (460×520)' },
          mutations: [],
          rationale: 'Unmodified baseline control case.',
          source: 'baseline',
        },
      ];
      if (firstHeading) {
        customPack.push({
          id: 'custom-long-es-heading',
          name: 'Spanish Long Compound Heading',
          category: 'long_name',
          viewport: { width: 400, height: 520, label: 'Compact (400×520)' },
          mutations: [
            {
              slotId: firstHeading.id,
              value: 'María Fernanda Castellanos de Montes de Oca y Villaseñor',
            },
          ],
          rationale: 'Probes horizontal flex/grid shrinkage with long compound name.',
          source: 'local_preset',
        });
      }
      if (firstCode) {
        customPack.push({
          id: 'custom-unbroken-token',
          name: 'Unbroken 48-Char Identifier',
          category: 'unbroken_token',
          viewport: { width: 400, height: 520, label: 'Compact (400×520)' },
          mutations: [
            {
              slotId: firstCode.id,
              value: 'REF_2026_CDMX_99481726354829104756_SETTLEMENT_OK',
            },
          ],
          rationale: 'Probes overflow-wrap handling with continuous unbroken string.',
          source: 'local_preset',
        });
      }
      if (firstCta) {
        customPack.push({
          id: 'custom-narrow-320',
          name: '320px Narrow Mobile + Localized CTA',
          category: 'narrow_viewport',
          viewport: { width: 320, height: 560, label: 'Small Mobile (320×560)' },
          mutations: [
            {
              slotId: firstCta.id,
              value: 'Confirmar y autorizar operación ahora',
            },
          ],
          rationale: 'Probes narrow mobile viewport CTA containment.',
          source: 'local_preset',
        });
      }
      setScenarios(customPack);
    } else {
      setScenarios(found.starterScenarios);
    }
    setNoticeBanner('Loaded deterministic local stress pack (non-AI preset).');
  };

  const handleExecuteOriginalRun = async () => {
    setBusyAction('Rendering scenarios in isolated Playwright Chromium…');
    setErrorBanner(null);
    setNoticeBanner(null);
    try {
      const { run } = await api.executeRun({
        componentName,
        html: htmlInput,
        css: cssInput,
        slots,
        assertions,
        scenarios,
      });
      setOriginalRun(run);
      setCandidate(null);
      setCandidateCssDraft(run.css);
      setCandidateDiffDraft('');
      setCandidateRun(null);
      setComparison(null);

      // Focus first failing scenario automatically so user immediately sees real failure evidence
      const firstFailing =
        run.results.find((r) => r.status === 'fail' || r.status === 'error') ||
        run.results[0];
      setSelectedScenarioId(firstFailing?.scenarioId || null);
      setFocusedAssertionId(null);
      setActiveTab('matrix');
    } catch (err) {
      setErrorBanner({
        title: 'Chromium Stress Run Failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleProposeSparkPatch = async () => {
    if (!originalRun) return;
    setBusyAction('Sending HTML/CSS, failure measurements & PNG captures to Muse Spark 1.3…');
    setErrorBanner(null);
    setNoticeBanner(null);
    try {
      const { candidate: proposed } = await api.proposeSparkPatch(originalRun.runId);
      setCandidate(proposed);
      setCandidateCssDraft(proposed.patchedCss);
      setCandidateDiffDraft(proposed.unifiedDiff);
      setCandidateRun(null);
      setComparison(null);
      setActiveTab('candidate');
      await refreshHealthAndReceipts();
    } catch (err) {
      setErrorBanner({
        title: 'Muse Spark CSS Patch Proposal Failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      await refreshHealthAndReceipts();
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenManualCandidateEditor = async (useReferenceFix = false) => {
    if (!originalRun) return;
    const found = BUNDLED_FIXTURES.find((f) => f.id === selectedFixtureId);
    const nextCss =
      useReferenceFix && found?.referenceCorrectedCss
        ? found.referenceCorrectedCss
        : candidateCssDraft || originalRun.css;

    setCandidateCssDraft(nextCss);
    try {
      const diffRes = await api.computeDiff(originalRun.runId, nextCss);
      setCandidateDiffDraft(diffRes.unifiedDiff);
      setCandidate({
        candidateId: `cand_local_${Date.now().toString(36)}`,
        basedOnRunId: originalRun.runId,
        originalCssHash: originalRun.cssHash,
        candidateCssHash: 'draft',
        patchedCss: diffRes.sanitizedCss,
        unifiedDiff: diffRes.unifiedDiff,
        rationale: useReferenceFix
          ? 'Local reference responsive stylesheet loaded for offline engine verification (NOT generated by Muse Spark).'
          : 'Manual CSS candidate prepared in workbench editor.',
        targetedFailures: useReferenceFix
          ? [
              'Allow flex/grid children to shrink via min-width: 0',
              'Wrap compound names and unbroken reference tokens via overflow-wrap: anywhere',
              'Replace fixed 76px height clipping on .plan-box with min-height + height: auto',
              'Allow .action-bar buttons to wrap cleanly inside 320px cards',
            ]
          : [],
        source: useReferenceFix ? 'fixture_reference' : 'manual_edit',
        createdAt: new Date().toISOString(),
      });
      setActiveTab('candidate');
    } catch (err) {
      setErrorBanner({
        title: 'Candidate Diff Error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleUpdateManualDiff = async (nextCss: string) => {
    setCandidateCssDraft(nextCss);
    if (!originalRun) return;
    try {
      const diffRes = await api.computeDiff(originalRun.runId, nextCss);
      setCandidateDiffDraft(diffRes.unifiedDiff);
    } catch {
      // Ignore transient typing errors
    }
  };

  const isDraftModifiedFromSpark = useMemo(() => {
    if (
      !candidate ||
      (candidate.source !== 'muse_spark' && candidate.source !== 'muse_spark_modified')
    ) {
      return false;
    }
    const baseSparkCss = (candidate.sparkGeneratedCss ?? candidate.patchedCss)
      .replace(/\r\n/g, '\n')
      .trim();
    const currentDraft = candidateCssDraft.replace(/\r\n/g, '\n').trim();
    return currentDraft !== baseSparkCss;
  }, [candidate, candidateCssDraft]);

  const handleRestoreExactSparkCss = async () => {
    if (!originalRun || !candidate?.sparkGeneratedCss) return;
    setCandidateCssDraft(candidate.sparkGeneratedCss);
    try {
      const diffRes = await api.computeDiff(originalRun.runId, candidate.sparkGeneratedCss);
      setCandidateDiffDraft(diffRes.unifiedDiff);
    } catch {
      // Ignore
    }
  };

  const handleReplayCandidatePack = async () => {
    if (!originalRun) return;
    setBusyAction('Replaying exact locked scenario & assertion pack in Chromium…');
    setErrorBanner(null);
    try {
      const isServerSparkLineage =
        candidate &&
        candidate.basedOnRunId === originalRun.runId &&
        (candidate.source === 'muse_spark' || candidate.source === 'muse_spark_modified');

      const localSource: 'manual_edit' | 'fixture_reference' =
        candidate?.source === 'fixture_reference' &&
        candidateCssDraft.replace(/\r\n/g, '\n').trim() ===
          candidate.patchedCss.replace(/\r\n/g, '\n').trim()
          ? 'fixture_reference'
          : 'manual_edit';

      const res = await api.retestCandidate(originalRun.runId, {
        candidateId: isServerSparkLineage ? candidate.candidateId : undefined,
        patchedCss: candidateCssDraft,
        rationale: isServerSparkLineage && isDraftModifiedFromSpark ? undefined : candidate?.rationale,
        targetedFailures: candidate?.targetedFailures,
        source: isServerSparkLineage ? undefined : localSource,
      });
      setCandidate(res.candidate);
      setCandidateDiffDraft(res.candidate.unifiedDiff);
      setCandidateRun(res.candidateRun);
      setComparison(res.comparison);

      const firstInteresting =
        res.comparison.items.find((i) => i.outcome === 'still_failing' || i.outcome === 'regressed') ||
        res.comparison.items.find((i) => i.outcome === 'fixed') ||
        res.comparison.items[0];
      setSelectedProofScenarioId(firstInteresting?.scenarioId || null);
      setActiveTab('proof');
    } catch (err) {
      setErrorBanner({
        title: 'Candidate Replay Error',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportBundle = async () => {
    if (!originalRun) return;
    setBusyAction('Packaging reproducible evidence bundle (.zip)…');
    setErrorBanner(null);
    try {
      await api.downloadExportZip({
        originalRunId: originalRun.runId,
        candidateId: candidate?.candidateId,
        candidateRunId: candidateRun?.runId,
      });
    } catch (err) {
      setErrorBanner({
        title: 'Export Failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const selectedScenarioResult = useMemo(() => {
    if (!originalRun) return null;
    return (
      originalRun.results.find((r) => r.scenarioId === selectedScenarioId) ||
      originalRun.results[0] ||
      null
    );
  }, [originalRun, selectedScenarioId]);

  const selectedProofItem = useMemo(() => {
    if (!comparison) return null;
    return (
      comparison.items.find((i) => i.scenarioId === selectedProofScenarioId) ||
      comparison.items[0] ||
      null
    );
  }, [comparison, selectedProofScenarioId]);

  const proofBeforeResult = useMemo(() => {
    if (!originalRun || !selectedProofItem) return null;
    return originalRun.results.find((r) => r.scenarioId === selectedProofItem.scenarioId) || null;
  }, [originalRun, selectedProofItem]);

  const proofAfterResult = useMemo(() => {
    if (!candidateRun || !selectedProofItem) return null;
    return candidateRun.results.find((r) => r.scenarioId === selectedProofItem.scenarioId) || null;
  }, [candidateRun, selectedProofItem]);

  const currentFixtureHasReferenceFix = Boolean(
    BUNDLED_FIXTURES.find((f) => f.id === selectedFixtureId)?.referenceCorrectedCss
  );

  const sanitizedItemCount = useMemo(() => {
    const s = sanitizedPreview.sanitization;
    if (!s) return 0;
    return (
      s.strippedTags.length +
      s.strippedAttributes.length +
      s.strippedExternalUrls.length +
      s.strippedCssConstructs.length
    );
  }, [sanitizedPreview.sanitization]);

  return (
    <div className="workbench-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar__brand">
          <div className="brand-mark">BREAK IT</div>
          <div className="brand-copy">
            <h1>Adversarial HTML/CSS Stress Lab</h1>
            <p>Find the content that breaks your UI. Then prove the fix in Chromium.</p>
          </div>
        </div>

        <div className="topbar__controls">
          <div
            className={`api-pill ${
              health?.metaConfigured ? 'api-pill--ready' : 'api-pill--missing'
            }`}
            title={
              health?.metaConfigured
                ? `Loaded server-side from ${health.keySource} (${health.metaBaseUrl})`
                : 'Set MODEL_API_KEY in .env.local on disk (never exposed to browser).'
            }
          >
            <Sparkles size={13} />
            <span>
              {health?.metaSparkModel || 'muse-spark-1.3'}:{' '}
              <strong>
                {health?.metaConfigured
                  ? `Key Ready (${health.keySource})`
                  : 'Key Missing (.env.local)'}
              </strong>
            </span>
            <button
              type="button"
              className="icon-refresh-btn"
              onClick={refreshHealthAndReceipts}
              title="Re-check .env.local key status"
            >
              <RefreshCw size={12} />
            </button>
          </div>

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              refreshHealthAndReceipts();
              setShowReceiptsModal(true);
            }}
          >
            <Receipt size={14} />
            <span>Receipts ({receipts.length})</span>
          </button>

          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!originalRun || Boolean(busyAction)}
            onClick={handleExportBundle}
          >
            <Download size={14} />
            <span>Export Bundle (.zip)</span>
          </button>
        </div>
      </header>

      {/* Workflow Step Navigation */}
      <nav className="step-nav" aria-label="Workflow steps">
        <button
          type="button"
          className={`step-tab ${activeTab === 'setup' ? 'step-tab--active' : ''}`}
          onClick={() => setActiveTab('setup')}
        >
          <Code2 size={15} />
          <span>1. Component & Invariants</span>
          <span className="step-count">{scenarios.length} cases</span>
        </button>

        <button
          type="button"
          className={`step-tab ${activeTab === 'matrix' ? 'step-tab--active' : ''}`}
          disabled={!originalRun}
          onClick={() => setActiveTab('matrix')}
        >
          <Layers size={15} />
          <span>2. Failure Matrix & Evidence</span>
          {originalRun && (
            <span
              className={`step-count ${
                originalRun.summary.failedScenarios + originalRun.summary.errorScenarios > 0
                  ? 'step-count--fail'
                  : 'step-count--pass'
              }`}
            >
              {originalRun.summary.failedScenarios + originalRun.summary.errorScenarios > 0
                ? `${originalRun.summary.failedScenarios + originalRun.summary.errorScenarios} broken`
                : 'all pass'}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`step-tab ${activeTab === 'candidate' ? 'step-tab--active' : ''}`}
          disabled={!originalRun}
          onClick={() => setActiveTab('candidate')}
        >
          <FileDiff size={15} />
          <span>3. Candidate Patch & Diff</span>
          {candidate && (
            <span className="step-count">
              {isDraftModifiedFromSpark || candidate.source === 'muse_spark_modified'
                ? 'Spark + edited'
                : candidate.source === 'muse_spark'
                  ? 'Spark 1.3'
                  : candidate.source}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`step-tab ${activeTab === 'proof' ? 'step-tab--active' : ''}`}
          disabled={!comparison}
          onClick={() => setActiveTab('proof')}
        >
          <SplitSquareHorizontal size={15} />
          <span>4. Before / After Proof</span>
          {comparison && (
            <span
              className={`step-count ${
                comparison.remainingFailures.length === 0
                  ? 'step-count--pass'
                  : 'step-count--fail'
              }`}
            >
              {comparison.remainingFailures.length === 0
                ? `+${comparison.summary.scenariosFixed} fixed`
                : `${comparison.remainingFailures.length} remaining`}
            </span>
          )}
        </button>
      </nav>

      {/* Busy / Error / Notice Banners */}
      {busyAction && (
        <div className="banner banner--busy" role="status">
          <Cpu size={16} className="spin" />
          <span>{busyAction}</span>
        </div>
      )}

      {errorBanner && (
        <div className="banner banner--error" role="alert">
          <AlertTriangle size={16} />
          <div className="banner__text">
            <strong>{errorBanner.title}:</strong> {errorBanner.detail}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            onClick={() => setErrorBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {noticeBanner && !errorBanner && (
        <div className="banner banner--notice">
          <CheckCircle2 size={15} />
          <div className="banner__text">{noticeBanner}</div>
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            onClick={() => setNoticeBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: COMPONENT, SLOTS, ASSERTIONS & SCENARIO PACK */}
      {activeTab === 'setup' && (
        <main className="workspace-grid workspace-grid--setup">
          {/* Left Column: Fixture + HTML/CSS Editor + Baseline Preview */}
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>1A. Static Component Source</h2>
                <p>
                  Untrusted HTML/CSS is sanitized and rendered offline with scripts & external
                  network blocked.
                </p>
              </div>
              <select
                className="fixture-select"
                value={selectedFixtureId}
                onChange={(e) => handleSelectFixture(e.target.value)}
              >
                {BUNDLED_FIXTURES.map((f) => (
                  <option key={f.id} value={f.id}>
                    Preset: {f.name}
                  </option>
                ))}
                <option value="custom">Custom HTML/CSS Paste</option>
              </select>
            </div>

            <div className="editor-toolbar">
              <div className="segmented-tabs">
                <button
                  type="button"
                  className={editorPane === 'html' ? 'active' : ''}
                  onClick={() => setEditorPane('html')}
                >
                  component.html ({htmlInput.length} B)
                </button>
                <button
                  type="button"
                  className={editorPane === 'css' ? 'active' : ''}
                  onClick={() => setEditorPane('css')}
                >
                  component.css ({cssInput.length} B)
                </button>
              </div>

              <div className="editor-toolbar__right">
                {sanitizedItemCount > 0 && (
                  <span
                    className="sanitized-badge"
                    title="Active content, event handlers, or external URLs were stripped by sanitizer"
                  >
                    <ShieldAlert size={13} />
                    Stripped {sanitizedItemCount} active/external item(s)
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn--secondary btn--xs"
                  onClick={() => runAnalysis(htmlInput, cssInput)}
                >
                  <RefreshCw size={12} />
                  Re-analyze Slots
                </button>
              </div>
            </div>

            {editorPane === 'html' ? (
              <textarea
                className="code-editor"
                value={htmlInput}
                onChange={(e) => {
                  setSelectedFixtureId('custom');
                  setHtmlInput(e.target.value);
                }}
                spellCheck={false}
                aria-label="Component HTML editor"
              />
            ) : (
              <textarea
                className="code-editor"
                value={cssInput}
                onChange={(e) => {
                  setCssInput(e.target.value);
                }}
                spellCheck={false}
                aria-label="Component CSS editor"
              />
            )}

            <BaselinePreview
              sanitizedHtml={sanitizedPreview.html}
              sanitizedCss={sanitizedPreview.css}
            />
          </section>

          {/* Right Column: Slots, Assertions & Scenario Pack */}
          <section className="panel panel--scroll">
            <div className="panel__header">
              <div>
                <h2>1B. Reviewed Slots & Computed Assertions</h2>
                <p>
                  Browser measurements decide pass/fail. Model claims never mark a test as passed.
                </p>
              </div>
            </div>

            {/* Slots Table */}
            <div className="subcard">
              <div className="subcard__title">
                <span>Detected Text & Control Slots ({slots.length})</span>
                <span className="mono-muted">textContent-only mutations</span>
              </div>
              <div className="compact-table-wrap">
                <table className="compact-table">
                  <thead>
                    <tr>
                      <th>Req.</th>
                      <th>Slot ID</th>
                      <th>Role</th>
                      <th>Baseline Text</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((slot) => (
                      <tr key={slot.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={slot.required}
                            onChange={() => handleToggleSlotRequired(slot.id)}
                          />
                        </td>
                        <td className="mono-cell">{slot.id}</td>
                        <td>
                          <span className={`role-tag role-tag--${slot.role}`}>{slot.role}</span>
                        </td>
                        <td className="truncate-cell" title={slot.originalText}>
                          {slot.originalText}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Assertions List */}
            <div className="subcard">
              <div className="subcard__title">
                <span>Layout Invariants ({assertions.filter((a) => a.enabled).length} enabled)</span>
                <span className="mono-muted">Anti-evasion visibility enforced</span>
              </div>
              <div className="assertion-config-list">
                {assertions.map((rule) => (
                  <div key={rule.id} className="assertion-config-row">
                    <label className="assertion-config-main">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => handleToggleAssertion(rule.id)}
                      />
                      <div>
                        <div className="assertion-config-label">{rule.label}</div>
                        <div className="mono-muted">
                          type={rule.type} · tol={rule.tolerancePx}px
                        </div>
                      </div>
                    </label>
                    {rule.type === 'text_not_clipped' && (
                      <label
                        className="ellipsis-toggle"
                        title="Allow intentional single-line text-overflow: ellipsis on this slot"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(rule.exception?.allowEllipsis)}
                          onChange={() => handleToggleEllipsisException(rule.id)}
                        />
                        <span>Allow ellipsis</span>
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Scenario Pack Generator & Runner */}
            <div className="subcard subcard--accent">
              <div className="subcard__title">
                <span>1C. Adversarial Scenario Pack ({scenarios.length} cases)</span>
                <span className="mono-muted">
                  Source:{' '}
                  {scenarios.some((s) => s.source === 'muse_spark')
                    ? 'Muse Spark 1.3'
                    : 'Local Starter Preset'}
                </span>
              </div>

              <p className="privacy-note">
                When you click a <strong>Muse Spark 1.3</strong> action, the selected component
                HTML/CSS, slot metadata, and failure evidence are sent server-side to{' '}
                <code>https://api.meta.ai/v1</code>. Local secrets and unrelated files are never
                sent.
              </p>

              <div className="pack-actions-row">
                <button
                  type="button"
                  className="btn btn--spark"
                  disabled={Boolean(busyAction)}
                  onClick={handleGenerateSparkScenarios}
                >
                  <Sparkles size={15} />
                  <span>Generate Cases with Muse Spark 1.3</span>
                </button>

                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={Boolean(busyAction)}
                  onClick={handleLoadLocalStarterPack}
                >
                  <span>Load Deterministic Local Pack</span>
                </button>
              </div>

              <div className="scenario-preview-list">
                {scenarios.map((sc) => (
                  <div key={sc.id} className="scenario-chip-row">
                    <div>
                      <div className="scenario-chip-title">
                        <strong>{sc.name}</strong>
                        <span className="viewport-tag">
                          {sc.viewport.width}×{sc.viewport.height}
                        </span>
                        <span className="source-tag">{sc.source}</span>
                      </div>
                      <div className="scenario-chip-sub">
                        {sc.mutations.length === 0
                          ? 'Baseline sample copy (0 mutations)'
                          : sc.mutations
                              .map(
                                (m) =>
                                  `${m.slotId}: "${m.value.slice(0, 34)}${
                                    m.value.length > 34 ? '…' : ''
                                  }"`
                              )
                              .join(' · ')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="btn btn--run-hero"
                disabled={Boolean(busyAction) || scenarios.length === 0}
                onClick={handleExecuteOriginalRun}
              >
                <Play size={16} />
                <span>Run {scenarios.length} Scenarios in Real Chromium</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </main>
      )}

      {/* TAB 2: FAILURE MATRIX & REAL RENDERED EVIDENCE */}
      {activeTab === 'matrix' && originalRun && (
        <main className="workspace-stack">
          {/* Summary Strip */}
          <section className="metrics-strip">
            <div className="metric-card">
              <span className="metric-card__label">Executed Scenarios</span>
              <strong className="metric-card__val">
                {originalRun.summary.passedScenarios}/{originalRun.summary.totalScenarios} Passed
              </strong>
              <span className="metric-card__sub">
                {originalRun.summary.failedScenarios} failed · {originalRun.summary.errorScenarios}{' '}
                errors
              </span>
            </div>

            <div className="metric-card metric-card--danger">
              <span className="metric-card__label">Assertion Failures</span>
              <strong className="metric-card__val">
                {originalRun.summary.failedAssertions + originalRun.summary.errorAssertions}
              </strong>
              <span className="metric-card__sub">
                of {originalRun.summary.totalAssertions} measured checks
              </span>
            </div>

            <div className="metric-card">
              <span className="metric-card__label">Browser & Pack Lock</span>
              <strong className="metric-card__val mono-text">{originalRun.browserVersion}</strong>
              <span className="metric-card__sub mono-text">
                pack={originalRun.packHash} · {originalRun.durationMs}ms
              </span>
            </div>

            <div className="metrics-strip__cta">
              <button
                type="button"
                className="btn btn--spark"
                disabled={
                  Boolean(busyAction) ||
                  originalRun.summary.failedScenarios + originalRun.summary.errorScenarios === 0
                }
                onClick={handleProposeSparkPatch}
              >
                <Sparkles size={15} />
                <span>Ask Muse Spark 1.3 for Scoped CSS Fix</span>
              </button>

              <button
                type="button"
                className="btn btn--secondary"
                disabled={Boolean(busyAction)}
                onClick={() => handleOpenManualCandidateEditor(false)}
              >
                <Wrench size={14} />
                <span>Manual CSS Candidate</span>
              </button>
            </div>
          </section>

          <div className="workspace-grid workspace-grid--matrix">
            {/* Left: Scenario Matrix Cards */}
            <aside className="panel panel--scroll">
              <div className="panel__header">
                <div>
                  <h2>Scenario Matrix</h2>
                  <p>Select any case to inspect real Chromium geometry & failure bounds.</p>
                </div>
              </div>

              <div className="matrix-list">
                {originalRun.results.map((res) => {
                  const failCount = res.assertions.filter((a) => a.status !== 'pass').length;
                  const active = selectedScenarioResult?.scenarioId === res.scenarioId;
                  return (
                    <button
                      type="button"
                      key={res.scenarioId}
                      className={`matrix-card ${active ? 'matrix-card--active' : ''} matrix-card--${
                        res.status
                      }`}
                      onClick={() => {
                        setSelectedScenarioId(res.scenarioId);
                        setFocusedAssertionId(null);
                      }}
                    >
                      <div className="matrix-card__top">
                        <StatusBadge status={res.status} />
                        <span className="viewport-tag">
                          {res.viewport.width}×{res.viewport.height}
                        </span>
                      </div>
                      <div className="matrix-card__title">{res.scenarioName}</div>
                      <div className="matrix-card__meta">
                        <span>{res.category}</span>
                        <span>
                          {failCount > 0
                            ? `${failCount} assertion failure${failCount > 1 ? 's' : ''}`
                            : `All ${res.assertions.length} checks passed`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Right: Selected Case Capture + Geometric Overlays + Measured Assertions */}
            {selectedScenarioResult && (
              <section className="panel panel--scroll">
                <div className="panel__header">
                  <div>
                    <h2>
                      {selectedScenarioResult.scenarioName}{' '}
                      <StatusBadge status={selectedScenarioResult.status} />
                    </h2>
                    <p className="mono-muted">
                      viewport={selectedScenarioResult.viewport.width}×
                      {selectedScenarioResult.viewport.height}px · scrollWidth=
                      {selectedScenarioResult.documentMetrics?.scrollWidth ?? '—'}px · scrollHeight=
                      {selectedScenarioResult.documentMetrics?.scrollHeight ?? '—'}px
                    </p>
                  </div>

                  <label className="overlay-toggle">
                    <input
                      type="checkbox"
                      checked={showOverlays}
                      onChange={(e) => setShowOverlays(e.target.checked)}
                    />
                    <Eye size={14} />
                    <span>Show Geometric Bounds</span>
                  </label>
                </div>

                <div className="inspector-split">
                  <div className="inspector-capture-col">
                    <ScreenshotOverlay
                      result={selectedScenarioResult}
                      activeAssertionId={focusedAssertionId}
                      showOverlays={showOverlays}
                    />
                    {selectedScenarioResult.appliedMutations.length > 0 && (
                      <div className="mutations-box">
                        <div className="mono-label">Applied Adversarial Slot Mutations</div>
                        {selectedScenarioResult.appliedMutations.map((m) => (
                          <div key={m.slotId} className="mutation-item">
                            <code>{m.slotId}</code>
                            <span>→ "{m.value}"</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedScenarioResult.blockedRequests.length > 0 && (
                      <div className="blocked-box">
                        <ShieldAlert size={14} />
                        <span>
                          Blocked {selectedScenarioResult.blockedRequests.length} external network
                          URL(s) during isolated render.
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="inspector-assertions-col">
                    <div className="subcard__title">
                      <span>Evaluated Assertions ({selectedScenarioResult.assertions.length})</span>
                      {focusedAssertionId && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--xs"
                          onClick={() => setFocusedAssertionId(null)}
                        >
                          Show all failing overlays
                        </button>
                      )}
                    </div>

                    <div className="evaluated-assertion-list">
                      {[...selectedScenarioResult.assertions]
                        .sort((a, b) => (a.status === 'pass' ? 1 : 0) - (b.status === 'pass' ? 1 : 0))
                        .map((a) => {
                          const isFocused = focusedAssertionId === a.assertionId;
                          return (
                            <div
                              key={a.assertionId}
                              className={`eval-card eval-card--${a.status} ${
                                isFocused ? 'eval-card--focused' : ''
                              }`}
                              onClick={() =>
                                setFocusedAssertionId(isFocused ? null : a.assertionId)
                              }
                            >
                              <div className="eval-card__head">
                                <StatusBadge status={a.status} />
                                <strong>{a.assertionLabel}</strong>
                              </div>
                              <p className="eval-card__summary">{a.summary}</p>
                              <div className="eval-card__metrics mono-muted">
                                {a.measurements.overflowPx !== undefined && (
                                  <span>overflow={a.measurements.overflowPx}px </span>
                                )}
                                {a.measurements.horizontalClipPx ? (
                                  <span>hClip={a.measurements.horizontalClipPx}px </span>
                                ) : null}
                                {a.measurements.verticalClipPx ? (
                                  <span>vClip={a.measurements.verticalClipPx}px </span>
                                ) : null}
                                {a.measurements.targetRect && (
                                  <span>
                                    rect=[{Math.round(a.measurements.targetRect.x)},
                                    {Math.round(a.measurements.targetRect.y)}{' '}
                                    {Math.round(a.measurements.targetRect.width)}×
                                    {Math.round(a.measurements.targetRect.height)}]
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </main>
      )}

      {/* TAB 3: CANDIDATE CSS PATCH & UNIFIED DIFF */}
      {activeTab === 'candidate' && originalRun && (
        <main className="workspace-grid workspace-grid--setup">
          <section className="panel panel--scroll">
            <div className="panel__header">
              <div>
                <h2>3A. Scoped CSS Candidate</h2>
                <p>
                  HTML and scenario pack remain locked (`pack={originalRun.packHash}`). Only CSS
                  may change.
                </p>
              </div>
              <div className="row-gap-sm">
                <button
                  type="button"
                  className="btn btn--spark btn--xs"
                  disabled={Boolean(busyAction)}
                  onClick={handleProposeSparkPatch}
                >
                  <Sparkles size={13} />
                  <span>Ask Muse Spark 1.3</span>
                </button>
                {currentFixtureHasReferenceFix && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--xs"
                    disabled={Boolean(busyAction)}
                    onClick={() => handleOpenManualCandidateEditor(true)}
                    title="Loads the local verification fixture CSS (clearly labeled non-AI) to test the Chromium replay engine"
                  >
                    <span>Load Local Verification Fix (Non-AI)</span>
                  </button>
                )}
              </div>
            </div>

            {candidate && (
              <div className="subcard">
                <div className="subcard__title">
                  <span>
                    Candidate Attribution:{' '}
                    <strong>
                      {isDraftModifiedFromSpark
                        ? 'muse_spark_modified (edited manually after Spark proposal)'
                        : candidate.source}
                    </strong>
                  </span>
                  {candidate.receipt && !isDraftModifiedFromSpark && (
                    <span className="mono-muted">
                      Direct Receipt {candidate.receipt.responseId} ·{' '}
                      {candidate.receipt.imagesAttached} PNG(s) sent
                    </span>
                  )}
                  {(isDraftModifiedFromSpark || candidate.source === 'muse_spark_modified') &&
                    (candidate.originReceipt || candidate.receipt) && (
                      <span className="mono-muted">
                        Origin Receipt {(candidate.originReceipt || candidate.receipt)?.responseId}{' '}
                        (starting point only)
                      </span>
                    )}
                </div>
                {isDraftModifiedFromSpark && candidate.sparkGeneratedCss && (
                  <div className="blocked-box">
                    <AlertTriangle size={14} />
                    <span style={{ flex: 1 }}>
                      CSS differs from Muse Spark&apos;s exact output (hash{' '}
                      <code>{candidate.sparkGeneratedCssHash}</code>). Retest will record{' '}
                      <code>muse_spark_modified</code> rather than direct AI output.
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--xs"
                      onClick={handleRestoreExactSparkCss}
                    >
                      Restore Exact Spark CSS
                    </button>
                  </div>
                )}
                <p className="rationale-copy">{candidate.rationale}</p>
                {candidate.targetedFailures.length > 0 && (
                  <ul className="targeted-list">
                    {candidate.targetedFailures.map((tf, idx) => (
                      <li key={idx}>{tf}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="editor-toolbar">
              <span className="mono-label">Editable Candidate CSS (component.candidate.css)</span>
              <span className="mono-muted">{candidateCssDraft.length} B</span>
            </div>
            <textarea
              className="code-editor code-editor--tall"
              value={candidateCssDraft}
              onChange={(e) => handleUpdateManualDiff(e.target.value)}
              spellCheck={false}
              aria-label="Candidate CSS editor"
            />

            <div className="locked-pack-banner">
              <Lock size={15} />
              <div>
                <strong>Identical Replay Guarantee:</strong> Replaying executes all{' '}
                {originalRun.scenarios.length} scenarios and {originalRun.assertions.length} active
                assertions from run <code>{originalRun.runId}</code>. Hiding required slots or CTAs
                fails verification.
              </div>
            </div>

            <button
              type="button"
              className="btn btn--run-hero"
              disabled={Boolean(busyAction) || !candidateCssDraft.trim()}
              onClick={handleReplayCandidatePack}
            >
              <Play size={16} />
              <span>Replay Exact Scenario Pack in Chromium</span>
              <ArrowRight size={16} />
            </button>
          </section>

          <section className="panel panel--scroll">
            <div className="panel__header">
              <div>
                <h2>3B. Computed Unified CSS Diff</h2>
                <p>Exact line-by-line diff against original CSS.</p>
              </div>
            </div>
            {candidateDiffDraft ? (
              <CssDiffViewer unifiedDiff={candidateDiffDraft} />
            ) : (
              <div className="empty-capture">
                Generate a Muse Spark CSS patch or edit the candidate stylesheet on the left to
                compute the unified diff.
              </div>
            )}
          </section>
        </main>
      )}

      {/* TAB 4: BEFORE / AFTER PROOF & REPRODUCIBLE EXPORT */}
      {activeTab === 'proof' && originalRun && candidateRun && comparison && (
        <main className="workspace-stack">
          <section className="metrics-strip">
            <div className="metric-card metric-card--success">
              <span className="metric-card__label">Scenario Replay Delta</span>
              <strong className="metric-card__val">
                {originalRun.summary.passedScenarios}/{originalRun.summary.totalScenarios} →{' '}
                {candidateRun.summary.passedScenarios}/{candidateRun.summary.totalScenarios} Passed
              </strong>
              <span className="metric-card__sub">
                +{comparison.summary.scenariosFixed} fixed · {comparison.summary.scenariosRegressed}{' '}
                regressed
              </span>
            </div>

            <div
              className={`metric-card ${
                comparison.remainingFailures.length === 0
                  ? 'metric-card--success'
                  : 'metric-card--danger'
              }`}
            >
              <span className="metric-card__label">Remaining Assertion Failures</span>
              <strong className="metric-card__val">{comparison.remainingFailures.length}</strong>
              <span className="metric-card__sub">
                +{comparison.summary.assertionsFixed} assertions fixed across pack
              </span>
            </div>

            <div className="metric-card">
              <span className="metric-card__label">Identical Pack Proof</span>
              <strong className="metric-card__val mono-text">
                {comparison.packMatchesExactly ? 'HASH VERIFIED' : 'MISMATCH'}
              </strong>
              <span className="metric-card__sub mono-text">pack={comparison.packHash}</span>
            </div>

            <div className="metrics-strip__cta">
              <button
                type="button"
                className="btn btn--primary"
                disabled={Boolean(busyAction)}
                onClick={handleExportBundle}
              >
                <Download size={15} />
                <span>Download Evidence + Patch + Repro (.zip)</span>
              </button>
            </div>
          </section>

          {comparison.remainingFailures.length > 0 && (
            <section className="remaining-failures-box">
              <div className="remaining-failures-box__head">
                <AlertTriangle size={16} />
                <strong>
                  {comparison.remainingFailures.length} Remaining Failure(s) Detected by Chromium —
                  Not Hidden
                </strong>
              </div>
              <ul>
                {comparison.remainingFailures.slice(0, 6).map((rf, i) => (
                  <li key={i}>
                    <code>{rf.scenarioName}</code> — <strong>{rf.assertionLabel}:</strong>{' '}
                    {rf.summary}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="workspace-grid workspace-grid--matrix">
            <aside className="panel panel--scroll">
              <div className="panel__header">
                <div>
                  <h2>Before / After Cases</h2>
                  <p>Identical scenarios replayed in {candidateRun.browserVersion}.</p>
                </div>
              </div>

              <div className="matrix-list">
                {comparison.items.map((item) => {
                  const active = selectedProofItem?.scenarioId === item.scenarioId;
                  return (
                    <button
                      type="button"
                      key={item.scenarioId}
                      className={`matrix-card ${active ? 'matrix-card--active' : ''}`}
                      onClick={() => setSelectedProofScenarioId(item.scenarioId)}
                    >
                      <div className="matrix-card__top">
                        <span className="transition-badges">
                          <StatusBadge status={item.beforeStatus} />
                          <span>→</span>
                          <StatusBadge status={item.afterStatus} />
                        </span>
                        <span className="viewport-tag">
                          {item.viewport.width}×{item.viewport.height}
                        </span>
                      </div>
                      <div className="matrix-card__title">{item.scenarioName}</div>
                      <div className="matrix-card__meta">
                        <span className={`outcome-label outcome-label--${item.outcome}`}>
                          {item.outcome.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {selectedProofItem && proofBeforeResult && proofAfterResult && (
              <section className="panel panel--scroll">
                <div className="panel__header">
                  <div>
                    <h2>{selectedProofItem.scenarioName} — Side-by-Side Proof</h2>
                    <p>
                      Viewport {selectedProofItem.viewport.width}×
                      {selectedProofItem.viewport.height}px · Scope notice: verifies declared layout
                      bounds only (not full accessibility or app logic).
                    </p>
                  </div>
                  <label className="overlay-toggle">
                    <input
                      type="checkbox"
                      checked={showOverlays}
                      onChange={(e) => setShowOverlays(e.target.checked)}
                    />
                    <Eye size={14} />
                    <span>Show Overlays</span>
                  </label>
                </div>

                <div className="before-after-grid">
                  <div className="compare-col">
                    <div className="compare-col__head">
                      <span>Original CSS (Before)</span>
                      <StatusBadge status={proofBeforeResult.status} />
                    </div>
                    <ScreenshotOverlay
                      result={proofBeforeResult}
                      showOverlays={showOverlays}
                      compact
                    />
                    <div className="mono-muted">
                      scrollWidth: {proofBeforeResult.documentMetrics?.scrollWidth}px
                    </div>
                  </div>

                  <div className="compare-col">
                    <div className="compare-col__head">
                      <span>Candidate CSS (After)</span>
                      <StatusBadge status={proofAfterResult.status} />
                    </div>
                    <ScreenshotOverlay
                      result={proofAfterResult}
                      showOverlays={showOverlays}
                      compact
                    />
                    <div className="mono-muted">
                      scrollWidth: {proofAfterResult.documentMetrics?.scrollWidth}px
                    </div>
                  </div>
                </div>

                <div className="subcard">
                  <div className="subcard__title">
                    <span>Assertion-by-Assertion Measured Deltas</span>
                  </div>
                  <div className="evaluated-assertion-list">
                    {selectedProofItem.assertionDeltas.map((d) => (
                      <div key={d.assertionId} className={`eval-card eval-card--${d.afterStatus}`}>
                        <div className="eval-card__head">
                          <StatusBadge status={d.beforeStatus} />
                          <span>→</span>
                          <StatusBadge status={d.afterStatus} />
                          <strong>{d.assertionLabel}</strong>
                        </div>
                        <p className="eval-card__summary">
                          <strong>Before:</strong> {d.beforeSummary}
                        </p>
                        <p className="eval-card__summary">
                          <strong>After:</strong> {d.afterSummary}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {candidate && (
                  <div className="subcard">
                    <div className="subcard__title">
                      <span>Applied CSS Patch Diff (attribution: {candidate.source})</span>
                      <span className="mono-muted">
                        {candidate.receipt
                          ? `Direct Receipt: ${candidate.receipt.responseId} (hash=${candidate.candidateCssHash})`
                          : candidate.originReceipt
                            ? `Edited after Spark ${candidate.originReceipt.responseId} (sparkHash=${candidate.sparkGeneratedCssHash} → finalHash=${candidate.candidateCssHash})`
                            : `hash=${candidate.candidateCssHash}`}
                      </span>
                    </div>
                    <CssDiffViewer unifiedDiff={candidate.unifiedDiff} />
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
      )}

      {/* Model Receipts Modal */}
      {showReceiptsModal && (
        <div className="modal-backdrop" onClick={() => setShowReceiptsModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-card__head">
              <h3>Meta Model API Call Receipts (Secret-Free)</h3>
              <button
                type="button"
                className="btn btn--ghost btn--xs"
                onClick={() => setShowReceiptsModal(false)}
              >
                Close
              </button>
            </div>
            {receipts.length === 0 ? (
              <p className="mono-muted">
                No live Meta Model API calls recorded in this workspace yet. Configure{' '}
                <code>MODEL_API_KEY</code> in <code>.env.local</code> and run a Muse Spark 1.3
                action.
              </p>
            ) : (
              <div className="receipts-list">
                {receipts.map((r) => (
                  <div key={r.receiptId} className="receipt-item">
                    <div className="receipt-item__row">
                      <strong>{r.operation}</strong>
                      <span className="mono-muted">{r.timestamp}</span>
                    </div>
                    <div className="mono-muted">
                      model={r.respondedModel} · id={r.responseId} · reasoning={r.reasoningEffort} ·{' '}
                      duration={r.durationMs}ms · images={r.imagesAttached}
                    </div>
                    {r.usage && (
                      <div className="mono-muted">
                        tokens: prompt={r.usage.promptTokens ?? '—'}, completion=
                        {r.usage.completionTokens ?? '—'}, total={r.usage.totalTokens ?? '—'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
