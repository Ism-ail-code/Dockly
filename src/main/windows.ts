import { BrowserWindow, screen, app } from 'electron';
import path from 'node:path';
import { state, hub } from './state';
import { DOCK_MIN_WIDTH, DOCK_MAX_WIDTH, DOCK_COLLAPSED_WIDTH, DOCK_DEFAULT_WIDTH } from '../shared/defaults';

const isDev = !app.isPackaged;
const RENDERER_URL = isDev ? process.env.VITE_DEV_SERVER_URL ?? '' : '';
const DIST = path.join(__dirname, '..', '..', 'dist');

export function mainWindowUrl(): string {
  if (RENDERER_URL) return RENDERER_URL;
  return `file://${path.join(DIST, 'renderer', 'index.html').replace(/\\/g, '/')}`;
}

export function dockWindowUrl(): string {
  if (RENDERER_URL) return RENDERER_URL.replace(/\/$/, '') + '/dock.html';
  return `file://${path.join(DIST, 'renderer', 'dock.html').replace(/\\/g, '/')}`;
}

let mainWin: BrowserWindow | null = null;
let dockWin: BrowserWindow | null = null;

function titlebarColors(theme: string): { color: string; symbolColor: string } {
  const dark = theme !== 'light';
  return { color: '#00000000', symbolColor: dark ? '#E9ECF4' : '#1F2430' };
}

export function createMainWindow(theme: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    title: 'Dockly',
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    titleBarStyle: 'hidden',
    titleBarOverlay: titlebarColors(theme),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: state.settings?.spellCheck ?? false,
      backgroundThrottling: false,
    },
  });
  win.loadURL(mainWindowUrl());
  // Dockly is sticky-note-first: the main window is the management "library" and
  // only appears on demand (dashboard/settings buttons in the dock, or second
  // instance). It is created at boot so navigation is instant, but never shown.
  win.on('minimize', () => console.log('[lifecycle] main minimized'));
  win.on('restore', () => console.log('[lifecycle] main restored'));
  win.on('close', () => {
    console.log('[lifecycle] main window close event');
    hub.setMain(null);
    mainWin = null;
  });
  win.on('closed', () => {
    console.log('[lifecycle] main window closed');
    if (hub.dock === win) hub.setDock(null);
    mainWin = null;
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[lifecycle] main renderer gone:', details.reason);
    if (!win.isDestroyed()) {
      try { win.webContents.reload(); } catch { /* ignore */ }
    }
  });
  win.webContents.on('console-message', (_e, level, message) => {
    const tag = ['log', 'warn', 'error'][level] ?? 'log';
    console.log(`[renderer:${tag}]`, message);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin = win;
  hub.setMain(win);
  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWin;
}

export function showMainWindow(view?: string): void {
  let win = mainWin;
  if (!win || win.isDestroyed()) win = createMainWindow(state.settings?.theme ?? 'dark');
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const safe = ['dashboard', 'subject', 'editor', 'settings', 'archive'].includes(view ?? '') ? view : undefined;
  if (safe) win.webContents.send('view:navigate', safe);
}

export function hideMainWindow(): void {
  if (mainWin && !mainWin.isDestroyed()) mainWin.hide();
}

export function updateTitlebarTheme(theme: string): void {
  if (mainWin) {
    try { mainWin.setTitleBarOverlay(titlebarColors(theme)); } catch { /* older electron */ }
  }
}

// ---------- Dock window ----------

function workArea(): Electron.Rectangle {
  const area = screen.getPrimaryDisplay().workArea;
  return area;
}

function dockTargetBounds(): Electron.Rectangle {
  const area = workArea();
  const width = state.dock.collapsed ? DOCK_COLLAPSED_WIDTH : state.dock.width;
  const x = state.dock.side === 'left' ? area.x : area.x + area.width - width;
  return { x, y: area.y, width, height: area.height };
}

export function createDockWindow(): BrowserWindow {
  // Persisted preferences decide position/width/transparency/focus before first paint.
  const s = state.settings;
  if (s?.dockRememberPosition && s.dockSide === 'left') state.setDockConfig({ side: 'left' });
  const rememberedWidth = s?.dockRememberWidth
    ? Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(s.dockWidth ?? DOCK_DEFAULT_WIDTH)))
    : DOCK_DEFAULT_WIDTH;
  state.setDockConfig({ width: rememberedWidth, focusMode: s?.focusMode ?? false });

  // Persisted preference decides whether the dock starts pinned (default: always on top).
  const onTop = s?.dockOnTop ?? true;
  const win = new BrowserWindow({
    ...dockTargetBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: !state.dock.locked,
    alwaysOnTop: onTop,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    roundedCorners: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: s?.spellCheck ?? false,
    },
  });
  if (onTop) win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const opacity = s?.dockTransparencyEnabled ? Math.max(0.4, Math.min(1, s.dockTransparency ?? 1)) : 1;
  win.setOpacity(opacity);
  state.setDockConfig({ onTop, opacity });
  win.loadURL(dockWindowUrl());
  win.webContents.on('console-message', (_e, level, message) => {
    const tag = ['log', 'warn', 'error'][level] ?? 'log';
    console.log(`[dock:${tag}]`, message);
  });
  win.on('closed', () => {
    hub.setDock(null);
    dockWin = null;
    state.setDockConfig({ open: false });
  });
  dockWin = win;
  hub.setDock(win);
  return win;
}

