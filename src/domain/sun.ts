import type { Timestamp } from './types';

/**
 * Geometric solar position (centre of the sun's disc, no atmospheric refraction),
 * from the low-accuracy series in Meeus, "Astronomical Algorithms" ch. 25, as used
 * by the NOAA solar calculator. Accurate to about 0.01 degrees, far finer than the
 * one-minute resolution of a logbook.
 *
 * Why not a library: suncalc (v2) returns *apparent* altitude, i.e. with ~0.48 degrees
 * of refraction added at every below-horizon angle. Twilight is defined by the sun's
 * geometric position, so using it would shift every twilight boundary by about three
 * minutes. suncalc is kept as a dev-only cross-check in the tests.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Civil twilight ends/begins when the sun's centre is 6 degrees below the horizon. */
export const CIVIL_TWILIGHT_DEG = -6;

const norm360 = (x: number) => ((x % 360) + 360) % 360;

/** Sun's declination and right ascension (degrees) at a UTC timestamp. */
function sunCoordinates(ts: Timestamp): { dec: number; ra: number; jd: number; t: number } {
  const jd = ts / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545.0) / 36_525;
  const l0 = norm360(280.46646 + t * (36_000.76983 + t * 0.0003032));
  const m = norm360(357.52911 + t * (35_999.05029 - 0.0001537 * t));
  const mr = m * RAD;
  const c =
    Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mr) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = (trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD)) * RAD;
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega * RAD)) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * DEG;
  const ra = norm360(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * DEG);
  return { dec, ra, jd, t };
}

/**
 * Geometric altitude of the sun's centre above the horizon, in degrees
 * (positive above, negative below). Latitude north-positive, longitude east-positive.
 */
export function sunAltitudeDeg(ts: Timestamp, latDeg: number, lonDeg: number): number {
  const { dec, ra, jd, t } = sunCoordinates(ts);
  const gmst = norm360(280.46061837 + 360.98564736629 * (jd - 2_451_545.0) + 0.000387933 * t * t - (t * t * t) / 38_710_000);
  const hourAngle = (gmst + lonDeg - ra) * RAD;
  const phi = latDeg * RAD;
  const d = dec * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
}

/** True when the time falls between the end of evening and the start of morning civil twilight. */
export function isNightAt(ts: Timestamp, latDeg: number, lonDeg: number): boolean {
  return sunAltitudeDeg(ts, latDeg, lonDeg) < CIVIL_TWILIGHT_DEG;
}
