import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogbookDB } from './db';
import { DexieRepository } from './repository';
import { applyImport, readBundle } from './importer';
import { emptyForm, formToFlightInput, updateForm, type FlightFormState } from '../domain/flightForm';
import { toggleRole } from '../domain/roles';
import { emptyExperience } from '../domain/experience';
import { planImport, writeCount } from '../domain/importPlan';
import { parseSnapshot, serializeSnapshot, snapshotToBundle } from '../domain/snapshot';
import { decodeExperience, decodeFlights, decodeFstd, encodeExperience, encodeFlights, encodeFstd } from '../domain/csvCodec';
import { snapshotFromDb } from '../features/export/backup';
import { uuid } from '../domain/id';
import type { ImportBundle } from '../domain/records';

let n = 0;
let a: LogbookDB, b: LogbookDB;
let ra: DexieRepository, rb: DexieRepository;
const open = () => { const db = new LogbookDB(`imp-${++n}`); return [db, new DexieRepository(db)] as const; };
beforeEach(() => { [a, ra] = open(); [b, rb] = open(); });
afterEach(async () => { a.close(); b.close(); await a.delete(); await b.delete(); });

function flightInput(over: Partial<FlightFormState> = {}, pic = 'SELF') {
  let s = updateForm(emptyForm({ today: '2025-06-01', picName: pic }), {
    depClock: '09:30', arrClock: '11:05', depPlace: 'EBOS', arrPlace: 'EBAW', registration: 'OO-ABC', make: 'Cessna', model: '172', ...over,
  });
  s = updateForm(s, { roles: toggleRole(s.roles, 'PIC', s.totalMin) });
  return formToFlightInput({ ...s, takeoffsDay: 1, landingsDay: 1 });
}

async function fill(repo: DexieRepository) {
  await repo.saveFlight(flightInput({ date: '2025-06-01' }));
  await repo.saveFlight(flightInput({ date: '2025-06-02', registration: 'PH-LDF', make: 'Piper', model: 'PA-28', variant: 'Archer', aircraftClass: 'SEP_LAND', remarks: '=evil, "quoted"\nnewline' }, 'Jean Dupont'));
  await repo.saveFlight(flightInput({ date: '2025-06-03', depClock: '22:00', arrClock: '23:30', engineClass: 'SP-ME', registration: 'OO-TWN', make: 'Piper', model: 'PA-44', aircraftClass: 'MEP_LAND', nightMin: 80 }));
  await repo.saveFstd({ date: '2025-05-01', fstdType: 'FNPT II', totalMin: 90, remarks: 'IFR' });
  await repo.savePreviousExperience({ ...emptyExperience('2024-12-31'), source: 'Vol. 1', periodFrom: '2019-01-01', totalMin: 6000, picMin: 4000, byClass: { SEP_LAND: { totalMin: 5000, picMin: 3500, takeoffs: 10, landings: 10 } } });
  await repo.updateSettings({ pilotName: 'A. Pilot', sepLandExpiry: '2026-03-31' });
}

/** The logbook as comparable plain data: flights by their natural identity, with aircraft/PIC resolved to names. */
async function logical(db: LogbookDB) {
  const bundle = await readBundle(db);
  const strip = <T extends { id: string }>(r: T) => { const { id: _i, ...rest } = r; return rest; };
  return {
    flights: bundle.flights.map(strip).sort((x, y) => x.depTimeUtc - y.depTimeUtc),
    fstd: bundle.fstd.map(strip), experience: bundle.experience.map(strip),
  };
}

