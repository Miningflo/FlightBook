import type { AlertLevel, ClassRating, Flight, IsoDate, TypeRating } from './types';
import { CLASS_RATINGS, CLASS_RATING_LABELS } from './types';
import { daysBetween } from './time';
import { byClass, byType, classExpiryOf, irStatus, isExperienceClass, languageStatus, medicalStatus, nightCurrency, nightExemptByIr, passengerCurrency, proficiencyCheckStatus, readableDate, routeSectors, sepRevalidation, typeRatingStatus, typeRouteSectors, unassignedTypeFlights, type RollingCheck, type SectorProgress } from './currency';
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
  /**
   * The level assumed when this item was not there at the last check. For a problem that only has an item
   * while it exists: without it the first appearance would be remembered and never notified.
   */
  unseenIs?: AlertLevel;
}

export interface AlertSettings {
  sepLandExpiry?: IsoDate | null;
  classExpiry?: Partial<Record<ClassRating, IsoDate>>;
  irExpiry?: IsoDate | null;
  medicalExpiry?: IsoDate | null;
  languageLevel?: 4 | 5 | 6 | null;
  languageExpiry?: IsoDate | null;
  typeRatings?: TypeRating[];
  alerts?: { enabled: boolean; night: boolean };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function currencyItem(name: string, keyPrefix: string, what: 'passengers' | 'night', c: RollingCheck): AlertItem {
  const label = what === 'passengers' ? 'Passenger currency' : 'Night currency';
  const level: AlertLevel = c.status === 'green' ? 'green' : c.status === 'amber' ? 'amber' : 'red';
  const body =
    level === 'green' ? 'Current.'
    : level === 'amber' ? `Lapses ${c.daysLeft === 0 ? 'after today' : `in ${plural(c.daysLeft ?? 0, 'day')}`}. Fly take-offs and landings to stay current.`
    : 'Not current: not enough take-offs and landings in the last 90 days.';
  return { key: `${keyPrefix}:${what}`, level, title: `${label} ${level === 'red' ? 'lapsed' : level === 'amber' ? 'expiring' : 'ok'}: ${name}`, body };
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
    if (c.state === 'met-sign-off') return { key, level: 'amber', title: `${name} rating expires in ${plural(days, 'day')}`, body: `Revalidation requirements are met. Have the revalidation entered in your licence before ${date}, then update the expiry date in the app.` };
    return { key, level: 'green', title: `${name} rating ok`, body: `Valid until ${date}.` };
  }
  const c = proficiencyCheckStatus(expiry, today, rules);
  const days = c.daysToExpiry ?? 0;
  if (c.state === 'expired') return { key, level: 'expired', title: `${name} rating expired`, body: `Expired on ${date}. It has to be renewed.` };
  if (c.state === 'urgent') return { key, level: 'red', title: `${name} rating: ${plural(days, 'day')} left`, body: `Book the proficiency check with an examiner now. Expires ${date}.` };
  if (c.state === 'window-open') return { key, level: 'amber', title: `${name}: proficiency check due`, body: `The check window is open; the rating expires in ${plural(days, 'day')} (${date}).` };
  const behind = sectorsBehindPace(flights, cls, expiry, today, rules);
  if (behind) return { key, level: 'amber', title: `${name}: route sectors behind`, body: `${behind} Expires ${date}. One route sector flown with an examiner also satisfies the requirement, as does the commercial-operator exemption.` };
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

/**
 * The proficiency check is not the whole of FCL.740.A(a): the route sectors have to be flown "during
 * the period of validity", so the time to notice a shortfall is early, while there is still a year to
 * fix it. The check-window states say nothing about that, which left the alert green for most of the
 * validity period and amber only once it was nearly too late to fly eight more sectors.
 *
 * Amber and not red, deliberately: the examiner alternative in (a)(2)(ii) and the commercial-operator
 * exemption in (a)(3) are both invisible to the logbook, and "route sector" is itself undefined, so a
 * shortfall here is a thing worth knowing rather than a fact.
 */
function sectorsBehindPace(flights: Flight[], cls: ClassRating, expiry: IsoDate, today: IsoDate, rules: Rules): string | null {
  const s = routeSectors(flights, cls, expiry, today, rules);
  if (!s || s.met) return null;
  const total = daysBetween(s.windowStart, expiry);
  const gone = daysBetween(s.windowStart, today);
  if (total <= 0 || gone <= 0) return null;
  const elapsed = gone / total;
  // leave the first half of the validity period alone: a slow start is normal and nagging is not useful
  if (elapsed < 0.5) return null;
  if (s.sectors >= Math.floor(s.need * elapsed)) return null;
  const pct = Math.round(elapsed * 100);
  return `${s.sectors} of ${s.need} route sectors with ${pct}% of the validity period gone.${unmarkedNote(s)}`;
}

/** Only flights marked as route sectors count; say how many in the period are still unmarked, if any. */
function unmarkedNote(s: SectorProgress): string {
  const n = s.unmarked.length;
  return n === 0 ? '' : ` ${plural(n, 'more flight')} in the period ${n === 1 ? 'is' : 'are'} not marked as a route sector; check ${n === 1 ? 'it' : 'them'} on the Currency screen.`;
}

/** One type rating. Keyed by its id, so renaming it does not look like a different rating. */
function typeRatingItem(t: TypeRating, flights: Flight[], today: IsoDate, rules: Rules): AlertItem {
  const key = `TYPE:${t.id}`;
  const date = formatShortDate(t.expiry);
  const c = typeRatingStatus(t.expiry, today, rules);
  const days = c.daysToExpiry ?? 0;
  if (c.state === 'expired') return { key, level: 'expired', title: `${t.name} type rating expired`, body: `Expired on ${date}. It has to be renewed.` };
  if (c.state === 'urgent') return { key, level: 'red', title: `${t.name}: ${plural(days, 'day')} left`, body: `Book the proficiency check now. Expires ${date}.` };
  if (c.state === 'window-open') return { key, level: 'amber', title: `${t.name}: proficiency check due`, body: `The check window is open; the rating expires in ${plural(days, 'day')} (${date}).` };
  const s = typeRouteSectors(flights, t.id, t.expiry, today, rules);
  if (s && !s.met) {
    const total = daysBetween(s.windowStart, t.expiry), gone = daysBetween(s.windowStart, today);
    const elapsed = total > 0 ? gone / total : 0;
    if (elapsed >= 0.5 && s.sectors < Math.floor(s.need * elapsed)) {
      return { key, level: 'amber', title: `${t.name}: route sectors behind`, body: `${s.sectors} of ${s.need} route sectors with ${Math.round(elapsed * 100)}% of the validity period gone.${unmarkedNote(s)} One sector flown with an examiner also satisfies it. Expires ${date}.` };
    }
  }
  return { key, level: 'green', title: `${t.name} type rating ok`, body: `Valid until ${date}.` };
}

/**
 * The medical certificate and the language endorsement. Neither is a rating, but either one lapsing
 * stops you flying, so they are worth more warning than a currency.
 */
function licenceItems(settings: AlertSettings, today: IsoDate, rules: Rules): AlertItem[] {
  const out: AlertItem[] = [];
  if (readableDate(settings.medicalExpiry)) {
    const c = medicalStatus(settings.medicalExpiry, today, rules);
    const date = formatShortDate(settings.medicalExpiry!);
    const days = c.daysToExpiry ?? 0;
    out.push(
      c.state === 'expired' ? { key: 'MEDICAL', level: 'expired', title: 'Medical certificate expired', body: `Expired on ${date}. You may not fly until it is renewed.` }
      : c.state === 'urgent' ? { key: 'MEDICAL', level: 'red', title: `Medical expires in ${plural(days, 'day')}`, body: `Book the examination now. Expires ${date}.` }
      : c.state === 'due' ? { key: 'MEDICAL', level: 'amber', title: `Medical expires in ${plural(days, 'day')}`, body: `Expires ${date}. The revalidation examination may be done from ${c.windowStart ? formatShortDate(c.windowStart) : ''}.` }
      : { key: 'MEDICAL', level: 'green', title: 'Medical certificate ok', body: `Valid until ${date}.` },
    );
  }
  const lang = languageStatus(settings.languageLevel, settings.languageExpiry, today, rules);
  if (lang.state !== 'not-set' && lang.state !== 'no-expiry') {
    const date = settings.languageExpiry ? formatShortDate(settings.languageExpiry) : '';
    const days = lang.daysToExpiry ?? 0;
    out.push(
      lang.state === 'expired' ? { key: 'LANGUAGE', level: 'expired', title: 'Language endorsement expired', body: `Expired on ${date}. Without it you may not use the radio, and so may not exercise your licence.` }
      : lang.state === 'urgent' ? { key: 'LANGUAGE', level: 'red', title: `Language endorsement expires in ${plural(days, 'day')}`, body: `Book the re-evaluation now. Expires ${date}.` }
      : lang.state === 'due' ? { key: 'LANGUAGE', level: 'amber', title: `Language endorsement expires in ${plural(days, 'day')}`, body: `Expires ${date}.` }
      : { key: 'LANGUAGE', level: 'green', title: 'Language endorsement ok', body: `Valid until ${date}.` },
    );
  }
  return out;
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
      items.push(currencyItem(CLASS_RATING_LABELS[cls], cls, 'passengers', passengerCurrency(flights, byClass(cls), today, rules)));
      if (includeNight) items.push(currencyItem(CLASS_RATING_LABELS[cls], cls, 'night', nightCurrency(flights, byClass(cls), today, rules)));
    }
    const expiry = classExpiryOf(settings, cls);
    if (expiry) items.push(ratingItem(cls, flights, expiry, today, rules));
  }
  if (readableDate(settings.irExpiry)) items.push(irItem(settings.irExpiry!, today, rules));
  for (const t of settings.typeRatings ?? []) {
    if (readableDate(t.expiry)) items.push(typeRatingItem(t, flights, today, rules));
    // FCL.060 counts recent experience per type, so each rating carries its own currency
    if (flights.some((f) => f.typeRatingId === t.id)) {
      items.push(currencyItem(t.name, `TYPE:${t.id}`, 'passengers', passengerCurrency(flights, byType(t.id), today, rules)));
      if (includeNight) items.push(currencyItem(t.name, `TYPE:${t.id}`, 'night', nightCurrency(flights, byType(t.id), today, rules)));
    }
  }
  const stranded = unassignedTypeFlights(flights, settings.typeRatings ?? []).length;
  if (stranded > 0) {
    items.push({
      key: 'TYPE:unassigned', level: 'amber', unseenIs: 'green',
      title: `${plural(stranded, 'flight')} not counted towards any rating`,
      body: 'They are logged in the Other class without a type rating you hold (none was picked, or it has been removed), so they count towards no currency. Open them and pick the rating they were flown under.',
    });
  }
  items.push(...licenceItems(settings, today, rules));
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
 * Compares the watched items with the levels seen last time. Only a worse level notifies. On the first run
 * nothing does, so turning alerts on never floods you with things you can already see. After that, an item with
 * no earlier level (a new date entered) is remembered without notifying, unless it says what its absence meant
 * (`unseenIs`). Better levels are remembered so a later worsening notifies again.
 */
export function alertOutcome(items: AlertItem[], previous: AlertState | undefined): AlertOutcome {
  const state: AlertState = {};
  const fresh: AlertItem[] = [];
  for (const it of items) {
    state[it.key] = it.level;
    const before = previous && (previous[it.key] ?? it.unseenIs);
    if (before !== undefined && RANK[it.level] > RANK[before]) fresh.push(it);
  }
  fresh.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { fresh, state };
}
