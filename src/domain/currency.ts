import type { ClassRating, Flight, IsoDate, Minutes } from './types';
import { CLASS_RATINGS } from './types';
import { addDays, addMonths, dateOfTimestamp, daysBetween, isValidIsoDate } from './time';
import { DEFAULT_RULES, type LanguageLevel, type Rules } from './rules';

/**
 * Currency checks (green / amber / red). All regulatory numbers come from rules.ts, checked against the EASA Easy Access Rules (October 2026 revision). `today` is a calendar date passed in (the app uses checkDate in time.ts), so everything is deterministic.
 */

export type Status = 'green' | 'amber' | 'red' | 'unknown';

export type RollingState = 'current' | 'expiring' | 'lapsed';

export interface RollingCurrency {
  /** Events inside the window ending today. */
  count: number;
  need: number;
  state: RollingState;
  /** Last day on which the condition still holds; null if there are too few events ever. */
  validUntil: IsoDate | null;
  daysLeft: number | null;
}

/** One take-off or landing per element, dated. */
export interface Events {
  takeoffs: IsoDate[];
  landings: IsoDate[];
}

const repeat = (date: IsoDate, n: number): IsoDate[] => Array.from({ length: Math.max(0, n) }, () => date);

/**
 * An expiry date as entered, or null if there is none that can be read. Date arithmetic throws on anything
 * else, and an earlier version could import a badly written date; "not set" lets the screen ask for it again.
 */
export const readableDate = (d: IsoDate | null | undefined): IsoDate | null => (d && isValidIsoDate(d) ? d : null);

/**
 * What a currency is counted over. FCL.060(b) says "an aircraft of the same type or class", so these
 * are the two things the regulation recognises, and the app follows it rather than always using class:
 * for a type-rated pilot, landings in a King Air say nothing about currency on a 737.
 */
export type CurrencyScope =
  | { kind: 'class'; cls: ClassRating }
  | { kind: 'type'; typeRatingId: string };

export const byClass = (cls: ClassRating): CurrencyScope => ({ kind: 'class', cls });
export const byType = (typeRatingId: string): CurrencyScope => ({ kind: 'type', typeRatingId });

export const inScope = (f: Flight, scope: CurrencyScope): boolean =>
  scope.kind === 'class' ? f.aircraftClass === scope.cls : f.typeRatingId === scope.typeRatingId;

/** Take-offs and landings in the scope, expanded to one entry per event. A landing is dated by its arrival. */
export function collectEvents(flights: Flight[], scope: CurrencyScope, night: boolean): Events {
  const out: Events = { takeoffs: [], landings: [] };
  for (const f of flights) {
    if (!inScope(f, scope)) continue;
    out.takeoffs.push(...repeat(f.date, night ? f.takeoffsNight : f.takeoffsDay + f.takeoffsNight));
    out.landings.push(...repeat(dateOfTimestamp(f.arrTimeUtc), night ? f.landingsNight : f.landingsDay + f.landingsNight));
  }
  return out;
}

/**
 * "At least `need` events in the preceding `windowDays` days." An event counts on its own day and the
 * next windowDays-1 days (conservative reading, see rules.ts). Events after `today` are ignored.
 * The condition lapses after (need-th most recent event) + windowDays - 1.
 */
export function rolling(dates: IsoDate[], need: number, windowDays: number, today: IsoDate, amberDays: number): RollingCurrency {
  const past = dates.filter((d) => d <= today).sort().reverse();
  const count = past.filter((d) => daysBetween(d, today) <= windowDays - 1).length;
  if (need <= 0) return { count, need, state: 'current', validUntil: null, daysLeft: null };
  const nth = past[need - 1];
  if (nth === undefined) return { count, need, state: 'lapsed', validUntil: null, daysLeft: null };
  const validUntil = addDays(nth, windowDays - 1);
  const daysLeft = daysBetween(today, validUntil);
  const state: RollingState = daysLeft < 0 ? 'lapsed' : daysLeft <= amberDays ? 'expiring' : 'current';
  return { count, need, state, validUntil, daysLeft };
}

const SEVERITY: Record<RollingState, number> = { current: 0, expiring: 1, lapsed: 2 };