describe('restore from a JSON backup into an empty logbook', () => {
  it('reproduces every flight, session and carry-in record exactly', async () => {
    await fill(ra);
    const text = serializeSnapshot(await snapshotFromDb(a));
    const snap = parseSnapshot(text);
    const { bundle, problems } = snapshotToBundle(snap);
    expect(problems).toEqual([]);
    const plan = planImport(bundle, await readBundle(b));
    expect(plan.flights.added).toHaveLength(3);
    const result = await applyImport(b, plan, 'skip', { settings: snap.settings });
    expect(result.written).toEqual({ flights: 3, fstd: 1, experience: 1 });
    expect(await logical(b)).toEqual(await logical(a));
    // flights keep their ids; aircraft and people are matched by registration/name, with SELF reused
    expect((await rb.listFlights()).map((f) => f.id).sort()).toEqual((await ra.listFlights()).map((f) => f.id).sort());
    expect((await b.persons.toArray()).filter((p) => p.isSelf)).toHaveLength(1);
    expect((await b.aircraft.toArray()).map((x) => x.registration).sort()).toEqual(['OO-ABC', 'OO-TWN', 'PH-LDF']);
    // logbook settings are filled in; device settings are untouched
    const settings = await rb.getSettings();
    expect(settings).toMatchObject({ pilotName: 'A. Pilot', sepLandExpiry: '2026-03-31', isMaster: false });
  });
  it('a second restore of the same backup changes nothing', async () => {
    await fill(ra);
    const snap = parseSnapshot(serializeSnapshot(await snapshotFromDb(a)));
    const { bundle } = snapshotToBundle(snap);
    await applyImport(b, planImport(bundle, await readBundle(b)), 'skip');
    const before = await logical(b);
    const again = planImport(bundle, await readBundle(b));
    expect(writeCount(again, 'replace')).toBe(0);
    expect(again.flights.identical).toHaveLength(3);
    await applyImport(b, again, 'replace');
    expect(await logical(b)).toEqual(before);
    expect(await b.flights.count()).toBe(3);
  });
  it('settings from a backup never overwrite values the user already has', async () => {
    await fill(ra);
    await rb.updateSettings({ pilotName: 'Keep Me' });
    const snap = parseSnapshot(serializeSnapshot(await snapshotFromDb(a)));
    const r = await applyImport(b, planImport(snapshotToBundle(snap).bundle, await readBundle(b)), 'skip', { settings: snap.settings });
    expect((await rb.getSettings()).pilotName).toBe('Keep Me');
    expect(r.settingsApplied).toEqual(['sepLandExpiry']);
  });
});

describe('conflicts', () => {
  it('keeps the existing version by default and replaces only when asked (keeping createdAt)', async () => {
    await fill(ra);
    const snap = parseSnapshot(serializeSnapshot(await snapshotFromDb(a)));
    const { bundle } = snapshotToBundle(snap);
    await applyImport(b, planImport(bundle, await readBundle(b)), 'skip');
    const first = (await rb.listFlights()).find((f) => f.date === '2025-06-01')!;
    await rb.saveFlight({ ...flightInput({ date: '2025-06-01' }), remarks: 'edited on this device' }, first.id);

    const plan = planImport(bundle, await readBundle(b));
    expect(plan.flights.conflicts).toHaveLength(1);
    expect(plan.flights.conflicts[0]!.existing.remarks).toBe('edited on this device');

    await applyImport(b, plan, 'skip');
    expect((await b.flights.get(first.id))!.remarks).toBe('edited on this device'); // untouched

    const r = await applyImport(b, plan, 'replace');
    expect(r.replaced.flights).toBe(1);
    const after = (await b.flights.get(first.id))!;
    expect(after.remarks).toBe('');
    expect(after.createdAt).toBe(first.createdAt);
    expect(await b.flights.count()).toBe(3);
  });
});

describe('atomicity', () => {
  it('a failure part-way through rolls everything back, including new aircraft and people', async () => {
    await fill(ra);
    const { bundle } = snapshotToBundle(parseSnapshot(serializeSnapshot(await snapshotFromDb(a))));
    const poisoned: ImportBundle = { ...bundle, flights: [...bundle.flights.slice(0, 2), { ...bundle.flights[2]!, overrides: (() => 1) as never }] };
    await expect(applyImport(b, planImport(poisoned, await readBundle(b)), 'skip')).rejects.toBeTruthy();
    expect(await b.flights.count()).toBe(0);
    expect(await b.aircraft.count()).toBe(0);
    expect(await b.persons.count()).toBe(1); // only the built-in SELF
    expect(await b.fstdSessions.count()).toBe(0);
  });
});

