/**
 * Pure rules for the Google Drive backup: who is the master, how snapshot files are named,
 * which old ones may be pruned, and whether a device's data may be out of date.
 * Nothing here touches the network, so all of it is unit-tested directly.
 */

export const BACKUP_FOLDER_NAME = 'Logbook backups';
export const MASTER_FILE_NAME = 'master.json';
export const SNAPSHOT_PREFIX = 'flightbook-snapshot-';
export const PRE_RESTORE_PREFIX = 'flightbook-prerestore-';
/**
 * Snapshots kept in the backup folder: one per day (the last of that day), for this many days. Counted in
 * days that have a snapshot, not calendar days, so a few weeks without flying never empties the history.
 */
export const KEEP_SNAPSHOT_DAYS = 30;
/** Safety copies made just before a "replace everything" restore. */
export const KEEP_PRE_RESTORE = 5;
/** A backup is due on app open when the last successful one is older than this. */
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ---------------- master.json ----------------

export interface MasterFile {
  app: 'flightbook';
  deviceId: string;
  deviceName: string;
  /** ISO time the device claimed the master role. */
  claimedAt: string;
}

export function buildMasterFile(me: { deviceId: string; deviceName: string }, now: Date): MasterFile {
  return { app: 'flightbook', deviceId: me.deviceId, deviceName: me.deviceName, claimedAt: now.toISOString() };
}

export type MasterRead = { kind: 'none' } | { kind: 'ok'; file: MasterFile } | { kind: 'unreadable' };

/** Interpret the text of master.json. A file that exists but cannot be understood is NOT treated as "no master". */
export function parseMasterFile(text: string): MasterRead {
  try {
    const v = JSON.parse(text) as Partial<MasterFile> | null;
    if (v && v.app === 'flightbook' && typeof v.deviceId === 'string' && v.deviceId !== '' && typeof v.deviceName === 'string' && typeof v.claimedAt === 'string') {
      return { kind: 'ok', file: { app: 'flightbook', deviceId: v.deviceId, deviceName: v.deviceName, claimedAt: v.claimedAt } };
    }
  } catch { /* fall through */ }
  return { kind: 'unreadable' };
}

export type ClaimDecision =
  | { kind: 'claim' } // nobody is master yet: take the role without asking
  | { kind: 'mine' } // this device already is the master
  | { kind: 'takeover'; reason: 'other-device'; current: MasterFile } // warn and require explicit confirmation
  | { kind: 'takeover'; reason: 'unreadable'; current: null };

export function decideClaim(me: { deviceId: string }, remote: MasterRead): ClaimDecision {
  if (remote.kind === 'none') return { kind: 'claim' };
  if (remote.kind === 'unreadable') return { kind: 'takeover', reason: 'unreadable', current: null };
  return remote.file.deviceId === me.deviceId ? { kind: 'mine' } : { kind: 'takeover', reason: 'other-device', current: remote.file };
}

// ---------------- snapshot files ----------------

export interface SnapshotFileInfo {
  id: string;
  name: string;
  /** Drive's creation time (ISO). */
  createdTime: string;
  size?: number;
  deviceId?: string;
  deviceName?: string;
  schemaVersion?: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `YYYYMMDDTHHMMSSZ` in UTC. */
export function compactUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** File name for a snapshot taken at `at`; a numeric suffix keeps it unique if the same second is already taken. */
export function snapshotFileName(at: Date, taken: ReadonlySet<string> = new Set(), prefix = SNAPSHOT_PREFIX): string {
  const base = `${prefix}${compactUtc(at)}`;
  if (!taken.has(`${base}.json`)) return `${base}.json`;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}.json`)) return `${base}-${i}.json`;
}

const NAME_RE = (prefix: string) => new RegExp(`^${prefix.replace(/[-]/g, '\\-')}(\\d{8}T\\d{6}Z)(?:-(\\d+))?\\.json$`);

/** Whether a name is one of OUR snapshot files. Only these are ever listed as snapshots or pruned. */
export function isSnapshotName(name: string, prefix = SNAPSHOT_PREFIX): boolean {
  return NAME_RE(prefix).test(name);
}

/** Sort key: time of the snapshot (from its name), then the same-second suffix. Larger = newer. */
function nameKey(name: string, prefix: string): string {
  const m = NAME_RE(prefix).exec(name);
  return m ? `${m[1]}-${String(m[2] ?? 1).padStart(6, '0')}` : '';
}

export function sortNewestFirst<T extends { name: string }>(files: T[], prefix = SNAPSHOT_PREFIX): T[] {
  return files.filter((f) => isSnapshotName(f.name, prefix)).sort((a, b) => nameKey(b.name, prefix).localeCompare(nameKey(a.name, prefix)));
}

export function newestSnapshot(files: SnapshotFileInfo[]): SnapshotFileInfo | null {
  return sortNewestFirst(files)[0] ?? null;
}

export interface RetentionPlan<T> { keep: T[]; prune: T[] }

/** The newest `keep` files and the rest. Files that are not ours are in neither list: they are never touched. */
export function retentionPlan<T extends { name: string }>(files: T[], keep: number, prefix = SNAPSHOT_PREFIX): RetentionPlan<T> {
  const sorted = sortNewestFirst(files, prefix);
  return { keep: sorted.slice(0, keep), prune: sorted.slice(keep) };
}

/**
 * One snapshot per day: the newest of each of the `days` most recent days (UTC, from the file name) that
 * have one; everything else may be deleted. A burst of edits therefore costs one file, not thirty, and
 * cannot push older days out. The newest snapshot of all is always kept. Files that are not ours are in
 * neither list.
 */
export function dailyRetentionPlan<T extends { name: string }>(files: T[], days: number, prefix = SNAPSHOT_PREFIX): RetentionPlan<T> {
  const plan: RetentionPlan<T> = { keep: [], prune: [] };
  const seen = new Set<string>();
  for (const f of sortNewestFirst(files, prefix)) {
    const day = NAME_RE(prefix).exec(f.name)![1]!.slice(0, 8);
    if (!seen.has(day) && seen.size < days) { seen.add(day); plan.keep.push(f); } else plan.prune.push(f);
  }
  return plan;
}

export type Staleness = 'no-snapshots' | 'mine' | 'other-device';

/**
 * Might this device's data be behind what is in Drive? True when the newest snapshot was written by a
 * different device (or by one we cannot identify): taking over without restoring it first could bury newer data.
 */
export function assessStaleness(me: { deviceId: string }, newest: SnapshotFileInfo | null): Staleness {
  if (!newest) return 'no-snapshots';
  return newest.deviceId === me.deviceId ? 'mine' : 'other-device';
}
