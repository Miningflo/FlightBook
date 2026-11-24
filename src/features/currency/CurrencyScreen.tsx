import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../../AppContext';
import { CLASS_RATING_LABELS, MEDICAL_CLASS_LABELS, type ClassRating, type Flight, type IsoDate, type MedicalClass, type TypeRating } from '../../domain/types';
import { byClass, type ProficiencyCheck, type RollingCheck, type RollingCurrency, type SectorProgress, type SepCheck, type ValidityCheck, classExpiryOf, classExpiryPatch, currencyClasses, irStatus, isExperienceClass, languageStatus, medicalStatus, nightCurrency, nightExemptByIr, routeSectors, passengerCurrency, proficiencyCheckStatus, sepRevalidation, typeRatingStatus, typeRouteSectors, unassignedTypeFlights, byType } from '../../domain/currency';
import { DEFAULT_RULES, type RenewalRule, type RollingRule, type RuleSource } from '../../domain/rules';
import { addDays, checkDate, formatHHMM, isValidIsoDate } from '../../domain/time';
import { uuid } from '../../domain/id';
import { Bar, Dialog, Field, StatusPill } from '../../ui/components';
import { aircraftLabel, formatDate, formatShortDate } from '../flights/format';
import { ChevronIcon } from '../../ui/Icons';
import { currencyRoute } from '../../hooks';

function RulesNote({ rule, extra, title = 'How this is calculated' }: { rule: RuleSource; extra?: ReactNode; title?: string }) {
  return (
    <details className="rules">
      <summary>
        {!rule.verified && <span className="chip unverified">Unverified rule</span>}
        <span>{title}</span>
      </summary>
      <div>{rule.reference}</div>
      {extra}
      <ul>{rule.todo.map((t) => <li key={t}>{t}</li>)}</ul>
      {!rule.verified && <p>These figures come from memory of the regulation and have not been confirmed against the current EASA text. Check them before relying on this screen.</p>}
    </details>
  );
}

/** "3 take-offs and 3 landings in 90 days", read off the rule so the text cannot drift from the number. */
function rollingSubtitle(rule: RollingRule, kind = ''): string {
  const n = (count: number, word: string) => `${count} ${kind}${word}${count === 1 ? '' : 's'}`;
  return `${n(rule.takeoffs, 'take-off')} and ${n(rule.landings, 'landing')} in ${rule.windowDays} days`;
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

/**
 * What an IR waives, said so it cannot be misread. FCL.060(b)(2)(ii) only lifts the EXTRA night take-off
 * and landing; the 3 take-offs and landings of (b)(1) apply to every passenger flight, day or night. A
 * card titled "Passengers at night" saying just "Exempt" read as "night passengers are fine", even with
 * (b)(1) lapsed, so it names the waiver and says where (b)(1) stands right now.
 */
function irWaiverText(exemptUntil: IsoDate, passengers: RollingCheck): string {
  const p = DEFAULT_RULES.passenger;
  const base = `Waived because you hold an instrument rating, valid until ${formatShortDate(exemptUntil)} (FCL.060(b)(2)(ii)). The ${p.takeoffs} take-offs and ${p.landings} landings for carrying passengers still apply at night`;
  return passengers.state === 'lapsed'
    ? `${base}, and they are not met: no passengers, by day or at night.`
    : `${base}, and they are met until ${passengers.validUntil ? formatShortDate(passengers.validUntil) : ''}.`;
}

/** An exemption is not a currency state. While it applies the night counts are beside the point, so they are left out. */
function RollingCard({ title, subtitle, check, rule, exemptUntil, passengers }: {
  title: string; subtitle: string; check: RollingCheck; rule: RuleSource; exemptUntil?: IsoDate;
  /** With `exemptUntil`: the passenger currency, which the IR does not waive. */
  passengers?: RollingCheck;
}) {
  const h = exemptUntil && passengers
    ? { headline: 'Extra night landing waived', sub: irWaiverText(exemptUntil, passengers) }
    : rollingHeadline(check);
  return (
    <div className="card cur-card">
      <div className="head"><div><h3>{title}</h3><div className="hint">{subtitle}</div></div>
        {exemptUntil
          ? <StatusPill status="unknown" label="Waived (IR)" />
          : <StatusPill status={check.status} label={check.status === 'green' ? 'Current' : check.status === 'amber' ? 'Expiring soon' : 'Lapsed'} />}
      </div>
      <div className="headline">{h.headline}</div>
      <div className="hint">{h.sub}</div>
      {!exemptUntil && countRow('Take-offs in the last 90 days', check.takeoffs)}
      {!exemptUntil && countRow('Landings in the last 90 days', check.landings)}
      <RulesNote rule={rule} />
    </div>
  );
}

const SEP_LABELS: Record<string, string> = {
  flight: 'Flight time in class', pic: 'of which as PIC', takeoffs: 'Take-offs', landings: 'Landings', training: 'Training flight with instructor (DUAL time)',
};

/** Shown when a rating has expired: what is needed to get it back. The steps differ by rating. */
function RenewalSteps({ rule = DEFAULT_RULES.renewal }: { rule?: RenewalRule }) {
  return (
    <div className="renewal">
      <strong>To renew this rating</strong>
      <ol>{rule.steps.map((t) => <li key={t}>{t}</li>)}</ol>
      <RulesNote rule={rule} />
    </div>
  );
}

/** Edit a rating's expiry date. `onSave(null)` clears it. */
/**
 * Edits one expiry date. Saving no date removes it. With `confirmRemove`, removing has to be confirmed
 * first, on both paths that lead there: the remove button, and saving with the date field cleared.
 */
function ExpiryEditor({ id, current, forceOpen, onSave, label = 'Rating expiry date', removeLabel = 'Remove date', confirmRemove }: {
  id: string; current: string; forceOpen: boolean; label?: string; removeLabel?: string;
  onSave: (date: IsoDate | null) => Promise<unknown>;
  confirmRemove?: { title: string; body: ReactNode; action: string };
}) {
  const { canEdit } = useApp();
  const [draft, setDraft] = useState(current);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!canEdit) return null;
  const remove = async () => {
    setConfirming(false);
    setDraft('');
    await onSave(null);
    setEditing(false);
  };
  const requestRemove = () => { if (confirmRemove) setConfirming(true); else void remove(); };
  const save = async () => {
    if (draft === '') { if (current !== '') requestRemove(); else setEditing(false); return; }
    if (!isValidIsoDate(draft)) return;
    await onSave(draft);
    setEditing(false);
  };
  return (
    <div className="sub-form">
      {editing || forceOpen ? (
        <div>
          <Field label={label} htmlFor={id}>
            <input id={id} className="input" type="date" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          <div className="row">
            <button type="button" className="btn tonal" onClick={() => void save()}>Save date</button>
            {editing && <button type="button" className="btn text" onClick={() => setEditing(false)}>Cancel</button>}
            {current !== '' && <button type="button" className="btn text" onClick={requestRemove}>{removeLabel}</button>}
          </div>
        </div>
      ) : (
        <button type="button" className="btn text" onClick={() => { setDraft(current); setEditing(true); }}>Change expiry date</button>
      )}
      {confirmRemove && (
        <Dialog open={confirming} title={confirmRemove.title} onClose={() => setConfirming(false)}
          actions={<>
            <button type="button" className="btn text" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn danger" onClick={() => void remove()}>{confirmRemove.action}</button>
          </>}>
          {confirmRemove.body}
        </Dialog>
      )}
    </div>
  );
}

