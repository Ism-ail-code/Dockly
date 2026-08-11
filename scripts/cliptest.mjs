// Clipboard capture E2E runner.
//
//   node scripts/cliptest.mjs          # builds, then runs setup + verify
//   node scripts/cliptest.mjs --skip-build
//
// Spawns the real app (electron .) twice against a scratch user-data dir:
//   role=setup   — simulate real clipboard changes, assert event-driven
//                  capture + renderer insert/save
//   role=verify  — relaunch, confirm the captured text survived the restart
//
// Exit code 0 = all green. A single CLIP_E2E_RESULT line per run carries the
// verdict and diagnostics.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dockly-cliptest-'));

function run(role) {
  return new Promise((resolve) => {
    const child = spawn(electronExe, ['.'], {
      cwd: root,
      env: {
        ...process.env,
        DOCKLY_CLIP_TEST: '1',
        DOCKLY_CLIP_ROLE: role,
        DOCKLY_CLIP_USER_DATA: userData,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.error(`[cliptest] ${role}: TIMEOUT (120s) — killing`);
      // child.kill() can fail to terminate a wedged Electron; taskkill /F is
      // the Windows hammer.
      try {
        spawn('taskkill', ['/PID', String(child.pid), '/F', '/T'], { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
      child.kill('SIGKILL');
      resolve({ code: null, result: null });
    }, 120000);
    child.stdout.on('data', (d) => {
      out += String(d);
      process.stdout.write(`[${role}] ` + String(d));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      const m = out.match(/CLIP_E2E_RESULT (.+)/);
      resolve({ code, result: m ? JSON.parse(m[1]) : null });
    });
  });
}

const skipBuild = process.argv.includes('--skip-build');
if (!skipBuild) {
  console.log('[cliptest] building…');
  await import(pathToFileURL(path.join(root, 'scripts', 'build.mjs')).href);
}

let verdict = true;
for (const role of ['setup', 'verify']) {
  console.log(`\n[cliptest] ==== ${role} ====`);
  const { code, result } = await run(role);
  console.log(`[cliptest] ${role} exit=${code}`);
  if (!result) {
    console.error(`[cliptest] ${role}: no CLIP_E2E_RESULT — crash?`);
    verdict = false;
    break;
  }
  if (!result.ok) {
    console.error(`[cliptest] ${role} FAILED:`, JSON.stringify(result));
    verdict = false;
    break;
  }
  console.log(`[cliptest] ${role} OK:`, JSON.stringify(result));
}

fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
console.log(verdict ? '\n[cliptest] ALL GREEN ✓' : '\n[cliptest] FAILED ✗');
process.exit(verdict ? 0 : 1);
