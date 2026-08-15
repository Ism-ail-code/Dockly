import { useEffect, useState } from 'react';
import { FileClock, History, RotateCcw, X } from 'lucide-react';
import { useApp } from '@/app/store';
import type { VersionSnapshot } from '@shared/types';

export function VersionPanel() {
  const open = useApp((s) => s.versionOpen);
  const setOpen = useApp((s) => s.setVersionOpen);
  const noteId = useApp((s) => s.currentNoteId);
  const [versions, setVersions] = useState<VersionSnapshot[] | null>(null);

  useEffect(() => {
    if (!open || !noteId) return;
    void window.nock.versions.list(noteId).then(setVersions);
  }, [open, noteId]);

  // Esc closes the version history panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const restore = async (v: VersionSnapshot) => {
    if (!noteId) return;
    await window.nock.versions.restore(noteId, v.id);
    setOpen(false);
  };

  return (
    <div className="version-backdrop" onClick={() => setOpen(false)}>
      <div className="version-panel" onClick={(e) => e.stopPropagation()}>
        <div className="version-head">
          <div className="version-title">
            <FileClock size={15} />
            Version history
          </div>
          <button className="btn btn-icon btn-ghost sm" onClick={() => setOpen(false)} data-tooltip="Close">
            <X size={14} />
          </button>
        </div>
        <div className="version-body">
          {versions === null ? (
            <div className="skeleton" style={{ height: 120, marginTop: 12 }} />
          ) : versions.length === 0 ? (
            <div className="version-empty">
              <History size={26} />
              <p>No versions yet</p>
              <p className="t-mute" style={{ fontSize: 12, maxWidth: 200 }}>
                Versions are captured automatically while you edit.
              </p>
            </div>
          ) : (
            versions.map((v, i) => (
              <div key={v.id} className="version-item">
                <div className="version-dot" />
                <div className="version-info">
                  <div className="version-time">{fmt(v.createdAt)}</div>
                  <div className="version-when t-mute" style={{ fontSize: 11 }}>
                    {i === 0 ? 'Latest snapshot' : i === versions.length - 1 ? 'Original' : `Snapshot ${versions.length - i}`}
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ height: 28, fontSize: 12 }} onClick={() => void restore(v)}>
                  <RotateCcw size={12} />
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
