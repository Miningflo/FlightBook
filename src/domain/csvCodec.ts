import type { ClassCarryIn, ClassRating } from './types';
import { CLASS_RATINGS, CLASS_RATING_LABELS } from './types';
import { csvRows } from './csv';
import { escapeTextCell, toCsv, unescapeTextCell } from './csvWrite';
import { formatHHMM, isValidIsoDate, parseHHMM } from './time';
import { type ExperienceImport, type FlightImport, type FstdImport, isOverrideKey } from './records';
import { validateFlightImport } from './records';
import type { Overrides } from './types';
import { engineClassOfFlight } from './flightForm';
import { validateExperience } from './experience';
import { validateFstd } from './fstd';

/**
 * CSV formats for flights, simulator sessions and previous experience.
 * Round-trip safe: exporting and importing gives back exactly the same records.
 *  - durations are H:MM (exact for whole minutes); instants are full ISO 8601 UTC with milliseconds
 *  - text is protected against formula injection reversibly (see csvWrite.ts)
 *  - every stored field has a column, so nothing is dropped
 */

export type CsvKind = 'flights' | 'fstd' | 'experience';

type Draft = Record<string, unknown>;

interface Col<T> {
  header: string;
  required: boolean;
  format(r: T): string;
  /** Throws a short message (no row context) for a bad cell. Not called for empty optional cells. */
  parse(cell: string): unknown;
  apply(d: Draft, v: unknown): void;
}

const fail = (msg: string): never => { throw new Error(msg); };

function text<T>(key: keyof T & string, header: string, required = false): Col<T> {
  return { header, required, format: (r) => escapeTextCell(String(r[key] ?? '')), parse: (c) => unescapeTextCell(c), apply: (d, v) => { d[key] = v; } };
}
function duration<T>(key: keyof T & string, header: string, required = false): Col<T> {
  return {
    header, required, format: (r) => formatHHMM(Number(r[key])),
    parse: (c) => parseHHMM(c) ?? fail(`"${c}" is not a duration like 1:35`), apply: (d, v) => { d[key] = v; },
  };
}
function int<T>(key: keyof T & string, header: string, required = false): Col<T> {
  return {
    header, required, format: (r) => String(r[key]),
    parse: (c) => (/^\d{1,9}$/.test(c.trim()) ? Number(c) : fail(`"${c}" is not a whole number`)), apply: (d, v) => { d[key] = v; },
  };
}
function date<T>(key: keyof T & string, header: string, required = false): Col<T> {
  return {
    header, required, format: (r) => String(r[key] ?? ''),
    parse: (c) => (isValidIsoDate(c.trim()) ? c.trim() : fail(`"${c}" is not a date like 2025-06-01`)), apply: (d, v) => { d[key] = v; },
  };
}
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
function instant<T>(key: keyof T & string, header: string, required = false): Col<T> {
  return {
    header, required, format: (r) => new Date(Number(r[key])).toISOString(),
    parse: (c) => (INSTANT.test(c.trim()) && !Number.isNaN(Date.parse(c.trim())) ? Date.parse(c.trim()) : fail(`"${c}" is not a UTC time like 2025-06-01T09:30:00Z`)), apply: (d, v) => { d[key] = v; },
  };
}
function bool<T>(key: keyof T & string, header: string): Col<T> {
  return {
    header, required: false, format: (r) => (r[key] ? 'yes' : 'no'),
    parse: (c) => { const s = c.trim().toLowerCase(); return ['yes', 'true', '1'].includes(s) ? true : ['no', 'false', '0'].includes(s) ? false : fail(`"${c}" is not yes or no`); },
    apply: (d, v) => { d[key] = v; },
  };
}

const CLASS_BY_TEXT = new Map<string, ClassRating>([
  ...CLASS_RATINGS.map((c): [string, ClassRating] => [c.toLowerCase(), c]),
  ...CLASS_RATINGS.map((c): [string, ClassRating] => [CLASS_RATING_LABELS[c].toLowerCase(), c]),
  ['set', 'SET_LAND'], // short forms people (and earlier exports) may use
  ['set (turbine)', 'SET_LAND'],
]);
const classCol = <T,>(key: keyof T & string, header: string): Col<T> => ({
  header, required: true, format: (r) => String(r[key]),
  parse: (c) => CLASS_BY_TEXT.get(c.trim().toLowerCase()) ?? fail(`"${c}" is not a known class (${CLASS_RATINGS.join(', ')})`), apply: (d, v) => { d[key] = v; },
});

