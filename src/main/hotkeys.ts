import { globalShortcut } from 'electron';
import { showDock, closeDock } from './windows';
import { state } from './state';

export function registerGlobalHotkeys(): void {
  try {
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      if (state.dock.open) closeDock();
      else showDock();
    });
  } catch (e) {
    console.log('[nock] global hotkey failed:', e);
  }
}

export function unregisterGlobalHotkeys(): void {
  globalShortcut.unregisterAll();
}
