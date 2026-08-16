import { useState } from 'react';
import { ArrowRight, Camera, Dock, ScanSearch, StickyNote } from 'lucide-react';
import { useApp } from '@/app/store';
import { NockLogo } from '@/components/TopBar';

const STEPS = [
  {
    icon: Dock,
    title: 'Sticky Workspace',
    sub: 'Pin a note to the edge of your screen — it stays on top of everything while you work.',
  },
  {
    icon: Camera,
    title: 'Capture Anything',
    sub: 'Press Win + Shift + S anywhere and the snip lands in your note at your cursor. No dialogs, no clicks.',
  },
  {
    icon: StickyNote,
    title: 'Stay On Top',
    sub: 'The library docks into a slim rail on the edge of your screen, ready to switch notes mid-task.',
  },
  {
    icon: ScanSearch,
    title: 'Organize Your Study',
    sub: 'Subjects hold their notes, tags link ideas, favorites pin what matters. Create your first subject on the dashboard.',
  },
];

function IconOf({ step }: { step: number }) {
  const C = STEPS[step].icon;
  return <C size={40} strokeWidth={1.6} />;
}

export function Onboarding() {
  const boot = useApp((s) => s.boot);
  const setSetting = useApp((s) => s.setSetting);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const leaveIntro = async () => {
    if (busy) return;
    setBusy(true);
    await setSetting('onboarded', true);
    await boot();
    // Sticky-note-first: after setup, open the docked sticky workspace and tuck
    // the library away — the dock's Dashboard button brings it back.
    void window.nock.dock.open();
    void window.nock.window.hide();
  };

  return (
    <div className="onboarding view-enter">
      <div className="onboarding-card">
        <div className="onboarding-logo">
          <NockLogo size={44} />
        </div>

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
          onClick={() => (step < 3 ? setStep(step + 1) : void leaveIntro())}
        >
          {busy ? 'Setting up…' : step < 3 ? 'Next' : 'Get Started'}
          {!busy && <ArrowRight size={15} />}
        </button>
        {step === 0 && (
          <button className="onboarding-skip" onClick={() => void leaveIntro()} disabled={busy}>
            Skip intro
          </button>
        )}

        <div className="onboarding-footer">
          <ScanSearch size={13} />
          Offline first — everything stays on this PC
        </div>
      </div>
    </div>
  );
}