describe('CSV into a logbook', () => {
  it('flights, sessions and carry-in exported to CSV and imported into an empty logbook are identical', async () => {
    await fill(ra);
    const ex = await readBundle(a);
    const now = Date.now();
    const f = decodeFlights(encodeFlights(ex.flights), uuid, now);
    const s = decodeFstd(encodeFstd(ex.fstd), uuid, now);
    const e = decodeExperience(encodeExperience(ex.experience), uuid, now);
    expect([f.errors, s.errors, e.errors]).toEqual([[], [], []]);
    const bundle: ImportBundle = { flights: f.records.map((r) => r.value), fstd: s.records.map((r) => r.value), experience: e.records.map((r) => r.value) };
    await applyImport(b, planImport(bundle, await readBundle(b)), 'skip');
    expect(await logical(b)).toEqual(await logical(a));
  });
  it('importing the same CSV again, even with fresh ids, adds nothing (duplicates are recognised)', async () => {
    await fill(ra);
    const csv = encodeFlights((await readBundle(a)).flights).replace(/^﻿/, '');
    const withoutIds = csv.split('\r\n').map((line, i) => (i === 0 ? line : line.replace(/^[0-9a-f-]{36}/, ''))).join('\r\n');
    const parse = (text: string) => decodeFlights(text, uuid, Date.now()).records.map((r) => r.value);
    await applyImport(b, planImport({ flights: parse(csv), fstd: [], experience: [] }, await readBundle(b)), 'skip');
    const plan = planImport({ flights: parse(withoutIds), fstd: [], experience: [] }, await readBundle(b));
    expect(plan.flights.duplicates).toHaveLength(3);
    expect(writeCount(plan, 'replace')).toBe(0);
    expect(await b.flights.count()).toBe(3);
  });
  it('a CSV from elsewhere (no ids, no timestamps) is added with generated ids', async () => {
    const csv = 'date,dep_place,dep_time_utc,arr_place,arr_time_utc,registration,make,model,class,total,pic_name\n2025-06-01,EBOS,2025-06-01T09:30:00Z,EBAW,2025-06-01T11:05:00Z,OO-NEW,Cessna,172,SEP_LAND,1:35,SELF\n';
    const bundle: ImportBundle = { flights: decodeFlights(csv, uuid, Date.now()).records.map((r) => r.value), fstd: [], experience: [] };
    await applyImport(b, planImport(bundle, await readBundle(b)), 'skip');
    const [f] = await rb.listFlights();
    expect(f).toMatchObject({ registration: 'OO-NEW', totalMin: 95, spSeMin: 95 });
    expect(f!.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('attachments in a backup', () => {
  it('are restored when their flight exists, and skipped when it does not', async () => {
    await fill(ra);
    const f = (await ra.listFlights())[0]!;
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    await a.attachments.add({ id: 'att1', flightId: f.id, mime: 'image/png', name: 'sig.png', blob, createdAt: 1, updatedAt: 1 });
    const snap = parseSnapshot(serializeSnapshot(await snapshotFromDb(a)));
    expect(snap.attachments[0]!.data).toBe('AQIDBA==');
    const { bundle } = snapshotToBundle(snap);
    const att = (id: string, flightId: string) => ({ id, flightId, mime: 'image/png', name: 'x', blob, createdAt: 1, updatedAt: 1 });
    const r = await applyImport(b, planImport(bundle, await readBundle(b)), 'skip', { attachments: [att('att1', f.id), att('orphan', 'no-such-flight')] });
    expect(r.attachments).toBe(1);
    expect(await b.attachments.count()).toBe(1);
  });
});

describe('the aircraft record an import creates for a new registration', () => {
  const typed = (date: string, typeRatingId: string | null, over: Partial<FlightFormState> = {}) => ({
    ...flightInput({ date, registration: 'OO-KAB', make: 'Beechcraft', model: 'King Air', variant: 'B200', aircraftClass: 'OTHER', engineClass: 'MP', typeRatingId, ...over }),
    id: uuid(), createdAt: 1, updatedAt: 1,
  });
  const bundle = (...flights: ReturnType<typeof typed>[]): ImportBundle => ({ flights, fstd: [], experience: [] });
  const run = async (incoming: ImportBundle, extras: Parameters<typeof applyImport>[3] = {}) =>
    applyImport(a, planImport(incoming, await readBundle(a)), 'skip', extras);
  const aircraft = async () => a.aircraft.where('registration').equals('OO-KAB').first();

  it('takes the type rating when this logbook holds it', async () => {
    await ra.updateSettings({ typeRatings: [{ id: 'be20', name: 'BE20', expiry: '2027-06-01' }] });
    await run(bundle(typed('2025-06-01', 'be20')));
    expect((await aircraft())!.typeRatingId).toBe('be20');
  });
  it('takes it from a backup whose ratings are imported in the same step (restoring into an empty logbook)', async () => {
    await run(bundle(typed('2025-06-01', 'be20')), { settings: { typeRatings: [{ id: 'be20', name: 'BE20', expiry: '2027-06-01' }] } });
    expect((await aircraft())!.typeRatingId).toBe('be20');
  });
  it('leaves it out when the rating is not held here, so the aircraft never points at nothing', async () => {
    await ra.updateSettings({ typeRatings: [{ id: 'mine', name: 'BE20', expiry: '2027-06-01' }] });
    // a backup from another logbook: its ratings are not applied, because this one already has its own
    await run(bundle(typed('2025-06-01', 'theirs')), { settings: { typeRatings: [{ id: 'theirs', name: 'BE20', expiry: '2027-06-01' }] } });
    expect((await aircraft())!.typeRatingId).toBeNull();
    // the flight keeps its id and is flagged as having no rating; nothing is quietly rewritten
    expect((await a.flights.toArray())[0]!.typeRatingId).toBe('theirs');
  });
  it('takes its details from the most recent incoming flight, not the first one in the file', async () => {
    await ra.updateSettings({ typeRatings: [{ id: 'old', name: 'BE20', expiry: '2027-06-01' }, { id: 'new', name: 'B350', expiry: '2027-06-01' }] });
    await run(bundle(typed('2025-06-09', 'new', { variant: 'B350' }), typed('2025-06-01', 'old'), typed('2025-06-05', 'old')));
    const ac = (await aircraft())!;
    expect(ac.typeRatingId).toBe('new');
    expect(ac.variant).toBe('B350');
  });
});

describe('flights saved before route sectors existed', () => {
  it('match their own CSV and JSON export exactly, instead of all turning into conflicts', async () => {
    await fill(ra);
    // as stored by an older version: no routeSector field at all
    await a.flights.toCollection().modify((f) => { delete (f as { routeSector?: boolean }).routeSector; });
    expect((await a.flights.toArray()).every((f) => !('routeSector' in f))).toBe(true);
    const existing = await readBundle(a);
    const csv = decodeFlights(encodeFlights(existing.flights), () => uuid(), Date.now());
    const fromCsv = planImport({ flights: csv.records.map((r) => r.value), fstd: [], experience: [] }, existing);
    expect(fromCsv.flights.conflicts).toHaveLength(0);
    expect(fromCsv.flights.identical).toHaveLength(existing.flights.length);
    const fromJson = planImport(snapshotToBundle(parseSnapshot(serializeSnapshot(await snapshotFromDb(a)))).bundle, existing);
    expect(fromJson.flights.conflicts).toHaveLength(0);
  });
});
