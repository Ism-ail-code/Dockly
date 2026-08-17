import { clipboard, BrowserWindow } from 'electron';
import { state } from './state';
import { getMainWindow, getDockWindow } from './windows';
import { startClipboardNotify, stopClipboardNotify, getClipboardNotifySource } from './clipboard-notify';

export type CaptureMode = 'off' | 'editor' | 'awaiting';

/**
 * Clipboard handling — Windows clipboard-change notifications.
 *
 * The OS notifier (AddClipboardFormatListener / WM_CLIPBOARDUPDATE via a
 * koffi worker thread, PowerShell fallback) reports every clipboard change;
 * this module reacts event-driven. Nothing here polls the clipboard.
 *
 * Two independent captures can happen on a change:
 *
 *  1. Screenshots — only consumed while the user is actually working in a
 *     Nock window (focused, visible, note/annotator open). If Nock is
 *     not focused when the image lands, it is remembered and delivered the
 *     moment the user returns to Nock (bounded window).
 *
 *  2. Copied text (Ctrl + C) — captured while the user works in OTHER
 *     applications, as long as the dock (or the main editor) has an active
 *     note and the "Auto Capture Copied Text" setting is enabled. Copies made
 *     inside Nock itself are recognized and ignored (no feedback loops).
 */

const modes: Record<'main' | 'dock', CaptureMode> = { main: 'off', dock: 'off' };
let lastSig = '';
let lastTextSig = '';
let active = false;

// ----- Windows 10 data-race retry -----
// WM_CLIPBOARDUPDATE can arrive before the clipboard data is actually
// readable (Snipping Tool / Win+Shift+S deliver image data asynchronously).
// On Windows 11 the data is usually available immediately, which is why the
// race shows up on Windows 10. Bounded, event-driven retries (never a
// background poll) cover the gap with no idle cost.
let pendingRetries = 0;
let retryTimer: NodeJS.Timeout | null = null;
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 120;

// ----- last-resort sequence poller -----
// Only active when no native clipboard notifier is available (koffi worker
// dead AND PowerShell fallback unavailable). Reads GetClipboardSequenceNumber
// once per second — a single kernel counter, no clipboard content, no window
// handles — so it touches nothing sensitive and costs ~nothing.
let seqPoller: NodeJS.Timeout | null = null;
let lastSeq = 0;

// ----- screenshot delivery state -----
// When an image lands while no Nock window is focused, we remember it and
// deliver once the user returns (or give up after a bounded time).
let pendingImgSig = '';
let pendingImgAt = 0;
let pendingImgTimer: NodeJS.Timeout | null = null;
const PENDING_IMAGE_LIFETIME_MS = 60_000;

// ----- self-copy guard -----
// Renderers report DOM `copy` events that originate inside Nock. Combined
// with the focused-window check, this ensures Nock never re-captures text
// that it copied itself.
let lastSelfCopyAt = 0;
const SELF_COPY_WINDOW_MS = 1200;

function signature(buf: Buffer): string {
  let h = 0x811c9dc5;
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) h = ((h ^ buf[i]) * 0x01000193) >>> 0;
  return `${h.toString(36)}:${buf.length}`;
}

function textSignature(text: string): string {
  let h = 0x811c9dc5;
  const n = Math.min(text.length, 2048);
  for (let i = 0; i < n; i++) h = ((h ^ text.charCodeAt(i)) * 0x01000193) >>> 0;
  return `${h.toString(36)}:${text.length}`;
}

export function setCaptureMode(mode: CaptureMode, source: 'main' | 'dock'): void {
  modes[source] = mode;
}

/** The active, foreground Nock window the user is working in — or null. */
function activeForegroundWindow(): BrowserWindow | null {
  const main = getMainWindow();
  const dock = getDockWindow();
  if (main && !main.isDestroyed() && main.isVisible() && !main.isMinimized() && main.isFocused()) {
    return main;
  }
  if (dock && !dock.isDestroyed() && dock.isVisible() && !dock.isMinimized() && dock.isFocused()) {
    return dock;
  }
  return null;
}

/** The mode of whichever Nock window is focused and visible right now. */
export function getCaptureMode(): CaptureMode {
  const fg = activeForegroundWindow();
  if (!fg) return 'off';
  return fg === getDockWindow() ? modes.dock : modes.main;
}

export function isCaptureEligible(): boolean {
  return getCaptureMode() !== 'off';
}

export function isWatcherActive(): boolean {
  return active;
}

