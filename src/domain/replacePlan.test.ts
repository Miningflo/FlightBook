import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planReplace } from './replacePlan';
import { toFlightImport } from './records';
import { flight } from './testFactories';
import { emptyExperience } from './experience';
import type { FstdSession, Person } from './types';
import { LogbookDB } from '../db/db';
import { DexieRepository } from '../db/repository';
import { ReplaceRefusedError, applyReplace, readBundle } from '../db/importer';
import { emptyForm, formToFlightInput, updateForm } from './flightForm';
import { toggleRole } from './roles';
import { snapshotFromDb } from '../features/export/backup';
import { parseSnapshot, serializeSnapshot } from './snapshot';

const self: Person = { id: 'p', name: 'SELF', nameKey: 'self', isSelf: true, createdAt: 1, updatedAt: 1 };
const fi = (date: string, o = {}) => toFlightImport(flight(date, o), [self]);
const fs = (id: string, totalMin = 60): FstdSession => ({ id, createdAt: 1, updatedAt: 1, date: '2025-02-01', fstdType: 'FNPT II', totalMin, remarks: '' });

describe('planReplace: what a replace-everything restore would do', () => {
  it('counts added, changed, unchanged and removed records', () => {
    const same = { ...fi('2025-03-01'), id: 'same' }, edited = { ...fi('2025-03-02'), id: 'edit' };
    const plan = planReplace(
      { flights: [same, { ...edited, remarks: 'in snapshot' }, { ...fi('2025-03-05'), id: 'new' }], fstd: [], experience: [] },
      { flights: [same, edited, { ...fi('2025-03-09'), id: 'only-here' }], fstd: [fs('x')], experience: [] },
    );
    expect(plan.flights).toEqual({ added: 1, changed: 1, unchanged: 1, removed: 1 });
    expect(plan.fstd).toEqual({ added: 0, changed: 0, unchanged: 0, removed: 1 });
    expect(plan.destructive).toBe(true);
  });
  it('is not destructive when it only adds', () => {
    const plan = planReplace({ flights: [{ ...fi('2025-03-01'), id: 'n' }], fstd: [fs('a')], experience: [] }, { flights: [], fstd: [], experience: [] });
    expect(plan.destructive).toBe(false);
    expect(plan.flights.added).toBe(1);
  });
  it('restoring a snapshot into an identical logbook changes nothing', () => {
    const b = { flights: [{ ...fi('2025-03-01'), id: 'a' }], fstd: [fs('s')], experience: [] };
    const plan = planReplace(b, b);
    expect(plan.destructive).toBe(false);
    expect(plan.flights).toEqual({ added: 0, changed: 0, unchanged: 1, removed: 0 });
  });
});

