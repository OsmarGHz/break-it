export type SlotRole = 'heading' | 'text' | 'badge' | 'price' | 'cta' | 'meta' | 'code';

export interface TextSlot {
  id: string;
  label: string;
  tagName: string;
  role: SlotRole;
  originalText: string;
  required: boolean;
  selectorHint: string;
}

export interface InteractiveTarget {
  id: string;
  label: string;
  tagName: string;
  text: string;
}

export type AssertionType =
  | 'no_viewport_overflow'
  | 'cta_visible_in_bounds'
  | 'text_not_clipped'
  | 'controls_separated';

export interface AssertionException {
  allowEllipsis?: boolean;
  allowOverlap?: boolean;
  notes?: string;
}

export interface AssertionRule {
  id: string;
  type: AssertionType;
  label: string;
  enabled: boolean;
  tolerancePx: number;
  targetId?: string;
  containerId?: string;
  secondaryTargetId?: string;
  minGapPx?: number;
  exception?: AssertionException;
}

export interface ComponentSpec {
  id: string;
  name: string;
  description?: string;
  html: string;
  css: string;
  instrumentedHtml: string;
  rootTargetId: string;
  slots: TextSlot[];
  interactiveTargets: InteractiveTarget[];
}

export type ScenarioCategory =
  | 'baseline'
  | 'long_name'
  | 'unbroken_token'
  | 'multilingual'
  | 'narrow_viewport'
  | 'combined_stress';

export type ScenarioSource = 'baseline' | 'muse_spark' | 'local_preset' | 'user';

export interface SlotMutation {
  slotId: string;
  value: string;
}

export interface ViewportSpec {
  width: number;
  height: number;
  label?: string;
}

export interface StressScenario {
  id: string;
  name: string;
  category: ScenarioCategory;
  viewport: ViewportSpec;
  mutations: SlotMutation[];
  rationale: string;
  source: ScenarioSource;
}

export type VerificationStatus = 'pass' | 'fail' | 'inconclusive' | 'error';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface HighlightBox {
  label: string;
  role: 'target' | 'container' | 'overflow' | 'clip' | 'secondary';
  rect: BoundingBox;
}

export interface AssertionMeasurements {
  viewportWidth?: number;
  viewportHeight?: number;
  scrollWidth?: number;
  scrollHeight?: number;
  overflowPx?: number;
  horizontalClipPx?: number;
  verticalClipPx?: number;
  gapPx?: number;
  targetRect?: BoundingBox | null;
  containerRect?: BoundingBox | null;
  secondaryRect?: BoundingBox | null;
  textRangeRect?: BoundingBox | null;
  clippingAncestorTag?: string | null;
  clippingAncestorRect?: BoundingBox | null;
  computedDisplay?: string;
  computedVisibility?: string;
  computedOpacity?: number;
  computedFontSizePx?: number;
  computedOverflowX?: string;
  computedOverflowY?: string;
  computedTextOverflow?: string;
  renderedTextLength?: number;
  expectedTextLength?: number;
  occludedByTag?: string | null;
}

export interface AssertionResult {
  assertionId: string;
  assertionLabel: string;
  assertionType: AssertionType;
  targetId?: string;
  status: VerificationStatus;
  summary: string;
  measurements: AssertionMeasurements;
  highlightBoxes: HighlightBox[];
}

export interface SanitizationReport {
  strippedTags: string[];
  strippedAttributes: string[];
  strippedExternalUrls: string[];
  strippedCssConstructs: string[];
  warnings: string[];
}

export interface ScenarioRunResult {
  scenarioId: string;
  scenarioName: string;
  category: ScenarioCategory;
  status: VerificationStatus;
  durationMs: number;
  screenshotUrl: string | null;
  screenshotPath: string | null;
  viewport: ViewportSpec;
  appliedMutations: SlotMutation[];
  documentMetrics: {
    scrollWidth: number;
    scrollHeight: number;
    viewportWidth: number;
    viewportHeight: number;
  } | null;
  elementBoxes: Record<string, BoundingBox>;
  assertions: AssertionResult[];
  blockedRequests: string[];
  renderError?: string;
}

