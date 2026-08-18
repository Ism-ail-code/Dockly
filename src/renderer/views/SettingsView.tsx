import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  ClipboardList,
  Database,
  Download,
  GraduationCap,
  FolderOpen,
  Info,
  Keyboard,
  Monitor,
  Palette,
  PanelRight,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { useApp } from '@/app/store';
import { BackButton, Kbd, useToast } from '@/components/ui';
import { ToggleRow } from '@/components/Toggle';
import { ACCENT_COLORS, SHORTCUTS } from '@shared/defaults';
import type { AccentColor, BackupManifest, DataCounts, Settings } from '@shared/types';

const THEMES = [
  { id: 'light', label: 'Light', swatch: ['#f3f4f8', '#ffffff'] },
  { id: 'dark', label: 'Dark', swatch: ['#101318', '#1a1e26'] },
  { id: 'midnight', label: 'Midnight', swatch: ['#0a0d16', '#121625'] },
] as const;

const TRANSPARENCY_PRESETS = [
  { id: 'solid', label: 'Solid', value: 1, desc: 'Fully opaque panel' },
  { id: 'balanced', label: 'Balanced', value: 0.8, desc: 'Slight see-through, controls stay crisp' },
  { id: 'glass', label: 'Glass', value: 0.6, desc: 'See-through with a glassy blur' },
  { id: 'transparent', label: 'Transparent', value: 0.35, desc: 'Maximum see-through — buttons keep their own surfaces' },
] as const;

type BoolKeys = { [K in keyof Settings]-?: Settings[K] extends boolean ? K : never }[keyof Settings];
type RowBase = { title: string; desc: string; keywords?: string; visible?: (s: Settings) => boolean };
type Row =
  | (RowBase & { kind: 'toggle'; key: BoolKeys })
  | (RowBase & { kind: 'slider'; key: 'dockTransparency'; min: number; max: number; step: number })
  | (RowBase & { kind: 'custom'; render: (s: Settings, set: <K extends keyof Settings>(k: K, v: Settings[K]) => void) => ReactNode });

interface Category {
  id: string;
  title: string;
  icon: ReactNode;
  rows: Row[];
}

