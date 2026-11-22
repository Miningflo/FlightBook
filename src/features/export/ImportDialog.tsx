import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import type { ImportExtras } from '../../db/importer';
import { type ConflictPolicy, type ImportPlan, type KindPlan, countKind, writeCount } from '../../domain/importPlan';

export interface PendingImport {
  kind: 'flights' | 'fstd' | 'experience' | 'backup';
  fileName: string;
  plan: ImportPlan;
  extras: ImportExtras;
  errors: { where: string; message: string }[];
  ignoredColumns: string[];
}

const KIND_LABEL = { flights: 'Flights', fstd: 'Simulator sessions', experience: 'Previous experience' } as const;

/** Fields that differ between two versions of a record, for the conflict list. */
function differing(a: object, b: object): string[] {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  return Object.keys(x).filter((k) => !['id', 'createdAt', 'updatedAt'].includes(k) && JSON.stringify(x[k]) !== JSON.stringify(y[k]));
}

function KindSummary({ label, plan }: { label: string; plan: KindPlan<{ id: string }> }) {
  const c = countKind(plan);
  if (c.added + c.identical + c.conflicts + c.duplicates === 0) return null;
  return (
    <div className="class-row">
      <div>
        <div className="name">{label}</div>
        <div className="sub">
          {[
            c.identical > 0 && `${c.identical} already there`,
            c.duplicates > 0 && `${c.duplicates} duplicate${c.duplicates === 1 ? '' : 's'} skipped`,
            c.conflicts > 0 && `${c.conflicts} conflict${c.conflicts === 1 ? '' : 's'}`,
          ].filter(Boolean).join(' · ') || 'nothing else'}
        </div>
      </div>
      <div className="val">{c.added} new</div>
    </div>
  );
}

export function ImportDialog({ pending, onClose, onDone }: { pending: PendingImport; onClose: () => void; onDone: (message: string) => void }) {
  const { portability, reload } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [policy, setPolicy] = useState<ConflictPolicy>('skip');
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { ref.current?.showModal(); }, []);

  const { plan, errors } = pending;
  const writes = writeCount(plan, policy);
  const conflicts = plan.flights.conflicts.length + plan.fstd.conflicts.length + plan.experience.conflicts.length;
  const blocked = errors.length > 0 && !skipInvalid;
  const sample = [...plan.flights.conflicts.map((c) => ({ label: `Flight ${c.incoming.date} ${c.incoming.registration}`, a: c.existing, b: c.incoming })),
    ...plan.fstd.conflicts.map((c) => ({ label: `Simulator ${c.incoming.date}`, a: c.existing, b: c.incoming })),
    ...plan.experience.conflicts.map((c) => ({ label: `Experience "${c.incoming.source}"`, a: c.existing, b: c.incoming }))].slice(0, 4);

  const apply = async () => {
    setWorking(true); setError(null);
    try {
      const r = await portability.apply(plan, policy, pending.extras);
      await reload();
      const added = r.written.flights + r.written.fstd + r.written.experience;
      const replaced = r.replaced.flights + r.replaced.fstd + r.replaced.experience;
      onDone(`Imported ${added} new record${added === 1 ? '' : 's'}${replaced > 0 ? `, replaced ${replaced}` : ''}. Nothing else was changed.`);
    } catch (e) {
      setError(`Nothing was imported (the whole import was cancelled): ${e instanceof Error ? e.message : String(e)}`);
      setWorking(false);
    }
  };

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} style={{ maxWidth: 'min(94vw, 520px)' }}>
      <h2>{pending.kind === 'backup' ? 'Restore from backup' : 'Import CSV'}</h2>
      <div className="hint" style={{ marginBottom: 8 }}>{pending.fileName}</div>
      <KindSummary label={KIND_LABEL.flights} plan={plan.flights} />
      <KindSummary label={KIND_LABEL.fstd} plan={plan.fstd} />
      <KindSummary label={KIND_LABEL.experience} plan={plan.experience} />
      {writes === 0 && conflicts === 0 && errors.length === 0 && <p>Everything in this file is already in your logbook. Nothing to import.</p>}

      {conflicts > 0 && (
        <div className="sub-form">
          <div className="main">Conflicts: the same record exists with different content</div>
          {sample.map((s) => <div key={s.label} className="hint">{s.label}: differs in {differing(s.a, s.b).join(', ')}</div>)}
          {conflicts > sample.length && <div className="hint">…and {conflicts - sample.length} more</div>}
          <label className="switch-row"><span>Keep my version (recommended)</span><input type="radio" name="policy" checked={policy === 'skip'} onChange={() => setPolicy('skip')} /></label>
          <label className="switch-row"><span>Replace with the imported version</span><input type="radio" name="policy" checked={policy === 'replace'} onChange={() => setPolicy('replace')} /></label>
        </div>
      )}

      {errors.length > 0 && (
        <div className="sub-form">
          <div className="msg error" role="alert">{errors.length} problem{errors.length === 1 ? '' : 's'} found; those records will not be imported.</div>
          {errors.slice(0, 6).map((e, i) => <div key={i} className="hint"><b>{e.where}:</b> {e.message}</div>)}
          {errors.length > 6 && <div className="hint">…and {errors.length - 6} more</div>}
          <label className="switch-row"><span>Import the valid records and skip these</span><input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} /></label>
        </div>
      )}
      {pending.ignoredColumns.length > 0 && <p className="hint">Columns not used by this app and ignored: {pending.ignoredColumns.join(', ')}</p>}
      {error && <div className="msg error" role="alert">{error}</div>}

      <div className="actions">
        <button type="button" className="btn text" onClick={onClose} disabled={working}>Cancel</button>
        <button type="button" className="btn filled" disabled={working || blocked || (writes === 0 && !pending.extras.settings)} onClick={() => void apply()}>
          {working ? 'Importing…' : writes === 0 ? 'Nothing to import' : `Import ${writes} record${writes === 1 ? '' : 's'}`}
        </button>
      </div>
    </dialog>
  );
}
