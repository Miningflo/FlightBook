export interface LatLon {
  lat: number;
  lon: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
export const EARTH_RADIUS_KM = 6371.0088;

type Vec = [number, number, number];
const toVec = ({ lat, lon }: LatLon): Vec => [
  Math.cos(lat * RAD) * Math.cos(lon * RAD),
  Math.cos(lat * RAD) * Math.sin(lon * RAD),
  Math.sin(lat * RAD),
];
const toLatLon = ([x, y, z]: Vec): LatLon => ({
  lat: Math.atan2(z, Math.hypot(x, y)) * DEG,
  lon: Math.atan2(y, x) * DEG,
});

/** Angular distance in radians between two points. */
export function angularDistance(a: LatLon, b: LatLon): number {
  const [ax, ay, az] = toVec(a);
  const [bx, by, bz] = toVec(b);
  const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  return Math.atan2(cross, ax * bx + ay * by + az * bz);
}

export function distanceKm(a: LatLon, b: LatLon): number {
  return angularDistance(a, b) * EARTH_RADIUS_KM;
}

/**
 * Point a fraction `f` (0..1) of the way along the great circle from `a` to `b`
 * (spherical linear interpolation on unit vectors, so the antimeridian and the poles
 * need no special handling). Coincident points return `a`. For exactly antipodal points
 * every meridian is a valid great circle; the result is then simply `a`.
 */
export function interpolateGreatCircle(a: LatLon, b: LatLon, f: number): LatLon {
  const d = angularDistance(a, b);
  if (d < 1e-9 || Math.abs(Math.PI - d) < 1e-9) return { ...a };
  const va = toVec(a);
  const vb = toVec(b);
  const s = Math.sin(d);
  const ka = Math.sin((1 - f) * d) / s;
  const kb = Math.sin(f * d) / s;
  return toLatLon([ka * va[0] + kb * vb[0], ka * va[1] + kb * vb[1], ka * va[2] + kb * vb[2]]);
}
