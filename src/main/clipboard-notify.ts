/**
 * Native clipboard-change notifications (Windows).
 *
 * Primary: a koffi-backed worker thread that registers a hidden message-only
 * window with AddClipboardFormatListener and pumps WM_CLIPBOARDUPDATE —
 * event-driven, zero polling, zero CPU while idle.
 *
 * Fallback: a hidden PowerShell WinForms process using the same Win32
 * notification API, in case the FFI module cannot be loaded.
 */
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';

export type ClipboardNotifySource = 'koffi' | 'powershell' | 'none';

let worker: Worker | null = null;
let workerThreadId = 0;
let ps: ChildProcess | null = null;
let psRestarts = 0;
let onChange: (() => void) | null = null;
let stopping = false;
let source: ClipboardNotifySource = 'none';

function startWorker(): void {
  const workerPath = path.join(__dirname, 'clipboard-worker.js');
  const w = new Worker(workerPath);
  worker = w;
  w.on('message', (m: { type: string; message?: string; threadId?: number }) => {
    if (m.type === 'change') {
      onChange?.();
    } else if (m.type === 'ready') {
      workerThreadId = m.threadId ?? 0;
    } else if (m.type === 'error') {
      console.log('[clipboard-notify] worker error:', m.message);
      if (!stopping) fallbackToPowerShell();
    } else if (m.type === 'exiting' && !stopping) {
      console.log('[clipboard-notify] worker exited unexpectedly');
      if (!stopping) fallbackToPowerShell();
    }
  });
  w.on('error', (e) => {
    console.log('[clipboard-notify] worker crashed:', e.message);
    if (!stopping) fallbackToPowerShell();
  });
  w.on('exit', () => {
    worker = null;
  });
}

function fallbackToPowerShell(): void {
  if (source !== 'koffi' || stopping) return;
  stopWorkerOnly();
  try {
    startPowerShell();
    source = 'powershell';
    console.log('[clipboard-notify] using PowerShell clipboard watcher');
  } catch (e) {
    console.log('[clipboard-notify] PowerShell watcher failed too:', e);
    source = 'none';
  }
}

function startPowerShell(): void {
  const script =
    app.isPackaged
      ? path.join(process.resourcesPath, 'clipboard-watch.ps1')
      : path.join(app.getAppPath(), 'scripts', 'clipboard-watch.ps1');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  ps = child;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (line.trim() === 'CHANGE') onChange?.();
  });
  child.stderr.on('data', (d) => console.log('[clipboard-notify] ps stderr:', String(d)));
  child.on('exit', (code) => {
    ps = null;
    if (!stopping) {
      console.log('[clipboard-notify] PowerShell watcher exited', code);
      // Respawn (bounded) — a transient failure must not kill the feature.
      if (psRestarts < 5) {
        psRestarts++;
        try {
          startPowerShell();
        } catch {
          /* give up */
        }
      } else {
        source = 'none';
      }
    }
  });
}

/**
 * Gracefully stop the koffi worker: post WM_QUIT to its message-loop thread so
 * GetMessageW returns, then terminate as a last resort. worker.terminate()
 * alone must not be used — a thread blocked inside GetMessageW cannot be
 * interrupted, and an awaited terminate would hang app shutdown.
 */
function stopWorkerOnly(): void {
  const w = worker;
  worker = null;
  if (!w) return;
  const threadId = workerThreadId;
  workerThreadId = 0;
  if (threadId) {
    try {
      // WM_QUIT unblocks the worker's message pump; it then exits cleanly.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const koffi = require('koffi');
      const user32 = koffi.load('user32.dll');
      const postThreadMessageW = user32.func(
        'int PostThreadMessageW(uint32_t idThread, uint32_t msg, intptr_t wParam, intptr_t lParam)',
      );
      postThreadMessageW(threadId, 0x0012 /* WM_QUIT */, 0n, 0n);
      setTimeout(() => {
        try {
          if (w && w.threadId !== undefined) w.terminate();
        } catch {
          /* ignore */
        }
      }, 1500).unref();
      return;
    } catch {
      /* koffi unavailable — fall through to terminate */
    }
  }
  try {
    w.terminate();
  } catch {
    /* ignore */
  }
}

/** Starts the OS clipboard-change notifier. Call once after app ready. */
export function startClipboardNotify(cb: () => void): ClipboardNotifySource {
  if (source !== 'none') return source;
  onChange = cb;
  stopping = false;
  if (process.platform !== 'win32') return 'none';
  try {
    startWorker();
    source = 'koffi';
    console.log('[clipboard-notify] koffi clipboard watcher started');
  } catch (e) {
    console.log('[clipboard-notify] koffi unavailable:', e);
    try {
      startPowerShell();
      source = 'powershell';
    } catch (e2) {
      console.log('[clipboard-notify] PowerShell watcher failed too:', e2);
      source = 'none';
    }
  }
  return source;
}

/** Stops the notifier. Safe to call when never started. */
export function stopClipboardNotify(): void {
  stopping = true;
  stopWorkerOnly();
  const p = ps;
  ps = null;
  if (p) {
    try {
      p.kill();
    } catch {
      /* ignore */
    }
  }
}

export function getClipboardNotifySource(): ClipboardNotifySource {
  return source;
}
