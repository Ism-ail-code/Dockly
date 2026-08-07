import type { AccentColor, Settings, Subject } from './types';

export const ACCENT_COLORS: { name: AccentColor; label: string }[] = [
  { name: 'indigo', label: 'Indigo' },
  { name: 'violet', label: 'Violet' },
  { name: 'sky', label: 'Sky' },
  { name: 'teal', label: 'Teal' },
  { name: 'emerald', label: 'Emerald' },
  { name: 'amber', label: 'Amber' },
  { name: 'orange', label: 'Orange' },
  { name: 'rose', label: 'Rose' },
  { name: 'pink', label: 'Pink' },
  { name: 'slate', label: 'Slate' },
];

export const DEFAULT_SUBJECTS: Omit<Subject, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder'>[] = [
  { name: 'Mathematics', icon: 'sigma', color: 'violet' },
  { name: 'Physics', icon: 'atom', color: 'sky' },
  { name: 'Chemistry', icon: 'flask', color: 'emerald' },
  { name: 'English', icon: 'book', color: 'amber' },
  { name: 'Urdu', icon: 'feather', color: 'rose' },
  { name: 'Computer Science', icon: 'cpu', color: 'indigo' },
];

export const DEFAULT_TAGS = ['Exam', 'Assignment', 'Formula', 'Definition', 'Important', 'Revision'];

export const DOCK_MIN_WIDTH = 240;
export const DOCK_MAX_WIDTH = 520;
export const DOCK_DEFAULT_WIDTH = 320;
export const DOCK_COLLAPSED_WIDTH = 44;

export const DEFAULT_SETTINGS: Settings = {
  // Appearance
  theme: 'dark',
  accent: 'indigo',
  animations: true,
  compactMode: false,
  largeToolbarIcons: false,
  showTooltips: true,
  sounds: false,
  // Sidebar (dock)
  dockOnTop: true,
  dockAutoHide: false,
  dockRememberPosition: true,
  dockRememberWidth: true,
  dockTransparencyEnabled: false,
  dockTransparencySlider: true,
  dockTransparency: 1,
  dockSide: 'right',
  dockWidth: DOCK_DEFAULT_WIDTH,
  // Editor
  autoSave: true,
  showLineNumbers: false,
  markdownShortcuts: true,
  richText: true,
  spellCheck: false,
  // Clipboard
  autoInsertScreenshots: true,
  autoCaptureText: false,
  confirmBeforeInsert: false,
  ignoreDuplicateClipboard: true,
  // Study
  focusMode: false,
  studyTimer: false,
  readingProgress: false,
  sessionResume: false,
  dailyStats: false,
  // General / Advanced
  launchOnStartup: false,
  onboarded: false,
  lastSubjectId: null,
  lastNoteId: null,
};

export const EMPTY_DOC = '{"type":"doc","content":[{"type":"paragraph"}]}';

export const VERSION_LIMIT = 30;
export const VERSION_INTERVAL_MS = 90_000;

export const SHORTCUTS: { keys: string; label: string; scope: string }[] = [
  { keys: 'Ctrl + K', label: 'Quick search', scope: 'Everywhere' },
  { keys: 'Ctrl + Shift + D', label: 'Dock / undock current note', scope: 'Everywhere' },
  { keys: 'Ctrl + N', label: 'New note', scope: 'Notes' },
  { keys: 'Ctrl + B', label: 'Bold', scope: 'Editor' },
  { keys: 'Ctrl + I', label: 'Italic', scope: 'Editor' },
  { keys: 'Ctrl + U', label: 'Underline', scope: 'Editor' },
  { keys: 'Ctrl + K (in editor)', label: 'Insert link', scope: 'Editor' },
  { keys: 'Ctrl + Z / Ctrl + Y', label: 'Undo / Redo', scope: 'Editor' },
  { keys: 'Ctrl + Shift + F', label: 'Toggle favorite', scope: 'Editor' },
  { keys: 'Ctrl + Shift + A', label: 'Archive note', scope: 'Editor' },
  { keys: 'Ctrl + D', label: 'Duplicate note', scope: 'Editor' },
  { keys: 'Win + Shift + S', label: 'Snip & auto-insert into note', scope: 'System' },
  { keys: 'Esc', label: 'Close overlays', scope: 'Everywhere' },
];

export const EDITOR_SNIPPET_IGNORES = ['un', 'del', 'code'];