export interface RollingCheck {
  id: 'passengers' | 'night';
  status: Status;
  state: RollingState;
  takeoffs: RollingCurrency;
  landings: RollingCurrency;
  /** Earliest lapse date of the two conditions; null if already lapsed with no history. */
  validUntil: IsoDate | null;
  daysLeft: number | null;
}

const toStatus = (s: RollingState): Status => (s === 'current' ? 'green' : s === 'expiring' ? 'amber' : 'red');

function rollingCheck(id: 'passengers' | 'night', events: Events, r: { windowDays: number; takeoffs: number; landings: number }, today: IsoDate, amber: number): RollingCheck {
  const takeoffs = rolling(events.takeoffs, r.takeoffs, r.windowDays, today, amber);
  const landings = rolling(events.landings, r.landings, r.windowDays, today, amber);
  const state = SEVERITY[takeoffs.state] >= SEVERITY[landings.state] ? takeoffs.state : landings.state;
  const dated = [takeoffs, landings].filter((x) => x.validUntil !== null);
  const worst = dated.length === 0 ? null : dated.reduce((a, b) => (a.validUntil! <= b.validUntil! ? a : b));
  return { id, status: toStatus(state), state, takeoffs, landings, validUntil: worst?.validUntil ?? null, daysLeft: worst?.daysLeft ?? null };
}

/** Carrying passengers: take-offs and landings of the class in the last 90 days. */
export function passengerCurrency(flights: Flight[], scope: CurrencyScope, today: IsoDate, rules: Rules = DEFAULT_RULES): RollingCheck {
  return rollingCheck('passengers', collectEvents(flights, scope, false), rules.passenger, today, rules.app.amberDaysBeforeLapse);
}

/** Carrying passengers at night: night take-offs and landings of the class in the last 90 days. */
export function nightCurrency(flights: Flight[], scope: CurrencyScope, today: IsoDate, rules: Rules = DEFAULT_RULES): RollingCheck {
  return rollingCheck('night', collectEvents(flights, scope, true), rules.night, today, rules.app.amberDaysBeforeLapse);
}

// ---------- SEP class rating: revalidation by experience ----------

export type SepState = 'not-set' | 'window-not-open' | 'requirements-met' | 'met-sign-off' | 'in-progress' | 'urgent' | 'expired';

export interface Progress {
  key: 'flight' | 'pic' | 'takeoffs' | 'landings' | 'training';
  have: number;
  need: number;
  unit: 'min' | 'count';
  met: boolean;
}

export interface SepCheck {
  id: 'sep';
  status: Status;
  state: SepState;
  expiry: IsoDate | null;
  /** Experience must be gained from this day (inclusive) to the expiry date. */
  windowStart: IsoDate | null;
  daysToExpiry: number | null;
  progress: Progress[];
}

/** Classes that can be revalidated by experience; all others need a proficiency check. */
export const EXPERIENCE_REVALIDATION_CLASSES: readonly ClassRating[] = ['SEP_LAND', 'SEP_SEA', 'TMG'];
export const isExperienceClass = (cls: ClassRating): boolean => EXPERIENCE_REVALIDATION_CLASSES.includes(cls);

export function sepRevalidation(flights: Flight[], entered: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES, cls: ClassRating = 'SEP_LAND'): SepCheck {
  const r = rules.sep;
  const expiry = readableDate(entered);
  if (!expiry) return { id: 'sep', status: 'unknown', state: 'not-set', expiry: null, windowStart: null, daysToExpiry: null, progress: [] };

  // Window: the 12 months before expiry. The anniversary day itself is excluded (conservative).
  const windowStart = addDays(addMonths(expiry, -r.windowMonths), 1);
  const windowEnd = today < expiry ? today : expiry;
  let flightMin: Minutes = 0, picMin: Minutes = 0, dualMin: Minutes = 0, takeoffs = 0, landings = 0;
  for (const f of flights) {
    if (f.aircraftClass !== cls || f.date < windowStart || f.date > windowEnd) continue;
    flightMin += f.totalMin; picMin += f.picMin; dualMin += f.dualMin;
    takeoffs += f.takeoffsDay + f.takeoffsNight;
    landings += f.landingsDay + f.landingsNight;
  }
  const mk = (key: Progress['key'], have: number, need: number, unit: Progress['unit']): Progress => ({ key, have, need, unit, met: have >= need });
  const progress = [
    mk('flight', flightMin, r.flightMin, 'min'),
    mk('pic', picMin, r.picMin, 'min'),
    mk('takeoffs', takeoffs, r.takeoffs, 'count'),
    mk('landings', landings, r.landings, 'count'),
    mk('training', dualMin, r.instructorTrainingMin, 'min'),
  ];
  const daysToExpiry = daysBetween(today, expiry);
  const base = { id: 'sep' as const, expiry, windowStart, daysToExpiry, progress };
  if (daysToExpiry < 0) return { ...base, status: 'red', state: 'expired' };
  if (progress.every((p) => p.met)) {
    // Met is not the same as revalidated: until a new expiry date is entered the old one still stands, so
    // close to it the card asks for the revalidation to be entered rather than staying green to the end.
    return daysToExpiry <= rules.app.revalidationSignOffAmberDaysLeft
      ? { ...base, status: 'amber', state: 'met-sign-off' }
      : { ...base, status: 'green', state: 'requirements-met' };
  }
  if (today < windowStart) return { ...base, status: 'green', state: 'window-not-open' };
  if (daysToExpiry <= rules.app.revalidationRedDaysLeft) return { ...base, status: 'red', state: 'urgent' };
  return { ...base, status: 'amber', state: 'in-progress' };
}