/** The expiry of one class rating. key={cls}: remount per class, so a date typed for one is never
 * carried into another. */
function ClassExpiryEditor({ cls, forceOpen }: { cls: ClassRating; forceOpen: boolean }) {
  const { updateSettings, data } = useApp();
  return (
    <ExpiryEditor
      key={cls} id={`expiry-${cls}`} forceOpen={forceOpen}
      current={classExpiryOf(data.settings, cls) ?? ''}
      onSave={(date) => updateSettings(classExpiryPatch(data.settings, cls, date))}
    />
  );
}

function ExperienceCard({ cls, check }: { cls: ClassRating; check: SepCheck }) {
  const rule = DEFAULT_RULES.sep;
  const name = CLASS_RATING_LABELS[cls];
  const days = check.daysToExpiry ?? 0;
  const pill = { green: 'OK', amber: check.state === 'met-sign-off' ? 'Sign-off due' : 'In progress', red: check.state === 'expired' ? 'Expired' : 'Urgent', unknown: 'Not set' }[check.status];
  const headline: Record<string, string> = {
    'not-set': 'Set your expiry date',
    'window-not-open': `Valid until ${check.expiry ? formatShortDate(check.expiry) : ''}`,
    'requirements-met': 'Experience requirements met',
    'met-sign-off': days === 0 ? 'Requirements met · expires today' : `Requirements met · ${days} day${days === 1 ? '' : 's'} to expiry`,
    'in-progress': `${days} days to expiry`,
    urgent: days === 0 ? 'Expires today' : `Only ${days} day${days === 1 ? '' : 's'} left`,
    expired: `Expired on ${check.expiry ? formatShortDate(check.expiry) : ''}`,
  };
  const sub: Record<string, string> = {
    'not-set': `Enter the expiry date of your ${name} class rating to track revalidation.`,
    'window-not-open': `Experience counts from ${check.windowStart ? formatShortDate(check.windowStart) : ''}.`,
    'requirements-met': `Valid until ${check.expiry ? formatShortDate(check.expiry) : ''}. Revalidate before then.`,
    'met-sign-off': `Have the revalidation entered in your licence before ${check.expiry ? formatShortDate(check.expiry) : ''}, then enter the new expiry date below.`,
    'in-progress': 'Requirements not yet met.',
    urgent: 'Requirements not yet met.',
    expired: 'Revalidation is no longer possible; the rating must be renewed.',
  };
  return (
    <div className="card cur-card">
      <div className="head"><div><h3>{name} class rating</h3><div className="hint">Revalidation by experience, 12 months before expiry</div></div><StatusPill status={check.status} label={pill} /></div>
      <div className="headline">{headline[check.state]}</div>
      <div className="hint">{sub[check.state]}</div>
      {check.state !== 'expired' && check.progress.map((p) => (
        <Row key={p.key} label={SEP_LABELS[p.key]!} have={p.have} need={p.need} ok={p.met} warn={!p.met && check.status === 'amber'} bad={!p.met && check.status === 'red'}
          display={p.unit === 'min' ? `${formatHHMM(p.have)} / ${formatHHMM(p.need)}` : `${p.have} / ${p.need}`} />
      ))}
      {check.state === 'expired' && <RenewalSteps />}
      <ClassExpiryEditor cls={cls} forceOpen={check.state === 'not-set'} />
      <RulesNote rule={rule} />
    </div>
  );
}

