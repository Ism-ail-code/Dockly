import { ipcMain, app, protocol, screen } from 'electron';
import * as db from './db';
import { state } from './state';
import {
  showDock,
  closeDock,
  getDockWindow,
  getMainWindow,
  showMainWindow,
  hideMainWindow,
  applyDockBounds,
  resizeDockTo,
  toggleDockCollapse,
  updateTitlebarTheme,
  setDockOnTop,
  setDockTransparency,
  applySpellChecker,
} from './windows';
import { setCaptureMode, getCaptureMode, isCaptureEligible, isWatcherActive } from './clipboard';
import { startDockAutoHidePoll, stopDockAutoHidePoll } from './autohide';
import { VERSION_INTERVAL_MS, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH } from '../shared/defaults';
import type { AccentColor, Settings } from '../shared/types';

function reply(_event: Electron.IpcMainInvokeEvent, fn: () => unknown): unknown {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    console.log('[ipc] error:', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function senderIsDock(event: Electron.IpcMainInvokeEvent): boolean {
  const win = getDockWindow();
  return !!win && !win.isDestroyed() && event.sender === win.webContents;
}

/** Apply native side-effects for preference changes — runs immediately, no restart needed. */
function applySettingsSideEffects(key: string, settings: Settings): void {
  updateTitlebarTheme(settings.theme);
  if (key === '*' || key === 'dockOnTop') setDockOnTop(settings.dockOnTop);
  if (key === '*' || key === 'dockAutoHide') {
    if (settings.dockAutoHide) startDockAutoHidePoll();
    else stopDockAutoHidePoll();
  }
  if (key === '*' || key === 'dockTransparencyEnabled' || key === 'dockTransparency') {
    setDockTransparency(settings.dockTransparencyEnabled, settings.dockTransparency);
  }
  if (key === '*' || key === 'focusMode') state.setDockConfig({ focusMode: settings.focusMode });
  if (key === '*' || key === 'spellCheck') applySpellChecker(settings.spellCheck);
  if (key === '*' || key === 'launchOnStartup') {
    app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup });
  }
}

