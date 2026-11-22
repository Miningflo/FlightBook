import { describe, expect, it } from 'vitest';
import { sampleGreatCircle, distanceKm } from './geo';
import {
  DEFAULT_VIEW, TILE, clampZoom, fitView, graticuleStep, panBy, project, scaleOf, splitAtAntimeridian, toScreen, unproject, wrapNear, zoomAt,
} from './mapProjection';
import { mulberry32 } from './testUtils';

describe('Web Mercator projection', () => {
  it('puts the origin in the middle and the date line at the edges', () => {
    expect(project({ lat: 0, lon: 0 })).toEqual({ x: 0.5, y: 0.5 });
    expect(project({ lat: 0, lon: -180 }).x).toBe(0);
    expect(project({ lat: 0, lon: 180 }).x).toBe(1);
  });
  it('north is up (smaller y) and the map is square at the poles it can show', () => {
    expect(project({ lat: 60, lon: 0 }).y).toBeLessThan(project({ lat: 30, lon: 0 }).y);
    expect(project({ lat: 85.0511287798, lon: 0 }).y).toBeCloseTo(0, 6);
    expect(project({ lat: -85.0511287798, lon: 0 }).y).toBeCloseTo(1, 6);
    expect(project({ lat: 90, lon: 0 }).y).toBeCloseTo(0, 6); // clamped, not infinite
  });
  it('round-trips a point', () => {
    const rnd = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const p = { lat: rnd() * 160 - 80, lon: rnd() * 360 - 180 };
      const q = unproject(project(p));
      expect(q.lat).toBeCloseTo(p.lat, 9);
      expect(q.lon).toBeCloseTo(p.lon, 9);
    }
  });
  it('agrees with OpenStreetMap tile numbering (London is tile 10/511/340)', () => {
    const w = project({ lat: 51.5, lon: -0.12 });
    expect([Math.floor(w.x * 1024), Math.floor(w.y * 1024)]).toEqual([511, 340]);
  });
  it('wraps x to the copy nearest a reference', () => {
    expect(wrapNear(0.95, 0.05)).toBeCloseTo(-0.05, 12);
    expect(wrapNear(0.05, 0.95)).toBeCloseTo(1.05, 12);
    expect(wrapNear(0.4, 0.5)).toBe(0.4);
  });
});

describe('great-circle lines for drawing', () => {
  const EBOS = { lat: 51.1998, lon: 2.8747 }, KJFK = { lat: 40.6398, lon: -73.7789 };
  it('samples from end to end with steps no longer than requested', () => {
    const pts = sampleGreatCircle(EBOS, KJFK, 100);
    expect(pts[0]!.lat).toBeCloseTo(EBOS.lat, 6);
    expect(pts.at(-1)!.lon).toBeCloseTo(KJFK.lon, 6);
    for (let i = 1; i < pts.length; i++) expect(distanceKm(pts[i - 1]!, pts[i]!)).toBeLessThanOrEqual(5900 / 59 + 1);
  });
  it('a short hop still gets a few points, and a huge one is capped', () => {
    expect(sampleGreatCircle({ lat: 51, lon: 3 }, { lat: 51.1, lon: 3.1 }).length).toBeGreaterThanOrEqual(3);
    expect(sampleGreatCircle({ lat: 0, lon: 0 }, { lat: 1, lon: 179 }, 1).length).toBe(161);
  });
  it('the Atlantic route bulges north of the straight line on the map', () => {
    const mid = sampleGreatCircle(EBOS, KJFK, 50).map(project);
    const straightY = (project(EBOS).y + project(KJFK).y) / 2;
    expect(Math.min(...mid.map((p) => p.y))).toBeLessThan(straightY);
  });
  it('splits a route that crosses the date line instead of drawing it across the map', () => {
    const fiji = { lat: -17.76, lon: 177.44 }, honolulu = { lat: 21.32, lon: -157.92 };
    const parts = splitAtAntimeridian(sampleGreatCircle(fiji, honolulu, 60).map(project));
    expect(parts.length).toBe(2);
    for (const part of parts) for (let i = 1; i < part.length; i++) expect(Math.abs(part[i]!.x - part[i - 1]!.x)).toBeLessThan(0.5);
    expect(splitAtAntimeridian(sampleGreatCircle(EBOS, KJFK).map(project))).toHaveLength(1);
  });
});