function CheckCard({ cls, check }: { cls: ClassRating; check: ProficiencyCheck }) {
  const { data } = useApp();
  const sectors = routeSectors(data.flights, cls, check.expiry, checkDate(Date.now()));
  const rule = DEFAULT_RULES.proficiencyCheck;
  const name = CLASS_RATING_LABELS[cls];
  const days = check.daysToExpiry ?? 0;
  const d = (x: string | null) => (x ? formatShortDate(x) : '');
  const pill = { green: 'OK', amber: 'Check due', red: check.state === 'expired' ? 'Expired' : 'Urgent', unknown: 'Not set' }[check.status];
  const headline: Record<string, string> = {
    'not-set': 'Set your expiry date',
    'window-not-open': `Valid until ${d(check.expiry)}`,
    'window-open': `Proficiency check due · ${days} days to expiry`,
    urgent: days === 0 ? 'Expires today' : `Only ${days} day${days === 1 ? '' : 's'} left`,
    expired: `Expired on ${d(check.expiry)}`,
  };
  const sub: Record<string, string> = {
    'not-set': `Enter the expiry date of your ${name} class rating to track revalidation.`,
    'window-not-open': `Take the proficiency check with an examiner from ${d(check.windowStart)}.`,
    'window-open': 'Revalidate with a proficiency check with an examiner before expiry. Flight experience alone cannot revalidate this class.',
    urgent: 'Proficiency check with an examiner still needed.',
    expired: 'Revalidation is no longer possible; the rating must be renewed.',
  };
  return (
    <div className="card cur-card">
      <div className="head"><div><h3>{name} class rating</h3><div className="hint">Revalidation by proficiency check, last 3 months before expiry</div></div><StatusPill status={check.status} label={pill} /></div>
      <div className="headline">{headline[check.state]}</div>
      <div className="hint">{sub[check.state]}</div>
      {sectors && check.state !== 'expired' && (
        <>
          <SectorRows sectors={sectors} back={cls} />
          <div className="hint">
            A route sector is a flight with take-off, departure, at least 15 minutes of cruise, arrival, approach
            and landing (FCL.010), so a local flight can count and a short hop may not. The logbook does not
            record the cruise, so only flights you mark as route sectors are counted. 1 route sector flown with
            an examiner also satisfies the requirement, and that may be the proficiency check itself.
          </div>
          <RulesNote rule={DEFAULT_RULES.mepSectors} title="How route sectors are counted" />
        </>
      )}
      {check.state === 'expired' && <RenewalSteps />}
      <ClassExpiryEditor cls={cls} forceOpen={check.state === 'not-set'} />
      <RulesNote rule={rule} title="How the revalidation deadline is worked out" />
    </div>
  );
}

/**
 * The instrument rating. Not a class rating, so it sits outside the class chips: it is held once and
 * applies across the classes you are rated for, and it is what switches the night requirement off.
 */
