import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import type { SnapshotFileInfo } from '../../domain/driveRules';
import { planImport } from '../../domain/importPlan';
import { planReplace, type ReplacePlan } from '../../domain/replacePlan';
import { type Snapshot, snapshotToBundle } from '../../domain/snapshot';
import { ImportDialog, type PendingImport } from '../export/ImportDialog';
import { errorText, formatSize, formatWhen } from './format';

type Step = { kind: 'list' } | { kind: 'preview'; info: SnapshotFileInfo; snapshot: Snapshot; plan: ReplacePlan; problems: string[] };

/** Restore from a Drive snapshot (master only): pick one, see exactly what would change, then confirm. */
export function RestoreDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const { drive, portability, reload } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<SnapshotFileInfo[] | null>(null);
  const [copies, setCopies] = useState<SnapshotFileInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [merge, setMerge] = useState<PendingImport | null>(null);
  const [ack, setAck] = useState(false);

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let live = true;
    Promise.all([drive.controller.listSnapshots(), drive.controller.listSafetyCopies()])
      .then(([l, c]) => { if (live) { setFiles(l); setCopies(c); setSelected(l[0]?.id ?? c[0]?.id ?? null); } })
      .catch((e) => live && setError(errorText(e)));
    return () => { live = false; };
  }, [drive.controller]);

  const preview = async () => {
    const info = [...(files ?? []), ...copies].find((f) => f.id === selected);
    if (!info) return;
    setBusy('preview'); setError(null);
    try {
      const snapshot = await drive.controller.downloadSnapshot(info.id);
      const { bundle, problems } = snapshotToBundle(snapshot);
      setStep({ kind: 'preview', info, snapshot, plan: planReplace(bundle, await portability.readBundle()), problems: problems.map((p) => `${p.record}: ${p.message}`) });
      setAck(false);
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };

  const replace = async () => {
    if (step.kind !== 'preview') return;
    setBusy('replace'); setError(null);
    try {
      const copy = await drive.controller.saveSafetyCopy(); // never replace without a copy of what is here now
      await portability.replace(step.snapshot);
      await reload();
      onDone(`Restored the snapshot from ${formatWhen(step.info.createdTime)}. What was on this device before is saved in Google Drive as ${copy.name}.`);
    } catch (e) { setError(`Nothing was replaced. ${errorText(e)}`); setBusy(null); }
  };

  const addMissing = async () => {
    if (step.kind !== 'preview') return;
    const { bundle, problems } = snapshotToBundle(step.snapshot);
    setMerge({
      kind: 'backup', fileName: step.info.name, plan: planImport(bundle, await portability.readBundle()),
      extras: { settings: step.snapshot.settings }, errors: problems.map((p) => ({ where: p.record, message: p.message })), ignoredColumns: [],
    });
  };

  const d = (n: number, one: string, many: string) => (n > 0 ? <li>{n} {n === 1 ? one : many}</li> : null);

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} style={{ maxWidth: 'min(94vw, 520px)' }}>
      <h2>Restore from Google Drive</h2>
      {step.kind === 'list' && (
        <>
          {!files && !error && <p className="hint">Loading snapshots…</p>}
          {files && files.length === 0 && copies.length === 0 && <p>There are no snapshots in Google Drive yet.</p>}
          {files && files.map((f) => (
            <label key={f.id} className="switch-row">
              <span><div>{formatWhen(f.createdTime)}</div><div className="hint">{f.deviceName ?? 'unknown device'}{f.size ? ` · ${formatSize(f.size)}` : ''}</div></span>
              <input type="radio" name="snap" checked={selected === f.id} onChange={() => setSelected(f.id)} />
            </label>
          ))}
          {copies.length > 0 && (
            <details className="rules">
              <summary><span>Undo a restore: {copies.length} safety cop{copies.length === 1 ? 'y' : 'ies'}</span></summary>
              <p className="hint">Each one is what was on this device just before a "replace everything" restore. Restoring one puts that logbook back.</p>
              {copies.map((f) => (
                <label key={f.id} className="switch-row">
                  <span><div>Before the restore of {formatWhen(f.createdTime)}</div><div className="hint">{f.deviceName ?? 'unknown device'}{f.size ? ` · ${formatSize(f.size)}` : ''}</div></span>
                  <input type="radio" name="snap" checked={selected === f.id} onChange={() => setSelected(f.id)} />
                </label>
              ))}
            </details>
          )}
        </>
      )}
      {step.kind === 'preview' && (
        <>
          <p>{copies.some((c) => c.id === step.info.id) ? 'Safety copy' : 'Snapshot'} from <b>{formatWhen(step.info.createdTime)}</b>, written by {step.info.deviceName ?? 'an unknown device'}.</p>
          {step.problems.length > 0 && <div className="msg error" role="alert">This snapshot has records that cannot be restored, so it cannot replace your logbook:<ul>{step.problems.slice(0, 4).map((p) => <li key={p}>{p}</li>)}</ul></div>}
          <div className="sub-form">
            <div className="main">If you replace everything on this device</div>
            <ul className="hint">
              {d(step.plan.flights.added + step.plan.fstd.added + step.plan.experience.added, 'record will be added', 'records will be added')}
              {d(step.plan.flights.changed + step.plan.fstd.changed + step.plan.experience.changed, 'record will be changed back to the snapshot version', 'records will be changed back to the snapshot version')}
              {d(step.plan.flights.removed + step.plan.fstd.removed + step.plan.experience.removed, 'record on this device is NOT in the snapshot and will be removed', 'records on this device are NOT in the snapshot and will be removed')}
              {!step.plan.destructive && step.plan.flights.added + step.plan.fstd.added + step.plan.experience.added === 0 && <li>nothing would change</li>}
            </ul>
            <p className="hint">Flights: +{step.plan.flights.added} / changed {step.plan.flights.changed} / removed {step.plan.flights.removed} · Simulator: +{step.plan.fstd.added} / {step.plan.fstd.changed} / −{step.plan.fstd.removed} · Previous experience: +{step.plan.experience.added} / {step.plan.experience.changed} / −{step.plan.experience.removed}</p>
            <p className="hint">Before anything is replaced, a copy of what is on this device is saved to Google Drive.</p>
            {step.plan.destructive && <label className="switch-row"><span>I understand records may be removed or changed</span><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /></label>}
          </div>
        </>
      )}
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {step.kind === 'list' && <button type="button" className="btn filled" disabled={!selected || !!busy} onClick={() => void preview()}>{busy === 'preview' ? 'Reading…' : 'Preview'}</button>}
        {step.kind === 'preview' && (
          <>
            <button type="button" className="btn filled" disabled={!!busy || step.problems.length > 0 || (step.plan.destructive && !ack)} onClick={() => void replace()}>{busy === 'replace' ? 'Restoring…' : 'Replace everything with this snapshot'}</button>
            <button type="button" className="btn tonal" disabled={!!busy} onClick={() => void addMissing()}>Only add what is missing (keeps everything here)</button>
            <button type="button" className="btn text" disabled={!!busy} onClick={() => setStep({ kind: 'list' })}>Back</button>
          </>
        )}
        <button type="button" className="btn text" disabled={!!busy} onClick={onClose}>Cancel</button>
      </div>
      {merge && <ImportDialog pending={merge} onClose={() => setMerge(null)} onDone={(m) => { setMerge(null); onDone(m); }} />}
    </dialog>
  );
}
