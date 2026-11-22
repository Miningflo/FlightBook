import * as SunCalc from 'suncalc';
import { describe, expect, it } from 'vitest';
import { CIVIL_TWILIGHT_DEG, isNightAt, sunAltitudeDeg } from './sun';
import { HOUR, MIN, findCrossing, maxMinAltitude, mulberry32, solarNoonUtc, utc } from './testUtils';

describe('sunAltitudeDeg: analytic anchors (independent of any sun library)', () => {
  // Upper culmination = 90 - |lat - dec|; lower culmination = -(90 - |lat + dec|). Declination at the solstices is +/-23.44.
  const cases: Array<[string, number, number, string, number, number]> = [
    ['Brussels, June solstice', 50.9, 4.48, '2025-06-21', 90 - 50.9 + 23.44, 50.9 + 23.44 - 90],
    ['Brussels, December solstice', 50.9, 4.48, '2025-12-21', 90 - 50.9 - 23.44, -(90 - Math.abs(50.9 - 23.44))],
    ['Tromso, December solstice', 69.68, 18.92, '2025-12-21', 90 - 69.68 - 23.44, -(90 - Math.abs(69.68 - 23.44))],
    ['Tromso, June solstice', 69.68, 18.92, '2025-06-21', 90 - 69.68 + 23.44, 69.68 + 23.44 - 90],
    ['Ushuaia, December solstice', -54.8, -68.3, '2025-12-21', 90 - Math.abs(-54.8 + 23.44), -(90 - Math.abs(-54.8 - 23.44))],
    ['Equator, March equinox', 0, 0, '2025-03-20', 90, -90],
  ];
  for (const [name, lat, lon, date, upper, lower] of cases) {
    it(name, () => {
      const { max, min } = maxMinAltitude(lat, lon, utc(`${date}T00:00:00Z`));
      expect(max).toBeCloseTo(upper, 0); // within 0.5 degree...
      expect(Math.abs(max - upper)).toBeLessThan(0.3);
      expect(Math.abs(min - lower)).toBeLessThan(0.3);
    });
  }

  it('returns degrees, not radians', () => {
    const a = sunAltitudeDeg(utc('2025-06-21T11:40:00Z'), 50.9, 4.48);
    expect(a).toBeGreaterThan(60);
    expect(a).toBeLessThan(65);
  });

  it('is symmetric about the true culmination (so no hour-angle or sign error)', () => {
    const day = utc('2025-03-20T00:00:00Z');
    let best = day, bestAlt = -Infinity;
    for (let m = 0; m < 1440; m++) {
      const a = sunAltitudeDeg(day + m * MIN, 45, 10);
      if (a > bestAlt) { bestAlt = a; best = day + m * MIN; }
    }
    for (const h of [1, 3, 5]) {
      expect(Math.abs(sunAltitudeDeg(best - h * HOUR, 45, 10) - sunAltitudeDeg(best + h * HOUR, 45, 10))).toBeLessThan(0.1);
    }
  });
  it('culminates in the south in the northern hemisphere: later when further west', () => {
    const day = utc('2025-06-21T00:00:00Z');
    const culmination = (lon: number) => {
      let best = day, bestAlt = -Infinity;
      for (let m = 0; m < 1440; m++) {
        const a = sunAltitudeDeg(day + m * MIN, 50, lon);
        if (a > bestAlt) { bestAlt = a; best = day + m * MIN; }
      }
      return best;
    };
    expect((culmination(-15) - culmination(0)) / MIN).toBeCloseTo(60, -1); // 15 degrees of longitude = 1 hour
  });
});

