import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogbookDB } from './db';
import { DexieRepository } from './repository';
import { emptyForm, formToFlightInput, updateForm } from '../domain/flightForm';
import { toggleRole } from '../domain/roles';
import { emptyExperience } from '../domain/experience';

let n = 0;
let db: LogbookDB;
let repo: DexieRepository;

function input(over: Partial<Parameters<typeof updateForm>[1]> = {}) {
  let s = updateForm(emptyForm({ today: '2025-06-01', picName: 'SELF' }), {
    depClock: '09:30',
    arrClock: '11:05',
    depPlace: 'EBOS',
    arrPlace: 'EBAW',
    registration: 'OO-ABC',
    make: 'Cessna',
    model: '172',
    ...over,
  });
  s = updateForm(s, { roles: toggleRole(s.roles, 'PIC', s.totalMin) });
  return formToFlightInput(s);
}

beforeEach(() => {
  db = new LogbookDB(`test-${++n}`);
  repo = new DexieRepository(db);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('DexieRepository', () => {
  it('creates the SELF person and default settings on a fresh database', async () => {
    const persons = await repo.listPersons();
    expect(persons.map((p) => p.name)).toEqual(['SELF']);
    expect(persons[0]!.isSelf).toBe(true);
    const settings = await repo.getSettings();
    expect(settings.isMaster).toBe(false);
    expect(settings.setupDone).toBe(false);
  });

  it('saves a flight with uuid and timestamps and creates aircraft once', async () => {
    const a = await repo.saveFlight(input());
    const b = await repo.saveFlight(input({ depClock: '13:00', arrClock: '14:00' }));
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.createdAt).toBeGreaterThan(0);
    expect(a.updatedAt).toBe(a.createdAt);
    expect(await repo.listAircraft()).toHaveLength(1);
    expect(a.aircraftId).toBe(b.aircraftId);
    expect((await repo.listFlights()).map((f) => f.id)).toEqual([b.id, a.id]); // newest first
  });

  it('maps SELF and existing names case-insensitively, creating new people once', async () => {
    const self = (await repo.listPersons())[0]!;
    const f1 = await repo.saveFlight(input({ picName: 'self' }));
    expect(f1.picNameId).toBe(self.id);
    const f2 = await repo.saveFlight(input({ picName: 'Jane  Doe' }));
    const f3 = await repo.saveFlight(input({ picName: 'jane doe' }));
    expect(f2.picNameId).toBe(f3.picNameId);
    expect(await repo.listPersons()).toHaveLength(2);
  });

  it('updates in place, keeping id and createdAt, and never duplicates', async () => {
    const a = await repo.saveFlight(input());
    await new Promise((r) => setTimeout(r, 5));
    const upd = await repo.saveFlight(input({ arrClock: '12:00' }), a.id);
    expect(upd.id).toBe(a.id);
    expect(upd.createdAt).toBe(a.createdAt);
    expect(upd.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(upd.totalMin).toBe(150);
    expect(await db.flights.count()).toBe(1);
  });

  it('refuses to update a flight that does not exist rather than creating a new one', async () => {
    await expect(repo.saveFlight(input(), 'missing')).rejects.toThrow(/not found/);
    expect(await db.flights.count()).toBe(0);
  });

  it('keeps the aircraft snapshot on the flight and does not rewrite the aircraft record', async () => {
    await repo.saveFlight(input());
    const f = await repo.saveFlight(input({ make: 'Reims', model: 'F172' }));
    expect(f.aircraftMake).toBe('Reims');
    const [aircraft] = await repo.listAircraft();
    expect(aircraft!.make).toBe('Cessna');
  });

  it('deletes a flight and its attachments', async () => {
    const f = await repo.saveFlight(input());
    await db.attachments.add({ id: 'att', flightId: f.id, mime: 'image/png', blob: new Blob(['x']), name: 'sig.png', createdAt: 1, updatedAt: 1 });
    await repo.deleteFlight(f.id);
    expect(await db.flights.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });

  it('persists data across close and reopen', async () => {
    const f = await repo.saveFlight(input());
    const name = db.name;
    db.close();
    db = new LogbookDB(name);
    repo = new DexieRepository(db);
    expect((await repo.getFlight(f.id))?.registration).toBe('OO-ABC');
    expect(await repo.listPersons()).toHaveLength(1);
  });

  it('updates settings without losing other fields', async () => {
    const before = await repo.getSettings();
    const after = await repo.updateSettings({ isMaster: true, setupDone: true });
    expect(after.deviceId).toBe(before.deviceId);
    expect(after.isMaster).toBe(true);
    expect((await repo.getSettings()).setupDone).toBe(true);
  });
});

describe('DB v2 migration', () => {
  it('upgrades a v1 database without losing any data', async () => {
    const name = `migrate-${++n}`;
    const { default: Dexie } = await import('dexie');
    const old = new Dexie(name);
    old.version(1).stores({
      flights: 'id, date, depTimeUtc, aircraftId, picNameId',
      aircraft: 'id, &registration',
      persons: 'id, &nameKey',
      fstdSessions: 'id, date',
      previousExperience: 'id, periodTo',
      attachments: 'id, flightId',
      airports: 'icao',
      settings: 'key',
    });
    await old.open();
    await old.table('flights').add({ id: 'f1', date: '2024-01-01', depTimeUtc: 1, aircraftId: 'a1', picNameId: 'p1', totalMin: 77 });
    await old.table('aircraft').add({ id: 'a1', registration: 'OO-OLD' });
    await old.table('persons').add({ id: 'p1', nameKey: 'self', name: 'SELF' });
    await old.table('settings').add({ key: 'main', deviceId: 'dev', deviceName: 'Phone', isMaster: true, setupDone: true, theme: 'dark', lastBackupAt: null });
    old.close();

    const upgraded = new LogbookDB(name);
    try {
      expect((await upgraded.flights.get('f1'))?.totalMin).toBe(77);
      expect((await upgraded.aircraft.get('a1'))?.registration).toBe('OO-OLD');
      const s = await upgraded.settings.get('main');
      expect(s).toMatchObject({ deviceId: 'dev', isMaster: true, theme: 'dark', fetchAircraftPhotos: true });
      expect(await upgraded.photoCache.count()).toBe(0);
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });
});


describe('simulator sessions and previous experience', () => {
  it('saves, lists newest first, updates in place and deletes FSTD sessions', async () => {
    const a = await repo.saveFstd({ date: '2025-01-10', fstdType: 'FNPT II', totalMin: 60, remarks: '' });
    const b = await repo.saveFstd({ date: '2025-03-10', fstdType: 'BITD', totalMin: 30, remarks: 'x' });
    expect((await repo.listFstd()).map((s) => s.id)).toEqual([b.id, a.id]);
    await new Promise((r) => setTimeout(r, 5));
    const upd = await repo.saveFstd({ date: '2025-01-10', fstdType: 'FNPT II', totalMin: 90, remarks: '' }, a.id);
    expect(upd).toMatchObject({ id: a.id, createdAt: a.createdAt, totalMin: 90 });
    expect(upd.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(await db.fstdSessions.count()).toBe(2);
    await repo.deleteFstd(a.id);
    expect((await repo.listFstd()).map((s) => s.id)).toEqual([b.id]);
  });
  it('refuses to update a record that does not exist rather than inserting a new one', async () => {
    await expect(repo.saveFstd({ date: '2025-01-10', fstdType: 'X', totalMin: 1, remarks: '' }, 'missing')).rejects.toThrow(/not found/);
    await expect(repo.savePreviousExperience({ ...emptyExperience('2024-12-31'), source: 's' }, 'missing')).rejects.toThrow(/not found/);
    expect(await db.fstdSessions.count()).toBe(0);
    expect(await db.previousExperience.count()).toBe(0);
  });
  it('stores previous experience with all detail and per-class figures intact', async () => {
    const draft = { ...emptyExperience('2024-12-31'), source: 'Vol. 1', periodFrom: '2019-01-01', totalMin: 6000, picMin: 4000, nightMin: 300,
      byClass: { SEP_LAND: { totalMin: 5000, picMin: 3500, takeoffs: 180, landings: 180 } } };
    const saved = await repo.savePreviousExperience(draft);
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    const [back] = await repo.listPreviousExperience();
    expect(back).toMatchObject({ ...draft, id: saved.id });
  });
  it('lists previous experience by most recent period first', async () => {
    const a = await repo.savePreviousExperience({ ...emptyExperience('2020-12-31'), source: 'old' });
    const b = await repo.savePreviousExperience({ ...emptyExperience('2024-12-31'), source: 'new' });
    expect((await repo.listPreviousExperience()).map((e) => e.id)).toEqual([b.id, a.id]);
  });
  it('keeps the SEP expiry setting through other settings updates', async () => {
    await repo.updateSettings({ sepLandExpiry: '2026-03-31' });
    await repo.updateSettings({ theme: 'dark' });
    expect((await repo.getSettings()).sepLandExpiry).toBe('2026-03-31');
  });
});

describe('onWrite notifications and DB v3', () => {
  it('notifies after every committed logbook change, but not for device settings or failed writes', async () => {
    let calls = 0;
    const r = new DexieRepository(db, () => { calls++; });
    const f = await r.saveFlight(input());
    await r.saveFlight(input({ arrClock: '12:00' }), f.id);
    await r.deleteFlight(f.id);
    const s = await r.saveFstd({ date: '2025-01-01', fstdType: 'X', totalMin: 1, remarks: '' });
    await r.deleteFstd(s.id);
    const e = await r.savePreviousExperience({ ...emptyExperience('2024-12-31'), source: 's' });
    await r.deletePreviousExperience(e.id);
    expect(calls).toBe(7);
    await r.updateSettings({ theme: 'dark', deviceName: 'x', driveEnabled: true, lastBackupAt: 5 });
    expect(calls).toBe(7); // device/Drive settings are not logbook data
    await r.updateSettings({ pilotName: 'A. Pilot' });
    await r.updateSettings({ sepLandExpiry: '2026-03-31' });
    expect(calls).toBe(9);
    await expect(r.saveFlight(input(), 'missing')).rejects.toThrow();
    await expect(r.saveFstd({ date: '2025-01-01', fstdType: 'X', totalMin: 1, remarks: '' }, 'missing')).rejects.toThrow();
    expect(calls).toBe(9); // failures do not notify
  });
});
