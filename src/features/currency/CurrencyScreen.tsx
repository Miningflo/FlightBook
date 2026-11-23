import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../../AppContext';
import { CLASS_RATINGS, CLASS_RATING_LABELS, type ClassRating, type IsoDate } from '../../domain/types';
import { type RollingCheck, type RollingCurrency, type SepCheck, nightCurrency, passengerCurrency, sepRevalidation } from '../../domain/currency';
import { DEFAULT_RULES, type RuleSource } from '../../domain/rules';
import { addDays, formatHHMM, isValidIsoDate, utcDateOf } from '../../domain/time';
import { Bar, Field, StatusPill } from '../../ui/components';
import { formatShortDate } from '../flights/format';

function RulesNote({ rule, extra }: { rule: RuleSource; extra?: ReactNode }) {
  return (
    <details className="rules">
      <summary>
        {!rule.verified && <span className="chip unverified">Unverified rule</span>}
        <span>How this is calculated</span>
      </summary>
      <div>{rule.reference}</div>
      {extra}
      <ul>{rule.todo.map((t) => <li key={t}>{t.replace(/^TODO\(verify\):\s*/, '')}</li>)}</ul>
      {!rule.verified && <p>These figures come from memory of the regulation and have not been confirmed against the current EASA text. Check them before relying on this screen.</p>}
    </details>
  );
}

function rollingHeadline(c: RollingCheck): { headline: string; sub: string } {
  if (c.state === 'lapsed') {
    return c.validUntil
      ? { headline: 'Not current', sub: `Lapsed on ${formatShortDate(addDays(c.validUntil, 1))}` }
      : { headline: 'Not current', sub: 'Not enough take-offs and landings logged in the last 90 days' };
  }
  const days = c.daysLeft ?? 0;
  const until = c.validUntil ? formatShortDate(c.validUntil) : '';
  if (c.state === 'expiring') return { headline: days === 0 ? 'Lapses after today' : `Lapses in ${days} day${days === 1 ? '' : 's'}`, sub: `Current until ${until}` };
  return { headline: 'Current', sub: c.validUntil ? `Until ${until} · ${days} days left` : 'No requirement' };
}

function Row({ label, have, need, display, ok, warn, bad }: { label: string; have: number; need: number; display: string; ok: boolean; warn?: boolean; bad?: boolean }) {
  return (
    <div className="progress-row">
      <div className="line"><span>{label}</span><span className="num">{display}</span></div>
      <Bar value={have} max={need} tone={ok ? 'ok' : bad ? 'bad' : warn ? 'warn' : ''} label={`${label}: ${display}`} />
    </div>
  );
}

const countRow = (label: string, c: RollingCurrency) => (
  <Row key={label} label={label} have={c.count} need={c.need} display={`${Math.min(c.count, 999)} / ${c.need}`}
    ok={c.count >= c.need} bad={c.state === 'lapsed'} warn={c.state === 'expiring'} />
);

function RollingCard({ title, subtitle, check, rule }: { title: string; subtitle: string; check: RollingCheck; rule: RuleSource }) {
  const h = rollingHeadline(check);
  return (
    <div className="card cur-card">
      <div className="head"><div><h3>{title}</h3><div className="hint">{subtitle}</div></div><StatusPill status={check.status} label={check.status === 'green' ? 'Current' : check.status === 'amber' ? 'Expiring soon' : 'Lapsed'} /></div>
      <div className="headline">{h.headline}</div>
      <div className="hint">{h.sub}</div>
      {countRow('Take-offs in the last 90 days', check.takeoffs)}
      {countRow('Landings in the last 90 days', check.landings)}
      <RulesNote rule={rule} />
    </div>
  );
}

const SEP_LABELS: Record<string, string> = {
  flight: 'Flight time in class', pic: 'of which as PIC', takeoffs: 'Take-offs', landings: 'Landings', training: 'Training flight with instructor (DUAL time)',
};

