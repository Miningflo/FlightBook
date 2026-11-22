import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { filterSuggestions } from '../domain/suggestions';
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

export interface SuggestItem {
  /** Unique within the list. */
  key: string;
  /** What is put in the field when picked, and the main text of the row. */
  value: string;
  /** Smaller text beside it. */
  detail?: string;
  /** Text the typed words are matched against. */
  search: string;
}

/**
 * A text field with a search-as-you-type list under it, for things picked from a long history (aircraft, people,
 * airports). Tapping the field shows the most recent entries in a short scrollable list; typing narrows it across the
 * whole history. Used instead of a native dropdown (which only matches what is typed, so a pre-filled field showed one
 * entry) and instead of rows of buttons (which stop working with hundreds of entries). Picking an entry is a single tap:
 * the list never takes focus away from the field, so the keyboard does not close and move things under the finger.
 */
export function SuggestInput({
  value, onChange, onPick, items, listLabel, maxRows = 40, ...input
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (item: SuggestItem) => void;
  items: readonly SuggestItem[];
  listLabel: string;
  maxRows?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'role' | 'list'>) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false); // typed since the field got focus: only then is the list narrowed
  const [active, setActive] = useState(-1);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const shown = open ? filterSuggestions(items, typed ? value : '', (i) => i.search, maxRows) : [];
  const visible = open && shown.length > 0;
  const current = value.trim().toUpperCase();

  useEffect(() => { if (visible) listRef.current?.scrollIntoView({ block: 'nearest' }); }, [visible]);

  const pick = (item: SuggestItem) => { onPick(item); setOpen(false); setTyped(false); setActive(-1); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!visible) { if (e.key === 'ArrowDown') { setOpen(true); e.preventDefault(); } return; }
    if (e.key === 'ArrowDown') { setActive((a) => Math.min(shown.length - 1, a + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive((a) => Math.max(0, a - 1)); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { pick(shown[active]!); e.preventDefault(); } // do not submit the form
  };

  return (
    <div className="suggest-box">
      <input {...input} value={value} role="combobox" aria-expanded={visible} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { setTyped(true); setActive(-1); setOpen(true); onChange(e.target.value); }}
        onFocus={(e) => { e.target.select(); setTyped(false); setActive(-1); setOpen(true); }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown} />
      {visible && (
        <ul id={listId} ref={listRef} className="suggest-list" role="listbox" aria-label={listLabel}>
          {shown.map((item, i) => (
            <li key={item.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={`suggest-row${i === active ? ' active' : ''}${item.value.toUpperCase() === current ? ' current' : ''}`}
              onMouseDown={keepFocus} onClick={() => pick(item)}>
              <span className="main">{item.value}</span>
              {item.detail && <span className="detail">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