const overridesCol: Col<FlightImport> = {
  header: 'overrides', required: false,
  format: (r) => Object.keys(r.overrides).sort().join(';'),
  parse: (c) => {
    const keys = c.split(/[;,]/).map((k) => k.trim()).filter(Boolean);
    const bad = keys.find((k) => !isOverrideKey(k));
    if (bad) fail(`unknown override "${bad}"`);
    return Object.fromEntries(keys.map((k) => [k, true])) as Overrides;
  },
  apply: (d, v) => { d.overrides = v; },
};

export const FLIGHT_COLUMNS: Col<FlightImport>[] = [
  text('id', 'id'), date('date', 'date', true),
  text('depPlace', 'dep_place', true), instant('depTimeUtc', 'dep_time_utc', true),
  text('arrPlace', 'arr_place', true), instant('arrTimeUtc', 'arr_time_utc', true),
  text('registration', 'registration', true), text('aircraftMake', 'make', true), text('aircraftModel', 'model', true), text('aircraftVariant', 'variant'),
  classCol('aircraftClass', 'class'),
  duration('spSeMin', 'sp_se'), duration('spMeMin', 'sp_me'), duration('mpMin', 'mp'), duration('totalMin', 'total', true),
  text('picName', 'pic_name', true),
  int('takeoffsDay', 'takeoffs_day'), int('takeoffsNight', 'takeoffs_night'), int('landingsDay', 'landings_day'), int('landingsNight', 'landings_night'),
  duration('nightMin', 'night'), duration('ifrMin', 'ifr'),
  duration('picMin', 'pic'), duration('copiMin', 'copi'), duration('dualMin', 'dual'), duration('instMin', 'inst'),
  bool('isPicus', 'picus'), bool('isSpic', 'spic'),
  text('remarks', 'remarks'), overridesCol,
  instant('createdAt', 'created_at'), instant('updatedAt', 'updated_at'),
];

export const FSTD_COLUMNS: Col<FstdImport>[] = [
  text('id', 'id'), date('date', 'date', true), text('fstdType', 'fstd_type', true), duration('totalMin', 'total', true), text('remarks', 'remarks'),
  instant('createdAt', 'created_at'), instant('updatedAt', 'updated_at'),
];

const classHeader = (c: ClassRating, f: string) => `${c.toLowerCase()}_${f}`;
const classCols: Col<ExperienceImport>[] = CLASS_RATINGS.flatMap((c): Col<ExperienceImport>[] => {
  const mk = (field: keyof ClassCarryIn, kind: 'duration' | 'int'): Col<ExperienceImport> => ({
    header: classHeader(c, field === 'takeoffs' || field === 'landings' ? field : field === 'totalMin' ? 'total' : 'pic'),
    required: false,
    format: (r) => { const v = r.byClass[c]; return v ? (kind === 'duration' ? formatHHMM(v[field]) : String(v[field])) : ''; },
    parse: (cell) => (kind === 'duration' ? parseHHMM(cell) ?? fail(`"${cell}" is not a duration like 1:35`) : /^\d{1,9}$/.test(cell.trim()) ? Number(cell) : fail(`"${cell}" is not a whole number`)),
    apply: (d, v) => {
      const by = ((d.byClass as Partial<Record<ClassRating, ClassCarryIn>> | undefined) ?? (d.byClass = {})) as Partial<Record<ClassRating, ClassCarryIn>>;
      (by[c] ??= { totalMin: 0, picMin: 0, takeoffs: 0, landings: 0 })[field] = v as number;
    },
  });
  return [mk('totalMin', 'duration'), mk('picMin', 'duration'), mk('takeoffs', 'int'), mk('landings', 'int')];
});

