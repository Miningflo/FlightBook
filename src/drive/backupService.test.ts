import { beforeEach, describe, expect, it } from 'vitest';
import { BackupService, ViewerService } from './backupService';
import { DriveReader, DriveWriter, qs } from './driveApi';
import { createFakeDrive, fakeTokens, type FakeDrive } from './testing/fakeDrive';
import { DriveError, DriveUnreachableError, MasterMismatchError, NeedsSignInError, NoBackupsError } from './types';
import { BACKUP_FOLDER_NAME, KEEP_PRE_RESTORE, KEEP_SNAPSHOTS, MASTER_FILE_NAME, isSnapshotName } from '../domain/driveRules';
import { buildSnapshot, SnapshotError, parseSnapshot } from '../domain/snapshot';
import { flight } from '../domain/testFactories';
import type { Person } from '../domain/types';

const CLIENT = 'client-A.apps.googleusercontent.com';
const self: Person = { id: 'p', name: 'SELF', nameKey: 'self', isSelf: true, createdAt: 1, updatedAt: 1 };
const noSleep = async () => {};

let drive: FakeDrive;
let clock: number;
beforeEach(() => { drive = createFakeDrive(); clock = Date.UTC(2025, 5, 1, 10, 0, 0); });

function master(id = 'phone-1', name = 'Galaxy', clientId = CLIENT, flights = 1) {
  const tokens = fakeTokens(drive, clientId);
  const writer = new DriveWriter({ tokens, fetchFn: drive.fetch, sleep: noSleep });
  return new BackupService(writer, {
    device: () => ({ deviceId: id, deviceName: name }),
    now: () => new Date((clock += 1000)),
    buildSnapshot: async () => buildSnapshot({ exportedAt: new Date(clock).toISOString(), deviceId: id, deviceName: name, settings: {}, aircraft: [], persons: [self], flights: Array.from({ length: flights }, (_, i) => flight(`2025-03-0${i + 1}`)), fstdSessions: [], previousExperience: [], attachments: [] }),
  });
}
function viewer(clientId = CLIENT) {
  const tokens = fakeTokens(drive, clientId);
  const reader = new DriveReader({ tokens, fetchFn: drive.fetch, sleep: noSleep });
  return { service: new ViewerService(reader), tokens };
}
const ours = () => [...drive.files.values()].filter((f) => isSnapshotName(f.name));

describe('first backup', () => {
  it('creates the "Logbook backups" folder, claims the master role and writes a timestamped snapshot', async () => {
    const svc = master();
    const r = await svc.runBackup();
    const folder = [...drive.files.values()].find((f) => f.mimeType === 'application/vnd.google-apps.folder')!;
    expect(folder.name).toBe(BACKUP_FOLDER_NAME);
    const names = [...drive.files.values()].filter((f) => f.parents.includes(folder.id)).map((f) => f.name).sort();
    expect(names).toEqual([MASTER_FILE_NAME, r.file.name].sort());
    expect(r.file.name).toMatch(/^flightbook-snapshot-\d{8}T\d{6}Z\.json$/);
    const m = JSON.parse([...drive.files.values()].find((f) => f.name === MASTER_FILE_NAME)!.content);
    expect(m).toMatchObject({ app: 'flightbook', deviceId: 'phone-1', deviceName: 'Galaxy' });
    expect(typeof m.claimedAt).toBe('string');
  });
  it('the snapshot carries the schema version, the device, and the records', async () => {
    const svc = master();
    const { file } = await svc.runBackup();
    const f = drive.files.get(file.id)!;
    expect(f.appProperties).toMatchObject({ fb: 'snapshot', schema: '1', device: 'phone-1', deviceName: 'Galaxy' });
    const snap = parseSnapshot(f.content);
    expect(snap).toMatchObject({ app: 'flightbook', schemaVersion: 1, deviceId: 'phone-1', deviceName: 'Galaxy' });
    expect(snap.flights).toHaveLength(1);
  });
  it('a second backup adds a new snapshot and does not touch master.json', async () => {
    const svc = master();
    await svc.runBackup();
    const claimed = [...drive.files.values()].find((f) => f.name === MASTER_FILE_NAME)!.content;
    await svc.runBackup();
    expect(ours()).toHaveLength(2);
    expect([...drive.files.values()].filter((f) => f.name === MASTER_FILE_NAME)).toHaveLength(1);
    expect([...drive.files.values()].find((f) => f.name === MASTER_FILE_NAME)!.content).toBe(claimed);
  });
  it('never makes a second folder', async () => {
    const svc = master();
    await svc.runBackup(); await svc.runBackup();
    const other = master(); // a fresh service instance (cold cache), same device
    await other.runBackup();
    expect([...drive.files.values()].filter((f) => f.mimeType.endsWith('folder'))).toHaveLength(1);
  });
});

