import esbuild from 'esbuild';
import { build as viteBuild } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

await esbuild.build({
  entryPoints: ['src/main/index.ts', 'src/main/clipboard-worker.ts', 'src/preload/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron', 'sql.js', 'koffi'],
  outdir: 'dist',
  entryNames: '[dir]/[name]',
  logLevel: 'info',
});

fs.mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'src', 'assets', 'icon.png'),
  path.join(root, 'dist', 'assets', 'icon.png'),
);

await viteBuild();
console.log('[build] all done');
