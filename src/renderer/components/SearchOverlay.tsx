import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, FileText, Hash, Image as ImageIcon, Search, SearchX } from 'lucide-react';
import { useApp } from '@/app/store';
import { SubjectIcon, timeAgo } from '@/components/ui';
import type { SearchResult } from '@shared/types';

export function SearchOverlay() {
  const open = useApp((s) => s.searchOpen);
  const initial = useApp((s) => s.searchInitial);
  const setOpen = useApp((s) => s.setSearchOpen);
  const openNote = useApp((s) => s.openNote);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery(initial ?? '');
      setResults(null);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await window.dockly.search(query.trim(), 'all');
      setResults(res);
      setActive(0);
    }, 120);
    return () => clearTimeout(t);
  }, [query, open]);

  const flat = useMemo(() => results?.flatMap((r) => r.notes) ?? [], [results]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, flat.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      }
      if (e.key === 'Enter' && flat[active]) {
        e.preventDefault();
        const note = flat[active];
        setOpen(false);
        void openNote(note.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, active, setOpen, openNote]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="search-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={17} />
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search titles, notes, tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <button className="btn btn-ghost btn-icon sm" onClick={() => setOpen(false)} data-tooltip="Close search (Esc)">
            <CornerDownLeft size={13} />
          </button>
        </div>

        <div ref={listRef} className="search-results">
          {!query.trim() ? (
            <div className="search-hint">
              <Search size={28} />
              <p>Type to search across every subject.</p>
              <p className="t-mute" style={{ fontSize: 12 }}>
                Try #Exam, #Formula or the name of a topic
              </p>
            </div>
          ) : results === null ? (
            <div className="search-hint">
              <div className="skeleton" style={{ width: 220, height: 14, borderRadius: 6 }} />
            </div>
          ) : flat.length === 0 ? (
            <div className="search-hint">
              <SearchX size={28} />
              <p>No notes match “{query}”</p>
            </div>
          ) : (
            results.map((group) => (
              <div key={group.subject.id} className="search-group">
                <div className="search-group-label">
                  <SubjectIcon name={group.subject.icon} size={12} />
                  {group.subject.name}
                </div>
                {group.notes.map((n) => {
                  const idx = flat.indexOf(n);
                  return (
                    <button
                      key={n.id}
                      data-idx={idx}
                      className={`search-result${idx === active ? ' active' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        setOpen(false);
                        void openNote(n.id);
                      }}
                    >
                      <div className="search-result-icon">
                        <FileText size={15} />
                      </div>
                      <div className="search-result-body">
                        <div className="search-result-title">{n.title || 'Untitled note'}</div>
                        <div className="search-result-snippet">{n.preview || 'Empty note'}</div>
                        <div className="search-result-meta">
                          {n.screenshotCount > 0 && (
                            <span>
                              <ImageIcon size={10} /> {n.screenshotCount}
                            </span>
                          )}
                          {n.tags.slice(0, 3).map((t) => (
                            <span key={t} className="search-tag">
                              <Hash size={9} /> {t}
                            </span>
                          ))}
                          <span className="search-time">{timeAgo(n.updatedAt)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="search-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
