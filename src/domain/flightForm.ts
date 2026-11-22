import type {
  Aircraft,
  ClassRating,
  EngineClass,
  Flight,
  IsoDate,
  Minutes,
  Overrides,
  Person,
} from './types';
import {
  type RoleState,
  applyRoleDefaults,
  emptyRoleState,
  roleStateFromFlight,
} from './roles';
import { blockMinutes, clockOfTimestamp, dateOfTimestamp, resolveBlockTimes } from './time';
import { normalizeRegistration } from './suggestions';

/**
 * Editable state of the flight form. Kept framework-free so the rules
 * (block time, role defaults, validation) are unit-testable without a DOM.
 */
export interface FlightFormState {
  date: IsoDate;
  depClock: string;
  arrClock: string;
  /** On-blocks date (UTC). Empty = automatic: the day of take-off, or the next day if the arrival clock is earlier. */
  arrDate: IsoDate | '';
  depPlace: string;
  arrPlace: string;

  registration: string;
  make: string;
  model: string;
  variant: string;
  aircraftClass: ClassRating;
  engineClass: EngineClass;

  picName: string;

  totalMin: Minutes;
  /** True once the user typed a total that differs from block time. */
  totalManual: boolean;
  roles: RoleState;

  takeoffsDay: number;
  takeoffsNight: number;
  landingsDay: number;
  landingsNight: number;
  nightMin: Minutes;
  ifrMin: Minutes;

  isPicus: boolean;
  isSpic: boolean;
  remarks: string;

  /** Latest computed values from sun position (null when airports/times are unknown). Never saved. */
  autoNight: AutoNight | null;
  /** True once the user chose a value instead of the computed one. Saved as `overrides`. */
  nightManual: boolean;
  takeoffsManual: boolean;
  landingsManual: boolean;
}

/** What the night calculation (phase 2) suggests for a flight. */
export interface AutoNight {
  nightMin: Minutes;
  takeoffNight: boolean;
  landingNight: boolean;
}

export interface FormDefaults {
  today: IsoDate;
  picName: string;
  registration?: string;
}

export function emptyForm(d: FormDefaults): FlightFormState {
  return {
    date: d.today,
    depClock: '',
    arrClock: '',
    arrDate: '',
    depPlace: '',
    arrPlace: '',
    registration: d.registration ?? '',
    make: '',
    model: '',
    variant: '',
    aircraftClass: 'SEP_LAND',
    engineClass: 'SP-SE',
    picName: d.picName,
    totalMin: 0,
    totalManual: false,
    roles: emptyRoleState(),
    takeoffsDay: 0,
    takeoffsNight: 0,
    landingsDay: 0,
    landingsNight: 0,
    nightMin: 0,
    ifrMin: 0,
    isPicus: false,
    isSpic: false,
    remarks: '',
    autoNight: null,
    nightManual: false,
    takeoffsManual: false,
    landingsManual: false,
  };
}

export function engineClassOfFlight(f: Pick<Flight, 'spSeMin' | 'spMeMin' | 'mpMin'>): EngineClass {
  if (f.mpMin > 0) return 'MP';
  if (f.spMeMin > 0) return 'SP-ME';
  return 'SP-SE';
}

export function formFromFlight(f: Flight, picName: string): FlightFormState {
  const block = minutesBetweenClocks(f);
  return {
    date: f.date,
    depClock: clockOfTimestamp(f.depTimeUtc),
    arrClock: clockOfTimestamp(f.arrTimeUtc),
    // Automatic unless the stored landing is not where the automatic rule would put it.
    arrDate: resolveBlockTimes(f.date, clockOfTimestamp(f.depTimeUtc), clockOfTimestamp(f.arrTimeUtc))?.arr === f.arrTimeUtc ? '' : dateOfTimestamp(f.arrTimeUtc),
    depPlace: f.depPlace,
    arrPlace: f.arrPlace,
    registration: f.registration,
    make: f.aircraftMake,
    model: f.aircraftModel,
    variant: f.aircraftVariant,
    aircraftClass: f.aircraftClass,
    engineClass: engineClassOfFlight(f),
    picName,
    totalMin: f.totalMin,
    totalManual: f.overrides.totalMin === true || f.totalMin !== block,
    roles: roleStateFromFlight(f),
    takeoffsDay: f.takeoffsDay,
    takeoffsNight: f.takeoffsNight,
    landingsDay: f.landingsDay,
    landingsNight: f.landingsNight,
    nightMin: f.nightMin,
    ifrMin: f.ifrMin,
    isPicus: f.isPicus,
    isSpic: f.isSpic,
    remarks: f.remarks,
    autoNight: null,
    nightManual: f.overrides.nightMin === true,
    takeoffsManual: f.overrides.takeoffsDay === true || f.overrides.takeoffsNight === true,
    landingsManual: f.overrides.landingsDay === true || f.overrides.landingsNight === true,
  };
}