function IrCard({ today }: { today: IsoDate }) {
  const { data, canEdit, updateSettings } = useApp();
  const expiry = data.settings.irExpiry ?? null;
  const check = useMemo(() => irStatus(expiry, today), [expiry, today]);
  const rule = DEFAULT_RULES.ir;
  if (!expiry && !canEdit) return null;
  const days = check.daysToExpiry ?? 0;
  const d = (x: string | null) => (x ? formatShortDate(x) : '');
  const pill = { green: 'OK', amber: 'Check due', red: check.state === 'expired' ? 'Expired' : 'Urgent', unknown: 'Not set' }[check.status];
  const headline: Record<string, string> = {
    'not-set': 'Do you hold an instrument rating?',
    'window-not-open': `Valid until ${d(check.expiry)}`,
    'window-open': `Proficiency check due · ${days} days to expiry`,
    urgent: days === 0 ? 'Expires today' : `Only ${days} day${days === 1 ? '' : 's'} left`,
    expired: `Expired on ${d(check.expiry)}`,
  };
  const sub: Record<string, string> = {
    'not-set': `Enter its expiry date to track it. While it is valid, the extra night take-off and landing for carrying passengers is waived; the ${DEFAULT_RULES.passenger.takeoffs} take-offs and ${DEFAULT_RULES.passenger.landings} landings still apply.`,
    'window-not-open': `While it is valid, the extra night take-off and landing is waived. The check may be taken from ${d(check.windowStart)}.`,
    'window-open': 'Revalidate with a proficiency check before expiry. While it is valid, the extra night take-off and landing is waived.',
    urgent: 'Proficiency check still needed. The extra night take-off and landing applies again once it expires.',
    expired: 'Revalidation is no longer possible; the rating must be renewed. The extra night take-off and landing applies again.',
  };
  return (
    <div className="card cur-card">
      <div className="head"><div><h3>Instrument rating</h3><div className="hint">Valid 1 year · revalidation by proficiency check, last 3 months before expiry</div></div><StatusPill status={check.status} label={pill} /></div>
      <div className="headline">{headline[check.state]}</div>
      <div className="hint">{sub[check.state]}</div>
      {check.state === 'expired' && <RenewalSteps rule={DEFAULT_RULES.irRenewal} />}
      <ExpiryEditor
        id="expiry-ir" label="IR expiry date" forceOpen={false} current={expiry ?? ''}
        onSave={(date) => updateSettings({ irExpiry: date })}
      />
      <RulesNote rule={rule} title="How the IR deadline is worked out" />
    </div>
  );
}

const VALIDITY_PILL: Record<string, string> = {
  'not-set': 'Not set', 'no-expiry': 'No expiry', valid: 'Valid', due: 'Renew soon', urgent: 'Urgent', expired: 'Expired',
};

/** Medical certificate (Part-MED). A date and a class; never a condition or a limitation. */
function MedicalCard({ today }: { today: IsoDate }) {
  const { data, canEdit, updateSettings } = useApp();
  const expiry = data.settings.medicalExpiry ?? null;
  const cls = data.settings.medicalClass ?? null;
  const check = useMemo(() => medicalStatus(expiry, today), [expiry, today]);
  if (!expiry && !canEdit) return null;
  const d = (x: string | null) => (x ? formatShortDate(x) : '');
  const days = check.daysToExpiry ?? 0;
  const headline: Record<string, string> = {
    'not-set': 'Add your medical certificate',
    valid: `Valid until ${d(check.expiry)}`,
    due: `Expires in ${days} day${days === 1 ? '' : 's'}`,
    urgent: days === 0 ? 'Expires today' : `Only ${days} day${days === 1 ? '' : 's'} left`,
    expired: `Expired on ${d(check.expiry)}`,
  };
  const sub: Record<string, string> = {
    'not-set': 'Enter the expiry date printed on it. Nothing else about it is stored.',
    valid: `The revalidation examination may be done from ${d(check.windowStart)}.`,
    due: `The revalidation examination may be done from ${d(check.windowStart)}; doing it inside that window keeps this expiry date as the starting point.`,
    urgent: 'Book the examination now.',
    expired: 'You may not fly until it is renewed. After 2 years expired, the examiner must review your aero-medical records first.',
  };
  return (
    <div className="card cur-card">
      <div className="head"><div><h3>Medical certificate</h3><div className="hint">{cls ? `${MEDICAL_CLASS_LABELS[cls]} · ` : ''}Part-MED</div></div><StatusPill status={check.status} label={VALIDITY_PILL[check.state]} /></div>
      <div className="headline">{headline[check.state]}</div>
      <div className="hint">{sub[check.state]}</div>
      {canEdit && (
        <div className="range-chips" role="group" aria-label="Medical class" style={{ marginTop: 8 }}>
          {(['CLASS1', 'CLASS2', 'LAPL'] as MedicalClass[]).map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={cls === c}
              onClick={() => void updateSettings({ medicalClass: cls === c ? null : c })}>{MEDICAL_CLASS_LABELS[c]}</button>
          ))}
        </div>
      )}
      <ExpiryEditor id="expiry-medical" label="Medical expiry date" forceOpen={false} current={expiry ?? ''}
        onSave={(date) => updateSettings({ medicalExpiry: date })} />
      <RulesNote rule={DEFAULT_RULES.medical} title="How the medical expiry is read" />
    </div>
  );
}