describe('sunAltitudeDeg vs suncalc (dev-only oracle)', () => {
  // suncalc v2 returns apparent altitude: geometric + refraction. Below the horizon it adds a constant ~0.484 degrees.
  const SUNCALC_BELOW_HORIZON_REFRACTION = 0.4839;
  it('agrees below the horizon once suncalc\'s refraction offset is removed', () => {
    const rnd = mulberry32(42);
    let checked = 0;
    for (let i = 0; i < 400 && checked < 120; i++) {
      const ts = utc('2025-01-01T00:00:00Z') + Math.floor(rnd() * 365 * 24 * 60) * MIN;
      const lat = rnd() * 140 - 70;
      const lon = rnd() * 360 - 180;
      const ours = sunAltitudeDeg(ts, lat, lon);
      if (ours > -1.5) continue; // refraction model differs near/above the horizon
      const theirs = SunCalc.getPosition(new Date(ts), lat, lon).altitude;
      expect(Math.abs(ours - (theirs - SUNCALC_BELOW_HORIZON_REFRACTION))).toBeLessThan(0.03);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
  it('agrees high above the horizon within refraction (< 0.05 degrees)', () => {
    const rnd = mulberry32(7);
    let checked = 0;
    for (let i = 0; i < 400 && checked < 60; i++) {
      const ts = utc('2025-01-01T00:00:00Z') + Math.floor(rnd() * 365 * 24 * 60) * MIN;
      const lat = rnd() * 140 - 70;
      const lon = rnd() * 360 - 180;
      const ours = sunAltitudeDeg(ts, lat, lon);
      if (ours < 25) continue;
      expect(Math.abs(ours - SunCalc.getPosition(new Date(ts), lat, lon).altitude)).toBeLessThan(0.05);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('civil twilight boundary', () => {
  const lat = 50.9014, lon = 4.4844;
  const day = utc('2025-03-20T00:00:00Z');
  const noon = solarNoonUtc(day, lon);
  const ours = findCrossing(lat, lon, noon, noon + 8 * HOUR);

  it('matches suncalc\'s getTimes().dusk and .dawn to a few seconds (independent confirmation)', () => {
    const t = SunCalc.getTimes(new Date(day + 12 * HOUR), lat, lon);
    expect(Math.abs(t.dusk!.getTime() - ours)).toBeLessThan(10_000);
    const oursDawn = findCrossing(lat, lon, noon - 12 * HOUR, noon);
    expect(Math.abs(t.dawn!.getTime() - oursDawn)).toBeLessThan(10_000);
  });
  it('a naive "getPosition().altitude < -6" check would be about three minutes late (why we do not use it)', () => {
    let lo = noon, hi = noon + 8 * HOUR;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (SunCalc.getPosition(new Date(mid), lat, lon).altitude > CIVIL_TWILIGHT_DEG) lo = mid; else hi = mid;
    }
    const diffMin = (lo - ours) / MIN;
    expect(diffMin).toBeGreaterThan(2);
    expect(diffMin).toBeLessThan(4.5);
  });
  it('isNightAt flips exactly at -6 degrees', () => {
    const lat = 50.9014, lon = 4.4844;
    const day = utc('2025-09-10T00:00:00Z');
    const dusk = findCrossing(lat, lon, solarNoonUtc(day, lon), solarNoonUtc(day, lon) + 9 * HOUR);
    expect(isNightAt(dusk - 30_000, lat, lon)).toBe(false);
    expect(isNightAt(dusk + 30_000, lat, lon)).toBe(true);
    expect(sunAltitudeDeg(dusk, lat, lon)).toBeCloseTo(CIVIL_TWILIGHT_DEG, 6);
  });
  it('is never night at local noon and always night at local midnight in mid-latitudes', () => {
    for (const date of ['2025-03-20', '2025-06-21', '2025-09-22', '2025-12-21']) {
      const day = utc(`${date}T00:00:00Z`);
      expect(isNightAt(solarNoonUtc(day, 4.48), 50.9, 4.48)).toBe(false);
    }
    expect(isNightAt(solarNoonUtc(utc('2025-12-21T00:00:00Z'), 4.48) + 12 * HOUR, 50.9, 4.48)).toBe(true);
  });
});
