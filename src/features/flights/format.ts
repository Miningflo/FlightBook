import type { Flight, IsoDate } from '../../domain/types';
import { clockOfTimestamp } from '../../domain/time';

/** "Sat 1 Jun 2025" from a UTC calendar date. */
export function formatDate(d: IsoDate): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function monthKey(d: IsoDate): string { return d.slice(0, 7); }

export function formatMonth(key: string): string {
  const dt = new Date(`${key}-01T00:00:00Z`);
  return dt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function aircraftLabel(f: Flight): string {
  return [f.aircraftMake, f.aircraftModel, f.aircraftVariant].filter(Boolean).join(' ');
}

export function blockLabel(f: Flight): string {
  return `${clockOfTimestamp(f.depTimeUtc)}–${clockOfTimestamp(f.arrTimeUtc)} UTC`;
}

/** "1 Jun 2025" from a UTC calendar date. */
export function formatShortDate(d: IsoDate): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
