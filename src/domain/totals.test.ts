import { describe, expect, it } from 'vitest';
import { classesWithTime, computeTotals, experienceCovered, inRange, percentOf, presetRange } from './totals';
import { flight } from './testFactories';
import { emptyExperience } from './experience';
import type { FstdSession, PreviousExperience } from './types';

const exp = (o: Partial<PreviousExperience> = {}): PreviousExperience => ({
  id: 'e1', createdAt: 1, updatedAt: 1, ...emptyExperience('2024-12-31'), ...o,
});
const fstd = (date: string, totalMin: number): FstdSession => ({ id: date, createdAt: 1, updatedAt: 1, date, fstdType: 'FNPT II', totalMin, remarks: '' });

describe('computeTotals', () => {
  it('is all zero for an empty logbook', () => {
    const t = computeTotals({ flights: [], fstd: [], experience: [] });
    expect(t.flights).toBe(0);
    expect(t.flightMin).toBe(0);
    expect(t.roles).toEqual({ PIC: 0, COPI: 0, DUAL: 0, INS: 0 });
    expect(classesWithTime(t)).toEqual([]);
  });
  it('sums flights, roles, categories, night, IFR and counts', () => {
    const t = computeTotals({
      flights: [
        flight('2025-01-10', { totalMin: 90, spSeMin: 90, picMin: 90, nightMin: 20, ifrMin: 10, takeoffsDay: 1, landingsDay: 1 }),
        flight('2025-02-10', { totalMin: 60, spSeMin: 0, mpMin: 60, picMin: 0, copiMin: 60, isPicus: true, takeoffsNight: 2, landingsNight: 2 }),
        flight('2025-03-10', { totalMin: 45, spSeMin: 45, picMin: 0, dualMin: 45, instMin: 0, isSpic: true, aircraftClass: 'TMG', takeoffsDay: 1, landingsDay: 1 }),
      ],
      fstd: [], experience: [],
    });
    expect(t).toMatchObject({
      flights: 3, flightMin: 195, spSeMin: 135, spMeMin: 0, mpMin: 60,
      roles: { PIC: 90, COPI: 60, DUAL: 45, INS: 0 },
      picusMin: 60, spicMin: 45, nightMin: 20, ifrMin: 10,
      takeoffsDay: 2, takeoffsNight: 2, landingsDay: 2, landingsNight: 2,
    });
    expect(t.byClass.SEP_LAND).toEqual({ totalMin: 150, picMin: 90, takeoffs: 3, landings: 3 });
    expect(t.byClass.TMG).toEqual({ totalMin: 45, picMin: 0, takeoffs: 1, landings: 1 });
    expect(classesWithTime(t)).toEqual(['SEP_LAND', 'TMG']);
  });
  it('keeps simulator time out of flight time', () => {
    const t = computeTotals({ flights: [flight('2025-01-10', { totalMin: 60 })], fstd: [fstd('2025-01-11', 45), fstd('2025-01-12', 30)], experience: [] });
    expect(t.flightMin).toBe(60);
    expect(t.fstdMin).toBe(75);
  });
  it('filters flights and simulator sessions by an inclusive date range', () => {
    const flights = [flight('2025-01-01', { totalMin: 10 }), flight('2025-01-15', { totalMin: 20 }), flight('2025-01-31', { totalMin: 40 }), flight('2025-02-01', { totalMin: 80 })];
    const t = computeTotals({ flights, fstd: [fstd('2025-01-01', 5), fstd('2025-02-01', 7)], experience: [], range: { from: '2025-01-01', to: '2025-01-31' } });
    expect(t.flightMin).toBe(70);
    expect(t.flights).toBe(3);
    expect(t.fstdMin).toBe(5);
    expect(computeTotals({ flights, fstd: [], experience: [], range: { from: '2025-01-15' } }).flightMin).toBe(140);
    expect(computeTotals({ flights, fstd: [], experience: [], range: { to: '2025-01-15' } }).flightMin).toBe(30);
  });
  it('adds previous experience in full, per category and per class, without double counting', () => {
    const t = computeTotals({
      flights: [flight('2025-01-10', { totalMin: 60, picMin: 60, takeoffsDay: 1, landingsDay: 1 })],
      fstd: [fstd('2025-01-11', 30)],
      experience: [exp({
        totalMin: 6000, spSeMin: 6000, picMin: 4000, dualMin: 2000, nightMin: 300, ifrMin: 100, picusMin: 50, spicMin: 25, fstdMin: 600,
        takeoffsDay: 200, takeoffsNight: 10, landingsDay: 200, landingsNight: 10,
        byClass: { SEP_LAND: { totalMin: 5000, picMin: 3500, takeoffs: 180, landings: 180 }, TMG: { totalMin: 1000, picMin: 500, takeoffs: 30, landings: 30 } },
      })],
    });
    expect(t.flightMin).toBe(6060);
    expect(t.roles.PIC).toBe(4060);
    expect(t.fstdMin).toBe(630);
    expect(t.takeoffsDay).toBe(201);
    expect(t.byClass.SEP_LAND).toEqual({ totalMin: 5060, picMin: 3560, takeoffs: 181, landings: 181 });
    expect(t.byClass.TMG!.totalMin).toBe(1000);
    expect(t.experienceIncluded).toBe(1);
  });
  it('can leave previous experience out', () => {
    const t = computeTotals({ flights: [], fstd: [], experience: [exp({ totalMin: 100 })], includeExperience: false });
    expect(t.flightMin).toBe(0);
    expect(t.experienceExcluded).toBe(1);
  });
});

