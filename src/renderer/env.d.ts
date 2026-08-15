import type { NockApi } from '../preload';

declare global {
  interface Window {
    nock: NockApi;
  }
}

export {};