describe('retention: keep the last 30', () => {
  it('deletes only the oldest snapshots beyond 30 and nothing else', async () => {
    const svc = master();
    const r0 = await svc.runBackup();
    // someone put unrelated files in the folder: they must survive
    const folder = [...drive.files.values()].find((f) => f.mimeType.endsWith('folder'))!;
    for (const name of ['notes.txt', 'flightbook-snapshot-notes.json', 'holiday.jpg']) drive.files.set(name, { id: name, name, mimeType: 'text/plain', parents: [folder.id], content: 'x', createdTime: '2020-01-01T00:00:00Z', trashed: false, clientId: CLIENT });
    for (let i = 0; i < 31; i++) await svc.runBackup();
    expect(ours()).toHaveLength(KEEP_SNAPSHOTS);
    expect(drive.files.has(r0.file.id)).toBe(false); // the very first one was pruned
    for (const name of ['notes.txt', 'flightbook-snapshot-notes.json', 'holiday.jpg', MASTER_FILE_NAME]) expect([...drive.files.values()].some((f) => f.name === name)).toBe(true);
    const times = ours().map((f) => f.name).sort();
    expect(times[times.length - 1]).toBe(ours().map((f) => f.name).sort().at(-1)); // newest kept
  });
  it('a failed delete is reported as a warning and does not fail the backup', async () => {
    const svc = master();
    for (let i = 0; i < KEEP_SNAPSHOTS; i++) await svc.runBackup();
    // next backup needs to prune one; make DELETE fail
    const realFetch = drive.fetch;
    const failing = new DriveWriter({ tokens: fakeTokens(drive, CLIENT), sleep: noSleep, fetchFn: ((u: RequestInfo | URL, init?: RequestInit) => init?.method === 'DELETE' ? Promise.resolve(new Response('{}', { status: 403 })) : realFetch(u, init)) as typeof fetch });
    const svc2 = new BackupService(failing, { device: () => ({ deviceId: 'phone-1', deviceName: 'Galaxy' }), now: () => new Date((clock += 1000)), buildSnapshot: async () => buildSnapshot({ exportedAt: '', deviceName: '', settings: {}, aircraft: [], persons: [self], flights: [], fstdSessions: [], previousExperience: [], attachments: [] }) });
    const r = await svc2.runBackup();
    expect(r.pruned).toBe(0);
    expect(r.warnings[0]).toMatch(/Could not delete/);
    expect(ours()).toHaveLength(KEEP_SNAPSHOTS + 1);
  });
  it('safety copies before a restore are kept apart and pruned to 5 on their own', async () => {
    const svc = master();
    await svc.runBackup();
    for (let i = 0; i < 7; i++) await svc.saveSafetyCopy();
    const pre = [...drive.files.values()].filter((f) => f.name.startsWith('flightbook-prerestore-'));
    expect(pre).toHaveLength(KEEP_PRE_RESTORE);
    expect(ours()).toHaveLength(1); // regular snapshots untouched
  });
});

