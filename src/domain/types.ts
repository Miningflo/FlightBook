/**
 * Data model, aligned with EASA AMC1 FCL.050 (pilot logbook).
 *
 * Conventions (see instructions.md):
 *  - Durations are integer minutes. Display as HH:MM only at the UI edge.
 *  - Timestamps are integer epoch milliseconds, UTC.
 *  - Every record has a UUID `id`, `createdAt`, `updatedAt`.
 *  - Derived totals are NEVER stored. They are computed from these records.
 */

export type Uuid = string;
/** Epoch milliseconds, UTC. */
export type Timestamp = number;
/** Integer minutes. */
export type Minutes = number;
/** Calendar date `YYYY-MM-DD` (UTC). */
export type IsoDate = string;

export interface BaseRecord {
  id: Uuid;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Single-pilot single-engine / single-pilot multi-engine / multi-pilot. */
export type EngineClass = 'SP-SE' | 'SP-ME' | 'MP';
export const ENGINE_CLASSES: readonly EngineClass[] = ['SP-SE', 'SP-ME', 'MP'];

/** Class / type grouping used for totals and rating currency. */
export type ClassRating = 'SEP_LAND' | 'SEP_SEA' | 'TMG' | 'MEP_LAND' | 'MEP_SEA' | 'OTHER';
export const CLASS_RATINGS: readonly ClassRating[] = [
  'SEP_LAND',
  'SEP_SEA',
  'TMG',
  'MEP_LAND',
  'MEP_SEA',
  'OTHER',
];
export const CLASS_RATING_LABELS: Record<ClassRating, string> = {
  SEP_LAND: 'SEP (land)',
  SEP_SEA: 'SEP (sea)',
  TMG: 'TMG',
  MEP_LAND: 'MEP (land)',
  MEP_SEA: 'MEP (sea)',
  OTHER: 'Other',
};

/** Pilot function. A flight may carry more than one (e.g. PIC + INS). */
export type Role = 'PIC' | 'COPI' | 'DUAL' | 'INS';
export const ROLES: readonly Role[] = ['PIC', 'COPI', 'DUAL', 'INS'];

/**
 * Fields whose value can be computed by the app (phase 2) but manually
 * overridden by the user. Recorded per flight so the UI can show
 * "overridden" and recomputation never silently clobbers the user's value.
 */
export type OverridableField =
  | 'totalMin'
  | 'nightMin'
  | 'takeoffsDay'
  | 'takeoffsNight'
  | 'landingsDay'
  | 'landingsNight';
export type Overrides = Partial<Record<OverridableField, true>>;

export interface Aircraft extends BaseRecord {
  /** Normalised: upper case, trimmed. Unique. */
  registration: string;
  make: string;
  model: string;
  variant: string;
  engineClass: EngineClass;
  classRating: ClassRating;
}

export interface Person extends BaseRecord {
  name: string;
  /** Lower-cased, trimmed name used as a unique index key. */
  nameKey: string;
  /** The logbook owner. Shown as "SELF" in the PIC column (AMC1 FCL.050). */
  isSelf: boolean;
}

export interface Flight extends BaseRecord {
  /** UTC date of departure (off-blocks). Always equals the date of `depTimeUtc`. */
  date: IsoDate;

  /** Place of departure: ICAO code (or name if no ICAO code exists). */
  depPlace: string;
  /** Off-blocks, UTC. */
  depTimeUtc: Timestamp;
  arrPlace: string;
  /** On-blocks, UTC. */
  arrTimeUtc: Timestamp;

  aircraftId: Uuid;
  /**
   * Snapshot of the aircraft at the time of the flight, so editing the
   * aircraft record later never rewrites history.
   */
  registration: string;
  aircraftMake: string;
  aircraftModel: string;
  aircraftVariant: string;
  aircraftClass: ClassRating;

  /** Single-pilot SE / SP ME / multi-pilot time. Normally exactly one equals `totalMin`. */
  spSeMin: Minutes;
  spMeMin: Minutes;
  mpMin: Minutes;
  /** Total flight time (block time unless overridden). */
  totalMin: Minutes;

  picNameId: Uuid;

  takeoffsDay: number;
  takeoffsNight: number;
  landingsDay: number;
  landingsNight: number;

  nightMin: Minutes;
  ifrMin: Minutes;

  picMin: Minutes;
  copiMin: Minutes;
  dualMin: Minutes;
  instMin: Minutes;

