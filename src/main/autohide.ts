import { getMainWindow, getDockWindow, toggleDockCollapse } from './windows';
import { state } from './state';

/**
 * Auto-hide sidebar: while the Nock main window is the focused window the dock
 * tucks away (collapses to the edge); as soon as the user switches to another app
 * the dock slides back out so the study companion is always available.
 */

let timer: NodeJS.Timeout | null = null;

function poll(): void {
  if (!state.settings?.dockAutoHide) return;
  if (!state.dock.open) return;
  const main = getMainWindow();
  const dock = getDockWindow();
  if (!dock || dock.isDestroyed()) return;
  const mainActive =
    !!main && !main.isDestroyed() && main.isVisible() && !main.isMinimized() && main.isFocused();
  const shouldCollapse = mainActive;
  if (shouldCollapse && !state.dock.collapsed) toggleDockCollapse();
  else if (!shouldCollapse && state.dock.collapsed) toggleDockCollapse();
}

export function startDockAutoHidePoll(): void {
  if (timer) return;
  timer = setInterval(poll, 400);
}

export function stopDockAutoHidePoll(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
