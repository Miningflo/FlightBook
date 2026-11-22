import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import type { ImportSummary } from '../../domain/airportImport';
import type { ImportPhase } from '../airports/airportStore';

const PHASE_LABEL: Record<ImportPhase, string> = { download: 'Downloading', read: 'Reading airports', save: 'Saving' };

/** Import of the OurAirports data, needed to compute night time. */
export function AirportsCard() {
  const { airports, data, updateSettings } = useApp();
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: ImportPhase; fraction: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { void airports.count().then(setCount); }, [airports]);

  const run = async (getText: () => Promise<string>) => {
    setBusy(true); setError(null); setDone(null); setConfirmDownload(false);
    try {
      const text = await getText();
      const summary = await airports.importCsv(text, (phase, fraction) => setProgress({ phase, fraction }));
      setDone(summary);
      await updateSettings({ airportsImportedAt: Date.now() });
      setCount(await airports.count());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); setProgress(null);
      if (file.current) file.current.value = '';
    }
  };

  const imported = data.settings.airportsImportedAt;
  return (
    <div className="card">
      <div>Airports database</div>
      <p className="hint">
        Needed to compute night time and day/night take-offs and landings from the sun's position. Data: OurAirports (public domain).
        Only 4-character ICAO/GPS codes are kept. This is reference data, so it is not part of backups; you can re-import it at any time.
      </p>
      <p>
        {count === null ? 'Checking…' : count === 0 ? 'No airports imported yet.' : `${count.toLocaleString()} airports`}
        {imported ? <span className="hint"> · updated {new Date(imported).toLocaleDateString('en-GB')}</span> : null}
      </p>
      <div className="row">
        <button type="button" className="btn tonal" disabled={busy || !navigator.onLine} onClick={() => setConfirmDownload(true)}>
          {count ? 'Update from OurAirports' : 'Download from OurAirports'}
        </button>
        <button type="button" className="btn outlined" disabled={busy} onClick={() => file.current?.click()}>Choose CSV file…</button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(() => f.text()); }} />
      </div>
      {confirmDownload && (
        <div className="override-note" style={{ marginTop: 12 }}>
          <span className="hint">This downloads about 13 MB. Continue on this connection?</span>
          <button type="button" className="btn text" onClick={() => void run(() => airports.download((phase, fraction) => setProgress({ phase, fraction })))}>Download</button>
          <button type="button" className="btn text" onClick={() => setConfirmDownload(false)}>Cancel</button>
        </div>
      )}
      {progress && (
        <div style={{ marginTop: 12 }} role="status">
          <div className="hint">{PHASE_LABEL[progress.phase]}… {Math.round(progress.fraction * 100)}%</div>
          <progress className="progress" value={progress.fraction} max={1} />
        </div>
      )}
      {busy && !progress && <p className="hint" role="status">Starting…</p>}
      {done && (
        <p className="hint" role="status">
          Imported {done.imported.toLocaleString()} airports. Skipped: {done.skippedNoCode.toLocaleString()} without a 4-character code,{' '}
          {done.skippedClosed.toLocaleString()} closed, {done.skippedBadCoordinates.toLocaleString()} with unusable coordinates.
        </p>
      )}
      {error && <div className="msg error" role="alert">{error} Nothing was changed.</div>}
    </div>
  );
}
