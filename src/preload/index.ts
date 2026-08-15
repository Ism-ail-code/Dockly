import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  AccentColor,
  DockConfig,
  Note,
  SearchResult,
  Settings,
  Subject,
  SubjectStats,
  VersionSnapshot,
} from '../shared/types';

type Listener = (payload: unknown) => void;

const eventMap: Record<string, Set<Listener>> = {};

function on(channel: string, listener: Listener): () => void {
  if (!eventMap[channel]) {
    eventMap[channel] = new Set();
    ipcRenderer.on(channel, (_e: IpcRendererEvent, payload: unknown) => {
      for (const l of eventMap[channel]) l(payload);
    });
  }
  eventMap[channel].add(listener);
  return () => eventMap[channel].delete(listener);
}

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).then((res: { ok: boolean; data?: T; error?: string }) => {
    if (!res?.ok) throw new Error(res?.error ?? 'ipc error');
    return res.data as T;
  });
}

const api = {
  on,
  invoke,

  appInfo: () => invoke<{ version: string; platform: string; isDev: boolean }>('app:info'),
  runtimeState: () => invoke<any>('app:runtime-state'),

  subjects: {
    list: () => invoke<Array<Subject & SubjectStats>>('subjects:list'),
    create: (data: { name: string; icon: string; color: AccentColor }) =>
      invoke<Subject>('subjects:create', data),
    update: (id: string, patch: Record<string, unknown>) => invoke<Subject>('subjects:update', id, patch),
    delete: (id: string) => invoke<void>('subjects:delete', id),
  },

  notes: {
    list: (subjectId?: string, includeArchived?: boolean) =>
      invoke<Note[]>('notes:list', subjectId, includeArchived),
    get: (id: string) => invoke<Note | null>('notes:get', id),
    create: (subjectId: string, title?: string) => invoke<Note>('notes:create', subjectId, title),
    updateMeta: (id: string, patch: Record<string, unknown>) => invoke<Note>('notes:update-meta', id, patch),
    contentSave: (id: string, content: string) => invoke<Note | null>('notes:content-save', id, content),
    delete: (id: string) => invoke<void>('notes:delete', id),
    duplicate: (id: string) => invoke<Note>('notes:duplicate', id),
    setFavorite: (id: string, fav: boolean) => invoke<Note>('notes:set-favorite', id, fav),
    archive: (id: string, archived: boolean) => invoke<Note>('notes:archive', id, archived),
  },

  versions: {
    list: (noteId: string) => invoke<VersionSnapshot[]>('versions:list', noteId),
    restore: (noteId: string, versionId: number) => invoke<Note | null>('versions:restore', noteId, versionId),
  },

  search: (q: string, scope: 'all' | 'favorites' | 'archived') => invoke<SearchResult[]>('search', q, scope),

  screenshots: {
    save: (noteId: string, pngBase64: string) =>
      invoke<{ id: string; fileName: string }>('screenshot:save', noteId, pngBase64),
    read: (fileName: string) => invoke<string | null>('screenshot:read', fileName),
    replace: (fileName: string, pngBase64: string) =>
      invoke<{ path: string } | null>('screenshot:replace', fileName, pngBase64),
  },

  settings: {
    get: () => invoke<Settings>('settings:get'),
    set: (key: string, value: unknown) => invoke<Settings>('settings:set', key, value),
    reset: () => invoke<Settings>('settings:reset'),
  },

  stats: {
    today: () => invoke<{ day: string; notes: number; shots: number; edits: number }>('stats:today'),
  },

  dock: {
    open: (noteId?: string | null) => invoke<DockConfig>('dock:open', noteId ?? null),
    close: () => invoke<DockConfig>('dock:close'),
    setSide: (side: 'left' | 'right') => invoke<DockConfig>('dock:set-side', side),
    setWidth: (width: number) => invoke<DockConfig>('dock:set-width', width),
    setSize: (width: number, height: number, fixed: 'top' | 'bottom' = 'top') =>
      invoke<DockConfig>('dock:set-size', width, height, fixed),
    toggleCollapse: () => invoke<DockConfig>('dock:toggle-collapse'),
    setLocked: (locked: boolean) => invoke<DockConfig>('dock:set-locked', locked),
    setOnTop: (on: boolean) => invoke<DockConfig>('dock:set-on-top', on),
    setOpacity: (opacity: number) => invoke<DockConfig>('dock:set-opacity', opacity),
    toggleFocus: () => invoke<DockConfig>('dock:toggle-focus'),
    getState: () => invoke<DockConfig>('dock:get-state'),
    minimize: () => invoke<void>('dock:minimize'),
  },

  clipboard: {
    setCaptureMode: (mode: 'off' | 'editor' | 'awaiting') => invoke<'off' | 'editor' | 'awaiting'>('clipboard:set-capture-mode', mode),
    markSelfCopy: () => invoke<void>('clipboard:mark-self-copy'),
  },

  window: {
    minimize: () => invoke<void>('window:minimize'),
    restore: () => invoke<void>('window:restore'),
    maximize: () => invoke<void>('window:maximize'),
    close: () => invoke<void>('window:close'),
    openMain: (view?: string) => invoke<void>('window:open-main', view),
    hide: () => invoke<void>('window:hide'),
  },

  onViewNavigate: (cb: (view: string) => void) => on('view:navigate', (p) => cb(p as string)),

  clearPendingScreenshot: () => invoke<void>('nock:clear-pending-screenshot'),
};

export type NockApi = typeof api;

contextBridge.exposeInMainWorld('nock', api);
