import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const testsDir = path.join(root, 'tests');
const outdir = path.join(root, 'dist', 'tests');

const entryPoints = fs.existsSync(testsDir)
  ? fs
      .readdirSync(testsDir)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => path.join(testsDir, f))
  : [];

if (entryPoints.length === 0) {
  console.log('[test] no *.test.ts files found in tests/ — nothing to run');
  process.exit(0);
}

fs.rmSync(outdir, { recursive: true, force: true });

await esbuild.build({
  entryPoints,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir,
  logLevel: 'info',
});

const res = spawnSync(process.execPath, ['--test', outdir], { stdio: 'inherit' });
process.exit(res.status ?? 1);
