import { create } from 'zustand';
import type { DockConfig, Note, Settings, Subject, SubjectStats, UpdateInfo, UpdateState } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/defaults';

export type View = 'dashboard' | 'subject' | 'editor' | 'settings' | 'archive';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warn';
  message: string;
  action?: { label: string; onClick: () => void };
}

interface PendingShot {
  dataUrl: string;
  capturedAt: number;
  fileName?: string; // set once saved
}

interface PendingText {
  text: string;
  capturedAt: number;
  noteId?: string | null;
}

interface AppState {
  booted: boolean;
  settings: Settings;
  subjects: Array<Subject & SubjectStats>;
  notes: Note[];
  view: View;
  // The view that was showing before the current one — lets "Back" return
  // wherever the user came from (Settings/Archive return to their origin).
  prevView: View;
  currentSubjectId: string | null;
  currentNoteId: string | null;
  navFrom: 'dashboard' | 'subject';
  favorites: Note[];
  recents: Note[];
  tags: string[];
  dockState: DockConfig;
  pendingShot: PendingShot | null;
  pendingText: PendingText | null;
  toasts: Toast[];
  searchOpen: boolean;
  searchInitial: string;
  versionOpen: boolean;
  annotationOpen: boolean;
  annotationTarget: string | null;
  remoteContent: { noteId: string; content: string; updatedAt: number } | null;
  updateState: UpdateState;
  updateInfo: UpdateInfo | null;
  updateNotes: string | null;
  /** Version the user dismissed ("Later") — the same release is not re-shown this session. */
  updateNotifiedVersion: string | null;
  updateNotesOpen: boolean;
  updateInstallPrompt: boolean;

  boot: () => Promise<void>;
  applySettings: (s: Settings) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
  initUpdates: () => Promise<void>;
  checkUpdates: () => Promise<void>;
  dismissUpdate: () => void;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => void;
  openReleasePage: () => Promise<void>;
  openUpdateNotes: () => Promise<void>;
  closeUpdateNotes: () => void;
  setUpdateInstallPrompt: (v: boolean) => void;
  setView: (v: View) => void;
  openSubject: (id: string) => Promise<void>;
  openNote: (id: string) => Promise<void>;
  goBack: () => void;
  createNote: (subjectId: string, title?: string) => Promise<Note | null>;
  refreshNotes: (subjectId?: string) => Promise<void>;
  refreshSubjects: () => Promise<void>;
  refreshRecents: () => Promise<void>;
  refreshFavorites: () => Promise<void>;
  refreshTags: () => Promise<void>;
  setDockState: (d: DockConfig) => void;
  setPendingShot: (p: PendingShot | null) => void;
  setPendingText: (p: PendingText | null) => void;
  addToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setSearchOpen: (v: boolean | string) => void;
  setVersionOpen: (v: boolean) => void;
  setAnnotationOpen: (v: boolean, target?: string | null) => void;
  pushRemoteContent: (c: { noteId: string; content: string; updatedAt: number }) => void;
  clearRemoteContent: () => void;
  deleteNoteLocal: (id: string) => void;
  reportCaptureMode: () => Promise<void>;
}