/** Mode of a specific Nock window regardless of focus (used by the watcher). */
function modeOf(target: BrowserWindow | null): CaptureMode {
  if (!target) return 'off';
  return target === getDockWindow() ? modes.dock : modes.main;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Starts the event-driven clipboard listener. Call once after app ready. */
export function initClipboardListener(): void {
  if (active) return;
  active = true;
  primeSignature();

  const source = startClipboardNotify(onClipboardChanged);
  if (source === 'none') {
    console.log('[clipboard] no native clipboard notifier available — capture disabled');
    startSequencePoller();
  }

  // If a screenshot is waiting for a focused Nock window, deliver it the
  // moment the user returns — no polling involved. Windows may be created
  // after this call, so the hooks are re-attached on every change event too.
  ensureFocusHooks();
}

// ---------------------------------------------------------------------------
// Last-resort sequence poller. Fires only when every native clipboard-change
// notifier has failed; re-evaluated on every poll so a notifier that comes
// back later (e.g. the PowerShell watcher respawning) disables the poller.
// ---------------------------------------------------------------------------

function startSequencePoller(): void {
  if (seqPoller) return;
  let getSeq: (() => number) | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    getSeq = user32.func('uint32_t GetClipboardSequenceNumber()');
  } catch (e) {
    console.log('[clipboard] koffi unavailable for sequence poller:', String(e));
    return;
  }
  if (!getSeq) return;
  try {
    lastSeq = getSeq();
  } catch {
    return;
  }
  seqPoller = setInterval(() => {
    if (!active || getClipboardNotifySource() !== 'none') return;
    let seq = 0;
    try {
      seq = getSeq();
    } catch {
      return;
    }
    if (seq !== lastSeq) {
      lastSeq = seq;
      onClipboardChanged();
    }
  }, 1000);
  seqPoller.unref();
  console.log('[clipboard] safety-net clipboard sequence poller started (1/s)');
}

function stopSequencePoller(): void {
  if (seqPoller) {
    clearInterval(seqPoller);
    seqPoller = null;
  }
}

// Focus hooks for deferred screenshot delivery. Kept in a Set keyed by window
// so windows created after boot (e.g. the dock) are picked up automatically.
const focusHooked = new Set<BrowserWindow>();
let onWindowFocus: () => void = () => {
  if (pendingImgSig) tryDeliverPendingImage();
};

function ensureFocusHooks(): void {
  for (const w of [getMainWindow(), getDockWindow()]) {
    if (!w || w.isDestroyed() || focusHooked.has(w)) continue;
    focusHooked.add(w);
    w.on('focus', onWindowFocus);
    w.on('closed', () => focusHooked.delete(w));
  }
}

export function stopClipboardListener(): void {
  active = false;
  stopClipboardNotify();
  stopSequencePoller();
  if (pendingImgTimer) clearTimeout(pendingImgTimer);
  pendingImgTimer = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  pendingRetries = 0;
}

// ---------------------------------------------------------------------------
// Change handler (event-driven)
// ---------------------------------------------------------------------------

function onClipboardChanged(): void {
  if (!active || retryTimer) return;
  ensureFocusHooks();

  // Windows 10 can notify before the data is readable — the first read often
  // comes back empty for screen snips. Bounded event-driven retries give the
  // source application time to publish the data; nothing here polls.
  const imageReadable = readAndHandleImage();
  const textReadable = readAndHandleText();

  if (!imageReadable && !textReadable && pendingRetries < MAX_RETRIES) {
    pendingRetries++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      onClipboardChanged();
    }, RETRY_DELAY_MS);
    return;
  }
  pendingRetries = 0;
}

// ----- screenshots -----

/** Reads the clipboard image and handles it. True when image data was present. */
function readAndHandleImage(): boolean {
  let img;
  try {
    img = clipboard.readImage();
  } catch {
    /* clipboard can throw when locked */
    return false;
  }
  if (img.isEmpty()) return false;
  handleImageCapture(img);
  return true;
}

function handleImageCapture(img: Electron.NativeImage): void {
  const png = img.toPNG();
  const sig = signature(png);
  const ignoreDupes = state.settings?.ignoreDuplicateClipboard ?? true;

  // Already waiting to deliver this exact image? Keep waiting.
  if (sig === pendingImgSig) return;
  // Same image as the last delivered capture? That is not a new capture.
  if (sig === lastSig && ignoreDupes) return;
  lastSig = sig;

  const fg = activeForegroundWindow();
  if (fg && modeOf(fg) !== 'off') {
    deliverScreenshot(fg, png, img);
    return;
  }
  // Nock is not focused right now (the user is in another app). Remember the
  // image and deliver when they return to Nock.
  pendingImgSig = sig;
  pendingImgAt = Date.now();
  if (pendingImgTimer) clearTimeout(pendingImgTimer);
  pendingImgTimer = setTimeout(discardPendingImage, PENDING_IMAGE_LIFETIME_MS);
}

function tryDeliverPendingImage(): void {
  if (!pendingImgSig) return;
  if (Date.now() - pendingImgAt > PENDING_IMAGE_LIFETIME_MS) {
    discardPendingImage();
    return;
  }
  let img;
  try {
    img = clipboard.readImage();
  } catch {
    return;
  }
  if (img.isEmpty() || signature(img.toPNG()) !== pendingImgSig) {
    // The image is gone (or replaced) — nothing to deliver anymore.
    discardPendingImage();
    return;
  }
  const fg = activeForegroundWindow();
  if (!fg || modeOf(fg) === 'off') return; // still unfocused — keep waiting
  pendingImgSig = '';
  deliverScreenshot(fg, img.toPNG(), img);
}

