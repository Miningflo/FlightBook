import { useEffect, useRef, type ReactNode } from 'react';
import type { Role } from '../domain/types';

export function RoleChip({ role }: { role: Role }) {
  return <span className={`chip role-${role}`}>{role}</span>;
}

export function Field({
  label, children, error, warning, hint, htmlFor,
}: { label: string; children: ReactNode; error?: string; warning?: string; hint?: string; htmlFor?: string }) {
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error && <div className="msg error" role="alert">{error}</div>}
      {!error && warning && <div className="msg warning">{warning}</div>}
      {!error && !warning && hint && <div className="msg hint">{hint}</div>}
    </div>
  );
}

/** Hours + minutes entry. Value is integer minutes. */
export function DurationField({
  value, onChange, label,
}: { value: number; onChange: (min: number) => void; label: string }) {
  const h = Math.floor(value / 60);
  const m = value % 60;
  const sel = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();
  const num = (s: string) => Math.max(0, Math.floor(Number(s) || 0));
  return (
    <div className="duration" role="group" aria-label={label}>
      <input className="input" type="number" inputMode="numeric" min={0} value={h} aria-label={`${label} hours`}
        onFocus={sel} onChange={(e) => onChange(num(e.target.value) * 60 + m)} />
      <span>h</span>
      <input className="input" type="number" inputMode="numeric" min={0} max={59} value={m} aria-label={`${label} minutes`}
        onFocus={sel} onChange={(e) => onChange(h * 60 + Math.min(59, num(e.target.value)))} />
      <span>min</span>
    </div>
  );
}

/**
 * Pass as `onMouseDown` on buttons used while typing in a form. Without it a tap moves focus to the button, which
 * closes the on-screen keyboard and shifts the layout under the finger, so the tap can be lost (the "tap twice" problem).
 * The click still happens; the text field simply keeps its focus.
 */
export const keepFocus = (e: React.MouseEvent): void => e.preventDefault();

export function Stepper({
  value, onChange, label,
}: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="stepper">
        <button type="button" aria-label={`${label}: decrease`} onMouseDown={keepFocus} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
        <span className="val" aria-live="polite">{value}</span>
        <button type="button" aria-label={`${label}: increase`} onMouseDown={keepFocus} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

export function Dialog({
  open, title, children, actions, onClose,
}: { open: boolean; title: string; children?: ReactNode; actions: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}>
      <h2>{title}</h2>
      <div>{children}</div>
      <div className="actions">{actions}</div>
    </dialog>
  );
}

export function Snackbar({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return (
    <div className="snackbar" role="status">
      <span>{message}</span>
      {action && <button type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}

/** Whole-number entry for counts that can be large (e.g. 200 take-offs in a carry-in record). */
export function CountField({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <input className="input" type="number" inputMode="numeric" min={0} step={1} value={value} aria-label={label}
      onFocus={(e) => e.target.select()} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
  );
}

export type StatusKind = 'green' | 'amber' | 'red' | 'unknown';
const STATUS_TEXT: Record<StatusKind, string> = { green: 'OK', amber: 'Attention', red: 'Action needed', unknown: 'Not set' };

/** Colour plus a word and a shape, so status never depends on colour alone. */
export function StatusPill({ status, label }: { status: StatusKind; label?: string }) {
  const glyph = status === 'green' ? '✓' : status === 'amber' ? '!' : status === 'red' ? '✕' : '?';
  return <span className={`status-pill ${status}`}><span aria-hidden="true">{glyph}</span> {label ?? STATUS_TEXT[status]}</span>;
}

/** Horizontal proportion bar. `value` and `max` in any unit. */
export function Bar({ value, max, tone, label }: { value: number; max: number; tone?: string; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`bar ${tone ?? ''}`} role="img" aria-label={label ?? `${Math.round(pct)}%`}>
      <div className="fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
