import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';

// Rerenders recorded Meta outputs; makes no model calls and needs no API key.
for (const name of ['checkout', 'custom_boarding']) {
  const zip = await JSZip.loadAsync(fs.readFileSync(`examples/live-spark-${name}-bundle.zip`));
  const root = path.resolve(`work/evidence-replay/${name}`);
  fs.mkdirSync(root, { recursive: true });
  for (const entry of Object.values(zip.files)) {
    const dest = path.resolve(root, entry.name);
    if (!dest.startsWith(root + path.sep)) throw new Error('Unsafe archive path');
    if (entry.dir) { fs.mkdirSync(dest, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, await entry.async('nodebuffer'));
  }
  for (const target of ['original', 'candidate']) {
    const expected = target === 'original' ? 1 : 0;
    let actual = 0;
    try {
      execFileSync(process.execPath, ['repro/reproduce.mjs', '--target', target], {
        cwd: root, stdio: 'inherit', timeout: 120_000,
      });
    } catch (error) {
      actual = (error as { status?: number }).status ?? -1;
    }
    if (actual !== expected) throw new Error(`${name}/${target}: expected exit ${expected}, got ${actual}`);
    console.log(`[verified] ${name}/${target}: exit ${actual} as expected`);
  }
}