// ---------- MEP / SET (and sea): revalidation by proficiency check ----------

export type CheckState = 'not-set' | 'window-not-open' | 'window-open' | 'urgent' | 'expired';

export interface ProficiencyCheck {
  id: 'check';
  status: Status;
  state: CheckState;
  expiry: IsoDate | null;
  /** The proficiency check may be taken from this day (inclusive) until expiry. */
  windowStart: IsoDate | null;
  daysToExpiry: number | null;
}

/**
 * A rating revalidated by a proficiency check inside a window before its expiry date. The shape is the
 * same for class ratings (FCL.740.A(a)(1), (b)(3)) and for the instrument rating (FCL.625(b)(1)), so both
 * go through here and only the window and the red threshold differ.
 */
function checkWindowStatus(entered: IsoDate | null | undefined, today: IsoDate, windowMonths: number, redDaysLeft: number): ProficiencyCheck {
  const expiry = readableDate(entered);
  if (!expiry) return { id: 'check', status: 'unknown', state: 'not-set', expiry: null, windowStart: null, daysToExpiry: null };
  const windowStart = addDays(addMonths(expiry, -windowMonths), 1);
  const daysToExpiry = daysBetween(today, expiry);
  const base = { id: 'check' as const, expiry, windowStart, daysToExpiry };
  if (daysToExpiry < 0) return { ...base, status: 'red', state: 'expired' };
  if (today < windowStart) return { ...base, status: 'green', state: 'window-not-open' };
  if (daysToExpiry <= redDaysLeft) return { ...base, status: 'red', state: 'urgent' };
  return { ...base, status: 'amber', state: 'window-open' };
}

export function proficiencyCheckStatus(expiry: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): ProficiencyCheck {
  return checkWindowStatus(expiry, today, rules.proficiencyCheck.windowMonths, rules.app.proficiencyCheckRedDaysLeft);
}

// ---------- instrument rating ----------

/**
 * Flights logged under OTHER that count towards none of the type ratings held: either they name no
 * rating, or they name one that is no longer in the list (removed, or brought in by an import from a
 * logbook whose ratings had other ids). Either way they count towards no currency at all, so the
 * number has to be shown rather than quietly dropped. `ratings` is required for that reason: without
 * it a flight pointing at a removed rating would look assigned and vanish from every count.
 */
export function unassignedTypeFlights(flights: Flight[], ratings: readonly { id: string }[]): Flight[] {
  const held = new Set(ratings.map((r) => r.id));
  return flights.filter((f) => f.aircraftClass === 'OTHER' && !(f.typeRatingId && held.has(f.typeRatingId)));
}

/**
 * Which held type rating a flight counts towards. `none` is a flight in the Other class that names no
 * rating; `removed` names one that is no longer held. Both count towards nothing (see above). Flights in
 * a class rating are `class`: the question does not apply to them.
 */
export type TypeRatingLink<R> = { kind: 'class' } | { kind: 'held'; rating: R } | { kind: 'none' } | { kind: 'removed' };
export function typeRatingOf<R extends { id: string }>(f: Flight, ratings: readonly R[]): TypeRatingLink<R> {
  if (f.aircraftClass !== 'OTHER') return { kind: 'class' };
  if (!f.typeRatingId) return { kind: 'none' };
  const rating = ratings.find((r) => r.id === f.typeRatingId);
  return rating ? { kind: 'held', rating } : { kind: 'removed' };
}