describe('previous experience and date ranges', () => {
  const e = exp({ periodFrom: '2019-01-01', periodTo: '2024-12-31', totalMin: 600 });
  it('is covered by an unbounded range or one that spans its whole period', () => {
    expect(experienceCovered(e, {})).toBe(true);
    expect(experienceCovered(e, { from: '2019-01-01', to: '2024-12-31' })).toBe(true);
    expect(experienceCovered(e, { from: '2018-06-01' })).toBe(true);
  });
  it('is left out when the range cuts into its period (a lump sum cannot be split by date)', () => {
    expect(experienceCovered(e, { from: '2025-01-01' })).toBe(false);
    expect(experienceCovered(e, { from: '2020-01-01' })).toBe(false);
    expect(experienceCovered(e, { to: '2023-01-01' })).toBe(false);
    const t = computeTotals({ flights: [], fstd: [], experience: [e], range: { from: '2025-01-01' } });
    expect(t.flightMin).toBe(0);
    expect(t.experienceExcluded).toBe(1);
    expect(t.experienceIncluded).toBe(0);
  });
  it('treats a record without a start date as covering its end date only', () => {
    const e2 = exp({ periodFrom: null, periodTo: '2024-12-31' });
    expect(experienceCovered(e2, { from: '2024-12-31' })).toBe(true);
    expect(experienceCovered(e2, { from: '2025-01-01' })).toBe(false);
  });
});

describe('helpers', () => {
  it('percentOf handles an empty total', () => {
    expect(percentOf(30, 120)).toBe(25);
    expect(percentOf(5, 0)).toBe(0);
  });
  it('inRange is inclusive at both ends', () => {
    expect(inRange('2025-01-01', { from: '2025-01-01', to: '2025-01-01' })).toBe(true);
    expect(inRange('2024-12-31', { from: '2025-01-01' })).toBe(false);
  });
});

describe('presetRange', () => {
  const today = '2025-06-30';
  it('builds the ranges relative to today', () => {
    expect(presetRange('all', today)).toEqual({});
    expect(presetRange('year', today)).toEqual({ from: '2025-01-01', to: today });
    expect(presetRange('12m', today)).toEqual({ from: '2024-07-01', to: today });
    expect(presetRange('90d', today)).toEqual({ from: '2025-04-02', to: today }); // 90 days including today
  });
  it('custom bounds are optional', () => {
    expect(presetRange('custom', today, { from: '2025-02-01', to: '' })).toEqual({ from: '2025-02-01', to: undefined });
    expect(presetRange('custom', today)).toEqual({ from: undefined, to: undefined });
  });
  it('the last-12-months range has the same length as a year even across a leap day', () => {
    expect(presetRange('12m', '2024-03-01')).toEqual({ from: '2023-03-02', to: '2024-03-01' });
  });
});
