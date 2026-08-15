import { BrowserWindow, screen, app } from 'electron';
import path from 'node:path';
import { state, hub } from './state';
import {
  DOCK_MIN_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_COLLAPSED_WIDTH,
  DOCK_DEFAULT_WIDTH,
  DOCK_MIN_HEIGHT,
} from '../shared/defaults';

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
    title: 'Nock',
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
  // The main window is the management "library": it is created at boot so
  // navigation is instant, and it is the app's front door — it is shown and
  // focused at startup and whenever the user asks for the library. The dock
  // never steals focus from it (showDock uses showInactive).
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

function clampDockWidth(w: number): number {
  const area = workArea();
  // Leave the user's app usable even at the widest setting.
  const max = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, area.width - 300));
  return Math.max(DOCK_MIN_WIDTH, Math.min(max, Math.round(w)));
}

function clampDockHeight(h: number): number {
  const area = workArea();
  // Never exceed the work area, but never below the minimum either.
  const max = Math.max(DOCK_MIN_HEIGHT, area.height - 40);
  return Math.max(DOCK_MIN_HEIGHT, Math.min(area.height, Math.min(max, Math.round(h))));
}

/** The height the dock should use now: remembered, clamped, or full height. */
function effectiveDockHeight(): number {
  const s = state.settings;
  const remembered = s?.dockRememberHeight && (s.dockHeight ?? 0) > 0 ? s.dockHeight : 0;
  return remembered > 0 ? clampDockHeight(remembered) : workArea().height;
}

function dockTargetBounds(): Electron.Rectangle {
  const area = workArea();
  if (state.dock.collapsed) {
    return { x: dockXForWidth(DOCK_COLLAPSED_WIDTH), y: area.y, width: DOCK_COLLAPSED_WIDTH, height: area.height };
  }
  const width = clampDockWidth(state.dock.width);
  // Keep the stored height within the current work area (screens change).
  const height = clampDockHeight(state.dock.height || effectiveDockHeight());
  // Keep the top edge inside the work area, even after a resolution change.
  const maxY = area.y + area.height - height;
  const y = Math.max(area.y, Math.min(maxY, state.dock.y));
  return { x: dockXForWidth(width), y, width, height };
}

function dockXForWidth(width: number): number {
  const area = workArea();
  return state.dock.side === 'left' ? area.x : area.x + area.width - width;
}