/** Language proficiency endorsement (FCL.055). Level 6 does not expire. */
function LanguageCard({ today }: { today: IsoDate }) {
  const { data, canEdit, updateSettings } = useApp();
  const level = data.settings.languageLevel ?? null;
  const expiry = data.settings.languageExpiry ?? null;
  const check: ValidityCheck = useMemo(() => languageStatus(level, expiry, today), [level, expiry, today]);
  if (!level && !expiry && !canEdit) return null;
  const d = (x: string | null) => (x ? formatShortDate(x) : '');
  const days = check.daysToExpiry ?? 0;
  const headline: Record<string, string> = {
    'not-set': 'Add your language endorsement',
    'no-expiry': 'No re-evaluation needed',
    valid: `Valid until ${d(check.expiry)}`,
    due: `Expires in ${days} day${days === 1 ? '' : 's'}`,
    urgent: days === 0 ? 'Expires today' : `Only ${days} day${days === 1 ? '' : 's'} left`,
    expired: `Expired on ${d(check.expiry)}`,
  };
  const sub: Record<string, string> = {
    'not-set': 'Pick the level on your licence. Level 4 is re-evaluated every 4 years, level 5 every 6, level 6 never.',
    'no-expiry': 'An expert level (6) endorsement is not re-evaluated.',
    valid: 'Without a valid endorsement you may not use the radio, and so may not exercise your licence.',
    due: 'Book the re-evaluation.',
    urgent: 'Book the re-evaluation now.',
    expired: 'Without it you may not use the radio, and so may not exercise the privileges of your licence.',
  };
  return (
    <div className="card cur-card">
      <div className="head"><div><h3>Language proficiency</h3><div className="hint">{level ? `Level ${level} · ` : ''}FCL.055</div></div><StatusPill status={check.status} label={VALIDITY_PILL[check.state]} /></div>
      <div className="headline">{headline[check.state]}</div>
      <div className="hint">{sub[check.state]}</div>
      {canEdit && (
        <div className="range-chips" role="group" aria-label="Language proficiency level" style={{ marginTop: 8 }}>
          {([4, 5, 6] as const).map((l) => (
            <button key={l} type="button" className="chip" aria-pressed={level === l}
              onClick={() => void updateSettings({ languageLevel: level === l ? null : l })}>Level {l}</button>
          ))}
        </div>
      )}
      {level !== 6 && (
        <ExpiryEditor id="expiry-language" label="Endorsement expiry date" forceOpen={false} current={expiry ?? ''}
          onSave={(date) => updateSettings({ languageExpiry: date })} />
      )}
      <RulesNote rule={DEFAULT_RULES.language} title="How the endorsement expiry is read" />
    </div>
  );
}

/**
 * The Other class holds every type-rated aeroplane, so a single currency across it would mix types
 * that have nothing to do with each other. FCL.060 counts per "type or class", so this shows one set
 * of counters per type rating instead, and names the flights that belong to none of them. Every rating
 * held gets its counters, flown or not: a rating with no flights is exactly the one you are not current on.
 */
/** How many of the flights without a type rating are listed before "Show all". */
const STRANDED_SHOWN = 5;

/**
 * Flights a card needs you to look at, so they can be found and fixed: a count alone said "open them" with
 * no way of knowing which. Each one opens straight into the edit form, which returns here (`back` is the
 * class chip to come back to); a read-only viewer cannot edit, so it opens the flight instead. Newest first.
 */
function FlightLinkList({ flights, back, action, detail }: {
  flights: Flight[]; back: ClassRating;
  /** What to do in the form, e.g. "pick the rating". */
  action: string;
  detail?: (f: Flight) => string;
}) {
  const { canEdit, go } = useApp();
  const [all, setAll] = useState(false);
  const shown = all ? flights : flights.slice(0, STRANDED_SHOWN);
  return (
    <>
      <div className="hint" style={{ marginTop: 8 }}>{canEdit ? `Tap ${flights.length === 1 ? 'it' : 'one'} to ${action}.` : `Do this on the master device: ${action}.`}</div>
      <ul className="link-list">
        {shown.map((f) => (
          <li key={f.id}>
            <button type="button" className="link-row" onClick={() => go(canEdit ? { name: 'edit', id: f.id, from: back } : { name: 'flight', id: f.id })}>
              <span>
                <span className="main">{formatDate(f.date)} · {f.depPlace} → {f.arrPlace}</span>
                <span className="hint">{f.registration} · {aircraftLabel(f)} · {formatHHMM(f.totalMin)}{detail?.(f) ?? ''}</span>
              </span>
              <ChevronIcon />
            </button>
          </li>
        ))}
      </ul>
      {!all && flights.length > STRANDED_SHOWN && (
        <button type="button" className="btn text" onClick={() => setAll(true)}>Show all {flights.length}</button>
      )}
    </>
  );
}