export function getDockWindow(): BrowserWindow | null {
  return dockWin;
}

let tweenTimer: NodeJS.Timeout | null = null;

export function tweenDockWidth(to: number, duration = 220): void {
  const win = dockWin;
  if (!win || win.isDestroyed()) return;
  const from = win.getBounds();
  const start = Date.now();
  if (tweenTimer) clearInterval(tweenTimer);
  const ease = (t: number): number => 1 - Math.pow(1 - t, 3);
  tweenTimer = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / duration);
    const width = Math.round(from.width + (to - from.width) * ease(t));
    const side = state.dock.side;
    const area = workArea();
    const x = side === 'left' ? area.x : area.x + area.width - width;
    win.setBounds({ x, y: area.y, width, height: area.height }, false);
    if (t >= 1 && tweenTimer) {
      clearInterval(tweenTimer);
      tweenTimer = null;
    }
  }, 16);
}

export function applyDockBounds(): void {
  const win = dockWin;
  if (!win || win.isDestroyed()) return;
  const b = dockTargetBounds();
  win.setBounds(b, false);
}

export function resizeDockTo(width: number): void {
  const win = dockWin;
  if (!win || win.isDestroyed()) return;
  const clamped = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(width)));
  state.setDockConfig({ width: clamped });
  const area = workArea();
  const x = state.dock.side === 'left' ? area.x : area.x + area.width - clamped;
  win.setBounds({ x, y: area.y, width: clamped, height: area.height }, false);
}

export function toggleDockCollapse(): void {
  const next = !state.dock.collapsed;
  state.setDockConfig({ collapsed: next });
  const target = next ? DOCK_COLLAPSED_WIDTH : state.dock.width;
  tweenDockWidth(target, 260);
  if (next) {
    const win = dockWin;
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(false);
  }
}

export function setDockOnTop(on: boolean): void {
  const win = dockWin;
  if (win && !win.isDestroyed()) {
    // 'screen-saver' is the highest window level — stays above full-screen apps too.
    win.setAlwaysOnTop(!!on, on ? 'screen-saver' : 'normal');
  }
  state.setDockConfig({ onTop: !!on });
}

/** Applies the persisted transparency preference to the dock window live. */
export function setDockTransparency(enabled: boolean, value: number): void {
  const opacity = enabled ? Math.max(0.4, Math.min(1, value)) : 1;
  const win = dockWin;
  if (win && !win.isDestroyed()) win.setOpacity(opacity);
  state.setDockConfig({ opacity });
}

export function applySpellChecker(enabled: boolean): void {
  for (const w of [mainWin, dockWin]) {
    if (w && !w.isDestroyed()) w.webContents.session.setSpellCheckerEnabled(enabled);
  }
}

export function repositionDock(): void {
  applyDockBounds();
}

export function showDock(): void {
  const win = dockWin ?? createDockWindow();
  if (!state.dock.open) state.setDockConfig({ open: true });
  win.showInactive();
  if (state.dock.onTop) win.setAlwaysOnTop(true, 'screen-saver');
}

export function closeDock(): void {
  const win = dockWin;
  state.setDockConfig({ open: false });
  if (win && !win.isDestroyed()) win.close();
}

export function isDockOpen(): boolean {
  return dockWin !== null && !dockWin.isDestroyed();
}

export function onDisplayMetricsChanged(): void {
  applyDockBounds();
}
