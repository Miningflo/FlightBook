import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import { buildDocument } from '../../domain/pdfLayout';
import { decodeExperience, decodeFlights, decodeFstd, detectCsvKind, encodeExperience, encodeFlights, encodeFstd } from '../../domain/csvCodec';
import type { ImportBundle } from '../../domain/records';
import { type ImportPlan, planImport } from '../../domain/importPlan';
import { SnapshotError, base64ToBytes, parseSnapshot, serializeSnapshot, snapshotToBundle } from '../../domain/snapshot';
import { uuid } from '../../domain/id';
import { utcDateOf } from '../../domain/time';
import type { Attachment } from '../../domain/types';
import type { ImportExtras } from '../../db/importer';
import { Field } from '../../ui/components';
import { ImportDialog, type PendingImport } from './ImportDialog';
import type { PdfReport } from './pdfRender';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ExportScreen() {
  const { data, canEdit, updateSettings, portability } = useApp();
  const today = utcDateOf(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pdfReport, setPdfReport] = useState<PdfReport | null>(null);
  const [pilot, setPilot] = useState(data.settings.pilotName ?? '');
  const [pending, setPending] = useState<PendingImport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => ({
    flights: data.flights.length, fstd: data.fstd.length, experience: data.previousExperience.length,
    withAttachments: data.flights.filter((f) => f.attachmentIds.length > 0).length,
  }), [data]);

  const run = async (label: string, job: () => Promise<string | void>) => {
    setBusy(label); setNotice(null);
    try { const msg = await job(); if (msg) setNotice({ kind: 'ok', text: msg }); }
    catch (e) { setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  };

  const exportBackup = () => run('backup', async () => {
    const snap = await portability.snapshot();
    download(`flightbook-backup-${today}.json`, serializeSnapshot(snap), 'application/json');
    return `Backup saved: ${plural(snap.flights.length, 'flight')}, ${plural(snap.fstdSessions.length, 'simulator session')}, ${plural(snap.previousExperience.length, 'previous-experience record')}.`;
  });

  const exportCsv = (kind: 'flights' | 'fstd' | 'experience') => run(`csv-${kind}`, async () => {
    const b = await portability.readBundle();
    const text = kind === 'flights' ? encodeFlights(b.flights) : kind === 'fstd' ? encodeFstd(b.fstd) : encodeExperience(b.experience);
    download(`flightbook-${kind === 'fstd' ? 'simulator' : kind === 'experience' ? 'previous-experience' : 'flights'}-${today}.csv`, text, 'text/csv;charset=utf-8');
    const n = kind === 'flights' ? b.flights.length : kind === 'fstd' ? b.fstd.length : b.experience.length;
    return `Exported ${n} row${n === 1 ? '' : 's'}.${kind === 'flights' && counts.withAttachments > 0 ? ` ${counts.withAttachments} flight(s) have attachments, which CSV cannot hold; use the JSON backup for those.` : ''}`;
  });

  const makePdf = () => run('pdf', async () => {
    const name = pilot.trim();
    if (canEdit && name !== (data.settings.pilotName ?? '')) await updateSettings({ pilotName: name });
    const model = buildDocument({ flights: data.flights, persons: data.persons, fstd: data.fstd, experience: data.previousExperience, pilotName: name, generatedOn: today });
    // loaded on demand: pdf-lib is large and only needed when a PDF is created
    const { renderLogbookPdf } = await import('./pdfRender');
    const { bytes, report } = await renderLogbookPdf(model);
    setPdfReport(report);
    download(`flightbook-logbook-${today}.pdf`, bytes as BlobPart, 'application/pdf');
    return `PDF created: ${report.pages} page${report.pages === 1 ? '' : 's'}.`;
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run('read', async () => {
      const text = await file.text();
      const existing = await portability.readBundle();
      const now = Date.now();
      let bundle: ImportBundle = { flights: [], fstd: [], experience: [] };
      let extras: ImportExtras = {};
      const errors: { where: string; message: string }[] = [];
      let ignored: string[] = [];
      let kind: PendingImport['kind'];

      if (file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{')) {
        kind = 'backup';
        try {
          const snap = parseSnapshot(text);
          const { bundle: b, problems } = snapshotToBundle(snap);
          bundle = b;
          errors.push(...problems.map((p) => ({ where: p.record, message: p.message })));
          const attachments: Attachment[] = snap.attachments.map((a) => ({ id: a.id, flightId: a.flightId, mime: a.mime, name: a.name, createdAt: a.createdAt, updatedAt: a.updatedAt, blob: new Blob([base64ToBytes(a.data) as BlobPart], { type: a.mime }) }));
          extras = { attachments, settings: snap.settings };
        } catch (e) {
          throw e instanceof SnapshotError ? e : new Error('Could not read this file as a backup.');
        }
      } else {
        const detected = detectCsvKind(text);
        if (!detected) throw new Error('This CSV was not recognised. It must have the columns of a FlightBook flights, simulator or previous-experience export (see the README for the format).');
        kind = detected;
        const res = detected === 'flights' ? decodeFlights(text, uuid, now) : detected === 'fstd' ? decodeFstd(text, uuid, now) : decodeExperience(text, uuid, now);
        errors.push(...res.errors.map((e) => ({ where: `Row ${e.row}`, message: e.message })));
        ignored = res.ignoredColumns;
        const values = res.records.map((r) => r.value);
        bundle = { flights: detected === 'flights' ? (values as ImportBundle['flights']) : [], fstd: detected === 'fstd' ? (values as ImportBundle['fstd']) : [], experience: detected === 'experience' ? (values as ImportBundle['experience']) : [] };
      }
      const plan: ImportPlan = planImport(bundle, existing);
      setPending({ kind, fileName: file.name, plan, extras, errors, ignoredColumns: ignored });
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div>
      {notice && <div className={`banner${notice.kind === 'error' ? ' error' : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}

      <h2 className="section-label">Backup</h2>
      <div className="card">
        <div className="main">Full backup (JSON)</div>
        <p className="hint">Everything in the logbook: flights, simulator sessions, previous experience, aircraft, people and the pilot name and SEP expiry. It contains personal data; keep the file somewhere safe. Restoring it adds what is missing and never changes existing records unless you choose to.</p>
        <button type="button" className="btn tonal" disabled={busy !== null} onClick={() => void exportBackup()}>{busy === 'backup' ? 'Preparing…' : 'Download backup'}</button>
      </div>

      <h2 className="section-label">PDF logbook</h2>
      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>A4 landscape in the AMC1 FCL.050 column layout, with totals per page, totals brought forward (starting from your previous experience) and a signature and date line. Built from the records, not from the screens.</p>
        <Field label="Name printed on the pages" htmlFor="pilot-name"><input id="pilot-name" className="input" value={pilot} onChange={(e) => setPilot(e.target.value)} autoComplete="name" /></Field>
        <button type="button" className="btn filled" disabled={busy !== null} onClick={() => void makePdf()}>{busy === 'pdf' ? 'Creating…' : 'Create PDF'}</button>
        {pdfReport && (pdfReport.replacedCharacters > 0 || pdfReport.truncatedCells > 0) && (
          <div className="msg warning" role="status" style={{ marginTop: 12 }}>
            {pdfReport.replacedCharacters > 0 && <div>{pdfReport.replacedCharacters} character{pdfReport.replacedCharacters === 1 ? '' : 's'} are not in the PDF font and were replaced (accents removed, or "?").</div>}
            {pdfReport.truncatedCells > 0 && <div>{pdfReport.truncatedCells} entr{pdfReport.truncatedCells === 1 ? 'y was' : 'ies were'} too long for {pdfReport.truncatedCells === 1 ? 'its' : 'their'} cell and shortened. The full text is in the CSV and the backup.</div>}
          </div>
        )}
        <details className="rules"><summary><span className="chip unverified">Layout to verify</span><span>About the layout</span></summary>
          <ul>
            <li>The column set follows AMC1 FCL.050 from memory (<code>TODO(verify)</code> in <code>src/domain/pdfLayout.ts</code>). Compare it with the current AMC text or your paper logbook before using the printout officially.</li>
            <li>Simulator sessions are printed in a separate section after the flights.</li>
            <li>PICUS and SPIC flags appear in the remarks column. Landings are printed; take-offs are not.</li>
            <li>The built-in PDF font covers Latin letters only; other characters are replaced and counted above.</li>
          </ul>
        </details>
      </div>

      <h2 className="section-label">CSV</h2>
      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>For spreadsheets. Export and import round-trip exactly: durations are H:MM, times are UTC, and text starting with = + - @ is protected so a spreadsheet cannot run it as a formula.</p>
        <div className="row">
          <button type="button" className="btn outlined" disabled={busy !== null} onClick={() => void exportCsv('flights')}>Flights ({counts.flights})</button>
          <button type="button" className="btn outlined" disabled={busy !== null} onClick={() => void exportCsv('fstd')}>Simulator ({counts.fstd})</button>
          <button type="button" className="btn outlined" disabled={busy !== null} onClick={() => void exportCsv('experience')}>Previous experience ({counts.experience})</button>
        </div>
      </div>

      {canEdit && (
        <>
          <h2 className="section-label">Import and restore</h2>
          <div className="card">
            <p className="hint" style={{ marginTop: 0 }}>Choose a FlightBook CSV or a JSON backup. You see exactly what would happen first: what is new, what is already there, what conflicts. Nothing is written until you confirm, and it is all-or-nothing.</p>
            <button type="button" className="btn tonal" disabled={busy !== null} onClick={() => fileInput.current?.click()}>{busy === 'read' ? 'Reading…' : 'Choose file…'}</button>
            <input ref={fileInput} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
        </>
      )}

      {pending && <ImportDialog pending={pending} onClose={() => setPending(null)} onDone={(msg) => { setPending(null); setNotice({ kind: 'ok', text: msg }); }} />}
    </div>
  );
}
