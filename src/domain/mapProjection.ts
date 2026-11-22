import type { LatLon } from './geo';

/**
 * Web Mercator maths for the map screen: the same projection and tile numbering as OpenStreetMap,
 * so the optional background tiles line up exactly with the airports and routes drawn on top.
 * World coordinates run 0..1 in both directions (x west to east, y north to south).
 * Pixels per world unit at zoom z are 256 * 2^z, so zoom z shows ordinary 256 px tiles of zoom z.
 */

export const MAX_LAT = 85.0511287798;
export const TILE = 256;

export interface World { x: number; y: number }
export interface View { cx: number; cy: number; zoom: number }
export interface Size { w: number; h: number }

export const scaleOf = (zoom: number): number => TILE * 2 ** zoom;

export function project(p: LatLon): World {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: (p.lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
}

export function unproject(w: World): LatLon {
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * w.y))) * 180) / Math.PI;
  return { lat, lon: w.x * 360 - 180 };
}

/** Shift x by whole worlds so it is the copy nearest to `near` (the map repeats east-west). */
export const wrapNear = (x: number, near: number): number => x - Math.round(x - near);

/** World to screen pixels for a view and viewport. */
export function toScreen(w: World, v: View, size: Size): { x: number; y: number } {
  const s = scaleOf(v.zoom);
  return { x: (wrapNear(w.x, v.cx) - v.cx) * s + size.w / 2, y: (w.y - v.cy) * s + size.h / 2 };
}

/**
 * Break a projected line wherever it jumps across the antimeridian (neighbouring points more than half a
 * world apart in x), so it is not drawn straight across the whole map.
 */
export function splitAtAntimeridian(points: World[]): World[][] {
  const out: World[][] = [];
  let cur: World[] = [];
  for (const p of points) {
    const last = cur[cur.length - 1];
    if (last && Math.abs(p.x - last.x) > 0.5) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length > 0) out.push(cur);
  return out.filter((l) => l.length > 1);
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 17;
export const clampZoom = (z: number, size?: Size): number => Math.max(size ? Math.max(MIN_ZOOM, Math.log2(Math.max(size.w, 1) / TILE)) : MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Where the map opens when there is nothing to show: north-west Europe. */
export const DEFAULT_VIEW: View = (() => { const c = project({ lat: 50.5, lon: 5 }); return { cx: c.x, cy: c.y, zoom: 5 }; })();

/**
 * A view that shows all the points with `pad` pixels of margin. Points that straddle the antimeridian are
 * framed correctly (the smallest span around the globe is used, not the long way round).
 */
export function fitView(points: LatLon[], size: Size, pad = 56, maxZoom = 10): View {
  if (points.length === 0) return DEFAULT_VIEW;
  const w = points.map(project);
  const xs = w.map((p) => p.x).sort((a, b) => a - b);
  // the largest empty gap on the circle of longitudes marks where the span "starts"
  let bestGap = xs[0]! + 1 - xs[xs.length - 1]!, startIdx = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i]! - xs[i - 1]! > bestGap) { bestGap = xs[i]! - xs[i - 1]!; startIdx = i; }
  const west = xs[startIdx]!;
  const spanX = 1 - bestGap;
  const ys = w.map((p) => p.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanY = maxY - minY;
  const availW = Math.max(40, size.w - 2 * pad), availH = Math.max(40, size.h - 2 * pad);
  const zx = spanX > 1e-9 ? Math.log2(availW / (spanX * TILE)) : Infinity;
  const zy = spanY > 1e-9 ? Math.log2(availH / (spanY * TILE)) : Infinity;
  const zoom = clampZoom(Math.min(zx, zy, maxZoom), size);
  return { cx: west + spanX / 2, cy: minY + spanY / 2, zoom };
}

/** Move the view so the world point under screen point `at` stays under it while zooming to `zoom`. */
export function zoomAt(v: View, size: Size, at: { x: number; y: number }, zoom: number): View {
  const z = clampZoom(zoom, size);
  const s0 = scaleOf(v.zoom), s1 = scaleOf(z);
  const wx = v.cx + (at.x - size.w / 2) / s0, wy = v.cy + (at.y - size.h / 2) / s0;
  return { cx: wx - (at.x - size.w / 2) / s1, cy: wy - (at.y - size.h / 2) / s1, zoom: z };
}

/** Drag the map by a pixel offset. Vertical movement stops at the poles' edge of the world. */
export function panBy(v: View, dxPx: number, dyPx: number): View {
  const s = scaleOf(v.zoom);
  return { ...v, cx: v.cx - dxPx / s, cy: Math.max(0, Math.min(1, v.cy - dyPx / s)) };
}

// ---------------- background tiles ----------------

export interface TilePlacement {
  z: number;
  /** Tile column as it appears on screen (may be outside 0..2^z-1 near the edges of a repeating map). */
  x: number;
  y: number;
  /** Column to request (wrapped into range). */
  wrapX: number;
  left: number;
  top: number;
  size: number;
}

/** The tiles covering the viewport: tile zoom is the nearest whole zoom, scaled to the view's exact zoom. */
export function visibleTiles(v: View, size: Size, max = 80): TilePlacement[] {
  const z = Math.max(0, Math.min(17, Math.round(v.zoom)));
  const n = 2 ** z;
  const s = scaleOf(v.zoom);
  const left = v.cx - size.w / 2 / s, right = v.cx + size.w / 2 / s;
  const top = v.cy - size.h / 2 / s, bottom = v.cy + size.h / 2 / s;
  const x0 = Math.floor(left * n), x1 = Math.floor(right * n);
  const y0 = Math.max(0, Math.floor(top * n)), y1 = Math.min(n - 1, Math.floor(bottom * n));
  const out: TilePlacement[] = [];
  const px = s / n;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      out.push({ z, x, y, wrapX: ((x % n) + n) % n, left: (x / n - v.cx) * s + size.w / 2, top: (y / n - v.cy) * s + size.h / 2, size: px });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Spacing in degrees for the grid drawn when no background is shown, so lines are at least ~80 px apart. */
export function graticuleStep(zoom: number): number {
  const degPerPx = 360 / scaleOf(zoom);
  // the finest spacing that still leaves at least 80 px between lines
  return [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30].find((d) => d / degPerPx >= 80) ?? 30;
}