export const EXPERIENCE_COLUMNS: Col<ExperienceImport>[] = [
  text('id', 'id'), text('source', 'source', true), text('note', 'note'),
  { ...date<ExperienceImport>('periodFrom', 'period_from'), format: (r) => r.periodFrom ?? '' },
  date('periodTo', 'period_to', true),
  duration('totalMin', 'total', true), duration('spSeMin', 'sp_se'), duration('spMeMin', 'sp_me'), duration('mpMin', 'mp'),
  duration('picMin', 'pic'), duration('copiMin', 'copi'), duration('dualMin', 'dual'), duration('instMin', 'inst'), duration('picusMin', 'picus'), duration('spicMin', 'spic'),
  duration('nightMin', 'night'), duration('ifrMin', 'ifr'),
  int('takeoffsDay', 'takeoffs_day'), int('takeoffsNight', 'takeoffs_night'), int('landingsDay', 'landings_day'), int('landingsNight', 'landings_night'),
  duration('fstdMin', 'fstd'),
  ...classCols,
  instant('createdAt', 'created_at'), instant('updatedAt', 'updated_at'),
];

// ---------------- encode ----------------

function encode<T>(records: T[], cols: Col<T>[]): string {
  return toCsv([cols.map((c) => c.header), ...records.map((r) => cols.map((c) => c.format(r)))]);
}
export const encodeFlights = (r: FlightImport[]) => encode(r, FLIGHT_COLUMNS);
export const encodeFstd = (r: FstdImport[]) => encode(r, FSTD_COLUMNS);
export const encodeExperience = (r: ExperienceImport[]) => encode(r, EXPERIENCE_COLUMNS);

// ---------------- decode ----------------

export interface RowError { row: number; message: string }

export interface DecodeResult<T> {
  records: { row: number; value: T }[];
  errors: RowError[];
  /** Columns in the file that this app does not use (ignored, listed so nothing is lost silently). */
  ignoredColumns: string[];
}

/** Which kind of CSV this is, judged by its header; null if it is none of ours. */
export function detectCsvKind(text: string): CsvKind | null {
  const head = csvRows(text).next();
  if (head.done) return null;
  const h = new Set(head.value.map((x) => x.trim().toLowerCase()));
  if (h.has('dep_time_utc')) return 'flights';
  if (h.has('fstd_type')) return 'fstd';
  if (h.has('period_to')) return 'experience';
  return null;
}

