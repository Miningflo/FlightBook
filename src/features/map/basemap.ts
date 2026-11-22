import type { LatLon } from '../../domain/geo';
import { project } from '../../domain/mapProjection';
import raw from './basemap.json';

/**
 * The map's built-in background: coastlines and country borders, nothing else (no roads, towns or labels), so
 * the airports and routes stand out. Data: Natural Earth 1:50m, public domain, simplified by
 * scripts/make-basemap.mjs. It is part of the app, so the map needs no network and makes no third-party requests.
 */

interface RawBasemap { unit: number; land: number[][]; borders: number[][] }

/** Decode `[x0, y0, dx, dy, ...]` (integers of `unit` degrees, delta encoded) to points. */
export function decodeLine(line: number[], unit: number): LatLon[] {
  const pts: LatLon[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < line.length; i += 2) {
    x = i === 0 ? line[0]! : x + line[i]!;
    y = i === 0 ? line[1]! : y + line[i + 1]!;
    pts.push({ lat: y * unit, lon: x * unit });
  }
  return pts;
}

/**
 * Make longitudes continuous: where a line jumps by more than half the world (it crosses the date line), shift the
 * following points by 360 degrees, so the line is not drawn straight across the whole map. The map then draws copies
 * of the world to either side, which show the part that sticks out beyond +/-180.
 */
export function unwrapLongitudes(pts: LatLon[]): LatLon[] {
  const out: LatLon[] = [];
  let shift = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const d = pts[i]!.lon + shift - out[i - 1]!.lon;
      if (d > 180) shift -= 360; else if (d < -180) shift += 360;
    }
    out.push({ lat: pts[i]!.lat, lon: pts[i]!.lon + shift });
  }
  return out;
}

/** Path coordinates are world units times 256, so a view at zoom z needs only `scale(2^z)` and a translation. */
const PATH_UNITS = 256;

function pathOf(lines: number[][], unit: number, closed: boolean): string {
  const parts: string[] = [];
  for (const line of lines) {
    const pts = unwrapLongitudes(decodeLine(line, unit));
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const w = project(pts[i]!);
      // project() wraps nothing, so an unwrapped longitude beyond +/-180 simply gives x outside 0..1
      const x = ((pts[i]!.lon + 180) / 360) * PATH_UNITS, y = w.y * PATH_UNITS;
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`;
    }
    parts.push(closed ? `${d}Z` : d);
  }
  return parts.join('');
}

let cache: { land: string; borders: string } | null = null;

/** SVG path data (in world x 256 units) for the land and for the borders. Built once, on first use. */
export function basemapPaths(): { land: string; borders: string } {
  const b = raw as unknown as RawBasemap;
  return (cache ??= { land: pathOf(b.land, b.unit, true), borders: pathOf(b.borders, b.unit, false) });
}

export const PATH_WORLD_WIDTH = PATH_UNITS;

/** Whether a point is on land (even-odd rule over all rings). Used by tests; the map itself only draws. */
export function isOnLand(p: LatLon): boolean {
  const b = raw as unknown as RawBasemap;
  let inside = false;
  for (const line of b.land) {
    const ring = unwrapLongitudes(decodeLine(line, b.unit));
    for (const shift of [0, 360, -360]) {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!, c = ring[j]!;
        const lon = p.lon + shift;
        if ((a.lat > p.lat) !== (c.lat > p.lat) && lon < ((c.lon - a.lon) * (p.lat - a.lat)) / (c.lat - a.lat) + a.lon) hit = !hit;
      }
      if (hit) inside = !inside;
    }
  }
  return inside;
}

export function basemapStats(): { landRings: number; borderLines: number } {
  const b = raw as unknown as RawBasemap;
  return { landRings: b.land.length, borderLines: b.borders.length };
}
