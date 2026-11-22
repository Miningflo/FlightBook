import type { BaseRecord, ClassCarryIn, ClassRating, IsoDate, PreviousExperience } from './types';
import { CLASS_RATINGS } from './types';
import { isValidIsoDate } from './time';
import type { ValidationIssue } from './flightForm';

/** Editable draft of a previous-experience (carry-in) record: everything except id and timestamps. */
export type ExperienceDraft = Omit<PreviousExperience, keyof BaseRecord>;

export function emptyExperience(today: IsoDate): ExperienceDraft {
  return {
    source: '', note: '', periodFrom: null, periodTo: today,
    totalMin: 0, spSeMin: 0, spMeMin: 0, mpMin: 0,
    picMin: 0, copiMin: 0, dualMin: 0, instMin: 0, picusMin: 0, spicMin: 0,
    nightMin: 0, ifrMin: 0,
    takeoffsDay: 0, takeoffsNight: 0, landingsDay: 0, landingsNight: 0,
    fstdMin: 0, byClass: {},
  };
}

export function emptyClassCarryIn(): ClassCarryIn {
  return { totalMin: 0, picMin: 0, takeoffs: 0, landings: 0 };
}

const MINUTE_FIELDS: [keyof ExperienceDraft, string][] = [
  ['totalMin', 'Total flight time'], ['spSeMin', 'Single-pilot SE time'], ['spMeMin', 'Single-pilot ME time'], ['mpMin', 'Multi-pilot time'],
  ['picMin', 'PIC time'], ['copiMin', 'Co-pilot time'], ['dualMin', 'Dual time'], ['instMin', 'Instructor time'],
  ['picusMin', 'PICUS time'], ['spicMin', 'SPIC time'], ['nightMin', 'Night time'], ['ifrMin', 'IFR time'], ['fstdMin', 'Simulator time'],
];
const COUNT_FIELDS: [keyof ExperienceDraft, string][] = [
  ['takeoffsDay', 'Day take-offs'], ['takeoffsNight', 'Night take-offs'], ['landingsDay', 'Day landings'], ['landingsNight', 'Night landings'],
];
/** Fields that are part of the flight time and so cannot exceed the total. */
const SUBSETS: [keyof ExperienceDraft, string][] = [
  ['spSeMin', 'Single-pilot SE time'], ['spMeMin', 'Single-pilot ME time'], ['mpMin', 'Multi-pilot time'],
  ['picMin', 'PIC time'], ['copiMin', 'Co-pilot time'], ['dualMin', 'Dual time'], ['instMin', 'Instructor time'],
  ['picusMin', 'PICUS time'], ['spicMin', 'SPIC time'], ['nightMin', 'Night time'], ['ifrMin', 'IFR time'],
];

export function validateExperience(d: ExperienceDraft, todayDate?: IsoDate): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const err = (field: string, message: string) => out.push({ field, message, severity: 'error' });
  const warn = (field: string, message: string) => out.push({ field, message, severity: 'warning' });

  if (!d.source.trim()) err('source', 'Say where these hours come from (e.g. "Paper logbook vol. 1").');
  if (!isValidIsoDate(d.periodTo)) err('periodTo', 'Enter the last date covered.');
  else if (todayDate && d.periodTo > todayDate) warn('periodTo', 'This date is in the future.');
  if (d.periodFrom !== null) {
    if (!isValidIsoDate(d.periodFrom)) err('periodFrom', 'Enter a valid start date or leave it empty.');
    else if (isValidIsoDate(d.periodTo) && d.periodFrom > d.periodTo) err('periodFrom', 'The start date is after the end date.');
  }

  for (const [k, label] of [...MINUTE_FIELDS, ...COUNT_FIELDS]) {
    const v = d[k] as number;
    if (!Number.isInteger(v) || v < 0) err(String(k), `${label} must be a whole number, zero or more.`);
  }
  for (const [k, label] of SUBSETS) {
    if ((d[k] as number) > d.totalMin) err(String(k), `${label} exceeds the total flight time.`);
  }
  if (d.spSeMin + d.spMeMin + d.mpMin !== d.totalMin) {
    warn('spSeMin', 'Single-pilot SE + ME + multi-pilot time does not equal the total flight time.');
  }

  let classSum = 0;
  for (const k of CLASS_RATINGS) {
    const c = d.byClass[k];
    if (!c) continue;
    classSum += c.totalMin;
    for (const [f, label] of [['totalMin', 'time'], ['picMin', 'PIC time'], ['takeoffs', 'take-offs'], ['landings', 'landings']] as const) {
      if (!Number.isInteger(c[f]) || c[f] < 0) err(`class-${k}`, `Class ${label} must be a whole number, zero or more.`);
    }
    if (c.picMin > c.totalMin) err(`class-${k}`, 'PIC time in a class cannot exceed that class\'s total time.');
  }
  if (classSum > d.totalMin) err('byClass', 'The class totals add up to more than the total flight time.');
  return out;
}

/** Clean a draft for saving: trims text and drops class entries that are all zero. */
export function normalizeExperience(d: ExperienceDraft): ExperienceDraft {
  const byClass: Partial<Record<ClassRating, ClassCarryIn>> = {};
  for (const k of CLASS_RATINGS) {
    const c = d.byClass[k];
    if (c && (c.totalMin > 0 || c.picMin > 0 || c.takeoffs > 0 || c.landings > 0)) byClass[k] = { ...c };
  }
  return { ...d, source: d.source.trim(), note: d.note.trim(), periodFrom: d.periodFrom || null, byClass };
}
