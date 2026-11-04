import type {
  ApiHealthStatus,
  AssertionRule,
  CandidatePatch,
  InteractiveTarget,
  ModelReceipt,
  RunComparison,
  SanitizationReport,
  StressRun,
  StressScenario,
  TextSlot,
} from './shared/types';

export interface AnalyzeResponse {
  sanitizedHtml: string;
  instrumentedHtml: string;
  sanitizedCss: string;
  rootTargetId: string;
  slots: TextSlot[];
  interactiveTargets: InteractiveTarget[];
  suggestedAssertions: AssertionRule[];
  sanitization: SanitizationReport;
}

export class ClientApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.method === 'POST' ? { Prefer: 'respond-async' } : {}),
      ...(init?.headers || {}),
    },
  });

  let data = await res.json().catch(() => ({}));
  if (res.status === 202 && data.jobId) {
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const poll = await fetch(`/api/jobs/${encodeURIComponent(data.jobId)}`, { cache: 'no-store' });
      const job = await poll.json().catch(() => ({}));
      if (!poll.ok) throw new ClientApiError(job.error || 'Operation status unavailable', job.code, poll.status);
      if (job.state !== 'complete') continue;
      if (job.statusCode >= 400) throw new ClientApiError(job.payload?.error || 'Operation failed', job.payload?.code, job.statusCode);
      return job.payload as T;
    }
    throw new ClientApiError('Operation is taking too long. No automatic retry was made; check server status before trying again.');
  }
  if (!res.ok) {
    throw new ClientApiError(
      data?.error || `Request failed with HTTP ${res.status}`,
      data?.code,
      res.status
    );
  }
  return data as T;
}

export const api = {
  getHealth(): Promise<ApiHealthStatus & { recentReceiptsCount: number }> {
    return requestJson('/api/health');
  },

  getReceipts(): Promise<{ receipts: ModelReceipt[] }> {
    return requestJson('/api/receipts');
  },

  analyzeComponent(html: string, css: string): Promise<AnalyzeResponse> {
    return requestJson('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ html, css }),
    });
  },

  generateSparkScenarios(params: {
    html: string;
    css: string;
    slots: TextSlot[];
    assertions: AssertionRule[];
  }): Promise<{ scenarios: StressScenario[]; receipt: ModelReceipt }> {
    return requestJson('/api/spark/scenarios', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  executeRun(params: {
    componentName: string;
    html: string;
    css: string;
    slots: TextSlot[];
    assertions: AssertionRule[];
    scenarios: StressScenario[];
  }): Promise<{ run: StressRun }> {
    return requestJson('/api/runs', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  proposeSparkPatch(runId: string): Promise<{ candidate: CandidatePatch }> {
    return requestJson('/api/spark/patch', {
      method: 'POST',
      body: JSON.stringify({ runId }),
    });
  },

  computeDiff(
    runId: string,
    patchedCss: string
  ): Promise<{ sanitizedCss: string; unifiedDiff: string; sanitization: SanitizationReport }> {
    return requestJson(`/api/runs/${encodeURIComponent(runId)}/diff`, {
      method: 'POST',
      body: JSON.stringify({ patchedCss }),
    });
  },

  retestCandidate(
    runId: string,
    params: {
      candidateId?: string;
      patchedCss: string;
      rationale?: string;
      targetedFailures?: string[];
      source?: 'manual_edit' | 'fixture_reference';
    }
  ): Promise<{
    candidate: CandidatePatch;
    candidateRun: StressRun;
    comparison: RunComparison;
  }> {
    return requestJson(`/api/runs/${encodeURIComponent(runId)}/retest`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async downloadExportZip(params: {
    originalRunId: string;
    candidateId?: string;
    candidateRunId?: string;
  }): Promise<void> {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ClientApiError(
        errBody?.error || `Export failed with HTTP ${res.status}`,
        errBody?.code,
        res.status
      );
    }
    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `break-it-evidence-${params.originalRunId}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(downloadUrl);
  },
};
