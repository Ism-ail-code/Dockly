// Performance benchmark for Nock startup.
//
// Usage:  node scripts/perf.mjs [noteCount] [runs]
//
//   noteCount  how many notes to seed into a scratch database (default 150)
//   runs       how many measure passes to average (default 3)
//
// Flow per run:
//   1. seed  — launches Electron with NOCK_PERF_SEED=<count> against a scratch
//      user-data dir, which fills the DB with realistic notes and exits.
//   2. measure — relaunches Electron (NOCK_PERF=1) against the same dir; the
//      app logs [perf] milestones (main-init, window-loads, booted, loaded)
//      and exits by itself.
//
// Prints the per-run milestones and their averages.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electron = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

const noteCount = Number(process.argv[2] ?? 150);
const runs = Number(process.argv[3] ?? 3);

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-perf-'));

// Launches Electron for one benchmark phase. Resolves once the app prints its
// "done" marker (PERF_SEED_DONE / PERF_DONE) — the child is killed then; a
// clean Electron exit is unreliable with windows + the koffi worker alive.
const runApp = (extraEnv, marker) =>
  new Promise((resolve, reject) => {
    const child = spawn(electron, ['.', `--user-data-dir=${scratchDir}`], {
      cwd: root,
      env: {
        ...process.env,
        NOCK_PERF: '1',
        NOCK_PERF_USER_DATA: scratchDir,
        NOCK_UPDATE_MOCK: 'error',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {
        /* already dead */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already dead */
        }
        resolve(out);
      }, 1500);
    };
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes(marker)) finish();
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('exit', () => {
      if (!out.includes(marker)) reject(new Error(`electron exited early\n${out}`));
      else finish();
    });
    child.on('error', () => finish());
    setTimeout(() => {
      if (!done) {
        finish();
        reject(new Error(`timed out\n${out}`));
      }
    }, 90_000);
  });

const parsePerf = (out) => {
  const lines = out.split('\n').filter((l) => l.includes('[perf]') || l.includes('PERF_SEED_DONE'));
  const result = {};
  for (const line of lines) {
    let m = line.match(/\[perf\] (\S+) (\d+)ms/);
    if (m) result[m[1]] = Number(m[2]);
    m = line.match(/\[perf\] (\S+) (\d+)MB/);
    if (m) result[m[1]] = Number(m[2]);
  }
  return result;
};

const milestones = Object.keys({ 'main-init': 0, 'main-window-load': 0, 'dock-window-load': 0, booted: 0, loaded: 0, 'main-mem': 0, 'renderer-mem': 0 });

console.log(`Seeding ${noteCount} notes in ${scratchDir}`);
await runApp({ NOCK_PERF_SEED: String(noteCount) }, 'PERF_SEED_DONE');
console.log('  seed done');

const samples = [];
await runApp({}, 'PERF_DONE'); // warm-up (cold OS/disk caches after the seed build)
for (let r = 0; r < runs; r++) {
  const out = await runApp({}, 'PERF_DONE');
  const m = parsePerf(out);
  samples.push(m);
  console.log(`run ${r + 1}: ` + milestones.map((k) => `${k}=${m[k] ?? '-'}ms`).join('  '));
}

const avg = (k) => Math.round(samples.reduce((a, s) => a + (s[k] ?? NaN), 0) / samples.length);
console.log(`\naverage (${runs} runs): ` + milestones.map((k) => `${k}=${Number.isNaN(avg(k)) ? '-' : avg(k)}ms`).join('  '));