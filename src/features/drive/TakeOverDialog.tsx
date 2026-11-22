import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import type { MasterInspection } from '../../drive/backupService';
import { applyReplace } from '../../db/importer';
import { db } from '../../driveRuntime';
import { errorText, formatWhen } from './format';

/**
 * Becoming the master when someone else is, or when Drive holds newer data than this device has.
 * Nothing is changed until the user picks an explicit option. If Drive has a newer snapshot from another
 * device, restoring it first is the recommended option, because taking over with older data would make the
 * older data the newest snapshot.
 */
export function TakeOverDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const { drive, updateSettings, reload } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [inspection, setInspection] = useState<MasterInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const wasMaster = useRef<boolean | null>(null);

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let live = true;
    drive.controller.inspectMaster(true).then((i) => live && setInspection(i)).catch((e) => live && setError(errorText(e)));
    return () => { live = false; };
  }, [drive.controller]);

  const stale = inspection?.staleness === 'other-device' && inspection.newest !== null;
  const other = inspection?.decision.kind === 'takeover' && inspection.decision.reason === 'other-device' ? inspection.decision.current : null;

  const run = async (label: string, restoreFirst: boolean) => {
    setWorking(label); setError(null);
    try {
      // From here this device acts as the master (its own role is set first so the master-only steps are allowed).
      wasMaster.current = drive.state.enabled; // (kept for the message only)
      await updateSettings({ isMaster: true, setupDone: true });
      if (restoreFirst && inspection?.newest) {
        const c = drive.controller;
        await c.saveSafetyCopy(); // a copy of what is on this device, kept in Drive, before anything is replaced
        await applyReplace(db, await c.downloadSnapshot(inspection.newest.id));
        await reload();
      }
      await drive.controller.claimMaster();
      await drive.controller.backupNow();
      onDone(restoreFirst ? 'Restored the newest snapshot and took over as master.' : 'This device is now the master logbook.');
    } catch (e) {
      setError(`${errorText(e)} ${restoreFirst ? 'Your data was not replaced unless it says so above.' : ''}`.trim());
      setWorking(null);
    }
  };

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} style={{ maxWidth: 'min(94vw, 520px)' }}>
      <h2>Take over as master?</h2>
      {!inspection && !error && <p className="hint">Checking Google Drive…</p>}
      {inspection && (
        <>
          {other && (
            <p><b>{other.deviceName}</b> is the master logbook (since {formatWhen(other.claimedAt)}). If you take over, it will no longer be able to back up and will have to become a viewer.</p>
          )}
          {inspection.decision.kind === 'takeover' && inspection.decision.reason === 'unreadable' && <p>The master record in Google Drive could not be read, so it is unclear which device is the master.</p>}
          {stale && (
            <div className="banner error" role="alert">
              Google Drive has a newer snapshot from <b>{inspection.newest!.deviceName ?? 'another device'}</b> ({formatWhen(inspection.newest!.createdTime)}). This device's data may be behind it.
              Taking over with older data would make the older data the newest backup.
            </div>
          )}
          {!stale && <p className="hint">Nothing in Google Drive is newer than this device's own backups.</p>}
        </>
      )}
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {stale && <button type="button" className="btn filled" disabled={!!working} onClick={() => void run('restore', true)}>
          {working === 'restore' ? 'Restoring…' : 'Restore the newest snapshot, then take over (recommended)'}</button>}
        {stale && (
          <label className="switch-row"><span className="hint">I understand that newer changes made elsewhere may be buried</span><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /></label>
        )}
        <button type="button" className={stale ? 'btn tonal' : 'btn filled'} disabled={!!working || !inspection || (stale && !ack)} onClick={() => void run('takeover', false)}>
          {working === 'takeover' ? 'Taking over…' : 'Take over with the data on this device'}</button>
        <button type="button" className="btn text" disabled={!!working} onClick={onClose}>Cancel</button>
      </div>
    </dialog>
  );
}
