import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import type { ThemePreference } from '../../domain/types';
import { Dialog } from '../../ui/components';
import { AirportsCard } from './AirportsCard';
import { DriveCard } from '../drive/DriveCard';
import { MapColorCard } from './MapColorCard';
import { TakeOverDialog } from '../drive/TakeOverDialog';
import { ChevronIcon } from '../../ui/Icons';
import { persistenceStatus, requestPersistence, type PersistenceStatus } from '../../pwa/storage';

export function SettingsScreen() {
  const { data, updateSettings: update, onlinePhotos, go, drive } = useApp();
  const s = data.settings;
  const [persist, setPersist] = useState<PersistenceStatus>('unknown');
  const [confirmOff, setConfirmOff] = useState(false);
  const [name, setName] = useState(s.deviceName);
  const [takeOver, setTakeOver] = useState(false);
  const [masterNote, setMasterNote] = useState<string | null>(null);

  /**
   * Turning the master role ON. With Drive connected, first look at who holds the role and whether Drive has newer
   * data; only a clear situation (nobody is master, nothing newer elsewhere) proceeds without asking.
   */
  const requestMaster = async () => {
    setMasterNote(null);
    const becomeMaster = async () => { await update({ isMaster: true, setupDone: true }); void requestPersistence().then(setPersist); };
    if (!drive.state.configured || !drive.state.enabled) { await becomeMaster(); return; }
    try {
      const i = await drive.controller.inspectMaster(true);
      if (i.decision.kind === 'takeover' || i.staleness === 'other-device') { setTakeOver(true); return; }
      await becomeMaster();
      if (i.decision.kind === 'claim') { await drive.controller.claimMaster(); await drive.controller.backupNow(); }
    } catch (e) { setMasterNote(`Could not check Google Drive: ${e instanceof Error ? e.message : String(e)}`); }
  };

  useEffect(() => { void persistenceStatus().then(setPersist); }, []);

  return (
    <div>
      <div className="card">
        <label className="field" htmlFor="s-name">
          <span className="label">Device name</span>
          <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== s.deviceName && void update({ deviceName: name.trim() })} />
        </label>
        <label className="switch-row">
          <span>
            <span className="block">This device is the master logbook</span>
            <span className="hint block">Only the master can add or edit flights. Never inferred from screen size.</span>
          </span>
          <input type="checkbox" aria-label="This device is the master logbook" checked={s.isMaster}
            onChange={(e) => (e.target.checked ? void requestMaster() : setConfirmOff(true))} />
        </label>
        <p className="hint">Only one device should be the master. With Google Drive connected, taking the role from another device asks you to confirm first.</p>
        {masterNote && <div className="msg error" role="alert">{masterNote}</div>}
      </div>

      <div className="card">
        <label className="field" htmlFor="s-theme">
          <span className="label">Theme</span>
          <select id="s-theme" className="input" value={s.theme} onChange={(e) => void update({ theme: e.target.value as ThemePreference })}>
            <option value="system">Follow system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>

      <button type="button" className="card tappable link-card" onClick={() => go({ name: 'export' })}>
        <div><div className="main">Export, import &amp; backup</div><div className="hint">PDF logbook, CSV, full JSON backup, restore</div></div><ChevronIcon />
      </button>

      <MapColorCard />

      <DriveCard />

      <AirportsCard />

      <div className="card">
        <label className="switch-row">
          <span>
            <span className="block">Look up aircraft photos online</span>
            <span className="hint block">
              Looks for a photo of each registration on Planespotters.net, then Wikimedia Commons. Only the registration is sent,
              plus your IP address as with any website. Turn this off and every aircraft shows a plain placeholder.
            </span>
          </span>
          <input type="checkbox" aria-label="Look up aircraft photos online" checked={s.fetchAircraftPhotos}
            onChange={(e) => void update({ fetchAircraftPhotos: e.target.checked })} />
        </label>
        <button type="button" className="btn text" onClick={() => void onlinePhotos.clear().then(() => update({}))}>Clear photo cache</button>
      </div>

      <div className="card">
        <div>Storage protection</div>
        <p className="hint">
          {persist === 'granted' && 'Persistent storage is granted: the browser will not evict your logbook to free space.'}
          {persist === 'denied' && 'Persistent storage was not granted. The browser may clear data under storage pressure, so keep backups.'}
          {persist === 'unsupported' && 'This browser does not support persistent storage. Keep backups.'}
          {persist === 'unknown' && 'Checking…'}
        </p>
        {persist === 'denied' && s.isMaster && (
          <button type="button" className="btn tonal" onClick={() => void requestPersistence().then(setPersist)}>Ask again</button>
        )}
      </div>

      {takeOver && <TakeOverDialog onClose={() => setTakeOver(false)} onDone={() => setTakeOver(false)} />}

      <Dialog open={confirmOff} title="Stop being the master?" onClose={() => setConfirmOff(false)}
        actions={<>
          <button type="button" className="btn text" onClick={() => setConfirmOff(false)}>Keep as master</button>
          <button type="button" className="btn tonal" onClick={() => { setConfirmOff(false); void update({ isMaster: false }); }}>Make viewer</button>
        </>}>
        Editing will be disabled on this device. Your data stays on the device and nothing is deleted.
      </Dialog>
    </div>
  );
}

export function SetupScreen() {
  const { updateSettings } = useApp();
  const choose = async (isMaster: boolean) => {
    await updateSettings({ isMaster, setupDone: true });
    if (isMaster) await requestPersistence();
  };
  return (
    <div className="content">
      <div className="empty">
        <h2>Welcome to FlightBook</h2>
        <p>Is this device your master logbook? The master is the only device that can edit, and the only one that writes backups to Google Drive.</p>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <button type="button" className="btn filled" onClick={() => void choose(true)}>This device is the master logbook</button>
        <button type="button" className="btn outlined" onClick={() => void choose(false)}>Read-only viewer</button>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>You can change this later in Settings.</p>
    </div>
  );
}