  /** Pilot-in-command under supervision. */
  isPicus: boolean;
  /** Student pilot-in-command. */
  isSpic: boolean;

  remarks: string;
  attachmentIds: Uuid[];
  overrides: Overrides;
}

export interface Attachment extends BaseRecord {
  flightId: Uuid;
  mime: string;
  blob: Blob;
  name: string;
}

export interface FstdSession extends BaseRecord {
  date: IsoDate;
  /** e.g. "FNPT II", "BITD". */
  fstdType: string;
  totalMin: Minutes;
  remarks: string;
}

/** Per-class carry-in figures (needed e.g. for class-rating revalidation by experience). */
export interface ClassCarryIn {
  totalMin: Minutes;
  picMin: Minutes;
  takeoffs: number;
  landings: number;
}

/**
 * Hours logged before the app was used ("previous experience" carry-in).
 * A logbook can hold several of these (e.g. one per paper logbook volume or
 * per period). All of them feed totals and the PDF "brought forward" figures.
 * Nothing here is derived from other records.
 */
export interface PreviousExperience extends BaseRecord {
  /** Free text, e.g. "Paper logbook vol. 1". */
  source: string;
  note: string;
  /** Start of the period covered, if known. */
  periodFrom: IsoDate | null;
  /** Last date covered ("as of"). */
  periodTo: IsoDate;

  totalMin: Minutes;
  spSeMin: Minutes;
  spMeMin: Minutes;
  mpMin: Minutes;

  picMin: Minutes;
  copiMin: Minutes;
  dualMin: Minutes;
  instMin: Minutes;
  picusMin: Minutes;
  spicMin: Minutes;

  nightMin: Minutes;
  ifrMin: Minutes;

  takeoffsDay: number;
  takeoffsNight: number;
  landingsDay: number;
  landingsNight: number;

  fstdMin: Minutes;

  byClass: Partial<Record<ClassRating, ClassCarryIn>>;
}

/**
 * Device-local cache of an online photo lookup. Not logbook data: it is never
 * backed up and can be deleted at any time without losing anything.
 */
export interface PhotoCacheEntry {
  /** Normalised registration, primary key. */
  registration: string;
  status: 'found' | 'none';
  /** Where a found photo came from. Absent on entries written before v2 lookups (treated as Commons). */
  source?: 'planespotters' | 'commons';
  /** Lookup logic version; older entries are re-checked. Absent = 1. */
  lookupVersion?: number;
  fetchedAt: Timestamp;
  imageUrl?: string;
  pageUrl?: string;
  artist?: string;
  license?: string;
  title?: string;
}

/**
 * Viewer devices keep the last snapshot they loaded (device-local, never uploaded) so the
 * logbook opens instantly and offline. It is only ever replaced by a newer download.
 */
export interface ViewerCacheEntry {
  key: 'latest';
  /** The snapshot file exactly as downloaded. */
  text: string;
  driveFileId: string;
  fileName: string;
  /** Drive's creation time of the snapshot file (ISO). */
  createdTime: string;
  /** When this device downloaded it. */
  loadedAt: Timestamp;
}

export interface Airport {
  /** ICAO code, primary key. */
  icao: string;
  name: string;
  lat: number;
  lon: number;
}

export type ThemePreference = 'system' | 'light' | 'dark';

/** Singleton settings row (key = 'main'). */
export interface Settings {
  key: 'main';
  deviceId: Uuid;
  deviceName: string;
  /** Explicit role. Never inferred from screen size. */
  isMaster: boolean;
  /** True once the user has made the first-run master/viewer choice. */
  setupDone: boolean;
  theme: ThemePreference;
  /** Look up aircraft photos online (Planespotters, then Wikimedia Commons). Only the registration is sent. */
  fetchAircraftPhotos: boolean;
  /** When the airports database was last imported (reference data, not backed up). */
  airportsImportedAt?: Timestamp | null;
  /** Name printed on the PDF logbook. */
  pilotName?: string;
  /** Expiry date of the SEP (land) class rating, for the revalidation check. */
  sepLandExpiry?: IsoDate | null;
  /** The user connected Google Drive on this device (backup on the master, snapshot loading on a viewer). */
  driveEnabled?: boolean;
  /** Epoch ms of the last successful Drive backup (phase 5). */
  lastBackupAt: Timestamp | null;
}
