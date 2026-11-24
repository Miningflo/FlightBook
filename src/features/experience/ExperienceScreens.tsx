import { useMemo, useState } from 'react';
import { useApp } from '../../AppContext';
import { CLASS_RATINGS, CLASS_RATING_LABELS, type ClassRating, type PreviousExperience } from '../../domain/types';
import { type ExperienceDraft, emptyClassCarryIn, emptyExperience, normalizeExperience, validateExperience } from '../../domain/experience';
import { formatHHMM, utcDateOf } from '../../domain/time';
import { CountField, Dialog, DurationField, Field } from '../../ui/components';
import { PlusIcon } from '../../ui/Icons';
import { formatShortDate } from '../flights/format';

export function ExperienceList() {
  const { data, go, canEdit } = useApp();
  return (
    <div>
      <p className="hint" style={{ margin: '0 4px 12px' }}>
        Hours logged before you started using this app, entered as totals. They count towards your totals and the PDF "brought forward" figures, but have no dates, so they are not used for currency.
      </p>
      {data.previousExperience.length === 0 && <div className="empty"><h2>No previous experience</h2><p>{canEdit ? 'Tap + to add the hours from your paper logbook.' : ''}</p></div>}
      {data.previousExperience.map((e) => (
        <button key={e.id} type="button" className="card tappable list-card" onClick={() => canEdit && go({ name: 'experience-edit', id: e.id })}>
          <div>
            <div className="main">{e.source}</div>
            <div className="hint">{e.periodFrom ? `${formatShortDate(e.periodFrom)} – ` : 'Up to '}{formatShortDate(e.periodTo)}</div>
            <div className="hint">PIC {formatHHMM(e.picMin)} · Night {formatHHMM(e.nightMin)} · {e.takeoffsDay + e.takeoffsNight} T/O</div>
          </div>
          <div className="total">{formatHHMM(e.totalMin)}</div>
        </button>
      ))}
      {canEdit && <button type="button" className="fab" aria-label="Add previous experience" onClick={() => go({ name: 'experience-new' })}><PlusIcon /></button>}
    </div>
  );
}

type MinKey = 'totalMin' | 'spSeMin' | 'spMeMin' | 'mpMin' | 'picMin' | 'copiMin' | 'dualMin' | 'instMin' | 'picusMin' | 'spicMin' | 'nightMin' | 'ifrMin' | 'fstdMin';
type CountKey = 'takeoffsDay' | 'takeoffsNight' | 'landingsDay' | 'landingsNight';

