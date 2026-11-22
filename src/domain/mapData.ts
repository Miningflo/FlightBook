import type { Flight, IsoDate } from './types';
import { type DateRange, inRange } from './totals';

export interface PlaceInfo {
  name: string;
  lat: number;
  lon: number;
}

export interface MapAirport extends PlaceInfo {
  icao: string;
  /** Flights that started or ended here. A local flight (same airport both ends) counts once. */
  flights: number;
}

export interface MapRoute {
  /** The two airports, in alphabetical order: a route is the same in both directions. */
  a: string;
  b: string;
  flights: number;
}

export interface MapData {
  airports: MapAirport[];
  routes: MapRoute[];
  /** Flights in range that have at least one end that is not a known airport (so no route line can be drawn). */
  unplaced: { flights: number; codes: string[] };
  /** Flights in the selected range. */
  totalFlights: number;
}

export const placeCode = (s: string): string => s.trim().toUpperCase();

/** Every place code that appears in the flights (for looking up coordinates). */
export function placeCodes(flights: Pick<Flight, 'depPlace' | 'arrPlace'>[]): string[] {
  return [...new Set(flights.flatMap((f) => [placeCode(f.depPlace), placeCode(f.arrPlace)]).filter(Boolean))];
}

/**
 * What the map shows. An airport's number is how many flights started or ended there; a line joins two airports
 * that were flown between, in either direction, and its count is the number of flights on it.
 */
export function buildMapData(flights: Flight[], places: ReadonlyMap<string, PlaceInfo>, range: DateRange = {}): MapData {
  const counts = new Map<string, number>();
  const routes = new Map<string, MapRoute>();
  const missing = new Set<string>();
  let total = 0, unplaced = 0;
  for (const f of flights) {
    if (!inRange(f.date as IsoDate, range)) continue;
    total++;
    const dep = placeCode(f.depPlace), arr = placeCode(f.arrPlace);
    let complete = true;
    for (const code of new Set([dep, arr])) {
      if (!places.has(code)) { missing.add(code); complete = false; continue; }
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    if (!complete) unplaced++;
    if (complete && dep !== arr) {
      const [a, b] = dep < arr ? [dep, arr] : [arr, dep];
      const key = `${a}|${b}`;
      const r = routes.get(key);
      if (r) r.flights++; else routes.set(key, { a, b, flights: 1 });
    }
  }
  const airports = [...counts].map(([icao, flights]): MapAirport => ({ icao, flights, ...places.get(icao)! }))
    .sort((x, y) => y.flights - x.flights || x.icao.localeCompare(y.icao));
  return {
    airports,
    routes: [...routes.values()].sort((x, y) => y.flights - x.flights || (x.a + x.b).localeCompare(y.a + y.b)),
    unplaced: { flights: unplaced, codes: [...missing].sort() },
    totalFlights: total,
  };
}

/** The routes of one airport, most flown first, as { other airport, flights }. */
export function connectionsOf(data: MapData, icao: string): { icao: string; flights: number }[] {
  return data.routes
    .filter((r) => r.a === icao || r.b === icao)
    .map((r) => ({ icao: r.a === icao ? r.b : r.a, flights: r.flights }))
    .sort((x, y) => y.flights - x.flights || x.icao.localeCompare(y.icao));
}

/** Circle radius in pixels for a count: grows slowly, always big enough for the number inside. */
export function markerRadius(count: number): number {
  return Math.min(30, Math.max(12, 9 + 3.6 * Math.sqrt(count)));
}

/** Line width in pixels for a route, relative to the busiest route. */
export function routeWidth(flights: number, maxFlights: number): number {
  return 1.4 + 3.2 * Math.sqrt(flights / Math.max(1, maxFlights));
}
