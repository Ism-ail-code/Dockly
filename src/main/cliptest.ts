/**
 * Clipboard capture end-to-end harness (scripts/cliptest.mjs).
 *
 * Runs inside the real app (built, real windows, real renderer) against a
 * scratch user-data dir. Two roles:
 *
 *  'setup'  â€” boot, open a note in the dock, simulate real clipboard changes
 *             (Ctrl+C in "another app", copies inside Dockly, screenshot),
 *             assert the event-driven capture delivers to the right window
 *             and that the renderer actually inserts + saves the text.
 *  'verify' â€” relaunch, confirm the captured text survived the restart and
 *             the feature settings persisted.
 *
 * Each step is deterministic: windows are blurred/focused explicitly, every
 * clipboard write uses a unique payload so duplicate-suppression can never
 * mask a bug, and the whole run relies on the OS clipboard-change notifier â€”
 * if the listener source is 'none', the harness fails loudly.
 */
import { app, clipboard, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { state } from './state';
import { getMainWindow, getDockWindow, showDock } from './windows';
import { createSubject, createNote, getNote, setSetting, screenshotCount } from './db';
import { setCaptureMode, markSelfCopy, clipboardDiagnostics } from './clipboard';

const RED_1PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

// Every run writes unique clipboard payloads: the OS clipboard is shared with
// the user's real session, and a leftover string from a previous run would
// trip the duplicate-suppression guard and mask a capture bug.
const RUN = Date.now().toString(36);
const S = {
  t1: `HELLO-E2E-T1-${RUN}-9123`,
  t2: `HELLO-E2E-T2-${RUN}-4182`,
  t3: `HELLO-E2E-T3-${RUN}-7731`,
  t4: `HELLO-E2E-T4-${RUN}-6652`,
  t5: `HELLO-E2E-T5-${RUN}-5501`,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function result(ok: boolean, extra: Record<string, unknown>): never {
  console.log('CLIP_E2E_RESULT ' + JSON.stringify({ ok, ...extra }));
  // app.exit() skips before-quit/will-quit/window-all-closed, so it cannot
  // deadlock against the app's shutdown handlers. If even that returns (it
  // should not), the synchronous taskkill below guarantees termination.
  try {
    app.exit(ok ? 0 : 1);
  } catch {
    /* ignore */
  }
  try {
    execFileSync('taskkill', ['/PID', String(process.pid), '/F', '/T'], { stdio: 'ignore' });
  } catch {
    /* already gone */
  }
  // Unreachable in practice â€” satisfies the `never` return type.
  throw new Error('unreachable');
}

function fail(message: string, extra: Record<string, unknown> = {}): never {
  console.log('[cliptest] FAIL:', message);
  return result(false, { step: message, ...extra });
}

function pass(extra: Record<string, unknown> = {}): never {
  return result(true, extra);
}

/** Wait for `cond` to become true (poll). Throws after `timeoutMs`. */
async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for ' + label);
    await sleep(80);
  }
}

/**
 * Main-process observation of mainâ†’renderer IPC.
 *
 * webContents.send() delivers to the renderer's ipcRenderer; the main side
 * does NOT emit an event for it. To observe what the renderer receives, the
 * harness wraps webContents.send and mirrors payloads into hook sets.
 */
type Hook = (payload: unknown) => void;
const hooks = new Map<string, Set<Hook>>();

function hookWindow(win: BrowserWindow): void {
  const wc = win.webContents;
  const orig = wc.send.bind(wc);
  wc.send = ((channel: string, payload?: unknown) => {
    const set = hooks.get(channel);
    if (set) for (const h of set) h(payload);
    return orig(channel, payload);
  }) as typeof orig;
}

/** Resolve on the next mainâ†’renderer send of `channel` (mirrored payload). */
function once(channel: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const handler: Hook = (payload) => {
      unregister();
      resolve(payload);
    };
    const unregister = () => {
      clearTimeout(t);
      hooks.get(channel)?.delete(handler);
    };
    const t = setTimeout(() => {
      unregister();
      reject(new Error('timeout waiting for ' + channel));
    }, timeoutMs);
    if (!hooks.has(channel)) hooks.set(channel, new Set());
    hooks.get(channel)!.add(handler);
  });
}

/** Assert no mainâ†’renderer send of `channel` arrives for `windowMs`. */
async function expectSilence(channel: string, windowMs: number): Promise<void> {
  let fired = false;
  const handler: Hook = () => {
    fired = true;
  };
  if (!hooks.has(channel)) hooks.set(channel, new Set());
  hooks.get(channel)!.add(handler);
  try {
    await sleep(windowMs);
  } finally {
    hooks.get(channel)?.delete(handler);
  }
  if (fired) throw new Error('unexpected event ' + channel);
}

interface Marker {
  noteId: string;
  subjectId: string;
  expected: string[];
}

function markerPath(): string {
  return path.join(app.getPath('userData'), 'clip-e2e-marker.json');
}

