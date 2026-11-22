import { describe, expect, it } from 'vitest';
import { quickStats } from './stats';
import type { Flight } from './types';

const DAY = 86_400_000;
const now = Date.UTC(2025, 5, 30, 12);
const fl = (daysAgo: number, totalMin: number, ld = 1, ln = 0): Flight =>
  ({ date: new Date(now - daysAgo * DAY).toISOString().slice(0, 10), depTimeUtc: now - daysAgo * DAY, totalMin, landingsDay: ld, landingsNight: ln } as Flight);

describe('quickStats', () => {
  it('handles an empty logbook', () => {
    expect(quickStats([], now)).toEqual({ flights: 0, totalMin: 0, last30DaysMin: 0, landings: 0, lastFlightDate: null });
  });
  it('sums totals, 30-day window and landings', () => {
    const s = quickStats([fl(1, 60), fl(29, 30, 1, 1), fl(31, 100), fl(-1, 999)], now);
    expect(s.flights).toBe(4);
    expect(s.totalMin).toBe(60 + 30 + 100 + 999);
    expect(s.last30DaysMin).toBe(90); // future-dated and >30 days old excluded
    expect(s.landings).toBe(5);
    expect(s.lastFlightDate).toBe('2025-07-01');
  });
});
