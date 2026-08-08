import { BrowserWindow } from 'electron';
import type { DockConfig, NoteContentUpdate, PendingScreenshot, Settings } from '../shared/types';
import { DOCK_DEFAULT_WIDTH, DOCK_COLLAPSED_WIDTH } from '../shared/defaults';

interface Windows {
  main: BrowserWindow | null;
  dock: BrowserWindow | null;
}

const windows: Windows = { main: null, dock: null };

export const hub = {
  setMain(win: BrowserWindow | null) { windows.main = win; },
  setDock(win: BrowserWindow | null) { windows.dock = win; },
  get main() { return windows.main; },
  get dock() { return windows.dock; },
};

function sendTo(target: BrowserWindow | null, channel: string, payload: unknown): void {
  if (target && !target.isDestroyed()) target.webContents.send(channel, payload);
}

export const state = {
  activeNoteId: null as string | null,
  activeNoteSubjectId: null as string | null,
  pendingScreenshot: null as { buf: Buffer; capturedAt: number } | null,
  settings: null as Settings | null,
  lastVersionAt: new Map<string, number>(),
  dock: {
    open: false,
    noteId: null as string | null,
    side: 'right' as 'left' | 'right',
    width: DOCK_DEFAULT_WIDTH,
    height: 0,
    y: 0,
    topEdgeFree: false,
    collapsed: false,
    locked: false,
    opacity: 1,
    focusMode: false,
  } as DockConfig,

  setActiveNote(noteId: string | null, subjectId: string | null, source: 'main' | 'dock'): void {
    this.activeNoteId = noteId;
    this.activeNoteSubjectId = subjectId;
    sendTo(windows.main, 'sync:active-note', { noteId, source, from: 'dock' as const });
    sendTo(windows.dock, 'sync:active-note', { noteId, source, from: 'main' as const });
  },

  broadcastContent(noteId: string, content: string, updatedAt: number, from: 'main' | 'dock'): void {
    const payload: NoteContentUpdate & { from: string } = { noteId, content, updatedAt, from };
    if (from === 'main') sendTo(windows.dock, 'sync:note-content', payload);
    else sendTo(windows.main, 'sync:note-content', payload);
  },

  setPendingScreenshot(buf: Buffer | null): void {
    this.pendingScreenshot = buf ? { buf, capturedAt: Date.now() } : null;
    const payload: PendingScreenshot = {
      available: this.pendingScreenshot !== null,
      width: 0,
      height: 0,
      capturedAt: this.pendingScreenshot?.capturedAt ?? 0,
    };
    sendTo(windows.main, 'clipboard:state', payload);
    sendTo(windows.dock, 'clipboard:state', payload);
  },

  setSettings(s: Settings): void {
    this.settings = s;
    sendTo(windows.main, 'sync:settings', s);
    sendTo(windows.dock, 'sync:settings', s);
  },

  setDockConfig(patch: Partial<DockConfig>): DockConfig {
    this.dock = { ...this.dock, ...patch };
    const cfg = this.dock;
    sendTo(windows.main, 'dock:state', cfg);
    sendTo(windows.dock, 'dock:state', cfg);
    return cfg;
  },
};

export const dockConstants = {
  DOCK_MIN_WIDTH: 240,
  DOCK_MAX_WIDTH: 520,
  COLLAPSED: DOCK_COLLAPSED_WIDTH,
};