/**
 * Route sectors for a multi-engine class or a type rating. Only flights marked as route sectors on the form
 * count (FCL.010 needs 15 minutes of cruise, which the logbook does not record); the rest of the period's
 * flights are listed under a fold so they can be checked and marked.
 */
function SectorRows({ sectors, back }: { sectors: SectorProgress; back: ClassRating }) {
  const n = sectors.unmarked.length;
  return (
    <>
      <Row label="Route sectors (marked on the flight)" have={sectors.sectors} need={sectors.need} display={`${sectors.sectors} / ${sectors.need}`} ok={sectors.met} />
      {n > 0 && !sectors.met && (
        <details className="rules">
          <summary><span>{n} flight{n === 1 ? '' : 's'} in this period not marked as a route sector</span></summary>
          <FlightLinkList flights={sectors.unmarked} back={back} action="mark it as a route sector if it had at least 15 minutes of cruise" />
        </details>
      )}
    </>
  );
}

function OtherClassPanel({ today }: { today: IsoDate }) {
  const { data } = useApp();
  const ratings = data.settings.typeRatings ?? [];
  const stranded = unassignedTypeFlights(data.flights, ratings);
  const anyOther = data.flights.some((f) => f.aircraftClass === 'OTHER');
  // an expired rating cannot be used, so its currency is beside the point: name it, do not count it
  const expired = ratings.filter((t) => typeRatingStatus(t.expiry, today).state === 'expired');
  const current = ratings.filter((t) => !expired.includes(t));
  // said once below the cards rather than repeated on every one of them
  const exemptUntil = nightExemptByIr(data.settings, today) ? data.settings.irExpiry ?? undefined : undefined;
  return (
    <>
      {stranded.length > 0 && (
        <div className="card cur-card">
          <div className="head"><div><h3>Flights without a type rating</h3></div><StatusPill status="amber" label={`${stranded.length}`} /></div>
          <div className="hint">
            {stranded.length} flight{stranded.length === 1 ? '' : 's'} in the Other class do{stranded.length === 1 ? 'es' : ''} not name a type
            rating you hold (none was picked, or it has been removed), so {stranded.length === 1 ? 'it counts' : 'they count'} towards no
            currency at all.
          </div>
          <FlightLinkList flights={stranded} back="OTHER" action="pick the rating" detail={(f) => (f.typeRatingId ? ' · rating removed' : '')} />
        </div>
      )}
      {!anyOther && (
        <p className="hint" style={{ margin: '0 4px 12px' }}>
          No flights logged in a type-rated aeroplane yet. Log them in the Other class and pick the type rating, and they count here.
        </p>
      )}
      {current.map((t) => <TypeCurrencyCard key={t.id} rating={t} today={today} nightExempt={exemptUntil !== undefined} />)}
      {current.length > 0 && exemptUntil && (
        <p className="hint" style={{ margin: '0 4px 12px' }}>
          At night: the extra night take-off and landing is waived while your instrument rating is valid, until {formatShortDate(exemptUntil)} (FCL.060(b)(2)(ii)).
          The Passengers line on each card still applies, by day and at night.
        </p>
      )}
      {expired.length > 0 && (
        <p className="hint" style={{ margin: '0 4px 12px' }}>
          Not shown, because the rating has expired: {expired.map((t) => `${t.name} (${formatShortDate(t.expiry)})`).join(', ')}.
          Enter the new date under <strong>Type ratings</strong> once it is renewed.
        </p>
      )}
      {current.length > 0 && (
        <div className="card cur-card rules-only">
          <RulesNote rule={DEFAULT_RULES.passenger} title={`Passengers: ${rollingSubtitle(DEFAULT_RULES.passenger)}`} />
          <RulesNote rule={DEFAULT_RULES.night} title={`At night: ${rollingSubtitle(DEFAULT_RULES.night, 'night ')}`} />
        </div>
      )}
    </>
  );
}

const rollingPill = (c: RollingCheck): string => (c.status === 'green' ? 'Current' : c.status === 'amber' ? 'Expiring soon' : 'Lapsed');

