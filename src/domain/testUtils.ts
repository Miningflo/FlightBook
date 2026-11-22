// Test-only helpers (not imported by the app).
import { sunAltitudeDeg, CIVIL_TWILIGHT_DEG } from './sun';
import type { LatLon } from './geo';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const utc = (iso: string): number => Date.parse(iso);

/** Time (ms) at which the sun's altitude crosses `level` within [lo, hi]; assumes exactly one crossing. */
export function findCrossing(lat: number, lon: number, lo: number, hi: number, level = CIVIL_TWILIGHT_DEG): number {
  const sLo = Math.sign(sunAltitudeDeg(lo, lat, lon) - level);
  const sHi = Math.sign(sunAltitudeDeg(hi, lat, lon) - level);
  if (sLo === sHi) throw new Error('no crossing in interval');
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(sunAltitudeDeg(mid, lat, lon) - level) === sLo) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Approximate UTC time of local solar noon on the UTC date starting at `dayStart`. */
export const solarNoonUtc = (dayStart: number, lon: number): number => dayStart + (12 - lon / 15) * HOUR;

export function maxMinAltitude(lat: number, lon: number, dayStart: number): { max: number; min: number } {
  let max = -Infinity, min = Infinity;
  for (let m = 0; m < 1440; m++) {
    const a = sunAltitudeDeg(dayStart + m * MIN, lat, lon);
    if (a > max) max = a;
    if (a < min) min = a;
  }
  return { max, min };
}

const R = Math.PI / 180;
/**
 * Independent reference for a point part-way along a great circle, derived differently
 * from the production code: initial bearing + distance, then the "destination point"
 * formula (production uses vector slerp).
 */
export function referencePoint(a: LatLon, b: LatLon, f: number): LatLon {
  const p1 = a.lat * R, p2 = b.lat * R, l1 = a.lon * R, dl = (b.lon - a.lon) * R;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const dist = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  const theta = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  const d = dist * f;
  const phi = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(theta));
  const lam = l1 + Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(phi));
  return { lat: phi / R, lon: ((lam / R + 540) % 360) - 180 };
}

/** Reference night minutes using the independent point formula. */
export function referenceNightMin(dep: number, arr: number, from: LatLon, to: LatLon): number {
  const n = Math.round((arr - dep) / MIN);
  let night = 0;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const p = referencePoint(from, to, f);
    if (sunAltitudeDeg(dep + (i + 0.5) * MIN, p.lat, p.lon) < CIVIL_TWILIGHT_DEG) night++;
  }
  return night;
}

/** Deterministic PRNG so fuzz tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
