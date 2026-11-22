import { describe, expect, it } from 'vitest';
import { buildMapData, connectionsOf, markerRadius, placeCodes, routeWidth, type PlaceInfo } from './mapData';
import { flight } from './testFactories';

const P = (name: string, lat: number, lon: number): PlaceInfo => ({ name, lat, lon });
const places = new Map<string, PlaceInfo>([
  ['EBOS', P('Ostend', 51.2, 2.87)], ['EBAW', P('Antwerp', 51.19, 4.46)], ['EBKT', P('Kortrijk', 50.82, 3.21)], ['EHRD', P('Rotterdam', 51.95, 4.44)],
]);
const f = (date: string, dep: string, arr: string) => flight(date, { depPlace: dep, arrPlace: arr });

describe('buildMapData', () => {
  it('counts each flight once at each end, so a round trip gives both airports 2', () => {
    const d = buildMapData([f('2025-03-01', 'EBOS', 'EBAW'), f('2025-03-02', 'EBAW', 'EBOS')], places);
    expect(d.airports.map((a) => [a.icao, a.flights])).toEqual([['EBAW', 2], ['EBOS', 2]]);
    expect(d.totalFlights).toBe(2);
  });
  it('a local flight counts once for its airport and draws no line', () => {
    const d = buildMapData([f('2025-03-01', 'EBOS', 'EBOS'), f('2025-03-02', 'EBOS', 'EBOS')], places);
    expect(d.airports).toEqual([expect.objectContaining({ icao: 'EBOS', flights: 2 })]);
    expect(d.routes).toEqual([]);
  });
  it('a route is the same in both directions and carries the number of flights on it', () => {
    const d = buildMapData([f('2025-03-01', 'EBOS', 'EBAW'), f('2025-03-02', 'EBAW', 'EBOS'), f('2025-03-03', 'EBOS', 'EBAW'), f('2025-03-04', 'EBOS', 'EBKT')], places);
    expect(d.routes).toEqual([{ a: 'EBAW', b: 'EBOS', flights: 3 }, { a: 'EBKT', b: 'EBOS', flights: 1 }]);
    expect(d.airports.map((a) => [a.icao, a.flights])).toEqual([['EBOS', 4], ['EBAW', 3], ['EBKT', 1]]);
  });
  it('matches codes regardless of case and spacing', () => {
    const d = buildMapData([f('2025-03-01', ' ebos ', 'ebaw')], places);
    expect(d.airports.map((a) => a.icao).sort()).toEqual(['EBAW', 'EBOS']);
  });
  it('flights with an unknown airport are reported, not silently dropped, and still count at the known end', () => {
    const d = buildMapData([f('2025-03-01', 'EBOS', 'XXXX'), f('2025-03-02', 'Private strip', 'EBAW'), f('2025-03-03', 'EBOS', 'EBAW')], places);
    expect(d.unplaced).toEqual({ flights: 2, codes: ['PRIVATE STRIP', 'XXXX'] });
    expect(d.routes).toEqual([{ a: 'EBAW', b: 'EBOS', flights: 1 }]);
    expect(d.airports.map((a) => [a.icao, a.flights])).toEqual([['EBAW', 2], ['EBOS', 2]]);
    expect(d.totalFlights).toBe(3);
  });
  it('respects the date range, inclusive at both ends', () => {
    const flights = [f('2025-01-01', 'EBOS', 'EBAW'), f('2025-02-01', 'EBOS', 'EBKT'), f('2025-03-01', 'EBOS', 'EHRD')];
    const d = buildMapData(flights, places, { from: '2025-01-01', to: '2025-02-01' });
    expect(d.totalFlights).toBe(2);
    expect(d.routes.map((r) => r.b).sort()).toEqual(['EBAW', 'EBKT'].sort().map((x) => (x < 'EBOS' ? 'EBOS' : x)).sort());
    expect(d.airports.find((a) => a.icao === 'EHRD')).toBeUndefined();
  });
  it('an empty logbook gives an empty map', () => {
    expect(buildMapData([], places)).toEqual({ airports: [], routes: [], unplaced: { flights: 0, codes: [] }, totalFlights: 0 });
  });
  it('carries the airport name and position for drawing', () => {
    expect(buildMapData([f('2025-03-01', 'EBOS', 'EBAW')], places).airports.find((a) => a.icao === 'EBOS')).toMatchObject({ name: 'Ostend', lat: 51.2, lon: 2.87 });
  });
  it('the total of airport counts equals the flights\' ends: nothing is double counted or lost', () => {
    const flights = [f('2025-03-01', 'EBOS', 'EBAW'), f('2025-03-02', 'EBAW', 'EBKT'), f('2025-03-03', 'EBKT', 'EBKT'), f('2025-03-04', 'EBOS', 'EHRD')];
    const d = buildMapData(flights, places);
    expect(d.airports.reduce((n, a) => n + a.flights, 0)).toBe(2 + 2 + 1 + 2);
  });
});

describe('helpers', () => {
  it('lists the codes to look up once each', () => {
    expect(placeCodes([f('2025-03-01', 'ebos', 'EBAW'), f('2025-03-02', 'EBAW', ' EBOS ')]).sort()).toEqual(['EBAW', 'EBOS']);
  });
  it('lists an airport\'s connections, busiest first', () => {
    const d = buildMapData([f('2025-03-01', 'EBOS', 'EBAW'), f('2025-03-02', 'EBAW', 'EBOS'), f('2025-03-03', 'EBOS', 'EBKT')], places);
    expect(connectionsOf(d, 'EBOS')).toEqual([{ icao: 'EBAW', flights: 2 }, { icao: 'EBKT', flights: 1 }]);
    expect(connectionsOf(d, 'EHRD')).toEqual([]);
  });
  it('circles grow with the count but stay within sensible bounds, big enough for the number', () => {
    expect(markerRadius(1)).toBeGreaterThanOrEqual(12);
    expect(markerRadius(10)).toBeGreaterThan(markerRadius(1));
    expect(markerRadius(1_000_000)).toBe(30);
  });
  it('line width grows with the number of flights and is always visible', () => {
    expect(routeWidth(1, 100)).toBeGreaterThan(1);
    expect(routeWidth(100, 100)).toBeGreaterThan(routeWidth(1, 100));
    expect(routeWidth(5, 0)).toBeLessThan(10);
  });
});
