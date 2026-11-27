import type { Aircraft, ClassRating, Flight, FstdSession, IsoDate, Overrides, Person, PreviousExperience } from './types';
import { CLASS_RATINGS } from './types';
import type { FlightInput } from './flightForm';
import { engineClassOfFlight } from './flightForm';
import { dateOfTimestamp, isValidIsoDate } from './time';

/**
 * Portable forms of the stored records, used by CSV import/export, JSON backups and the
 * importer. A flight here carries the PIC's name and the aircraft details instead of database
 * ids, so a file can be loaded into a logbook whose ids are different.
 */

export type FlightImport = FlightInput & { id: string; createdAt: number; updatedAt: number };
export type FstdImport = FstdSession;
export type ExperienceImport = PreviousExperience;

export interface ImportBundle {
  flights: FlightImport[];
  fstd: FstdImport[];
  experience: ExperienceImport[];
}

export function toFlightImport(f: Flight, persons: Person[]): FlightImport {
  const { aircraftId: _a, picNameId, ...rest } = f;
  // older flights lack typeRatingId and routeSector, which means none and no; spelled out so "absent" and "none" compare equal
  return { ...rest, typeRatingId: f.typeRatingId ?? null, routeSector: f.routeSector === true, picName: persons.find((p) => p.id === picNameId)?.name ?? 'UNKNOWN', engineClass: engineClassOfFlight(f) };
}

export function toFlightImports(flights: Flight[], persons: Person[]): FlightImport[] {
  return flights.map((f) => toFlightImport(f, persons));
}

/**
 * Aircraft record to create for a flight whose registration is not known yet. Its type rating, which the
 * flight form fills in from the aircraft, is copied only if this logbook holds it (`heldRatingIds`): an id
 * from another logbook would point at nothing. The flight keeps its own id either way, and is flagged as
 * having no type rating until one is picked.
 */
export function aircraftFromFlight(f: FlightImport, id: string, now: number, heldRatingIds: ReadonlySet<string> = new Set()): Aircraft {
  const typeRatingId = f.aircraftClass === 'OTHER' && f.typeRatingId && heldRatingIds.has(f.typeRatingId) ? f.typeRatingId : null;
  return {
    id, registration: f.registration, make: f.aircraftMake, model: f.aircraftModel, variant: f.aircraftVariant,
    engineClass: f.engineClass, classRating: f.aircraftClass, typeRatingId, createdAt: now, updatedAt: now,
  };
}

const OVERRIDE_KEYS: (keyof Overrides)[] = ['totalMin', 'nightMin', 'takeoffsDay', 'takeoffsNight', 'landingsDay', 'landingsNight'];
export const isOverrideKey = (k: string): k is keyof Overrides => (OVERRIDE_KEYS as string[]).includes(k);

/** Integrity rules a flight must satisfy to be stored. Returns human-readable problems (empty = fine). */
export function validateFlightImport(f: FlightImport): string[] {
  const out: string[] = [];
  const isInt = (n: number) => Number.isInteger(n) && n >= 0;
  if (!isValidIsoDate(f.date)) out.push('date is not a valid date');
  if (!Number.isFinite(f.depTimeUtc) || !Number.isFinite(f.arrTimeUtc)) out.push('departure/arrival time missing');
  else {
    if (f.arrTimeUtc <= f.depTimeUtc) out.push('arrival time is not after departure time');
    if (isValidIsoDate(f.date) && dateOfTimestamp(f.depTimeUtc) !== f.date) out.push('date does not match the departure time (UTC)');
  }
  if (!f.depPlace.trim()) out.push('departure place is empty');
  if (!f.arrPlace.trim()) out.push('arrival place is empty');
  if (!f.registration.trim()) out.push('registration is empty');
  if (!f.aircraftMake.trim() || !f.aircraftModel.trim()) out.push('aircraft make/model is empty');
  if (!f.picName.trim()) out.push('name of PIC is empty');
  if (!(CLASS_RATINGS as readonly string[]).includes(f.aircraftClass)) out.push('unknown aircraft class');
  const mins: [string, number][] = [['total', f.totalMin], ['single-pilot SE', f.spSeMin], ['single-pilot ME', f.spMeMin], ['multi-pilot', f.mpMin], ['night', f.nightMin], ['IFR', f.ifrMin], ['PIC', f.picMin], ['co-pilot', f.copiMin], ['dual', f.dualMin], ['instructor', f.instMin]];
  for (const [label, v] of mins) if (!isInt(v)) out.push(`${label} time must be a whole number of minutes, zero or more`);
  for (const [label, v] of [['take-offs day', f.takeoffsDay], ['take-offs night', f.takeoffsNight], ['landings day', f.landingsDay], ['landings night', f.landingsNight]] as const) {
    if (!isInt(v)) out.push(`${label} must be a whole number, zero or more`);
  }
  if (isInt(f.totalMin)) {
    if (f.totalMin <= 0) out.push('total time must be greater than zero');
    for (const [label, v] of mins.slice(1)) if (isInt(v) && v > f.totalMin && label !== 'single-pilot SE' && label !== 'single-pilot ME' && label !== 'multi-pilot') out.push(`${label} time exceeds total time`);
    if (isInt(f.spSeMin) && isInt(f.spMeMin) && isInt(f.mpMin) && f.spSeMin + f.spMeMin + f.mpMin !== f.totalMin) out.push('single-pilot SE + ME + multi-pilot time must equal total time');
  }
  for (const k of Object.keys(f.overrides)) if (!isOverrideKey(k)) out.push(`unknown override "${k}"`);
  return out;
}

/** Content of a record without identity and timestamps, in a stable order, for "is it the same?" checks. */
export function contentKey(value: object): string {
  const strip = ({ id: _i, createdAt: _c, updatedAt: _u, ...rest }: Record<string, unknown>) => rest;
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)]))
        : v;
  return JSON.stringify(stable(strip(value as Record<string, unknown>)));
}

/** Natural keys: the same real-world flight/session/record even when ids differ (e.g. an id-less CSV). */
export const flightNaturalKey = (f: Pick<FlightImport, 'depTimeUtc' | 'registration' | 'depPlace' | 'arrPlace'>): string =>
  [f.depTimeUtc, f.registration.toUpperCase(), f.depPlace.toUpperCase(), f.arrPlace.toUpperCase()].join('|');
export const fstdNaturalKey = (s: Pick<FstdSession, 'date' | 'fstdType' | 'totalMin'>): string => [s.date, s.fstdType.toLowerCase(), s.totalMin].join('|');
export const experienceNaturalKey = (e: Pick<PreviousExperience, 'source' | 'periodTo' | 'totalMin'>): string => [e.source.toLowerCase(), e.periodTo, e.totalMin].join('|');

export type { ClassRating, IsoDate };
