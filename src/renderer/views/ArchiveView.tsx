import { useEffect, useState } from 'react';
import { ArchiveRestore, ArrowLeft, Image as ImageIcon, Trash2 } from 'lucide-react';
import { useApp } from '@/app/store';
import { EmptyState, timeAgo, useToast } from '@/components/ui';
import type { Note } from '@shared/types';

export function ArchiveView() {
  const goBack = useApp((s) => s.goBack);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const toast = useToast();

  const load = async () => {
    setNotes(await window.dockly.notes.list(undefined, true));
  };
  useEffect(() => {
    void load();
  }, []);

  const restore = async (id: string) => {
    await window.dockly.notes.archive(id, false);
    toast.success('Note restored');
    await load();
  };
  const remove = async (id: string) => {
    await window.dockly.notes.delete(id);
    toast.success('Note deleted forever');
    await load();
  };

  return (
    <div className="subject-view view-enter">
      <div className="sub-head">
        <button className="btn btn-icon btn-ghost" onClick={goBack} data-tooltip="Back">
          <ArrowLeft />
        </button>
        <div className="sub-title t-display">Archive</div>
        <div className="t-sub" style={{ marginLeft: 12 }}>
          {notes ? `${notes.filter((n) => n.isArchived).length} archived` : ''}
        </div>
      </div>
      {notes === null ? (
        <div className="skeleton" style={{ height: 180, marginTop: 24 }} />
      ) : notes.length === 0 ? (
        <EmptyState
          icon={ArchiveRestore}
          title="Nothing archived"
          sub="Notes you archive hide here until you restore or delete them."
        />
      ) : (
        <div className="archive-list stagger">
          {notes.map((n, i) => (
            <div key={n.id} className="archive-item card" style={{ '--i': i } as React.CSSProperties}>
              <div className="archive-info">
                <div className="archive-title t-display">{n.title || 'Untitled note'}</div>
                <div className="t-sub">
                  {n.screenshotCount > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 10 }}>
                      <ImageIcon size={11} /> {n.screenshotCount}
                    </span>
                  )}
                  Archived {timeAgo(n.updatedAt)}
                </div>
              </div>
              <button className="btn" onClick={() => void restore(n.id)} data-tooltip="Move back to its subject">
                <ArchiveRestore size={14} />
                Restore
              </button>
              <button className="btn btn-ghost btn-icon" onClick={() => void remove(n.id)} data-tooltip="Delete forever">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
