import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type {
  AssertionRule,
  CandidatePatch,
  ModelReceipt,
  RunComparison,
  StressRun,
  StressScenario,
  TextSlot,
} from '../src/shared/types.js';
import { getPublicHealthStatus, getServerConfig, redactSecrets } from './config.js';
import { analyzeAndSanitizeComponent, MAX_CSS_BYTES, MAX_HTML_BYTES, sanitizeCssInput } from './sanitizer.js';
import { executeStressRun } from './renderer.js';
import {
  generateScenariosWithSpark,
  proposeCssPatchWithSpark,
  SparkApiError,
} from './spark.js';
import { compareStressRuns, computeUnifiedCssDiff } from './comparison.js';
import { computeCssHash } from './hashing.js';
import { createDeferredJobs } from './jobs.js';
import { buildReproducibleZipBundle } from './exporter.js';

const SlotSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
  tagName: z.string().min(1).max(32),
  role: z.enum(['heading', 'text', 'badge', 'price', 'cta', 'meta', 'code']),
  originalText: z.string().max(1000),
  required: z.boolean(),
  selectorHint: z.string().max(120),
});

const AssertionSchema = z.object({
  id: z.string().min(1).max(96),
  type: z.enum([
    'no_viewport_overflow',
    'cta_visible_in_bounds',
    'text_not_clipped',
    'controls_separated',
  ]),
  label: z.string().min(1).max(200),
  enabled: z.boolean(),
  tolerancePx: z.number().min(0).max(32),
  targetId: z.string().max(64).optional(),
  containerId: z.string().max(64).optional(),
  secondaryTargetId: z.string().max(64).optional(),
  minGapPx: z.number().min(0).max(64).optional(),
  exception: z
    .object({
      allowEllipsis: z.boolean().optional(),
      allowOverlap: z.boolean().optional(),
      notes: z.string().max(240).optional(),
    })
    .optional(),
});

const ScenarioSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(140),
  category: z.enum([
    'baseline',
    'long_name',
    'unbroken_token',
    'multilingual',
    'narrow_viewport',
    'combined_stress',
  ]),
  viewport: z.object({
    width: z.number().int().min(240).max(1600),
    height: z.number().int().min(320).max(1600),
    label: z.string().max(80).optional(),
  }),
  mutations: z
    .array(
      z.object({
        slotId: z.string().min(1).max(64),
        value: z.string().min(1).max(400),
      })
    )
    .max(20),
  rationale: z.string().max(500),
  source: z.enum(['baseline', 'muse_spark', 'local_preset', 'user']),
});

export interface CreateAppOptions {
  customRoot?: string;
  fetchImpl?: typeof fetch;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  const demoPassword = getServerConfig(options.customRoot).demoPassword;
  if (process.env.DYNO && !demoPassword) {
    throw new Error('Set DEMO_PASSWORD before starting a hosted demo.');
  }
  app.use((req, res, next) => {
    if (!demoPassword || req.path === '/api/health') return next();
    const expected = Buffer.from(`judge:${demoPassword}`);
    const auth = req.get('Authorization') || '';
    const received = Buffer.from(auth.startsWith('Basic ') ? auth.slice(6) : '', 'base64');
    if (received.length === expected.length && crypto.timingSafeEqual(received, expected)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="BREAK IT demo", charset="UTF-8"');
    res.status(401).send('Demo access required. Use the credentials included in the submission.');
  });
  app.use(express.json({ limit: '512kb' }));
  const { defer, status: jobStatus } = createDeferredJobs(text => redactSecrets(text, options.customRoot));
  app.get('/api/jobs/:jobId', jobStatus);

  const runsStore = new Map<string, StressRun>();
  const candidatesStore = new Map<string, CandidatePatch>();
  const comparisonsStore = new Map<string, RunComparison>();
  const receiptsLog: ModelReceipt[] = [];

  const getCfg = () => getServerConfig(options.customRoot);

  // Ensure artifacts directory exists and hydrate any saved runs/receipts/candidates from disk
  const initCfg = getCfg();
  fs.mkdirSync(path.join(initCfg.artifactsDir, 'runs'), { recursive: true });
  const receiptsPath = path.join(initCfg.artifactsDir, 'receipts.json');
  const candidatesPath = path.join(initCfg.artifactsDir, 'candidates.json');

  const syncStoresFromDisk = () => {
    if (fs.existsSync(receiptsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(receiptsPath, 'utf8'));
        if (Array.isArray(parsed)) {
          const seen = new Set(receiptsLog.map((r) => r.receiptId));
          for (const r of parsed as ModelReceipt[]) {
            if (r?.receiptId && !seen.has(r.receiptId)) {
              seen.add(r.receiptId);
              receiptsLog.push(r);
            }
          }
        }
      } catch {
        // Ignore corrupt receipt cache
      }
    }
    if (fs.existsSync(candidatesPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
        if (Array.isArray(parsed)) {
          for (const c of parsed as CandidatePatch[]) {
            if (c?.candidateId && !candidatesStore.has(c.candidateId)) {
              candidatesStore.set(c.candidateId, c);
            }
          }
        }
      } catch {
        // Ignore corrupt candidate cache
      }
    }
  };