function decode<T>(textIn: string, cols: Col<T>[], finish: (d: Draft) => { value: T; problems: string[] }): DecodeResult<T> {
  const rows = csvRows(textIn);
  const head = rows.next();
  const result: DecodeResult<T> = { records: [], errors: [], ignoredColumns: [] };
  if (head.done) { result.errors.push({ row: 1, message: 'The file is empty.' }); return result; }
  const index = new Map(head.value.map((h, i) => [h.trim().toLowerCase(), i]));
  const missing = cols.filter((c) => c.required && !index.has(c.header)).map((c) => c.header);
  if (missing.length > 0) { result.errors.push({ row: 1, message: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` }); return result; }
  const known = new Set(cols.map((c) => c.header));
  result.ignoredColumns = head.value.map((h) => h.trim()).filter((h) => h !== '' && !known.has(h.toLowerCase()));

  let line = 1;
  for (const r of rows) {
    line++;
    if (r.every((c) => c.trim() === '')) continue;
    const d: Draft = {};
    const problems: string[] = [];
    for (const c of cols) {
      const at = index.get(c.header);
      const cell = at === undefined ? '' : (r[at] ?? '');
      if (cell.trim() === '') {
        if (c.required) problems.push(`${c.header}: a value is required`);
        continue;
      }
      try { c.apply(d, c.parse(cell)); } catch (e) { problems.push(`${c.header}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (problems.length === 0) {
      const fin = finish(d);
      problems.push(...fin.problems);
      if (problems.length === 0) { result.records.push({ row: line, value: fin.value }); continue; }
    }
    result.errors.push({ row: line, message: problems.join('; ') });
  }
  return result;
}

export function decodeFlights(text: string, ids: () => string, now: number): DecodeResult<FlightImport> {
  return decode(text, FLIGHT_COLUMNS, (d) => {
    const total = (d.totalMin as number | undefined) ?? 0;
    const se = d.spSeMin as number | undefined, me = d.spMeMin as number | undefined, mp = d.mpMin as number | undefined;
    // A file without the single-pilot/multi-pilot split (from another logbook) is taken as single-pilot SE.
    const noSplit = se === undefined && me === undefined && mp === undefined;
    const base = {
      id: (d.id as string | undefined) || ids(),
      createdAt: (d.createdAt as number | undefined) ?? now, updatedAt: (d.updatedAt as number | undefined) ?? now,
      date: d.date as string, depPlace: String(d.depPlace).trim().toUpperCase(), depTimeUtc: d.depTimeUtc as number,
      arrPlace: String(d.arrPlace).trim().toUpperCase(), arrTimeUtc: d.arrTimeUtc as number,
      registration: String(d.registration).trim().toUpperCase().replace(/\s+/g, ''), aircraftMake: String(d.aircraftMake).trim(), aircraftModel: String(d.aircraftModel).trim(),
      aircraftVariant: String(d.aircraftVariant ?? '').trim(), aircraftClass: d.aircraftClass as ClassRating,
      spSeMin: noSplit ? total : se ?? 0, spMeMin: me ?? 0, mpMin: mp ?? 0, totalMin: total,
      picName: String(d.picName).trim().replace(/\s+/g, ' '),
      takeoffsDay: (d.takeoffsDay as number | undefined) ?? 0, takeoffsNight: (d.takeoffsNight as number | undefined) ?? 0,
      landingsDay: (d.landingsDay as number | undefined) ?? 0, landingsNight: (d.landingsNight as number | undefined) ?? 0,
      nightMin: (d.nightMin as number | undefined) ?? 0, ifrMin: (d.ifrMin as number | undefined) ?? 0,
      picMin: (d.picMin as number | undefined) ?? 0, copiMin: (d.copiMin as number | undefined) ?? 0, dualMin: (d.dualMin as number | undefined) ?? 0, instMin: (d.instMin as number | undefined) ?? 0,
      isPicus: (d.isPicus as boolean | undefined) ?? false, isSpic: (d.isSpic as boolean | undefined) ?? false,
      remarks: String(d.remarks ?? ''), attachmentIds: [] as string[], overrides: (d.overrides as Overrides | undefined) ?? {},
    };
    const value: FlightImport = { ...base, engineClass: engineClassOfFlight(base) };
    return { value, problems: validateFlightImport(value) };
  });
}

export function decodeFstd(text: string, ids: () => string, now: number): DecodeResult<FstdImport> {
  return decode(text, FSTD_COLUMNS, (d) => {
    const value: FstdImport = {
      id: (d.id as string | undefined) || ids(), createdAt: (d.createdAt as number | undefined) ?? now, updatedAt: (d.updatedAt as number | undefined) ?? now,
      date: d.date as string, fstdType: String(d.fstdType).trim(), totalMin: d.totalMin as number, remarks: String(d.remarks ?? ''),
    };
    return { value, problems: validateFstd(value).filter((i) => i.severity === 'error').map((i) => i.message) };
  });
}

export function decodeExperience(text: string, ids: () => string, now: number): DecodeResult<ExperienceImport> {
  return decode(text, EXPERIENCE_COLUMNS, (d) => {
    const n = (k: string) => (d[k] as number | undefined) ?? 0;
    const value: ExperienceImport = {
      id: (d.id as string | undefined) || ids(), createdAt: (d.createdAt as number | undefined) ?? now, updatedAt: (d.updatedAt as number | undefined) ?? now,
      source: String(d.source).trim(), note: String(d.note ?? ''), periodFrom: (d.periodFrom as string | undefined) ?? null, periodTo: d.periodTo as string,
      totalMin: n('totalMin'), spSeMin: n('spSeMin'), spMeMin: n('spMeMin'), mpMin: n('mpMin'),
      picMin: n('picMin'), copiMin: n('copiMin'), dualMin: n('dualMin'), instMin: n('instMin'), picusMin: n('picusMin'), spicMin: n('spicMin'),
      nightMin: n('nightMin'), ifrMin: n('ifrMin'),
      takeoffsDay: n('takeoffsDay'), takeoffsNight: n('takeoffsNight'), landingsDay: n('landingsDay'), landingsNight: n('landingsNight'),
      fstdMin: n('fstdMin'), byClass: (d.byClass as ExperienceImport['byClass'] | undefined) ?? {},
    };
    return { value, problems: validateExperience(value).filter((i) => i.severity === 'error').map((i) => i.message) };
  });
}