export function registerIpc(): void {
  const handle = (channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => reply(event, () => fn(event, ...args)));
  };

  // ---------- app ----------
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, isDev: !app.isPackaged }));

  // ---------- subjects ----------
  handle('subjects:list', () => db.listSubjects());
  handle('subjects:create', (_e, data: { name: string; icon: string; color: AccentColor }) =>
    db.createSubject({ ...data, sortOrder: Date.now() }),
  );
  handle('subjects:update', (_e, id: string, patch: Record<string, unknown>) => db.updateSubject(id, patch as never));
  handle('subjects:delete', (_e, id: string) => db.deleteSubject(id));

  // ---------- notes ----------
  handle('notes:list', (_e, subjectId?: string, includeArchived?: boolean) => db.listNotes(subjectId, includeArchived));
  handle('notes:get', (e, id: string) => {
    const note = db.getNote(id);
    if (note) {
      const source = senderIsDock(e) ? 'dock' : 'main';
      state.setActiveNote(note.id, note.subjectId, source);
      state.setDockConfig({ noteId: note.id });
    }
    return note;
  });
  handle('notes:create', (_e, subjectId: string, title?: string) => {
    const note = db.createNote(subjectId, title ?? '');
    state.setDockConfig({ noteId: note.id });
    db.recordStat('note');
    return note;
  });
  handle('notes:update-meta', (_e, id: string, patch: Record<string, unknown>) => db.updateNoteMeta(id, patch as never));
  handle('notes:content-save', (e, id: string, content: string | Record<string, unknown>) => {
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    const note = db.saveNoteContent(id, text);
    if (note) {
      const from = senderIsDock(e) ? 'dock' : 'main';
      state.broadcastContent(id, text, note.updatedAt, from);
      const last = state.lastVersionAt.get(id) ?? 0;
      if (Date.now() - last > VERSION_INTERVAL_MS) {
        db.pushVersion(id, text, note.updatedAt);
        state.lastVersionAt.set(id, Date.now());
      }
      db.recordStat('edit');
    }
    return note;
  });
  handle('notes:delete', (_e, id: string) => {
    db.deleteNote(id);
    if (state.activeNoteId === id) state.setActiveNote(null, null, 'main');
  });
  handle('notes:duplicate', (_e, id: string) => db.duplicateNote(id));
  handle('notes:set-favorite', (_e, id: string, fav: boolean) => db.updateNoteMeta(id, { isFavorite: fav }));
  handle('notes:archive', (_e, id: string, archived: boolean) => db.updateNoteMeta(id, { isArchived: archived }));

  // ---------- versions ----------
  handle('versions:list', (_e, noteId: string) => db.listVersions(noteId));
  handle('versions:restore', (_e, noteId: string, versionId: number) => {
    const version = db.getVersion(versionId);
    if (!version) return null;
    const note = db.saveNoteContent(noteId, version.content);
    if (note) {
      state.broadcastContent(noteId, version.content, note.updatedAt, 'main');
      db.pushVersion(noteId, note.content, Date.now());
    }
    return note;
  });

  // ---------- search ----------
  handle('search', (_e, q: string, scope: 'all' | 'favorites' | 'archived') => db.searchNotes(q, scope));

  // ---------- screenshots ----------
  handle('screenshot:save', (_e, noteId: string, pngBase64: string) => {
    const meta = db.saveScreenshot(noteId, Buffer.from(pngBase64, 'base64'));
    db.recordStat('shot');
    return { id: meta.id, fileName: meta.fileName };
  });
  handle('screenshot:read', (_e, fileName: string) => {
    const buf = db.readScreenshotFile(fileName);
    return buf ? `data:image/png;base64,${buf.toString('base64')}` : null;
  });
  handle('screenshot:replace', (_e, fileName: string, pngBase64: string) => {
    return db.replaceScreenshot(fileName, Buffer.from(pngBase64, 'base64'));
  });

  // ---------- settings ----------
  handle('settings:get', () => db.getSettings());
  handle('settings:set', (_e, key: string, value: unknown) => {
    const settings = db.setSetting(key as keyof Settings, value as never);
    state.setSettings(settings);
    applySettingsSideEffects(key as string, settings);
    return settings;
  });
  handle('settings:reset', () => {
    const settings = db.resetSettings();
    state.setSettings(settings);
    applySettingsSideEffects('*', settings);
    return settings;
  });
  handle('stats:today', () => db.getTodayStats());

  // ---------- clipboard capture mode (renderer reports where Dockly is) ----------
  handle('clipboard:set-capture-mode', (e, mode: 'off' | 'editor' | 'awaiting') => {
    setCaptureMode(mode, senderIsDock(e) ? 'dock' : 'main');
    return getCaptureMode();
  });

  // ---------- dock ----------
  handle('dock:open', (_e, noteId: string | null) => {
    if (noteId) state.setDockConfig({ noteId });
    showDock();
    return state.dock;
  });
  handle('dock:close', () => {
    closeDock();
    return state.dock;
  });
  handle('dock:set-side', (_e, side: 'left' | 'right') => {
    state.setDockConfig({ side });
    applyDockBounds();
    if (state.settings?.dockRememberPosition) {
      const settings = db.setSetting('dockSide', side);
      state.setSettings(settings);
    }
    return state.dock;
  });
  handle('dock:set-width', (_e, width: number) => {
    resizeDockTo(width);
    if (state.settings?.dockRememberWidth) {
      const clamped = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(width)));
      const settings = db.setSetting('dockWidth', clamped);
      state.setSettings(settings);
    }
    return state.dock;
  });
  // Two-dimensional resize: renderer reports the raw drag target plus which
  // vertical edge is fixed ('top' = bottom edge dragged, 'bottom' = top edge dragged).
  handle('dock:set-size', (_e, width: number, height: number, fixed: 'top' | 'bottom' = 'top') => {
    resizeDockTo(width, height, fixed);
    if (state.settings?.dockRememberWidth) {
      const settings = db.setSetting('dockWidth', state.dock.width);
      state.setSettings(settings);
    }
    if (state.settings?.dockRememberHeight) {
      const settings = db.setSetting('dockHeight', state.dock.height);
      state.setSettings(settings);
    }
    return state.dock;
  });
  handle('dock:toggle-collapse', () => {
    toggleDockCollapse();
    return state.dock;
  });
  handle('dock:set-locked', (_e, locked: boolean) => {
    const win = getDockWindow();
    if (win && !win.isDestroyed()) win.setMovable(!locked);
    state.setDockConfig({ locked });
    return state.dock;
  });
  handle('dock:set-opacity', (_e, opacity: number) => {
    const clamped = Math.max(0.2, Math.min(1, opacity));
    const settings = db.setSetting('dockTransparency', clamped);
    state.setSettings(settings);
    applySettingsSideEffects('dockTransparency', settings);
    return state.dock;
  });
  handle('dock:toggle-focus', () => {
    const next = !state.dock.focusMode;
    state.setDockConfig({ focusMode: next });
    const settings = db.setSetting('focusMode', next);
    state.setSettings(settings);
    return state.dock;
  });
  handle('dock:set-on-top', (_e, on: boolean) => {
    // Persist so it survives restarts, then apply at the native level.
    const settings = db.setSetting('dockOnTop', Boolean(on));
    state.setSettings(settings);
    setDockOnTop(Boolean(on));
    return state.dock;
  });
  handle('dock:get-state', () => state.dock);
  handle('dock:minimize', () => {
    const win = getDockWindow();
    if (win && !win.isDestroyed()) win.minimize();
  });

  // ---------- window controls (main) ----------
  handle('window:minimize', () => getMainWindow()?.minimize());
  handle('window:restore', () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  handle('window:open-main', (_e, view?: string) => {
    showMainWindow(typeof view === 'string' ? view : 'dashboard');
  });
  handle('window:hide', () => hideMainWindow());
  handle('window:maximize', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  handle('window:close', () => getMainWindow()?.close());

  // ---------- native runtime diagnostics (used by QA harness) ----------
  handle('app:runtime-state', () => {
    const m = getMainWindow();
    const d = getDockWindow();
    return {
      main:
        m && !m.isDestroyed()
          ? {
              focused: m.isFocused(),
              visible: m.isVisible(),
              minimized: m.isMinimized(),
              maximized: m.isMaximized(),
              alwaysOnTop: m.isAlwaysOnTop(),
              bounds: m.getBounds(),
            }
          : null,
      dock:
        d && !d.isDestroyed()
          ? {
              focused: d.isFocused(),
              visible: d.isVisible(),
              minimized: d.isMinimized(),
              alwaysOnTop: d.isAlwaysOnTop(),
              movable: d.isMovable(),
              bounds: d.getBounds(),
            }
          : null,
      capture: { mode: getCaptureMode(), eligible: isCaptureEligible(), active: isWatcherActive() },
      display: { workArea: screen.getPrimaryDisplay().workArea },
    };
  });

  // ---------- misc ----------
  handle('dockly:clear-pending-screenshot', () => state.setPendingScreenshot(null));
}

export function registerProtocol(): void {
  protocol.handle('dockly-shot', (request) => {
    const url = new URL(request.url);
    const fileName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const buf = db.readScreenshotFile(fileName);
    if (!buf) return new Response('not found', { status: 404 });
    return new Response(buf, {
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    });
  });
}