  syncStoresFromDisk();

  const persistCandidate = (c: CandidatePatch) => {
    syncStoresFromDisk();
    candidatesStore.set(c.candidateId, c);
    try {
      fs.writeFileSync(
        candidatesPath,
        JSON.stringify(Array.from(candidatesStore.values()), null, 2),
        'utf8'
      );
    } catch {
      // Non-fatal
    }
  };

  const recordReceipt = (r: ModelReceipt) => {
    syncStoresFromDisk();
    if (!receiptsLog.some((existing) => existing.receiptId === r.receiptId)) {
      receiptsLog.push(r);
    }
    try {
      fs.writeFileSync(receiptsPath, JSON.stringify(receiptsLog, null, 2), 'utf8');
    } catch {
      // Non-fatal
    }
  };

  const loadRunById = (runId: string): StressRun | null => {
    const mem = runsStore.get(runId);
    if (mem) return mem;
    const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId) return null;
    const diskPath = path.join(getCfg().artifactsDir, 'runs', safeId, 'run.json');
    if (fs.existsSync(diskPath)) {
      try {
        const run = JSON.parse(fs.readFileSync(diskPath, 'utf8')) as StressRun;
        runsStore.set(run.runId, run);
        return run;
      } catch {
        return null;
      }
    }
    return null;
  };

  // Serve captured PNG artifacts safely
  app.use(
    '/artifacts',
    (_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      next();
    },
    express.static(initCfg.artifactsDir)
  );

  app.get('/api/health', (_req, res) => {
    syncStoresFromDisk();
    res.json({
      ...getPublicHealthStatus(options.customRoot),
      recentReceiptsCount: receiptsLog.length,
    });
  });

  app.get('/api/receipts', (_req, res) => {
    syncStoresFromDisk();
    res.json({ receipts: receiptsLog.slice(-20).reverse() });
  });

  app.post('/api/analyze', (req, res, next) => {
    try {
      const schema = z.object({
        html: z.string().min(1).max(MAX_HTML_BYTES),
        css: z.string().max(MAX_CSS_BYTES),
      });
      const body = schema.parse(req.body);
      const analysis = analyzeAndSanitizeComponent(body.html, body.css);
      res.json(analysis);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/spark/scenarios', defer(async (req, res, next) => {
    try {
      const schema = z.object({
        html: z.string().min(1).max(MAX_HTML_BYTES),
        css: z.string().max(MAX_CSS_BYTES),
        slots: z.array(SlotSchema).optional(),
        assertions: z.array(AssertionSchema),
      });
      const body = schema.parse(req.body);
      const analysis = analyzeAndSanitizeComponent(body.html, body.css);
      const reviewedMap = new Map((body.slots || []).map((s) => [s.id, s]));
      const effectiveSlots: TextSlot[] = analysis.slots.map((s) => {
        const rev = reviewedMap.get(s.id);
        return rev ? { ...s, required: rev.required } : s;
      });

      const { scenarios, receipt } = await generateScenariosWithSpark({
        instrumentedHtml: analysis.instrumentedHtml,
        css: analysis.sanitizedCss,
        slots: effectiveSlots,
        assertions: body.assertions as AssertionRule[],
        customRoot: options.customRoot,
        fetchImpl: options.fetchImpl,
      });

      recordReceipt(receipt);
      res.json({ scenarios, receipt });
    } catch (err) {
      next(err);
    }
  }));

  app.post('/api/runs', defer(async (req, res, next) => {
    try {
      const schema = z.object({
        componentName: z.string().min(1).max(120).default('Custom Component'),
        html: z.string().min(1).max(MAX_HTML_BYTES),
        css: z.string().max(MAX_CSS_BYTES),
        slots: z.array(SlotSchema).optional(),
        assertions: z.array(AssertionSchema).min(1),
        scenarios: z.array(ScenarioSchema).min(1).max(16),
      });
      const body = schema.parse(req.body);
      const runId = `run_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;

      const run = await executeStressRun({
        runId,
        role: 'original',
        componentName: body.componentName,
        html: body.html,
        css: body.css,
        slots: body.slots as TextSlot[] | undefined,
        assertions: body.assertions as AssertionRule[],
        scenarios: body.scenarios as StressScenario[],
        artifactsDir: getCfg().artifactsDir,
      });

      runsStore.set(run.runId, run);
      res.json({ run });
    } catch (err) {
      next(err);
    }
  }));

  app.post('/api/spark/patch', defer(async (req, res, next) => {
    try {
      const schema = z.object({
        runId: z.string().min(1).max(80),
      });
      const { runId } = schema.parse(req.body);
      const failedRun = loadRunById(runId);
      if (!failedRun) {
        res.status(404).json({ error: `Run "${runId}" not found.` });
        return;
      }

      const candidate = await proposeCssPatchWithSpark({
        failedRun,
        artifactsDir: getCfg().artifactsDir,
        customRoot: options.customRoot,
        fetchImpl: options.fetchImpl,
      });

      persistCandidate(candidate);
      if (candidate.receipt) {
        recordReceipt(candidate.receipt);
      }

      res.json({ candidate });
    } catch (err) {
      next(err);
    }
  }));

  app.post('/api/runs/:runId/diff', (req, res, next) => {
    try {
      const originalRun = loadRunById(req.params.runId);
      if (!originalRun) {
        res.status(404).json({ error: `Run "${req.params.runId}" not found.` });
        return;
      }
      const schema = z.object({
        patchedCss: z.string().min(1).max(MAX_CSS_BYTES),
      });
      const { patchedCss } = schema.parse(req.body);
      const report = {
        strippedTags: [],
        strippedAttributes: [],
        strippedExternalUrls: [],
        strippedCssConstructs: [],
        warnings: [],
      };
      const sanitized = sanitizeCssInput(patchedCss, report);
      const unifiedDiff = computeUnifiedCssDiff(originalRun.css, sanitized);
      res.json({
        sanitizedCss: sanitized,
        unifiedDiff,
        sanitization: report,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Replay EXACTLY the original run's HTML, slots, scenarios, and assertions
   * against a candidate CSS stylesheet. Neither AI nor caller can drop cases.
   */
  app.post('/api/runs/:runId/retest', defer(async (req, res, next) => {
    try {
      const originalRun = loadRunById(req.params.runId);
      if (!originalRun) {
        res.status(404).json({ error: `Original run "${req.params.runId}" not found.` });
        return;
      }

      const schema = z.object({
        candidateId: z.string().max(80).optional(),
        patchedCss: z.string().min(1).max(MAX_CSS_BYTES),
        rationale: z.string().max(1600).optional(),
        targetedFailures: z.array(z.string().max(240)).optional(),
        source: z.enum(['manual_edit', 'fixture_reference']).optional(),
      });
      const body = schema.parse(req.body);

      const report = {
        strippedTags: [],
        strippedAttributes: [],
        strippedExternalUrls: [],
        strippedCssConstructs: [],
        warnings: [],
      };
      const cleanCss = sanitizeCssInput(body.patchedCss, report).trim();
      const cleanCssHash = computeCssHash(cleanCss);
      const unifiedDiff = computeUnifiedCssDiff(originalRun.css, cleanCss);

      let candidate: CandidatePatch;

      if (body.candidateId) {
        const existingCandidate = candidatesStore.get(body.candidateId);
        if (!existingCandidate) {
          res.status(404).json({
            error: `Candidate "${body.candidateId}" not found on server.`,
            code: 'CANDIDATE_NOT_FOUND',
          });
          return;
        }
        if (existingCandidate.basedOnRunId !== originalRun.runId) {
          res.status(400).json({
            error: `Candidate "${existingCandidate.candidateId}" belongs to run "${existingCandidate.basedOnRunId}", not "${originalRun.runId}".`,
            code: 'CANDIDATE_RUN_MISMATCH',
          });
          return;
        }

        if (
          existingCandidate.source === 'muse_spark' ||
          existingCandidate.source === 'muse_spark_modified'
        ) {
          const immutableSparkCss = (
            existingCandidate.sparkGeneratedCss ?? existingCandidate.patchedCss
          )
            .replace(/\r\n/g, '\n')
            .trim();
          const immutableSparkHash =
            existingCandidate.sparkGeneratedCssHash ?? existingCandidate.candidateCssHash;
          const startingReceipt =
            existingCandidate.receipt ?? existingCandidate.originReceipt;

          const normClean = cleanCss.replace(/\r\n/g, '\n').trim();
          const isExactSparkCss =
            cleanCssHash === immutableSparkHash && normClean === immutableSparkCss;

          if (isExactSparkCss) {
            candidate = {
              candidateId: existingCandidate.candidateId,
              basedOnRunId: originalRun.runId,
              originalCssHash: originalRun.cssHash,
              candidateCssHash: cleanCssHash,
              patchedCss: cleanCss,
              unifiedDiff,
              rationale: existingCandidate.rationale,
              targetedFailures: existingCandidate.targetedFailures,
              source: 'muse_spark',
              createdAt: existingCandidate.createdAt,
              sparkGeneratedCss: immutableSparkCss,
              sparkGeneratedCssHash: immutableSparkHash,
              receipt: startingReceipt,
            };
          } else {
            // Do NOT mutate the original Spark candidate; mint a derived modified candidate
            candidate = {
              candidateId: `cand_mod_${crypto.randomUUID().slice(0, 8)}`,
              basedOnRunId: originalRun.runId,
              originalCssHash: originalRun.cssHash,
              candidateCssHash: cleanCssHash,
              patchedCss: cleanCss,
              unifiedDiff,
              rationale:
                body.rationale ||
                `Manually modified from Muse Spark starting point (${existingCandidate.candidateId}). Original rationale: ${existingCandidate.rationale}`,
              targetedFailures:
                body.targetedFailures || existingCandidate.targetedFailures,
              source: 'muse_spark_modified',
              createdAt: new Date().toISOString(),
              sparkGeneratedCss: immutableSparkCss,
              sparkGeneratedCssHash: immutableSparkHash,
              receipt: undefined,
              originReceipt: startingReceipt,
            };
          }
        } else {
          candidate = {
            ...existingCandidate,
            patchedCss: cleanCss,
            candidateCssHash: cleanCssHash,
            unifiedDiff,
            source:
              existingCandidate.source === 'fixture_reference' &&
              cleanCssHash === existingCandidate.candidateCssHash
                ? 'fixture_reference'
                : body.source || 'manual_edit',
          };
        }
      } else {
        candidate = {
          candidateId: `cand_${crypto.randomUUID().slice(0, 10)}`,
          basedOnRunId: originalRun.runId,
          originalCssHash: originalRun.cssHash,
          candidateCssHash: cleanCssHash,
          patchedCss: cleanCss,
          unifiedDiff,
          rationale:
            body.rationale ||
            'Manual CSS candidate retested against the locked scenario and assertion pack.',
          targetedFailures: body.targetedFailures || [],
          source: body.source || 'manual_edit',
          createdAt: new Date().toISOString(),
        };
      }

      persistCandidate(candidate);

      const candidateRunId = `run_cand_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
      const candidateRun = await executeStressRun({
        runId: candidateRunId,
        role: 'candidate',
        componentName: originalRun.componentName,
        html: originalRun.html,
        css: cleanCss,
        slots: originalRun.slots,
        assertions: originalRun.assertions,
        scenarios: originalRun.scenarios,
        artifactsDir: getCfg().artifactsDir,
        candidateId: candidate.candidateId,
      });

      runsStore.set(candidateRun.runId, candidateRun);

      const comparison = compareStressRuns(originalRun, candidateRun);
      comparisonsStore.set(`${originalRun.runId}:${candidateRun.runId}`, comparison);

      res.json({
        candidate,
        candidateRun,
        comparison,
      });
    } catch (err) {
      next(err);
    }
  }));

  app.post('/api/export', async (req, res, next) => {
    try {
      const schema = z.object({
        originalRunId: z.string().min(1).max(80),
        candidateId: z.string().max(80).optional(),
        candidateRunId: z.string().max(80).optional(),
      });
      const body = schema.parse(req.body);
      const originalRun = loadRunById(body.originalRunId);
      if (!originalRun) {
        res.status(404).json({ error: `Original run "${body.originalRunId}" not found.` });
        return;
      }

      const candidate = body.candidateId
        ? candidatesStore.get(body.candidateId) || null
        : null;
      if (candidate && candidate.basedOnRunId !== originalRun.runId) {
        res.status(400).json({
          error: `Candidate "${candidate.candidateId}" does not belong to original run "${originalRun.runId}".`,
          code: 'CANDIDATE_RUN_MISMATCH',
        });
        return;
      }
      const candidateRun = body.candidateRunId
        ? loadRunById(body.candidateRunId)
        : null;
      const comparison =
        originalRun && candidateRun
          ? comparisonsStore.get(`${originalRun.runId}:${candidateRun.runId}`) ||
            compareStressRuns(originalRun, candidateRun)
          : null;

      const relevantReceipts: ModelReceipt[] = [];
      if (candidate?.receipt) {
        relevantReceipts.push(candidate.receipt);
      }
      if (
        candidate?.originReceipt &&
        !relevantReceipts.some((x) => x.receiptId === candidate.originReceipt?.receiptId)
      ) {
        relevantReceipts.push(candidate.originReceipt);
      }
      for (const r of receiptsLog.slice(-10)) {
        if (!relevantReceipts.some((x) => x.receiptId === r.receiptId)) {
          relevantReceipts.push(r);
        }
      }

      const zipBuffer = await buildReproducibleZipBundle({
        originalRun,
        candidate,
        candidateRun,
        comparison,
        receipts: relevantReceipts,
        artifactsDir: getCfg().artifactsDir,
      });

      const filename = `break-it-evidence-${originalRun.runId}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(zipBuffer);
    } catch (err) {
      next(err);
    }
  });

  // In production mode, serve built Vite frontend if dist/ exists
  const distDir = path.join(initCfg.projectRoot, 'dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/artifacts')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Central error handler with secret redaction
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SparkApiError) {
      res.status(err.statusCode).json({
        error: redactSecrets(err.message, options.customRoot),
        code: err.code,
      });
      return;
    }

    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: `Validation error: ${err.issues
          .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
          .join('; ')}`,
        code: 'INVALID_INPUT',
      });
      return;
    }

    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({
      error: redactSecrets(msg, options.customRoot),
      code: 'ENGINE_ERROR',
    });
  });

  return app;
}

