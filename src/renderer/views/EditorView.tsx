import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, BubbleMenu } from '@tiptap/react';
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
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Archive,
  ArrowDownToLine,
  Bold,
  Check,
  CheckSquare,
  ChevronDown,
  Code,
  Code2,
  Copy,
  Dock,
  FileClock,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  MoreVertical,
  Palette,
  Pilcrow,
  Quote,
  Redo2,
  Rows3,
  Save,
  Star,
  Strikethrough,
  Table2,
  Timer,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from 'lucide-react';
import { useApp } from '@/app/store';
import { BackButton, ConfirmDialog, Dropdown, SubjectIcon, timeAgo, useToast } from '@/components/ui';
import type { Note } from '@shared/types';

// Scroll positions per note, so returning to a note restores where you left off.
const scrollPositions = new Map<string, number>();

const HIGHLIGHT_COLORS = [
  { label: 'None', hex: null },
  { label: 'Yellow', hex: '#fde047' },
  { label: 'Green', hex: '#86efac' },
  { label: 'Red', hex: '#fca5a5' },
  { label: 'Blue', hex: '#93c5fd' },
  { label: 'Purple', hex: '#d8b4fe' },
];

const TEXT_COLORS = [
  { label: 'Default', hex: null },
  { label: 'Gray', hex: '#8b93a3' },
  { label: 'Red', hex: '#f87171' },
  { label: 'Orange', hex: '#fb923c' },
  { label: 'Yellow', hex: '#facc15' },
  { label: 'Green', hex: '#4ade80' },
  { label: 'Blue', hex: '#60a5fa' },
  { label: 'Purple', hex: '#c084fc' },
  { label: 'Pink', hex: '#f472b6' },
];