function buildCategories(onReset: () => void): Category[] {
  return [
  {
    id: 'general',
    title: 'General',
    icon: <SlidersHorizontal size={15} />,
    rows: [
      {
        kind: 'toggle',
        key: 'launchOnStartup',
        title: 'Launch at startup',
        desc: 'Open Nock automatically when you sign in to Windows',
        keywords: 'startup boot autostart general',
      },
      {
        kind: 'toggle',
        key: 'sessionResume',
        title: 'Session resume',
        desc: 'Reopen the last note you were working on when Nock starts',
        keywords: 'resume reopen continue study last note',
      },
    ],
  },  {
    id: 'appearance',
    title: 'Appearance',
    icon: <Palette size={15} />,
    rows: [
      {
        kind: 'custom',
        title: 'Theme',
        desc: 'Light for daytime, Midnight for late-night sessions',
        keywords: 'theme dark light midnight color',
        render: (s, set) => (
          <div className="theme-picker">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-option${s.theme === t.id ? ' active' : ''}`}
                onClick={() => void set('theme', t.id)}
                data-tooltip={`${t.label} theme`}
              >
                <div className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}>
                  {s.theme === t.id && <Check size={13} />}
                </div>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        ),
      },
      {
        kind: 'custom',
        title: 'Accent color',
        desc: 'Used across buttons, highlights and the dock',
        keywords: 'accent color highlight brand',
        render: (s, set) => (
          <div className="accent-picker">
            {ACCENT_COLORS.map((c) => (
              <button
                key={c.name}
                className={`accent-dot${s.accent === c.name ? ' active' : ''}`}
                style={{ background: dotColor(c.name) }}
                onClick={() => void set('accent', c.name)}
                data-tooltip={c.label}
                aria-label={c.label}
              >
                {s.accent === c.name && <Check size={11} />}
              </button>
            ))}
          </div>
        ),
      },
      {
        kind: 'toggle',
        key: 'animations',
        title: 'Enable animations',
        desc: 'Animate view transitions, dialogs and hover effects',
        keywords: 'motion animation transitions animate smooth',
      },
      {
        kind: 'toggle',
        key: 'compactMode',
        title: 'Compact mode',
        desc: 'Tighter spacing so more content fits on screen',
        keywords: 'dense compact tight small density',
      },
      {
        kind: 'toggle',
        key: 'largeToolbarIcons',
        title: 'Large toolbar icons',
        desc: 'Bigger, easier-to-hit buttons in the editor toolbar',
        keywords: 'icons size large buttons toolbar accessibility',
      },
      {
        kind: 'toggle',
        key: 'showTooltips',
        title: 'Show tooltips on hover',
        desc: 'Display helpful hints when hovering over buttons',
        keywords: 'tooltip hints help hover labels',
      },
      {
        kind: 'toggle',
        key: 'sounds',
        title: 'Sound effects',
        desc: 'Play subtle sounds for actions like inserting screenshots',
        keywords: 'sound audio beep effects feedback',
      },
    ],
  },
  {
    id: 'sidebar',
    title: 'Sidebar',
    icon: <PanelRight size={15} />,
    rows: [
      {
        kind: 'toggle',
        key: 'dockOnTop',
        title: 'Always on top',
        desc: 'The docked note stays visible over other apps',
        keywords: 'dock pin topmost always on top overlay',
      },
      {
        kind: 'toggle',
        key: 'dockAutoHide',
        title: 'Auto-hide',
        desc: 'Tuck the dock away while Nock is focused; show it when you switch away',
        keywords: 'dock autohide hide collapse sidebar peek',
      },
      {
        kind: 'toggle',
        key: 'dockRememberPosition',
        title: 'Remember dock position',
        desc: 'Keep the dock on the same side of the screen across restarts',
        keywords: 'dock position side left right remember persist',
      },
      {
        kind: 'toggle',
        key: 'dockRememberWidth',
        title: 'Remember dock width',
        desc: 'Restore your custom dock width after restarting',
        keywords: 'dock width size remember persist resize',
      },
      {
        kind: 'toggle',
        key: 'dockRememberHeight',
        title: 'Remember dock height',
        desc: 'Restore the dock height after restarting',
        keywords: 'dock height size remember persist resize vertical',
      },
      {
        kind: 'custom',
        title: 'Dock transparency',
        desc: 'The dock background becomes see-through while buttons and text keep readable surfaces',
        keywords: 'dock transparent opacity see-through glass acrylic blur preset solid balanced',
        render: (s, set) => (
          <div className="dock-transparency">
            <div className="dock-transparency-presets">
              {TRANSPARENCY_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`dock-transparency-preset${s.dockTransparency === p.value ? ' active' : ''}`}
                  onClick={() => {
                    void set('dockTransparencyEnabled', true);
                    void set('dockTransparency', p.value);
                  }}
                  data-tooltip={p.desc}
                  aria-pressed={s.dockTransparency === p.value}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="settings-slider-group">
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={s.dockTransparency}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  void set('dockTransparencyEnabled', true);
                  void set('dockTransparency', v);
                }}
                className="slider"
                style={{ width: 180 }}
                aria-label="Dock transparency"
              />
              <span className="settings-slider-value t-sub">{Math.round(s.dockTransparency * 100)}%</span>
            </div>
            <div className="dock-glass">
              <button
                className={`dock-glass-option${s.dockGlassStyle === 'frosted' ? ' active' : ''}`}
                onClick={() => {
                  void set('dockTransparencyEnabled', true);
                  void set('dockGlassStyle', 'frosted');
                }}
                data-tooltip="Frosted: classic blurred glass — what's behind stays soft"
                aria-pressed={s.dockGlassStyle === 'frosted'}
              >
                Frosted
              </button>
              <button
                className={`dock-glass-option${s.dockGlassStyle === 'clear' ? ' active' : ''}`}
                onClick={() => {
                  void set('dockTransparencyEnabled', true);
                  void set('dockGlassStyle', 'clear');
                }}
                data-tooltip="Clear: true see-through — read what's behind the dock (fixed ~35%)"
                aria-pressed={s.dockGlassStyle === 'clear'}
              >
                Clear
              </button>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    id: 'editor',
    title: 'Editor',
    icon: <PenLine size={15} />,
    rows: [
      {
        kind: 'toggle',
        key: 'autoSave',
        title: 'Auto-save notes',
        desc: 'Save your notes automatically as you type',
        keywords: 'autosave save persist editor',
      },
      {
        kind: 'toggle',
        key: 'showLineNumbers',
        title: 'Show line numbers',
        desc: 'Display a line-number gutter beside the document',
        keywords: 'lines gutter numbers linenumber',
      },
      {
        kind: 'toggle',
        key: 'markdownShortcuts',
        title: 'Markdown shortcuts',
        desc: 'Type #, -, 1. or ** to format as you write',
        keywords: 'markdown shortcut formatting syntax type',
      },
      {
        kind: 'toggle',
        key: 'richText',
        title: 'Rich text formatting',
        desc: 'Show the formatting toolbar (bold, lists, tables…)',
        keywords: 'rich text toolbar formatting bold lists',
      },
      {
        kind: 'toggle',
        key: 'spellCheck',
        title: 'Spell checking',
        desc: 'Underline misspelled words while typing',
        keywords: 'spellcheck spelling grammar underline dictionary',
      },
    ],
  },
  {
    id: 'clipboard',
    title: 'Clipboard',
    icon: <ClipboardList size={15} />,
    rows: [
      {
        kind: 'toggle',
        key: 'autoInsertScreenshots',
        title: 'Automatic screenshot capture',
        desc: 'Automatically add captured screenshots to your active note',
        keywords: 'screenshot snip insert capture clipboard',
      },
      {
        kind: 'toggle',
        key: 'autoCaptureText',
        title: 'Automatic text capture',
        desc: 'Automatically add copied text to your active note',
        keywords: 'text copy ctrl-c clipboard paste capture',
      },
      {
        kind: 'toggle',
        key: 'confirmBeforeInsert',
        title: 'Confirm before inserting',
        desc: 'Ask before a screenshot is added to your note',
        keywords: 'confirm prompt ask dialog screenshot',
      },
      {
        kind: 'toggle',
        key: 'ignoreDuplicateClipboard',
        title: 'Ignore duplicate clipboard content',
        desc: 'Skip clipboard content identical to the last capture',
        keywords: 'duplicate dedupe skip repeat clipboard',
      },
    ],
  },
  {
    id: 'study',
    title: 'Study',
    icon: <GraduationCap size={15} />,
    rows: [
      {
        kind: 'toggle',
        key: 'focusMode',
        title: 'Focus mode',
        desc: 'Minimize dock chrome for distraction-free studying',
        keywords: 'focus distraction minimal clean dock',
      },
      {
        kind: 'toggle',
        key: 'studyTimer',
        title: 'Study timer',
        desc: 'Show an elapsed-time session timer in the editor',
        keywords: 'timer study session stopwatch pomodoro',
      },
      {
        kind: 'toggle',
        key: 'readingProgress',
        title: 'Reading progress',
        desc: 'Show a progress bar as you scroll through a note',
        keywords: 'reading progress scroll bar position',
      },
      {
        kind: 'toggle',
        key: 'dailyStats',
        title: 'Daily study statistics',
        desc: "Show today's notes, screenshots and edits on the dashboard",
        keywords: 'stats statistics daily analytics dashboard today',
      },
    ],
  },
  {
    id: 'data',
    title: 'Data & Storage',
    icon: <Database size={15} />,
    rows: [
      {
        kind: 'custom',
        title: 'Your Nock Data',
        desc: 'Create a complete backup of your Nock data, including notes, subjects, screenshots, and settings. Backups are portable .nockbackup files you can restore on any PC.',
        keywords: 'data storage export import backup restore notes subjects screenshots settings files',
        render: () => <DataPanel />,
      },
    ],
  },
  {
    id: 'updates',
    title: 'Updates',
    icon: <Download size={15} />,
    rows: [
      {
        kind: 'toggle',
        key: 'autoCheckUpdates',
        title: 'Automatic updates',
        desc: 'Automatically check for new Nock versions',
        keywords: 'update check automatic version upgrade github',
      },
      {
        kind: 'custom',
        title: 'Check for updates',
        desc: 'Compare against the latest Nock release on GitHub',
        keywords: 'check now version upgrade release status current',
        render: () => <UpdateControls />,
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    icon: <Wrench size={15} />,
    rows: [
      {
        kind: 'custom',
        title: 'Reset all preferences',
        desc: 'Restore every preference to its default value',
        keywords: 'reset restore defaults clear preferences',
        render: (_s, _set) => (
          <button
            className="btn btn-ghost btn-danger-ghost"
            data-tooltip="Reset all preferences to defaults"
            onClick={onReset}
          >
            <RotateCcw size={14} />
            Reset…
          </button>
        ),
      },
    ],
  },
];
}

export function SettingsView() {
  const settings = useApp((s) => s.settings);
  const setSetting = useApp((s) => s.setSetting);
  const goBack = useApp((s) => s.goBack);
  const prevView = useApp((s) => s.prevView);
  const subjects = useApp((s) => s.subjects);
  const refreshSubjects = useApp((s) => s.refreshSubjects);
  const refreshNotes = useApp((s) => s.refreshNotes);
  const toast = useToast();

  const [q, setQ] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'delete-subject' | 'reset-settings'; id?: string; name?: string } | null>(null);

  const searching = q.trim().length > 0;
  const needle = q.trim().toLowerCase();

  const rowMatches = (row: Row): boolean => {
    if (!searching) return true;
    const hay = `${row.title} ${row.desc} ${row.keywords ?? ''}`.toLowerCase();
    return hay.includes(needle);
  };

  const filtered = useMemo(
    () =>
      buildCategories(() => setConfirm({ kind: 'reset-settings' }))
        .map((cat) => ({
          ...cat,
          rows: cat.rows.filter((r) => rowMatches(r) && !(r.visible && !r.visible(settings))),
        }))
        .filter((cat) => cat.rows.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searching, needle, settings],
  );

  const totalMatches = filtered.reduce((a, c) => a + c.rows.length, 0);

  const addSubject = async () => {
    const name = newSubject.trim();
    if (!name) return;
    const colors: AccentColor[] = ['indigo', 'violet', 'sky', 'teal', 'emerald', 'amber', 'orange', 'rose', 'pink'];
    const color = colors[subjects.length % colors.length];
    await window.nock.subjects.create({ name, icon: 'layers', color });
    setNewSubject('');
    await refreshSubjects();
  };

  const removeSubject = async (id: string) => {
    await window.nock.subjects.delete(id);
    setConfirm(null);
    await Promise.all([refreshSubjects(), refreshNotes()]);
  };

  const resetAll = async () => {
    setConfirm(null);
    await window.nock.settings.reset();
    toast.success('All preferences reset to defaults');
  };

  return (
    <div className="settings-view view-enter">
      <div className="sub-head">
        <BackButton
          label={prevView === 'editor' ? 'Return to note' : prevView === 'subject' ? 'Return to subject' : 'Return to dashboard'}
          onClick={goBack}
        />
        <div className="sub-title t-display">Preferences</div>
      </div>

      <div className="settings-search">
        <Search size={14} />
        <input
          className="input"
          placeholder="Search settings…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search settings"
        />
        {searching && (
          <button className="btn btn-icon btn-ghost sm" onClick={() => setQ('')} data-tooltip="Clear search">
            <X size={13} />
          </button>
        )}
      </div>

      {searching && totalMatches === 0 && (
        <div className="settings-empty">
          <div className="settings-empty-icon">
            <Search size={18} />
          </div>
          No settings match “{q.trim()}”
        </div>
      )}

      {filtered.map((cat) => (
        <section key={cat.id} className="settings-section">
          <div className="settings-section-title">
            {cat.icon}
            {cat.title}
            {searching && <span className="settings-match-count">{cat.rows.length}</span>}
          </div>
          {cat.rows.map((row, i) => (
            <RowControl key={row.kind === 'custom' ? `custom-${i}` : row.kind === 'slider' ? 'slider' : (row.key as string)} row={row} settings={settings} setSetting={setSetting} />
          ))}
        </section>
      ))}

      {/* Subjects */}
      {!searching && (
        <section className="settings-section">
          <div className="settings-section-title">
            <FolderOpen size={15} />
            Subjects
          </div>
          <div className="subject-manage">
            {subjects.map((s) => (
              <div key={s.id} className="subject-manage-item">
                <span className="subject-manage-icon">{s.name.slice(0, 1).toUpperCase()}</span>
                <span className="subject-manage-name">{s.name}</span>
                <span className="subject-manage-count t-sub">
                  {s.noteCount} {s.noteCount === 1 ? 'note' : 'notes'}
                </span>
                <button
                  className="btn btn-icon btn-ghost sm"
                  data-tooltip="Delete subject"
                  onClick={() => setConfirm({ kind: 'delete-subject', id: s.id, name: s.name })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="subject-manage-add">
              <input
                className="input"
                placeholder="New subject name…"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addSubject()}
              />
              <button className="btn btn-primary" onClick={() => void addSubject()} disabled={!newSubject.trim()} data-tooltip="Add this subject">
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Shortcuts */}
      {!searching && (
        <section className="settings-section">
          <div className="settings-section-title">
            <Keyboard size={15} />
            Keyboard shortcuts
          </div>
          <div className="shortcut-grid">
            {SHORTCUTS.map((s) => (
              <div key={s.keys + s.label} className="shortcut-row">
                <div className="shortcut-label">{s.label}</div>
                <div className="shortcut-scope t-sub">{s.scope}</div>
                <Kbd>{s.keys}</Kbd>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Help & Getting Started */}
      {!searching && (
        <section className="settings-section">
          <div className="settings-section-title">
            <GraduationCap size={15} />
            Help & Getting Started
          </div>
          <div className="settings-row" style={{ border: 'none' }}>
            <div className="settings-label">
              <div className="settings-name">Your first note</div>
              <div className="settings-desc">
                Create a subject on the dashboard, open it, then press <Kbd>New note</Kbd>. Done.
              </div>
            </div>
          </div>
          <div className="settings-row" style={{ border: 'none' }}>
            <div className="settings-label">
              <div className="settings-name">Capture a screenshot</div>
              <div className="settings-desc">
                Press <Kbd>Win</Kbd>+<Kbd>Shift</Kbd>+<Kbd>S</Kbd> anywhere — the snip lands in your note at the cursor.
              </div>
            </div>
          </div>
          <div className="settings-row" style={{ border: 'none' }}>
            <div className="settings-label">
              <div className="settings-name">Pin a note to your screen</div>
              <div className="settings-desc">
                Open the dock from the tray icon and drag any note to a screen edge. It stays on top while you work.
              </div>            </div>
          </div>
          <div className="settings-row" style={{ border: 'none' }}>
            <div className="settings-label">
              <div className="settings-name">Replay the welcome tour</div>
              <div className="settings-desc">
                See the four-step intro again — it only shows on first launch.
              </div>
            </div>
            <button className="btn" onClick={() => void setSetting('onboarded', false)} data-tooltip="Replay the welcome tour">
              Replay tour
            </button>
          </div>
        </section>
      )}

      {/* About */}
      {!searching && (
        <section className="settings-section">
          <div className="settings-section-title">
            <Info size={15} />
            About
          </div>
          <div className="settings-row" style={{ border: 'none' }}>
            <div className="settings-label">
              <div className="settings-name">Nock v1.1</div>
              <div className="settings-desc">
                Offline first — all data lives on this PC.
                <br />
                <Monitor size={11} style={{ verticalAlign: -1 }} /> Preferences apply instantly — no restart needed.
              </div>
            </div>
          </div>
        </section>
      )}

      {confirm?.kind === 'delete-subject' && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Delete subject?</div>
            </div>
            <div className="modal-body">
              <p className="t-sub">
                <b>“{confirm.name}”</b> and all of its notes will be permanently deleted. This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setConfirm(null)} data-tooltip="Keep the subject">
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => confirm.id && void removeSubject(confirm.id)}>
                <Trash2 size={14} />
                Delete forever
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm?.kind === 'reset-settings' && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Reset all preferences?</div>
            </div>
            <div className="modal-body">
              <p className="t-sub">
                Every preference — appearance, dock behavior, editor and clipboard options — returns to its default value.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setConfirm(null)} data-tooltip="Keep current preferences">
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void resetAll()}>
                <RotateCcw size={14} />
                Reset everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DataPanel() {
  const toast = useToast();
  const applySettings = useApp((s) => s.applySettings);
  const refreshSubjects = useApp((s) => s.refreshSubjects);
  const refreshNotes = useApp((s) => s.refreshNotes);
  const refreshRecents = useApp((s) => s.refreshRecents);
  const refreshFavorites = useApp((s) => s.refreshFavorites);
  const refreshTags = useApp((s) => s.refreshTags);
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [storage, setStorage] = useState('');
  const [busy, setBusy] = useState<'' | 'export' | 'import'>('');
  const [pending, setPending] = useState<{ path: string; manifest: BackupManifest } | null>(null);

  useEffect(() => {
    void (async () => {
      const [c, info] = await Promise.all([window.nock.backup.counts(), window.nock.appInfo()]);
      setCounts(c);
      setStorage(info.userData);
    })();
  }, []);

  const doExport = async () => {
    setBusy('export');
    try {
      const res = await window.nock.backup.export();
      if (!res) {
        toast.info('Export canceled');
      } else {
        setCounts(res.counts);
        toast.success(
          `Backup created — ${res.counts.notes} notes, ${res.counts.subjects} subjects, ${res.counts.screenshots} screenshots`,
        );
      }
    } catch (e) {
      toast.warn(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const pickImport = async () => {
    setBusy('import');
    try {
      const p = await window.nock.backup.pickImport();
      if (!p) return;
      const manifest = await window.nock.backup.inspect(p);
      setPending({ path: p, manifest });
    } catch (e) {
      toast.warn(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const doRestore = async () => {
    if (!pending) return;
    setBusy('import');
    try {
      const res = await window.nock.backup.restore(pending.path);
      setPending(null);
      const settings = await window.nock.settings.get();
      applySettings(settings);
      await Promise.all([refreshSubjects(), refreshNotes(), refreshRecents(), refreshFavorites(), refreshTags()]);
      setCounts(res.restored);
      toast.success(
        `Restore complete — ${res.restored.notes} notes, ${res.restored.subjects} subjects, ${res.restored.screenshots} screenshots. Your previous data was backed up first.`,
      );
    } catch (e) {
      toast.warn(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="data-panel">
        <div className="data-panel-row">
          <div className="data-panel-label">Your Nock Data</div>
          <div className="data-panel-counts">
            {counts ? `${counts.notes} notes · ${counts.subjects} subjects · ${counts.screenshots} screenshots` : '…'}
          </div>
        </div>
        <div className="data-panel-row">
          <div className="data-panel-label">Export</div>
          <button className="btn" disabled={busy !== ''} onClick={() => void doExport()} data-tooltip="Export Nock Data">
            {busy === 'export' ? (
              'Exporting…'
            ) : (
              <>
                <Download size={14} />
                Export Nock Data
              </>
            )}
          </button>
        </div>
        <div className="data-panel-row">
          <div className="data-panel-label">Import</div>
          <button className="btn" disabled={busy !== ''} onClick={() => void pickImport()} data-tooltip="Import Backup">
            {busy === 'import' ? (
              'Importing…'
            ) : (
              <>
                <Upload size={14} />
                Import Backup
              </>
            )}
          </button>
        </div>
        <div className="data-panel-row">
          <div className="data-panel-label">Storage location</div>
          <div className="data-panel-path" title={storage}>
            {storage || '…'}
          </div>
        </div>
      </div>

      {pending && (
        <div className="modal-backdrop" onClick={() => setPending(null)}>
          <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">Restore Nock Backup?</div>
            </div>
            <div className="modal-body">
              <p className="t-sub">
                This backup contains <b>{pending.manifest.counts.notes}</b> notes, <b>{pending.manifest.counts.subjects}</b>{' '}
                subjects and <b>{pending.manifest.counts.screenshots}</b> screenshots.
              </p>
              <p className="t-sub">
                Your current data is backed up first, so nothing is lost if the restore goes wrong.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPending(null)} data-tooltip="Keep your current data">
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy !== ''}
                onClick={() => void doRestore()}
                data-tooltip="Back up current data & restore"
              >
                <Download size={14} />
                Backup Current Data & Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RowControl({
  row,
  settings,
  setSetting,
}: {
  row: Row;
  settings: Settings;
  setSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
}) {
  if (row.kind === 'toggle') {
    return (
      <ToggleRow
        title={row.title}
        desc={row.desc}
        checked={settings[row.key] as boolean}
        onChange={(v) => setSetting(row.key, v)}
      />
    );
  }
  if (row.kind === 'slider') {
    return (
      <div className="settings-row">
        <div className="settings-label">
          <div className="settings-name">{row.title}</div>
          <div className="settings-desc">{row.desc}</div>
        </div>
        <div className="settings-slider-group">
          <input
            type="range"
            min={row.min}
            max={row.max}
            step={row.step}
            value={settings[row.key]}
            onChange={(e) => void setSetting(row.key, Number(e.target.value))}
            className="slider"
            style={{ width: 180 }}
            aria-label={row.title}
          />
          <span className="settings-slider-value t-sub">{Math.round(settings[row.key] * 100)}%</span>
        </div>
      </div>
    );
  }
  return (
    <div className="settings-row">
      <div className="settings-label">
        <div className="settings-name">{row.title}</div>
        <div className="settings-desc">{row.desc}</div>
      </div>
      {row.render(settings, setSetting)}
    </div>
  );
}

function dotColor(name: AccentColor): string {
  const map: Record<AccentColor, string> = {
    indigo: '#6366f1', violet: '#8b5cf6', sky: '#0ea5e9', teal: '#14b8a6',
    emerald: '#10b981', amber: '#f5a90b', orange: '#f97316', rose: '#f43f5e',
    pink: '#ec4899', slate: '#64748b',
  };
  return map[name];
}

/** Settings → Updates controls: current version, Check Now and live status. */
function UpdateControls() {
  const updateState = useApp((s) => s.updateState);
  const updateInfo = useApp((s) => s.updateInfo);
  const checkUpdates = useApp((s) => s.checkUpdates);
  const downloadUpdate = useApp((s) => s.downloadUpdate);
  const openReleasePage = useApp((s) => s.openReleasePage);
  const openUpdateNotes = useApp((s) => s.openUpdateNotes);
  const setUpdateInstallPrompt = useApp((s) => s.setUpdateInstallPrompt);

  const canInstall = updateInfo?.installSupported === true;
  const version = updateInfo?.currentVersion ?? '';

  let status: ReactNode = null;
  if (updateState.phase === 'checking') {
    status = <span className="update-status">Checking for updates…</span>;
  } else if (updateState.phase === 'up-to-date') {
    status = (
      <span className="update-status update-status-ok">
        <Check size={13} />
        You're using the latest version.
      </span>
    );
  } else if (updateState.phase === 'available') {
    status = (
      <div className="update-status update-status-new">
        <span>Nock {updateState.version} is available.</span>
        <button className="btn sm" onClick={() => void openUpdateNotes()} data-tooltip="See what changed in this release">
          <Sparkles size={13} />
          What's New
        </button>
        <button
          className="btn btn-primary sm"
          onClick={() => (canInstall ? void downloadUpdate() : void openReleasePage())}
          data-tooltip={canInstall ? 'Download and install the update' : 'Open the release page to download'}
        >
          <Download size={13} />
          Update Now
        </button>
      </div>
    );
  } else if (updateState.phase === 'downloading') {
    status = <span className="update-status">Downloading update… {updateState.percent}%</span>;
  } else if (updateState.phase === 'downloaded') {
    status = (
      <div className="update-status update-status-new">
        <span>Update ready — restart Nock to install.</span>
        <button className="btn btn-primary sm" onClick={() => setUpdateInstallPrompt(true)} data-tooltip="Restart Nock and finish installing">
          Restart now
        </button>
      </div>
    );
  } else if (updateState.phase === 'error') {
    status = <span className="update-status update-status-warn">Unable to check for updates right now.</span>;
  }

  return (
    <div className="update-controls">
      <div className="update-version">
        Current version <code>v{version}</code>
        {updateState.phase === 'available' && canInstall && (
          <span className="update-dot" data-tooltip="An update is available" aria-label="Update available" />
        )}
      </div>
      <div className="update-actions">
        <button
          className="btn"
          onClick={() => void checkUpdates()}
          disabled={updateState.phase === 'checking'}
          data-tooltip="Check the Nock GitHub releases for a newer version"
        >
          <RotateCcw size={13} />
          Check Now
        </button>
        {status}
      </div>
      <div className="update-note t-sub">
        {canInstall ? "Nock checks quietly after launch and reminds you once per version." : "This build updates manually — you'll be taken to the releases page."}
      </div>
    </div>
  );
}
