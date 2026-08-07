export const IPC = {
  // subjects
  subjectsList: 'subjects:list',
  subjectCreate: 'subjects:create',
  subjectUpdate: 'subjects:update',
  subjectDelete: 'subjects:delete',

  // notes
  notesList: 'notes:list',
  noteGet: 'notes:get',
  noteCreate: 'notes:create',
  noteUpdate: 'notes:update', // full metadata update
  noteContentSave: 'notes:content-save',
  noteDelete: 'notes:delete',
  noteDuplicate: 'notes:duplicate',
  noteSetFavorite: 'notes:set-favorite',
  noteArchive: 'notes:archive',
  noteRename: 'notes:rename',

  // versions
  versionsList: 'versions:list',
  versionRestore: 'versions:restore',

  // search
  search: 'search:query',

  // screenshots
  screenshotSave: 'screenshot:save',
  screenshotRead: 'screenshot:read',
  screenshotDelete: 'screenshot:delete',

  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',
  statsToday: 'stats:today',

  // clipboard / screenshots from OS
  clipboardImage: 'clipboard:image',
  clipboardText: 'clipboard:text',
  clipboardState: 'clipboard:state',

  // dock
  dockOpen: 'dock:open',
  dockClose: 'dock:close',
  dockSetSide: 'dock:set-side',
  dockSetWidth: 'dock:set-width',
  dockToggleCollapse: 'dock:toggle-collapse',
  dockSetLocked: 'dock:set-locked',
  dockSetOpacity: 'dock:set-opacity',
  dockToggleFocus: 'dock:toggle-focus',
  dockGetState: 'dock:get-state',

  // sync between windows
  syncNoteContent: 'sync:note-content',
  syncActiveNote: 'sync:active-note',
  syncSettings: 'sync:settings',

  // window controls
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',

  // misc
  appInfo: 'app:info',
} as const;
