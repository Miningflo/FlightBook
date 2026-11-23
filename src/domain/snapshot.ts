import type { Aircraft, ClassRating, Flight, FstdSession, IsoDate, Person, PreviousExperience } from './types';
import { type FlightImport, type ImportBundle, toFlightImport, validateFlightImport } from './records';
import { validateExperience } from './experience';
import { validateFstd } from './fstd';

/**
 * Full JSON backup ("snapshot") of the logbook. It carries a schema version so that older
 * backups can be migrated in memory when loaded (used by restore now and by the read-only viewer in phase 5).
 *
 * Included: flights, aircraft, people, simulator sessions, previous experience, attachments, and the two
 * settings that belong to the logbook (pilot name, SEP expiry). Not included: the airports database and the
 * photo cache (re-creatable reference data) and device-specific settings (device name, master role, theme).
 */

/** Bump together with a new entry in MIGRATIONS whenever the snapshot layout changes. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotAttachment {
  id: string;
  flightId: string;
  mime: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Base64 of the file contents. */
  data: string;
}

export interface Snapshot {
  app: 'flightbook';
  schemaVersion: number;
  exportedAt: string;
  /** Device that wrote the snapshot (optional: older snapshots do not have it). */
  deviceId?: string;
  deviceName: string;
  settings: { pilotName?: string; licenceNumber?: string; address?: string; sepLandExpiry?: IsoDate | null; classExpiry?: Partial<Record<ClassRating, IsoDate>>; irExpiry?: IsoDate | null };
  aircraft: Aircraft[];
  persons: Person[];
  flights: Flight[];
  fstdSessions: FstdSession[];
  previousExperience: PreviousExperience[];
  attachments: SnapshotAttachment[];
}

export class SnapshotError extends Error {}

export function buildSnapshot(input: Omit<Snapshot, 'app' | 'schemaVersion'>): Snapshot {
  return { app: 'flightbook', schemaVersion: SNAPSHOT_SCHEMA_VERSION, ...input };
}

export const serializeSnapshot = (s: Snapshot): string => `${JSON.stringify(s)}\n`;

/** Migrations from version N to N+1, applied in order on the raw parsed object. None needed yet (v1 is the first). */
export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

const ARRAYS = ['aircraft', 'persons', 'flights', 'fstdSessions', 'previousExperience', 'attachments'] as const;

/**
 * Parse and migrate a backup. Throws SnapshotError for anything that is not a usable backup
 * (not JSON, not ours, from a newer app version, wrong shape). Record-level problems are NOT thrown here:
 * see snapshotToBundle, which reports them so the user can decide.
 */
export function parseSnapshot(
  text: string,
  opts: { current?: number; migrations?: typeof MIGRATIONS } = {},
): Snapshot {
  const current = opts.current ?? SNAPSHOT_SCHEMA_VERSION;
  const migrations = opts.migrations ?? MIGRATIONS;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('This file is not valid JSON.'); }
  if (!raw || typeof raw !== 'object' || (raw as { app?: unknown }).app !== 'flightbook') throw new SnapshotError('This is not a FlightBook backup file.');
  let obj = raw as Record<string, unknown>;
  const version = obj.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new SnapshotError('The backup has no valid schema version.');
  if (version > current) throw new SnapshotError(`This backup was made by a newer version of FlightBook (schema ${version}; this app understands up to ${current}). Update the app to restore it.`);
  for (let v = version; v < current; v++) {
    const step = migrations[v];
    if (!step) throw new SnapshotError(`No migration from backup schema ${v}.`);
    obj = { ...step(obj), schemaVersion: v + 1 };
  }
  for (const k of ARRAYS) if (!Array.isArray(obj[k])) throw new SnapshotError(`The backup is missing its "${k}" list.`);
  if (typeof obj.exportedAt !== 'string') obj.exportedAt = '';
  if (typeof obj.deviceName !== 'string') obj.deviceName = '';
  if (!obj.settings || typeof obj.settings !== 'object') obj.settings = {};
  return obj as unknown as Snapshot;
}

export interface SnapshotProblem {
  record: string;
  message: string;
}

/** Records of a snapshot as an import bundle, plus every record-level problem found. */
export function snapshotToBundle(s: Snapshot): { bundle: ImportBundle; problems: SnapshotProblem[] } {
  const problems: SnapshotProblem[] = [];
  const flights: FlightImport[] = [];
  const personIds = new Set(s.persons.map((p) => p.id));
  for (const f of s.flights) {
    const label = `flight ${f.date ?? '?'} ${f.registration ?? ''}`.trim();
    if (!personIds.has(f.picNameId)) { problems.push({ record: label, message: 'its PIC record is missing from the backup' }); continue; }
    const imp = toFlightImport(f, s.persons);
    const bad = validateFlightImport(imp);
    if (bad.length > 0) problems.push({ record: label, message: bad.join('; ') });
    else flights.push(imp);
  }
  const fstd = s.fstdSessions.filter((x) => {
    const bad = validateFstd(x).filter((i) => i.severity === 'error');
    if (bad.length > 0) problems.push({ record: `simulator session ${x.date}`, message: bad.map((i) => i.message).join('; ') });
    return bad.length === 0;
  });
  const experience = s.previousExperience.filter((x) => {
    const bad = validateExperience(x).filter((i) => i.severity === 'error');
    if (bad.length > 0) problems.push({ record: `previous experience "${x.source}"`, message: bad.map((i) => i.message).join('; ') });
    return bad.length === 0;
  });
  return { bundle: { flights, fstd, experience }, problems };
}

/**
 * The records of a snapshot that are safe to show (a viewer displays them directly). Invalid records are
 * left out and COUNTED, so the screen can say that some were hidden instead of silently showing less.
 */
export function snapshotRecords(s: Snapshot): { flights: Flight[]; fstd: FstdSession[]; experience: PreviousExperience[]; hidden: number } {
  const { bundle } = snapshotToBundle(s);
  const okFlights = new Set(bundle.flights.map((f) => f.id));
  const okFstd = new Set(bundle.fstd.map((f) => f.id));
  const okExp = new Set(bundle.experience.map((f) => f.id));
  const flights = s.flights.filter((f) => okFlights.has(f.id));
  const fstd = s.fstdSessions.filter((f) => okFstd.has(f.id));
  const experience = s.previousExperience.filter((f) => okExp.has(f.id));
  return { flights, fstd, experience, hidden: s.flights.length - flights.length + s.fstdSessions.length - fstd.length + s.previousExperience.length - experience.length };
}

// ---- base64 for attachments (browser and Node) ----

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
