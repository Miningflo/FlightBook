import { describe, expect, it } from 'vitest';
import {
  KEEP_SNAPSHOT_DAYS, assessStaleness, buildMasterFile, compactUtc, decideClaim, isSnapshotName, newestSnapshot, parseMasterFile,
  dailyRetentionPlan, retentionPlan, snapshotFileName, sortNewestFirst, type SnapshotFileInfo,
} from './driveRules';

const me = { deviceId: 'phone-1', deviceName: 'Galaxy' };
const file = (name: string, o: Partial<SnapshotFileInfo> = {}): SnapshotFileInfo => ({ id: name, name, createdTime: '2025-01-01T00:00:00Z', ...o });

describe('master.json', () => {
  it('records device id, device name and claim time', () => {
    expect(buildMasterFile(me, new Date('2025-06-30T10:00:00Z'))).toEqual({ app: 'flightbook', deviceId: 'phone-1', deviceName: 'Galaxy', claimedAt: '2025-06-30T10:00:00.000Z' });
  });
  it('round-trips', () => {
    const f = buildMasterFile(me, new Date('2025-06-30T10:00:00Z'));
    expect(parseMasterFile(JSON.stringify(f))).toEqual({ kind: 'ok', file: f });
  });
  it('a file that exists but is damaged is "unreadable", never "no master"', () => {
    for (const bad of ['', 'nope', '{}', '[]', 'null', JSON.stringify({ app: 'other', deviceId: 'x', deviceName: 'y', claimedAt: 'z' }), JSON.stringify({ app: 'flightbook', deviceId: '', deviceName: 'y', claimedAt: 'z' })]) {
      expect(parseMasterFile(bad)).toEqual({ kind: 'unreadable' });
    }
  });
});

describe('decideClaim: one master only', () => {
  const other = buildMasterFile({ deviceId: 'desktop-9', deviceName: 'Office PC' }, new Date('2025-05-01T08:00:00Z'));
  it('takes the role without asking when nobody has it', () => {
    expect(decideClaim(me, { kind: 'none' })).toEqual({ kind: 'claim' });
  });
  it('recognises itself', () => {
    expect(decideClaim(me, { kind: 'ok', file: buildMasterFile(me, new Date()) })).toEqual({ kind: 'mine' });
  });
  it('requires an explicit take-over when another device is master, naming it', () => {
    expect(decideClaim(me, { kind: 'ok', file: other })).toEqual({ kind: 'takeover', reason: 'other-device', current: other });
  });
  it('requires confirmation when master.json cannot be understood', () => {
    expect(decideClaim(me, { kind: 'unreadable' })).toEqual({ kind: 'takeover', reason: 'unreadable', current: null });
  });
});

describe('snapshot file names', () => {
  it('uses UTC with a sortable timestamp', () => {
    expect(compactUtc(new Date('2025-06-30T09:05:07Z'))).toBe('20250630T090507Z');
    expect(snapshotFileName(new Date('2025-06-30T09:05:07Z'))).toBe('flightbook-snapshot-20250630T090507Z.json');
  });
  it('never reuses a name taken in the same second', () => {
    const t = new Date('2025-06-30T09:05:07Z');
    const a = snapshotFileName(t);
    const b = snapshotFileName(t, new Set([a]));
    const c = snapshotFileName(t, new Set([a, b]));
    expect([a, b, c]).toEqual(['flightbook-snapshot-20250630T090507Z.json', 'flightbook-snapshot-20250630T090507Z-2.json', 'flightbook-snapshot-20250630T090507Z-3.json']);
    expect(new Set([a, b, c]).size).toBe(3);
  });
  it('only recognises its own files', () => {
    expect(isSnapshotName('flightbook-snapshot-20250630T090507Z.json')).toBe(true);
    expect(isSnapshotName('flightbook-snapshot-20250630T090507Z-2.json')).toBe(true);
    for (const n of ['master.json', 'notes.txt', 'flightbook-snapshot-2025.json', 'flightbook-snapshot-20250630T090507Z.json.bak', 'x-flightbook-snapshot-20250630T090507Z.json', 'flightbook-snapshotX20250630T090507Z.json']) expect(isSnapshotName(n)).toBe(false);
  });
});