function minutesBetweenClocks(f: Flight): Minutes {
  return Math.round((f.arrTimeUtc - f.depTimeUtc) / 60_000);
}

/**
 * Apply a patch and re-derive the dependent fields:
 *  - total follows block time (off/on-blocks) until the user types their own total
 *  - selected roles that weren't manually edited follow the total
 */
export function updateForm(state: FlightFormState, patch: Partial<FlightFormState>): FlightFormState {
  const next: FlightFormState = { ...state, ...patch };
  if (!next.totalManual) {
    next.totalMin = blockMinutes(next.date, next.depClock, next.arrClock, next.arrDate) ?? 0;
  }
  next.roles = applyRoleDefaults(patch.roles ?? next.roles, next.totalMin);
  return next;
}

/** Set an explicit total. Setting it back to block time returns to automatic mode. */
export function setTotal(state: FlightFormState, totalMin: Minutes): FlightFormState {
  const block = blockMinutes(state.date, state.depClock, state.arrClock, state.arrDate);
  const manual = block === null || totalMin !== block;
  return updateForm(state, { totalMin, totalManual: manual });
}

/** Re-enable automatic total (block time). */
export function resetTotal(state: FlightFormState): FlightFormState {
  return updateForm(state, { totalManual: false });
}

/** Day/night split of the single take-off (departure) or landing (arrival) the calculation assumes. */
export function autoCounts(night: boolean): { day: number; night: number } {
  return night ? { day: 0, night: 1 } : { day: 1, night: 0 };
}

/**
 * Feed a fresh night calculation into the form.
 *  - 'follow' (new flights and live edits): fields the user has not chosen follow the computed value.
 *  - 'adopt' (when an existing flight is opened): stored values are NEVER changed. Any stored value
 *    that differs from the computed one is kept and marked as an override, so opening a flight for
 *    editing cannot silently rewrite what was logged.
 * With `auto = null` nothing changes except that the computed values are forgotten.
 */
export function applyAuto(s: FlightFormState, auto: AutoNight | null, mode: 'follow' | 'adopt'): FlightFormState {
  if (!auto) return { ...s, autoNight: null };
  const to = autoCounts(auto.takeoffNight);
  const ld = autoCounts(auto.landingNight);
  const next: FlightFormState = { ...s, autoNight: auto };
  if (mode === 'adopt') {
    if (!next.nightManual && next.nightMin !== auto.nightMin) next.nightManual = true;
    if (!next.takeoffsManual && (next.takeoffsDay !== to.day || next.takeoffsNight !== to.night)) next.takeoffsManual = true;
    if (!next.landingsManual && (next.landingsDay !== ld.day || next.landingsNight !== ld.night)) next.landingsManual = true;
    return next;
  }
  if (!next.nightManual) next.nightMin = auto.nightMin;
  if (!next.takeoffsManual) { next.takeoffsDay = to.day; next.takeoffsNight = to.night; }
  if (!next.landingsManual) { next.landingsDay = ld.day; next.landingsNight = ld.night; }
  return next;
}

/** User typed a night time. Equal to the computed value means "not an override". */
export function setNightMinutes(s: FlightFormState, min: Minutes): FlightFormState {
  return { ...s, nightMin: min, nightManual: s.autoNight ? min !== s.autoNight.nightMin : true };
}

/** User changed a take-off count. The day and night counts are treated as one value. */
export function setTakeoffs(s: FlightFormState, patch: { takeoffsDay?: number; takeoffsNight?: number }): FlightFormState {
  const next = { ...s, ...patch };
  const to = s.autoNight ? autoCounts(s.autoNight.takeoffNight) : null;
  next.takeoffsManual = to ? !(next.takeoffsDay === to.day && next.takeoffsNight === to.night) : true;
  return next;
}

