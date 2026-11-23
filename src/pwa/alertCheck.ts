import type { LogbookDB } from '../db/db';
import { alertOutcome, watchedItems, type AlertItem } from '../domain/alerts';
import { utcDateOf } from '../domain/time';

/** Shows one notification. Passed in because the page and the service worker show them differently. */
export type Notify = (item: AlertItem) => Promise<void>;

/**
 * Looks at the logbook in the database and notifies about everything that got worse since the last check.
 * Only the master device has a logbook to look at; other devices do nothing. Returns how many were sent.
 * `seed` remembers the current levels without notifying (used when alerts are turned on).
 */
export async function checkAlerts(db: LogbookDB, notify: Notify, now = Date.now(), seed = false): Promise<number> {
  const settings = await db.settings.get('main');
  if (!settings || !settings.isMaster || !settings.alerts?.enabled) return 0;
  const flights = await db.flights.toArray();
  const items = watchedItems(flights, settings, utcDateOf(now));
  const { fresh, state } = alertOutcome(items, seed ? undefined : settings.alertState);
  // remember first: a failure to show one must not make the same alert fire again on the next check
  await db.settings.update('main', { alertState: state }); // a partial update, so it never overwrites a setting changed meanwhile
  if (seed) return 0;
  let sent = 0;
  for (const item of fresh) {
    try { await notify(item); sent++; } catch { /* a blocked notification is not an error worth stopping the others */ }
  }
  return sent;
}
