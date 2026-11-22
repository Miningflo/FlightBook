import { describe, expect, it } from 'vitest';
import { computeNight } from './night';
import { isNightAt } from './sun';
import { HOUR, MIN, findCrossing, mulberry32, referenceNightMin, solarNoonUtc, utc } from './testUtils';

const here = (lat: number, lon: number) => ({ lat, lon });
const EBBR = here(50.9014, 4.4844);
const EBOS = here(51.1998, 2.874673);
const EBAW = here(51.1894, 4.46028);
const KJFK = here(40.6398, -73.7789);
const ENTC = here(69.6833, 18.9189); // Tromso
const ENSB = here(78.2461, 15.4656); // Longyearbyen
const SAWH = here(-54.8433, -68.2958); // Ushuaia
const NFFN = here(-17.7554, 177.4431); // Nadi, Fiji
const PHNL = here(21.3187, -157.9224); // Honolulu

const stay = (p: { lat: number; lon: number }, dep: number, arr: number) => computeNight({ depTime: dep, arrTime: arr, from: p, to: p });
const DAY = 1440;

describe('computeNight: basics', () => {
  it('zero-length and reversed flights have no night time', () => {
    const t = utc('2025-06-21T23:00:00Z');
    expect(stay(EBBR, t, t).nightMin).toBe(0);
    expect(stay(EBBR, t, t - 30 * MIN).nightMin).toBe(0);
  });
  it('a midday flight is all day, a midnight flight is all night (mid-latitudes, winter)', () => {
    const day = utc('2025-12-21T00:00:00Z');
    const noon = solarNoonUtc(day, EBBR.lon);
    expect(stay(EBBR, noon - 30 * MIN, noon + 30 * MIN).nightMin).toBe(0);
    const midnight = noon + 12 * HOUR;
    expect(stay(EBBR, midnight - 30 * MIN, midnight + 30 * MIN).nightMin).toBe(60);
  });
  it('never exceeds the block time and is a whole number', () => {
    const t = utc('2025-10-05T16:20:00Z');
    const r = computeNight({ depTime: t, arrTime: t + 95 * MIN, from: EBOS, to: EBAW });
    expect(Number.isInteger(r.nightMin)).toBe(true);
    expect(r.nightMin).toBeLessThanOrEqual(95);
  });
});

describe('computeNight: crossing civil twilight', () => {
  const lat = EBBR.lat, lon = EBBR.lon;
  const day = utc('2025-09-10T00:00:00Z');
  const noon = solarNoonUtc(day, lon);
  const dusk = findCrossing(lat, lon, noon, noon + 9 * HOUR);
  const dawn = findCrossing(lat, lon, noon + 12 * HOUR, noon + 20 * HOUR); // the following morning
  const dawnSameDay = findCrossing(lat, lon, noon - 12 * HOUR, noon); // the morning of this UTC date

  it('splits a flight that straddles the end of evening civil twilight (30 min day, 30 min night)', () => {
    const dep = Math.round(dusk / MIN) * MIN - 30 * MIN;
    expect(Math.abs(stay(EBBR, dep, dep + 60 * MIN).nightMin - 30)).toBeLessThanOrEqual(1);
  });
  it('splits a flight that straddles the start of morning civil twilight (night then day)', () => {
    const dep = Math.round(dawn / MIN) * MIN - 45 * MIN;
    expect(Math.abs(stay(EBBR, dep, dep + 60 * MIN).nightMin - 45)).toBeLessThanOrEqual(1);
  });
  it('a flight entirely inside the twilight (sun between 0 and -6 degrees) counts as day', () => {
    // Between sunset and civil dusk it is still "day" for logbook purposes.
    const sunset = findCrossing(lat, lon, noon, noon + 9 * HOUR, 0);
    const dep = Math.ceil((sunset + 2 * MIN) / MIN) * MIN;
    expect(dusk - sunset).toBeGreaterThan(20 * MIN);
    expect(stay(EBBR, dep, dep + 15 * MIN).nightMin).toBe(0);
  });
  it('a long stationary window equals dawn + (24h - dusk), to the minute', () => {
    const start = day; // 00:00 UTC
    const expected = (dawnSameDay - start) / MIN + (start + DAY * MIN - dusk) / MIN;
    expect(Math.abs(stay(EBBR, start, start + DAY * MIN).nightMin - expected)).toBeLessThanOrEqual(2);
  });
  it('flight and landing flags flip at the twilight boundary', () => {
    const before = Math.floor((dusk - 60_000) / MIN) * MIN;
    const after = Math.ceil((dusk + 60_000) / MIN) * MIN;
    const r = computeNight({ depTime: before, arrTime: after, from: EBBR, to: EBBR });
    expect(r.takeoffNight).toBe(false);
    expect(r.landingNight).toBe(true);
    const day2 = computeNight({ depTime: after, arrTime: after + 60 * MIN, from: EBBR, to: EBBR });
    expect(day2.takeoffNight).toBe(true);
    expect(isNightAt(before, lat, lon)).toBe(false);
  });
});