export interface RunSummaryCounts {
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  inconclusiveScenarios: number;
  errorScenarios: number;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
  inconclusiveAssertions: number;
  errorAssertions: number;
}

export interface StressRun {
  runId: string;
  role: 'original' | 'candidate';
  componentName: string;
  componentHash: string;
  packHash: string;
  cssHash: string;
  browserVersion: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  html: string;
  instrumentedHtml: string;
  css: string;
  rootTargetId: string;
  slots: TextSlot[];
  assertions: AssertionRule[];
  scenarios: StressScenario[];
  sanitization: SanitizationReport;
  summary: RunSummaryCounts;
  results: ScenarioRunResult[];
  candidateId?: string;
}

export interface ModelReceipt {
  receiptId: string;
  operation: 'generate_scenarios' | 'propose_css_patch';
  provider: 'meta_model_api';
  endpoint: string;
  requestedModel: string;
  respondedModel: string;
  responseId: string;
  timestamp: string;
  durationMs: number;
  reasoningEffort: string;
  imagesAttached: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
}

export type CandidateSource =
  | 'muse_spark'
  | 'muse_spark_modified'
  | 'manual_edit'
  | 'fixture_reference';

export interface CandidatePatch {
  candidateId: string;
  basedOnRunId: string;
  originalCssHash: string;
  candidateCssHash: string;
  patchedCss: string;
  unifiedDiff: string;
  rationale: string;
  targetedFailures: string[];
  source: CandidateSource;
  createdAt: string;
  /** Immutable CSS string and hash originally returned by Muse Spark before any user edits */
  sparkGeneratedCss?: string;
  sparkGeneratedCssHash?: string;
  /** Direct model receipt ONLY when patchedCss matches sparkGeneratedCss verbatim */
  receipt?: ModelReceipt;
  /** Starting-point provenance receipt preserved when a Muse Spark patch was later edited manually */
  originReceipt?: ModelReceipt;
}

export type DeltaOutcome =
  | 'fixed'
  | 'regressed'
  | 'still_failing'
  | 'still_passing'
  | 'inconclusive_or_error';

export interface AssertionDelta {
  assertionId: string;
  assertionLabel: string;
  assertionType: AssertionType;
  beforeStatus: VerificationStatus;
  afterStatus: VerificationStatus;
  outcome: DeltaOutcome;
  beforeSummary: string;
  afterSummary: string;
}

export interface ScenarioComparisonItem {
  scenarioId: string;
  scenarioName: string;
  category: ScenarioCategory;
  viewport: ViewportSpec;
  beforeStatus: VerificationStatus;
  afterStatus: VerificationStatus;
  outcome: DeltaOutcome;
  beforeScreenshotUrl: string | null;
  afterScreenshotUrl: string | null;
  assertionDeltas: AssertionDelta[];
}

export interface RunComparison {
  originalRunId: string;
  candidateRunId: string;
  packHash: string;
  packMatchesExactly: boolean;
  summary: {
    scenariosFixed: number;
    scenariosRegressed: number;
    scenariosStillFailing: number;
    scenariosStillPassing: number;
    scenariosInconclusiveOrError: number;
    assertionsFixed: number;
    assertionsRegressed: number;
    assertionsStillFailing: number;
    assertionsStillPassing: number;
  };
  items: ScenarioComparisonItem[];
  remainingFailures: Array<{
    scenarioId: string;
    scenarioName: string;
    assertionId: string;
    assertionLabel: string;
    afterStatus: VerificationStatus;
    summary: string;
  }>;
}

export interface ApiHealthStatus {
  ok: boolean;
  metaConfigured: boolean;
  metaBaseUrl: string;
  metaSparkModel: string;
  keySource: '.env.local' | 'process.env' | 'missing';
}

