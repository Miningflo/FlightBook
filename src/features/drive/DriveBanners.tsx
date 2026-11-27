import { useState } from 'react';
import { useApp } from '../../AppContext';
import { errorText, formatWhen } from './format';
import { TakeOverDialog } from './TakeOverDialog';

/** Status strip above the content: the viewer's "read-only snapshot" banner, or the master's backup notices. */
export function DriveBanners({ hiddenRecords }: { hiddenRecords: number }) {
  const { drive, canEdit, updateSettings } = useApp();
  const { controller, state } = drive;
  const [takeOver, setTakeOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const tap = async (job: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await job(); } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); }
  };

  if (!state.configured) return null;

  if (!canEdit) {
    const v = state.viewer;
    if (!v.info) return null;
    return (
      <div className="banner viewer-banner" role="status">
        <div>
          <b>Read-only</b> — snapshot from {formatWhen(v.info.createdTime)}{v.info.deviceName ? `, ${v.info.deviceName}` : ''}
          {v.status === 'loading' && <span className="hint"> · refreshing…</span>}
        </div>
        <button type="button" className="btn text" disabled={v.status === 'loading' || busy} onClick={() => void tap(() => controller.refreshViewer(true))}>Refresh</button>
        {v.error && <div className="msg error" role="alert">{v.error} Showing the last good copy.</div>}
        {msg && <div className="msg error" role="alert">{msg}</div>}
        {hiddenRecords > 0 && <div className="msg warning">{hiddenRecords} item{hiddenRecords === 1 ? '' : 's'} in this snapshot could not be read and {hiddenRecords === 1 ? 'is' : 'are'} not shown.</div>}
      </div>
    );
  }

  const b = state.backup;
  if (b.status === 'pending-signin') {
    return (
      <div className="banner" role="status">
        <div>Your latest changes are not backed up yet. Google needs you to sign in again.</div>
        <button type="button" className="btn text" disabled={busy} onClick={() => void tap(() => controller.backupNow())}>Sign in and back up</button>
        {msg && <div className="msg error" role="alert">{msg}</div>}
      </div>
    );
  }
  if (b.status === 'not-master') {
    return (
      <>
        <div className="banner error" role="alert">
          <div><b>Backups are paused.</b> {b.otherMaster ? `${b.otherMaster.deviceName} has taken over as the master logbook.` : 'Another device is the master logbook.'} Changes you make here are not being backed up.</div>
          <div className="row">
            <button type="button" className="btn text" onClick={() => setTakeOver(true)}>Take over again…</button>
            <button type="button" className="btn text" onClick={() => void tap(async () => { await updateSettings({ isMaster: false }); })}>Make this device a viewer</button>
          </div>
          <div className="hint">Becoming a viewer keeps the data on this device; it just stops being the master.</div>
        </div>
        {takeOver && <TakeOverDialog onClose={() => setTakeOver(false)} onDone={() => setTakeOver(false)} />}
      </>
    );
  }
  if (b.status === 'offline') return <div className="banner" role="status">Backup is waiting for a connection.</div>;
  if (b.status === 'error') {
    return (
      <div className="banner error" role="alert">
        <div>Backup failed: {b.error}</div>
        <button type="button" className="btn text" disabled={busy} onClick={() => void tap(() => controller.backupNow())}>Try again</button>
      </div>
    );
  }
  return null;
}

/** Shown on a viewer that has no logbook loaded yet. */
export function ViewerGate() {
  const { drive, go } = useApp();
  const { controller, state } = drive;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tap = async (job: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await job(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (!state.configured) {
    return <div className="empty"><h2>Google Drive is not set up</h2><p>This is a read-only viewer, which loads the logbook from Google Drive, but this copy of the app was built without a Google client ID. See <code>docs/google-cloud-setup.md</code>.</p></div>;
  }
  const v = state.viewer;
  return (
    <div className="empty">
      <h2>{v.status === 'loading' ? 'Loading your logbook…' : v.status === 'empty' ? 'No backups yet' : v.status === 'offline' ? 'You are offline' : v.status === 'error' ? 'Could not load the logbook' : 'Read-only viewer'}</h2>
      {v.status === 'needs-signin' && <p>This device shows a read-only copy of your logbook from Google Drive. Connect your Google account to load it.</p>}
      {v.status === 'empty' && <p>There is no snapshot in Google Drive yet. On your master device, connect Google Drive and tap “Backup now”, then refresh here.</p>}
      {v.status === 'offline' && <p>Nothing has been downloaded to this device yet, and Google Drive cannot be reached.</p>}
      {v.status === 'error' && <p>{v.error}</p>}
      {error && <div className="msg error" role="alert">{error}</div>}
      <div style={{ display: 'grid', gap: 12, justifyContent: 'center', marginTop: 16 }}>
        {v.status === 'needs-signin' && <button type="button" className="btn filled" disabled={busy} onClick={() => void tap(async () => { await controller.connect(); await controller.refreshViewer(true); })}>{busy ? 'Connecting…' : 'Connect Google Drive'}</button>}
        {(v.status === 'empty' || v.status === 'offline' || v.status === 'error') && <button type="button" className="btn tonal" disabled={busy} onClick={() => void tap(() => controller.refreshViewer(true))}>Try again</button>}
        <button type="button" className="btn text" onClick={() => go({ name: 'settings' })}>Settings</button>
      </div>
    </div>
  );
}