function SepCard({ check }: { check: SepCheck }) {
  const { canEdit, updateSettings, data } = useApp();
  const [draft, setDraft] = useState(data.settings.sepLandExpiry ?? '');
  const [editing, setEditing] = useState(false);
  const rule = DEFAULT_RULES.sep;
  const days = check.daysToExpiry ?? 0;
  const pill = { green: 'OK', amber: 'In progress', red: check.state === 'expired' ? 'Expired' : 'Urgent', unknown: 'Not set' }[check.status];
  const headline: Record<string, string> = {
    'not-set': 'Set your expiry date',
    'window-not-open': `Valid until ${check.expiry ? formatShortDate(check.expiry) : ''}`,
    'requirements-met': 'Experience requirements met',
    'in-progress': `${days} days to expiry`,
    urgent: days === 0 ? 'Expires today' : `Only ${days} day${days === 1 ? '' : 's'} left`,
    expired: `Expired on ${check.expiry ? formatShortDate(check.expiry) : ''}`,
  };
  const sub: Record<string, string> = {
    'not-set': 'Enter the expiry date of your SEP (land) class rating to track revalidation.',
    'window-not-open': `Experience counts from ${check.windowStart ? formatShortDate(check.windowStart) : ''}.`,
    'requirements-met': `Valid until ${check.expiry ? formatShortDate(check.expiry) : ''}. Revalidate before then.`,
    'in-progress': 'Requirements not yet met.',
    urgent: 'Requirements not yet met.',
    expired: 'The renewal rules for an expired rating are not evaluated by this app.',
  };
  const save = async () => {
    if (draft === '') { await updateSettings({ sepLandExpiry: null }); setEditing(false); return; }
    if (!isValidIsoDate(draft)) return;
    await updateSettings({ sepLandExpiry: draft });
    setEditing(false);
  };
  return (
    <div className="card cur-card">
      <div className="head"><div><h3>SEP (land) class rating</h3><div className="hint">Revalidation by experience, 12 months before expiry</div></div><StatusPill status={check.status} label={pill} /></div>
      <div className="headline">{headline[check.state]}</div>
      <div className="hint">{sub[check.state]}</div>
      {check.progress.map((p) => (
        <Row key={p.key} label={SEP_LABELS[p.key]!} have={p.have} need={p.need} ok={p.met} warn={!p.met && check.status === 'amber'} bad={!p.met && check.status === 'red'}
          display={p.unit === 'min' ? `${formatHHMM(p.have)} / ${formatHHMM(p.need)}` : `${p.have} / ${p.need}`} />
      ))}
      {canEdit && (
        <div className="sub-form">
          {editing || check.state === 'not-set' ? (
            <div>
              <Field label="Rating expiry date" htmlFor="sep-expiry">
                <input id="sep-expiry" className="input" type="date" value={draft} onChange={(e) => setDraft(e.target.value)} />
              </Field>
              <div className="row">
                <button type="button" className="btn tonal" onClick={() => void save()}>Save date</button>
                {editing && <button type="button" className="btn text" onClick={() => setEditing(false)}>Cancel</button>}
              </div>
            </div>
          ) : (
            <button type="button" className="btn text" onClick={() => { setDraft(data.settings.sepLandExpiry ?? ''); setEditing(true); }}>Change expiry date</button>
          )}
        </div>
      )}
      <RulesNote rule={rule} />
    </div>
  );
}

export function CurrencyScreen() {
  const { data } = useApp();
  const today: IsoDate = utcDateOf(Date.now());
  const classes = useMemo<ClassRating[]>(() => {
    const used = new Set<ClassRating>(data.flights.map((f) => f.aircraftClass));
    used.add('SEP_LAND');
    return CLASS_RATINGS.filter((c) => used.has(c));
  }, [data.flights]);
  const [cls, setCls] = useState<ClassRating>('SEP_LAND');
  const passengers = useMemo(() => passengerCurrency(data.flights, cls, today), [data.flights, cls, today]);
  const night = useMemo(() => nightCurrency(data.flights, cls, today), [data.flights, cls, today]);
  const sep = useMemo(() => sepRevalidation(data.flights, data.settings.sepLandExpiry, today), [data.flights, data.settings.sepLandExpiry, today]);

  return (
    <div>
      <p className="hint" style={{ margin: '0 4px 12px' }}>
        Status as of {formatShortDate(today)} (UTC). Currency uses logged take-offs and landings; carry-in records have no dates and are not counted.
      </p>
      {classes.length > 1 && (
        <div className="range-chips" role="group" aria-label="Aircraft class">
          {classes.map((c) => <button key={c} type="button" className="chip" aria-pressed={cls === c} onClick={() => setCls(c)}>{CLASS_RATING_LABELS[c]}</button>)}
        </div>
      )}
      <RollingCard title="Carrying passengers" subtitle={`${CLASS_RATING_LABELS[cls]} · 3 take-offs and 3 landings in 90 days`} check={passengers} rule={DEFAULT_RULES.passenger} />
      <RollingCard title="Passengers at night" subtitle={`${CLASS_RATING_LABELS[cls]} · night take-offs and landings in 90 days`} check={night} rule={DEFAULT_RULES.night} />
      {cls === 'SEP_LAND' ? <SepCard check={sep} /> : (
        <p className="hint" style={{ margin: '0 4px 12px' }}>
          Revalidation tracking is only available for the SEP (land) class rating. Select SEP (land) to see it.
        </p>
      )}
    </div>
  );
}
