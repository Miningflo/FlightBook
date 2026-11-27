import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS, SNAPSHOT_SCHEMA_VERSION, SnapshotError, base64ToBytes, buildSnapshot, bytesToBase64, parseSnapshot, readSnapshot, serializeSnapshot, snapshotToBundle,
} from './snapshot';
import { flight } from './testFactories';
import { emptyExperience } from './experience';
import { mulberry32 } from './testUtils';
import type { Aircraft, Person } from './types';

const self: Person = { id: 'p', name: 'SELF', nameKey: 'self', isSelf: true, createdAt: 1, updatedAt: 1 };
const ac: Aircraft = { id: 'a', registration: 'OO-ABC', make: 'Cessna', model: '172', variant: '', engineClass: 'SP-SE', classRating: 'SEP_LAND', createdAt: 1, updatedAt: 1 };
const snap = () => buildSnapshot({
  exportedAt: '2025-06-30T10:00:00.000Z', deviceName: 'Phone', settings: { pilotName: 'A. Pilot', sepLandExpiry: '2026-03-31' },
  aircraft: [ac], persons: [self], flights: [flight('2025-03-01'), flight('2025-03-02')],
  fstdSessions: [{ id: 's', createdAt: 1, updatedAt: 1, date: '2025-02-02', fstdType: 'FNPT II', totalMin: 60, remarks: '' }],
  previousExperience: [{ id: 'e', createdAt: 1, updatedAt: 1, ...emptyExperience('2024-12-31'), source: 'Vol. 1', totalMin: 600 }],
  attachments: [],
});

describe('snapshot file', () => {
  it('carries the app name and schema version, and round-trips exactly', () => {
    const s = snap();
    expect(s).toMatchObject({ app: 'flightbook', schemaVersion: SNAPSHOT_SCHEMA_VERSION });
    expect(parseSnapshot(serializeSnapshot(s))).toEqual(s);
  });
  it('rejects things that are not usable backups, each with a clear message', () => {
    expect(() => parseSnapshot('not json')).toThrow(SnapshotError);
    expect(() => parseSnapshot('not json')).toThrow(/not valid JSON/);
    expect(() => parseSnapshot('[]')).toThrow(/not a FlightBook backup/);
    expect(() => parseSnapshot(JSON.stringify({ app: 'other' }))).toThrow(/not a FlightBook backup/);
    expect(() => parseSnapshot(JSON.stringify({ app: 'flightbook' }))).toThrow(/schema version/);
    expect(() => parseSnapshot(JSON.stringify({ app: 'flightbook', schemaVersion: 0 }))).toThrow(/schema version/);
    expect(() => parseSnapshot(JSON.stringify({ app: 'flightbook', schemaVersion: 1.5 }))).toThrow(/schema version/);
    expect(() => parseSnapshot(JSON.stringify({ ...snap(), flights: undefined }))).toThrow(/missing its "flights"/);
  });
  it('refuses a backup from a newer app version rather than guessing', () => {
    expect(() => parseSnapshot(JSON.stringify({ ...snap(), schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 }))).toThrow(/newer version/);
  });
  it('runs migrations in order, in memory, when the backup is older', () => {
    const calls: number[] = [];
    const migrations: typeof MIGRATIONS = {
      1: (r) => { calls.push(1); return { ...r, settings: { ...(r.settings as object), migratedTo2: true } }; },
      2: (r) => { calls.push(2); return { ...r, deviceName: `${String(r.deviceName)}+v3` }; },
    };
    const old = { ...snap(), schemaVersion: 1 };
    const out = parseSnapshot(JSON.stringify(old), { current: 3, migrations });
    expect(calls).toEqual([1, 2]);
    expect(out.schemaVersion).toBe(3);
    expect(out.deviceName).toBe('Phone+v3');
    expect((out.settings as Record<string, unknown>).migratedTo2).toBe(true);
    expect(old.schemaVersion).toBe(1); // the input object is not modified
  });
  it('fails clearly if a needed migration is missing', () => {
    expect(() => parseSnapshot(JSON.stringify({ ...snap(), schemaVersion: 1 }), { current: 2, migrations: {} })).toThrow(/No migration from backup schema 1/);
  });
});

