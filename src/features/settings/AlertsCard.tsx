import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { alertSupport, requestAlertPermission, seedAlerts, setBackgroundCheck, showNotification, type AlertSupport } from '../../pwa/alerts';

export function AlertsCard() {
  const { data, updateSettings: update } = useApp();
  const s = data.settings;
  const enabled = s.alerts?.enabled ?? false;
  const night = s.alerts?.night ?? true;
  const [support, setSupport] = useState<AlertSupport>(alertSupport());
  const [background, setBackground] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // after a reload, say whether the daily background check is registered
  useEffect(() => {
    if (!enabled) { setBackground(null); return; }
    void setBackgroundCheck(true).then(setBackground);
  }, [enabled]);

  const turnOn = async () => {
    setNote(null);
    const permission = await requestAlertPermission();
    setSupport(permission);
    if (permission !== 'granted') {
      setNote(permission === 'unsupported' ? 'This browser cannot show notifications.' : 'Notifications are blocked. Allow them for FlightBook in your browser or phone settings, then try again.');
      return;
    }
    await update({ alerts: { enabled: true, night } });
    await seedAlerts(); // remember today's state so only later changes notify
  };
  const turnOff = async () => {
    await update({ alerts: { enabled: false, night } });
    await setBackgroundCheck(false);
    setBackground(null);
  };

  return (
    <div className="card">
      <label className="switch-row">
        <span>
          <span className="block">Alerts for currency and ratings</span>
          <span className="hint block">
            A notification when a currency or class rating gets worse: turns amber, red or expires. Each change notifies once.
          </span>
        </span>
        <input type="checkbox" aria-label="Alerts for currency and ratings" checked={enabled} disabled={!s.isMaster || support === 'unsupported'}
          onChange={(e) => (e.target.checked ? void turnOn() : void turnOff())} />
      </label>
      {!s.isMaster && <p className="hint">Alerts are checked on the master device, which holds the logbook.</p>}
      {support === 'unsupported' && <p className="hint">This browser cannot show notifications. On iPhone, add FlightBook to the Home Screen first.</p>}
      {note && <div className="msg error" role="alert">{note}</div>}
      {enabled && (
        <>
          <label className="switch-row">
            <span>
              <span className="block">Include night currency</span>
              <span className="hint block">Turn this off if you hold an instrument rating: it is exempt from the night requirement.</span>
            </span>
            <input type="checkbox" aria-label="Include night currency" checked={night} onChange={(e) => void update({ alerts: { enabled: true, night: e.target.checked } })} />
          </label>
          <p className="hint">
            Checked every time you open the app.{' '}
            {background === true && 'The installed app is also checked about once a day in the background.'}
            {background === false && 'Background checks are not available here (they need the installed app in Chrome on Android), so you only get alerts when you open FlightBook.'}
          </p>
          {support === 'granted' && (
            <button type="button" className="btn text" onClick={() => void showNotification({ key: 'test', level: 'amber', title: 'FlightBook alerts are on', body: 'This is a test notification.' })}>Send a test notification</button>
          )}
        </>
      )}
    </div>
  );
}
