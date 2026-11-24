import { describe, expect, it } from 'vitest';
import {
  blockMinutes,
  clockOfTimestamp,
  dateOfTimestamp,
  formatHHMM,
  isValidIsoDate,
  parseClock,
  parseHHMM,
  resolveBlockTimes,
  utcTimestamp,
} from './time';

describe('formatHHMM / parseHHMM', () => {
  it('formats minutes as HH:MM', () => {
    expect(formatHHMM(0)).toBe('00:00');
    expect(formatHHMM(5)).toBe('00:05');
    expect(formatHHMM(90)).toBe('01:30');
    expect(formatHHMM(1234 * 60 + 5)).toBe('1234:05');
  });
  it('round-trips', () => {
    for (const m of [0, 1, 59, 60, 61, 599, 60000]) expect(parseHHMM(formatHHMM(m))).toBe(m);
  });
  it('rejects malformed input', () => {
    for (const bad of ['', '1', '1:5', '1:60', 'a:bc', '1:30:00', '-1:30']) expect(parseHHMM(bad)).toBeNull();
  });
});

describe('parseClock', () => {
  it('accepts 00:00-23:59 only', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(23 * 60 + 59);
    expect(parseClock('9:05')).toBe(9 * 60 + 5);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('12:60')).toBeNull();
    expect(parseClock('')).toBeNull();
  });
});

describe('isValidIsoDate', () => {
  it('validates real calendar dates', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2023-02-29')).toBe(false);
    expect(isValidIsoDate('2024-13-01')).toBe(false);
    expect(isValidIsoDate('2024-1-1')).toBe(false);
  });
});

describe('timestamps', () => {
  it('builds UTC timestamps independent of local time zone', () => {
    const ts = utcTimestamp('2025-06-01', '09:30')!;
    expect(new Date(ts).toISOString()).toBe('2025-06-01T09:30:00.000Z');
    expect(dateOfTimestamp(ts)).toBe('2025-06-01');
    expect(clockOfTimestamp(ts)).toBe('09:30');
  });
  it('returns null for invalid inputs', () => {
    expect(utcTimestamp('nope', '09:30')).toBeNull();
    expect(utcTimestamp('2025-06-01', '25:00')).toBeNull();
  });
});

describe('block time', () => {
  it('computes off-blocks to on-blocks', () => {
    expect(blockMinutes('2025-06-01', '09:30', '11:05')).toBe(95);
  });
  it('handles a flight crossing midnight UTC', () => {
    const t = resolveBlockTimes('2025-06-01', '23:30', '00:45')!;
    expect(new Date(t.arr).toISOString()).toBe('2025-06-02T00:45:00.000Z');
    expect(blockMinutes('2025-06-01', '23:30', '00:45')).toBe(75);
  });
  it('gives zero for equal times and null for invalid input', () => {
    expect(blockMinutes('2025-06-01', '10:00', '10:00')).toBe(0);
    expect(blockMinutes('2025-06-01', '', '10:00')).toBeNull();
  });
  it('handles month and year rollover', () => {
    const t = resolveBlockTimes('2025-12-31', '23:50', '00:10')!;
    expect(dateOfTimestamp(t.arr)).toBe('2026-01-01');
    expect(blockMinutes('2025-12-31', '23:50', '00:10')).toBe(20);
  });
});

import { addDays, addMonths, checkDate, daysBetween, utcDateOf } from './time';

describe('calendar arithmetic', () => {
  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2025-01-31', 1)).toBe('2025-02-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
    expect(addDays('2025-06-30', -75)).toBe('2025-04-16');
  });
  it('counts whole days between dates, signed', () => {
    expect(daysBetween('2025-04-02', '2025-06-30')).toBe(89);
    expect(daysBetween('2025-06-30', '2025-04-02')).toBe(-89);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2025-01-01', '2025-01-01')).toBe(0);
  });
  it('adds months and clamps to the end of shorter months', () => {
    expect(addMonths('2025-03-31', -1)).toBe('2025-02-28');
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(addMonths('2024-02-29', -12)).toBe('2023-02-28');
    expect(addMonths('2026-03-31', -12)).toBe('2025-03-31');
    expect(addMonths('2025-01-15', -2)).toBe('2024-11-15');
    expect(addMonths('2025-11-30', 3)).toBe('2026-02-28');
  });
  it('rejects invalid dates instead of producing nonsense', () => {
    expect(() => addDays('nope', 1)).toThrow();
    expect(() => daysBetween('2025-02-30x', '2025-03-01')).toThrow();
  });
  it('utcDateOf is time-zone independent', () => {
    expect(utcDateOf(Date.UTC(2025, 5, 30, 23, 59))).toBe('2025-06-30');
  });
});

