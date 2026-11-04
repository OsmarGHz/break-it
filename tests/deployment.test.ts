import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { createDeferredJobs } from '../server/jobs.js';
import { createApp } from '../server/app.js';
import { getServerConfig } from '../server/config.js';

const servers: http.Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
async function listen(app: express.Express) {
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
it('returns a job before long work finishes, rejects overlapping work, and preserves result and error status', async () => {
  const app = express();
  const { defer, status } = createDeferredJobs(text => text.replace('test-secret', '[redacted]'));
  let release!: () => void;
  app.get('/api/jobs/:jobId', status);
  app.post('/slow', defer(async (_req, res) => {
    await new Promise<void>(resolve => { release = resolve; });
    res.json({ proof: 'real result' });
  }));
  app.post('/error', defer((_req, _res, next) => {
    next(Object.assign(new Error('provider rejected test-secret'), { statusCode: 502, code: 'UPSTREAM' }));
  }));
  const base = await listen(app);
  const first = await fetch(`${base}/slow`, { method: 'POST', headers: { Prefer: 'respond-async' } });
  expect(first.status).toBe(202);
  const { jobId } = await first.json();
  expect((await (await fetch(`${base}/api/jobs/${jobId}`)).json()).state).toBe('running');
  expect((await fetch(`${base}/slow`, { method: 'POST', headers: { Prefer: 'respond-async' } })).status).toBe(429);
  release();
  await new Promise(resolve => setTimeout(resolve, 5));
  const done = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
  expect(done).toMatchObject({ state: 'complete', statusCode: 200, payload: { proof: 'real result' } });
  const failed = await (await fetch(`${base}/error`, { method: 'POST', headers: { Prefer: 'respond-async' } })).json();
  const error = await (await fetch(`${base}/api/jobs/${failed.jobId}`)).json();
  expect(error).toMatchObject({ state: 'complete', statusCode: 502, payload: { code: 'UPSTREAM', error: 'provider rejected [redacted]' } });
  expect((await fetch(`${base}/api/jobs/unknown`)).status).toBe(404);
});
it('protects UI, artifacts, API writes and job results while permitting health checks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'break-it-auth-')); roots.push(root);
  vi.stubEnv('DEMO_PASSWORD', 'test-review-password');
  const base = await listen(createApp({ customRoot: root }));
  expect((await fetch(`${base}/api/health`)).status).toBe(200);
  for (const route of ['/', '/artifacts/receipts.json', '/api/receipts', '/api/jobs/known-id']) {
    expect((await fetch(base + route)).status).toBe(401);
  }
  expect((await fetch(`${base}/api/spark/scenarios`, { method: 'POST' })).status).toBe(401);
  const allowed = await fetch(`${base}/api/receipts`, {
    headers: { Authorization: `Basic ${Buffer.from('judge:test-review-password').toString('base64')}` },
  });
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toEqual({ receipts: [] });
});
it('honors the platform port and refuses an unprotected Heroku deployment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'break-it-platform-')); roots.push(root);
  vi.stubEnv('DYNO', 'web.1'); vi.stubEnv('PORT', '18347'); vi.stubEnv('DEMO_PASSWORD', '');
  expect(getServerConfig(root)).toMatchObject({ port: 18347, host: '0.0.0.0' });
  expect(() => createApp({ customRoot: root })).toThrow('Set DEMO_PASSWORD');
});
