import type { CSSProperties } from 'react';
import { Moon, PanelLeft, PanelRight, Search, Settings, Sun, Sparkles } from 'lucide-react';
import { useApp } from '@/app/store';
import { useToast } from '@/components/ui';

export function NockLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="dlg" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#dlg)" />
      <rect x="6" y="10.5" width="12" height="4" rx="2" fill="rgba(255,255,255,0.92)" />
      <circle cx="9" cy="12.5" r="1.1" fill="#6366f1" />
      <circle cx="12" cy="12.5" r="1.1" fill="#6366f1" />
      <circle cx="15" cy="12.5" r="1.1" fill="#6366f1" />
    </svg>
  );
}

const THEME_META = {
  light: { icon: Sun, label: 'Light' },
  dark: { icon: Moon, label: 'Dark' },
  midnight: { icon: Sparkles, label: 'Midnight' },
} as const;

export function TopBar() {
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const setView = useApp((s) => s.setView);
  const currentNoteId = useApp((s) => s.currentNoteId);
  const dockState = useApp((s) => s.dockState);
  const toast = useToast();

  const order = ['light', 'dark', 'midnight'] as const;
  const themeIdx = order.indexOf(settings.theme);
  const nextTheme = order[themeIdx === order.length - 1 ? 0 : themeIdx + 1];

  const cycleTheme = () => {
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    void setSetting('theme', next);
  };
  const ThemeIcon = THEME_META[settings.theme].icon;

  const toggleDock = async () => {
    if (dockState.open) {
      await window.nock.dock.close();
    } else {
      await window.nock.dock.open(currentNoteId);
      toast.info('Nock is now docked to your screen — keep studying!');
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-drag" style={{ WebkitAppRegion: 'drag' } as CSSProperties} />
      <div className="topbar-inner">
        <button className="brand" onClick={() => setView('dashboard')} data-tooltip="Back to dashboard" data-tooltip-side="right" aria-label="Dashboard">
          <NockLogo />
          <span className="brand-name t-display">Nock</span>
        </button>

        <div className="topbar-spacer" />

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setSearchOpen(true)}
          data-tooltip="Search notes — jump to anything (Ctrl+K)"
          data-tooltip-side="bottom"
          aria-label="Search"
        >
          <Search />
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={toggleDock}
          data-tooltip={
            dockState.open
              ? 'Undock — pull this note back into the main window (Ctrl+Shift+D)'
              : 'Dock — keep a note pinned beside your work while you study (Ctrl+Shift+D)'
          }
          data-tooltip-side="bottom"
          aria-label="Toggle dock"
        >
          {dockState.open ? <PanelRight /> : <PanelLeft />}
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={cycleTheme}
          data-tooltip={`Switch theme — ${THEME_META[settings.theme].label} → ${THEME_META[nextTheme].label}. Cycles Light, Dark and Midnight.`}
          aria-label="Switch theme"
        >
          <ThemeIcon />
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setView('settings')}
          data-tooltip="Settings — manage subjects, themes, the dock and keyboard shortcuts"
          aria-label="Settings"
        >
          <Settings />
        </button>

        <button className="btn btn-primary btn-search" onClick={() => setSearchOpen(true)} data-tooltip="Search across all notes — press Ctrl+K anywhere">
          <Search />
          <span>Search notes…</span>
          <span className="btn-search-kbd">Ctrl K</span>
        </button>
      </div>
    </header>
  );
}
