import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const setupExe = path.join(root, 'release', `Nock-Setup-${version}.exe`);

if (!fs.existsSync(setupExe)) {
  console.error(`Setup exe not found: ${setupExe}`);
  console.error('Run npm run dist first.');
  process.exit(2);
}

const appdata = process.env.APPDATA;
if (!appdata) {
  console.error('APPDATA is not set');
  process.exit(2);
}
const dataRoots = ['Nock', 'nock'].map((n) => path.join(appdata, n));
const installRoot = path.join(process.env.TEMP ?? root, 'nock-lifecycle-install');
const installDir = path.join(installRoot, 'Nock');
const markerDir = 'screenshots';
const markerFile = 'nock-lifecycle-marker.txt';
const marker = (dataDir) => path.join(dataDir, markerDir, markerFile);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

const run = (file, args) => {
  const r = spawnSync(file, args, { cwd: root, stdio: 'pipe', encoding: 'utf-8', timeout: 300000 });
  if (r.error) throw r.error;
  return r;
};

function killApp() {
  spawnSync('taskkill', ['/IM', 'Nock.exe', '/F'], { stdio: 'ignore' });
}

function writeMarker(dataDir) {
  fs.mkdirSync(path.dirname(marker(dataDir)), { recursive: true });
  fs.writeFileSync(marker(dataDir), `lifecycle test ${Date.now()}`);
}

function rmOwnerMarkers() {
  for (const d of dataRoots) {
    const p = marker(d);
    if (fs.existsSync(p)) {
      try { fs.rmSync(path.dirname(p), { recursive: true, force: true }); } catch {}
    }
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let uninstaller;
try {
  fs.rmSync(installRoot, { recursive: true, force: true });
  fs.mkdirSync(installRoot, { recursive: true });
  rmOwnerMarkers();
  const setupArgs = ['/S', '/currentuser', `/D=${installDir}`];

  let r = run(setupExe, setupArgs);
  record('install (silent)', r.status === 0, `exit=${r.status}`);
  killApp();
  sleepSync(2000);
  const installed = fs.existsSync(path.join(installDir, 'Nock.exe'));
  record('install dir created', installed, installDir);
  uninstaller = fs.readdirSync(installDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.startsWith('Uninstall ') && e.name.endsWith('.exe'))
    .map((e) => path.join(installDir, e.name))[0];
  record('uninstaller found', !!uninstaller, uninstaller ?? 'missing');

  for (const d of dataRoots) writeMarker(d);
  killApp();
  sleepSync(2000);
  r = run(setupExe, setupArgs);
  record('reinstall over existing (update path)', r.status === 0, `exit=${r.status}`);
  for (const d of dataRoots) {
    record(`data preserved after reinstall (${path.basename(d)})`, fs.existsSync(marker(d)), marker(d));
  }

  const unArgs = ['/S', '--currentuser'];
  killApp();
  sleepSync(2000);
  r = run(uninstaller, unArgs);
  record('uninstall (silent)', r.status === 0, `exit=${r.status}`);

  const waitGone = (p, label) => {
    const deadline = Date.now() + 30000;
    while (fs.existsSync(p) && Date.now() < deadline) sleepSync(1000);
  };
  killApp();
  waitGone(installDir, 'install dir');
  record('install dir removed', !fs.existsSync(installDir), installDir);
  for (const d of dataRoots) {
    waitGone(d, `appdata ${path.basename(d)}`);
    record(`user data deleted on uninstall (${path.basename(d)})`, !fs.existsSync(marker(d)), marker(d));
  }
  if (fs.existsSync(installDir)) {
    try { fs.rmSync(installDir, { recursive: true, force: true }); } catch {}
  }
} catch (err) {
  console.error('lifecycle test crashed:', err);
} finally {
  killApp();
  sleepSync(2000);
  try { if (uninstaller) run(uninstaller, ['/S', '--currentuser']); } catch {}
  let rmErr;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(installRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      rmErr = null;
      break;
    } catch (err) {
      rmErr = err;
      sleepSync(1000);
    }
  }
  if (rmErr) console.error('cleanup warning (install root held open):', rmErr.code ?? rmErr);
  rmOwnerMarkers();
}

const allOk = results.length > 0 && results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(allOk ? 0 : 1);