export function setLandings(s: FlightFormState, patch: { landingsDay?: number; landingsNight?: number }): FlightFormState {
  const next = { ...s, ...patch };
  const ld = s.autoNight ? autoCounts(s.autoNight.landingNight) : null;
  next.landingsManual = ld ? !(next.landingsDay === ld.day && next.landingsNight === ld.night) : true;
  return next;
}

/** Drop an override and go back to the computed value. */
export function resetToComputed(s: FlightFormState, which: 'night' | 'takeoffs' | 'landings'): FlightFormState {
  const a = s.autoNight;
  if (!a) return s;
  if (which === 'night') return { ...s, nightMin: a.nightMin, nightManual: false };
  if (which === 'takeoffs') { const c = autoCounts(a.takeoffNight); return { ...s, takeoffsDay: c.day, takeoffsNight: c.night, takeoffsManual: false }; }
  const c = autoCounts(a.landingNight);
  return { ...s, landingsDay: c.day, landingsNight: c.night, landingsManual: false };
}

/** The fields a user can actually edit, for "unsaved changes" detection (excludes computed bookkeeping). */
export function editableSnapshot(s: FlightFormState): string {
  const { autoNight: _a, nightManual: _n, takeoffsManual: _t, landingsManual: _l, ...rest } = s;
  return JSON.stringify(rest);
}

/** Fill aircraft details from a known aircraft record. */
export function applyAircraft(state: FlightFormState, a: Aircraft): FlightFormState {
  return updateForm(state, {
    registration: a.registration,
    make: a.make,
    model: a.model,
    variant: a.variant,
    aircraftClass: a.classRating,
    engineClass: a.engineClass,
  });
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

const ICAO_RE = /^[A-Z]{4}$/;

export function validateForm(s: FlightFormState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ field, message, severity: 'error' });
  const warn = (field: string, message: string) => issues.push({ field, message, severity: 'warning' });

  const times = resolveBlockTimes(s.date, s.depClock, s.arrClock, s.arrDate);
  if (!times) {
    err('times', 'Enter a valid date and off-blocks / on-blocks times (UTC).');
  } else if (times.arr === times.dep) {
    err('times', 'On-blocks time equals off-blocks time.');
  } else if (times.arr < times.dep) {
    err('times', 'On-blocks is before off-blocks. Check the on-blocks date.');
  } else if (times.arr - times.dep > 24 * 3_600_000) {
    warn('times', 'This flight is longer than 24 hours. Check the dates.');
  }

  if (!s.depPlace.trim()) err('depPlace', 'Departure place is required.');
  else if (!ICAO_RE.test(s.depPlace.trim().toUpperCase())) warn('depPlace', 'Not a 4-letter ICAO code; night calculation will need manual input.');
  if (!s.arrPlace.trim()) err('arrPlace', 'Arrival place is required.');
  else if (!ICAO_RE.test(s.arrPlace.trim().toUpperCase())) warn('arrPlace', 'Not a 4-letter ICAO code; night calculation will need manual input.');

  if (!normalizeRegistration(s.registration)) err('registration', 'Registration is required.');
  if (!s.make.trim()) err('make', 'Aircraft make is required.');
  if (!s.model.trim()) err('model', 'Aircraft model is required.');
  if (!s.picName.trim()) err('picName', 'Name of PIC is required (use SELF if you were PIC).');

  if (s.totalMin <= 0) err('totalMin', 'Total flight time must be greater than zero.');

  const counts: [string, number][] = [
    ['takeoffsDay', s.takeoffsDay],
    ['takeoffsNight', s.takeoffsNight],
    ['landingsDay', s.landingsDay],
    ['landingsNight', s.landingsNight],
  ];
  for (const [field, v] of counts) {
    if (!Number.isInteger(v) || v < 0) err(field, 'Must be a whole number, zero or more.');
  }

  for (const [field, label, v] of [
    ['nightMin', 'Night time', s.nightMin],
    ['ifrMin', 'IFR time', s.ifrMin],
  ] as const) {
    if (!Number.isInteger(v) || v < 0) err(field, `${label} must be zero or more.`);
    else if (v > s.totalMin) err(field, `${label} exceeds total flight time.`);
  }

  for (const [role, e] of Object.entries(s.roles)) {
    if (e.on && e.min > s.totalMin) err(`role-${role}`, `${role} time exceeds total flight time.`);
    if (e.on && e.min < 0) err(`role-${role}`, `${role} time must be zero or more.`);
  }
  const anyRole = Object.values(s.roles).some((e) => e.on);
  if (!anyRole) warn('roles', 'No pilot function selected (PIC / COPI / DUAL / INS).');
  if (s.roles.PIC.on && s.roles.DUAL.on) warn('roles', 'PIC and DUAL are both selected; check this is intended.');
  if (s.isPicus && s.engineClass !== 'MP') warn('isPicus', 'PICUS is normally logged on multi-pilot flights.');
  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** The persistable part of a flight, before ids/timestamps and aircraft/person resolution. */