/** One line of a type card: status, then the counts and the date, in the space a class card gives a heading. */
function CompactRolling({ label, check }: { label: string; check: RollingCheck }) {
  const n = (c: RollingCurrency, word: string) => `${Math.min(c.count, 999)}/${c.need} ${word}`;
  const days = check.daysLeft ?? 0;
  const when = check.state === 'lapsed'
    ? (check.validUntil ? ` · lapsed on ${formatShortDate(addDays(check.validUntil, 1))}` : '')
    : check.state === 'expiring'
      ? ` · lapses ${days === 0 ? 'after today' : `in ${days} day${days === 1 ? '' : 's'}`}`
      : check.validUntil ? ` · current until ${formatShortDate(check.validUntil)}` : '';
  return (
    <div className="compact-rolling">
      <div className="line">
        <span className="what">{label}</span>
        <StatusPill status={check.status} label={rollingPill(check)} />
      </div>
      <div className="hint">{`${n(check.takeoffs, 'take-offs')} · ${n(check.landings, 'landings')}${when}`}</div>
    </div>
  );
}

/**
 * Recent experience for one type rating, kept to one card: a pilot can hold several ratings, and two
 * full-size cards for each pushed the licence section far down the screen. The rating's name is the
 * heading, so it is clear at a glance which rating each card is about.
 */
function TypeCurrencyCard({ rating, today, nightExempt }: { rating: TypeRating; today: IsoDate; nightExempt: boolean }) {
  const { data } = useApp();
  return (
    <div className="card cur-card type-cur">
      <h3 className="type-name">{rating.name}</h3>
      <CompactRolling label="Passengers" check={passengerCurrency(data.flights, byType(rating.id), today)} />
      {!nightExempt && <CompactRolling label="At night" check={nightCurrency(data.flights, byType(rating.id), today)} />}
    </div>
  );
}

/** What removing a type rating does to the flights logged under it. */
function removalWarning(flights: number): string {
  if (flights === 0) return 'No flights are logged under this rating. To keep it and only change its date, cancel and pick a new date instead.';
  const n = flights === 1 ? '1 flight is' : `${flights} flights are`;
  return `${n} logged under this rating. They will stop counting towards any currency and will be listed as flights without a type rating until you pick a rating for each of them again. Adding the rating back later does not reconnect them. To keep it and only change its date, cancel and pick a new date instead.`;
}

/**
 * Type ratings. A list, not a single card: a pilot may hold several at once and each expires on its own
 * date. Flights in a type-rated aeroplane are logged under the OTHER class, which is why nothing here
 * is driven by the class chips.
 */
