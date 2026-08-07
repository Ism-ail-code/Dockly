// E2E smoke test: build, launch the app, run the scripted UI flow in the renderer,
// then evaluate the E2E_RESULT that the main process prints.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const userData = path.join(process.env.TEMP ?? root, 'dockly-e2e-userdata');

const child = spawn(electronExe, ['.', `--user-data-dir=${userData}`], {
  cwd: root,
  env: { ...process.env, DOCKLY_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (d) => (output += d.toString()));
child.stderr.on('data', (d) => (output += d.toString()));

const done = new Promise((resolve) => {
  child.on('exit', resolve);
  setTimeout(() => {
    child.kill();
    resolve(null);
  }, 30000);
});

await done;

const match = output.match(/E2E_RESULT (.+)/);
const errors = [];
for (const line of output.split('\n')) {
  if (/\[renderer:error\]/i.test(line) || /\[dock:error\]/i.test(line) || /Cannot find module/.test(line) || /UnhandledPromiseRejection/.test(line)) {
    errors.push(line.trim());
  }
}

console.log('--- output tail ---');
console.log(output.split('\n').slice(-25).join('\n'));
console.log('--- result ---');

let pass = errors.length === 0;
if (match) {
  let result;
  try {
    result = JSON.parse(match[1]);
  } catch {
    result = { raw: match[1] };
  }
  console.log('E2E_RESULT:', JSON.stringify(result, null, 2));
  if (result.error) pass = false;
  else if (result.onboardingDone && result.subjectCards >= 1 && result.noteCreated && result.searchHits >= 1 && result.dockOpen && result.versionCount >= 0) {
    console.log('E2E CHECKS PASSED');
  } else {
    console.log('E2E CHECKS FAILED (unexpected values)');
    pass = false;
  }
} else {
  console.log('No E2E_RESULT found');
  pass = false;
}

if (errors.length) {
  console.log('renderer errors:');
  for (const e of errors.slice(0, 10)) console.log(' •', e);
}

try {
  fs.rmSync(userData, { recursive: true, force: true });
} catch {}

process.exit(pass ? 0 : 1);
