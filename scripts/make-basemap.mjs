// Builds src/features/map/basemap.json: coastlines and country borders for the flight map.
// Source: Natural Earth 1:50m (public domain) via the world-atlas package, as TopoJSON.
// Usage: node scripts/make-basemap.mjs <countries-50m.json> [out.json]
//   (download: https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json)
// Output: { unit, land: [ring...], borders: [line...] } where each ring/line is an integer array
//   [x0, y0, dx1, dy1, dx2, dy2, ...] in units of `unit` degrees (x = longitude, y = latitude).
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output = 'src/features/map/basemap.json'] = process.argv;
if (!input) { console.error('usage: node scripts/make-basemap.mjs <countries-50m.json> [out.json]'); process.exit(1); }
const topo = JSON.parse(readFileSync(input, 'utf8'));
const UNIT = 0.005;      // 0.005 degrees, about 550 m
const TOLERANCE = 0.004; // Douglas-Peucker tolerance in degrees
const MIN_RING_SPAN = 0.03; // drop islands smaller than this (degrees across)
const SOUTH_CUTOFF = -55;   // rings lying wholly south of this (Antarctica) are left out: they would only be a white band

// ---- decode the quantised, delta-encoded arcs to lon/lat ----
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; });
});
const arcPoints = (i) => (i >= 0 ? arcs[i] : [...arcs[~i]].reverse());
const ringPoints = (ring) => {
  const pts = [];
  for (const i of ring) { const a = arcPoints(i); pts.push(...(pts.length ? a.slice(1) : a)); }
  return pts;
};

// ---- Douglas-Peucker ----
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// A closed ring starts and ends at the same point, so plain Douglas-Peucker sees a zero-length baseline and collapses
// it. Split the ring at the point farthest from its start and simplify the two halves.
function simplifyRing(pts, eps) {
  if (pts.length < 6) return pts;
  let far = 1, best = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; far = i; }
  }
  return [...simplify(pts.slice(0, far + 1), eps), ...simplify(pts.slice(far), eps).slice(1)];
}

// ---- integer, delta-encoded output ----
function encode(pts) {
  const q = pts.map(([x, y]) => [Math.round(x / UNIT), Math.round(y / UNIT)]);
  const out = [];
  let px = 0, py = 0, first = true, last = null;
  for (const [x, y] of q) {
    if (last && last[0] === x && last[1] === y) continue; // collapse duplicates created by rounding
    out.push(first ? x : x - px, first ? y : y - py);
    px = x; py = y; first = false; last = [x, y];
  }
  return out;
}
const span = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); };

// ---- land: every ring of the land geometry ----
const land = [];
for (const g of topo.objects.land.geometries) {
  const polys = g.type === 'MultiPolygon' ? g.arcs : [g.arcs];
  for (const poly of polys) for (const ring of poly) {
    const pts = ringPoints(ring);
    if (pts.every((p) => p[1] < SOUTH_CUTOFF) || span(pts) < MIN_RING_SPAN) continue;
    const s = simplifyRing(pts, TOLERANCE);
    if (s.length >= 4) land.push(encode(s));
  }
}

// ---- borders: arcs shared by two or more countries ----
const use = new Map();
for (const g of topo.objects.countries.geometries) {
  const seen = new Set();
  const polys = g.type === 'MultiPolygon' ? g.arcs : g.type === 'Polygon' ? [g.arcs] : [];
  for (const poly of polys) for (const ring of poly) for (const i of ring) seen.add(i < 0 ? ~i : i);
  for (const i of seen) use.set(i, (use.get(i) ?? 0) + 1);
}
const borders = [];
for (const [i, n] of use) {
  if (n < 2) continue;
  const pts = arcs[i];
  if (pts.every((p) => p[1] < SOUTH_CUTOFF)) continue;
  const s = simplify(pts, TOLERANCE * 1.5);
  if (s.length >= 2) borders.push(encode(s));
}

const json = JSON.stringify({ unit: UNIT, land, borders });
writeFileSync(output, json);
const count = (l) => l.reduce((n, r) => n + r.length / 2, 0);
console.log(`land rings: ${land.length} (${count(land)} points), border lines: ${borders.length} (${count(borders)} points), ${(json.length / 1024).toFixed(0)} KB`);