/**
 * The class chips on the Currency screen. Every real class is always offered, so an expiry date can be
 * entered before any flight is logged. Other is offered once there is something behind it: a flight
 * logged under it, or a type rating held. A rating with no flights yet then shows as not current, the
 * same way an empty class does, instead of not showing at all.
 */
export function currencyClasses(flights: Flight[], ratings: readonly { id: string }[]): ClassRating[] {
  const other = ratings.length > 0 || flights.some((f) => f.aircraftClass === 'OTHER');
  return CLASS_RATINGS.filter((c) => c !== 'OTHER' || other);
}

/** Route sectors for a type rating (FCL.740.A(a)(2)), counted per rating since each flight names its rating. */
export function typeRouteSectors(flights: Flight[], typeRatingId: string, entered: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): SectorProgress | null {
  const expiry = readableDate(entered);
  if (!expiry) return null;
  return sectorProgress(flights.filter((f) => f.typeRatingId === typeRatingId), expiry, today, rules);
}

/** Status of one type rating (FCL.740.A(a)(1)): the same check window as a multi-engine class rating. */
export function typeRatingStatus(expiry: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): ProficiencyCheck {
  return checkWindowStatus(expiry, today, rules.typeRating.windowMonths, rules.app.proficiencyCheckRedDaysLeft);
}

/** Status of the instrument rating itself (FCL.625): valid 1 year, check in the last 3 months. */
export function irStatus(expiry: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): ProficiencyCheck {
  return checkWindowStatus(expiry, today, rules.ir.windowMonths, rules.app.proficiencyCheckRedDaysLeft);
}

/**
 * Whether the night recent-experience requirement falls away (FCL.060(b)(2)(ii)).
 *
 * Deliberately requires the rating to be unexpired. The regulation says "holds an IR" without saying
 * "valid", but an expired IR cannot be exercised, and claiming an exemption the pilot does not have is
 * the dangerous way to be wrong; showing night currency to someone who is in fact exempt is not.
 */
export function nightExemptByIr(settings: { irExpiry?: IsoDate | null }, today: IsoDate): boolean {
  const e = readableDate(settings.irExpiry);
  return !!e && daysBetween(today, e) >= 0;
}

/** Expiry date of a class rating from the settings (SEP (land) has its own field for backward compatibility). */
export function classExpiryOf(s: { sepLandExpiry?: IsoDate | null; classExpiry?: Partial<Record<ClassRating, IsoDate>> }, cls: ClassRating): IsoDate | null {
  return readableDate(cls === 'SEP_LAND' ? s.sepLandExpiry : s.classExpiry?.[cls]);
}

/** Settings patch that sets (or clears, with null) the expiry date of a class rating. */
export function classExpiryPatch(s: { classExpiry?: Partial<Record<ClassRating, IsoDate>> }, cls: ClassRating, date: IsoDate | null): { sepLandExpiry: IsoDate | null } | { classExpiry: Partial<Record<ClassRating, IsoDate>> } {
  if (cls === 'SEP_LAND') return { sepLandExpiry: date };
  const next = { ...s.classExpiry };
  if (date) next[cls] = date; else delete next[cls];
  return { classExpiry: next };
}

/** Multi-engine class ratings: route sectors during the validity period (FCL.740.A(a)(2)). */
export const SECTOR_CLASSES: readonly ClassRating[] = ['MEP_LAND', 'MEP_SEA'];

/** Classes and aeroplanes whose flights can be marked as route sectors: multi-engine classes and type ratings. */
export const routeSectorApplies = (cls: ClassRating): boolean => SECTOR_CLASSES.includes(cls) || cls === 'OTHER';

/**
 * FCL.010 defines a route sector: "a flight comprising take-off, departure, cruise of not less than 15
 * minutes, arrival, approach and landing phases". The logbook records block times, not the cruise, so it
 * cannot tell which flights qualify: a local flight with 15 minutes of cruise is one, a short hop to the
 * next aerodrome may not be. So only flights the pilot marked as route sectors on the form are counted,
 * and the ones not marked are listed so they can be checked. Guessing from the aerodromes or the block
 * time could count a flight that is not a sector, which would let the rating lapse unnoticed.
 */