describe('ordering and retention', () => {
  const at = (n: number) => file(snapshotFileName(new Date(Date.UTC(2025, 0, 1, 0, 0, n))));
  it('orders newest first by the time in the name, including same-second suffixes', () => {
    const a = file('flightbook-snapshot-20250630T090507Z.json'), b = file('flightbook-snapshot-20250630T090507Z-2.json'), c = file('flightbook-snapshot-20250630T090508Z.json');
    expect(sortNewestFirst([a, c, b]).map((f) => f.name)).toEqual([c.name, b.name, a.name]);
    expect(newestSnapshot([a, b, c])).toBe(c);
    expect(newestSnapshot([])).toBeNull();
  });
  it('keeps the newest 30 and offers only older snapshots for deletion', () => {
    const files = Array.from({ length: 35 }, (_, i) => at(i));
    const { keep, prune } = retentionPlan(files, 30);
    expect(keep).toHaveLength(30);
    expect(prune).toHaveLength(5);
    expect(prune.map((f) => f.name)).toEqual(files.slice(0, 5).reverse().map((f) => f.name)); // the five oldest
    expect(keep[0]).toBe(files[34]);
  });
  it('never offers a file that is not ours, however many there are', () => {
    const files = [...Array.from({ length: 31 }, (_, i) => at(i)), file('master.json'), file('my-holiday-photo.jpg'), file('flightbook-snapshot-notes.txt')];
    const { keep, prune } = retentionPlan(files, 30);
    expect(prune.map((f) => f.name)).toEqual([files[0]!.name]);
    expect([...keep, ...prune].some((f) => f.name === 'master.json' || f.name.endsWith('.jpg') || f.name.endsWith('.txt'))).toBe(false);
  });
  it('with fewer snapshots than the limit nothing is pruned', () => {
    expect(retentionPlan(Array.from({ length: 29 }, (_, i) => at(i)), 30).prune).toEqual([]);
    expect(retentionPlan([], 30)).toEqual({ keep: [], prune: [] });
  });
});

describe('daily retention of snapshots', () => {
  const on = (day: number, h = 12, m = 0) => file(snapshotFileName(new Date(Date.UTC(2025, 0, day, h, m))));
  it('keeps 30 days', () => {
    expect(KEEP_SNAPSHOT_DAYS).toBe(30);
  });
  it('keeps only the last snapshot of each day', () => {
    const files = [on(1, 9), on(1, 18), on(1, 23, 59), on(2, 8), on(2, 10)];
    const { keep, prune } = dailyRetentionPlan(files, 30);
    expect(keep.map((f) => f.name)).toEqual([files[4]!.name, files[2]!.name]);
    expect(prune.map((f) => f.name).sort()).toEqual([files[0]!.name, files[1]!.name, files[3]!.name].sort());
  });
  it('groups by the UTC day in the file name, including same-second suffixes', () => {
    const a = file('flightbook-snapshot-20250105T235959Z.json'), b = file('flightbook-snapshot-20250105T235959Z-2.json'), c = file('flightbook-snapshot-20250106T000000Z.json');
    const { keep } = dailyRetentionPlan([a, b, c], 30);
    expect(keep.map((f) => f.name)).toEqual([c.name, b.name]);
  });
  it('keeps the newest of each of the 30 most recent days and drops older days', () => {
    const files = Array.from({ length: 35 }, (_, i) => on(i + 1));
    const { keep, prune } = dailyRetentionPlan(files, 30);
    expect(keep).toHaveLength(30);
    expect(keep[0]).toBe(files[34]);
    expect(prune.map((f) => f.name)).toEqual(files.slice(0, 5).reverse().map((f) => f.name));
  });
  it('counts days that have a snapshot, so a long gap never empties the history', () => {
    const files = [on(1), on(2), on(3), file(snapshotFileName(new Date(Date.UTC(2025, 6, 1))))]; // then nothing for six months
    expect(dailyRetentionPlan(files, 30).prune).toEqual([]);
  });
  it('a burst of backups in one day cannot push older days out', () => {
    const files = [...Array.from({ length: 29 }, (_, i) => on(i + 1)), ...Array.from({ length: 50 }, (_, i) => on(30, 8, i))];
    const { keep } = dailyRetentionPlan(files, 30);
    expect(keep).toHaveLength(30);
    expect(keep.at(-1)).toBe(files[0]); // day 1 survives
  });
  it('keeps one per device per day, so one device never deletes what another wrote that day', () => {
    const by = (device: string, h: number) => ({ ...on(1, h), appProperties: { device } });
    const phoneEarly = by('phone', 8), phone = by('phone', 9), laptop = by('laptop', 10), unknown = on(1, 7);
    const { keep, prune } = dailyRetentionPlan([phoneEarly, phone, laptop, unknown], 30);
    expect(keep).toEqual([laptop, phone, unknown]);
    expect(prune).toEqual([phoneEarly]);
  });
  it('the file just written wins its day over one with a later name', () => {
    const later = on(1, 18), written = on(1, 9);
    expect(dailyRetentionPlan([later, written], 30, written)).toEqual({ keep: [written], prune: [later] });
  });
  it('never offers a file that is not ours', () => {
    const files = [on(1, 9), on(1, 10), file('master.json'), file('notes.txt'), file('flightbook-prerestore-20250101T120000Z.json')];
    const { keep, prune } = dailyRetentionPlan(files, 30);
    expect([...keep, ...prune].map((f) => f.name).sort()).toEqual([files[0]!.name, files[1]!.name].sort());
  });
});

describe('assessStaleness', () => {
  it('flags a newest snapshot written by another device, or by an unknown one', () => {
    expect(assessStaleness(me, null)).toBe('no-snapshots');
    expect(assessStaleness(me, file('a', { deviceId: 'phone-1' }))).toBe('mine');
    expect(assessStaleness(me, file('a', { deviceId: 'desktop-9' }))).toBe('other-device');
    expect(assessStaleness(me, file('a'))).toBe('other-device'); // cannot tell: be careful
  });
});