export interface FlightInput {
  date: IsoDate;
  depPlace: string;
  depTimeUtc: number;
  arrPlace: string;
  arrTimeUtc: number;
  registration: string;
  aircraftMake: string;
  aircraftModel: string;
  aircraftVariant: string;
  aircraftClass: ClassRating;
  engineClass: EngineClass;
  picName: string;
  spSeMin: Minutes;
  spMeMin: Minutes;
  mpMin: Minutes;
  totalMin: Minutes;
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
  isPicus: boolean;
  isSpic: boolean;
  remarks: string;
  attachmentIds: string[];
  overrides: Overrides;
}

/**
 * Convert validated form state to a flight input.
 * Throws if the form has errors, so invalid data can never be persisted by accident.
 * `previousOverrides` carries any override keys the form does not manage.
 */
export function formToFlightInput(
  s: FlightFormState,
  extra: { attachmentIds?: string[]; previousOverrides?: Overrides } = {},
): FlightInput {
  if (hasErrors(validateForm(s))) throw new Error('Flight form has validation errors');
  const times = resolveBlockTimes(s.date, s.depClock, s.arrClock, s.arrDate)!;
  const overrides: Overrides = { ...(extra.previousOverrides ?? {}) };
  const flag = (key: keyof Overrides, on: boolean) => { if (on) overrides[key] = true; else delete overrides[key]; };
  flag('totalMin', s.totalManual);
  flag('nightMin', s.nightManual);
  flag('takeoffsDay', s.takeoffsManual);
  flag('takeoffsNight', s.takeoffsManual);
  flag('landingsDay', s.landingsManual);
  flag('landingsNight', s.landingsManual);
  return {
    date: dateOfTimestamp(times.dep),
    depPlace: s.depPlace.trim().toUpperCase(),
    depTimeUtc: times.dep,
    arrPlace: s.arrPlace.trim().toUpperCase(),
    arrTimeUtc: times.arr,
    registration: normalizeRegistration(s.registration),
    aircraftMake: s.make.trim(),
    aircraftModel: s.model.trim(),
    aircraftVariant: s.variant.trim(),
    aircraftClass: s.aircraftClass,
    engineClass: s.engineClass,
    picName: s.picName.trim(),
    spSeMin: s.engineClass === 'SP-SE' ? s.totalMin : 0,
    spMeMin: s.engineClass === 'SP-ME' ? s.totalMin : 0,
    mpMin: s.engineClass === 'MP' ? s.totalMin : 0,
    totalMin: s.totalMin,
    takeoffsDay: s.takeoffsDay,
    takeoffsNight: s.takeoffsNight,
    landingsDay: s.landingsDay,
    landingsNight: s.landingsNight,
    nightMin: s.nightMin,
    ifrMin: s.ifrMin,
    picMin: s.roles.PIC.on ? s.roles.PIC.min : 0,
    copiMin: s.roles.COPI.on ? s.roles.COPI.min : 0,
    dualMin: s.roles.DUAL.on ? s.roles.DUAL.min : 0,
    instMin: s.roles.INS.on ? s.roles.INS.min : 0,
    isPicus: s.isPicus,
    isSpic: s.isSpic,
    remarks: s.remarks.trim(),
    attachmentIds: extra.attachmentIds ?? [],
    overrides,
  };
}

/** Convenience for resolving the PIC display name of a stored flight. */
export function picNameOf(f: Pick<Flight, 'picNameId'>, persons: Person[]): string {
  return persons.find((p) => p.id === f.picNameId)?.name ?? '?';
}
