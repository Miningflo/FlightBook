import { useMemo, useState } from 'react';
import { useApp } from '../../AppContext';
import type { FstdSession } from '../../domain/types';
import { type FstdInput, emptyFstd, fstdTypeSuggestions, normalizeFstd, validateFstd } from '../../domain/fstd';
import { formatHHMM, utcDateOf } from '../../domain/time';
import { Dialog, DurationField, Field } from '../../ui/components';
import { PlusIcon } from '../../ui/Icons';
import { formatDate } from '../flights/format';
import { useDiscardGuard } from '../../ui/useDiscardGuard';

export function FstdList() {
  const { data, go, canEdit } = useApp();
  const total = data.fstd.reduce((a, s) => a + s.totalMin, 0);
  return (
    <div>
      <div className="hero-stats">
        <div className="label">Simulator time</div>
        <div className="big">{formatHHMM(total)}<span className="unit"> h</span></div>
        <div className="mini-stats"><div><b>{data.fstd.length}</b><span>sessions</span></div></div>
      </div>
      {data.fstd.length === 0 && <div className="empty"><h2>No simulator sessions</h2><p>{canEdit ? 'Tap + to log an FSTD session.' : ''}</p></div>}
      {data.fstd.map((s) => (
        <button key={s.id} type="button" className="card tappable list-card" onClick={() => canEdit && go({ name: 'fstd-edit', id: s.id })}>
          <div><div className="main">{s.fstdType}</div><div className="hint">{formatDate(s.date)}{s.remarks ? ` · ${s.remarks}` : ''}</div></div>
          <div className="total">{formatHHMM(s.totalMin)}</div>
        </button>
      ))}
      {canEdit && <button type="button" className="fab" aria-label="Add simulator session" onClick={() => go({ name: 'fstd-new' })}><PlusIcon /></button>}
    </div>
  );
}

export function FstdForm({ session }: { session?: FstdSession }) {
  const { data, writer, go, reload } = useApp();
  const initial = useMemo<FstdInput>(
    () => session ? { date: session.date, fstdType: session.fstdType, totalMin: session.totalMin, remarks: session.remarks }
      : { ...emptyFstd(utcDateOf(Date.now())), fstdType: fstdTypeSuggestions(data.fstd)[0] ?? '' },
    // initialised once per mount (the screen is keyed per record)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.id],
  );
  const [d, setD] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const discardDialog = useDiscardGuard(JSON.stringify(d) !== JSON.stringify(initial), 'Your unsaved changes to this session will be lost.');
  const issues = validateFstd(d);
  const err = (f: string) => (submitted ? issues.find((i) => i.field === f && i.severity === 'error')?.message : undefined);
  const warn = issues.find((i) => i.field === 'totalMin' && i.severity === 'warning')?.message;
  if (!writer) return <div className="empty">This device is not the master logbook, so editing is disabled.</div>;

  const save = async () => {
    setSubmitted(true);
    if (saving || issues.some((i) => i.severity === 'error')) return;
    setSaving(true);
    try {
      await writer.saveFstd(normalizeFstd(d), session?.id);
      await reload();
      go({ name: 'fstd' }, { replace: true, force: true });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setSaving(false); }
  };
  const remove = async () => { if (session) { await writer.deleteFstd(session.id); await reload(); go({ name: 'fstd' }, { replace: true, force: true }); } };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <div className="card">
        <Field label="Date" error={err('date')} htmlFor="fs-date"><input id="fs-date" className="input" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
        <Field label="FSTD type" error={err('fstdType')} htmlFor="fs-type">
          <input id="fs-type" className="input" list="fstd-types" autoComplete="off" value={d.fstdType} onChange={(e) => setD({ ...d, fstdType: e.target.value })} />
        </Field>
        <datalist id="fstd-types">{fstdTypeSuggestions(data.fstd).map((t) => <option key={t} value={t} />)}</datalist>
        <Field label="Session time" error={err('totalMin')} warning={warn}><DurationField label="Session time" value={d.totalMin} onChange={(m) => setD({ ...d, totalMin: m })} /></Field>
        <Field label="Remarks" htmlFor="fs-rem"><textarea id="fs-rem" className="input" value={d.remarks} onChange={(e) => setD({ ...d, remarks: e.target.value })} /></Field>
      </div>
      {session && <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete session…</button>}
      {error && <div className="msg error" role="alert">Could not save: {error}</div>}
      <div className="actionbar">
        <button type="button" className="btn text" onClick={() => go({ name: 'fstd' }, { replace: true })}>Cancel</button>
        <button type="submit" className="btn filled" disabled={saving}>{saving ? 'Saving…' : session ? 'Save changes' : 'Save session'}</button>
      </div>
      {discardDialog}
      <Dialog open={confirmDelete} title="Delete this session?" onClose={() => setConfirmDelete(false)}
        actions={<><button type="button" className="btn text" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="btn danger" onClick={() => void remove()}>Delete</button></>}>
        This permanently removes the session from this device. It cannot be undone, except by restoring a backup.
      </Dialog>
    </form>
  );
}
