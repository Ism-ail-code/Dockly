import { clipboard, BrowserWindow } from 'electron';
import { state } from './state';
import { getMainWindow, getDockWindow } from './windows';

export type CaptureMode = 'off' | 'editor' | 'awaiting';

/**
 * Capture mode is reported per window by each renderer:
 *  - 'editor'   - a note editor is open; auto-insert screenshots into the note.
 *  - 'awaiting' - Dockly is explicitly waiting for a screenshot (e.g. annotator open).
 *  - 'off'      - no note is active; Dockly must not consume the clipboard.
 *
 * With the sticky-note-first layout both the dock (primary workspace) and the
 * main window (library) can be in editor mode, so each window reports its own
 * mode and the clipboard watcher stays active while either is "hot".
 *
 * A screenshot is only ever consumed if the Dockly window that is currently
 * focused and visible is in an active mode. If the user is snipping for another
 * application - Dockly minimized, hidden, or simply not focused - the image is
 * silently skipped.
 */

const modes: Record<'main' | 'dock', CaptureMode> = { main: 'off', dock: 'off' };
let lastSig = '';
let lastTextSig = '';
let active = false;
let timer: NodeJS.Timeout | null = null;

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
  const anyActive = modes.main !== 'off' || modes.dock !== 'off';
  if (anyActive && !active) startClipboardWatcher();
  else if (!anyActive && active) stopClipboardWatcher();
}

/** The active, foreground Dockly window the user is working in — or null. */
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

/** The mode of whichever Dockly window is focused and visible right now. */
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

/** Mode of a specific Dockly window regardless of focus (used by the watcher). */
function modeOf(target: BrowserWindow | null): CaptureMode {
  if (!target) return 'off';
  return target === getDockWindow() ? modes.dock : modes.main;
}

function tick(): void {
  if (!active) return;
  const ignoreDupes = state.settings?.ignoreDuplicateClipboard ?? true;

  // A capture belongs to Dockly only if the user is looking at Dockly right now
  // AND the window they are looking at is in an active note context.
  const target = activeForegroundWindow();
  if (modeOf(target) === 'off') return;

  let img;
  try {
    img = clipboard.readImage();
  } catch {
    /* clipboard can throw when locked */
    return;
  }
  if (!img.isEmpty()) {
    const png = img.toPNG();
    const sig = signature(png);
    const duplicate = sig === lastSig;
    lastSig = sig;
    if (duplicate && ignoreDupes) return;

    if (!target) {
      // Consume silently while backgrounded — never leak into a note.
      state.setPendingScreenshot(null);
      return;
    }

    const size = img.getSize();
    state.setPendingScreenshot(png);
    target.webContents.send('clipboard:image', {
      png: png.toString('base64'),
      width: size.width,
      height: size.height,
      capturedAt: Date.now(),
    });
  }

  // Optional: capture copied text (Ctrl + C) into the active note.
  if (state.settings?.autoCaptureText) {
    let text = '';
    try {
      text = (clipboard.readText() ?? '').trim();
    } catch {
      /* ignore */
    }
    if (text) {
      const sig = textSignature(text);
      const duplicate = sig === lastTextSig;
      lastTextSig = sig;
      if (duplicate && ignoreDupes) return;
      if (!target) {
        state.setPendingScreenshot(null);
        return;
      }
      target.webContents.send('clipboard:text', { text, capturedAt: Date.now() });
    }
  }
}

/** Remember the image currently on the clipboard at start time so we never
 *  treat something a user copied before Dockly began watching as a new capture. */
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

export function startClipboardWatcher(): void {
  if (active) return;
  active = true;
  primeSignature();
  timer = setInterval(tick, 320);
}

export function stopClipboardWatcher(): void {
  active = false;
  if (timer) clearInterval(timer);
  timer = null;
}

export function resetClipboardSignature(): void {
  lastSig = '';
}