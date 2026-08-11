import { useEffect, useState } from 'react';
import { useApp } from '@/app/store';
import { TopBar } from '@/components/TopBar';
import { SearchOverlay } from '@/components/SearchOverlay';
import { AnnotationEditor } from '@/components/AnnotationEditor';
import { VersionPanel } from '@/components/VersionPanel';
import { ToastRegion, useToast } from '@/components/ui';
import { TooltipHost } from '@/components/Tooltip';
import { playSound } from '@/lib/sound';
import { Onboarding } from '@/views/Onboarding';
import { Dashboard } from '@/views/Dashboard';
import { SubjectView } from '@/views/SubjectView';
import { EditorView } from '@/views/EditorView';
import { SettingsView } from '@/views/SettingsView';
import { ArchiveView } from '@/views/ArchiveView';

interface ClipPayload {
  png: string;
  width: number;
  height: number;
  capturedAt: number;
}

interface TextPayload {
  text: string;
  capturedAt: number;
}

export function App() {
  const booted = useApp((s) => s.booted);
  const settings = useApp((s) => s.settings);
  const view = useApp((s) => s.view);
  const currentNoteId = useApp((s) => s.currentNoteId);
  const toast = useToast();
  const [confirmShot, setConfirmShot] = useState<ClipPayload | null>(null);

  useEffect(() => {
    void useApp.getState().boot();
  }, []);

  // ---------- clipboard: screenshot captured ----------
  useEffect(() => {
    const off = window.dockly.on('clipboard:image', (p) => {
      const payload = p as ClipPayload;
      const state = useApp.getState();
      const canAutoInsert = !!state.currentNoteId && state.settings.autoInsertScreenshots;
      if (canAutoInsert && state.settings.confirmBeforeInsert) {
        setConfirmShot(payload);
        return;
      }
      const dataUrl = `data:image/png;base64,${payload.png}`;
      state.setPendingShot({ dataUrl, capturedAt: payload.capturedAt });
      if (canAutoInsert) {
        toast.success('Screenshot captured — inserting into your note');
        playSound('success');
      } else {
        toast.info('Screenshot captured', {
          label: 'Create note & insert',
          onClick: () => {
            const s = useApp.getState();
            const target = s.settings.lastSubjectId ?? s.subjects[0]?.id;
            if (!target) {
              toast.warn('Create a subject first (Settings → Subjects)');
              return;
            }
            void s.createNote(target).then((note) => {
              if (note) toast.success('Screenshot added to your new note');
            });
          },
        });
      }
    });
    return off;
  }, [toast]);

  // ---------- clipboard: captured text (Ctrl + C) ----------
  useEffect(() => {
    const off = window.dockly.on('clipboard:text', (p) => {
      const payload = p as TextPayload & { noteId?: string | null };
      const state = useApp.getState();
      if (!state.currentNoteId || !state.settings.autoCaptureText) return;
      if (payload.noteId && payload.noteId !== state.currentNoteId) return;
      state.setPendingText({ text: payload.text, capturedAt: payload.capturedAt });
      toast.success('Text captured ✓');
      playSound('tick');
    });
    return off;
  }, [toast]);

  // Copies made inside Dockly must never be re-captured into a note.
  useEffect(() => {
    const onCopy = () => void window.dockly.clipboard.markSelfCopy();
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  // ---------- settings sync from main ----------
  useEffect(() => {
    const off = window.dockly.on('sync:settings', (s) => {
      useApp.getState().applySettings(s as typeof settings);
    });
    return off;
  }, []);

  // ---------- dock state sync ----------
  useEffect(() => {
    const off = window.dockly.on('dock:state', (d) => {
      useApp.getState().setDockState(d as never);
    });
    return off;
  }, []);

  // ---------- navigation from the dock (dashboard / settings buttons) ----------
  useEffect(() => {
    const off = window.dockly.onViewNavigate((v) => {
      const view = v as 'dashboard' | 'subject' | 'editor' | 'settings' | 'archive';
      const s = useApp.getState();
      if (view === 'editor') {
        if (!s.currentNoteId) {
          const target = s.settings.lastNoteId ?? s.notes[0]?.id;
          if (target) void s.openNote(target);
        }
        s.setView('editor');
        return;
      }
      s.setView(view);
    });
    return off;
  }, []);

  // ---------- content sync (from dock window) ----------
  useEffect(() => {
    const off = window.dockly.on('sync:note-content', (c) => {
      useApp.getState().pushRemoteContent(c as { noteId: string; content: string; updatedAt: number });
    });
    return off;
  }, []);

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inEditor = target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const s = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'k' && !inEditor) {
        e.preventDefault();
        s.setSearchOpen(!s.searchOpen);
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        const targetSubject = s.currentSubjectId ?? s.settings.lastSubjectId ?? s.subjects[0]?.id;
        if (targetSubject) void s.createNote(targetSubject);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f' && s.currentNoteId) {
        e.preventDefault();
        void window.dockly.notes.setFavorite(s.currentNoteId, !s.notes.find((n) => n.id === s.currentNoteId)?.isFavorite);
        void s.refreshFavorites();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a' && s.currentNoteId) {
        e.preventDefault();
        void window.dockly.notes.archive(s.currentNoteId, true);
        s.goBack();
        void s.refreshNotes();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd' && !e.shiftKey && s.currentNoteId) {
        e.preventDefault();
        void window.dockly.notes.duplicate(s.currentNoteId);
        toast.success('Note duplicated');
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
        // handled globally by main process (avoid double-toggle)
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast]);

  if (!booted) {
    return (
      <div className="app-bg">
        <div className="boot-screen">
          <div className="boot-logo pulse-glow">D</div>
          <div className="t-sub">Opening Dockly…</div>
        </div>
        <TooltipHost />
      </div>
    );
  }

  if (!settings.onboarded) {
    return (
      <div className="app-bg">
        <Onboarding />
        <TooltipHost />
      </div>
    );
  }

  return (
    <div className="app-root">
      <div className="app-bg" />
      <TopBar />
      <main className="app-main" key={view}>
        {view === 'dashboard' && <Dashboard />}
        {view === 'subject' && <SubjectView />}
        {view === 'editor' && currentNoteId && <EditorView />}
        {view === 'settings' && <SettingsView />}
        {view === 'archive' && <ArchiveView />}
      </main>
      <SearchOverlay />
      <VersionPanel />
      <AnnotationEditor />
      {confirmShot && (
        <div className="modal-backdrop" onClick={() => setConfirmShot(null)}>
          <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Insert screenshot into note?</div>
            </div>
            <div className="modal-body">
              <p className="t-sub">
                A screenshot was just captured and Dockly is ready to drop it at the end of your current note.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setConfirmShot(null)} data-tooltip="Skip this screenshot">
                Skip
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const s = useApp.getState();
                  s.setPendingShot({ dataUrl: `data:image/png;base64,${confirmShot.png}`, capturedAt: confirmShot.capturedAt });
                  setConfirmShot(null);
                  playSound('success');
                }}
              >
                Insert screenshot
              </button>
            </div>
          </div>
        </div>
      )}
      <ToastRegion />
      <TooltipHost />
    </div>
  );
}