export interface SectorProgress {
  /** Every logged flight in the class (or under the type rating) in the validity period. */
  flights: number;
  /** ...of which marked as route sectors. Only these count. */
  sectors: number;
  /** The flights in the period not marked as route sectors, newest first, to be checked. */
  unmarked: Flight[];
  need: number;
  windowStart: IsoDate;
  met: boolean;
}

function sectorProgress(candidates: Flight[], expiry: IsoDate, today: IsoDate, rules: Rules): SectorProgress {
  const r = rules.mepSectors;
  const windowStart = addDays(addMonths(expiry, -r.validityMonths), 1);
  const windowEnd = today < expiry ? today : expiry;
  const inWindow = candidates.filter((f) => f.date >= windowStart && f.date <= windowEnd);
  const sectors = inWindow.filter((f) => f.routeSector === true).length;
  const unmarked = inWindow.filter((f) => f.routeSector !== true).sort((a, b) => b.depTimeUtc - a.depTimeUtc);
  return { flights: inWindow.length, sectors, unmarked, need: r.sectors, windowStart, met: sectors >= r.sectors };
}

export function routeSectors(flights: Flight[], cls: ClassRating, entered: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): SectorProgress | null {
  const expiry = readableDate(entered);
  if (!expiry || !SECTOR_CLASSES.includes(cls)) return null;
  return sectorProgress(flights.filter((f) => f.aircraftClass === cls), expiry, today, rules);
}

// ---------- licence documents: medical certificate and language endorsement ----------

/**
 * Documents that simply run out on a date, as opposed to ratings revalidated by a check inside a
 * window. `windowStart`, where a rule gives one, is the first day the renewal may be done.
 */
export type ValidityState = 'not-set' | 'no-expiry' | 'valid' | 'due' | 'urgent' | 'expired';

export interface ValidityCheck {
  status: Status;
  state: ValidityState;
  expiry: IsoDate | null;
  windowStart: IsoDate | null;
  daysToExpiry: number | null;
}

function validityStatus(
  entered: IsoDate | null | undefined,
  today: IsoDate,
  o: { windowStart?: IsoDate | null; amberDaysLeft: number; redDaysLeft: number },
): ValidityCheck {
  const expiry = readableDate(entered);
  if (!expiry) return { status: 'unknown', state: 'not-set', expiry: null, windowStart: null, daysToExpiry: null };
  const daysToExpiry = daysBetween(today, expiry);
  const windowStart = o.windowStart ?? null;
  const base = { expiry, windowStart, daysToExpiry };
  if (daysToExpiry < 0) return { ...base, status: 'red', state: 'expired' };
  if (daysToExpiry <= o.redDaysLeft) return { ...base, status: 'red', state: 'urgent' };
  if (daysToExpiry <= o.amberDaysLeft || (windowStart !== null && today >= windowStart)) return { ...base, status: 'amber', state: 'due' };
  return { ...base, status: 'green', state: 'valid' };
}

/** Medical certificate (MED.A.045). The 45-day revalidation window is regulatory; the colours are ours. */
export function medicalStatus(entered: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): ValidityCheck {
  const expiry = readableDate(entered);
  return validityStatus(expiry, today, {
    windowStart: expiry ? addDays(expiry, -rules.medical.revalidationWindowDays) : null,
    amberDaysLeft: rules.app.licenceAmberDaysLeft,
    redDaysLeft: rules.app.licenceRedDaysLeft,
  });
}

/**
 * Language proficiency endorsement (FCL.055(c)). Level 6 is not re-evaluated, so it reports
 * `no-expiry` rather than pretending a date it does not have.
 */
export function languageStatus(
  level: LanguageLevel | null | undefined,
  expiry: IsoDate | null | undefined,
  today: IsoDate,
  rules: Rules = DEFAULT_RULES,
): ValidityCheck {
  if (level && rules.language.yearsByLevel[level] === null) {
    return { status: 'green', state: 'no-expiry', expiry: null, windowStart: null, daysToExpiry: null };
  }
  return validityStatus(expiry, today, { amberDaysLeft: rules.app.licenceAmberDaysLeft, redDaysLeft: rules.app.licenceRedDaysLeft });
}
