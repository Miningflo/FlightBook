import type { ClassRating, Flight, IsoDate, Minutes } from './types';
import { addDays, addMonths, dateOfTimestamp, daysBetween } from './time';
import { DEFAULT_RULES, type Rules } from './rules';

/**
 * Currency checks (green / amber / red). All regulatory numbers come from rules.ts and are
 * unverified; see the TODOs there. `today` is a UTC date passed in, so everything is deterministic.
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
export function collectEvents(flights: Flight[], cls: ClassRating, night: boolean): Events {
  const out: Events = { takeoffs: [], landings: [] };
  for (const f of flights) {
    if (f.aircraftClass !== cls) continue;
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
export function passengerCurrency(flights: Flight[], cls: ClassRating, today: IsoDate, rules: Rules = DEFAULT_RULES): RollingCheck {
  return rollingCheck('passengers', collectEvents(flights, cls, false), rules.passenger, today, rules.app.amberDaysBeforeLapse);
}

/** Carrying passengers at night: night take-offs and landings of the class in the last 90 days. */
export function nightCurrency(flights: Flight[], cls: ClassRating, today: IsoDate, rules: Rules = DEFAULT_RULES): RollingCheck {
  return rollingCheck('night', collectEvents(flights, cls, true), rules.night, today, rules.app.amberDaysBeforeLapse);
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

export function sepRevalidation(flights: Flight[], expiry: IsoDate | null | undefined, today: IsoDate, rules: Rules = DEFAULT_RULES): SepCheck {
  const r = rules.sep;
  if (!expiry) return { id: 'sep', status: 'unknown', state: 'not-set', expiry: null, windowStart: null, daysToExpiry: null, progress: [] };

  // Window: the 12 months before expiry. The anniversary day itself is excluded (conservative).
  const windowStart = addDays(addMonths(expiry, -r.windowMonths), 1);
  const windowEnd = today < expiry ? today : expiry;
  let flightMin: Minutes = 0, picMin: Minutes = 0, dualMin: Minutes = 0, takeoffs = 0, landings = 0;
  for (const f of flights) {
    if (f.aircraftClass !== 'SEP_LAND' || f.date < windowStart || f.date > windowEnd) continue;
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