describe('one master only', () => {
  it('a different device must not write: nothing is created or changed', async () => {
    await master('phone-1', 'Galaxy').runBackup();
    const before = JSON.stringify([...drive.files.values()].map((f) => [f.id, f.content]));
    const writes = () => drive.requests.filter((r) => r.method !== 'GET').length;
    const w0 = writes();
    await expect(master('desktop-9', 'Office PC').runBackup()).rejects.toBeInstanceOf(MasterMismatchError);
    expect(writes()).toBe(w0);
    expect(JSON.stringify([...drive.files.values()].map((f) => [f.id, f.content]))).toBe(before);
  });
  it('the error names the current master', async () => {
    await master('phone-1', 'Galaxy').runBackup();
    const err = await master('desktop-9', 'Office PC').runBackup().catch((e) => e);
    expect(err.current).toMatchObject({ deviceId: 'phone-1', deviceName: 'Galaxy' });
  });
  it('inspect (read-only) tells a would-be master who holds the role and whether its data may be behind', async () => {
    await master('phone-1', 'Galaxy').runBackup();
    const w0 = drive.requests.filter((r) => r.method !== 'GET').length;
    const i = await master('desktop-9', 'Office PC').inspect();
    expect(i.decision).toMatchObject({ kind: 'takeover', reason: 'other-device', current: { deviceId: 'phone-1' } });
    expect(i.staleness).toBe('other-device');
    expect(i.newest?.deviceName).toBe('Galaxy');
    expect(drive.requests.filter((r) => r.method !== 'GET').length).toBe(w0);
  });
  it('after an explicit take-over the new device is master and the old one is refused', async () => {
    const phone = master('phone-1', 'Galaxy'), pc = master('desktop-9', 'Office PC');
    await phone.runBackup();
    await pc.claim();
    await expect(phone.runBackup()).rejects.toBeInstanceOf(MasterMismatchError);
    await expect(pc.runBackup()).resolves.toBeTruthy();
    expect([...drive.files.values()].filter((f) => f.name === MASTER_FILE_NAME)).toHaveLength(1); // updated in place, not duplicated
  });
  it('a damaged master.json is treated as "someone else": it needs confirmation, it is never silently overwritten', async () => {
    const svc = master();
    await svc.runBackup();
    const m = [...drive.files.values()].find((f) => f.name === MASTER_FILE_NAME)!;
    m.content = 'garbage';
    await expect(svc.runBackup()).rejects.toBeInstanceOf(MasterMismatchError);
    expect(m.content).toBe('garbage');
    expect((await svc.inspect()).decision).toMatchObject({ kind: 'takeover', reason: 'unreadable' });
  });
  it('a first device finds no master and no snapshots', async () => {
    const i = await master().inspect();
    expect(i).toMatchObject({ master: { kind: 'none' }, decision: { kind: 'claim' }, newest: null, staleness: 'no-snapshots' });
  });
});

