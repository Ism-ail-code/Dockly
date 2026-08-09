import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Atom,
  BookOpen,
  Check,
  CircleAlert,
  Cpu,
  Feather,
  FlaskConical,
  Info,
  Layers,
  Sigma,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '@/app/store';

export const SUBJECT_ICONS: Record<string, LucideIcon> = {
  sigma: Sigma,
  atom: Atom,
  flask: FlaskConical,
  book: BookOpen,
  feather: Feather,
  cpu: Cpu,
  layers: Layers,
};

export function SubjectIcon({ name, size = 18 }: { name: string; size?: number }) {
  const C = SUBJECT_ICONS[name] ?? Layers;
  return <C size={size} />;
}

/* ---------------- Back button ---------------- */

// Single, consistent navigation control for every secondary screen.
// Renders "← Back" (arrow icon) with a descriptive tooltip + aria-label.
export function BackButton({
  label,
  onClick,
  tipSide = 'bottom',
  style,
}: {
  label: string;
  onClick: () => void;
  tipSide?: 'top' | 'bottom' | 'left' | 'right';
  style?: React.CSSProperties;
}) {
  return (
    <button className="btn btn-icon btn-ghost" onClick={onClick} data-tooltip={label} data-tooltip-side={tipSide} aria-label={label} style={style}>
      <ArrowLeft />
    </button>
  );
}

/* ---------------- Confirm dialog ---------------- */

// Reusable destructive-action confirmation. Only use where data can be lost.
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onCancel,
  onConfirm,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()} onClick={(e) => e.stopPropagation()}>
      <div className="modal" style={{ width: 380 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
        </div>
        <div className="modal-body">{body}</div>
        <div className="modal-foot">
          <button className="btn" onClick={onCancel} data-tooltip={cancelLabel}>
            {cancelLabel}
          </button>
          <button className="btn btn-danger" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        padding: '1px 5px',
        borderRadius: 5,
        border: '1px solid var(--border-strong)',
        background: 'var(--surface-2)',
        color: 'var(--text-2)',
      }}
    >
      {children}
    </span>
  );
}

/* ---------------- Menu ---------------- */

export interface MenuItem {
  label?: string;
  icon?: LucideIcon;
  danger?: boolean;
  kbd?: string;
  onClick?: () => void;
  sep?: boolean;
}

export function Dropdown({
  items,
  onClose,
  align = 'right',
  style,
}: {
  items: MenuItem[];
  onClose: () => void;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="menu"
      style={{ right: align === 'right' ? 0 : undefined, left: align === 'left' ? 0 : undefined, ...style }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item.sep ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={`menu-item${item.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            {item.icon && <item.icon />}
            {item.label}
            {item.kbd && (
              <span className="kbd">
                <Kbd>{item.kbd}</Kbd>
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: Math.min(width, window.innerWidth - 48) } : undefined}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Segmented ---------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={`segmented-item${o.value === value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <o.icon />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Toasts ---------------- */

export function ToastRegion() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toast-region">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <div className={`toast-icon ${t.kind}`}>
            {t.kind === 'success' ? <Check size={14} /> : t.kind === 'warn' ? <CircleAlert size={14} /> : <Info size={14} />}
          </div>
          <div style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</div>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="toast-dismiss" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const addToast = useApp((s) => s.addToast);
  return {
    success: (m: string, action?: { label: string; onClick: () => void }) => addToast({ kind: 'success', message: m, action }),
    info: (m: string, action?: { label: string; onClick: () => void }) => addToast({ kind: 'info', message: m, action }),
    warn: (m: string, action?: { label: string; onClick: () => void }) => addToast({ kind: 'warn', message: m, action }),
  };
}

/* ---------------- Empty state ---------------- */

export function EmptyState({
  icon: Icon,
  title,
  sub,
  cta,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  cta?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-art">
        <Icon />
      </div>
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
      {cta && <div className="empty-cta">{cta}</div>}
    </div>
  );
}

export function useNow(intervalMs = 60000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function timeAgo(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
