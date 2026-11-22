import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupScheduler } from './scheduler';
import { DriveError, DriveUnreachableError, MasterMismatchError, NeedsSignInError } from './types';
import { BACKUP_INTERVAL_MS } from '../domain/driveRules';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function make(over: { run?: (i: boolean) => Promise<void>; last?: number | null; active?: boolean; online?: boolean } = {}) {
  const runs: boolean[] = [];
  const o = { last: over.last ?? null, active: over.active ?? true, online: over.online ?? true };
  const s = new BackupScheduler({
    run: async (i) => { runs.push(i); await over.run?.(i); },
    getLastBackupAt: () => o.last, isActive: () => o.active, isOnline: () => o.online, now: () => Date.now(), debounceMs: 20_000,
  });
  return { s, runs, o };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('app open', () => {
  it('backs up when there has never been a backup', async () => {
    const { s, runs } = make();
    s.appOpened(); await flush();
    expect(runs).toEqual([false]);
    expect(s.getState().status).toBe('idle');
  });
  it('backs up when the last one is 24 hours old or more, but not before', async () => {
    const now = Date.now();
    const recent = make({ last: now - BACKUP_INTERVAL_MS + 60_000 });
    recent.s.appOpened(); await flush();
    expect(recent.runs).toEqual([]);
    const due = make({ last: now - BACKUP_INTERVAL_MS });
    due.s.appOpened(); await flush();
    expect(due.runs).toEqual([false]);
  });
  it('does nothing at all on a device that is not an active master', async () => {
    const { s, runs } = make({ active: false });
    s.appOpened(); s.dataChanged(); s.backOnline(); await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toEqual([]);
    expect(s.getState().status).toBe('idle');
  });
});

describe('after saving', () => {
  it('waits for a quiet period and makes ONE backup for a burst of changes', async () => {
    const { s, runs } = make();
    s.dataChanged();
    expect(s.getState().status).toBe('scheduled');
    await vi.advanceTimersByTimeAsync(15_000); s.dataChanged();
    await vi.advanceTimersByTimeAsync(15_000); s.dataChanged();
    await vi.advanceTimersByTimeAsync(19_999);
    expect(runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(runs).toEqual([false]);
    expect(s.getState().status).toBe('idle');
  });
  it('a change made while a backup runs gets its own backup afterwards', async () => {
    let release!: () => void;
    const { s, runs } = make({ run: () => new Promise<void>((r) => { release = r; }) });
    s.dataChanged(); await vi.advanceTimersByTimeAsync(20_000);
    expect(s.getState().status).toBe('running');
    s.dataChanged();
    release(); await flush();
    expect(s.getState().status).toBe('scheduled');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(runs.length).toBe(2);
  });
});

describe('failures become visible states, never exceptions', () => {
  const failing = (e: Error) => make({ run: async () => { throw e; } });
  it('needs sign-in: shown as pending, and a manual backup (a tap) may use the popup', async () => {
    let fail = true;
    const { s, runs } = make({ run: async (i) => { if (fail && !i) throw new NeedsSignInError(); } });
    s.appOpened(); await flush();
    expect(s.getState().status).toBe('pending-signin');
    fail = false;
    await s.manual();
    expect(runs).toEqual([false, true]);
    expect(s.getState().status).toBe('idle');
  });
  it('another device is master: reported with who it is', async () => {
    const cur = { app: 'flightbook' as const, deviceId: 'd', deviceName: 'Office PC', claimedAt: 'x' };
    const { s } = failing(new MasterMismatchError(cur));
    s.appOpened(); await flush();
    expect(s.getState()).toMatchObject({ status: 'not-master', otherMaster: cur });
    s.clearNotMaster();
    expect(s.getState().status).toBe('idle');
  });
  it('unreachable is "offline" and retries when the connection returns', async () => {
    let n = 0;
    const { s, runs } = make({ run: async () => { if (n++ === 0) throw new DriveUnreachableError(); } });
    s.appOpened(); await flush();
    expect(s.getState().status).toBe('offline');
    s.backOnline(); await flush();
    expect(runs.length).toBe(2);
    expect(s.getState().status).toBe('idle');
  });
  it('does not even try while the browser is offline', async () => {
    const { s, runs, o } = make({ online: false });
    s.appOpened(); await flush();
    expect(runs).toEqual([]);
    expect(s.getState().status).toBe('offline');
    o.online = true; s.backOnline(); await flush();
    expect(runs.length).toBe(1);
  });
  it('other errors keep their message', async () => {
    const { s } = failing(new DriveError('Google Drive said 403: quota'));
    s.appOpened(); await flush();
    expect(s.getState()).toMatchObject({ status: 'error', error: 'Google Drive said 403: quota' });
  });
  it('an existing notice is not replaced by "scheduled" when more changes arrive', async () => {
    const { s } = failing(new NeedsSignInError());
    s.appOpened(); await flush();
    s.dataChanged();
    expect(s.getState().status).toBe('pending-signin');
  });
  it('notifies subscribers of every change', async () => {
    const { s } = make();
    const seen: string[] = [];
    s.subscribe(() => seen.push(s.getState().status));
    s.appOpened(); await flush();
    expect(seen).toEqual(['running', 'idle']);
  });
});
