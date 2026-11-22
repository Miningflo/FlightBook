import { useState } from 'react';
import { useApp } from '../../AppContext';
import { errorText, formatWhen } from './format';
import { RestoreDialog } from './RestoreDialog';

const STATUS_TEXT = {
  idle: 'Up to date', scheduled: 'A backup will run shortly', running: 'Backing up…', 'pending-signin': 'Waiting for you to sign in',
  offline: 'Waiting for a connection', 'not-master': 'Paused: another device is the master', error: 'The last backup failed',
} as const;

/** Settings card for Google Drive: connect, back up (master), restore (master), refresh (viewer). */
export function DriveCard() {
  const { drive, canEdit, data } = useApp();
  const { controller, state } = drive;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restore, setRestore] = useState(false);

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label); setError(null); setNotice(null);
    try { await job(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };

  if (!state.configured) {
    return (
      <div className="card">
        <div>Google Drive backup</div>
        <p className="hint">This copy of the app was built without a Google client ID, so Drive backup and the read-only viewer are switched off. Everything else works. To enable it, follow <code>docs/google-cloud-setup.md</code> in the project.</p>
      </div>
    );
  }
  const b = state.backup;
  return (
    <div className="card">
      <div>Google Drive</div>
      <p className="hint">
        {canEdit
          ? 'The master logbook writes a snapshot to a “Logbook backups” folder in your Drive: after you save changes, when the app opens if the last backup is over a day old, and on demand. The latest 30 are kept. The app can only see files it created itself.'
          : 'This device is a read-only viewer. It loads the newest snapshot from your Drive and never writes to it.'}
      </p>
      {!state.enabled ? (
        <button type="button" className="btn filled" disabled={!!busy} onClick={() => void run('connect', async () => { await controller.connect(); if (!canEdit) await controller.refreshViewer(true); })}>{busy === 'connect' ? 'Connecting…' : 'Connect Google Drive'}</button>
      ) : canEdit ? (
        <>
          <p>{b.lastBackupAt ? <>Last backup: <b>{formatWhen(b.lastBackupAt)}</b></> : 'No backup has been made from this device yet.'}</p>
          <p className="hint" role="status">{STATUS_TEXT[b.status]}{b.status === 'error' && b.error ? `: ${b.error}` : ''}{b.status === 'not-master' && b.otherMaster ? ` (${b.otherMaster.deviceName})` : ''}</p>
          {b.warnings.length > 0 && <div className="msg warning">{b.warnings[0]}</div>}
          <div className="row">
            <button type="button" className="btn tonal" disabled={!!busy || b.status === 'running'} onClick={() => void run('backup', async () => { await controller.backupNow(); const st = controller.getState().backup; if (st.status === 'idle') setNotice('Backup complete.'); })}>{b.status === 'running' ? 'Backing up…' : 'Backup now'}</button>
            <button type="button" className="btn outlined" disabled={!!busy} onClick={() => setRestore(true)}>Restore from a snapshot…</button>
          </div>
        </>
      ) : (
        <>
          {state.viewer.info ? <p>Showing the snapshot from <b>{formatWhen(state.viewer.info.createdTime)}</b>{state.viewer.info.deviceName ? ` (${state.viewer.info.deviceName})` : ''}.</p> : <p className="hint">No snapshot loaded yet.</p>}
          {state.viewer.master && <p className="hint">Master device: {state.viewer.master.deviceName}</p>}
          <div className="row"><button type="button" className="btn tonal" disabled={!!busy || state.viewer.status === 'loading'} onClick={() => void run('refresh', () => controller.refreshViewer(true))}>Refresh</button></div>
        </>
      )}
      {state.enabled && <button type="button" className="btn text" style={{ marginTop: 8 }} disabled={!!busy} onClick={() => void run('disconnect', () => controller.disconnect())}>Disconnect Google Drive</button>}
      {notice && <div className="msg hint" role="status">{notice}</div>}
      {error && <div className="msg error" role="alert">{error}</div>}
      <p className="hint">Device: {data.settings.deviceName}</p>
      {restore && <RestoreDialog onClose={() => setRestore(false)} onDone={(m) => { setRestore(false); setNotice(m); }} />}
    </div>
  );
}
