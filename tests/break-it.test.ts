import fs from 'node:fs';
import http from 'node:http';
import { Duplex } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CHECKOUT_CORRECTED_REFERENCE_CSS,
  CHECKOUT_FRAGILE_CSS,
  CHECKOUT_FRAGILE_HTML,
  CHECKOUT_STARTER_SCENARIOS,
} from '../src/shared/fixtures.js';
import { analyzeAndSanitizeComponent } from '../server/sanitizer.js';
import { closeSharedBrowser, executeStressRun } from '../server/renderer.js';
import { compareStressRuns, computeUnifiedCssDiff } from '../server/comparison.js';
import {
  generateScenariosWithSpark,
  proposeCssPatchWithSpark,
  SparkApiError,
  validateSparkCssPatchOutput,
  validateSparkScenarioOutput,
} from '../server/spark.js';
import { buildReproducibleZipBundle } from '../server/exporter.js';
import { createApp } from '../server/app.js';
import type { AssertionRule } from '../src/shared/types.js';

const execFileAsync = promisify(execFile);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'break-it-test-'));
const testArtifactsDir = path.join(tempRoot, 'artifacts');

afterAll(async () => {
  await closeSharedBrowser();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('BREAK IT — Chromium Stress Engine, Isolation & Proof Loop', () => {
  it('1 & 2 & 4: fails fragile checkout fixture on long name, unbroken token & 320px viewport, then passes corrected CSS on exact replay', async () => {
    const analysis = analyzeAndSanitizeComponent(
      CHECKOUT_FRAGILE_HTML,
      CHECKOUT_FRAGILE_CSS
    );

    const fragileRun = await executeStressRun({
      runId: 'test_fragile_1',
      role: 'original',
      componentName: 'Checkout Card',
      html: CHECKOUT_FRAGILE_HTML,
      css: CHECKOUT_FRAGILE_CSS,
      slots: analysis.slots,
      assertions: analysis.suggestedAssertions,
      scenarios: CHECKOUT_STARTER_SCENARIOS,
      artifactsDir: testArtifactsDir,
    });

    // Baseline ideal short copy passes
    const baseline = fragileRun.results.find((r) => r.scenarioId === 'baseline-ideal');
    expect(baseline?.status).toBe('pass');

    // Long unbroken token case executed and failed
    const unbroken = fragileRun.results.find((r) => r.scenarioId === 'unbroken-settlement-id');
    expect(unbroken?.status).toBe('fail');

    // Narrow 320px viewport case executed and failed CTA bounds + viewport overflow
    const narrow320 = fragileRun.results.find((r) => r.scenarioId === 'narrow-320-localized-cta');
    expect(narrow320?.status).toBe('fail');
    const ctaFailure = narrow320?.assertions.find(
      (a) => a.assertionType === 'cta_visible_in_bounds'
    );
    expect(ctaFailure?.status).toBe('fail');

    // Multi-line note fails vertical clipping inside fixed-height .plan-box
    const bilingual = fragileRun.results.find(
      (r) => r.scenarioId === 'bilingual-legal-renewal-note'
    );
    const noteAssert = bilingual?.assertions.find((a) => a.targetId === 'slot-note');
    expect(noteAssert?.status).toBe('fail');
    expect((noteAssert?.measurements.verticalClipPx ?? 0) > 5).toBe(true);

    // Real PNG screenshot captured on disk
    for (const sc of fragileRun.results) {
      expect(sc.screenshotPath).toBeTruthy();
      const absPng = path.join(tempRoot, sc.screenshotPath!);
      expect(fs.existsSync(absPng)).toBe(true);
      expect(fs.statSync(absPng).size).toBeGreaterThan(1000);
    }

    // Replay exact scenario + assertion pack against corrected CSS
    const correctedRun = await executeStressRun({
      runId: 'test_corrected_1',
      role: 'candidate',
      componentName: 'Checkout Card',
      html: fragileRun.html,
      css: CHECKOUT_CORRECTED_REFERENCE_CSS,
      slots: fragileRun.slots,
      assertions: fragileRun.assertions,
      scenarios: fragileRun.scenarios,
      artifactsDir: testArtifactsDir,
    });

    expect(correctedRun.packHash).toBe(fragileRun.packHash);
    expect(correctedRun.componentHash).toBe(fragileRun.componentHash);
    expect(correctedRun.summary.failedScenarios).toBe(0);
    expect(correctedRun.summary.errorScenarios).toBe(0);
    expect(correctedRun.summary.passedScenarios).toBe(fragileRun.scenarios.length);

    const comparison = compareStressRuns(fragileRun, correctedRun);
    expect(comparison.packMatchesExactly).toBe(true);
    expect(comparison.summary.scenariosFixed).toBe(5);
    expect(comparison.remainingFailures).toHaveLength(0);
  });

  it('3: rejects evasive CSS patches that hide elements, set opacity:0 / font-size:0, or silently clip text', async () => {
    const analysis = analyzeAndSanitizeComponent(
      CHECKOUT_FRAGILE_HTML,
      CHECKOUT_FRAGILE_CSS
    );

    const evasiveCss = `${CHECKOUT_CORRECTED_REFERENCE_CSS}
      .customer-name { display: none !important; }
      .primary-cta { opacity: 0 !important; }
      .order-ref { font-size: 0px !important; color: transparent !important; }
    `;

    const evasiveRun = await executeStressRun({
      runId: 'test_evasion',
      role: 'candidate',
      componentName: 'Checkout Card Evasion',
      html: CHECKOUT_FRAGILE_HTML,
      css: evasiveCss,
      slots: analysis.slots,
      assertions: analysis.suggestedAssertions,
      scenarios: CHECKOUT_STARTER_SCENARIOS.slice(0, 2),
      artifactsDir: testArtifactsDir,
    });

    expect(evasiveRun.summary.passedScenarios).toBe(0);
    expect(evasiveRun.summary.failedScenarios).toBe(2);

    const first = evasiveRun.results[0];
    expect(
      first.assertions.find((a) => a.assertionType === 'cta_visible_in_bounds')?.status
    ).toBe('fail');
    expect(
      first.assertions.find((a) => a.targetId === 'slot-customer')?.status
    ).toBe('fail');
    expect(
      first.assertions.find((a) => a.targetId === 'slot-ref')?.status
    ).toBe('fail');

    // Also test lazy overflow:hidden clipping evasion on .checkout-card
    const clipCardCss = `${CHECKOUT_FRAGILE_CSS}\n.checkout-card { overflow: hidden !important; }`;
    const clipEvasionRun = await executeStressRun({
      runId: 'test_clip_evasion',
      role: 'candidate',
      componentName: 'Checkout Card Clip Evasion',
      html: CHECKOUT_FRAGILE_HTML,
      css: clipCardCss,
      slots: analysis.slots,
      assertions: analysis.suggestedAssertions,
      scenarios: [CHECKOUT_STARTER_SCENARIOS[1], CHECKOUT_STARTER_SCENARIOS[4]],
      artifactsDir: testArtifactsDir,
    });

    expect(clipEvasionRun.summary.failedScenarios).toBe(2);
  });

  it('5: refuses to compare runs if scenarios or assertions were dropped or altered', async () => {
    const analysis = analyzeAndSanitizeComponent(
      CHECKOUT_FRAGILE_HTML,
      CHECKOUT_FRAGILE_CSS
    );

    const orig = await executeStressRun({
      runId: 'test_pack_orig',
      role: 'original',
      componentName: 'Pack Integrity',
      html: CHECKOUT_FRAGILE_HTML,
      css: CHECKOUT_FRAGILE_CSS,
      slots: analysis.slots,
      assertions: analysis.suggestedAssertions,
      scenarios: CHECKOUT_STARTER_SCENARIOS.slice(0, 3),
      artifactsDir: testArtifactsDir,
    });

    const tampered = await executeStressRun({
      runId: 'test_pack_tampered',
      role: 'candidate',
      componentName: 'Pack Integrity',
      html: CHECKOUT_FRAGILE_HTML,
      css: CHECKOUT_CORRECTED_REFERENCE_CSS,
      slots: analysis.slots,
      assertions: analysis.suggestedAssertions,
      // Dropped 2 failing scenarios
      scenarios: CHECKOUT_STARTER_SCENARIOS.slice(0, 1),
      artifactsDir: testArtifactsDir,
    });

    expect(() => compareStressRuns(orig, tampered)).toThrow(/Cannot claim valid comparison/);
  });

  it('6: fails clearly on missing key or malformed/invalid Muse Spark output without canned success, and redacts secrets', async () => {
    const emptyEnvRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'breakit-nokey-'));
    const savedEnvKey = process.env.MODEL_API_KEY;
    delete process.env.MODEL_API_KEY;

    try {
      const analysis = analyzeAndSanitizeComponent(
        CHECKOUT_FRAGILE_HTML,
        CHECKOUT_FRAGILE_CSS
      );

      await expect(
        generateScenariosWithSpark({
          instrumentedHtml: analysis.instrumentedHtml,
          css: analysis.sanitizedCss,
          slots: analysis.slots,
          assertions: analysis.suggestedAssertions,
          customRoot: emptyEnvRoot,
        })
      ).rejects.toMatchObject({
        name: 'SparkApiError',
        code: 'MISSING_API_KEY',
        statusCode: 503,
      });

      // Malformed JSON
      expect(() =>
        validateSparkScenarioOutput('{not valid json', analysis.slots)
      ).toThrow(SparkApiError);

      // Unknown slotId hallucinated by model
      const badSlotPayload = JSON.stringify({
        scenarios: Array.from({ length: 6 }, (_, i) => ({
          id: `case-${i}`,
          name: `Case ${i}`,
          category: 'long_name',
          viewportWidth: 360,
          viewportHeight: 520,
          mutations: [{ slotId: 'non-existent-slot-xyz', value: 'Long text' }],
          rationale: 'Testing unknown slot rejection',
        })),
      });
      expect(() => validateSparkScenarioOutput(badSlotPayload, analysis.slots)).toThrow(
        /unknown slotId/
      );

      // HTML injected inside CSS patch
      expect(() =>
        validateSparkCssPatchOutput(
          JSON.stringify({
            patchedCss: '<script>alert(1)</script> .card { color: red; }',
            rationale: 'Injected HTML tag should be rejected immediately.',
            targetedFailures: ['overflow'],
          }),
          CHECKOUT_FRAGILE_CSS
        )
      ).toThrow(/HTML markup inside patchedCss/);

      // Verify exact Meta request contract + secret redaction using mock fetch
      fs.writeFileSync(
        path.join(emptyEnvRoot, '.env.local'),
        'MODEL_API_KEY=secret_test_token_998877\nMETA_BASE_URL=https://api.meta.ai/v1\nMETA_SPARK_MODEL=muse-spark-1.3\n',
        'utf8'
      );

      let capturedBody: Record<string, unknown> = {};
      const validMockScenarios = {
        scenarios: Array.from({ length: 6 }, (_, i) => ({
          id: `spark-case-${i + 1}`,
          name: `Spark Adversarial Case ${i + 1}`,
          category: 'narrow_viewport',
          viewportWidth: 320 + i * 20,
          viewportHeight: 540,
          mutations: [{ slotId: 'slot-customer', value: `Cliente Prueba ${i + 1}` }],
          rationale: 'Probes responsive header wrapping on narrow viewports.',
        })),
      };

      const { scenarios: parsedScenarios, receipt } = await generateScenariosWithSpark({
        instrumentedHtml: analysis.instrumentedHtml,
        css: analysis.sanitizedCss,
        slots: analysis.slots,
        assertions: analysis.suggestedAssertions,
        customRoot: emptyEnvRoot,
        fetchImpl: (async (_url, init) => {
          capturedBody = JSON.parse(String(init?.body || '{}'));
          return new Response(
            JSON.stringify({
              id: 'chatcmpl-meta-unit-1',
              model: 'muse-spark-1.3',
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: JSON.stringify(validMockScenarios),
                  },
                },
              ],
              usage: { prompt_tokens: 410, completion_tokens: 320, total_tokens: 730 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }) as typeof fetch,
      });

      expect(capturedBody?.model).toBe('muse-spark-1.3');
      expect(capturedBody?.reasoning_effort).toBe('medium');
      expect((capturedBody?.response_format as { type?: string })?.type).toBe('json_schema');
      expect(parsedScenarios).toHaveLength(7); // 1 baseline + 6 Spark scenarios
      expect(JSON.stringify(receipt)).not.toContain('secret_test_token_998877');

      // Also verify multimodal image_url attachment on proposeCssPatchWithSpark
      const sampleRun = await executeStressRun({
        runId: 'test_spark_patch_input',
        role: 'original',
        componentName: 'Patch Input Check',
        html: CHECKOUT_FRAGILE_HTML,
        css: CHECKOUT_FRAGILE_CSS,
        slots: analysis.slots,
        assertions: analysis.suggestedAssertions,
        scenarios: [CHECKOUT_STARTER_SCENARIOS[1]],
        artifactsDir: testArtifactsDir,
      });

      let patchRequestBody: Record<string, unknown> = {};
      const patchCandidate = await proposeCssPatchWithSpark({
        failedRun: sampleRun,
        artifactsDir: testArtifactsDir,
        customRoot: emptyEnvRoot,
        fetchImpl: (async (_url, init) => {
          patchRequestBody = JSON.parse(String(init?.body || '{}'));
          return new Response(
            JSON.stringify({
              id: 'chatcmpl-meta-patch-1',
              model: 'muse-spark-1.3',
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: JSON.stringify({
                      patchedCss: CHECKOUT_CORRECTED_REFERENCE_CSS,
                      rationale: 'Added min-width:0 and overflow-wrap:anywhere to flex children.',
                      targetedFailures: ['Horizontal overflow on compound Spanish names'],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }) as typeof fetch,
      });

      expect(patchCandidate.receipt?.imagesAttached).toBe(1);
      const msgs = patchRequestBody?.messages as Array<{ role: string; content: unknown }>;
      const userMsg = msgs.find((m) => m.role === 'user');
      expect(Array.isArray(userMsg?.content)).toBe(true);
      const imgBlock = (userMsg?.content as Array<{ type: string; image_url?: { url: string } }>).find(
        (b) => b.type === 'image_url'
      );
      expect(imgBlock?.image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
    } finally {
      if (savedEnvKey !== undefined) process.env.MODEL_API_KEY = savedEnvKey;
      fs.rmSync(emptyEnvRoot, { recursive: true, force: true });
    }
  });

  it('7: blocks scripts, event handlers, meta redirects, and external CSS/image network requests', async () => {
    const hits: string[] = [];
    const spyServer = http.createServer((req, res) => {
      hits.push(req.url || '/');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('should-never-be-contacted');
    });

    await new Promise<void>((resolve) => spyServer.listen(0, '127.0.0.1', resolve));
    const addr = spyServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    try {
      const hostileHtml = `
        <div class="hostile-card" data-breakit-id="card-root" onclick="fetch('${base}/click')">
          <meta http-equiv="refresh" content="0;url=${base}/meta-redirect" />
          <script>fetch('${base}/script-exec');</script>
          <iframe src="${base}/iframe"></iframe>
          <img src="${base}/remote-photo.png" onerror="fetch('${base}/img-onerror')" alt="avatar" />
          <h3 data-breakit-id="slot-title">Cuenta Segura</h3>
          <a href="javascript:fetch('${base}/js-href')" class="cta" data-breakit-id="slot-cta">Continuar</a>
        </div>
      `;
      const hostileCss = `
        @import url("${base}/evil.css");
        .hostile-card {
          max-width: 360px;
          padding: 16px;
          background-image: url("${base}/bg-leak.png");
          background-color: #ffffff;
          color: #0f172a;
        }
        .cta {
          display: inline-block;
          padding: 8px 16px;
          background: #2563eb;
          color: #ffffff;
        }
      `;

      const analysis = analyzeAndSanitizeComponent(hostileHtml, hostileCss);
      expect(analysis.sanitization.strippedTags).toEqual(
        expect.arrayContaining(['<meta>', '<script>', '<iframe>'])
      );
      expect(analysis.instrumentedHtml.toLowerCase()).not.toContain('<script');
      expect(analysis.instrumentedHtml.toLowerCase()).not.toContain('<iframe');
      expect(analysis.sanitization.strippedExternalUrls.length).toBeGreaterThanOrEqual(3);

      const run = await executeStressRun({
        runId: 'test_hostile_isolation',
        role: 'original',
        componentName: 'Untrusted Component',
        html: hostileHtml,
        css: hostileCss,
        slots: analysis.slots,
        assertions: analysis.suggestedAssertions,
        scenarios: [
          {
            id: 'baseline-isolation',
            name: 'Isolation Check',
            category: 'baseline',
            viewport: { width: 400, height: 420 },
            mutations: [],
            rationale: 'Verify zero external connections',
            source: 'baseline',
          },
        ],
        artifactsDir: testArtifactsDir,
      });

      expect(hits).toHaveLength(0);
      expect(run.results[0].blockedRequests.length).toBeGreaterThanOrEqual(3);
    } finally {
      await new Promise<void>((resolve) => spyServer.close(() => resolve()));
    }
  });

  it('8: records renderer timeout/failure as an explicit error result, never a pass', async () => {
    const analysis = analyzeAndSanitizeComponent(
      CHECKOUT_FRAGILE_HTML,
      CHECKOUT_FRAGILE_CSS
    );

    const stalledRun = await executeStressRun({
      runId: 'test_renderer_timeout',
      role: 'original',
      componentName: 'Timeout Simulation',
      html: CHECKOUT_FRAGILE_HTML,
      css: CHECKOUT_FRAGILE_CSS,
      slots: analysis.slots,
      assertions: analysis.suggestedAssertions,
      scenarios: CHECKOUT_STARTER_SCENARIOS.slice(0, 2),
      artifactsDir: testArtifactsDir,
      simulateTimeoutMs: 15,
    });

    expect(stalledRun.summary.passedScenarios).toBe(0);
    expect(stalledRun.summary.errorScenarios).toBe(2);
    expect(stalledRun.results.every((r) => r.status === 'error')).toBe(true);
    expect(stalledRun.results[0].renderError).toMatch(/timed out/i);
  });

  it('9: exports a reproducible .zip bundle whose standalone repro/reproduce.mjs script replays both original failures and candidate pass', async () => {
    const analysis = analyzeAndSanitizeComponent(
      CHECKOUT_FRAGILE_HTML,
      CHECKOUT_FRAGILE_CSS
    );
    const subsetScenarios = [
      CHECKOUT_STARTER_SCENARIOS[0], // baseline pass
      CHECKOUT_STARTER_SCENARIOS[4], // narrow-320 fail on fragile, pass on candidate
    ];

    const origRun = await executeStressRun({
      runId: 'test_export_orig',
      role: 'original',
      componentName: 'Export Repro Card',
      html: CHECKOUT_FRAGILE_HTML,
      css: CHECKOUT_FRAGILE_CSS,
      slots: analysis.slots,
      assertions: analysis.suggestedAssertions,
      scenarios: subsetScenarios,
      artifactsDir: testArtifactsDir,
    });

    const candRun = await executeStressRun({
      runId: 'test_export_cand',
      role: 'candidate',
      componentName: 'Export Repro Card',
      html: origRun.html,
      css: CHECKOUT_CORRECTED_REFERENCE_CSS,
      slots: origRun.slots,
      assertions: origRun.assertions,
      scenarios: origRun.scenarios,
      artifactsDir: testArtifactsDir,
    });

    const comparison = compareStressRuns(origRun, candRun);
    const zipBuf = await buildReproducibleZipBundle({
      originalRun: origRun,
      candidate: {
        candidateId: 'cand_export_test',
        basedOnRunId: origRun.runId,
        originalCssHash: origRun.cssHash,
        candidateCssHash: candRun.cssHash,
        patchedCss: CHECKOUT_CORRECTED_REFERENCE_CSS,
        unifiedDiff: computeUnifiedCssDiff(
          CHECKOUT_FRAGILE_CSS,
          CHECKOUT_CORRECTED_REFERENCE_CSS
        ),
        rationale: 'Responsive fix for export verification',
        targetedFailures: ['narrow-320 CTA overflow'],
        source: 'fixture_reference',
        createdAt: new Date().toISOString(),
      },
      candidateRun: candRun,
      comparison,
      receipts: [],
      artifactsDir: testArtifactsDir,
    });

    // Extract bundle inside workspace-adjacent folder so node_modules/playwright resolves cleanly
    const extractDir = path.join(process.cwd(), 'artifacts', 'tmp-repro-verify');
    fs.rmSync(extractDir, { recursive: true, force: true });
    const zip = await JSZip.loadAsync(zipBuf);
    for (const [relPath, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const outPath = path.join(extractDir, relPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const content = await entry.async('nodebuffer');
      fs.writeFileSync(outPath, content);
    }

    try {
      // Running against original.css must exit non-zero (1) due to narrow-320 failure
      let origExitCode = 0;
      try {
        await execFileAsync(process.execPath, [
          path.join(extractDir, 'repro', 'reproduce.mjs'),
          '--target',
          'original',
        ]);
      } catch (err: unknown) {
        origExitCode = (err as { code?: number }).code ?? 1;
      }
      expect(origExitCode).toBe(1);

      // Running against candidate.css must exit 0 with 2/2 passed
      const { stdout } = await execFileAsync(process.execPath, [
        path.join(extractDir, 'repro', 'reproduce.mjs'),
        '--target',
        'candidate',
      ]);
      expect(stdout).toContain('2/2 scenarios passed');
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('10 (P1): exported reproduce.mjs maintains full parity on controls_separated overlap, exceptions, anti-evasion, and unknown rules', async () => {
    const overlapHtml = `
      <div class="card" data-breakit-id="card-root">
        <h3 class="title" data-breakit-id="slot-title">Confirmación</h3>
        <div class="actions">
          <button type="button" class="btn-a" data-breakit-id="slot-btn-a">Cancelar ahora</button>
          <button type="button" class="btn-b" data-breakit-id="slot-btn-b">Pagar ahora</button>
        </div>
      </div>
    `;
    const overlapCss = `
      .card { width: 320px; padding: 16px; background: #fff; color: #0f172a; }
      .title { margin: 0 0 12px; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 90px; }
      .actions { position: relative; height: 42px; }
      .btn-a { position: absolute; left: 0; top: 0; width: 140px; height: 38px; background: #e2e8f0; color: #0f172a; border: 1px solid #94a3b8; }
      .btn-b { position: absolute; left: 96px; top: 0; width: 140px; height: 38px; background: #2563eb; color: #fff; border: none; }
    `;

    const analysis = analyzeAndSanitizeComponent(overlapHtml, overlapCss);
    const sepAssertions: AssertionRule[] = [
      {
        id: 'assert-sep',
        type: 'controls_separated',
        label: 'Buttons separated',
        enabled: true,
        tolerancePx: 1,
        minGapPx: 4,
        targetId: 'slot-btn-b',
        secondaryTargetId: 'slot-btn-a',
      },
    ];

    const baseScenario = [
      {
        id: 'overlap-check',
        name: 'Overlapping Buttons (~44px)',
        category: 'baseline' as const,
        viewport: { width: 400, height: 360 },
        mutations: [],
        rationale: 'Verify controls_separated parity in exported runner',
        source: 'baseline' as const,
      },
    ];

    const overlapRun = await executeStressRun({
      runId: 'test_p1_overlap',
      role: 'original',
      componentName: 'Overlap Card',
      html: overlapHtml,
      css: overlapCss,
      slots: analysis.slots,
      assertions: sepAssertions,
      scenarios: baseScenario,
      artifactsDir: testArtifactsDir,
    });

    expect(overlapRun.summary.failedScenarios).toBe(1);
    const engineSummary = overlapRun.results[0].assertions[0].summary;
    expect(engineSummary).toMatch(/overlap by 38px/i);

    const extractAndRunRepro = async (runToExport: typeof overlapRun) => {
      const zipBuf = await buildReproducibleZipBundle({
        originalRun: runToExport,
        receipts: [],
        artifactsDir: testArtifactsDir,
      });
      const dir = path.join(
        process.cwd(),
        'artifacts',
        `tmp-parity-${runToExport.runId}`
      );
      fs.rmSync(dir, { recursive: true, force: true });
      const zip = await JSZip.loadAsync(zipBuf);
      for (const [relPath, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const out = path.join(dir, relPath);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, await entry.async('nodebuffer'));
      }
      try {
        const res = await execFileAsync(process.execPath, [
          path.join(dir, 'repro', 'reproduce.mjs'),
          '--target',
          'original',
        ]);
        return { exitCode: 0, stdout: res.stdout };
      } catch (err: unknown) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return {
          exitCode: e.code ?? 1,
          stdout: (e.stdout || '') + (e.stderr || ''),
        };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };

    // 1. Overlapping controls must FAIL in reproduce.mjs with exact summary parity & exit code 1
    const overlapRepro = await extractAndRunRepro(overlapRun);
    expect(overlapRepro.exitCode).toBe(1);
    expect(overlapRepro.stdout).toContain(engineSummary);

    // 2. User-approved allowOverlap + allowEllipsis exceptions must PASS in both engine and reproduce.mjs
    const exceptionAssertions: AssertionRule[] = [
      {
        ...sepAssertions[0],
        exception: { allowOverlap: true },
      },
      {
        id: 'assert-title-ellipsis',
        type: 'text_not_clipped',
        label: 'Title with approved ellipsis',
        enabled: true,
        tolerancePx: 2,
        targetId: 'slot-title',
        containerId: 'card-root',
        exception: { allowEllipsis: true },
      },
    ];
    const exceptionRun = await executeStressRun({
      runId: 'test_p1_exceptions',
      role: 'original',
      componentName: 'Exception Card',
      html: overlapHtml,
      css: overlapCss,
      slots: analysis.slots,
      assertions: exceptionAssertions,
      scenarios: [
        {
          ...baseScenario[0],
          mutations: [
            {
              slotId: 'slot-title',
              value: 'Confirmación de transferencia internacional inmediata',
            },
          ],
        },
      ],
      artifactsDir: testArtifactsDir,
    });
    expect(exceptionRun.summary.passedScenarios).toBe(1);
    const exceptionRepro = await extractAndRunRepro(exceptionRun);
    expect(exceptionRepro.exitCode).toBe(0);
    expect(exceptionRepro.stdout).toContain('1/1 scenarios passed');

    // 3. Unknown assertion rule must NEVER pass by omission in either engine or reproduce.mjs
    const unknownRule = {
      id: 'assert-unknown-rule',
      type: 'non_existent_rule_type' as AssertionRule['type'],
      label: 'Unsupported future rule',
      enabled: true,
      tolerancePx: 1,
    };
    const unknownRun = await executeStressRun({
      runId: 'test_p1_unknown',
      role: 'original',
      componentName: 'Unknown Rule Card',
      html: overlapHtml,
      css: overlapCss,
      slots: analysis.slots,
      assertions: [unknownRule],
      scenarios: baseScenario,
      artifactsDir: testArtifactsDir,
    });
    expect(unknownRun.summary.passedScenarios).toBe(0);
    expect(unknownRun.summary.inconclusiveScenarios).toBe(1);

    const unknownRepro = await extractAndRunRepro(unknownRun);
    expect(unknownRepro.exitCode).toBe(1);
    expect(unknownRepro.stdout).toMatch(/INCONCLUSIVE/);

    // 4. Anti-evasion (opacity: 0 CTA) must FAIL identically in both engine and reproduce.mjs
    const evasionCss = `${overlapCss}\n.btn-b { opacity: 0; }`;
    const evasionAssertions: AssertionRule[] = [
      {
        id: 'assert-cta-vis',
        type: 'cta_visible_in_bounds',
        label: 'Primary CTA visible',
        enabled: true,
        tolerancePx: 1,
        targetId: 'slot-btn-b',
        containerId: 'card-root',
      },
    ];
    const evasionRun = await executeStressRun({
      runId: 'test_p1_evasion',
      role: 'original',
      componentName: 'Evasion Card',
      html: overlapHtml,
      css: evasionCss,
      slots: analysis.slots,
      assertions: evasionAssertions,
      scenarios: baseScenario,
      artifactsDir: testArtifactsDir,
    });
    expect(evasionRun.summary.failedScenarios).toBe(1);
    const evasionEngineSummary = evasionRun.results[0].assertions[0].summary;
    expect(evasionEngineSummary).toMatch(/visually hidden or suppressed/i);

    const evasionRepro = await extractAndRunRepro(evasionRun);
    expect(evasionRepro.exitCode).toBe(1);
    expect(evasionRepro.stdout).toContain(evasionEngineSummary);
  });

  it('11 (P2): preserves immutable Muse Spark CSS hash, marks manual edits as muse_spark_modified, and rejects cross-run or forged attribution', async () => {
    const p2Root = fs.mkdtempSync(path.join(os.tmpdir(), 'breakit-p2-'));

    fs.writeFileSync(
      path.join(p2Root, '.env.local'),
      'MODEL_API_KEY=p2_dummy_secret_key\nMETA_BASE_URL=https://api.meta.ai/v1\nMETA_SPARK_MODEL=muse-spark-1.3\n',
      'utf8'
    );

    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl-p2-spark-rcpt-01',
          model: 'muse-spark-1.3',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  patchedCss: CHECKOUT_CORRECTED_REFERENCE_CSS,
                  rationale: 'Spark responsive layout fix.',
                  targetedFailures: ['320px CTA overflow'],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 500, completion_tokens: 300, total_tokens: 800 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const app = createApp({ customRoot: p2Root, fetchImpl: mockFetch });

    // In-memory Express request helper (avoids loopback socket restrictions in sandboxed CI)
    const callApp = async <T = unknown>(
      method: string,
      urlPath: string,
      bodyObj?: unknown
    ): Promise<{ status: number; json: T }> => {
      const payload = bodyObj !== undefined ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : Buffer.alloc(0);
      let pushed = false;
      const socket = new Duplex({
        read() {
          if (!pushed) {
            pushed = true;
            if (payload.length > 0) this.push(payload);
            this.push(null);
          }
        },
        write(_chunk, _enc, cb) {
          cb();
        },
      });

      const req = new http.IncomingMessage(socket as never);
      req.method = method;
      req.url = urlPath;
      req.headers = {
        'content-type': 'application/json',
        'content-length': String(payload.length),
      };
      if (payload.length > 0) {
        req.push(payload);
      }
      req.push(null);

      return new Promise((resolve, reject) => {
        const res = new http.ServerResponse(req);
        const chunks: Buffer[] = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);

        res.write = ((chunk: unknown, ...rest: unknown[]) => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return (origWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
        }) as typeof res.write;

        res.end = ((chunk?: unknown, ...rest: unknown[]) => {
          if (chunk && typeof chunk !== 'function') {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          }
          const result = (origEnd as (...args: unknown[]) => http.ServerResponse)(chunk, ...rest);
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            const bodyStr = raw.includes('\r\n\r\n') ? raw.split('\r\n\r\n').slice(1).join('\r\n\r\n') : raw;
            resolve({ status: res.statusCode, json: JSON.parse(bodyStr) as T });
          } catch (e) {
            reject(e);
          }
          return result;
        }) as typeof res.end;

        app(req, res);
      });
    };

    try {
      const analysis = analyzeAndSanitizeComponent(
        CHECKOUT_FRAGILE_HTML,
        CHECKOUT_FRAGILE_CSS
      );

      const createRun = async (name: string) => {
        const r = await callApp<{ run: { runId: string } }>('POST', '/api/runs', {
          componentName: name,
          html: CHECKOUT_FRAGILE_HTML,
          css: CHECKOUT_FRAGILE_CSS,
          slots: analysis.slots,
          assertions: analysis.suggestedAssertions,
          scenarios: [CHECKOUT_STARTER_SCENARIOS[4]],
        });
        expect(r.status).toBe(200);
        return r.json.run;
      };

      const runA = await createRun('Run A');
      const runB = await createRun('Run B');

      // Request Spark candidate for Run A
      const patchRes = await callApp<{
        candidate: {
          candidateId: string;
          patchedCss: string;
          candidateCssHash: string;
          sparkGeneratedCssHash: string;
          source: string;
          receipt?: { responseId: string };
        };
      }>('POST', '/api/spark/patch', { runId: runA.runId });

      expect(patchRes.status).toBe(200);
      const sparkCand = patchRes.json.candidate;
      expect(sparkCand.source).toBe('muse_spark');
      expect(sparkCand.receipt?.responseId).toBe('chatcmpl-p2-spark-rcpt-01');
      expect(sparkCand.candidateCssHash).toBe(sparkCand.sparkGeneratedCssHash);

      // 1. Retest with exact unmodified Spark CSS keeps source='muse_spark' & direct receipt
      const exactRetest = await callApp<{
        candidate: {
          source: string;
          receipt?: { responseId: string };
          originReceipt?: unknown;
        };
      }>('POST', `/api/runs/${runA.runId}/retest`, {
        candidateId: sparkCand.candidateId,
        patchedCss: sparkCand.patchedCss,
      });
      expect(exactRetest.status).toBe(200);
      expect(exactRetest.json.candidate.source).toBe('muse_spark');
      expect(exactRetest.json.candidate.receipt?.responseId).toBe('chatcmpl-p2-spark-rcpt-01');
      expect(exactRetest.json.candidate.originReceipt).toBeUndefined();

      // 2. Retest after manual CSS edit invalidates direct muse_spark attribution -> muse_spark_modified
      const manuallyEditedCss = `${sparkCand.patchedCss}\n/* user manual tweak */\n.checkout-card { border-width: 2px; }`;
      const modRetest = await callApp<{
        candidate: {
          candidateId: string;
          source: string;
          candidateCssHash: string;
          sparkGeneratedCssHash: string;
          sparkGeneratedCss: string;
          receipt?: unknown;
          originReceipt?: { responseId: string };
        };
      }>('POST', `/api/runs/${runA.runId}/retest`, {
        candidateId: sparkCand.candidateId,
        patchedCss: manuallyEditedCss,
      });
      expect(modRetest.status).toBe(200);
      expect(modRetest.json.candidate.source).toBe('muse_spark_modified');
      expect(modRetest.json.candidate.candidateId).not.toBe(sparkCand.candidateId);
      expect(modRetest.json.candidate.receipt).toBeUndefined();
      expect(modRetest.json.candidate.originReceipt?.responseId).toBe('chatcmpl-p2-spark-rcpt-01');
      expect(modRetest.json.candidate.sparkGeneratedCssHash).toBe(sparkCand.sparkGeneratedCssHash);
      expect(modRetest.json.candidate.candidateCssHash).not.toBe(sparkCand.sparkGeneratedCssHash);

      // 3. Cross-run candidateId reuse must fail with 400 CANDIDATE_RUN_MISMATCH
      const crossRunRes = await callApp<{ code?: string }>(
        'POST',
        `/api/runs/${runB.runId}/retest`,
        {
          candidateId: sparkCand.candidateId,
          patchedCss: sparkCand.patchedCss,
        }
      );
      expect(crossRunRes.status).toBe(400);
      expect(crossRunRes.json.code).toBe('CANDIDATE_RUN_MISMATCH');

      // 4. Forging source='muse_spark' without candidateId must fail schema validation (400)
      const forgedRes = await callApp('POST', `/api/runs/${runA.runId}/retest`, {
        patchedCss: CHECKOUT_CORRECTED_REFERENCE_CSS,
        source: 'muse_spark',
      });
      expect(forgedRes.status).toBe(400);
    } finally {
      fs.rmSync(p2Root, { recursive: true, force: true });
    }
  });
});
