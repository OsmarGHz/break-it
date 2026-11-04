import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

async function main() {
  const outDir = path.join(process.cwd(), 'artifacts', 'ui-walkthrough');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  const page = await context.newPage();

  console.log('1. Opening http://127.0.0.1:5173/ ...');
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.getByText('1A. Static Component Source').waitFor();
  await page.getByRole('cell', { name: 'slot-customer', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outDir, '01-setup.png'), fullPage: true });

  // Verify key pill & receipts modal
  const keyBadgeText = await page.locator('.api-pill').innerText();
  console.log(`2. Header API pill: "${keyBadgeText}"`);
  if (keyBadgeText.includes('Key Missing')) {
    console.log('   Verifying honest error banner when MODEL_API_KEY is absent...');
    await page.getByRole('button', { name: /Generate Cases with Muse Spark 1\.3/i }).click();
    await page.getByRole('alert').waitFor();
    const alertText = await page.getByRole('alert').innerText();
    if (!alertText.includes('MODEL_API_KEY')) {
      throw new Error(`Expected honest MODEL_API_KEY alert, got: ${alertText}`);
    }
    await page.getByRole('button', { name: 'Dismiss' }).click();
  } else {
    const receiptsBtn = page.getByRole('button', { name: /Receipts \(\d+\)/i });
    const receiptsBtnText = await receiptsBtn.innerText();
    console.log(`   Receipts button: "${receiptsBtnText}"`);
    await receiptsBtn.click();
    await page.getByText('Meta Model API Call Receipts (Secret-Free)').waitFor();
    await page.screenshot({ path: path.join(outDir, '05-receipts-modal.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  }

  console.log('3. Running 6 scenarios in real Chromium from the UI...');
  await page.getByRole('button', { name: /Run 6 Scenarios in Real Chromium/i }).click();
  await page.getByText('Scenario Matrix').waitFor({ timeout: 30000 });
  await page.getByText('1/6 Passed').waitFor();

  // Select combined worst-case scenario for rich visual evidence
  await page.getByRole('button', { name: /Combined Stress — 340px/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '02-failure-matrix.png'), fullPage: true });

  console.log('4. Opening Candidate CSS Workbench & loading local verification fix...');
  await page.getByRole('button', { name: /Manual CSS Candidate/i }).click();
  await page.getByText('3A. Scoped CSS Candidate').waitFor();
  await page.getByRole('button', { name: /Load Local Verification Fix/i }).click();
  await page.getByText('component.original.css → component.candidate.css').waitFor();
  await page.screenshot({ path: path.join(outDir, '03-candidate-diff.png'), fullPage: true });

  console.log('5. Replaying locked scenario pack against candidate CSS...');
  await page.getByRole('button', { name: /Replay Exact Scenario Pack in Chromium/i }).click();
  await page.getByText('1/6 → 6/6 Passed').waitFor({ timeout: 30000 });
  await page.getByText('HASH VERIFIED').waitFor();
  await page.getByRole('button', { name: /Combined Stress — 340px/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(outDir, '04-before-after-proof.png'),
    fullPage: true,
  });

  console.log('6. Verifying one-click reproducible .zip bundle download...');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download Evidence \+ Patch \+ Repro/i }).click(),
  ]);
  const zipSavePath = path.join(outDir, download.suggestedFilename());
  await download.saveAs(zipSavePath);
  const stat = fs.statSync(zipSavePath);
  console.log(`   Downloaded ${download.suggestedFilename()} (${stat.size} bytes)`);
  if (stat.size < 10000) {
    throw new Error('Downloaded zip bundle appears unexpectedly small!');
  }

  await browser.close();
  console.log('UI E2E walkthrough verified successfully!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