describe('computeNight: analytic length of the night from spherical trigonometry', () => {
  // Night length per day = 24h - 2*H/15 where cos H = (sin(-6) - sin(lat) sin(dec)) / (cos(lat) cos(dec)).
  const nightFor = (lat: number, dec: number): number => {
    const R = Math.PI / 180;
    const cosH = (Math.sin(-6 * R) - Math.sin(lat * R) * Math.sin(dec * R)) / (Math.cos(lat * R) * Math.cos(dec * R));
    return DAY - ((2 * Math.acos(cosH)) / R / 15) * 60;
  };
  it('Brussels, June solstice: about 5 h 55 min of night', () => {
    const r = stay(EBBR, utc('2025-06-21T00:00:00Z'), utc('2025-06-22T00:00:00Z')).nightMin;
    expect(Math.abs(r - nightFor(50.9014, 23.44))).toBeLessThan(4);
  });
  it('Ushuaia (southern hemisphere), December solstice: about 4 h 45 min of night', () => {
    const r = stay(SAWH, utc('2025-12-21T00:00:00Z'), utc('2025-12-22T00:00:00Z')).nightMin;
    expect(Math.abs(r - nightFor(-54.8433, -23.44))).toBeLessThan(4);
  });
  it('Tromso, December solstice (sun never below -6 around noon): about 19.6 h of night', () => {
    const r = stay(ENTC, utc('2025-12-21T00:00:00Z'), utc('2025-12-22T00:00:00Z')).nightMin;
    expect(Math.abs(r - nightFor(69.6833, -23.44))).toBeLessThan(5);
    const noon = solarNoonUtc(utc('2025-12-21T00:00:00Z'), ENTC.lon);
    expect(stay(ENTC, noon - 30 * MIN, noon + 30 * MIN).nightMin).toBe(0);
    expect(stay(ENTC, noon + 12 * HOUR - 30 * MIN, noon + 12 * HOUR + 30 * MIN).nightMin).toBe(60);
  });
});

describe('computeNight: high latitudes', () => {
  const full = (p: { lat: number; lon: number }, date: string) =>
    stay(p, utc(`${date}T00:00:00Z`), utc(`${date}T00:00:00Z`) + DAY * MIN).nightMin;
  it('midnight sun: no night at all at Tromso and Longyearbyen in June', () => {
    expect(full(ENTC, '2025-06-21')).toBe(0);
    expect(full(ENSB, '2025-06-21')).toBe(0);
  });
  it('polar night: Longyearbyen in December is night for the whole 24 hours (sun never above -6 degrees)', () => {
    expect(full(ENSB, '2025-12-21')).toBe(DAY);
  });
  it('no NaN or exceptions exactly at the pole', () => {
    const t = utc('2025-12-21T12:00:00Z');
    const r = computeNight({ depTime: t, arrTime: t + 120 * MIN, from: here(90, 0), to: here(-90, 0) });
    expect(Number.isFinite(r.nightMin)).toBe(true);
  });
  it('a polar-route flight over the pole stays finite and bounded', () => {
    const t = utc('2025-03-20T10:00:00Z');
    const r = computeNight({ depTime: t, arrTime: t + 8 * HOUR, from: here(78, 15), to: here(78, -165) });
    expect(r.nightMin).toBeGreaterThanOrEqual(0);
    expect(r.nightMin).toBeLessThanOrEqual(480);
  });
});

