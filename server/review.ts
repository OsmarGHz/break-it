import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import JSZip from 'jszip';
import type { ModelReceipt, StressRun } from '../src/shared/types.js';
import { compareStressRuns } from './comparison.js';

// A public viewer for one already-public evidence archive. No model or renderer
// imports, credentials, arbitrary paths, uploads, or mutation endpoints.
export function createReviewRouter(projectRoot: string) {
  const router = express.Router();
  const archivePath = path.join(projectRoot, 'demo/heroku-evidence.zip');
  let proof: Promise<{ zip: JSZip; data: unknown }> | undefined;
  const loadProof = () => {
    if (!proof) proof = (async () => {
      const zip = await JSZip.loadAsync(await fs.readFile(archivePath));
      const read = async <T,>(name: string): Promise<T> => {
        const file = zip.file(name);
        if (!file) throw new Error('Incomplete recorded evidence');
        return JSON.parse(await file.async('string')) as T;
      };
      const original = await read<StressRun>('evidence/original-run.json');
      const candidate = await read<StressRun>('evidence/candidate-run.json');
      const comparison = compareStressRuns(original, candidate);
      const receipts = await read<ModelReceipt[]>('evidence/model-receipts.json');
      const diff = await zip.file('component/patch.diff')?.async('string');
      if (!diff) throw new Error('Missing recorded CSS diff');
      return { zip, data: {
        recorded: true, componentName: original.componentName,
        completedAt: candidate.completedAt, browser: original.browserVersion,
        packHash: comparison.packHash, packMatchesExactly: comparison.packMatchesExactly,
        before: original.summary, after: candidate.summary, comparison: comparison.summary,
        cases: comparison.items.map(item => ({
          id: item.scenarioId, name: item.scenarioName, viewport: item.viewport,
          beforeStatus: item.beforeStatus, afterStatus: item.afterStatus,
          outcome: item.outcome, assertions: item.assertionDeltas,
          beforeImage: `/review/screenshots/original/${encodeURIComponent(item.scenarioId)}.png`,
          afterImage: `/review/screenshots/candidate/${encodeURIComponent(item.scenarioId)}.png`,
        })), receipts, diff,
      } };
    })();
    return proof;
  };
  router.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    next();
  });
  const publicFiles: Record<string, string> = {
    '/': 'review/index.html', '/ui.css': 'review/review.css', '/ui.js': 'review/review.js',
    '/demo.mp4': 'demo/BREAK-IT-demo.mp4', '/preview.png': 'demo/preview.png',
  };
  for (const [route, file] of Object.entries(publicFiles)) {
    router.get(route, (_req, res) => res.sendFile(path.join(projectRoot, file)));
  }
  router.get('/evidence.zip', (_req, res) => res.download(archivePath, 'BREAK-IT-verified-evidence.zip'));
  router.get('/data.json', async (_req, res) => {
    try { res.json((await loadProof()).data); }
    catch { res.status(503).json({ error: 'Recorded evidence is unavailable. No fresh model call was made.' }); }
  });
  router.get('/screenshots/:target/:file', async (req, res) => {
    const { target, file } = req.params;
    if (!['original', 'candidate'].includes(target) || !/^[a-zA-Z0-9_-]+\.png$/.test(file)) {
      res.status(404).end(); return;
    }
    try {
      const entry = (await loadProof()).zip.file(`evidence/screenshots/${target}/${file}`);
      if (!entry) { res.status(404).end(); return; }
      res.type('png').send(await entry.async('nodebuffer'));
    } catch { res.status(503).end(); }
  });
  router.use((_req, res) => res.status(404).send('Public review resource not found.'));
  return router;
}