async function setupRole(): Promise<never> {
  const diag = clipboardDiagnostics();
  console.log('[cliptest] diagnostics:', JSON.stringify(diag));
  if (!diag.active) fail('clipboard listener not active', diag);
  if (diag.listener === 'none') fail('no clipboard-change notifier available', diag);

  // Feature on + a unique scratch subject/note.
  state.settings = setSetting('autoCaptureText', true);
  state.settings = setSetting('autoInsertScreenshots', true);
  const subject = createSubject({ name: 'E2E', icon: 'vial', color: 'violet', sortOrder: 0 });
  const note = createNote(subject.id, 'E2E Clipboard');
  console.log('[cliptest] note:', note.id);

  // Open the note in the dock (the app's real sticky-note surface) and let
  // the dock renderer load it.
  state.setDockConfig({ open: true, noteId: note.id, collapsed: false });
  state.setActiveNote(note.id, subject.id, 'dock');
  showDock();
  await sleep(3000);

  const dock = getDockWindow();
  const main = getMainWindow();
  if (!dock || dock.isDestroyed()) fail('dock window missing');
  if (!main || main.isDestroyed()) fail('main window missing');
  hookWindow(dock);
  hookWindow(main);

  // blur() does not reliably drop focus on Windows; hide the main window so
  // the only Dockly window in the focus equation is the dock.
  main.hide();

  // The main renderer reports 'editor' whenever a note is open; make sure the
  // main window never steals captures meant for the dock.
  setCaptureMode('editor', 'dock');
  setCaptureMode('off', 'main');
  await sleep(400);

  /** Make the dock visible but unfocused â€” i.e. "the user is in another app". */
  const makeExternal = async (): Promise<void> => {
    dock.hide();
    dock.showInactive();
    await sleep(350);
  };

  const tests: Array<[string, () => Promise<void>]> = [];

  // --- T1: text copied while the user works "in another app" â†’ captured
  tests.push(['text capture (dock)', async () => {
    await makeExternal();
    const p = once('clipboard:text', 8000);
    clipboard.writeText(S.t1);
    const payload = (await p) as { text: string; noteId: string | null };
    if (payload.text !== S.t1) throw new Error('wrong text payload');
    if (payload.noteId !== note.id) throw new Error('wrong noteId payload');
    // The dock renderer should have inserted + saved it.
    await waitFor(
      () => getNote(note.id)?.content?.includes(S.t1) ?? false,
      12000,
      'dock renderer to insert + save captured text',
    );
  }]);

  // --- T2: a copy made inside Dockly (focused window) â†’ ignored, no loop
  tests.push(['self-copy ignored (focused window)', async () => {
    dock.focus();
    await sleep(500);
    clipboard.writeText(S.t2);
    await expectSilence('clipboard:text', 1500);
    await makeExternal();
  }]);

  // --- T3: explicit self-copy mark (DOM copy event in an unfocused window)
  //         â†’ ignored even though the window is not focused
  tests.push(['self-copy ignored (markSelfCopy)', async () => {
    markSelfCopy();
    clipboard.writeText(S.t3);
    await expectSilence('clipboard:text', 1500);
  }]);

  // --- T4: capture disabled by setting â†’ nothing anywhere
  tests.push(['capture off when setting disabled', async () => {
    state.settings = setSetting('autoCaptureText', false);
    clipboard.writeText(S.t4);
    await expectSilence('clipboard:text', 1500);
    state.settings = setSetting('autoCaptureText', true);
  }]);

  // --- T5: duplicate clipboard content â†’ ignored
  tests.push(['duplicate copy ignored', async () => {
    const p = once('clipboard:text', 8000);
    clipboard.writeText(S.t5);
    await p;
    // Same content again â€” duplicate-suppression must swallow it.
    clipboard.writeText(S.t5);
    await expectSilence('clipboard:text', 1500);
  }]);

  // --- T6: screenshot while Dockly unfocused â†’ deferred, delivered on return
  tests.push(['screenshot deferred â†’ delivered on focus', async () => {
    const img = nativeImage.createFromBuffer(RED_1PX_PNG);
    if (img.isEmpty()) throw new Error('test image failed to decode');
    const before = screenshotCount(note.id);
    dock.hide();
    await sleep(400);
    clipboard.writeImage(img);
    await sleep(1800);
    if (screenshotCount(note.id) !== before) {
      throw new Error('screenshot delivered while unfocused â€” should have been deferred');
    }
    const p = once('clipboard:image', 8000);
    dock.show();
    dock.focus();
    await p;
    await waitFor(() => screenshotCount(note.id) === before + 1, 12000, 'dock renderer to save screenshot');
  }]);

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('[cliptest] PASS ' + name);
    } catch (e) {
      // fail() terminates the process synchronously — this catch only fires
      // when the harness's own expectations throw.
      fail(name + ': ' + String(e));
    }
  }

  // Persist what the renderer saved so the verify role can confirm restart
  // durability.
  const marker: Marker = {
    noteId: note.id,
    subjectId: subject.id,
    expected: [S.t1, S.t5],
  };
  fs.writeFileSync(markerPath(), JSON.stringify(marker, null, 2));
  const finalNote = getNote(note.id);
  pass({
    listener: diag.listener,
    noteTitle: finalNote?.title,
    wordCount: finalNote?.content?.length ?? 0,
    screenshotFiles: screenshotCount(note.id),
  });
}

async function verifyRole(): Promise<never> {
  const markerRaw = fs.readFileSync(markerPath(), 'utf8');
  const marker = JSON.parse(markerRaw) as Marker;
  const note = getNote(marker.noteId);
  if (!note) fail('note missing after restart');
  for (const s of marker.expected) {
    if (!note.content?.includes(s)) fail('captured text lost after restart', { missing: s });
  }
  if (!state.settings?.autoCaptureText) fail('autoCaptureText setting did not persist');
  pass({ noteTitle: note.title, persistedTexts: marker.expected.length });
}

export async function runClipboardE2E(role: 'setup' | 'verify'): Promise<void> {
  try {
    if (role === 'verify') await verifyRole();
    else await setupRole();
  } catch (e) {
    fail('harness crashed: ' + String(e));
  }
}

