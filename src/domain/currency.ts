import type { ClassRating, Flight, IsoDate, Minutes } from './types';
import { addDays, addMonths, dateOfTimestamp, daysBetween } from './time';
import { DEFAULT_RULES, type LanguageLevel, type Rules } from './rules';

/**
 * Currency checks (green / amber / red). All regulatory numbers come from rules.ts, checked against the EASA Easy Access Rules (October 2026 revision). `today` is a UTC date passed in, so everything is deterministic.
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

/** Take-offs and landings of one class, expanded to one entry per event. A landing is dated by its arrival. */
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

export type SepState = 'not-set' | 'window-not-open' | 'requirements-met' | 'in-progress' | 'urgent' | 'expired';

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

export function sepRevalidation(flights: Flight[], expiry: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES, cls: ClassRating = 'SEP_LAND'): SepCheck {
  const r = rules.sep;
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
  if (progress.every((p) => p.met)) return { ...base, status: 'green', state: 'requirements-met' };
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
function checkWindowStatus(expiry: IsoDate | null | undefined, today: IsoDate, windowMonths: number, redDaysLeft: number): ProficiencyCheck {
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

/** Route sectors for a type rating. Countable now that each flight names its rating (FCL.740.A(a)(2)). */
export function typeRouteSectors(flights: Flight[], typeRatingId: string, expiry: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): SectorProgress | null {
  if (!expiry) return null;
  const r = rules.mepSectors;
  const windowStart = addDays(addMonths(expiry, -r.validityMonths), 1);
  const windowEnd = today < expiry ? today : expiry;
  const inWindow = flights.filter((f) => f.typeRatingId === typeRatingId && f.date >= windowStart && f.date <= windowEnd);
  const routeFlights = inWindow.filter((f) => place(f.depPlace) !== place(f.arrPlace)).length;
  return {
    flights: inWindow.length, routeFlights, need: r.sectors, windowStart,
    met: routeFlights >= r.sectors, metIfLocalCount: inWindow.length >= r.sectors,
  };
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
  const e = settings.irExpiry;
  return !!e && daysBetween(today, e) >= 0;
}

/** Expiry date of a class rating from the settings (SEP (land) has its own field for backward compatibility). */
export function classExpiryOf(s: { sepLandExpiry?: IsoDate | null; classExpiry?: Partial<Record<ClassRating, IsoDate>> }, cls: ClassRating): IsoDate | null {
  return cls === 'SEP_LAND' ? s.sepLandExpiry ?? null : s.classExpiry?.[cls] ?? null;
}

/** Settings patch that sets (or clears, with null) the expiry date of a class rating. */
export function classExpiryPatch(s: { classExpiry?: Partial<Record<ClassRating, IsoDate>> }, cls: ClassRating, date: IsoDate | null): { sepLandExpiry: IsoDate | null } | { classExpiry: Partial<Record<ClassRating, IsoDate>> } {
  if (cls === 'SEP_LAND') return { sepLandExpiry: date };
  const next = { ...(s.classExpiry ?? {}) };
  if (date) next[cls] = date; else delete next[cls];
  return { classExpiry: next };
}

/** Multi-engine class ratings: route sectors during the validity period (FCL.740.A(a)(2)). */
export const SECTOR_CLASSES: readonly ClassRating[] = ['MEP_LAND', 'MEP_SEA'];

/**
 * Part-FCL asks for "route sectors" and never says what one is. The only definition EASA gives anywhere
 * is in Part-ORO, ORO.FTL.105: a sector is the segment between the aircraft first moving to take off and
 * coming to rest after landing -- one flight, block to block, with no requirement that it end somewhere
 * else. But FCL.740.A(a)(2) says "route" sector, and the usual reading of that is a flight from one
 * aerodrome to another, which would leave out local flying.
 *
 * Rather than pick one and present it as a count, both are reported: every flight in the class, and the
 * subset that landed away. `met` follows the narrow reading, because being told you are short when you
 * are not is the harmless way round -- the reverse lets a rating lapse.
 */
export interface SectorProgress {
  /** Every logged flight in the class in the validity period (ORO.FTL.105's reading of a sector). */
  flights: number;
  /** ...of which departed and landed at different aerodromes (the narrow reading of "route"). */
  routeFlights: number;
  need: number;
  windowStart: IsoDate;
  /** Met on the narrow reading. */
  met: boolean;
  /** Met only if local flights count too. */
  metIfLocalCount: boolean;
}

const place = (s: string) => s.trim().toUpperCase();

export function routeSectors(flights: Flight[], cls: ClassRating, expiry: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): SectorProgress | null {
  if (!expiry || !SECTOR_CLASSES.includes(cls)) return null;
  const r = rules.mepSectors;
  const windowStart = addDays(addMonths(expiry, -r.validityMonths), 1);
  const windowEnd = today < expiry ? today : expiry;
  const inWindow = flights.filter((f) => f.aircraftClass === cls && f.date >= windowStart && f.date <= windowEnd);
  const routeFlights = inWindow.filter((f) => place(f.depPlace) !== place(f.arrPlace)).length;
  return {
    flights: inWindow.length,
    routeFlights,
    need: r.sectors,
    windowStart,
    met: routeFlights >= r.sectors,
    metIfLocalCount: inWindow.length >= r.sectors,
  };
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
  expiry: IsoDate | null | undefined,
  today: IsoDate,
  o: { windowStart?: IsoDate | null; amberDaysLeft: number; redDaysLeft: number },
): ValidityCheck {
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
export function medicalStatus(expiry: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): ValidityCheck {
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