export function createDockWindow(): BrowserWindow {
  // Persisted preferences decide position/width/height/transparency/focus before first paint.
  const s = state.settings;
  const area = workArea();
  if (s?.dockRememberPosition && s.dockSide === 'left') state.setDockConfig({ side: 'left' });
  const rememberedWidth = s?.dockRememberWidth
    ? Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(s.dockWidth ?? DOCK_DEFAULT_WIDTH)))
    : DOCK_DEFAULT_WIDTH;
  const rememberedHeight =
    s?.dockRememberHeight && (s.dockHeight ?? 0) > 0
      ? clampDockHeight(s.dockHeight)
      : area.height;
  state.setDockConfig({
    width: rememberedWidth,
    height: rememberedHeight,
    y: area.y,
    topEdgeFree: false,
    focusMode: s?.focusMode ?? false,
  });

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
  // Transparency is applied in CSS (the panel background) so controls keep
  // full contrast; the OS acrylic material supplies the blur behind the dock.
  // "Clear" glass skips the material entirely so the desktop behind stays
  // sharp and readable through the translucent panel.
  if (process.platform === 'win32') {
    try {
      const glass = s?.dockGlassStyle ?? 'frosted';
      const material = s?.dockTransparencyEnabled && glass === 'frosted' ? 'acrylic' : 'none';
      win.setBackgroundMaterial(material);
      console.log(`[dock] background material → ${material}`);
    } catch (e) {
      console.log('[dock] setBackgroundMaterial failed:', String(e));
    }
  }
  const opacity = s?.dockTransparencyEnabled ? Math.max(0.2, Math.min(1, s.dockTransparency ?? 1)) : 1;
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
  // Keep the dock's vertical placement in sync when the user drags the window
  // by its header: the top resize handle becomes available once the top edge
  // is no longer flush with the work area.
  let moveTimer: NodeJS.Timeout | null = null;
  win.on('move', () => {
    if (moveTimer) return;
    moveTimer = setTimeout(() => {
      moveTimer = null;
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      const a = workArea();
      state.setDockConfig({ y: b.y, height: b.height, topEdgeFree: b.y > a.y + 2 });
    }, 60);
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
    // Preserve the current vertical size/position while animating the width.
    const area = workArea();
    const x = state.dock.side === 'left' ? area.x : area.x + area.width - width;
    win.setBounds({ x, y: from.y, width, height: from.height }, false);
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
  const area = workArea();
  state.setDockConfig({ y: b.y, height: b.height, topEdgeFree: b.y > area.y + 2 });
}

/**
 * Two-dimensional dock resize.
 *
 * @param width  desired width (clamped)
 * @param height desired height (clamped)
 * @param fixed  which vertical edge stays put while resizing:
  const area = workArea();
  state.setDockConfig({ y: b.y, height: b.height, topEdgeFree: b.y > area.y + 2 });
 *               'top'    → the top edge is fixed, height grows/shrinks downward
 *               'bottom' → the bottom edge is fixed, the top edge moves
 */
export function resizeDockTo(width: number, height?: number, fixed: 'top' | 'bottom' = 'top'): void {
  const win = dockWin;
  if (!win || win.isDestroyed()) return;
  const area = workArea();
  const clampedW = clampDockWidth(width);

  // The window's live bounds are the source of truth for the vertical anchor
  // (the user may have moved the dock since the last resize).
  const b = win.getBounds();
  const bottom = b.y + b.height;
  let y: number;
  let h: number;
  if (height === undefined) {
    y = b.y;
    h = b.height;
  } else if (fixed === 'bottom') {
    // Bottom edge stays; the top edge follows the drag (never above the work area).
    y = Math.max(area.y, bottom - clampDockHeight(height));
    h = bottom - y;
    h = clampDockHeight(h);
    y = bottom - h;
  } else {
    // Top edge stays; the height never pushes the dock below the work area.
    y = b.y;
    h = clampDockHeight(height);
    h = Math.min(h, area.y + area.height - y);
    h = Math.max(DOCK_MIN_HEIGHT, h);
  }

  const x = dockXForWidth(clampedW);
  state.setDockConfig({ width: clampedW, height: h, y, topEdgeFree: y > area.y + 2 });
  win.setBounds({ x, y, width: clampedW, height: h }, false);
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

/** Applies the persisted transparency preference to the dock window live.
 *  Never fades the whole window — that would make text and controls
 *  unreadable. Instead the panel background goes translucent in CSS while
 *  controls keep their own solid surfaces; acrylic adds OS-level blur. */
export function setDockTransparency(enabled: boolean, value: number): void {
  const win = dockWin;
  if (win && !win.isDestroyed()) {
    win.setOpacity(1);
    if (process.platform === 'win32') {
      try {
        const glass = state.settings?.dockGlassStyle ?? 'frosted';
        const material = enabled && glass === 'frosted' ? 'acrylic' : 'none';
        win.setBackgroundMaterial(material);
        console.log(`[dock] background material → ${material}`);
      } catch (e) {
        console.log('[dock] setBackgroundMaterial failed:', String(e));
      }
    }
  }
  state.setDockConfig({ opacity: enabled ? Math.max(0.2, Math.min(1, value)) : 1 });
}

/** Rebuilds the dock window so the OS background material (acrylic vs none)
 *  is applied at creation time. Live setBackgroundMaterial switches can leave
 *  the old material stuck on existing windows — recreating guarantees Clear
 *  glass truly removes the blur. Bounds, side, collapse and on-top state are
 *  preserved so the change is seamless. */
export function recreateDockWindow(): void {
  const old = dockWin;
  const bounds = old && !old.isDestroyed() ? old.getBounds() : null;
  const wasOpen = state.dock.open;
  if (old && !old.isDestroyed()) {
    old.removeAllListeners('closed');
    old.close();
  }
  dockWin = null;
  const win = createDockWindow();
  if (bounds) {
    const area = workArea();
    const w = state.dock.collapsed
      ? DOCK_COLLAPSED_WIDTH
      : Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, bounds.width));
    const x = state.dock.side === 'left' ? area.x : area.x + area.width - w;
    const h = clampDockHeight(bounds.height);
    win.setBounds({ x, y: bounds.y, width: w, height: h }, false);
    state.setDockConfig({ width: w, height: h, y: bounds.y, topEdgeFree: bounds.y > area.y + 2 });
  }
  if (wasOpen) win.showInactive();
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
