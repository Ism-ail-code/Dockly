import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '@/app/store';

type Side = 'top' | 'bottom' | 'left' | 'right';

interface TipState {
  text: string;
  target: HTMLElement;
  side: Side;
}

const GAP = 10;
const EDGE = 8;
const DEFAULT_DELAY = 350;

export function TooltipHost() {
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; side: Side }>({ x: 0, y: 0, side: 'top' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTooltips = useApp((s) => s.settings.showTooltips);
  const enabledRef = useRef(showTooltips);
  enabledRef.current = showTooltips;

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const hide = () => {
    clearTimer();
    setVisible(false);
    setTip(null);
  };

  const arm = (el: HTMLElement) => {
    clearTimer();
    if (!showTooltips) return;
    const delay = Number(el.dataset.tooltipDelay ?? DEFAULT_DELAY);
    timer.current = setTimeout(() => {
      if (!enabledRef.current) return;
      if (!el.isConnected) return;
      const text = el.dataset.tooltip ?? '';
      if (!text) return;
      const side = (el.dataset.tooltipSide as Side) || 'top';
      setTip({ text, target: el, side });
      setVisible(true);
    }, delay);
  };

  // Toggling tooltips off hides any tooltip that is currently visible.
  useEffect(() => {
    if (!showTooltips) hide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTooltips]);

  useEffect(() => {
    const onOver = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tooltip]') as HTMLElement | null;
      if (el && el.dataset.tooltip) arm(el);
    };
    const onOut = (e: PointerEvent) => {
      const from = e.target as HTMLElement | null;
      const to = e.relatedTarget as Node | null;
      if (from && to instanceof HTMLElement && from.closest('[data-tooltip]')) {
        const host = from.closest('[data-tooltip]') as HTMLElement | null;
        if (host) {
          if (host.contains(to)) return;
          const next = to.closest('[data-tooltip]') as HTMLElement | null;
          if (next && next !== host && next.dataset.tooltip) {
            arm(next);
            return;
          }
        }
      }
      hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tooltip]') as HTMLElement | null;
      if (el && el.dataset.tooltip) arm(el);
    };
    const onBlur = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest('[data-tooltip]') === el) hide();
    };
    const onHide = () => hide();

    window.addEventListener('pointerover', onOver, true);
    window.addEventListener('pointerout', onOut, true);
    window.addEventListener('focusin', onFocus, true);
    window.addEventListener('focusout', onBlur, true);
    window.addEventListener('scroll', onHide, true);
    window.addEventListener('resize', onHide);

    return () => {
      window.removeEventListener('pointerover', onOver, true);
      window.removeEventListener('pointerout', onOut, true);
      window.removeEventListener('focusin', onFocus, true);
      window.removeEventListener('focusout', onBlur, true);
      window.removeEventListener('scroll', onHide, true);
      window.removeEventListener('resize', onHide);
      clearTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const r = tip.target.getBoundingClientRect();
    const tw = tipRef.current.offsetWidth;
    const th = tipRef.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    let side = tip.side;
    let x = 0;
    let y = 0;

    if (side === 'top') {
      x = clamp(r.left + r.width / 2 - tw / 2, EDGE, vw - tw - EDGE);
      y = r.top - th - GAP;
      if (y < EDGE) {
        y = r.bottom + GAP;
        side = 'bottom';
      }
    } else if (side === 'bottom') {
      x = clamp(r.left + r.width / 2 - tw / 2, EDGE, vw - tw - EDGE);
      y = r.bottom + GAP;
      if (y + th > vh - EDGE) {
        y = r.top - th - GAP;
        side = 'top';
      }
    } else if (side === 'left') {
      y = clamp(r.top + r.height / 2 - th / 2, EDGE, vh - th - EDGE);
      x = r.left - tw - GAP;
      if (x < EDGE) {
        x = r.right + GAP;
        side = 'right';
      }
    } else {
      y = clamp(r.top + r.height / 2 - th / 2, EDGE, vh - th - EDGE);
      x = r.right + GAP;
      if (x + tw > vw - EDGE) {
        x = r.left - tw - GAP;
        side = 'left';
      }
    }

    setPos({ x, y, side });
  }, [tip, visible]);

  if (!tip) return null;

  return (
    <div
      ref={tipRef}
      role="tooltip"
      className={`tooltip tooltip-${pos.side}${visible ? ' show' : ''}`}
      style={{ left: pos.x, top: pos.y }}
    >
      {tip.text}
    </div>
  );
}