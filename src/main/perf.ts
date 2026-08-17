// Performance measurement harness (QA only — NOCK_PERF=1).
//
//   NOCK_PERF_SEED=<count> — seed a scratch database with <count> notes, then exit.
//   NOCK_PERF=1 (measure)  — boot normally against a seeded database and log
//     [perf] lines: main-process init, window loads, renderer paint times, and
//     heap usage, all relative to whenReady. Prints PERF_DONE once every
//     milestone is in (or after a hard cap); the benchmark script then kills
//     the app.
//
// Used by scripts/perf.mjs. Never runs in normal use.

import { BrowserWindow } from 'electron';
import { seedNotesForPerf } from './db';

const T0 = Date.now();

const ms = (): number => Date.now() - T0;

let perfWin: BrowserWindow | null = null;
const collected = new Set<string>();
const FINISH_MARKERS = ['main-window-load', 'dock-window-load', 'booted', 'loaded'];

function logPerf(label: string, value: number): void {
  collected.add(label);
  console.log(`[perf] ${label} ${value}ms`);
  if (FINISH_MARKERS.every((m) => collected.has(m))) {
    // Settle, then sample heap usage from both processes before finishing.
    setTimeout(() => {
      const mainMem = Math.round(process.memoryUsage().heapUsed / 1048576);
      console.log(`[perf] main-mem ${mainMem}MB`);
      const win = perfWin;
      if (!win || win.isDestroyed()) {
        console.log('PERF_DONE');
        return;
      }
      void win.webContents
        .executeJavaScript(`Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576)`)
        .then((v: number) => {
          console.log(`[perf] renderer-mem ${v}MB`);
          console.log('PERF_DONE');
        })
        .catch(() => console.log('PERF_DONE'));
    }, 600);
  }
}

export function runPerfSeed(count: number): void {
  seedNotesForPerf(count);
  console.log('PERF_SEED_DONE');
  process.exit(0);
}

/** Boot a main/dock window and log the moment its DOM finished loading. */
export function watchWindowLoad(name: string, win: BrowserWindow): void {
  win.webContents.once('did-finish-load', () => {
    logPerf(`${name}-window-load`, ms());
  });
}

/**
 * Poll the main window's DOM for readiness milestones:
 *  booted  — .app-root exists (first usable UI after the boot screen)
 *  loaded  — dashboard subject cards AND note cards are painted (data ready)
 */
export function watchRendererReady(win: BrowserWindow): void {
  perfWin = win;
  const poll = (selector: string, label: string): void => {
    const tryOnce = (): void => {
      if (win.isDestroyed()) {
        logPerf(`${label}-skipped`, ms());
        return;
      }
      void win.webContents
        .executeJavaScript(`!!document.querySelector('${selector}')`)
        .then((found: boolean) => {
          if (found) {
            logPerf(label, ms());
            return;
          }
          setTimeout(tryOnce, 40);
        })
        .catch(() => setTimeout(tryOnce, 40));
    };
    tryOnce();
  };
  poll('.app-root', 'booted');
  poll('.subject-card, .note-card', 'loaded');
}

/** Log init completion. Hard cap: emit PERF_DONE so the runner never waits forever. */
export function startPerfMeasurement(win: BrowserWindow): void {
  console.log(`[perf] main-init ${ms()}ms`);
  watchWindowLoad('main', win);
  watchRendererReady(win);
  setTimeout(() => {
    console.log('PERF_DONE');
  }, 20_000);
}
