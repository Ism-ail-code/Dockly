import { useState } from 'react';
import { ArrowRight, Camera, Check, Dock, FileText, NotebookPen, ScanSearch, Sparkles, X } from 'lucide-react';
import { useApp } from '@/app/store';
import { DocklyLogo } from '@/components/TopBar';
import { SubjectIcon } from '@/components/ui';
import { DEFAULT_SUBJECTS } from '@shared/defaults';
import type { AccentColor } from '@shared/types';

const STEPS = [
  {
    icon: FileText,
    title: 'Your notes, beautifully organised',
    sub: 'Subjects, tags, favorites and instant search — everything you capture stays on your PC, offline.',
  },
  {
    icon: Camera,
    title: 'Screenshots, instantly in your notes',
    sub: 'Press Win + Shift + S and Dockly places the snip exactly where your cursor is. No dialogs, no clicks.',
  },
  {
    icon: Dock,
    title: 'Study with a docked sidebar',
    sub: 'Dock any note to the edge of your screen. It stays on top of Chrome, PDFs and YouTube — always in view.',
  },
];

function IconOf({ step }: { step: number }) {
  const C = STEPS[step].icon;
  return <C size={40} strokeWidth={1.6} />;
}

export function Onboarding() {  const boot = useApp((s) => s.boot);
  const setSetting = useApp((s) => s.setSetting);
  const refreshSubjects = useApp((s) => s.refreshSubjects);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set(DEFAULT_SUBJECTS.map((s) => s.name)));
  const [busy, setBusy] = useState(false);

  const toggle = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    let order = 0;
    for (const s of DEFAULT_SUBJECTS) {
      if (!picked.has(s.name)) continue;
      await window.dockly.subjects.create({ name: s.name, icon: s.icon, color: s.color as AccentColor });
      order++;
    }
    await setSetting('onboarded', true);
    await refreshSubjects();
    await boot();
    // Sticky-note-first: after setup, open the docked sticky workspace and tuck
    // the library away — the dock's Dashboard button brings it back.
    void window.dockly.dock.open();
    void window.dockly.window.hide();
  };

  return (
    <div className="onboarding view-enter">
      <div className="onboarding-card">
        <div className="onboarding-logo">
          <DocklyLogo size={44} />
        </div>

        {step < 3 ? (
          <>
            <div className="onboarding-dots">
              {STEPS.map((_, i) => (
                <span key={i} className={`dot${i === step ? ' active' : ''}`} />
              ))}
            </div>
            <div key={step} className="onboarding-step view-enter">
              <div className="onboarding-art">
                <IconOf step={step} />
              </div>
              <h1 className="onboarding-title t-display">{STEPS[step].title}</h1>
              <p className="onboarding-sub">{STEPS[step].sub}</p>
            </div>
            <button
              className="btn btn-primary onboarding-cta"
              onClick={() => (step < 2 ? setStep(step + 1) : setStep(3))}
            >
              {step < 2 ? 'Next' : 'Choose your subjects'}
              <ArrowRight size={15} />
            </button>
          </>
        ) : (
          <div className="onboarding-step view-enter">
            <div className="onboarding-art small">
              <NotebookPen size={34} strokeWidth={1.6} />
            </div>
            <h1 className="onboarding-title t-display">Pick your subjects</h1>
            <p className="onboarding-sub">
              You can add, rename or remove them anytime. Choose the ones you study most.
            </p>
            <div className="subject-picker">
              {DEFAULT_SUBJECTS.map((s, i) => {
                const selected = picked.has(s.name);
                return (
                  <button
                    key={s.name}
                    className={`pick-card${selected ? ' selected' : ''}`}
                    onClick={() => toggle(s.name)}
                    style={{ '--pick-i': i } as React.CSSProperties}
                  >
                    <div className="pick-icon">
                      <SubjectIcon name={s.icon} />
                    </div>
                    <span className="pick-name">{s.name}</span>
                    <span className="pick-check">
                      {selected ? <Check size={12} /> : <X size={12} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <button className="btn btn-primary onboarding-cta" disabled={picked.size === 0 || busy} onClick={finish}>
              <Sparkles size={15} />
              {busy ? 'Setting up…' : 'Start studying'}
            </button>
          </div>
        )}

        <div className="onboarding-footer">
          <ScanSearch size={13} />
          Offline first — everything stays on this PC
        </div>
      </div>
    </div>
  );
}
