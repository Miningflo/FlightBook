import type { Aircraft, ClassRating, Flight, FstdSession, IsoDate, MedicalClass, Person, PreviousExperience, TypeRating } from './types';
import { type FlightImport, type ImportBundle, toFlightImport, validateFlightImport } from './records';
import { validateExperience } from './experience';
import { validateFstd } from './fstd';
import {
  AIRCRAFT_SHAPE, ATTACHMENT_SHAPE, EXPERIENCE_SHAPE, FLIGHT_SHAPE, FSTD_SHAPE, PERSON_SHAPE, type Shape, readLicenceData, shapeProblem,
} from './snapshotShape';

/**
 * Full JSON backup ("snapshot") of the logbook. It carries a schema version so that older
 * backups can be migrated in memory when loaded (used by restore now and by the read-only viewer in phase 5).
 *
 * Included: flights, aircraft, people, simulator sessions, previous experience, attachments, and the two
 * settings that belong to the logbook (pilot name, SEP expiry). Not included: the airports database and the
 * photo cache (re-creatable reference data) and device-specific settings (device name, master role, theme).
 */

/** Bump together with a new entry in MIGRATIONS whenever the snapshot layout changes. */
export const SNAPSHOT_SCHEMA_VERSION = 3;

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
  settings: { pilotName?: string; licenceNumber?: string; address?: string; sepLandExpiry?: IsoDate | null; classExpiry?: Partial<Record<ClassRating, IsoDate>>; irExpiry?: IsoDate | null; medicalClass?: MedicalClass | null; medicalExpiry?: IsoDate | null; languageLevel?: 4 | 5 | 6 | null; languageExpiry?: IsoDate | null; typeRatings?: TypeRating[] };
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

/**
 * Migrations from version N to N+1, applied in order on the raw parsed object.
 *
 * 1 -> 2 added `typeRatingId` to flights and `typeRatings` to settings. Nothing has to be rewritten:
 * a v1 flight simply belongs to no type rating, which is what an absent field already means. The
 * version was still bumped so that an older copy of the app refuses a v2 backup rather than restoring
 * it and dropping the type links on its next upload.
 *
 * 2 -> 3 added `routeSector` to flights, bumped for the same reason and with the same nothing-to-rewrite:
 * a v2 flight was simply never marked as a route sector, which is what an absent field means.
 */
export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  1: (raw) => raw,
  2: (raw) => raw,
};

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

export interface ReadSnapshot {
  /** Flights, simulator sessions and previous experience that are valid, as portable records. */
  bundle: ImportBundle;
  /** Everything that is valid, as stored in the snapshot. */
  records: Pick<Snapshot, 'aircraft' | 'persons' | 'flights' | 'fstdSessions' | 'previousExperience' | 'attachments' | 'settings'>;
  /** Everything that was left out, and why. */
  problems: SnapshotProblem[];
}

/** A record's name in a problem list, from whatever can be read of it. */
const nameOf = (kind: string, r: unknown, ...keys: string[]): string =>
  [kind, ...keys.map((k) => (r as Record<string, unknown> | null)?.[k]).filter((v) => typeof v === 'string' && v !== '')].join(' ');

/**
 * Read a snapshot record by record. Nothing unreadable or invalid is passed on, and everything left out is
 * reported in `problems`.
 */
export function readSnapshot(s: Snapshot): ReadSnapshot {
  const problems: SnapshotProblem[] = [];
  const sound = <T>(list: T[], shape: Shape, label: (r: T) => string, rules: (r: T) => string[] = () => []): T[] =>
    list.filter((r) => {
      const shapeBad = shapeProblem(r, shape);
      const bad = shapeBad ? [shapeBad] : rules(r);
      if (bad.length > 0) problems.push({ record: label(r), message: bad.join('; ') });
      return bad.length === 0;
    });
  const errors = (issues: { severity: string; message: string }[]) => issues.filter((i) => i.severity === 'error').map((i) => i.message);

  const aircraft = sound(s.aircraft, AIRCRAFT_SHAPE, (a) => nameOf('aircraft', a, 'registration'));
  const persons = sound(s.persons, PERSON_SHAPE, (p) => nameOf('person', p, 'name'));
  const personIds = new Set(persons.map((p) => p.id));
  const imports = new Map<Flight, FlightImport>();
  const flights = sound(s.flights, FLIGHT_SHAPE, (f) => nameOf('flight', f, 'date', 'registration'), (f) => {
    if (!personIds.has(f.picNameId)) return ['its PIC record is missing from the backup'];
    const imp = toFlightImport(f, persons);
    imports.set(f, imp);
    return validateFlightImport(imp);
  });
  const fstdSessions = sound(s.fstdSessions, FSTD_SHAPE, (x) => nameOf('simulator session', x, 'date'), (x) => errors(validateFstd(x)));
  const previousExperience = sound(s.previousExperience, EXPERIENCE_SHAPE, (x) => nameOf('previous experience', x, 'source'), (x) => errors(validateExperience(x)));
  const attachments = sound(s.attachments, ATTACHMENT_SHAPE, (a) => nameOf('attachment', a, 'name'));
  const licence = readLicenceData(s.settings);
  problems.push(...licence.problems.map((message) => ({ record: 'licence data', message })));

  return {
    bundle: { flights: flights.map((f) => imports.get(f)!), fstd: fstdSessions, experience: previousExperience },
    records: { aircraft, persons, flights, fstdSessions, previousExperience, attachments, settings: licence.settings },
    problems,
  };
}

/** Records of a snapshot as an import bundle, plus every record-level problem found. */
export function snapshotToBundle(s: Snapshot): { bundle: ImportBundle; problems: SnapshotProblem[] } {
  const { bundle, problems } = readSnapshot(s);
  return { bundle, problems };
}

/**
 * The parts of a snapshot that are safe to show (a viewer displays them directly). What cannot be read is
 * left out and COUNTED, so the screen can say that something was hidden instead of silently showing less.
 */
export function snapshotRecords(s: Snapshot) {
  const { records, problems } = readSnapshot(s);
  return {
    flights: records.flights, fstd: records.fstdSessions, experience: records.previousExperience,
    aircraft: records.aircraft, persons: records.persons, settings: records.settings,
    hidden: problems.length,
  };
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
