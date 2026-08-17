import { useState } from 'react';
import { ArrowRight, Camera, Dock, Layers, Plus, ScanSearch, StickyNote, X } from 'lucide-react';
import { useApp } from '@/app/store';
import { NockLogo } from '@/components/TopBar';
import { ACCENT_COLORS } from '@shared/defaults';

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
    sub: 'Subjects hold their notes, tags link ideas, favorites pin what matters. Add your own subjects next.',
  },
];

const SUBJECTS_STEP = STEPS.length;

function IconOf({ step }: { step: number }) {
  if (step === SUBJECTS_STEP) return <Layers size={40} strokeWidth={1.6} />;
  const C = STEPS[step].icon;
  return <C size={40} strokeWidth={1.6} />;
}

interface OnboardingSubject {
  id: string;
  name: string;
}

export function Onboarding() {
  const boot = useApp((s) => s.boot);
  const setSetting = useApp((s) => s.setSetting);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [subjectName, setSubjectName] = useState('');
  const [subjects, setSubjects] = useState<OnboardingSubject[]>([]);

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    await setSetting('onboarded', true);
    await boot();
  };

  const addSubject = async () => {
    const name = subjectName.trim();
    if (!name || busy) return;
    if (subjects.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      setSubjectName('');
      return;
    }
    try {
      const created = await window.nock.subjects.create({
        name,
        icon: 'layers',
        color: ACCENT_COLORS[subjects.length % ACCENT_COLORS.length].name,
      });
      setSubjects((prev) => [...prev, { id: created.id, name: created.name }]);
      setSubjectName('');
    } catch {
      /* subject creation failed — keep the typed name so the user can retry */
    }
  };

  const removeSubject = async (id: string) => {
    try {
      await window.nock.subjects.delete(id);
    } catch {
      /* ignore */
    }
    setSubjects((prev) => prev.filter((s) => s.id !== id));
  };

  const onSubjectsStep = step === SUBJECTS_STEP;

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
          <span className={`dot${onSubjectsStep ? ' active' : ''}`} />
        </div>

        {!onSubjectsStep ? (
          <>
            <div key={step} className="onboarding-step view-enter">
              <div className="onboarding-art">
                <IconOf step={step} />
              </div>
              <h1 className="onboarding-title t-display">{STEPS[step].title}</h1>
              <p className="onboarding-sub">{STEPS[step].sub}</p>
            </div>
            <button
              className="btn btn-primary onboarding-cta"
              onClick={() => setStep(step + 1)}
            >
              {busy ? 'Setting up…' : step < STEPS.length - 1 ? 'Next' : 'Set Up Subjects'}
              {!busy && <ArrowRight size={15} />}
            </button>
            {step === 0 && (
              <button className="onboarding-skip" onClick={() => void finish()} disabled={busy}>
                Skip intro
              </button>
            )}
          </>
        ) : (
          <>
            <div key={SUBJECTS_STEP} className="onboarding-step view-enter">
              <div className="onboarding-art small">
                <IconOf step={SUBJECTS_STEP} />
              </div>
              <h1 className="onboarding-title t-display">Create Your Subjects</h1>
              <p className="onboarding-sub">
                Let's set up your workspace. Add the subjects you want to organize your notes around — you can add
                more anytime from the library.
              </p>

              <div className="onboarding-subject-form">
                <input
                  className="onboarding-subject-input"
                  placeholder="Mathematics, Physics…"
                  value={subjectName}
                  maxLength={60}
                  onChange={(e) => setSubjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && subjectName.trim()) void addSubject();
                  }}
                />
                <button
                  className="btn onboarding-subject-add"
                  onClick={() => void addSubject()}
                  disabled={!subjectName.trim() || busy}
                >
                  <Plus size={14} />
                  Add Subject
                </button>
              </div>

              {subjects.length > 0 && (
                <ul className="onboarding-subject-list">
                  {subjects.map((s) => (
                    <li key={s.id} className="onboarding-subject-item">
                      <span className="onboarding-subject-name">{s.name}</span>
                      <button
                        className="onboarding-subject-remove"
                        aria-label={`Remove ${s.name}`}
                        onClick={() => void removeSubject(s.id)}
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="onboarding-nav">
              <button className="btn" onClick={() => setStep(step - 1)} disabled={busy}>
                Back
              </button>
              <button className="btn btn-primary onboarding-cta" onClick={() => void finish()} disabled={busy}>
                {busy ? 'Setting up…' : 'Continue'}
                {!busy && <ArrowRight size={15} />}
              </button>
            </div>
            <button className="onboarding-skip" onClick={() => void finish()} disabled={busy}>
              Skip for now
            </button>
          </>
        )}

        <div className="onboarding-footer">
          <ScanSearch size={13} />
          Offline first — everything stays on this PC
        </div>
      </div>
    </div>
  );
}