let toastSeq = 1;

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  settings: DEFAULT_SETTINGS,
  subjects: [],
  notes: [],
  view: 'dashboard',
  prevView: 'dashboard',
  currentSubjectId: null,
  currentNoteId: null,
  navFrom: 'dashboard',
  favorites: [],
  recents: [],
  tags: [],
  dockState: {
    open: false,
    noteId: null,
    side: 'right',
    width: 320,
    height: 0,
    y: 0,
    topEdgeFree: false,
    collapsed: false,
    locked: false,
    opacity: 1,
    focusMode: false,
    onTop: true,
  },
  pendingShot: null,
  pendingText: null,
  toasts: [],
  searchOpen: false,
  searchInitial: '',
  versionOpen: false,
  annotationOpen: false,
  annotationTarget: null,
  remoteContent: null,
  updateState: { phase: 'idle' },
  updateInfo: null,
  updateNotes: null,
  updateNotifiedVersion: null,
  updateNotesOpen: false,
  updateInstallPrompt: false,

  boot: async () => {
    const settings = await window.nock.settings.get();
    const subjects = await window.nock.subjects.list();
    const dockState = await window.nock.dock.getState();
    get().applySettings(settings);
    set({ booted: true, subjects, dockState });
    await Promise.all([get().refreshRecents(), get().refreshFavorites(), get().refreshTags()]);
    void get().reportCaptureMode();
    // Session resume: jump back to the last note the user was working on.
    if (settings.sessionResume && settings.lastNoteId) {
      const last = await window.nock.notes.get(settings.lastNoteId).catch(() => null);
      if (last && !last.isArchived) {
        set({ currentNoteId: last.id, view: 'editor', navFrom: 'dashboard' });
        void get().reportCaptureMode();
      }
    }
  },

  applySettings: (s) => {
    set({ settings: s });
    const root = document.documentElement;
    root.setAttribute('data-theme', s.theme);
    root.setAttribute('data-accent', s.accent);
    root.setAttribute('data-anim', s.animations ? 'on' : 'off');
    root.setAttribute('data-compact', s.compactMode ? 'on' : 'off');
    root.setAttribute('data-large-toolbar', s.largeToolbarIcons ? 'on' : 'off');
  },

  setSetting: async (key, value) => {
    const settings = await window.nock.settings.set(key, value);
    get().applySettings(settings);
  },

  setView: (v) => {
    const s = get();
    set({ view: v, prevView: v === s.view ? s.prevView : s.view });
    void get().reportCaptureMode();
  },

  openSubject: async (id) => {
    const s = get();
    set({ currentSubjectId: id, view: 'subject', prevView: s.view });
    await get().refreshNotes(id);
    void get().reportCaptureMode();
  },

  openNote: async (id) => {
    const s = get();
    // Remember where the user came from so Back lands on the right screen:
    // a note opened from a subject list returns to that subject.
    const from = s.view === 'subject' ? 'subject' : 'dashboard';
    set({ currentNoteId: id, view: 'editor', navFrom: from, prevView: s.view });
    await window.nock.notes.get(id);
    await Promise.all([get().refreshNotes(), get().refreshRecents(), get().refreshFavorites()]);
    // Remember where the user left off (used by session resume).
    void window.nock.settings.set('lastNoteId', id);
    void get().reportCaptureMode();
  },

  goBack: () => {
    const s = get();
    if (s.view === 'editor') {
      // Keep currentNoteId so the last note stays selected (re-opening the
      // editor or the dock restores it immediately).
      set({ versionOpen: false, view: s.navFrom, prevView: 'editor' });
      void get().refreshNotes(s.currentSubjectId ?? undefined);
    } else if (s.view === 'subject') {
      set({ currentSubjectId: null, view: 'dashboard' });
    } else if (s.view === 'settings' || s.view === 'archive') {
      // Return to wherever the user came from; never into settings/archive.
      const target: View = s.prevView === 'editor' || s.prevView === 'subject' ? s.prevView : 'dashboard';
      set({ view: target });
    }
    void get().reportCaptureMode();
  },

  createNote: async (subjectId, title) => {
    const note = await window.nock.notes.create(subjectId, title ?? '');
    set({ currentNoteId: note.id, view: 'editor', navFrom: 'subject' });
    await get().openSubject(subjectId);
    set({ currentNoteId: note.id, view: 'editor' });
    await Promise.all([get().refreshRecents(), get().refreshTags()]);
    void get().reportCaptureMode();
    return note;
  },

  refreshNotes: async (subjectId) => {
    const id = subjectId ?? get().currentSubjectId;
    const notes = await window.nock.notes.list(id ?? undefined);
    set({ notes });
  },

  refreshSubjects: async () => {
    const subjects = await window.nock.subjects.list();
    set({ subjects });
  },

  refreshRecents: async () => {
    const all = await window.nock.notes.list(undefined, false);
    const recents = all
      .filter((n) => !n.isFavorite)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6);
    set({ recents });
  },

  refreshFavorites: async () => {
    const all = await window.nock.notes.list(undefined, false);
    set({ favorites: all.filter((n) => n.isFavorite).slice(0, 8) });
  },

  refreshTags: async () => {
    const all = await window.nock.notes.list(undefined, false);
    const tagSet = new Set<string>();
    for (const n of all) for (const t of n.tags) tagSet.add(t);
    set({ tags: Array.from(tagSet).sort() });
  },

  setDockState: (d) => set({ dockState: d }),

  setPendingShot: (p) => set({ pendingShot: p }),

  setPendingText: (p) => set({ pendingText: p }),

  addToast: (t) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismissToast(id), 4200);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setSearchOpen: (v) => {
    if (typeof v === 'string') set({ searchOpen: true, searchInitial: v });
    else set({ searchOpen: v, searchInitial: '' });
  },
  setVersionOpen: (v) => set({ versionOpen: v }),
  setAnnotationOpen: (v, target) => {
    set({ annotationOpen: v, annotationTarget: target ?? null });
    void get().reportCaptureMode();
  },

  pushRemoteContent: (c) => set({ remoteContent: c }),
  clearRemoteContent: () => set({ remoteContent: null }),

  initUpdates: async () => {
    window.nock.updates.onState((s) => set({ updateState: s }));
    const info = await window.nock.updates.getInfo().catch(() => null);
    set({ updateInfo: info });
    const s = await window.nock.updates.getState().catch(() => null);
    if (s) set({ updateState: s });
  },

  checkUpdates: async () => {
    set({ updateState: { phase: 'checking' }, updateNotes: null });
    await window.nock.updates.check().catch(() => set({ updateState: { phase: 'error', message: 'Unable to check for updates right now.' } }));
  },

  dismissUpdate: () => {
    const s = get();
    if (s.updateState.phase === 'available') set({ updateNotifiedVersion: s.updateState.version });
  },

  downloadUpdate: async () => {
    const s = get();
    if (s.updateState.phase !== 'available') return;
    set({ updateInstallPrompt: false });
    await window.nock.updates.download().catch(() => set({ updateState: { phase: 'error', message: 'Unable to check for updates right now.' } }));
  },

  installUpdate: () => {
    get().setUpdateInstallPrompt(false);
    void window.nock.updates.install();
  },

  openReleasePage: async () => {
    await window.nock.updates.openRelease().catch(() => undefined);
  },

  openUpdateNotes: async () => {
    set({ updateNotesOpen: true, updateNotes: null });
    const notes = await window.nock.updates.notes().catch(() => null);
    set({ updateNotes: notes });
  },

  closeUpdateNotes: () => set({ updateNotesOpen: false }),
  setUpdateInstallPrompt: (v) => set({ updateInstallPrompt: v }),

  deleteNoteLocal: (id) =>
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      currentNoteId: s.currentNoteId === id ? null : s.currentNoteId,
    })),

  reportCaptureMode: async () => {
    const s = get();
    // Nock consumes screenshots only while actually using it.
    const mode: 'off' | 'editor' | 'awaiting' = s.annotationOpen
      ? 'awaiting'
      : s.view === 'editor' && s.currentNoteId
        ? 'editor'
        : 'off';
    await window.nock.clipboard.setCaptureMode(mode);
  },
}));