describe('fitView', () => {
  const size = { w: 400, h: 600 };
  const inside = (p: { lat: number; lon: number }, v: ReturnType<typeof fitView>, pad = 40) => {
    const s = toScreen(project(p), v, size);
    return s.x >= pad && s.x <= size.w - pad && s.y >= pad && s.y <= size.h - pad;
  };
  it('shows every point, with margin', () => {
    const pts = [{ lat: 51.2, lon: 2.87 }, { lat: 51.19, lon: 4.46 }, { lat: 50.9, lon: 4.48 }, { lat: 49.6, lon: 6.2 }];
    const v = fitView(pts, size);
    for (const p of pts) expect(inside(p, v)).toBe(true);
  });
  it('zooms in for nearby points and out for distant ones', () => {
    const near = fitView([{ lat: 51.2, lon: 2.9 }, { lat: 51.0, lon: 3.2 }], size);
    const far = fitView([{ lat: 51.2, lon: 2.9 }, { lat: 40.6, lon: -73.8 }], size);
    expect(near.zoom).toBeGreaterThan(far.zoom);
  });
  it('frames points either side of the date line as a small span, not the whole world', () => {
    const pts = [{ lat: -17.7, lon: 177.4 }, { lat: -18.1, lon: -178.5 }];
    const v = fitView(pts, size);
    expect(v.zoom).toBeGreaterThan(5);
    for (const p of pts) expect(inside(p, v)).toBe(true);
  });
  it('a single point gets a sensible close view, and nothing gets the default view', () => {
    const v = fitView([{ lat: 51.2, lon: 2.9 }], size, 56, 9);
    expect(v.zoom).toBe(9);
    expect(fitView([], size)).toEqual(DEFAULT_VIEW);
  });
  it('never zooms beyond the limit or out past the whole world', () => {
    expect(clampZoom(40)).toBe(17);
    expect(clampZoom(-3)).toBe(1);
    expect(clampZoom(0, { w: 1280, h: 800 })).toBeCloseTo(Math.log2(1280 / TILE), 9);
  });
});

describe('panning and zooming', () => {
  const size = { w: 400, h: 600 };
  const v = { cx: 0.5, cy: 0.4, zoom: 6 };
  it('zooming keeps the point under the finger/cursor where it is', () => {
    const at = { x: 120, y: 450 };
    const before = unproject({ x: v.cx + (at.x - 200) / scaleOf(v.zoom), y: v.cy + (at.y - 300) / scaleOf(v.zoom) });
    const z = zoomAt(v, size, at, 8.5);
    const after = unproject({ x: z.cx + (at.x - 200) / scaleOf(z.zoom), y: z.cy + (at.y - 300) / scaleOf(z.zoom) });
    expect(after.lat).toBeCloseTo(before.lat, 9);
    expect(after.lon).toBeCloseTo(before.lon, 9);
    expect(z.zoom).toBe(8.5);
  });
  it('dragging right moves the map right (the centre moves left in the world)', () => {
    const p = panBy(v, 100, 0);
    expect(p.cx).toBeLessThan(v.cx);
    expect(p.cy).toBe(v.cy);
    expect(panBy(v, 0, 1e9).cy).toBe(0);
    expect(panBy(v, 0, -1e9).cy).toBe(1);
  });
});

describe('graticule', () => {
  it('uses coarser spacing when zoomed out and finer when zoomed in, never closer than ~80 px', () => {
    expect(graticuleStep(2)).toBeGreaterThan(graticuleStep(8));
    for (const z of [2, 4, 6, 8, 10, 12]) expect(graticuleStep(z) / (360 / scaleOf(z))).toBeGreaterThanOrEqual(80 - 1e-9);
  });
});
