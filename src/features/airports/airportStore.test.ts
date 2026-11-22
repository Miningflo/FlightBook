import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogbookDB } from '../../db/db';
import { AirportStore } from './airportStore';

const HEAD = '"id","ident","type","name","latitude_deg","longitude_deg","icao_code","gps_code"';
const row = (code: string, name: string, lat: number, lon: number) => `1,"${code}","small_airport","${name}",${lat},${lon},"${code}","${code}"`;
const csv = (...rows: string[]) => [HEAD, ...rows].join('\n') + '\n';

let n = 0;
let db: LogbookDB;
let store: AirportStore;
beforeEach(() => { db = new LogbookDB(`airports-${++n}`); store = new AirportStore(db); });
afterEach(async () => { db.close(); await db.delete(); });

describe('AirportStore', () => {
  it('imports, counts and looks up airports case-insensitively', async () => {
    const s = await store.importCsv(csv(row('EBOS', 'Ostend', 51.1998, 2.8747), row('EBAW', 'Antwerp', 51.1894, 4.4603)));
    expect(s.imported).toBe(2);
    expect(await store.count()).toBe(2);
    const m = await store.getMany(['ebos', ' EBAW ', 'EBXX', '']);
    expect([...m.keys()].sort()).toEqual(['EBAW', 'EBOS']);
    expect(m.get('EBOS')!.lat).toBeCloseTo(51.1998);
  });
  it('re-importing updates existing airports without duplicating, and never deletes', async () => {
    await store.importCsv(csv(row('EBOS', 'Old name', 1, 1), row('EBAW', 'Antwerp', 51, 4)));
    await store.importCsv(csv(row('EBOS', 'New name', 51.2, 2.9)));
    expect(await store.count()).toBe(2);
    expect((await store.getMany(['EBOS'])).get('EBOS')!.name).toBe('New name');
    expect((await store.getMany(['EBAW'])).size).toBe(1);
  });
  it('a bad file leaves existing data untouched', async () => {
    await store.importCsv(csv(row('EBOS', 'Ostend', 51.1998, 2.8747)));
    await expect(store.importCsv('not,an,airports,file\n1,2,3,4\n')).rejects.toThrow(/missing column/);
    await expect(store.importCsv(csv('1,"BE-1","small_airport","No code",50,4,,'))).rejects.toThrow(/No usable airports/);
    expect(await store.count()).toBe(1);
  });
  it('writes in chunks and reports progress for each phase', async () => {
    const rows = Array.from({ length: 12_000 }, (_, i) => row(`Z${i.toString(36).toUpperCase().padStart(3, '0')}`, 'A', 50, 4));
    const seen: [string, number][] = [];
    await store.importCsv(csv(...rows), (p, f) => seen.push([p, f]));
    expect(await store.count()).toBe(12_000);
    expect(seen.some(([p]) => p === 'read')).toBe(true);
    expect(seen.filter(([p]) => p === 'save').length).toBe(3); // 5000 + 5000 + 2000
    expect(seen.filter(([p]) => p === 'save').at(-1)![1]).toBe(1);
  });
  it('downloads with progress and returns the text', async () => {
    const body = csv(row('EBOS', 'Ostend', 51, 3));
    const f = (async () => new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })) as unknown as typeof fetch;
    const seen: number[] = [];
    expect(await store.download((_p, fr) => seen.push(fr), f)).toBe(body);
    expect(seen.at(-1)).toBe(1);
  });
  it('reports a failed download instead of importing garbage', async () => {
    const f = (async () => new Response('x', { status: 404 })) as unknown as typeof fetch;
    await expect(store.download(undefined, f)).rejects.toThrow(/404/);
  });
});
