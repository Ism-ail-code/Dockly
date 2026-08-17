import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { extractPreviewFromDoc } from '@shared/preview';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Placeholder from '@tiptap/extension-placeholder';
import {
  ArrowUpRight,
  Bold,
  Camera,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCopy,
  Code,
  Eye,
  GripHorizontal,
  Heading1,
  Heading2,
  Italic,
  LayoutDashboard,
  List,
  ListOrdered,
  Lock,
  LockOpen,
  Minus,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Quote,
  Search,
  Settings as SettingsIcon,
  Star,
  X,
} from 'lucide-react';
import type { DockConfig, Note, Settings, Subject } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import { useApp } from '@/app/store';
import { NockLogo } from '@/components/TopBar';
import { SubjectIcon, timeAgo } from '@/components/ui';
import { ResizableImage } from '@/lib/resizableImage';
import { textToHtml } from '@/lib/clipboardText';

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
  const [moreMenu, setMoreMenu] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [dragActive, setDragActive] = useState(false);
  const [capturedFlash, setCapturedFlash] = useState<string | null>(null);
  const [recentsCompact, setRecentsCompact] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      window.nock.on('dock:state', (d) => {
        setCfg((prev) => ({ ...prev, ...(d as Partial<DockConfig>) }));
      }),
      window.nock.on('sync:settings', (s) => {
        const next = s as Settings;
        setSettings(next);
        useApp.getState().applySettings(next);
      }),
      window.nock.on('sync:active-note', (p) => {
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
      const [d, s] = await Promise.all([window.nock.dock.getState(), window.nock.settings.get()]);
      setCfg((prev) => ({ ...prev, ...d }));
      setSettings(s);
      useApp.getState().applySettings(s);
    })();
    void refreshSubjects();
    void refreshRecents();
    void window.nock.clipboard.setCaptureMode('off');
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSubjects = useCallback(async () => {
    setSubjects(await window.nock.subjects.list());
  }, []);

  const refreshRecents = useCallback(async () => {
    const subjectById = new Map((await window.nock.subjects.list()).map((s) => [s.id, s]));
    const rows = (await window.nock.notes.listRecents(8)).map((note) => ({ note, subject: subjectById.get(note.subjectId) }));
    setRecents(rows);
  }, []);

  // ---------- subject note count ----------
  useEffect(() => {
    if (!effectiveSubjectId) {
      setSubjectNoteCount(null);
      return;
    }
    void window.nock.notes.list(effectiveSubjectId).then((n) => setSubjectNoteCount(n.length));
  }, [effectiveSubjectId]);

  // ---------- capture mode: the dock consumes screenshots while a note is open ----------
  useEffect(() => {
    void window.nock.clipboard.setCaptureMode(note ? 'editor' : 'off');
  }, [note?.id]);

  // ---------- editor ----------
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Underline,
        Link.configure({ openOnClick: false, autolink: settings.markdownShortcuts }),
        // Schema parity with the library editor: notes created there can carry
        // highlight / text-color / link marks, and the dock must parse them
        // instead of rejecting the whole document.
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        TaskList,
        TaskItem,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        ResizableImage.configure({ inline: false }),
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
          void window.nock.notes.contentSave(id, snapshot as unknown as string, extractPreviewFromDoc(snapshot));
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
      const doc = editor.getJSON();
      void window.nock.notes.contentSave(id, doc as unknown as string, extractPreviewFromDoc(doc));
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [editor]);

  // apply remote content (from main window)
  useEffect(() => {
    const off = window.nock.on('sync:note-content', (c) => {
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
    const off = window.nock.on('clipboard:image', (p) => {
      const payload = p as { png: string; width: number; height: number; capturedAt: number };
      const id = activeNoteId.current;
      if (!id) return;
      if (!settingsRef.current.autoInsertScreenshots) return;
      void (async () => {
        try {
          const { fileName } = await window.nock.screenshots.save(id, payload.png);
          const src = 'nock-shot://f/' + fileName;
          const pos = editorRef.current?.state.doc.content.size ?? 0;
          editorRef.current?.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src } }).run();
        } catch {
          /* ignore */
        }
      })();
    });
    return off;
  }, [editor]);

  // Tell the main process when the user copies text INSIDE Nock, so it can
  // recognize and ignore self-copies (no feedback loops into the same note).
  useEffect(() => {
    const onCopy = () => void window.nock.clipboard.markSelfCopy();
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  // Auto Capture Copied Text: insert captured text (Ctrl + C in another app)
  // into the active note. Inserts at the current cursor when the editor has
  // focus, otherwise appends at the end. Saves immediately.
  useEffect(() => {
    const off = window.nock.on('clipboard:text', (p) => {
      const payload = p as { text: string; noteId: string | null; capturedAt: number };
      const id = activeNoteId.current;
      if (!id) return;
      if (payload.noteId && payload.noteId !== id) return;
      if (!settingsRef.current.autoCaptureText) return;

      const html = textToHtml(payload.text);
      if (!html) return;
      const ed = editorRef.current;
      if (!ed) return;

      const focused = ed.isFocused;
      if (focused) {
        // The user is already typing here — insert at the caret and keep focus.
        ed.chain().focus().insertContent(html, { parseOptions: { preserveWhitespace: 'full' } }).run();
      } else {
        // The user is working in another app — append WITHOUT stealing focus
        // (focusing would yank the OS focus out of their current app and make
        // the next copy look like a self-copy). Scroll to the insertion so the
        // captured text is actually visible.
        const pos = ed.state.doc.content.size;
        ed.chain()
          .insertContentAt(pos, html, { parseOptions: { preserveWhitespace: 'full' } })
          .scrollIntoView()
          .run();
      }
      const doc = ed.getJSON();
      void window.nock.notes.contentSave(id, doc as unknown as string, extractPreviewFromDoc(doc));
      if (recentsTimer.current) clearTimeout(recentsTimer.current);
      recentsTimer.current = setTimeout(() => void refreshRecents(), 1500);

      setCapturedFlash('Text captured ✓');
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setCapturedFlash(null), 2600);
    });
    return off;
  }, [refreshRecents]);

  // ---------- actions ----------
  // The ONLY note-loading path. Race-protected: bumping `loadSeq` invalidates
  // any in-flight request, so rapidly clicking several notes always ends on
  // the last one clicked — never an out-of-order response.
  const loadNote = useCallback(
    async (id: string) => {
      const seq = ++loadSeq.current;
      const n = await window.nock.notes.get(id);
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
      void window.nock.window.openMain('dashboard');
      return;
    }
    void window.nock.notes.create(target, '');
    void refreshRecents();
  };

  const commitTitle = (t: string) => {
    setTitle(t);
    if (note && t.trim() !== note.title) {
      void window.nock.notes.updateMeta(note.id, { title: t });
      void refreshRecents();
    }
  };

  const toggleFavorite = async (id: string) => {
    const n = recents.find((r) => r.note.id === id)?.note;
    if (!n) return;
    const next = !n.isFavorite;
    await window.nock.notes.setFavorite(id, next);
    // Refresh the open note card immediately so its star + tooltip flip
    // without waiting for a full reload.
    setNote((prev) => (prev && prev.id === id ? { ...prev, isFavorite: next } : prev));
    void refreshRecents();
  };

  const openMain = (view: string) => {
    void window.nock.window.openMain(view);
  };

  const pickSubject = (id: string) => {
    setCurSubjectId(id);
    setSubjectMenu(false);
    void window.nock.settings.set('lastSubjectId', id);
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
        const res = await window.nock.search(q, 'all');
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

  const toggleCollapse = () => void window.nock.dock.toggleCollapse();
  const toggleLock = () => void window.nock.dock.setLocked(!cfg.locked);
  const toggleFocus = () => void window.nock.dock.toggleFocus();
  const togglePin = () => void window.nock.dock.setOnTop(!settings.dockOnTop);

  // resize handle drag logic — unified for every edge/corner
  type ResizeKind = 'inner' | 'top' | 'bottom' | 'top-inner' | 'bottom-inner';
  const startResize = useCallback(
    (e: ReactPointerEvent, kind: ResizeKind) => {
      if (cfg.collapsed || cfg.locked) return;
      e.preventDefault();
      const startX = e.screenX;
      const startY = e.screenY;
      // Anchor the drag to the LIVE window size: cfg.width/height can be 0
      // ("auto" full-height mode) or momentarily stale while a dock:state
      // broadcast is in flight — both made the first vertical drag snap to
      // the minimum height instead of tracking the cursor.
      const startW = cfg.width > 0 ? cfg.width : window.innerWidth;
      const startH = cfg.height > 0 ? cfg.height : window.innerHeight;
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
          void window.nock.dock.setWidth(nextW);
        } else {
          const fixed: 'top' | 'bottom' = kind === 'top' || kind === 'top-inner' ? 'bottom' : 'top';
          void window.nock.dock.setSize(nextW, nextH, fixed);
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
          <NockLogo size={22} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`dock dock-expanded side-${cfg.side}${cfg.focusMode ? ' focus' : ''}${narrow ? ' narrow' : ''}${short ? ' short' : ''}${mini ? ' mini' : ''}`}
      data-translucent={settings.dockTransparencyEnabled ? 'on' : 'off'}
      data-glass={settings.dockGlassStyle}
      style={{ '--dock-alpha': String(settings.dockTransparency) } as CSSProperties}
    >
      <div className="dock-panel">
        {capturedFlash && <div className="dock-flash">{capturedFlash}</div>}
        {/* header */}
        <div className="dock-head" style={!cfg.locked ? ({ WebkitAppRegion: 'drag' } as CSSProperties) : undefined}>
          <div className="dock-head-left">
            <NockLogo size={16} />
            <span className="dock-brand">Nock</span>
          </div>
          <div className="dock-head-actions" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
            {!cfg.focusMode && (
              <button className="dock-btn dock-btn-new" onClick={newNote} data-tooltip="Create a new sticky note">
                <Plus size={13} />
                {roomy && <span className="dock-btn-label">New</span>}
              </button>
            )}
            {!cfg.focusMode && (
              <button className="dock-btn dock-btn-library" onClick={() => openMain('dashboard')} data-tooltip="Library — return to your main notes library">
                <LayoutDashboard size={13} />
              </button>
            )}
            {!cfg.focusMode && (
              <button className="dock-btn" onClick={() => openMain('settings')} data-tooltip="Customize Nock — themes, transparency, subjects and shortcuts">
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
            <button className="dock-btn" onClick={toggleCollapse} data-tooltip="Collapse — tuck the dock into a slim rail">
              {innerEdge ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
            </button>
            <button className="dock-btn" onClick={() => void window.nock.dock.close()} data-tooltip="Close Nock">
              <X size={12} />
            </button>
          </div>
        </div>

        {/* capture quick toggles — live mirrors of the Clipboard settings */}
        {!cfg.focusMode && (
          <div className="dock-capture-row">
            <button
              className={`dock-capture-toggle${settings.autoCaptureText ? ' on' : ''}`}
              onClick={() => void window.nock.settings.set('autoCaptureText', !settings.autoCaptureText)}
              data-tooltip={settings.autoCaptureText ? 'Text Capture — automatically capture copied text' : 'Click to enable automatic text capture'}
              aria-pressed={settings.autoCaptureText}
            >
              <ClipboardCopy size={11} />
              <span className="dock-capture-label">Text</span>
              <span className="dock-capture-state">{settings.autoCaptureText ? 'On' : 'Off'}</span>
            </button>
            <button
              className={`dock-capture-toggle${settings.autoInsertScreenshots ? ' on' : ''}`}
              onClick={() => void window.nock.settings.set('autoInsertScreenshots', !settings.autoInsertScreenshots)}
              data-tooltip={settings.autoInsertScreenshots ? 'Screenshot Capture — automatically capture screenshots' : 'Click to enable automatic screenshot capture'}
              aria-pressed={settings.autoInsertScreenshots}
            >
              <Camera size={11} />
              <span className="dock-capture-label">Screenshot</span>
              <span className="dock-capture-state">{settings.autoInsertScreenshots ? 'On' : 'Off'}</span>
            </button>
          </div>
        )}

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
                {settings.richText && (
                  <div className="dock-editor-toolbar">
                    <button
                      className={`dock-ttb${editor?.isActive('heading', { level: 1 }) ? ' active' : ''}`}
                      onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
                      data-tooltip="Heading 1 — big section title"
                    >
                      <Heading1 size={13} />
                    </button>
                    <button
                      className={`dock-ttb${editor?.isActive('heading', { level: 2 }) ? ' active' : ''}`}
                      onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                      data-tooltip="Heading 2 — sub-section title"
                    >
                      <Heading2 size={13} />
                    </button>
                    <button
                      className={`dock-ttb${editor?.isActive('bold') ? ' active' : ''}`}
                      onClick={() => editor?.chain().focus().toggleBold().run()}
                      data-tooltip="Bold — make text heavier"
                    >
                      <Bold size={13} />
                    </button>
                    <button
                      className={`dock-ttb${editor?.isActive('italic') ? ' active' : ''}`}
                      onClick={() => editor?.chain().focus().toggleItalic().run()}
                      data-tooltip="Italic — slant text for emphasis"
                    >
                      <Italic size={13} />
                    </button>
                    <button
                      className={`dock-ttb${editor?.isActive('bulletList') ? ' active' : ''}`}
                      onClick={() => editor?.chain().focus().toggleBulletList().run()}
                      data-tooltip="Bulleted list — add bullet points"
                    >
                      <List size={13} />
                    </button>
                    <button
                      className={`dock-ttb${editor?.isActive('orderedList') ? ' active' : ''}`}
                      onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                      data-tooltip="Numbered list — add steps or order"
                    >
                      <ListOrdered size={13} />
                    </button>
                    <button
                      className={`dock-ttb${editor?.isActive('taskList') ? ' active' : ''}`}
                      onClick={() => editor?.chain().focus().toggleTaskList().run()}
                      data-tooltip="Checklist — track tasks to do"
                    >
                      <CheckSquare size={13} />
                    </button>
                    <button
                      className={`dock-ttb${editor?.isActive('blockquote') ? ' active' : ''}`}
                      onClick={() => editor?.chain().focus().toggleBlockquote().run()}
                      data-tooltip="Quote — highlight a quotation"
                    >
                      <Quote size={13} />
                    </button>
                    <button
                      className={`dock-ttb${editor?.isActive('codeBlock') ? ' active' : ''}`}
                      onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
                      data-tooltip="Code block — show code neatly"
                    >
                      <Code size={13} />
                    </button>
                  </div>
                )}
                <EditorContent className="dock-editor" editor={editor} />
              </>
            ) : (
              <div className="dock-note-empty">
                <button className="dock-note-cta" onClick={newNote} data-tooltip="Create a new sticky note">
                  <Plus size={16} />
                  Start writing
                </button>
                <p className="dock-note-cta-sub">Instant new note · Win + Shift + S drops a screenshot in</p>
              </div>
            )}
          </div>

          {/* recent notes */}
          {!cfg.focusMode && (
            <div className={`dock-recents${recentsCompact ? ' compact' : ''}`}>
              <div className="dock-section-head">
                <span className="dock-section-label">Recent</span>
                <button
                  className={`dock-btn dock-recents-toggle${recentsCompact ? ' on' : ''}`}
                  onClick={() => setRecentsCompact((v) => !v)}
                  data-tooltip={recentsCompact ? 'Expand recent notes' : 'Compact recent notes'}
                  aria-label={recentsCompact ? 'Expand recent notes' : 'Compact recent notes'}
                >
                  {recentsCompact ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              </div>
              {!recentsCompact && (
                <>
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
                </>
              )}
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
            <div className="dock-more-wrap">
              <button
                className={`dock-btn dock-more-btn${moreMenu ? ' on' : ''}`}
                onClick={() => setMoreMenu((v) => !v)}
                data-tooltip="More options — lock, focus and minimize"
                aria-expanded={moreMenu}
                aria-label="More options"
              >
                <MoreHorizontal size={11} />
              </button>
              {moreMenu && (
                <div className="dock-more-pop">
                  <button
                    className="dock-more-item"
                    onClick={() => { setMoreMenu(false); toggleLock(); }}
                    data-tooltip={cfg.locked ? 'Unlock position' : 'Lock position'}
                  >
                    {cfg.locked ? <LockOpen size={11} /> : <Lock size={11} />}
                    {cfg.locked ? 'Unlock position' : 'Lock position'}
                  </button>
                  <button className="dock-more-item" onClick={() => { setMoreMenu(false); toggleFocus(); }} data-tooltip="Focus mode">
                    <Eye size={11} />
                    Focus mode
                  </button>
                  <button
                    className="dock-more-item"
                    onClick={() => { setMoreMenu(false); void window.nock.dock.minimize(); }}
                    data-tooltip="Minimize"
                  >
                    <Minus size={11} />
                    Minimize
                  </button>
                  {!cfg.locked && <div className="dock-more-hint">drag edges &amp; corners to resize</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* resize handles: inner edge (width), top/bottom edges (height), corner squares (both) */}
        {!cfg.locked && !cfg.focusMode && (
          <>
            <div
              className={`dock-resize ${innerEdge ? 'left' : 'right'}${dragActive ? ' active' : ''}`}
              onPointerDown={(e) => startResize(e, 'inner')}
              data-tooltip="Resize dock — drag to change width"
            >
              <GripHorizontal size={12} />
            </div>
            {cfg.topEdgeFree && (
              <div
                className={`dock-resize-t${dragActive ? ' active' : ''}`}
                onPointerDown={(e) => startResize(e, 'top')}
                data-tooltip="Resize height — drag the top edge"
              />
            )}
            <div
              className={`dock-resize-b${dragActive ? ' active' : ''}`}
              onPointerDown={(e) => startResize(e, 'bottom')}
              data-tooltip="Resize height — drag the bottom edge"
            />
            {cfg.topEdgeFree && (
              <div
                className={`dock-resize-tc ${innerEdge ? 'left' : 'right'}${dragActive ? ' active' : ''}`}
                onPointerDown={(e) => startResize(e, 'top-inner')}
                data-tooltip="Resize dock — drag to change width and height"
              />
            )}
            <div
              className={`dock-resize-bc ${innerEdge ? 'left' : 'right'}${dragActive ? ' active' : ''}`}
              onPointerDown={(e) => startResize(e, 'bottom-inner')}
              data-tooltip="Resize dock — drag to change width and height"
            />
          </>
        )}
      </div>
    </div>
  );
}
