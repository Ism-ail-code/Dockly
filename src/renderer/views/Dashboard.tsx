import { useEffect, useMemo, useState } from 'react';
import {
  ArchiveRestore,
  ArrowRight,
  Camera,
  Clock,
  Hash,
  Image as ImageIcon,
  Plus,
  Star,
  StickyNote,
} from 'lucide-react';
import { useApp } from '@/app/store';
import { EmptyState, SubjectIcon, timeAgo, useNow } from '@/components/ui';
import { useToast } from '@/components/ui';

export function Dashboard() {
  const subjects = useApp((s) => s.subjects);
  const favorites = useApp((s) => s.favorites);
  const recents = useApp((s) => s.recents);
  const tags = useApp((s) => s.tags);
  const settings = useApp((s) => s.settings);
  const openSubject = useApp((s) => s.openSubject);
  const openNote = useApp((s) => s.openNote);
  const createNote = useApp((s) => s.createNote);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const toast = useToast();
  const now = useNow(30000);
  const [today, setToday] = useState<{ notes: number; shots: number; edits: number } | null>(null);

  useEffect(() => {
    if (!settings.dailyStats) {
      setToday(null);
      return;
    }
    void window.nock.stats.today().then(setToday).catch(() => {});
  }, [settings.dailyStats]);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Burning the midnight oil' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const totalNotes = useMemo(() => subjects.reduce((a, s) => a + s.noteCount, 0), [subjects]);

  const newNote = async () => {
    const target = settings.lastSubjectId ?? subjects[0]?.id;
    if (!target) {
      toast.warn('Create a subject first');
      return;
    }
    await createNote(target);
    toast.success('New note created');
  };

  const onTagClick = (tag: string) => setSearchOpen(tag);

  return (
    <div className="dashboard view-enter">
      {/* Hero */}
      <div className="dash-hero">
        <div className="dash-hero-left">
          <div className="dash-greeting t-display">{greeting}</div>
          <div className="dash-date t-sub">{dateStr}</div>
        </div>
        <div className="dash-hero-stats">
          <div className="stat-pill">
            <StickyNote size={14} />
            <b>{totalNotes}</b> notes
          </div>
          <div className="stat-pill">
            <ImageIcon size={14} />
            <b>{recents.length}</b> recent
          </div>
          {settings.dailyStats && today && (
            <div className="stat-pill" data-tooltip="Today's study activity">
              <Clock size={14} />
              <b>{today.notes}</b> notes
              <span className="t-mute">·</span>
              <b>{today.shots}</b> shots
              <span className="t-mute">·</span>
              <b>{today.edits}</b> edits
            </div>
          )}
        </div>
      </div>

      {/* Quick capture banner */}
      <div className="capture-banner" data-tooltip="Click for a reminder on how to capture" onClick={() => toast.info('Press Win + Shift + S anywhere — the snip lands in your current note automatically.')}>
        <div className="capture-icon">
          <Camera size={20} />
        </div>
        <div className="capture-text">
          <div className="capture-title t-display">Screenshot straight into your note</div>
          <div className="capture-sub">Press <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, snip anything, and it's inserted at your cursor. No dialogs.</div>
        </div>
        <div className="capture-arrow">
          <ArrowRight size={16} />
        </div>
      </div>

      {/* Favorites */}
      {favorites.length > 0 && (
        <section className="dash-section">
          <div className="section-head">
            <div className="section-title">
              <Star size={16} />
              Favorites
            </div>
            <button className="btn btn-ghost btn-icon" onClick={() => openNote(favorites[0].id)} data-tooltip="Open latest favorite">
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="note-strip stagger">
            {favorites.map((n, i) => (
              <NoteCard key={n.id} note={n} onOpen={() => openNote(n.id)} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Subjects */}
      <section className="dash-section">
        <div className="section-head">
          <div className="section-title">
            Subjects
          </div>
          {subjects.length > 0 && (
            <span className="t-sub">click a card to open its notes</span>
          )}
        </div>
        {subjects.length === 0 ? (
          <EmptyState
            icon={StickyNote}
            title="Start with a subject"
            sub="Create Mathematics, Physics, English — anything you study. Each subject holds its own notes."
          />
        ) : (
          <div className="subject-grid stagger">
            {subjects.map((s, i) => (
              <button key={s.id} className="subject-card card card-hover" onClick={() => openSubject(s.id)} data-tooltip={`Open ${s.name}`} style={{ '--i': i } as React.CSSProperties}>
                <div className="subject-top">
                  <div className="subject-icon" style={{ ['--icon-color' as string]: `var(--accent)` }}>
                    <SubjectIcon name={s.icon} size={20} />
                  </div>
                  <div className="subject-count">
                    {s.noteCount}
                    <span>{s.noteCount === 1 ? 'note' : 'notes'}</span>
                  </div>
                </div>
                <div className="subject-name t-display">{s.name}</div>
                <div className="subject-meta t-sub">
                  <Clock size={12} />
                  {s.noteCount > 0 ? `Updated ${timeAgo(s.lastModified, now)}` : 'No notes yet'}
                </div>
              </button>
            ))}
            <button
              className="subject-card subject-add card card-hover"
              onClick={() => useApp.getState().setView('settings')}
              data-tooltip="Add a new subject"
            >
              <div className="subject-add-plus">
                <Plus size={18} />
              </div>
              <div className="subject-name t-display">New subject</div>
              <div className="subject-meta t-sub">Add a subject in settings</div>
            </button>
          </div>
        )}
      </section>

      {/* Recents */}
      {recents.length > 0 && (
        <section className="dash-section">
          <div className="section-head">
            <div className="section-title">
              <Clock size={16} />
              Recently edited
            </div>
          </div>
          <div className="note-strip stagger">
            {recents.map((n, i) => (
              <NoteCard key={n.id} note={n} onOpen={() => openNote(n.id)} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <section className="dash-section">
          <div className="section-head">
            <div className="section-title">
              <Hash size={16} />
              Tags
            </div>
            <button className="btn btn-ghost" onClick={() => setSearchOpen('')} data-tooltip="Search across all notes" style={{ fontSize: 12, height: 28 }}>
              Search all
            </button>
          </div>
          <div className="tag-cloud">
            {tags.map((t) => (
              <button key={t} className="chip" onClick={() => onTagClick(`#${t}`)} data-tooltip={`Search “#${t}”`}>
                #{t}
              </button>
            ))}
          </div>
        </section>
      )}

      {subjects.length > 0 && (
        <div className="dash-quick" style={{ marginTop: 8 }}>
          <button className="btn" onClick={newNote} data-tooltip="New note (Ctrl+N)">
            <Plus size={14} />
            New note
          </button>
          <button className="btn" onClick={() => useApp.getState().setView('archive')} data-tooltip="View archived notes">
            <ArchiveRestore size={14} />
            Archive
          </button>
        </div>
      )}
    </div>
  );
}

function NoteCard({ note, onOpen, index }: { note: NoteLite; onOpen: () => void; index: number }) {
  return (
    <button
      className="note-card card card-hover"
      onClick={onOpen}
      data-tooltip={note.title || 'Open note'}
      style={{ '--i': index } as React.CSSProperties}
    >
      {note.isFavorite && (
        <div className="note-card-star">
          <Star size={12} fill="currentColor" />
        </div>
      )}
      <div className="note-card-title t-display">{note.title || 'Untitled note'}</div>
      <div className="note-card-preview">{note.preview || 'Empty note — start writing…'}</div>
      <div className="note-card-meta">
        {note.screenshotCount > 0 && (
          <span className="note-meta-item">
            <ImageIcon size={11} />
            {note.screenshotCount}
          </span>
        )}
        {note.tags.slice(0, 2).map((t) => (
          <span key={t} className="note-meta-tag">
            #{t}
          </span>
        ))}
        <span className="note-meta-time">{timeAgo(note.updatedAt)}</span>
      </div>
    </button>
  );
}

type NoteLite = {
  id: string;
  title: string;
  preview: string;
  isFavorite: boolean;
  screenshotCount: number;
  tags: string[];
  updatedAt: number;
};
