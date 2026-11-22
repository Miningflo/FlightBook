import { describe, expect, it } from 'vitest';
import { basemapPaths, basemapStats, decodeLine, isOnLand, unwrapLongitudes } from './basemap';

describe('decoding', () => {
  it('reads delta-encoded integer lines', () => {
    const pts = decodeLine([1000, 10000, 20, -40, 20, 0], 0.005);
    expect(pts.map((p) => [p.lon, p.lat].map((v) => Math.round(v * 1000) / 1000))).toEqual([[5, 50], [5.1, 49.8], [5.2, 49.8]]);
    expect(decodeLine([], 0.005)).toEqual([]);
  });
  it('makes longitudes continuous across the date line, in both directions', () => {
    const east = unwrapLongitudes([{ lat: 65, lon: 178 }, { lat: 65.5, lon: -179 }, { lat: 66, lon: -170 }]);
    expect(east.map((p) => p.lon)).toEqual([178, 181, 190]);
    const west = unwrapLongitudes([{ lat: 65, lon: -178 }, { lat: 65, lon: 179 }, { lat: 65, lon: 170 }]);
    expect(west.map((p) => p.lon)).toEqual([-178, -181, -190]);
    expect(unwrapLongitudes([{ lat: 0, lon: 10 }, { lat: 0, lon: 170 }]).map((p) => p.lon)).toEqual([10, 170]); // a long hop is not a jump
  });
});

describe('the built-in coastlines are in the right place', () => {
  const land: [string, number, number][] = [
    ['Brussels', 50.85, 4.35], ['Antwerp airport area', 51.19, 4.46], ['Paris', 48.86, 2.35], ['London', 51.5, -0.12], ['Berlin', 52.52, 13.4],
    ['Moscow', 55.75, 37.62], ['Madrid', 40.42, -3.7], ['Rome', 41.9, 12.5], ['Cairo', 30.04, 31.24], ['Nairobi', -1.29, 36.82], ['Johannesburg', -26.2, 28.05],
    ['Atlanta', 33.75, -84.39], ['Denver', 39.74, -104.99], ['Mexico City', 19.43, -99.13], ['Sao Paulo', -23.55, -46.63], ['Honolulu (Oahu)', 21.31, -157.86],
    ['Tokyo', 35.68, 139.69], ['Beijing', 39.9, 116.4], ['Delhi', 28.6, 77.2], ['Sydney', -33.87, 151.21], ['Auckland', -36.85, 174.76], ['Reykjavik', 64.14, -21.9],
    ['Anchorage', 61.2, -149.9], ['Sahara', 23, 10], ['Chukotka west of the date line', 67, 178], ['Fiji (Viti Levu, near the date line)', -18.14, 178.0], ['Chukotka east of the date line (Cape Dezhnev)', 66.2, -171.0],
  ];
  const sea: [string, number, number][] = [
    ['mid-Atlantic', 40, -40], ['North Sea', 55, 3], ['English Channel', 50.2, 0.5], ['Bay of Biscay', 45, -5], ['western Mediterranean', 39, 4], ['eastern Mediterranean', 34, 28],
    ['Pacific', 0, -140], ['Pacific near Hawaii', 25, -150], ['Indian Ocean', -20, 80], ['Gulf of Mexico', 25, -90], ['Tasman Sea', -38, 160], ['Baltic Sea', 58, 20], ['South Atlantic', -30, -20],
  ];
  it.each(land)('%s is on land', (_n, lat, lon) => { expect(isOnLand({ lat, lon })).toBe(true); });
  it.each(sea)('%s is water', (_n, lat, lon) => { expect(isOnLand({ lat, lon })).toBe(false); });
  it('has plenty of detail, but not too much to ship (coast and borders)', () => {
    const s = basemapStats();
    expect(s.landRings).toBeGreaterThan(500);
    expect(s.borderLines).toBeGreaterThan(200);
  });
});

describe('path data', () => {
  const { land, borders } = basemapPaths();
  it('draws closed land shapes and open border lines, in world x 256 units', () => {
    expect(land.startsWith('M')).toBe(true);
    expect((land.match(/Z/g) ?? []).length).toBe(basemapStats().landRings);
    expect(borders.includes('Z')).toBe(false);
    const nums = [...land.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].slice(0, 5000).flatMap((m) => [Number(m[1]), Number(m[2])]);
    expect(nums.every((n) => Number.isFinite(n))).toBe(true);
  });
  it('lets Siberia reach past the east edge of the world instead of streaking across the map', () => {
    const xs = [...land.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeGreaterThan(256); // Chukotka beyond +180, drawn again on the west side by the copy
    // no single segment spans more than half the world, which is what a date-line streak would look like
    const pts = [...land.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ move: m[1] === 'M', x: Number(m[2]) }));
    let worst = 0;
    for (let i = 1; i < pts.length; i++) if (!pts[i]!.move) worst = Math.max(worst, Math.abs(pts[i]!.x - pts[i - 1]!.x));
    expect(worst).toBeLessThan(40);
  });
  it('is built once and reused', () => {
    expect(basemapPaths()).toBe(basemapPaths());
  });
});
