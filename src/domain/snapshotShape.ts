import { CLASS_RATINGS, type ClassRating, MEDICAL_CLASS_LABELS } from './types';
import type { Snapshot } from './snapshot';
import { isValidIsoDate } from './time';

/**
 * A backup is a file from outside: it may have been edited, cut short or written by something else. Before
 * anything reads a record's fields, these checks say whether the fields are there and of the right kind. The
 * rules about their values (times add up, and so on) are validated separately.
 */

type Test = (v: unknown) => boolean;
export type Shape = Record<string, Test>;

const text: Test = (v) => typeof v === 'string';
const num: Test = (v) => typeof v === 'number' && Number.isFinite(v);
const flag: Test = (v) => typeof v === 'boolean';
const object: Test = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const optional = (t: Test): Test => (v) => v === undefined || v === null || t(v);
const isoDate: Test = (v) => typeof v === 'string' && isValidIsoDate(v);
const fields = (test: Test, names: string): Shape => Object.fromEntries(names.split(' ').map((n) => [n, test]));
const record: Shape = { id: text, createdAt: num, updatedAt: num };

export const FLIGHT_SHAPE: Shape = {
  ...record,
  ...fields(text, 'date depPlace arrPlace aircraftId registration aircraftMake aircraftModel aircraftVariant aircraftClass picNameId remarks'),
  ...fields(num, 'depTimeUtc arrTimeUtc spSeMin spMeMin mpMin totalMin takeoffsDay takeoffsNight landingsDay landingsNight nightMin ifrMin picMin copiMin dualMin instMin'),
  ...fields(flag, 'isPicus isSpic'),
  attachmentIds: (v) => Array.isArray(v) && v.every(text),
  overrides: object,
  typeRatingId: optional(text),
  routeSector: optional(flag),
};
export const FSTD_SHAPE: Shape = { ...record, ...fields(text, 'date fstdType remarks'), totalMin: num };
export const EXPERIENCE_SHAPE: Shape = {
  ...record,
  ...fields(text, 'source note periodTo'),
  periodFrom: (v) => v === null || text(v),
  ...fields(num, 'totalMin spSeMin spMeMin mpMin picMin copiMin dualMin instMin picusMin spicMin nightMin ifrMin takeoffsDay takeoffsNight landingsDay landingsNight fstdMin'),
  byClass: (v) => object(v) && Object.values(v as object).every((c) => object(c) && ['totalMin', 'picMin', 'takeoffs', 'landings'].every((k) => num((c as Record<string, unknown>)[k]))),
};
export const PERSON_SHAPE: Shape = { ...record, ...fields(text, 'name nameKey'), isSelf: flag };
export const AIRCRAFT_SHAPE: Shape = { ...record, ...fields(text, 'registration make model variant engineClass classRating'), typeRatingId: optional(text) };
export const ATTACHMENT_SHAPE: Shape = {
  ...record, ...fields(text, 'flightId mime name'),
  data: (v) => typeof v === 'string' && v.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(v),
};

/** What is wrong with a record's shape, or null if it can be read. */
export function shapeProblem(value: unknown, shape: Shape): string | null {
  if (!object(value)) return 'is not a record';
  const bad = Object.entries(shape).filter(([key, test]) => !test((value as Record<string, unknown>)[key])).map(([key]) => key);
  return bad.length === 0 ? null : `has missing or unreadable fields: ${bad.join(', ')}`;
}

// ---------------- holder details and licence dates ----------------

type LicenceData = Snapshot['settings'];

const isTypeRating: Test = (v) => shapeProblem(v, { id: text, name: text, expiry: isoDate }) === null;

const LICENCE_SHAPE: Record<Exclude<keyof LicenceData, 'classExpiry'>, [Test, string]> = {
  pilotName: [text, "the holder's name"],
  licenceNumber: [text, 'the licence number'],
  address: [text, 'the address'],
  sepLandExpiry: [isoDate, 'the SEP (land) expiry date'],
  irExpiry: [isoDate, 'the instrument rating expiry date'],
  medicalClass: [(v) => typeof v === 'string' && Object.hasOwn(MEDICAL_CLASS_LABELS, v), 'the medical class'],
  medicalExpiry: [isoDate, 'the medical expiry date'],
  languageLevel: [(v) => v === 4 || v === 5 || v === 6, 'the language level'],
  languageExpiry: [isoDate, 'the language endorsement expiry date'],
  typeRatings: [(v) => Array.isArray(v) && v.every(isTypeRating), 'the type ratings'],
};

/** The readable licence data of a backup. Anything unreadable is left out and NAMED, never passed on. */
export function readLicenceData(raw: unknown): { settings: LicenceData; problems: string[] } {
  const source = (object(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [key, [test, label]] of Object.entries(LICENCE_SHAPE)) {
    const v = source[key];
    if (v === undefined) continue;
    // null and "" mean "none entered"
    if (v === null || (v === '' && test !== text)) out[key] = null;
    else if (test(v)) out[key] = v;
    else problems.push(`${label} cannot be read`);
  }
  const byClass = source.classExpiry;
  if (byClass !== undefined && byClass !== null) {
    if (!object(byClass)) problems.push('the class rating expiry dates cannot be read');
    else {
      const kept: Partial<Record<ClassRating, string>> = {};
      for (const [k, v] of Object.entries(byClass as Record<string, unknown>)) {
        if (v === null || v === undefined || v === '') continue;
        if ((CLASS_RATINGS as readonly string[]).includes(k) && isoDate(v)) kept[k as ClassRating] = v as string;
        else problems.push(`the expiry date for class "${k}" cannot be read`);
      }
      out.classExpiry = kept;
    }
  }
  return { settings: out as LicenceData, problems };
}