function discardPendingImage(): void {
  pendingImgSig = '';
  if (pendingImgTimer) clearTimeout(pendingImgTimer);
  pendingImgTimer = null;
}

function deliverScreenshot(target: BrowserWindow, png: Buffer, img: Electron.NativeImage): void {
  if (pendingImgSig === signature(png)) pendingImgSig = '';
  const size = img.getSize();
  state.setPendingScreenshot(png);
  target.webContents.send('clipboard:image', {
    png: png.toString('base64'),
    width: size.width,
    height: size.height,
    capturedAt: Date.now(),
  });
}

// ----- copied text (Ctrl + C) -----

/** Which Nock window(s) should receive captured text right now. */
function textCaptureTargets(): BrowserWindow[] {
  const noteId = state.activeNoteId;
  if (!noteId) return [];

  const dock = getDockWindow();
  const dockActive =
    dock &&
    !dock.isDestroyed() &&
    dock.isVisible() &&
    !dock.isMinimized() &&
    state.dock.open &&
    !state.dock.collapsed &&
    state.dock.noteId === noteId &&
    modes.dock === 'editor';
  if (dockActive) return [dock as BrowserWindow];

  const main = getMainWindow();
  if (main && !main.isDestroyed() && main.isVisible() && !main.isMinimized() && modes.main === 'editor') {
    return [main];
  }
  return [];
}

/**
 * True when the clipboard change almost certainly originated inside Nock:
 * either a Nock window holds focus, or a Nock renderer reported a DOM
 * `copy` event moments ago. Such copies must never be captured again.
 */
function isSelfCopy(): boolean {
  if (Date.now() - lastSelfCopyAt < SELF_COPY_WINDOW_MS) return true;
  const main = getMainWindow();
  const dock = getDockWindow();
  for (const w of [main, dock]) {
    if (w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()) return true;
  }
  return false;
}

/** Reads the clipboard text and handles it. True when non-empty text was present. */
function readAndHandleText(): boolean {
  let text = '';
  try {
    text = clipboard.readText() ?? '';
  } catch {
    /* clipboard can throw when locked */
    return false;
  }
  text = text.trim();
  if (!text) return false;
  handleTextCapture(text);
  return true;
}

function handleTextCapture(text: string): void {
  // Remember every observed text so stale clipboard content is never treated
  // as a fresh capture later (including while the feature is switched off).
  const sig = textSignature(text);
  const isDup = sig === lastTextSig;
  lastTextSig = sig;

  const guards: Record<string, boolean> = {
    autoCaptureText: !state.settings?.autoCaptureText,
    isSelfCopy: isSelfCopy(),
    noActiveNote: !state.activeNoteId,
    isDup: isDup && (state.settings?.ignoreDuplicateClipboard ?? true),
  };
  if (process.env.NOCK_CLIP_TEST === '1') {
    console.log('[clipboard] change text=', JSON.stringify(text.slice(0, 40)), 'guards=', JSON.stringify(guards));
  }
  if (guards.autoCaptureText || guards.isSelfCopy || guards.noActiveNote || guards.isDup) return;

  const targets = textCaptureTargets();
  if (process.env.NOCK_CLIP_TEST === '1') {
    console.log('[clipboard] targets=', targets.length);
  }
  if (targets.length === 0) return;

  const payload = { text, noteId: state.activeNoteId, capturedAt: Date.now() };
  for (const t of targets) {
    if (!t.isDestroyed()) {
      if (process.env.NOCK_CLIP_TEST === '1') {
        console.log('[clipboard] sending clipboard:text to win id=%s destroyed=%s', t.webContents.id, t.isDestroyed());
      }
      t.webContents.send('clipboard:text', payload);
    }
  }
}

/** A renderer reported that the user copied text inside Nock. */
export function markSelfCopy(): void {
  lastSelfCopyAt = Date.now();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remember the content already on the clipboard at start time so we never
 *  treat something copied before Nock began watching as a new capture. */
function primeSignature(): void {
  try {
    const img = clipboard.readImage();
    if (!img.isEmpty()) lastSig = signature(img.toPNG());
  } catch {
    /* ignore */
  }
  try {
    const text = (clipboard.readText() ?? '').trim();
    if (text) lastTextSig = textSignature(text);
  } catch {
    /* ignore */
  }
}

export function resetClipboardSignature(): void {
  lastSig = '';
}

/** Diagnostics for the QA harness. */
export function clipboardDiagnostics(): {
  active: boolean;
  listener: string;
  modes: { main: CaptureMode; dock: CaptureMode };
  activeNoteId: string | null;
  dockNoteId: string | null;
  selfCopyWindowMs: number;
} {
  return {
    active,
    listener: getClipboardNotifySource(),
    modes: { main: modes.main, dock: modes.dock },
    activeNoteId: state.activeNoteId,
    dockNoteId: state.dock.noteId,
    selfCopyWindowMs: SELF_COPY_WINDOW_MS,
  };
}