describe('snapshotToBundle', () => {
  it('converts valid records to portable ones with the PIC name', () => {
    const { bundle, problems } = snapshotToBundle(snap());
    expect(problems).toEqual([]);
    expect(bundle.flights).toHaveLength(2);
    expect(bundle.flights[0]).toMatchObject({ picName: 'SELF', engineClass: 'SP-SE', registration: 'OO-ABC' });
    expect(bundle.fstd).toHaveLength(1);
    expect(bundle.experience).toHaveLength(1);
  });
  it('reports broken records and keeps the good ones (nothing is dropped silently)', () => {
    const s = snap();
    s.flights.push(flight('2025-03-03', { picNameId: 'missing' }));
    s.flights.push(flight('2025-03-04', { totalMin: 0 }));
    s.fstdSessions.push({ id: 's2', createdAt: 1, updatedAt: 1, date: '2025-02-03', fstdType: '', totalMin: 0, remarks: '' });
    const { bundle, problems } = snapshotToBundle(s);
    expect(bundle.flights).toHaveLength(2);
    expect(bundle.fstd).toHaveLength(1);
    expect(problems.map((p) => p.record)).toEqual(expect.arrayContaining(['flight 2025-03-03 OO-ABC', 'flight 2025-03-04 OO-ABC', 'simulator session 2025-02-03']));
    expect(problems.find((p) => p.record.includes('03-03'))!.message).toMatch(/PIC record is missing/);
  });
});

describe('base64', () => {
  it('round-trips arbitrary bytes, including large buffers', () => {
    const rnd = mulberry32(5);
    for (const n of [0, 1, 2, 3, 100, 100_000]) {
      const bytes = Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

import { snapshotRecords } from './snapshot';

describe('snapshotRecords', () => {
  it('returns the valid records and counts the ones it had to leave out', () => {
    const s = snap();
    s.flights.push(flight('2025-03-03', { picNameId: 'missing' }), flight('2025-03-04', { totalMin: 0 }));
    s.fstdSessions.push({ id: 's2', createdAt: 1, updatedAt: 1, date: '2025-02-03', fstdType: '', totalMin: 0, remarks: '' });
    const r = snapshotRecords(s);
    expect(r.flights).toHaveLength(2);
    expect(r.fstd).toHaveLength(1);
    expect(r.experience).toHaveLength(1);
    expect(r.hidden).toBe(3);
  });
  it('a clean snapshot hides nothing', () => {
    expect(snapshotRecords(snap()).hidden).toBe(0);
  });
});

describe('schema 3: route sectors', () => {
  it('reads a schema 2 backup unchanged: its flights are simply not marked as route sectors', () => {
    const v2 = { ...snap(), schemaVersion: 2 };
    const parsed = parseSnapshot(JSON.stringify(v2));
    expect(parsed.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(parsed.flights.every((f) => f.routeSector === undefined)).toBe(true);
    expect(snapshotToBundle(parsed).bundle.flights.every((f) => f.routeSector === false)).toBe(true);
  });
});

describe('a backup with unreadable parts', () => {
  const read = (change: (s: Record<string, any>) => void) => {
    const raw = JSON.parse(serializeSnapshot(snap())) as Record<string, any>;
    change(raw);
    return readSnapshot(parseSnapshot(JSON.stringify(raw)));
  };
  it('a complete backup has no problems', () => {
    expect(read(() => {}).problems).toEqual([]);
  });
  it('reports a record with a missing field, or that is not a record, instead of throwing', () => {
    for (const [list, field] of [['flights', 'depPlace'], ['flights', 'remarks'], ['flights', 'overrides'], ['fstdSessions', 'fstdType'], ['previousExperience', 'byClass'], ['previousExperience', 'source'], ['persons', 'nameKey'], ['aircraft', 'registration']] as const) {
      const r = read((s) => { delete s[list][0][field]; });
      expect(r.problems.some((p) => p.message.includes(field)), `${list}.${field}`).toBe(true);
    }
    const r = read((s) => { s.flights.push(null); s.fstdSessions.push(7); });
    expect(r.problems).toHaveLength(2);
    expect(r.bundle.flights).toHaveLength(2);
  });
  it('leaves out and names licence data it cannot read, and keeps the rest', () => {
    const r = read((s) => { s.settings = { pilotName: 'A', irExpiry: '31/12/2027', medicalClass: 'GOLD', typeRatings: 'BE20', classExpiry: { TMG: '2027-01-01', MEP_LAND: 'soon' } }; });
    expect(r.records.settings).toEqual({ pilotName: 'A', classExpiry: { TMG: '2027-01-01' } });
    expect(r.problems.map((p) => p.message).join(' | ')).toMatch(/instrument rating.*medical class.*type ratings.*MEP_LAND/);
  });
  it('empty dates mean none entered, not a problem', () => {
    const r = read((s) => { s.settings = { sepLandExpiry: '', irExpiry: null }; });
    expect(r.problems).toEqual([]);
    expect(r.records.settings).toEqual({ sepLandExpiry: null, irExpiry: null });
  });
  it('reports an attachment whose data is not readable', () => {
    const r = read((s) => { s.attachments = [{ id: 'x', flightId: 'f', mime: 'image/png', name: 'sig', createdAt: 1, updatedAt: 1, data: '%%%' }]; });
    expect(r.records.attachments).toEqual([]);
    expect(r.problems).toHaveLength(1);
  });
});
