export type AccentColor =
  | 'indigo'
  | 'violet'
  | 'sky'
  | 'teal'
  | 'emerald'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'pink'
  | 'slate';

export type ThemeName = 'light' | 'dark' | 'midnight';

export interface Subject {
  id: string;
  name: string;
  icon: string;
  color: AccentColor;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface SubjectStats {
  noteCount: number;
  lastModified: number;
}

export interface Note {
  id: string;
  subjectId: string;
  title: string;
  content: string; // TipTap JSON
  isFavorite: boolean;
  isArchived: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  screenshotCount: number;
  preview: string;
}

export interface VersionSnapshot {
  id: number;
  noteId: string;
  content: string;
  createdAt: number;
}

export interface SearchResult {
  subject: Subject;
  notes: Note[];
}

export interface SearchQuery {
  q: string;
  scope: 'all' | 'favorites' | 'archived';
  limit?: number;
}

export interface Settings {
  // Appearance
  theme: ThemeName;
  accent: AccentColor;
  animations: boolean;
  compactMode: boolean;
  largeToolbarIcons: boolean;
  showTooltips: boolean;
  sounds: boolean;
  // Sidebar (dock)
  dockOnTop: boolean;
  dockAutoHide: boolean;
  dockRememberPosition: boolean;
  dockRememberWidth: boolean;
  dockRememberHeight: boolean;
  dockTransparencyEnabled: boolean;
  dockTransparencySlider: boolean;
  dockTransparency: number; // 0.4 - 1, applied only when transparency is enabled
  dockGlassStyle: 'frosted' | 'clear'; // frosted = acrylic blur; clear = true see-through
  dockSide: 'left' | 'right';
  dockWidth: number;
  dockHeight: number; // 0 = auto (full work-area height)
  // Editor
  autoSave: boolean;
  showLineNumbers: boolean;
  markdownShortcuts: boolean;
  richText: boolean;
  spellCheck: boolean;
  // Clipboard
  autoInsertScreenshots: boolean;
  autoCaptureText: boolean;
  confirmBeforeInsert: boolean;
  ignoreDuplicateClipboard: boolean;
  // Study
  focusMode: boolean;
  studyTimer: boolean;
  readingProgress: boolean;
  sessionResume: boolean;
  dailyStats: boolean;
  // Updates
  autoCheckUpdates: boolean;
  // General / Advanced
  launchOnStartup: boolean;
  onboarded: boolean;
  lastSubjectId: string | null;
  lastNoteId: string | null;
}

export interface ScreenshotMeta {
  id: string;
  noteId: string;
  path: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface PendingScreenshot {
  available: boolean;
  width: number;
  height: number;
  capturedAt: number;
}

export interface DockConfig {
  open: boolean;
  noteId: string | null;
  side: 'left' | 'right';
  width: number;
  height: number;
  y: number;
  // True when the dock's top edge is not flush with the work-area top, so the
  // top resize handle is usable (the bottom edge is the fixed anchor).
  topEdgeFree: boolean;
  collapsed: boolean;
  locked: boolean;
  opacity: number;
  focusMode: boolean;
  onTop: boolean;
}

export interface NoteContentUpdate {
  noteId: string;
  content: string;
  updatedAt: number;
}

/** Where the update-check result currently stands. Mirrored to the renderer. */
export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up-to-date'; checkedAt: number }
  | {
      phase: 'available';
      version: string;
      htmlUrl: string;
      notes: string | null;
      releasedAt?: string;
    }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string };

/** Static facts the renderer needs to render the Updates UI. */
export interface UpdateInfo {
  currentVersion: string;
  isPackaged: boolean;
  /** True when Nock can self-install the downloaded update (NSIS install). */
  installSupported: boolean;
}

// ---------- Backup ----------

export interface DataCounts {
  subjects: number;
  notes: number;
  screenshots: number;
  versions: number;
  settings: number;
  dailyStats: number;
}

export interface BackupManifest {
  /** .nockbackup format version — must equal BACKUP_FORMAT_VERSION to restore. */
  formatVersion: number;
  /** Nock app version that created the backup. */
  appVersion: string;
  /** Database schema version of the snapshot (PRAGMA user_version). */
  schemaVersion: number;
  createdAt: string;
  counts: DataCounts;
}

export interface BackupExportResult {
  path: string;
  counts: DataCounts;
}

export interface BackupRestoreResult {
  manifest: BackupManifest;
  restored: DataCounts;
  /** Screenshots referenced by the database but missing from the backup. */
  missingScreenshots: string[];
  /** Safety backup of the previous data, created before the restore. */
  safetyBackup: string;
}
