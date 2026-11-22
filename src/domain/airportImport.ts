import type { Airport } from './types';
import { csvRows } from './csv';

/**
 * Reads the OurAirports `airports.csv` (https://ourairports.com/data/, public domain).
 * Columns are located by header name, never by position, so added or reordered
 * columns in future versions do not break the import.
 */

const REQUIRED = ['ident', 'name', 'latitude_deg', 'longitude_deg'] as const;
const CODE_RE = /^[A-Z0-9]{4}$/;

export interface ImportSummary {
  /** Rows in the file (excluding the header). */
  rows: number;
  /** Distinct airports with a usable 4-character code that were kept. */
  imported: number;
  skippedClosed: number;
  /** Rows with no usable 4-character ICAO/GPS code (many small fields and heliports). */
  skippedNoCode: number;
  skippedBadCoordinates: number;
}

export class AirportCsvError extends Error {}

export interface ParsedAirports {
  airports: Airport[];
  summary: ImportSummary;
}

/**
 * Incremental parser: yields a 0..1 progress fraction every few thousand rows and returns the
 * result, so callers can hand control back to the UI between steps.
 */
export function* parseOurAirportsSteps(text: string): Generator<number, ParsedAirports> {
  const rows = csvRows(text);
  const head = rows.next();
  if (head.done) throw new AirportCsvError('The file is empty.');
  const col = new Map(head.value.map((h, i) => [h.trim().toLowerCase(), i]));
  const missing = REQUIRED.filter((c) => !col.has(c));
  if (missing.length > 0) {
    throw new AirportCsvError(`This does not look like the OurAirports airports.csv (missing column: ${missing.join(', ')}).`);
  }
  const idx = {
    ident: col.get('ident')!, name: col.get('name')!, lat: col.get('latitude_deg')!, lon: col.get('longitude_deg')!,
    type: col.get('type'), icao: col.get('icao_code'), gps: col.get('gps_code'),
  };
  const get = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());

  const byCode = new Map<string, { airport: Airport; exact: boolean }>();
  const summary: ImportSummary = { rows: 0, imported: 0, skippedClosed: 0, skippedNoCode: 0, skippedBadCoordinates: 0 };
  const total = text.length;
  let consumed = 0;

  for (const r of rows) {
    summary.rows++;
    consumed += r.reduce((a, f) => a + f.length + 1, 0);
    if (summary.rows % 4000 === 0) yield Math.min(1, consumed / total);
    if (get(r, idx.type) === 'closed') { summary.skippedClosed++; continue; }

    const ident = get(r, idx.ident).toUpperCase();
    const code = [get(r, idx.icao), get(r, idx.gps), ident].map((c) => c.toUpperCase()).find((c) => CODE_RE.test(c));
    if (!code) { summary.skippedNoCode++; continue; }

    const latText = get(r, idx.lat), lonText = get(r, idx.lon);
    const lat = latText === '' ? NaN : Number(latText);
    const lon = lonText === '' ? NaN : Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      summary.skippedBadCoordinates++;
      continue;
    }
    const exact = ident === code;
    const prev = byCode.get(code);
    if (prev && (prev.exact || !exact)) continue;
    byCode.set(code, { airport: { icao: code, name: get(r, idx.name), lat, lon }, exact });
  }
  summary.imported = byCode.size;
  return { airports: [...byCode.values()].map((v) => v.airport), summary };
}

/**
 * Parse the CSV into airports keyed by 4-character code. The code is `icao_code`, else
 * `gps_code`, else `ident`. If several rows claim one code, the row whose `ident` is that code wins.
 */
export function parseOurAirports(text: string, onProgress?: (fraction: number) => void): ParsedAirports {
  const it = parseOurAirportsSteps(text);
  for (let step = it.next(); ; step = it.next()) {
    if (step.done) { onProgress?.(1); return step.value; }
    onProgress?.(step.value);
  }
}

/** Same result, but yields to the event loop between steps so the UI stays responsive. */
export async function parseOurAirportsAsync(text: string, onProgress?: (fraction: number) => void): Promise<ParsedAirports> {
  const it = parseOurAirportsSteps(text);
  for (let step = it.next(); ; step = it.next()) {
    if (step.done) { onProgress?.(1); return step.value; }
    onProgress?.(step.value);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}
