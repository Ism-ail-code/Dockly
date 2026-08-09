import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  GripHorizontal,
  LayoutDashboard,
  Lock,
  LockOpen,
  Minus,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings as SettingsIcon,
  Star,
  X,
} from 'lucide-react';
import type { DockConfig, Note, Settings, Subject } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import { useApp } from '@/app/store';
import { DocklyLogo } from '@/components/TopBar';
import { SubjectIcon, timeAgo } from '@/components/ui';

interface DockNote {
  note: Note;
  subject?: Subject;
}

export function DockApp() {
  const [cfg, setCfg] = useState<DockConfig>({
    open: true,
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
  });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [recents, setRecents] = useState<DockNote[]>([]);
  const [curSubjectId, setCurSubjectId] = useState<string | null>(null);
  const [subjectNoteCount, setSubjectNoteCount] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState<DockNote[]>([]);
  const [searching, setSearching] = useState(false);
  const [subjectMenu, setSubjectMenu] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [dragActive, setDragActive] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastServerContent = useRef('');
  // Monotonic token so the LAST requested note always wins (rapid-click safety).
  const loadSeq = useRef(0);
  // The note id currently rendered — lets us skip redundant re-loads.
  const loadedNoteId = useRef<string | null>(null);
  // Always-fresh note id for editor callbacks (avoids stale closures on switch).
  const activeNoteId = useRef<string | null>(null);
  // Always-fresh settings for editor callbacks.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const effectiveSubjectId = note?.subjectId ?? curSubjectId ?? settings.lastSubjectId ?? subjects[0]?.id ?? null;
  const subject = subjects.find((s) => s.id === effectiveSubjectId);

  // ---------- boot: config, settings, subjects, recents ----------
  useEffect(() => {
    const offs = [
      window.dockly.on('dock:state', (d) => {
        setCfg((prev) => ({ ...prev, ...(d as Partial<DockConfig>) }));
      }),
      window.dockly.on('sync:settings', (s) => {
        const next = s as Settings;
        setSettings(next);
        useApp.getState().applySettings(next);
      }),
      window.dockly.on('sync:active-note', (p) => {
        const payload = p as { noteId: string | null; from: string };
        if (payload.from === 'dock') return;
        if (!payload.noteId) {
          loadedNoteId.current = null;
          activeNoteId.current = null;
          setNote(null);
          return;
        }
        void loadNote(payload.noteId);
      }),
    ];
    void (async () => {
      const [d, s] = await Promise.all([window.dockly.dock.getState(), window.dockly.settings.get()]);
      setCfg((prev) => ({ ...prev, ...d }));
      setSettings(s);
      useApp.getState().applySettings(s);
    })();
    void refreshSubjects();
    void refreshRecents();
    void window.dockly.clipboard.setCaptureMode('off');
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSubjects = useCallback(async () => {
    setSubjects(await window.dockly.subjects.list());
  }, []);

  const refreshRecents = useCallback(async () => {
    const all = await window.dockly.notes.list(undefined, false);
    const subjectById = new Map((await window.dockly.subjects.list()).map((s) => [s.id, s]));
    const rows = all
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8)
      .map((note) => ({ note, subject: subjectById.get(note.subjectId) }));
    setRecents(rows);
  }, []);

  // ---------- subject note count ----------
  useEffect(() => {
    if (!effectiveSubjectId) {
      setSubjectNoteCount(null);
      return;
    }
    void window.dockly.notes.list(effectiveSubjectId).then((n) => setSubjectNoteCount(n.length));
  }, [effectiveSubjectId]);

  // ---------- capture mode: the dock consumes screenshots while a note is open ----------
  useEffect(() => {
    void window.dockly.clipboard.setCaptureMode(note ? 'editor' : 'off');
  }, [note?.id]);

  // ---------- editor ----------
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Underline,
        TaskList,
        TaskItem,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        Image.configure({ inline: false }),
        Placeholder.configure({ placeholder: 'Start writing…' }),
      ],
      // "Markdown shortcuts" preference: typing shortcuts (#, -, 1., **) off when disabled.
      enableInputRules: settings.markdownShortcuts,
      enablePasteRules: true,
      content: note ? note.content : '',
      editorProps: {
        attributes: { class: 'doc doc-dock', spellcheck: settings.spellCheck ? 'true' : 'false' },
      },
      onUpdate: ({ editor }) => {
        if (!settingsRef.current.autoSave) return;
        // Snapshot note id + content NOW — the debounce may fire after the
        // user has switched notes, and saving `editor.getJSON()` then would
        // persist the new note's document under the old note's id.
        const id = activeNoteId.current;
        if (!id) return;
        const snapshot = editor.getJSON();
        setSaveState('saving');
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          void window.dockly.notes.contentSave(id, snapshot as unknown as string);
          setSaveState('saved');
          setTimeout(() => setSaveState('idle'), 1600);
          if (recentsTimer.current) clearTimeout(recentsTimer.current);
          recentsTimer.current = setTimeout(() => void refreshRecents(), 1500);
        }, 400);
      },
    },
    [settings.markdownShortcuts, settings.spellCheck],
  );

  // Always-fresh editor reference (the useEditor instance is recreated when
  // markdownShortcuts/spellCheck change; callbacks must never hold a dead one).
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // With auto-save off, protect dock edits by saving when the window loses focus.
  useEffect(() => {
    const onBlur = () => {
      const id = activeNoteId.current;
      if (!id || !editor) return;
      void window.dockly.notes.contentSave(id, editor.getJSON() as unknown as string);
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [editor]);

  // apply remote content (from main window)
  useEffect(() => {
    const off = window.dockly.on('sync:note-content', (c) => {
      const payload = c as { noteId: string; content: string; from: string };
      if (payload.from === 'dock') return;
      if (payload.noteId !== activeNoteId.current) return;
      const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content);
      if (content === lastServerContent.current) return;
      lastServerContent.current = content;
      try {
        editor?.commands.setContent(JSON.parse(content), false);
      } catch {
        /* ignore */
      }
    });
    return off;
  }, [editor]);

  // apply note content on load
  useEffect(() => {
    if (!editor || !note) return;
    if (note.content !== lastServerContent.current) {
      lastServerContent.current = note.content;
      try {
        editor.commands.setContent(JSON.parse(note.content), false);
      } catch {
        /* ignore */
      }
    }
  }, [editor, note]);

  // Insert any screenshot captured while the dock is the focused window.
  useEffect(() => {
    const off = window.dockly.on('clipboard:image', (p) => {
      const payload = p as { png: string; width: number; height: number; capturedAt: number };
      const id = activeNoteId.current;
      if (!id) return;
      if (!settingsRef.current.autoInsertScreenshots) return;
      void (async () => {
        try {
          const { fileName } = await window.dockly.screenshots.save(id, payload.png);
          const src = 'dockly-shot://f/' + fileName;
          const pos = editorRef.current?.state.doc.content.size ?? 0;
          editorRef.current?.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src } }).run();
        } catch {
          /* ignore */
        }
      })();
    });
    return off;
  }, [editor]);

  // ---------- actions ----------
  // The ONLY note-loading path. Race-protected: bumping `loadSeq` invalidates
  // any in-flight request, so rapidly clicking several notes always ends on
  // the last one clicked — never an out-of-order response.
  const loadNote = useCallback(
    async (id: string) => {
      const seq = ++loadSeq.current;
      const n = await window.dockly.notes.get(id);
      if (seq !== loadSeq.current || !n) return;
      loadedNoteId.current = n.id;
      activeNoteId.current = n.id;
      // NOTE: do NOT pre-set lastServerContent here — the "apply note content
      // on load" effect compares it against the fresh note to decide whether
      // the editor needs its content swapped.
      setNote(n);
      setTitle(n.title);
      setSearchQ('');
      setSearching(false);
      setSubjectMenu(false);
      void refreshRecents();
      setTimeout(() => {
        if (seq === loadSeq.current) editorRef.current?.commands.focus('end');
      }, 60);
    },
    [refreshRecents],
  );

  // ---------- load the active note ----------
  // Single guarded load path: `cfg.noteId` changes (from dock:state broadcasts)
  // and `sync:active-note` events (from the main window) both route through
  // `loadNote`, which is race-protected so the last requested note wins.
  useEffect(() => {
    if (cfg.noteId === loadedNoteId.current) return;
    if (!cfg.noteId) {
      loadedNoteId.current = null;
      activeNoteId.current = null;
      setNote(null);
      return;
    }
    void loadNote(cfg.noteId);
  }, [cfg.noteId, loadNote]);

  const newNote = () => {
    const target = effectiveSubjectId;
    if (!target) {
      void window.dockly.window.openMain('dashboard');
      return;
    }
    void window.dockly.notes.create(target, '');
    void refreshRecents();
  };

  const commitTitle = (t: string) => {
    setTitle(t);
    if (note && t.trim() !== note.title) {
      void window.dockly.notes.updateMeta(note.id, { title: t });
      void refreshRecents();
    }
  };

  const toggleFavorite = async (id: string) => {
    const n = recents.find((r) => r.note.id === id)?.note;
    if (!n) return;
    await window.dockly.notes.setFavorite(id, !n.isFavorite);
    void refreshRecents();
  };

  const openMain = (view: string) => {
    void window.dockly.window.openMain(view);
  };

  const pickSubject = (id: string) => {
    setCurSubjectId(id);
    setSubjectMenu(false);
    void window.dockly.settings.set('lastSubjectId', id);
  };

  // ---------- search ----------
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQ.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await window.dockly.search(q, 'all');
        const subjectById = new Map(subjects.map((s) => [s.id, s]));
        const rows: DockNote[] = [];
        for (const r of res) for (const n of r.notes) rows.push({ note: n, subject: subjectById.get(n.subjectId) ?? r.subject });
        setResults(rows);
        setSearching(true);
      } catch {
        /* ignore */
      }
    }, 240);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQ]);

  const onSearchKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && results.length > 0) {
      void loadNote(results[0].note.id);
    } else if (e.key === 'Escape') {
      setSearchQ('');
      setSearching(false);
    }
  };

  const toggleCollapse = () => void window.dockly.dock.toggleCollapse();
  const toggleLock = () => void window.dockly.dock.setLocked(!cfg.locked);
  const toggleFocus = () => void window.dockly.dock.toggleFocus();
  const togglePin = () => void window.dockly.dock.setOnTop(!settings.dockOnTop);

  // resize handle drag logic — unified for every edge/corner
  type ResizeKind = 'inner' | 'top' | 'bottom' | 'top-inner' | 'bottom-inner';
  const startResize = useCallback(
    (e: ReactPointerEvent, kind: ResizeKind) => {
      if (cfg.collapsed || cfg.locked) return;
      e.preventDefault();
      const startX = e.screenX;
      const startY = e.screenY;
      const startW = cfg.width;
      const startH = cfg.height;
      setDragActive(true);
      const onMove = (ev: PointerEvent) => {
        const dx = ev.screenX - startX;
        const dy = ev.screenY - startY;
        // The inner edge is on the left when docked right (and vice versa).
        const nextW = Math.round(cfg.side === 'right' ? startW - dx : startW + dx);
        let nextH = startH;
        if (kind === 'bottom' || kind === 'bottom-inner') nextH = Math.round(startH + dy);
        else if (kind === 'top' || kind === 'top-inner') nextH = Math.round(startH - dy);
        if (kind === 'inner') {
          void window.dockly.dock.setWidth(nextW);
        } else {
          const fixed: 'top' | 'bottom' = kind === 'top' || kind === 'top-inner' ? 'bottom' : 'top';
          void window.dockly.dock.setSize(nextW, nextH, fixed);
        }
      };
      const onUp = () => {
        setDragActive(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      // Guarded: synthetic events (and some automated environments) have no
      // active pointer, which makes setPointerCapture throw. The drag must
      // still work — the window listeners are already attached above.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* no active pointer — fine */
      }
    },
    [cfg.collapsed, cfg.locked, cfg.width, cfg.height, cfg.side],
  );

  const innerEdge = cfg.side === 'right';
  const roomy = cfg.width >= 360;
  // compact-layout flags: adapt chrome to small dock sizes
  const narrow = cfg.width < 270;
  const short = cfg.height > 0 && cfg.height < 340;
  const mini = cfg.height > 0 && cfg.height < 290;

  if (cfg.collapsed) {
    return (
      <div className={`dock dock-collapsed side-${cfg.side}`}>
        {/* No drag region while collapsed: the 40px drag strip used to sit on
            top of this button and swallowed its clicks (-webkit-app-region:
            drag hit-testing), making the dock impossible to expand again. */}
        <button className="dock-rail-logo" onClick={toggleCollapse} data-tooltip="Expand dock" aria-label="Expand dock">
          <DocklyLogo size={22} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`dock dock-expanded side-${cfg.side}${cfg.focusMode ? ' focus' : ''}${narrow ? ' narrow' : ''}${short ? ' short' : ''}${mini ? ' mini' : ''}`}
      data-translucent={settings.dockTransparencyEnabled ? 'on' : 'off'}
      style={{ '--dock-alpha': String(settings.dockTransparency) } as CSSProperties}
    >
      <div className="dock-panel">
        {/* header */}
        <div className="dock-head" style={!cfg.locked ? ({ WebkitAppRegion: 'drag' } as CSSProperties) : undefined}>
          <div className="dock-head-left">
            <DocklyLogo size={16} />
            <span className="dock-brand">Dockly</span>
          </div>
          <div className="dock-head-actions" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
            {!cfg.focusMode && (
              <button className="dock-btn dock-btn-new" onClick={newNote} data-tooltip="Create a new sticky note">
                <Plus size={13} />
                {roomy && <span className="dock-btn-label">New</span>}
              </button>
            )}
            {!cfg.focusMode && (
              <button className="dock-btn" onClick={() => openMain('dashboard')} data-tooltip="View and organize all your notes">
                <LayoutDashboard size={13} />
              </button>
            )}
            {!cfg.focusMode && (
              <button className="dock-btn" onClick={() => openMain('settings')} data-tooltip="Customize Dockly — themes, transparency, subjects and shortcuts">
                <SettingsIcon size={13} />
              </button>
            )}
            <button className={`dock-btn${settings.dockOnTop ? ' on' : ''}`} onClick={togglePin} data-tooltip={settings.dockOnTop ? 'Unpin — allow other windows to cover the dock' : 'Pin — always stay on top of other windows'}>
              {settings.dockOnTop ? <Pin size={12} /> : <PinOff size={12} />}
            </button>
            {cfg.focusMode && (
              <button className="dock-btn" onClick={toggleFocus} data-tooltip="Exit focus mode">
                <Eye size={12} />
              </button>
            )}
            <button className="dock-btn" onClick={toggleCollapse} data-tooltip="Collapse">
              {innerEdge ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
            </button>
            <button className="dock-btn" onClick={() => void window.dockly.dock.close()} data-tooltip="Close Dockly">
              <X size={12} />
            </button>
          </div>
        </div>

        {/* search */}
        {!cfg.focusMode && (
          <div className="dock-search">
            <Search size={13} />
            <input
              className="dock-search-input"
              placeholder="Search notes…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={onSearchKey}
              spellCheck={false}
              aria-label="Search notes"
            />
            {searching && searchQ && (
              <button className="dock-search-clear" onClick={() => { setSearchQ(''); setSearching(false); }} data-tooltip="Clear search">
                <X size={11} />
              </button>
            )}
            {searching && searchQ && (
              <div className="dock-search-pop">
                {results.length === 0 && <div className="dock-search-empty">No notes match “{searchQ.trim()}”</div>}
                {results.slice(0, 8).map((r) => (
                  <button key={r.note.id} className="dock-search-row" onClick={() => void loadNote(r.note.id)}>
                    <span className="dock-subject-dot" />
                    <span className="dock-search-main">
                      <span className="dock-search-title">{r.note.title || 'Untitled'}</span>
                      <span className="dock-search-preview">{r.subject?.name ?? 'Note'} · {r.note.preview}</span>
                    </span>
                  </button>
                ))}
                {results.length > 8 && <div className="dock-search-more">{results.length - 8} more — open the library to see all</div>}
              </div>
            )}
          </div>
        )}

        {/* subject chip */}
        {!cfg.focusMode && (
          <div className="dock-subject-row">
            <div className="dock-subject-wrap">
              <button className="dock-subject-chip" onClick={() => setSubjectMenu((v) => !v)} data-tooltip="Choose subject for new notes">
                <span className="dock-subject-dot" />
                <span className="dock-subject-name">{subject?.name ?? 'No subject'}</span>
                <ChevronDown size={11} />
              </button>
              {subjectMenu && (
                <div className="dock-subject-pop">
                  <div className="dock-pop-label">Subjects</div>
                  {subjects.map((s) => (
                    <button
                      key={s.id}
                      className={`dock-subject-option${s.id === effectiveSubjectId ? ' active' : ''}`}
                      onClick={() => pickSubject(s.id)}
                    >
                      <SubjectIcon name={s.icon} size={13} />
                      <span className="dock-subject-option-name">{s.name}</span>
                      {s.id === effectiveSubjectId && <Check size={12} />}
                    </button>
                  ))}
                  {subjects.length === 0 && <div className="dock-search-empty">No subjects yet — open the library to create one</div>}
                  <button className="dock-subject-manage" onClick={() => { setSubjectMenu(false); openMain('settings'); }}>
                    Manage subjects…
                  </button>
                </div>
              )}
            </div>
            {subjectNoteCount !== null && <span className="dock-note-count">{subjectNoteCount} {subjectNoteCount === 1 ? 'note' : 'notes'}</span>}
          </div>
        )}

        {/* sticky note card */}
        <div className="dock-body">
          <div className={`dock-note${note ? '' : ' empty'}`}>
            {note ? (
              <>
                <div className="dock-note-head">
                  <input
                    className="dock-note-title"
                    value={title}
                    placeholder="Untitled note"
                    onChange={(e) => commitTitle(e.target.value)}
                    spellCheck={false}
                  />
                  <button
                    className={`dock-btn dock-note-star${note.isFavorite ? ' on' : ''}`}
                    onClick={() => void toggleFavorite(note.id)}
                    data-tooltip={note.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star size={12} fill={note.isFavorite ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <EditorContent className="dock-editor" editor={editor} />
              </>
            ) : (
              <div className="dock-note-empty">
                <button className="dock-note-cta" onClick={newNote}>
                  <Plus size={16} />
                  Start writing
                </button>
                <p className="dock-note-cta-sub">Instant new note · Win + Shift + S drops a screenshot in</p>
              </div>
            )}
          </div>

          {/* recent notes */}
          {!cfg.focusMode && (
            <div className="dock-recents">
              <div className="dock-section-label">Recent</div>
              {recents.length === 0 && <div className="dock-recents-empty">No notes yet — hit “New” to start writing</div>}
              {recents.map((r) => (
                <button
                  key={r.note.id}
                  className={`dock-recent${r.note.id === note?.id ? ' active' : ''}`}
                  onClick={() => void loadNote(r.note.id)}
                  aria-pressed={r.note.id === note?.id}
                >
                  <span className="dock-subject-dot" />
                  <span className="dock-recent-main">
                    <span className="dock-recent-title">{r.note.title || 'Untitled'}</span>
                    <span className="dock-recent-preview">{r.note.preview}</span>
                  </span>
                  <span className="dock-recent-time">{timeAgo(r.note.updatedAt)}</span>
                  <span
                    className={`dock-recent-star${r.note.isFavorite ? ' on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleFavorite(r.note.id);
                    }}
                    role="button"
                    data-tooltip={r.note.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    data-tooltip-delay="300"
                    aria-label={r.note.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star size={11} fill={r.note.isFavorite ? 'currentColor' : 'none'} />
                  </span>
                </button>
              ))}
              <button className="dock-open-library" onClick={() => openMain('dashboard')}>
                Open library
                <ArrowUpRight size={12} />
              </button>
            </div>
          )}
        </div>

        {/* footer */}
        {!cfg.focusMode && (
          <div className="dock-foot">
            <span className={`dock-save ${saveState}`}>
              <span className="dock-save-dot" />
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Autosave on'}
            </span>
            <span className="dock-capture-hint">{settings.autoInsertScreenshots ? 'Win+Shift+S → this note' : 'Screenshots off'}</span>
            <span className="dock-foot-actions">
              <button className="dock-btn" onClick={toggleLock} data-tooltip={cfg.locked ? 'Unlock position' : 'Lock position'}>
                {cfg.locked ? <Lock size={11} /> : <LockOpen size={11} />}
              </button>
              <button className="dock-btn" onClick={toggleFocus} data-tooltip="Focus mode">
                <Eye size={11} />
              </button>
              <button className="dock-btn" onClick={() => void window.dockly.dock.minimize()} data-tooltip="Minimize">
                <Minus size={11} />
              </button>
            </span>
            {!cfg.locked && <span className="dock-hint">drag inner edge to resize</span>}
          </div>
        )}

        {/* resize handles: inner edge (width), top/bottom edges (height), corner squares (both) */}
        {!cfg.locked && !dragActive && !cfg.focusMode && (
          <>
            <div
              className={`dock-resize ${innerEdge ? 'left' : 'right'}${dragActive ? ' active' : ''}`}
              onPointerDown={(e) => startResize(e, 'inner')}
            >
              <GripHorizontal size={12} />
            </div>
            {cfg.topEdgeFree && (
              <div
                className={`dock-resize-t${dragActive ? ' active' : ''}`}
                onPointerDown={(e) => startResize(e, 'top')}
              />
            )}
            <div
              className={`dock-resize-b${dragActive ? ' active' : ''}`}
              onPointerDown={(e) => startResize(e, 'bottom')}
            />
            {cfg.topEdgeFree && (
              <div
                className={`dock-resize-tc ${innerEdge ? 'left' : 'right'}${dragActive ? ' active' : ''}`}
                onPointerDown={(e) => startResize(e, 'top-inner')}
              />
            )}
            <div
              className={`dock-resize-bc ${innerEdge ? 'left' : 'right'}${dragActive ? ' active' : ''}`}
              onPointerDown={(e) => startResize(e, 'bottom-inner')}
            />
          </>
        )}
      </div>
    </div>
  );
}