export function EditorView() {
  const noteId = useApp((s) => s.currentNoteId);
  const subjects = useApp((s) => s.subjects);
  const navFrom = useApp((s) => s.navFrom);
  const goBack = useApp((s) => s.goBack);
  const refreshNotes = useApp((s) => s.refreshNotes);
  const refreshSubjects = useApp((s) => s.refreshSubjects);
  const refreshRecents = useApp((s) => s.refreshRecents);
  const refreshFavorites = useApp((s) => s.refreshFavorites);
  const refreshTags = useApp((s) => s.refreshTags);
  const setVersionOpen = useApp((s) => s.setVersionOpen);
  const setAnnotationOpen = useApp((s) => s.setAnnotationOpen);
  const pendingShot = useApp((s) => s.pendingShot);
  const setPendingShot = useApp((s) => s.setPendingShot);
  const pendingText = useApp((s) => s.pendingText);
  const setPendingText = useApp((s) => s.setPendingText);
  const settings = useApp((s) => s.settings);
  const toast = useToast();
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [dirty, setDirty] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [timerSec, setTimerSec] = useState(0);
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastServerContent = useRef<string>('');

  const subject = subjects.find((s) => s.id === note?.subjectId);

  const load = useCallback(async (id: string) => {
    const n = await window.dockly.notes.get(id).catch(() => null);
    if (!n) {
      // The note no longer exists — never leave the user on a stuck screen.
      goBack();
      return;
    }
    setNote(n);
    setTitle(n.title);
    setTags(n.tags);
  }, [goBack]);

  useEffect(() => {
    if (!noteId) return;
    void load(noteId);
  }, [noteId, load]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Underline,
        Link.configure({ openOnClick: false, autolink: settings.markdownShortcuts }),
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Image.configure({ inline: false, allowBase64: true }),
        Placeholder.configure({
          placeholder: 'Start writing… or press Win + Shift + S to drop a screenshot here',
        }),
      ],
      // "Markdown shortcuts" preference: typing shortcuts (#, -, 1., **) off when disabled.
      enableInputRules: settings.markdownShortcuts,
      enablePasteRules: true,
      content: note ? note.content : '',
      editable: true,
      editorProps: {
        attributes: {
          class: `doc${settings.showLineNumbers ? ' line-numbers' : ''}`,
          spellcheck: settings.spellCheck ? 'true' : 'false',
        },
        handleDOMEvents: {
          click: (_view, e) => {
            const img = (e.target as HTMLElement).closest?.('img');
            if (img && img.src.startsWith('dockly-shot://')) {
              const fileName = fileNameFromSrc(img.src);
              if (fileName) setAnnotationOpen(true, fileName);
            }
            return false;
          },
        },
      },
      onUpdate: ({ editor }) => {
        setDirty(true);
        setSaveState('saving');
        if (!settings.autoSave) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          if (!noteId) return;
          void window.dockly.notes.contentSave(noteId, editor.getJSON() as unknown as string);
          setDirty(false);
          setSaveState('saved');
          setTimeout(() => setSaveState('idle'), 1800);
        }, 500);
      },
    },
    [settings.markdownShortcuts, settings.spellCheck, settings.showLineNumbers],
  );

  // Ctrl + S always saves explicitly (harmless with autosave on, essential with it off).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        persistSoon();
        toast.success('Note saved');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Study timer: elapsed session time while the note is open.
  useEffect(() => {
    if (!settings.studyTimer) return;
    const id = setInterval(() => setTimerSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [settings.studyTimer]);

  // Reading progress: scroll share of the note.
  useEffect(() => {
    if (!settings.readingProgress) return;
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 0);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [settings.readingProgress, note]);

  // apply remote content (from dock window)
  const remoteContent = useApp((s) => s.remoteContent);
  const clearRemote = useApp((s) => s.clearRemoteContent);
  useEffect(() => {
    if (!remoteContent || !editor) return;
    if (remoteContent.noteId !== noteId) return;
    clearRemote();
    const remote = typeof remoteContent.content === 'string' ? remoteContent.content : JSON.stringify(remoteContent.content);
    if (remote === lastServerContent.current) return;
    lastServerContent.current = remote;
    try {
      editor.commands.setContent(JSON.parse(remote), false);
    } catch {
      /* ignore malformed */
    }
  }, [remoteContent, editor, noteId, clearRemote]);

  // insert pending screenshot when editor is ready
  useEffect(() => {
    if (!pendingShot || !editor || !noteId) return;
    void (async () => {
      const dataUrl = pendingShot.dataUrl;
      setPendingShot(null);
      const base64 = dataUrl.split(',')[1];
      const { fileName } = await window.dockly.screenshots.save(noteId, base64);
      const node = { type: 'image', attrs: { src: `dockly-shot://f/${fileName}` } };
      const pos = editor.state.doc.content.size;
      editor.chain().focus().insertContentAt(pos, node).run();
      toast.success('Screenshot inserted');
      void persistSoon();
      void refreshNotes();
    })();
  }, [pendingShot, editor, noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // insert captured text (Ctrl + C) when enabled
  useEffect(() => {
    if (!pendingText || !editor || !noteId) return;
    const { text } = pendingText;
    setPendingText(null);
    const node = { type: 'paragraph', content: [{ type: 'text', text }] };
    const pos = editor.state.doc.content.size;
    editor.chain().focus().insertContentAt(pos, node).run();
    toast.success('Copied text inserted');
    void persistSoon();
    void refreshNotes();
  }, [pendingText, editor, noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistSoon = useCallback(() => {
    if (editor && noteId) {
      void window.dockly.notes.contentSave(noteId, editor.getJSON() as unknown as string);
    }
  }, [editor, noteId]);

  // Navigating away must never lose work: flush any pending edits on unmount
  // (also covers navigating with auto-save switched off).
  useEffect(() => {
    return () => {
      if (editor && noteId) {
        void window.dockly.notes.contentSave(noteId, editor.getJSON() as unknown as string);
      }
    };
  }, [editor, noteId]);

  // Remember where the user was in the note; restore it on return.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = noteId;
    return () => {
      if (id) scrollPositions.set(id, el.scrollTop);
    };
  }, [noteId]);

  // apply note content after load
  useEffect(() => {
    if (!editor || !note) return;
    if (note.content !== lastServerContent.current) {
      lastServerContent.current = note.content;
      editor.commands.setContent(JSON.parse(note.content), false);
    }
    const el = scrollRef.current;
    const saved = el && note ? scrollPositions.get(note.id) : null;
    if (el && saved) requestAnimationFrame(() => {
      el.scrollTop = saved;
    });
  }, [editor, note]);

  const commitTitle = (t: string) => {
    setTitle(t);
    if (noteId && t.trim() !== note?.title) {
      void window.dockly.notes.updateMeta(noteId, { title: t });
      void refreshNotes();
    }
  };

  const commitTags = async (next: string[]) => {
    setTags(next);
    if (noteId) {
      await window.dockly.notes.updateMeta(noteId, { tags: next });
      await refreshTags();
    }
  };

  const addTag = async () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || tags.includes(t)) return;
    await commitTags([...tags, t]);
    setTagInput('');
  };

  const favorite = async () => {
    if (!noteId) return;
    await window.dockly.notes.setFavorite(noteId, !note?.isFavorite);
    await Promise.all([refreshNotes(), refreshFavorites()]);
  };

  const duplicate = async () => {
    if (!noteId) return;
    await window.dockly.notes.duplicate(noteId);
    toast.success('Note duplicated');
    await Promise.all([refreshNotes(), refreshSubjects(), refreshRecents()]);
  };

  const archive = async () => {
    if (!noteId) return;
    await window.dockly.notes.archive(noteId, true);
    toast.success('Note archived');
    goBack();
    await Promise.all([refreshNotes(), refreshFavorites(), refreshRecents(), refreshSubjects()]);
  };

  const remove = async () => {
    if (!noteId) return;
    setConfirmDelete(false);
    const id = noteId;
    await window.dockly.notes.delete(id);
    useApp.getState().deleteNoteLocal(id);
    toast.success('Note deleted');
    goBack();
    await Promise.all([refreshNotes(), refreshFavorites(), refreshRecents(), refreshSubjects()]);
  };

  const dock = () => {
    if (!noteId) return;
    void window.dockly.dock.open(noteId);
    toast.info('Note docked to the edge of your screen');
  };

  const moveTo = async (subjectId: string) => {
    if (!noteId || !note || subjectId === note.subjectId) return;
    await window.dockly.notes.updateMeta(noteId, { subjectId: subjectId as never });
    setMoveOpen(false);
    toast.success('Note moved');
    await Promise.all([refreshNotes(), refreshSubjects()]);
  };

  const words = useMemo(() => (editor ? editor.getText().trim().split(/\s+/).filter(Boolean).length : 0), [editor?.state.doc]);

  if (!note) {
    return (
      <div className="editor-view view-enter">
        <div className="editor-loading">
          <div className="skeleton" style={{ width: 260, height: 26 }} />
          <div className="skeleton" style={{ width: '100%', height: 500, marginTop: 24 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="editor-view view-enter">
      {settings.readingProgress && (
        <div className="reading-progress" data-tooltip={`${progress}% read`}>
          <div className="reading-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
      {/* header */}
      <div className="editor-head">
        <BackButton label={navFrom === 'subject' ? 'Return to subject' : 'Return to notes'} onClick={goBack} />
        {subject && (
          <button className="editor-subject" onClick={() => useApp.getState().openSubject(subject.id)} data-tooltip={subject ? `Go to ${subject.name}` : 'Open subject'}>
            <SubjectIcon name={subject.icon} size={13} />
            {subject.name}
          </button>
        )}
        <div className="editor-head-actions">
          {settings.studyTimer && (
            <span className="study-timer" data-tooltip="Study session time — click to reset" onClick={() => setTimerSec(0)}>
              <Timer size={12} />
              {fmtTime(timerSec)}
            </span>
          )}
          {saveState !== 'idle' && (
            <span className={`save-indicator ${saveState}`}>
              <span className="save-dot" />
              {saveState === 'saving' ? 'Saving…' : 'Saved'}
            </span>
          )}
          {!settings.autoSave && dirty && (
            <span className="save-indicator saving">
              <span className="save-dot" />
              Unsaved
            </span>
          )}
          {!settings.autoSave && (
            <button className="btn btn-primary sm" onClick={() => { persistSoon(); setDirty(false); setSaveState('saved'); toast.success('Note saved'); }} data-tooltip="Save note (Ctrl+S)" data-tooltip-side="bottom">
              <Save size={13} />
              Save
            </button>
          )}
          <button className={`btn btn-icon btn-ghost${note.isFavorite ? ' star-on' : ''}`} onClick={favorite} data-tooltip={note.isFavorite ? 'Remove favorite' : 'Add to favorites'} data-tooltip-side="bottom">
            <StarIcon filled={note.isFavorite} />
          </button>
          <button className="btn btn-icon btn-ghost" onClick={() => setVersionOpen(true)} data-tooltip="Version history" data-tooltip-side="bottom">
            <FileClock />
          </button>
          <button className="btn btn-icon btn-ghost" onClick={dock} data-tooltip="Dock to screen (Ctrl+Shift+D)" data-tooltip-side="bottom">
            <Dock />
          </button>
          <div className="menu-anchor">
            <button className="btn btn-icon btn-ghost" onClick={() => setMenuOpen(!menuOpen)} data-tooltip="More" data-tooltip-side="bottom">
              <MoreVertical />
            </button>
            {menuOpen && (
              <Dropdown
                onClose={() => setMenuOpen(false)}
                items={[
                  { label: 'Duplicate note', icon: Copy, kbd: 'Ctrl+D', onClick: duplicate },
                  { label: 'Move to subject…', icon: Rows3, onClick: () => setMoveOpen(true) },
                  { label: 'Archive', icon: Archive, kbd: 'Ctrl+Shift+A', onClick: archive },
                  { sep: true },
                  { label: 'Delete note', icon: Trash2, danger: true, onClick: () => setConfirmDelete(true) },
                ]}
              />
            )}
          </div>
        </div>
      </div>

      {/* toolbar */}
      {settings.richText && (
        <div className="editor-toolbar">
        <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} active={editor?.isActive('heading', { level: 1 })} tip="Heading 1">
          <Pilcrow />
          <ChevronDown size={11} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive('bold')} tip="Bold (Ctrl+B)">
          <Bold />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive('italic')} tip="Italic (Ctrl+I)">
          <Italic />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive('underline')} tip="Underline (Ctrl+U)">
          <UnderlineIcon />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive('strike')} tip="Strikethrough">
          <Strikethrough />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleCode().run()} active={editor?.isActive('code')} tip="Inline code">
          <Code2 />
        </ToolbarButton>

        <div className="toolbar-sep" />

        <ToolbarButton onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive('bulletList')} tip="Bulleted list">
          <List />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')} tip="Numbered list">
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleTaskList().run()} active={editor?.isActive('taskList')} tip="Checklist">
          <CheckSquare />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={editor?.isActive('blockquote')} tip="Quote">
          <Quote />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleCodeBlock().run()} active={editor?.isActive('codeBlock')} tip="Code block">
          <Code />
        </ToolbarButton>

        <div className="toolbar-sep" />

        <ToolbarButton onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} active={editor?.isActive('table')} tip="Insert table">
          <Table2 />
        </ToolbarButton>
        <ToolbarButton onClick={() => openLink(editor)} active={editor?.isActive('link')} tip="Insert link (Ctrl+K)">
          <Link2 />
        </ToolbarButton>

        <ColorDropdown editor={editor} kind="highlight" />
        <ColorDropdown editor={editor} kind="text" />

        <div className="toolbar-sep" />

        <ToolbarButton onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()} tip="Undo">
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()} tip="Redo">
          <Redo2 />
        </ToolbarButton>

        <div className="toolbar-right">
          <span className="word-count t-mute">{words} {words === 1 ? 'word' : 'words'}</span>
        </div>
      </div>
      )}

      {/* tags */}
      <div className="editor-tags">
        {tags.map((t) => (
          <span key={t} className="chip chip-tag">
            #{t}
            <span className="chip-x" data-tooltip="Remove tag" onClick={() => void commitTags(tags.filter((x) => x !== t))}>
              <X size={9} />
            </span>
          </span>
        ))}
        <input
          className="tag-input"
          placeholder={tags.length === 0 ? 'Add tags like #Exam, #Formula…' : 'Add tag…'}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addTag();
            if (e.key === 'Backspace' && !tagInput && tags.length) void commitTags(tags.slice(0, -1));
          }}
        />
      </div>

      {/* title */}
      <input
        className="editor-title t-display"
        value={title}
        placeholder="Untitled note"
        onChange={(e) => commitTitle(e.target.value)}
        spellCheck={false}
      />

      {/* document */}
      <div className="editor-scroll" ref={scrollRef}>
        <EditorContent editor={editor} />
        {editor && settings.richText && (
          <BubbleMenu editor={editor} tippyOptions={{ duration: 150, placement: 'top' }}>
            <div className="bubble">
              <BBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} tip="Bold">
                <Bold size={13} />
              </BBtn>
              <BBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} tip="Italic">
                <Italic size={13} />
              </BBtn>
              <BBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} tip="Underline">
                <UnderlineIcon size={13} />
              </BBtn>
              <BBtn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} tip="Highlight">
                <Highlighter size={13} />
              </BBtn>
              <BBtn onClick={() => openLink(editor)} active={editor.isActive('link')} tip="Insert link">
                <Link2 size={13} />
              </BBtn>
              {editor.isActive('table') ? (
                <BBtn onClick={() => editor.chain().focus().deleteTable().run()} tip="Delete table">
                  <Trash2 size={13} />
                </BBtn>
              ) : null}
            </div>
          </BubbleMenu>
        )}
      </div>

      {/* footer */}
      <div className="editor-foot">
        <span className="t-mute" style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <ArrowDownToLine size={11} />
          {settings.autoSave ? 'Autosave on — never lose a word' : 'Autosave off — press Ctrl+S to save'}
        </span>
        {note && <span className="t-mute" style={{ fontSize: 11.5 }}>Edited {timeAgo(note.updatedAt)}</span>}
      </div>

      {/* move modal */}
      {moveOpen && (
        <div className="modal-backdrop" onClick={() => setMoveOpen(false)}>
          <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Move note to…</div>
            </div>
            <div className="modal-body">
              {subjects.map((s) => (
                <button
                  key={s.id}
                  className="menu-item"
                  style={{ height: 38 }}
                  onClick={() => void moveTo(s.id)}
                >
                  <SubjectIcon name={s.icon} size={15} />
                  {s.name}
                  {s.id === note.subjectId && <span className="t-mute" style={{ marginLeft: 'auto' }}>current</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* delete confirmation — permanent, irreversible data loss */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this note?"
          body={
            <p className="t-sub">
              <b>“{note.title || 'Untitled note'}”</b> and any screenshots inside it will be permanently deleted. This cannot be undone.
            </p>
          }
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

function fmtTime(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fileNameFromSrc(src: string): string | null {
  try {
    const u = new URL(src);
    return decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
}

async function openLink(editor: import('@tiptap/react').Editor | null) {
  if (!editor) return;
  const prev = editor.getAttributes('link').href as string | undefined;
  const url = window.prompt('Link URL', prev ?? 'https://');
  if (url === null) return;
  if (!url.trim()) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
}

function ToolbarButton({
  children,
  onClick,
  active,
  disabled,
  tip,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tip?: string;
}) {
  return (
    <button className={`tb-btn${active ? ' active' : ''}`} onClick={onClick} disabled={disabled} data-tooltip={tip}>
      {children}
    </button>
  );
}

function ColorDropdown({ editor, kind }: { editor: import('@tiptap/react').Editor | null; kind: 'highlight' | 'text' }) {
  const [open, setOpen] = useState(false);
  const colors = kind === 'highlight' ? HIGHLIGHT_COLORS : TEXT_COLORS;
  const activeHex = kind === 'highlight' ? editor?.getAttributes('highlight')?.color : editor?.getAttributes('textStyle')?.color;
  return (
    <div className="menu-anchor">
      <button
        className={`tb-btn${activeHex ? ' active' : ''}`}
        onClick={() => setOpen(!open)}
        data-tooltip={kind === 'highlight' ? 'Highlight' : 'Text color'}
      >
        {kind === 'highlight' ? <Highlighter /> : <Palette />}
        {activeHex && <span className="tb-dot" style={{ background: activeHex }} />}
      </button>
      {open && (
        <div className="color-pop" onMouseLeave={() => setOpen(false)}>
          {colors.map((c) => (
            <button
              key={c.label}
              className="color-item"
              onClick={() => {
                if (!editor) return;
                if (kind === 'highlight') {
                  if (c.hex) editor.chain().focus().setHighlight({ color: c.hex }).run();
                  else editor.chain().focus().unsetHighlight().run();
                } else {
                  if (c.hex) editor.chain().focus().setColor(c.hex).run();
                  else editor.chain().focus().unsetColor().run();
                }
                setOpen(false);
              }}
            >
              <span className="color-swatch" style={{ background: c.hex ?? 'transparent', border: c.hex ? 'none' : '1px dashed var(--border-strong)' }} />
              {c.label}
              {activeHex === c.hex && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BBtn({ children, onClick, active, tip }: { children: React.ReactNode; onClick: () => void; active?: boolean; tip?: string }) {
  return (
    <button className={`b-btn${active ? ' active' : ''}`} onClick={onClick} data-tooltip={tip}>
      {children}
    </button>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return <Star size={16} fill={filled ? 'currentColor' : 'none'} />;
}
