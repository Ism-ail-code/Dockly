import type { DocklyApi } from '../preload';

declare global {
  interface Window {
    dockly: DocklyApi;
  }
}

export {};
