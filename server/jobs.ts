import crypto from 'node:crypto';
import type { RequestHandler, Response } from 'express';

interface Job {
  createdAt: number;
  state: 'running' | 'complete';
  statusCode: number;
  payload?: unknown;
}

// Single-dyno demo queue. Results are transient and disappear on restart.
export function createDeferredJobs(redact: (text: string) => string) {
  const jobs = new Map<string, Job>();
  const prune = () => {
    for (const [id, job] of jobs) {
      if (Date.now() - job.createdAt > 15 * 60_000) jobs.delete(id);
    }
  };
  const status: RequestHandler = (req, res) => {
    prune();
    const job = jobs.get(req.params.jobId);
    res.setHeader('Cache-Control', 'no-store');
    if (!job) { res.status(404).json({ error: 'Operation expired or server restarted. No automatic retry was made.' }); return; }
    res.json(job);
  };
  const defer = (handler: RequestHandler): RequestHandler => (req, res, next) => {
    if (req.get('Prefer') !== 'respond-async') return handler(req, res, next);
    prune();
    if ([...jobs.values()].some(job => job.state === 'running')) {
      res.status(429).json({ error: 'Another operation is running. Wait for it to finish before retrying.' });
      return;
    }
    while (jobs.size >= 32) jobs.delete(jobs.keys().next().value!);
    const id = crypto.randomUUID();
    const job: Job = { createdAt: Date.now(), state: 'running', statusCode: 200 };
    jobs.set(id, job);
    res.status(202).json({ jobId: id });
    const captured = {
      status(code: number) { job.statusCode = code; return captured; },
      json(payload: unknown) { job.payload = payload; job.state = 'complete'; return captured; },
    };
    const fail = (error?: unknown) => {
      const err = error as { message?: string; statusCode?: number; code?: string } | undefined;
      job.statusCode = err?.statusCode || 400;
      job.payload = { error: redact(err?.message || 'Operation failed'), code: err?.code || 'OPERATION_FAILED' };
      job.state = 'complete';
    };
    Promise.resolve().then(() => handler(req, captured as Response, fail)).catch(fail);
  };
  return { defer, status };
}
