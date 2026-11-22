import type { LogbookDB } from '../../db/db';
import type { Airport } from '../../domain/types';
import { type ImportSummary, parseOurAirportsAsync } from '../../domain/airportImport';

export const OURAIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const CHUNK = 5000;

export type ImportPhase = 'download' | 'read' | 'save';

/**
 * Airports are reference data (not logbook data): they are never part of a backup and can be
 * re-imported at any time. Import only adds and updates, never deletes, and writes in chunks.
 * A parse failure happens before anything is written, so a bad file cannot damage what is there.
 */
export class AirportStore {
  constructor(private readonly db: LogbookDB) {}

  count(): Promise<number> {
    return this.db.airports.count();
  }

  async getMany(codes: string[]): Promise<Map<string, Airport>> {
    const keys = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
    const rows = await this.db.airports.bulkGet(keys);
    return new Map(rows.filter((r): r is Airport => r !== undefined).map((r) => [r.icao, r]));
  }

  async importCsv(text: string, onProgress?: (phase: ImportPhase, fraction: number) => void): Promise<ImportSummary> {
    const { airports, summary } = await parseOurAirportsAsync(text, (f) => onProgress?.('read', f));
    if (airports.length === 0) throw new Error('No usable airports were found in this file; nothing was imported.');
    for (let i = 0; i < airports.length; i += CHUNK) {
      await this.db.airports.bulkPut(airports.slice(i, i + CHUNK));
      onProgress?.('save', Math.min(1, (i + CHUNK) / airports.length));
    }
    return summary;
  }

  /** Download the public OurAirports file (about 13 MB). The only data sent is the request itself. */
  async download(onProgress?: (phase: ImportPhase, fraction: number) => void, fetchFn: typeof fetch = fetch): Promise<string> {
    const res = await fetchFn(OURAIRPORTS_URL);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body) return res.text();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      text += decoder.decode(value, { stream: true });
      if (total) onProgress?.('download', Math.min(1, received / total));
    }
    return text + decoder.decode();
  }
}