describe('applyReplace', () => {
  let n = 0;
  let a: LogbookDB, b: LogbookDB;
  let ra: DexieRepository, rb: DexieRepository;
  beforeEach(() => { a = new LogbookDB(`rep-a-${++n}`); b = new LogbookDB(`rep-b-${n}`); ra = new DexieRepository(a); rb = new DexieRepository(b); });
  afterEach(async () => { a.close(); b.close(); await a.delete(); await b.delete(); });

  const input = (date: string, reg = 'OO-ABC', pic = 'SELF') => {
    let s = updateForm(emptyForm({ today: date, picName: pic }), { depClock: '09:30', arrClock: '11:05', depPlace: 'EBOS', arrPlace: 'EBAW', registration: reg, make: 'Cessna', model: '172' });
    s = updateForm(s, { roles: toggleRole(s.roles, 'PIC', s.totalMin) });
    return formToFlightInput(s);
  };

  async function fillA() {
    await ra.saveFlight(input('2025-06-01'));
    await ra.saveFlight(input('2025-06-02', 'PH-LDF', 'Jean Dupont'));
    await ra.saveFstd({ date: '2025-05-01', fstdType: 'FNPT II', totalMin: 90, remarks: '' });
    await ra.savePreviousExperience({ ...emptyExperience('2024-12-31'), source: 'Vol. 1', totalMin: 600 });
    await ra.updateSettings({ pilotName: 'A. Pilot', sepLandExpiry: '2026-03-31' });
  }

  it('makes a logbook exactly the snapshot: extra and edited records are gone, ids are preserved', async () => {
    await fillA();
    const snap = parseSnapshot(serializeSnapshot(await snapshotFromDb(a)));
    await rb.saveFlight(input('2025-07-07', 'OO-ZZZ', 'Someone Else')); // a record that is not in the snapshot
    await rb.saveFstd({ date: '2025-01-01', fstdType: 'OTHER', totalMin: 5, remarks: '' });
    const r = await applyReplace(b, snap);
    expect(r).toEqual({ flights: 2, fstd: 1, experience: 1 });
    expect((await readBundle(b))).toEqual(await readBundle(a));
    expect((await rb.listFlights()).map((f) => f.id).sort()).toEqual((await ra.listFlights()).map((f) => f.id).sort());
    expect((await b.aircraft.toArray()).map((x) => x.registration).sort()).toEqual(['OO-ABC', 'PH-LDF']); // OO-ZZZ is gone
    expect(await rb.getSettings()).toMatchObject({ pilotName: 'A. Pilot', sepLandExpiry: '2026-03-31' });
  });
  it('leaves device settings alone', async () => {
    await fillA();
    await rb.updateSettings({ isMaster: true, deviceName: 'Phone', theme: 'dark', driveEnabled: true });
    await applyReplace(b, parseSnapshot(serializeSnapshot(await snapshotFromDb(a))));
    expect(await rb.getSettings()).toMatchObject({ isMaster: true, deviceName: 'Phone', theme: 'dark', driveEnabled: true });
  });
  it('is all-or-nothing: a snapshot that fails part-way leaves the logbook untouched', async () => {
    await fillA();
    const snap = parseSnapshot(serializeSnapshot(await snapshotFromDb(a)));
    await rb.saveFlight(input('2025-07-07', 'OO-ZZZ'));
    const before = await readBundle(b);
    const poisoned = { ...snap, flights: [...snap.flights.slice(0, 1), { ...snap.flights[1]!, overrides: (() => 1) as never }] };
    await expect(applyReplace(b, poisoned)).rejects.toBeTruthy();
    expect(await readBundle(b)).toEqual(before);
    expect(await b.aircraft.count()).toBe(1);
  });
  it('refuses a snapshot with invalid records, before touching anything', async () => {
    await fillA();
    const snap = parseSnapshot(serializeSnapshot(await snapshotFromDb(a)));
    await rb.saveFlight(input('2025-07-07', 'OO-ZZZ'));
    const before = await readBundle(b);
    const bad = { ...snap, flights: [{ ...snap.flights[0]!, totalMin: 0 }, snap.flights[1]!] };
    await expect(applyReplace(b, bad)).rejects.toBeInstanceOf(ReplaceRefusedError);
    expect(await readBundle(b)).toEqual(before);
  });
  it('always leaves the owner (SELF) in place', async () => {
    await fillA();
    const snap = parseSnapshot(serializeSnapshot(await snapshotFromDb(a)));
    const noSelf = { ...snap, persons: snap.persons.filter((p) => !p.isSelf).map((p) => p), flights: snap.flights.filter((f) => snap.persons.find((p) => p.id === f.picNameId && !p.isSelf)) };
    await applyReplace(b, noSelf);
    expect((await b.persons.toArray()).filter((p) => p.isSelf)).toHaveLength(1);
  });
  it('applying the same snapshot twice gives the same logbook', async () => {
    await fillA();
    const snap = parseSnapshot(serializeSnapshot(await snapshotFromDb(a)));
    await applyReplace(b, snap);
    const once = await readBundle(b);
    await applyReplace(b, snap);
    expect(await readBundle(b)).toEqual(once);
  });
});