import { effectiveArrDate, landingDayOffset, resolveBlockTimes as resolve2, blockMinutes as block2 } from './time';

describe('landing on another UTC date', () => {
  it('infers the next day when the arrival clock is earlier than the departure clock', () => {
    expect(block2('2025-06-10', '23:10', '01:40')).toBe(150);
    expect(effectiveArrDate('2025-06-10', '23:10', '01:40')).toBe('2025-06-11');
    expect(effectiveArrDate('2025-06-10', '09:00', '10:00')).toBe('2025-06-10');
  });
  it('crosses a month and a year end', () => {
    expect(effectiveArrDate('2025-12-31', '23:30', '00:30')).toBe('2026-01-01');
    expect(effectiveArrDate('2024-02-28', '22:00', '03:00')).toBe('2024-02-29');
  });
  it('takes an explicit landing date as entered, including flights over 24 hours', () => {
    expect(block2('2025-06-10', '23:10', '01:40', '2025-06-11')).toBe(150);
    expect(block2('2025-06-10', '10:00', '12:00', '2025-06-11')).toBe(26 * 60); // later clock, next day: only possible by hand
    expect(effectiveArrDate('2025-06-10', '10:00', '12:00', '2025-06-11')).toBe('2025-06-11');
  });
  it('an explicit landing date before take-off gives negative block time (validation rejects it)', () => {
    expect(block2('2025-06-10', '10:00', '12:00', '2025-06-09')).toBeLessThan(0);
  });
  it('is null for incomplete or invalid input', () => {
    expect(resolve2('2025-06-10', '', '01:40')).toBeNull();
    expect(resolve2('2025-06-10', '23:10', '01:40', '2025-13-40')).toBeNull();
    expect(effectiveArrDate('2025-06-10', '23:10', '')).toBeNull();
  });
  it('counts whole calendar days between take-off and landing', () => {
    const t = (s: string) => Date.parse(s);
    expect(landingDayOffset(t('2025-06-10T09:00:00Z'), t('2025-06-10T10:00:00Z'))).toBe(0);
    expect(landingDayOffset(t('2025-06-10T23:10:00Z'), t('2025-06-11T01:40:00Z'))).toBe(1);
    expect(landingDayOffset(t('2025-06-10T10:00:00Z'), t('2025-06-11T12:00:00Z'))).toBe(1);
    expect(landingDayOffset(t('2025-06-10T10:00:00Z'), t('2025-06-12T01:00:00Z'))).toBe(2);
  });
});

describe('checkDate: the later of the local and the UTC date', () => {
  const at = (h: number, m = 0) => Date.UTC(2026, 10, 23, h, m); // 23 Nov 2026, UTC
  it('in Belgium after local midnight it is already the next day, so an expiry on the 23rd reads as past', () => {
    expect(checkDate(at(23, 30), 60)).toBe('2026-11-24');   // 00:30 CET
    expect(checkDate(at(22, 30), 120)).toBe('2026-11-24');  // 00:30 CEST
    expect(checkDate(at(22, 59), 60)).toBe('2026-11-23');   // 23:59 CET: still the 23rd
  });
  it('west of UTC it stays the UTC date, which is the later one there', () => {
    expect(checkDate(at(2), -300)).toBe('2026-11-23');      // 21:00 on the 22nd in New York
    expect(checkDate(at(23), -300)).toBe('2026-11-23');
  });
  it('at UTC it is the UTC date', () => {
    expect(checkDate(at(0), 0)).toBe('2026-11-23');
    expect(checkDate(at(23, 59), 0)).toBe('2026-11-23');
  });
  it('is never earlier than the UTC date, in any zone', () => {
    for (let off = -720; off <= 840; off += 30) for (const h of [0, 6, 12, 18, 23]) expect(checkDate(at(h), off) >= utcDateOf(at(h))).toBe(true);
  });
});
