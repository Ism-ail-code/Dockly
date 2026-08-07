import { useApp } from '@/app/store';

/**
 * Tiny WebAudio bleeps for interface feedback. Silent by default — only plays
 * when the "Sound effects" preference is enabled, so no audio plays without
 * the user opting in.
 */

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const FREQ: Record<string, number> = { pop: 440, tick: 540, success: 660 };

export function playSound(kind: 'pop' | 'tick' | 'success'): void {
  if (!useApp.getState().settings.sounds) return;
  const c = ensureCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t = c.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(FREQ[kind] ?? 440, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.07, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  } catch {
    /* audio is best-effort */
  }
}