/** `cls`: the class chip on screen, so a flight opened from here comes back to the same view. */
function TypeRatingsCard({ today, cls }: { today: IsoDate; cls: ClassRating }) {
  const { data, canEdit, updateSettings } = useApp();
  const ratings = data.settings.typeRatings ?? [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  if (ratings.length === 0 && !canEdit) return null;

  const save = (next: TypeRating[]) => updateSettings({ typeRatings: next });
  const add = async () => {
    if (name.trim() === '' || !isValidIsoDate(date)) return;
    await save([...ratings, { id: uuid(), name: name.trim(), expiry: date }]);
    setName(''); setDate(''); setAdding(false);
  };

  return (
    <div className="card cur-card">
      <div className="head"><div><h3>Type ratings</h3><div className="hint">Valid 1 year unless the OSD says otherwise · proficiency check in the last 3 months</div></div></div>
      {ratings.length === 0 && <div className="hint">None added. Add one for each type rating on your licence.</div>}
      {ratings.map((t) => {
        const c = typeRatingStatus(t.expiry, today);
        const sec = typeRouteSectors(data.flights, t.id, t.expiry, today);
        const days = c.daysToExpiry ?? 0;
        const label = { green: 'Valid', amber: 'Check due', red: c.state === 'expired' ? 'Expired' : 'Urgent', unknown: 'Not set' }[c.status];
        return (
          <div key={t.id} className="progress-row">
            <div className="line">
              <span><strong>{t.name}</strong></span>
              <StatusPill status={c.status} label={label} />
            </div>
            <div className="hint">
              {c.state === 'expired' ? `Expired on ${formatShortDate(t.expiry)} — it has to be renewed.`
                : c.state === 'window-not-open' ? `Valid until ${formatShortDate(t.expiry)}. The check may be taken from ${c.windowStart ? formatShortDate(c.windowStart) : ''}.`
                : `Proficiency check due · ${days} day${days === 1 ? '' : 's'} to expiry (${formatShortDate(t.expiry)}).`}
            </div>
            {sec && c.state !== 'expired' && <SectorRows sectors={sec} back={cls} />}
            {canEdit && (
              <div className="row">
                {/* clearing a type rating's date removes the rating itself, so the button has to say so, and it
                    asks first: the flights logged under it stop counting, and adding it back does not reconnect them */}
                <ExpiryEditor id={`expiry-type-${t.id}`} label={`${t.name} expiry date`} removeLabel="Remove rating" forceOpen={false} current={t.expiry}
                  confirmRemove={{ title: `Remove the ${t.name} type rating?`, action: 'Remove rating', body: removalWarning(data.flights.filter((f) => f.typeRatingId === t.id).length) }}
                  onSave={(d) => (d === null
                    ? save(ratings.filter((r) => r.id !== t.id))
                    : save(ratings.map((r) => (r.id === t.id ? { ...r, expiry: d } : r))))} />
              </div>
            )}
          </div>
        );
      })}
      {canEdit && (adding ? (
        <div className="sub-form">
          <Field label="Type rating, as written on your licence" htmlFor="type-name">
            <input id="type-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="B737 300-900" autoComplete="off" />
          </Field>
          <Field label="Expiry date" htmlFor="type-date">
            <input id="type-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="row">
            <button type="button" className="btn tonal" onClick={() => void add()}>Add</button>
            <button type="button" className="btn text" onClick={() => { setAdding(false); setName(''); setDate(''); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="sub-form"><button type="button" className="btn text" onClick={() => setAdding(true)}>Add a type rating</button></div>
      ))}
      <RulesNote rule={DEFAULT_RULES.typeRating} title="How a type rating deadline is worked out" />
    </div>
  );
}

/** `cls` comes from the address (#/currency/OTHER), so coming back from a flight lands on the same chip. */
export function CurrencyScreen({ cls: routeCls }: { cls?: ClassRating }) {
  const { data, go } = useApp();
  // the later of the local and UTC date, so nothing reads as valid past its expiry (see checkDate)
  const today: IsoDate = checkDate(Date.now());
  // Every class with a rating to follow is selectable, so an expiry date can be entered before any flight is logged.
  const classes = useMemo(() => currencyClasses(data.flights, data.settings.typeRatings ?? []), [data.flights, data.settings.typeRatings]);
  const picked: ClassRating = routeCls ?? 'SEP_LAND';
  // the default chip keeps the plain address; replace, so chips do not pile up in the history
  const setCls = (c: ClassRating) => go(currencyRoute(c), { replace: true });
  // the picked chip can disappear (the last type rating and Other flight removed): fall back rather than show a chip-less panel
  const cls: ClassRating = classes.includes(picked) ? picked : 'SEP_LAND';
  const passengers = useMemo(() => passengerCurrency(data.flights, byClass(cls), today), [data.flights, byClass(cls), today]);
  const night = useMemo(() => nightCurrency(data.flights, byClass(cls), today), [data.flights, byClass(cls), today]);
  const expiry = classExpiryOf(data.settings, cls);
  const experience = useMemo(() => sepRevalidation(data.flights, expiry, today, DEFAULT_RULES, cls), [data.flights, expiry, today, cls]);
  const check = useMemo(() => proficiencyCheckStatus(expiry, today), [expiry, today]);
  // an IR removes the night requirement entirely (FCL.060(b)(2)(ii)), for every class
  const nightExempt = nightExemptByIr(data.settings, today) ? data.settings.irExpiry ?? undefined : undefined;

  return (
    <div>
      <p className="hint" style={{ margin: '0 4px 12px' }}>
        Status as of {formatShortDate(today)}. Currency uses logged take-offs and landings; carry-in records have no dates and are not counted.
      </p>
      <p className="hint" style={{ margin: '0 4px 12px' }}>
        A guide, not an approval: you remain responsible for your currency and ratings. Check your licence and the authority that issued it.
      </p>
      <div className="range-chips" role="group" aria-label="Aircraft class">
        {classes.map((c) => <button key={c} type="button" className="chip" aria-pressed={cls === c} onClick={() => setCls(c)}>{CLASS_RATING_LABELS[c]}</button>)}
      </div>
      {/* Other is not a class you can be current on: it is every type-rated aeroplane at once, and
          FCL.060 counts per type. OtherClassPanel does the counting per rating instead. */}
      {cls !== 'OTHER' && (
        <>
          <RollingCard title="Carrying passengers" subtitle={`${CLASS_RATING_LABELS[cls]} · ${rollingSubtitle(DEFAULT_RULES.passenger)}`} check={passengers} rule={DEFAULT_RULES.passenger} />
          <RollingCard title="Passengers at night" subtitle={`${CLASS_RATING_LABELS[cls]} · ${rollingSubtitle(DEFAULT_RULES.night, 'night ')}`} check={night} rule={DEFAULT_RULES.night} exemptUntil={nightExempt} passengers={passengers} />
        </>
      )}
      {isExperienceClass(cls) ? <ExperienceCard cls={cls} check={experience} />
        : cls === 'OTHER' ? <OtherClassPanel today={today} />
        : <CheckCard cls={cls} check={check} />}

      {/* Not class ratings: held once, and they apply whatever you are flying. */}
      <h2 className="section-label">Your licence</h2>
      <IrCard today={today} />
      <TypeRatingsCard today={today} cls={cls} />
      <MedicalCard today={today} />
      <LanguageCard today={today} />
    </div>
  );
}
