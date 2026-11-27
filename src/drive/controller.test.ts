import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveController, type ControllerDeps } from './controller';
import { createFakeDrive, fakeTokens, type FakeDrive } from './testing/fakeDrive';
import { defaultSettings } from '../db/db';
import { buildSnapshot, type Snapshot } from '../domain/snapshot';
import { flight } from '../domain/testFactories';
import type { Person, Settings, ViewerCacheEntry } from '../domain/types';
import { isSnapshotName } from '../domain/driveRules';

const CLIENT = 'client-A';
const self: Person = { id: 'p', name: 'SELF', nameKey: 'self', isSelf: true, createdAt: 1, updatedAt: 1 };
const noSleep = async () => {};

let drive: FakeDrive;
beforeEach(() => { drive = createFakeDrive(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

interface Device { c: DriveController; settings: Settings; cache: { v?: ViewerCacheEntry }; tokens: ReturnType<typeof fakeTokens>; flights: { n: number }; built: number[] }

function device(name: string, role: 'master' | 'viewer', o: { enabled?: boolean; silent?: boolean; online?: () => boolean; clock?: { t: number }; configured?: boolean } = {}): Device {
  const settings: Settings = { ...defaultSettings(), deviceId: `id-${name}`, deviceName: name, isMaster: role === 'master', setupDone: true, driveEnabled: o.enabled ?? false };
  const cache: { v?: ViewerCacheEntry } = {};
  const tokens = fakeTokens(drive, CLIENT, { allowSilent: o.silent ?? true });
  const flights = { n: 1 };
  const built: number[] = [];
  const clock = o.clock ?? { t: Date.UTC(2025, 5, 1, 10) };
  const deps: ControllerDeps = {
    configured: o.configured ?? true, tokens, fetchFn: drive.fetch, sleep: noSleep,
    getSettings: () => settings,
    updateSettings: async (p) => { Object.assign(settings, p); c.settingsChanged(); },
    buildSnapshot: async (): Promise<Snapshot> => { built.push(flights.n); return buildSnapshot({ exportedAt: '', deviceId: settings.deviceId, deviceName: settings.deviceName, settings: {}, aircraft: [], persons: [self], flights: Array.from({ length: flights.n }, (_, i) => flight(`2025-03-0${i + 1}`)), fstdSessions: [], previousExperience: [], attachments: [] }); },
    readPendingChange: async () => settings.pendingChange ?? null,
    clearPendingChange: async (token) => { if (settings.pendingChange === token) settings.pendingChange = null; },
    readViewerCache: async () => cache.v, writeViewerCache: async (e) => { cache.v = e; },
    now: () => (clock.t += 1000), isOnline: o.online, debounceMs: 20_000,
  };
  const c = new DriveController(deps);
  return { c, settings, cache, tokens, flights, built };
}
const snapshotsInDrive = () => [...drive.files.values()].filter((f) => isSnapshotName(f.name));
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('master', () => {
  it('connect + backup: claims the role, writes a snapshot and records the time of the last success', async () => {
    const m = device('Phone', 'master');
    await m.c.connect();
    expect(m.settings.driveEnabled).toBe(true);
    expect((await m.c.inspectMaster()).decision.kind).toBe('claim');
    await m.c.claimMaster();
    await m.c.backupNow();
    expect(snapshotsInDrive()).toHaveLength(1);
    expect(m.c.getState().backup.status).toBe('idle');
    expect(m.settings.lastBackupAt).toBeGreaterThan(0);
    expect(m.c.getState().backup.lastBackupAt).toBe(m.settings.lastBackupAt);
  });
  it('after saving a flight a backup follows once things go quiet, and the new data is in it', async () => {
    const m = device('Phone', 'master', { enabled: true });
    m.flights.n = 3;
    m.c.scheduler.dataChanged();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(snapshotsInDrive()).toHaveLength(1);
    expect(JSON.parse(snapshotsInDrive()[0]!.content).flights).toHaveLength(3);
  });
  it('on app open it backs up only if the last backup is over 24 hours old', async () => {
    const m = device('Phone', 'master', { enabled: true });
    m.settings.lastBackupAt = Date.UTC(2025, 5, 1, 10) - 3_600_000; // an hour ago
    m.c.scheduler.appOpened(); await flush();
    expect(snapshotsInDrive()).toHaveLength(0);
    m.settings.lastBackupAt = Date.UTC(2025, 5, 1, 10) - 25 * 3_600_000;
    m.c.scheduler.appOpened(); await flush();
    expect(snapshotsInDrive()).toHaveLength(1);
  });
  it('without a silent token it shows "sign in", and the Backup now button (a tap) completes it', async () => {
    const m = device('Phone', 'master', { enabled: true, silent: false });
    m.c.scheduler.appOpened(); await flush();
    expect(m.c.getState().backup.status).toBe('pending-signin');
    expect(snapshotsInDrive()).toHaveLength(0);
    await m.c.backupNow();
    expect(m.c.getState().backup.status).toBe('idle');
    expect(snapshotsInDrive()).toHaveLength(1);
  });
  it('a second device cannot write once another is master, and the state names the master', async () => {
    const phone = device('Phone', 'master', { enabled: true });
    await phone.c.backupNow();
    const pc = device('Office PC', 'master', { enabled: true });
    const before = drive.requests.filter((r) => r.method !== 'GET').length;
    await pc.c.backupNow();
    expect(pc.c.getState().backup.status).toBe('not-master');
    expect(pc.c.getState().backup.otherMaster).toMatchObject({ deviceName: 'Phone' });
    expect(drive.requests.filter((r) => r.method !== 'GET').length).toBe(before);
    expect(snapshotsInDrive()).toHaveLength(1);
  });
  it('explicit take-over: inspect shows who and whether data may be behind, claim makes it the master, the old one is then refused', async () => {
    const phone = device('Phone', 'master', { enabled: true });
    await phone.c.backupNow();
    const pc = device('Office PC', 'master', { enabled: true });
    const i = await pc.c.inspectMaster();
    expect(i.decision).toMatchObject({ kind: 'takeover', current: { deviceName: 'Phone' } });
    expect(i.staleness).toBe('other-device');
    await pc.c.claimMaster();
    await pc.c.backupNow();
    expect(pc.c.getState().backup.status).toBe('idle');
    await phone.c.backupNow();
    expect(phone.c.getState().backup.status).toBe('not-master');
    expect(phone.c.getState().backup.otherMaster).toMatchObject({ deviceName: 'Office PC' });
  });
  it('a viewer device cannot reach any write path, even by calling the master methods', async () => {
    const v = device('Desktop', 'viewer', { enabled: true });
    await expect(v.c.listSnapshots()).rejects.toThrow(/Only the master/);
    await expect(v.c.downloadSnapshot('x')).rejects.toThrow(/Only the master/);
    await v.c.backupNow(); // the scheduler is inactive on a viewer: nothing happens
    await expect(v.c.claimMaster()).rejects.toThrow(/Only the master/);
    await expect(v.c.saveSafetyCopy()).rejects.toThrow(/Only the master/);
    expect(drive.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  });
  it('any device may look before it takes over (read-only), including a viewer that is not master yet', async () => {
    const phone = device('Phone', 'master', { enabled: true });
    await phone.c.backupNow();
    const v = device('Desktop', 'viewer', { enabled: true });
    const mark = drive.requests.length;
    const i = await v.c.inspectMaster();
    expect(i.decision).toMatchObject({ kind: 'takeover', current: { deviceName: 'Phone' } });
    expect(i.staleness).toBe('other-device');
    expect(drive.requests.slice(mark).every((r) => r.method === 'GET')).toBe(true);
  });
  it('disconnect forgets Drive and stops backups', async () => {
    const m = device('Phone', 'master');
    await m.c.connect();
    await m.c.disconnect();
    expect(m.settings.driveEnabled).toBe(false);
    m.c.scheduler.dataChanged(); await vi.advanceTimersByTimeAsync(30_000);
    expect(snapshotsInDrive()).toHaveLength(0);
  });
  it('disconnect passes on whether Google removed the access, and forgets Drive even if it did not', async () => {
    for (const [revoke, revoked] of [[async () => true, true], [async () => false, false], [async () => { throw new Error('offline'); }, false]] as const) {
      const m = device('Phone', 'master', { enabled: true });
      Object.assign(m.tokens, { revoke });
      expect(await m.c.disconnect()).toEqual({ revoked });
      expect(m.settings.driveEnabled).toBe(false);
    }
  });
});

describe('changes that are not backed up yet', () => {
  const recent = Date.UTC(2025, 5, 1, 10) - 3_600_000;
  it('are backed up on app open although the last backup is recent, and the marker is then cleared', async () => {
    const m = device('Phone', 'master', { enabled: true });
    Object.assign(m.settings, { lastBackupAt: recent, pendingChange: 'edit-1' });
    m.c.scheduler.appOpened(); await flush();
    expect(snapshotsInDrive()).toHaveLength(1);
    expect(m.settings.pendingChange).toBeNull();
  });
  it('show the sign-in notice after a restart, and stay marked until a backup includes them', async () => {
    const m = device('Phone', 'master', { enabled: true, silent: false });
    Object.assign(m.settings, { lastBackupAt: recent, pendingChange: 'edit-1' });
    m.c.scheduler.appOpened(); await flush();
    expect(m.c.getState().backup.status).toBe('pending-signin');
    expect(m.settings.pendingChange).toBe('edit-1');
    await m.c.backupNow();
    expect(m.settings.pendingChange).toBeNull();
  });
  it('are retried when the connection returns', async () => {
    const m = device('Phone', 'master', { enabled: true });
    m.settings.pendingChange = 'edit-1';
    m.c.scheduler.backOnline(); await flush();
    expect(snapshotsInDrive()).toHaveLength(1);
  });
  it('made while a backup is running stay marked', async () => {
    const m = device('Phone', 'master', { enabled: true });
    m.settings.pendingChange = 'before';
    const running = m.c.backupNow();
    await Promise.resolve(); await Promise.resolve();
    m.settings.pendingChange = 'during';
    await running;
    expect(m.settings.pendingChange).toBe('during');
  });
});

describe('viewer', () => {
  async function masterWithBackup(flights = 2) {
    const m = device('Phone', 'master', { enabled: true });
    m.flights.n = flights;
    await m.c.backupNow();
    return m;
  }
  it('loads the newest snapshot, shows who wrote it, caches it, and never writes to Drive', async () => {
    await masterWithBackup(2);
    const v = device('Desktop', 'viewer', { enabled: true });
    const mark = drive.requests.length;
    await v.c.startViewer();
    const st = v.c.getState().viewer;
    expect(st.status).toBe('ready');
    expect(st.info?.deviceName).toBe('Phone');
    expect(st.master).toMatchObject({ deviceName: 'Phone' });
    expect(v.c.getViewerSnapshot()!.flights).toHaveLength(2);
    expect(v.cache.v?.text).toContain('"flights"');
    expect(drive.requests.slice(mark).every((r) => r.method === 'GET')).toBe(true);
    expect(v.built).toEqual([]); // a viewer never builds a snapshot
  });
  it('Refresh picks up newer data from the master', async () => {
    const m = await masterWithBackup(1);
    const v = device('Desktop', 'viewer', { enabled: true });
    await v.c.startViewer();
    expect(v.c.getViewerSnapshot()!.flights).toHaveLength(1);
    const rev = v.c.getState().viewerRevision;
    m.flights.n = 4;
    await m.c.backupNow();
    await v.c.refreshViewer(true);
    expect(v.c.getViewerSnapshot()!.flights).toHaveLength(4);
    expect(v.c.getState().viewerRevision).toBeGreaterThan(rev);
  });
  it('opens at once from its cache and stays usable when offline or when sign-in is needed', async () => {
    await masterWithBackup(2);
    const first = device('Desktop', 'viewer', { enabled: true });
    await first.c.startViewer();
    // a later visit: offline
    const later = device('Desktop', 'viewer', { enabled: true, online: () => false });
    later.cache.v = first.cache.v;
    await later.c.startViewer();
    expect(later.c.getState().viewer.status).toBe('ready');
    expect(later.c.getViewerSnapshot()!.flights).toHaveLength(2);
    // and one that needs a tap to sign in
    const quiet = device('Desktop', 'viewer', { enabled: true, silent: false });
    quiet.cache.v = first.cache.v;
    await quiet.c.startViewer();
    expect(quiet.c.getState().viewer.status).toBe('ready');
    expect(quiet.c.getViewerSnapshot()!.flights).toHaveLength(2);
  });
  it('with no cache and no silent sign-in it asks the user to connect; with nothing in Drive it says so', async () => {
    const v = device('Desktop', 'viewer', { enabled: true, silent: false });
    await v.c.startViewer();
    expect(v.c.getState().viewer.status).toBe('needs-signin');
    const w = device('Desktop2', 'viewer', { enabled: true });
    await w.c.startViewer();
    expect(w.c.getState().viewer.status).toBe('empty');
    const notConnected = device('Desktop3', 'viewer', { enabled: false });
    await notConnected.c.startViewer();
    expect(notConnected.c.getState().viewer.status).toBe('needs-signin');
  });
  it('connecting then refreshing (user taps) loads the logbook', async () => {
    await masterWithBackup(3);
    const v = device('Desktop', 'viewer', { enabled: false, silent: false });
    await v.c.startViewer();
    expect(v.c.getState().viewer.status).toBe('needs-signin');
    await v.c.connect();
    await v.c.refreshViewer(true);
    expect(v.c.getViewerSnapshot()!.flights).toHaveLength(3);
  });
  it('a damaged cache is ignored and replaced by the download', async () => {
    await masterWithBackup(2);
    const v = device('Desktop', 'viewer', { enabled: true });
    v.cache.v = { key: 'latest', text: 'garbage', driveFileId: 'x', fileName: 'x', createdTime: '', loadedAt: 1 };
    await v.c.startViewer();
    expect(v.c.getViewerSnapshot()!.flights).toHaveLength(2);
  });
  it('when the newest snapshot cannot be read it keeps showing the previous one and says why', async () => {
    const m = await masterWithBackup(2);
    const v = device('Desktop', 'viewer', { enabled: true });
    await v.c.startViewer();
    await m.c.backupNow();
    snapshotsInDrive().sort((a, b) => a.name.localeCompare(b.name)).at(-1)!.content = 'not json';
    await v.c.refreshViewer(true);
    expect(v.c.getViewerSnapshot()!.flights).toHaveLength(2);
    expect(v.c.getState().viewer.error).toMatch(/not valid JSON/);
  });
  it('an unconfigured build never touches the network', async () => {
    const v = device('Desktop', 'viewer', { enabled: true, configured: false });
    await v.c.startViewer();
    await v.c.refreshViewer(true);
    expect(drive.requests).toEqual([]);
    expect(v.c.getState().configured).toBe(false);
  });
});
