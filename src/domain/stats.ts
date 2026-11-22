import type { Flight, Minutes, Timestamp } from './types';

export interface QuickStats {
  flights: number;
  totalMin: Minutes;
  last30DaysMin: Minutes;
  landings: number;
  lastFlightDate: string | null;
}

/**
 * Header figures for the flight list. Always computed from flights, never stored.
 * Covers flights in this logbook only; the full totals screen (with previous
 * experience, classes and date filters) comes in phase 3.
 */
export function quickStats(flights: Flight[], now: Timestamp): QuickStats {
  const cutoff = now - 30 * 86_400_000;
  let total = 0, recent = 0, landings = 0;
  let last: string | null = null;
  for (const f of flights) {
    total += f.totalMin;
    if (f.depTimeUtc >= cutoff && f.depTimeUtc <= now) recent += f.totalMin;
    landings += f.landingsDay + f.landingsNight;
    if (last === null || f.date > last) last = f.date;
  }
  return { flights: flights.length, totalMin: total, last30DaysMin: recent, landings, lastFlightDate: last };
}
