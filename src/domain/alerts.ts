import type { AlertLevel, ClassRating, Flight, IsoDate } from './types';
import { CLASS_RATINGS, CLASS_RATING_LABELS } from './types';
import { classExpiryOf, irStatus, isExperienceClass, nightCurrency, nightExemptByIr, passengerCurrency, proficiencyCheckStatus, sepRevalidation, type RollingCheck } from './currency';
import { DEFAULT_RULES, type Rules } from './rules';
import { formatShortDate } from '../features/flights/format';

/**
 * Alerts: a notification when a currency or class rating gets worse (green -> amber -> red -> expired).
 * Pure: the caller passes the data, the date and the levels it last saw. Nothing here talks to the browser.
 */

export type { AlertLevel };
const RANK: Record<AlertLevel, number> = { green: 0, amber: 1, red: 2, expired: 3 };

export interface AlertItem {
  /** Stable id of the thing being watched, e.g. "SEP_LAND:passengers". */
  key: string;
  level: AlertLevel;
  title: string;
  body: string;
}

export interface AlertSettings {
  sepLandExpiry?: IsoDate | null;
  classExpiry?: Partial<Record<ClassRating, IsoDate>>;
  irExpiry?: IsoDate | null;
  alerts?: { enabled: boolean; night: boolean };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function currencyItem(cls: ClassRating, what: 'passengers' | 'night', c: RollingCheck): AlertItem {
  const name = CLASS_RATING_LABELS[cls];
  const label = what === 'passengers' ? 'Passenger currency' : 'Night currency';
  const level: AlertLevel = c.status === 'green' ? 'green' : c.status === 'amber' ? 'amber' : 'red';
  const body =
    level === 'green' ? 'Current.'
    : level === 'amber' ? `Lapses ${c.daysLeft === 0 ? 'after today' : `in ${plural(c.daysLeft ?? 0, 'day')}`}. Fly take-offs and landings to stay current.`
    : 'Not current: not enough take-offs and landings in the last 90 days.';
  return { key: `${cls}:${what}`, level, title: `${label} ${level === 'red' ? 'lapsed' : level === 'amber' ? 'expiring' : 'ok'}: ${name}`, body };
}

function ratingItem(cls: ClassRating, flights: Flight[], expiry: IsoDate, today: IsoDate, rules: Rules): AlertItem {
  const name = CLASS_RATING_LABELS[cls];
  const key = `${cls}:rating`;
  const date = formatShortDate(expiry);
  if (isExperienceClass(cls)) {
    const c = sepRevalidation(flights, expiry, today, rules, cls);
    const days = c.daysToExpiry ?? 0;
    if (c.state === 'expired') return { key, level: 'expired', title: `${name} rating expired`, body: `Expired on ${date}. It has to be renewed.` };
    if (c.state === 'urgent') return { key, level: 'red', title: `${name} rating: ${plural(days, 'day')} left`, body: `Revalidation requirements are still not met. Expires ${date}.` };
    if (c.state === 'in-progress') return { key, level: 'amber', title: `${name} rating expires in ${plural(days, 'day')}`, body: 'Revalidation requirements are not yet met.' };
    return { key, level: 'green', title: `${name} rating ok`, body: `Valid until ${date}.` };
  }
  const c = proficiencyCheckStatus(expiry, today, rules);
  const days = c.daysToExpiry ?? 0;
  if (c.state === 'expired') return { key, level: 'expired', title: `${name} rating expired`, body: `Expired on ${date}. It has to be renewed.` };
  if (c.state === 'urgent') return { key, level: 'red', title: `${name} rating: ${plural(days, 'day')} left`, body: `Book the proficiency check with an examiner now. Expires ${date}.` };
  if (c.state === 'window-open') return { key, level: 'amber', title: `${name}: proficiency check due`, body: `The check window is open; the rating expires in ${plural(days, 'day')} (${date}).` };
  return { key, level: 'green', title: `${name} rating ok`, body: `Valid until ${date}.` };
}

/** The instrument rating: its own expiry, and the thing that switches night currency off. */
function irItem(expiry: IsoDate, today: IsoDate, rules: Rules): AlertItem {
  const key = 'IR:rating';
  const date = formatShortDate(expiry);
  const c = irStatus(expiry, today, rules);
  const days = c.daysToExpiry ?? 0;
  if (c.state === 'expired') return { key, level: 'expired', title: 'Instrument rating expired', body: `Expired on ${date}. It has to be renewed, and night currency now applies again.` };
  if (c.state === 'urgent') return { key, level: 'red', title: `Instrument rating: ${plural(days, 'day')} left`, body: `Book the proficiency check with an examiner now. Expires ${date}.` };
  if (c.state === 'window-open') return { key, level: 'amber', title: 'Instrument rating: check due', body: `The check window is open; the rating expires in ${plural(days, 'day')} (${date}).` };
  return { key, level: 'green', title: 'Instrument rating ok', body: `Valid until ${date}.` };
}

/** The level of everything being watched right now (green items included). */
export function watchedItems(flights: Flight[], settings: AlertSettings, today: IsoDate, rules: Rules = DEFAULT_RULES): AlertItem[] {
  const items: AlertItem[] = [];
  const flown = new Set(flights.map((f) => f.aircraftClass));
  // an IR removes the night requirement altogether, so there is nothing to warn about while it is valid
  const includeNight = (settings.alerts?.night ?? true) && !nightExemptByIr(settings, today);
  for (const cls of CLASS_RATINGS) {
    if (cls === 'OTHER') continue;
    if (flown.has(cls)) {
      items.push(currencyItem(cls, 'passengers', passengerCurrency(flights, cls, today, rules)));
      if (includeNight) items.push(currencyItem(cls, 'night', nightCurrency(flights, cls, today, rules)));
    }
    const expiry = classExpiryOf(settings, cls);
    if (expiry) items.push(ratingItem(cls, flights, expiry, today, rules));
  }
  if (settings.irExpiry) items.push(irItem(settings.irExpiry, today, rules));
  return items;
}

export type AlertState = Record<string, AlertLevel>;

export interface AlertOutcome {
  /** Items that got worse since last time: these are what to notify about. */
  fresh: AlertItem[];
  /** The levels to remember for next time. */
  state: AlertState;
}

/**
 * Compares the watched items with the levels seen last time. Only a worse level notifies. An item with no
 * earlier level (first run, a new date entered) is remembered without notifying, so turning alerts on never
 * floods you with things you can already see. Better levels are remembered so a later worsening notifies again.
 */
export function alertOutcome(items: AlertItem[], previous: AlertState | undefined): AlertOutcome {
  const state: AlertState = {};
  const fresh: AlertItem[] = [];
  for (const it of items) {
    state[it.key] = it.level;
    const before = previous?.[it.key];
    if (before !== undefined && RANK[it.level] > RANK[before]) fresh.push(it);
  }
  fresh.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { fresh, state };
}