export function ExperienceForm({ record }: { record?: PreviousExperience }) {
  const { writer, go, reload } = useApp();
  const today = utcDateOf(Date.now());
  const initial = useMemo<ExperienceDraft>(() => {
    if (!record) return emptyExperience(today);
    const { id: _i, createdAt: _c, updatedAt: _u, ...draft } = record;
    return draft;
    // initialised once per mount (the screen is keyed per record)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]);
  const [d, setD] = useState<ExperienceDraft>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = validateExperience(d, today);
  const err = (f: string) => (submitted ? issues.find((i) => i.field === f && i.severity === 'error')?.message : undefined);
  const warning = (f: string) => issues.find((i) => i.field === f && i.severity === 'warning')?.message;
  if (!writer) return <div className="empty">This device is not the master logbook, so editing is disabled.</div>;

  const dur = (k: MinKey, label: string) => (
    <Field label={label} error={err(k)} warning={warning(k)}>
      <DurationField label={label} value={d[k]} onChange={(m) => setD({ ...d, [k]: m })} />
    </Field>
  );
  const count = (k: CountKey, label: string) => (
    <Field label={label} error={err(k)}><CountField label={label} value={d[k]} onChange={(n) => setD({ ...d, [k]: n })} /></Field>
  );
  const setClass = (k: ClassRating, patch: Partial<ReturnType<typeof emptyClassCarryIn>>) =>
    setD({ ...d, byClass: { ...d.byClass, [k]: { ...(d.byClass[k] ?? emptyClassCarryIn()), ...patch } } });

  const save = async () => {
    setSubmitted(true);
    if (issues.some((i) => i.severity === 'error')) {
      requestAnimationFrame(() => document.querySelector('.field.invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return;
    }
    try {
      await writer.savePreviousExperience(normalizeExperience(d), record?.id);
      await reload();
      go({ name: 'experience' }, { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const remove = async () => { if (record) { await writer.deletePreviousExperience(record.id); await reload(); go({ name: 'experience' }, { replace: true }); } };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <div className="card">
        <Field label="Source" error={err('source')} htmlFor="x-source"><input id="x-source" className="input" placeholder="e.g. Paper logbook vol. 1" value={d.source} onChange={(e) => setD({ ...d, source: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="From (optional)" error={err('periodFrom')} hint={d.periodFrom ? undefined : 'Without it, these hours count only in totals with no start date, such as All time.'} htmlFor="x-from"><input id="x-from" className="input" type="date" value={d.periodFrom ?? ''} onChange={(e) => setD({ ...d, periodFrom: e.target.value || null })} /></Field>
          <Field label="Up to and including" error={err('periodTo')} warning={warning('periodTo')} htmlFor="x-to"><input id="x-to" className="input" type="date" value={d.periodTo} onChange={(e) => setD({ ...d, periodTo: e.target.value })} /></Field>
        </div>
        <Field label="Note" htmlFor="x-note"><textarea id="x-note" className="input" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
      </div>

      <h2 className="section-label">Flight time</h2>
      <div className="card">
        {dur('totalMin', 'Total flight time')}
        {dur('spSeMin', 'Single-pilot single-engine')}
        {dur('spMeMin', 'Single-pilot multi-engine')}
        {dur('mpMin', 'Multi-pilot')}
      </div>

      <h2 className="section-label">Pilot function</h2>
      <div className="card">
        {dur('picMin', 'PIC')}{dur('copiMin', 'Co-pilot (COPI)')}{dur('dualMin', 'Dual (DUAL)')}{dur('instMin', 'Instructor (INS)')}
        {dur('picusMin', 'PICUS')}{dur('spicMin', 'SPIC')}
      </div>

      <h2 className="section-label">Conditions</h2>
      <div className="card">{dur('nightMin', 'Night')}{dur('ifrMin', 'IFR')}{dur('fstdMin', 'Simulator (FSTD)')}</div>

      <h2 className="section-label">Take-offs and landings</h2>
      <div className="card"><div className="grid2">{count('takeoffsDay', 'Take-offs day')}{count('takeoffsNight', 'Take-offs night')}{count('landingsDay', 'Landings day')}{count('landingsNight', 'Landings night')}</div></div>

      <h2 className="section-label">By class (optional)</h2>
      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>Needed for per-class totals. Class time cannot add up to more than the total flight time.</p>
        {err('byClass') && <div className="msg error" role="alert">{err('byClass')}</div>}
        {CLASS_RATINGS.map((k) => {
          const c = d.byClass[k] ?? emptyClassCarryIn();
          const used = c.totalMin > 0 || c.picMin > 0 || c.takeoffs > 0 || c.landings > 0;
          return (
            <details key={k} className="rules" open={used}>
              <summary><b>{CLASS_RATING_LABELS[k]}</b>{used && <span className="hint">{formatHHMM(c.totalMin)}</span>}</summary>
              <div className="sub-form">
                <Field label="Total time"><DurationField label={`${CLASS_RATING_LABELS[k]} total`} value={c.totalMin} onChange={(m) => setClass(k, { totalMin: m })} /></Field>
                <Field label="of which PIC" error={err(`class-${k}`)}><DurationField label={`${CLASS_RATING_LABELS[k]} PIC`} value={c.picMin} onChange={(m) => setClass(k, { picMin: m })} /></Field>
                <div className="grid2">
                  <Field label="Take-offs"><CountField label={`${CLASS_RATING_LABELS[k]} take-offs`} value={c.takeoffs} onChange={(n) => setClass(k, { takeoffs: n })} /></Field>
                  <Field label="Landings"><CountField label={`${CLASS_RATING_LABELS[k]} landings`} value={c.landings} onChange={(n) => setClass(k, { landings: n })} /></Field>
                </div>
              </div>
            </details>
          );
        })}
      </div>

      {record && <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete record…</button>}
      {error && <div className="msg error" role="alert" style={{ marginTop: 12 }}>Could not save: {error}</div>}
      {submitted && issues.some((i) => i.severity === 'error') && <div className="msg error" role="alert" style={{ marginTop: 12 }}>Fix the highlighted fields to save.</div>}
      <div className="actionbar">
        <button type="button" className="btn text" onClick={() => go({ name: 'experience' })}>Cancel</button>
        <button type="submit" className="btn filled">{record ? 'Save changes' : 'Save record'}</button>
      </div>
      <Dialog open={confirmDelete} title="Delete this record?" onClose={() => setConfirmDelete(false)}
        actions={<><button type="button" className="btn text" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="btn danger" onClick={() => void remove()}>Delete</button></>}>
        Your totals will drop by the hours in this record. It cannot be undone, except by restoring a backup.
      </Dialog>
    </form>
  );
}
