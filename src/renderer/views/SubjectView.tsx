import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Clock,
  Copy,
  Image as ImageIcon,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { useApp } from '@/app/store';
import { BackButton, ConfirmDialog, Dropdown, EmptyState, SubjectIcon, timeAgo, useToast } from '@/components/ui';
import type { Note } from '@shared/types';

export function SubjectView() {
  const subjects = useApp((s) => s.subjects);
  const notes = useApp((s) => s.notes);
  const currentSubjectId = useApp((s) => s.currentSubjectId);
  const goBack = useApp((s) => s.goBack);
  const createNote = useApp((s) => s.createNote);
  const refreshNotes = useApp((s) => s.refreshNotes);
  const refreshTags = useApp((s) => s.refreshTags);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const [filter, setFilter] = useState<'all' | 'favorites' | string>('all');
  const [search, setSearch] = useState('');

  const subject = subjects.find((s) => s.id === currentSubjectId);

  const subjectTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) for (const t of n.tags) set.add(t);
    return Array.from(set);
  }, [notes]);

  const filtered = useMemo(() => {
    let list = notes;
    if (filter === 'favorites') list = list.filter((n) => n.isFavorite);
    else if (filter !== 'all') list = list.filter((n) => n.tags.includes(filter));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (n) => n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [notes, filter, search]);

  useEffect(() => {
    void refreshNotes(currentSubjectId ?? undefined);
    void refreshTags();
  }, [currentSubjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!subject) return null;

  return (
    <div className="subject-view view-enter">
      <div className="sub-head">
        <BackButton label="Return to dashboard" onClick={goBack} />
        <div className="sub-title-icon">
          <SubjectIcon name={subject.icon} size={20} />
        </div>
        <div>
          <div className="sub-title t-display">{subject.name}</div>
          <div className="t-sub">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </div>
        </div>
        <div className="sub-actions">
          <div className="sub-search">
            <Search size={13} />
            <input
              className="sub-search-input"
              placeholder="Filter notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-ghost btn-icon" onClick={() => setSearchOpen('')} data-tooltip="Search everywhere">
            <Search />
          </button>
              <button className="btn btn-primary" onClick={() => void createNote(subject.id)} data-tooltip="Create your first note">
            <Plus size={14} />
            New note
          </button>
        </div>
      </div>

      {subjectTags.length > 0 && (
        <div className="sub-filters">
          <button
            className={`chip${filter === 'all' ? ' chip-active' : ''}`}
            onClick={() => setFilter('all')}
            data-tooltip="Show all notes"
          >
            All
          </button>
          <button
            className={`chip${filter === 'favorites' ? ' chip-active' : ''}`}
            onClick={() => setFilter('favorites')}
            data-tooltip="Favorites only"
          >
            <Star size={11} fill="currentColor" />
            Favorites
          </button>
          {subjectTags.map((t) => (
            <button key={t} className={`chip${filter === t ? ' chip-active' : ''}`} onClick={() => setFilter(filter === t ? 'all' : t)} data-tooltip={`Filter by #${t}`}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={search || filter !== 'all' ? Search : Pencil}
          title={search || filter !== 'all' ? 'No notes match' : 'This subject is empty'}
          sub={
            search || filter !== 'all'
              ? 'Try a different filter or search term.'
              : 'Capture your first idea — or snip a screenshot with Win + Shift + S.'
          }
          cta={
            !search && filter === 'all' ? (
          <button className="btn btn-primary" onClick={() => void createNote(subject.id)} data-tooltip="New note (Ctrl+N)">
                <Plus size={14} />
                Create first note
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="notes-grid stagger">
          {filtered.map((n, i) => (
            <NoteCard key={n.id} note={n} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCard({ note, index }: { note: Note; index: number }) {
  const openNote = useApp((s) => s.openNote);
  const refreshNotes = useApp((s) => s.refreshNotes);
  const refreshFavorites = useApp((s) => s.refreshFavorites);
  const refreshRecents = useApp((s) => s.refreshRecents);
  const refreshSubjects = useApp((s) => s.refreshSubjects);
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const actions = {
    favorite: async () => {
      await window.dockly.notes.setFavorite(note.id, !note.isFavorite);
      await Promise.all([refreshNotes(), refreshFavorites(), refreshRecents()]);
    },
    duplicate: async () => {
      await window.dockly.notes.duplicate(note.id);
      await Promise.all([refreshNotes(), refreshSubjects(), refreshRecents()]);
      toast.success('Note duplicated');
    },
    archive: async () => {
      await window.dockly.notes.archive(note.id, true);
      await Promise.all([refreshNotes(), refreshFavorites(), refreshRecents(), refreshSubjects()]);
      toast.success('Note archived');
    },
    remove: async () => {
      setConfirmDelete(false);
      await window.dockly.notes.delete(note.id);
      useApp.getState().deleteNoteLocal(note.id);
      await Promise.all([refreshNotes(), refreshFavorites(), refreshRecents(), refreshSubjects()]);
      toast.success('Note deleted');
    },
  };

  return (
    <div
      className="note-card-full card card-hover stagger-item"
      style={{ '--i': index } as React.CSSProperties}
      onClick={() => void openNote(note.id)}
    >
      <div className="ncf-top">
        {note.isFavorite && (
          <div className="ncf-star">
            <Star size={11} fill="currentColor" />
          </div>
        )}
        <div className="ncf-menu menu-anchor">
          <button
            className="btn btn-icon btn-ghost sm"
            data-tooltip="Note actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(!menu);
            }}
          >
            <MoreVertical size={15} />
          </button>
          {menu && (
            <Dropdown
              onClose={() => setMenu(false)}
              items={[
                { label: note.isFavorite ? 'Remove from favorites' : 'Add to favorites', icon: Star, kbd: 'Ctrl+Shift+F', onClick: actions.favorite },
                { label: 'Duplicate', icon: Copy, kbd: 'Ctrl+D', onClick: actions.duplicate },
                { label: 'Archive', icon: Archive, kbd: 'Ctrl+Shift+A', onClick: actions.archive },
                { sep: true },
                { label: 'Delete', icon: Trash2, danger: true, onClick: () => setConfirmDelete(true) },
              ]}
            />
          )}
        </div>
      </div>
      <div className="ncf-title t-display">{note.title || 'Untitled note'}</div>
      <div className="ncf-preview">{note.preview || 'Empty note — click to start writing…'}</div>
      <div className="ncf-meta">
        {note.screenshotCount > 0 && (
          <span className="ncf-meta-item">
            <ImageIcon size={11} />
            {note.screenshotCount}
          </span>
        )}
        {note.tags.slice(0, 3).map((t) => (
          <span key={t} className="ncf-tag">
            #{t}
          </span>
        ))}
        <span className="ncf-time">
          <Clock size={11} />
          {timeAgo(note.updatedAt)}
        </span>
      </div>

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
          onConfirm={() => void actions.remove()}
        />
      )}
    </div>
  );
}
