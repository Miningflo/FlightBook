import type { Minutes, Timestamp } from './types';
import { type LatLon, interpolateGreatCircle } from './geo';
import { isNightAt, sunAltitudeDeg, CIVIL_TWILIGHT_DEG } from './sun';

/**
 * Night = the period from the end of evening civil twilight to the beginning of
 * morning civil twilight (sun's centre more than 6 degrees below the horizon).
 *
 * Part-FCL FCL.010 defines "night" as "the period between the end of evening civil twilight and the
 * beginning of morning civil twilight"; civil twilight ends in the evening, and begins in the morning,
 * when the centre of the sun's disc is 6 degrees below the horizon (the definitions in the Annex to
 * Regulation (EU) No 923/2012, SERA). Checked against the EASA Easy Access Rules on 23 November 2026;
 * see domain/rules.ts for the edition.
 *
 * TODO(verify): FCL.010 ends "or such other period between sunset and sunrise as may be prescribed by
 * the appropriate authority", so a national authority may define it differently. Confirm with the
 * authority that issued your licence before relying on the computed night time.
 */

export interface NightInput {
  /** Off-blocks, UTC epoch ms. */
  depTime: Timestamp;
  /** On-blocks, UTC epoch ms. */
  arrTime: Timestamp;
  from: LatLon;
  to: LatLon;
}

export interface NightResult {
  /** Minutes of the flight spent with the sun more than 6 degrees below the horizon. */
  nightMin: Minutes;
  /**
   * Whether the take-off / landing took place at night, judged at off-blocks at the
   * departure airport and on-blocks at the arrival airport.
   * Approximation: the real take-off follows off-blocks and the real landing precedes
   * on-blocks by a few minutes; near twilight the user can override.
   */
  takeoffNight: boolean;
  landingNight: boolean;
}

/**
 * Night minutes of a flight. The position moves along the great circle from the
 * departure to the arrival airport at constant speed over the block time. Each whole
 * minute is classified by the sun's altitude at its midpoint, so the result is an
 * integer, never exceeds the block time, and adjacent flights add up exactly.
 */
export function computeNight(input: NightInput): NightResult {
  const { depTime, arrTime, from, to } = input;
  const span = arrTime - depTime;
  const minutes = Math.round(span / 60_000);
  let night = 0;
  if (minutes > 0) {
    const step = span / minutes;
    for (let i = 0; i < minutes; i++) {
      const f = (i + 0.5) / minutes;
      const pos = interpolateGreatCircle(from, to, f);
      if (sunAltitudeDeg(depTime + (i + 0.5) * step, pos.lat, pos.lon) < CIVIL_TWILIGHT_DEG) night++;
    }
  }
  return {
    nightMin: night,
    takeoffNight: isNightAt(depTime, from.lat, from.lon),
    landingNight: isNightAt(arrTime, to.lat, to.lon),
  };
}