describe('viewer: read-only, and sees what the master wrote', () => {
  it('loads the newest snapshot, migrated in memory, using GET requests only', async () => {
    const svc = master();
    await svc.runBackup();
    await svc.runBackup();
    const v = viewer();
    const mark = drive.requests.length;
    const loaded = await v.service.loadLatest();
    expect(loaded.snapshot.flights).toHaveLength(1);
    expect(loaded.info.deviceName).toBe('Galaxy');
    expect(loaded.info.name).toBe(ours().map((f) => f.name).sort().at(-1));
    const mine = drive.requests.slice(mark);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.method === 'GET')).toBe(true);
  });
  it('the viewer service has no way to write: its client object exposes no write methods', () => {
    const reader = viewer().service as unknown as { reader: object };
    for (const m of ['createFolder', 'createJson', 'updateJson', 'deleteFile']) expect((reader.reader as Record<string, unknown>)[m]).toBeUndefined();
  });
  it('sees files created by the same OAuth client from another origin, but never another client\'s files (drive.file scope)', async () => {
    await master('phone-1', 'Galaxy', CLIENT).runBackup();
    expect((await viewer(CLIENT).service.listSnapshots())).toHaveLength(1);
    expect((await viewer('client-B.apps.googleusercontent.com').service.listSnapshots())).toHaveLength(0);
  });
  it('says so clearly when there is nothing to load yet', async () => {
    await expect(viewer().service.loadLatest()).rejects.toBeInstanceOf(NoBackupsError);
    await master().runBackup();
    for (const f of ours()) drive.files.delete(f.id);
    await expect(viewer().service.loadLatest()).rejects.toBeInstanceOf(NoBackupsError);
  });
  it('reports a snapshot it cannot understand instead of showing wrong data', async () => {
    await master().runBackup();
    ours()[0]!.content = JSON.stringify({ app: 'flightbook', schemaVersion: 99 });
    await expect(viewer().service.loadLatest()).rejects.toBeInstanceOf(SnapshotError);
    ours()[0]!.content = 'not json';
    await expect(viewer().service.loadLatest()).rejects.toBeInstanceOf(SnapshotError);
  });
  it('shows the current master', async () => {
    await master('phone-1', 'Galaxy').runBackup();
    expect(await viewer().service.currentMaster()).toMatchObject({ deviceName: 'Galaxy' });
  });
  it('lists every snapshot even when Drive returns several pages', async () => {
    const svc = master();
    await svc.runBackup();
    const folder = [...drive.files.values()].find((f) => f.mimeType.endsWith('folder'))!;
    for (let i = 0; i < 150; i++) {
      const name = `flightbook-snapshot-2024${String(1 + Math.floor(i / 28)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}T000000Z.json`;
      drive.files.set(`bulk${i}`, { id: `bulk${i}`, name, mimeType: 'application/json', parents: [folder.id], content: '{}', createdTime: `2024-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`, trashed: false, clientId: CLIENT });
    }
    const list = await viewer().service.listSnapshots();
    expect(list.length).toBe(151);
    expect(drive.requests.filter((r) => r.path === '/drive/v3/files' && r.method === 'GET').length).toBeGreaterThanOrEqual(3);
  });
});

describe('robustness', () => {
  it('retries once with a fresh token when Drive says the token expired', async () => {
    const svc = master();
    await svc.runBackup();
    drive.expireTokens();
    const r = await svc.runBackup();
    expect(r.file.name).toMatch(/^flightbook-snapshot-/);
    expect(drive.requests.filter((q) => q.method === 'POST' && q.path.startsWith('/upload')).length).toBeGreaterThan(1);
  });
  it('retries rate limits and server errors, then gives up with a readable error', async () => {
    const svc = master();
    drive.failNext(503, 2);
    await expect(svc.runBackup()).resolves.toBeTruthy();
    drive.failNext(503, 5);
    const err = await master().runBackup().catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err.status).toBe(503);
  });
  it('offline is reported as "unreachable", not as a Drive error', async () => {
    drive.goOffline(true);
    await expect(master().runBackup()).rejects.toBeInstanceOf(DriveUnreachableError);
  });
  it('without a token and no user gesture it asks for sign-in, and writes nothing', async () => {
    const tokens = fakeTokens(drive, CLIENT, { allowSilent: false });
    const svc = new BackupService(new DriveWriter({ tokens, fetchFn: drive.fetch, sleep: noSleep }), { device: () => ({ deviceId: 'a', deviceName: 'b' }), buildSnapshot: async () => { throw new Error('should not be called'); } });
    await expect(svc.runBackup({ interactive: false })).rejects.toBeInstanceOf(NeedsSignInError);
    expect(drive.files.size).toBe(0);
    await expect(svc.inspect({ interactive: false })).rejects.toBeInstanceOf(NeedsSignInError);
  });
  it('escapes quotes and backslashes in query literals, so a name can never break out of the query', () => {
    expect(qs("O'Brien")).toBe("'O\\'Brien'");
    expect(qs('a\\b')).toBe("'a\\\\b'");
    expect(qs("x' or name != '")).toBe("'x\\' or name != \\''");
  });
});