describe('computeNight: the position moves along the great circle', () => {
  it('chasing the sun westwards in summer: Brussels to New York, afternoon departure, stays in daylight', () => {
    const dep = utc('2025-06-21T15:00:00Z');
    expect(computeNight({ depTime: dep, arrTime: dep + 8 * HOUR, from: EBBR, to: KJFK }).nightMin).toBe(0);
  });
  it('flying east overnight: New York to Brussels leaves in daylight and runs into night', () => {
    const dep = utc('2025-06-21T23:30:00Z');
    const r = computeNight({ depTime: dep, arrTime: dep + 7 * HOUR + 30 * MIN, from: KJFK, to: EBBR });
    expect(r.nightMin).toBeGreaterThan(60);
    expect(r.nightMin).toBeLessThan(450);
    expect(r.landingNight).toBe(false);
  });
  it('a moving flight differs from one that stays at the departure airport', () => {
    const dep = utc('2025-06-21T18:00:00Z');
    const moving = computeNight({ depTime: dep, arrTime: dep + 8 * HOUR, from: EBBR, to: KJFK }).nightMin;
    const staying = stay(EBBR, dep, dep + 8 * HOUR).nightMin;
    expect(moving).toBeLessThan(staying);
  });
  it('crossing the antimeridian (Fiji to Honolulu) matches the independent reference', () => {
    const dep = utc('2025-02-10T05:00:00Z');
    const arr = dep + 9 * HOUR;
    const r = computeNight({ depTime: dep, arrTime: arr, from: NFFN, to: PHNL });
    expect(Math.abs(r.nightMin - referenceNightMin(dep, arr, NFFN, PHNL))).toBeLessThanOrEqual(1);
  });
});

describe('computeNight: randomised properties', () => {
  const rnd = mulberry32(2025);
  const randomFlight = () => {
    const from = here(rnd() * 140 - 70, rnd() * 360 - 180);
    const to = rnd() < 0.2 ? from : here(rnd() * 140 - 70, rnd() * 360 - 180);
    const dep = utc('2025-01-01T00:00:00Z') + Math.floor(rnd() * 365 * 24 * 60) * MIN;
    return { from, to, dep, mins: 15 + Math.floor(rnd() * 600) };
  };
  it('matches an independently derived reference within a minute, and stays within [0, block time]', () => {
    for (let i = 0; i < 60; i++) {
      const { from, to, dep, mins } = randomFlight();
      const r = computeNight({ depTime: dep, arrTime: dep + mins * MIN, from, to });
      expect(r.nightMin).toBeGreaterThanOrEqual(0);
      expect(r.nightMin).toBeLessThanOrEqual(mins);
      expect(Math.abs(r.nightMin - referenceNightMin(dep, dep + mins * MIN, from, to))).toBeLessThanOrEqual(1);
    }
  });
  it('is additive: splitting a stationary window at any minute gives the same total', () => {
    for (let i = 0; i < 40; i++) {
      const { from, dep, mins } = randomFlight();
      const cut = 1 + Math.floor(rnd() * (mins - 1));
      const whole = stay(from, dep, dep + mins * MIN).nightMin;
      const parts = stay(from, dep, dep + cut * MIN).nightMin + stay(from, dep + cut * MIN, dep + mins * MIN).nightMin;
      expect(parts).toBe(whole);
    }
  });
});
