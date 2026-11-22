import { describe, expect, it } from 'vitest';
import { distanceKm, interpolateGreatCircle } from './geo';
import { mulberry32, referencePoint } from './testUtils';

const EBOS = { lat: 51.1998, lon: 2.874673 };
const KJFK = { lat: 40.6398, lon: -73.7789 };
const EBBR = { lat: 50.9014, lon: 4.4844 };

describe('great circle', () => {
  it('distance matches a known route (Brussels to New York is about 5,890 km)', () => {
    expect(distanceKm(EBBR, KJFK)).toBeGreaterThan(5850);
    expect(distanceKm(EBBR, KJFK)).toBeLessThan(5930);
  });
  it('returns the end points at f = 0 and f = 1', () => {
    const s = interpolateGreatCircle(EBOS, KJFK, 0);
    const e = interpolateGreatCircle(EBOS, KJFK, 1);
    expect(s.lat).toBeCloseTo(EBOS.lat, 6); expect(s.lon).toBeCloseTo(EBOS.lon, 6);
    expect(e.lat).toBeCloseTo(KJFK.lat, 6); expect(e.lon).toBeCloseTo(KJFK.lon, 6);
  });
  it('midpoint is equidistant from both ends', () => {
    const m = interpolateGreatCircle(EBBR, KJFK, 0.5);
    expect(Math.abs(distanceKm(m, EBBR) - distanceKm(m, KJFK))).toBeLessThan(0.01);
  });
  it('the great circle to New York bulges north of the straight lat/lon line', () => {
    expect(interpolateGreatCircle(EBBR, KJFK, 0.5).lat).toBeGreaterThan(52);
  });
  it('handles coincident points (circuits at one airfield)', () => {
    expect(interpolateGreatCircle(EBOS, EBOS, 0.4)).toEqual(EBOS);
  });
  it('handles exactly antipodal points without NaN', () => {
    const p = interpolateGreatCircle({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }, 0.5);
    expect(Number.isFinite(p.lat) && Number.isFinite(p.lon)).toBe(true);
  });
  it('crosses the antimeridian correctly', () => {
    const m = interpolateGreatCircle({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 0.5);
    expect(m.lat).toBeCloseTo(0, 6);
    expect(Math.abs(Math.abs(m.lon) - 180)).toBeLessThan(1e-6);
    const q = interpolateGreatCircle({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 0.25);
    expect(q.lon).toBeCloseTo(175, 6);
  });
  it('passes near the pole on a polar route', () => {
    const m = interpolateGreatCircle({ lat: 78, lon: 15 }, { lat: 78, lon: -165 }, 0.5);
    expect(m.lat).toBeCloseTo(90, 5);
  });
  it('agrees with an independently derived formula (bearing + destination point) on random routes', () => {
    const rnd = mulberry32(99);
    for (let i = 0; i < 300; i++) {
      const a = { lat: rnd() * 150 - 75, lon: rnd() * 360 - 180 };
      const b = { lat: rnd() * 150 - 75, lon: rnd() * 360 - 180 };
      const f = rnd();
      if (distanceKm(a, b) > 19_900) continue; // skip near-antipodal
      const p = interpolateGreatCircle(a, b, f);
      const q = referencePoint(a, b, f);
      expect(distanceKm(p, q)).toBeLessThan(0.05);
    }
  });
});
