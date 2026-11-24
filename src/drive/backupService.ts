import {
  BACKUP_FOLDER_NAME, KEEP_PRE_RESTORE, KEEP_SNAPSHOT_DAYS, MASTER_FILE_NAME, PRE_RESTORE_PREFIX, SNAPSHOT_PREFIX,
  type ClaimDecision, type MasterFile, type MasterRead, type SnapshotFileInfo, type Staleness,
  assessStaleness, buildMasterFile, dailyRetentionPlan, decideClaim, newestSnapshot, parseMasterFile, retentionPlan, snapshotFileName, sortNewestFirst,
} from '../domain/driveRules';
import { type Snapshot, SNAPSHOT_SCHEMA_VERSION, parseSnapshot, serializeSnapshot } from '../domain/snapshot';
import { type DriveOptions, DriveReader, DriveWriter } from './driveApi';
import { type DriveFile, MasterMismatchError, NoBackupsError } from './types';

export interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
}

const toInfo = (f: DriveFile): SnapshotFileInfo => ({
  id: f.id, name: f.name, createdTime: f.createdTime, size: f.size,
  deviceId: f.appProperties?.device, deviceName: f.appProperties?.deviceName,
  schemaVersion: f.appProperties?.schema ? Number(f.appProperties.schema) : undefined,
});

/** master.json from a folder listing, using GET requests only. */
async function readMasterFile(reader: DriveReader, files: DriveFile[], opts: DriveOptions): Promise<{ read: MasterRead; fileId: string | null }> {
  const f = files.find((x) => x.name === MASTER_FILE_NAME);
  if (!f) return { read: { kind: 'none' }, fileId: null };
  return { read: parseMasterFile(await reader.downloadText(f.id, opts)), fileId: f.id };
}

export interface MasterInspection {
  master: MasterRead;
  decision: ClaimDecision;
  newest: SnapshotFileInfo | null;
  staleness: Staleness;
}

/** What is in Drive, and what taking over the master role would mean. Uses GET requests only, so any device may call it. */
export async function inspectMaster(reader: DriveReader, me: DeviceIdentity, opts: DriveOptions = {}): Promise<MasterInspection> {
  const folder = await reader.findFolder(BACKUP_FOLDER_NAME, opts);
  const files = folder ? await reader.listFolder(folder, opts) : [];
  const { read } = await readMasterFile(reader, files, opts);
  const newest = newestSnapshot(files.map(toInfo));
  return { master: read, decision: decideClaim(me, read), newest, staleness: assessStaleness(me, newest) };
}

/**
 * The MASTER device's side of Drive: claims the role, writes snapshots, prunes old ones.
 * Only the master constructs this (it needs a DriveWriter).
 */
export class BackupService {
  private folderId: string | null = null;

  constructor(
    private readonly writer: DriveWriter,
    private readonly deps: { device: () => DeviceIdentity; buildSnapshot: () => Promise<Snapshot>; now?: () => Date },
  ) {}

  private now(): Date { return this.deps.now ? this.deps.now() : new Date(); }

  /** Find the backup folder, creating it only when `create` is set (and nobody else has made one). */
  private async folder(opts: DriveOptions, create: boolean): Promise<string | null> {
    if (this.folderId) return this.folderId;
    const found = await this.writer.findFolder(BACKUP_FOLDER_NAME, opts);
    if (found) return (this.folderId = found);
    if (!create) return null;
    return (this.folderId = await this.writer.createFolder(BACKUP_FOLDER_NAME, opts));
  }

  /** What is in Drive, and what taking over the master role would mean. Read-only. */
  inspect(opts: DriveOptions = {}): Promise<MasterInspection> {
    return inspectMaster(this.writer, this.deps.device(), opts);
  }

  /** Become the master: write master.json. The caller has already got the user's explicit confirmation if needed. */
  async claim(opts: DriveOptions = {}): Promise<MasterFile> {
    const folder = (await this.folder(opts, true))!;
    const files = await this.writer.listFolder(folder, opts);
    const file = buildMasterFile(this.deps.device(), this.now());
    const json = `${JSON.stringify(file)}\n`;
    const existing = files.find((f) => f.name === MASTER_FILE_NAME);
    if (existing) await this.writer.updateJson(existing.id, json, undefined, opts);
    else await this.writer.createJson({ folderId: folder, name: MASTER_FILE_NAME, json }, opts);
    return file;
  }

  /**
   * Write one snapshot, then prune. Before writing it checks master.json: if another device holds the role,
   * NOTHING is written and MasterMismatchError is thrown. If nobody holds it, this device claims it.
   */
  async runBackup(opts: DriveOptions = {}): Promise<{ file: SnapshotFileInfo; pruned: number; warnings: string[] }> {
    const folder = (await this.folder(opts, true))!;
    const files = await this.writer.listFolder(folder, opts);
    const { read } = await readMasterFile(this.writer, files, opts);
    const decision = decideClaim(this.deps.device(), read);
    if (decision.kind === 'takeover') throw new MasterMismatchError(decision.current);
    if (decision.kind === 'claim') await this.claim(opts);

    const snapshot = await this.deps.buildSnapshot();
    const created = await this.upload(folder, SNAPSHOT_PREFIX, snapshot, new Set(files.map((f) => f.name)), 'snapshot', opts);
    // one snapshot per day: this one replaces any earlier one from today
    const { pruned, warnings } = await this.prune(dailyRetentionPlan([...files, created], KEEP_SNAPSHOT_DAYS).prune, opts);
    return { file: toInfo(created), pruned, warnings };
  }

  /** A copy of the current logbook taken just before a "replace everything" restore. Kept apart from the daily snapshots. */
  async saveSafetyCopy(opts: DriveOptions = {}): Promise<SnapshotFileInfo> {
    const folder = (await this.folder(opts, true))!;
    const files = await this.writer.listFolder(folder, opts);
    const created = await this.upload(folder, PRE_RESTORE_PREFIX, await this.deps.buildSnapshot(), new Set(files.map((f) => f.name)), 'prerestore', opts);
    await this.prune(retentionPlan([...files, created], KEEP_PRE_RESTORE, PRE_RESTORE_PREFIX).prune, opts);
    return toInfo(created);
  }

  private async upload(folderId: string, prefix: string, snapshot: Snapshot, taken: Set<string>, kind: string, opts: DriveOptions): Promise<DriveFile> {
    const me = this.deps.device();
    return this.writer.createJson({
      folderId, name: snapshotFileName(this.now(), taken, prefix), json: serializeSnapshot(snapshot),
      appProperties: { fb: kind, schema: String(SNAPSHOT_SCHEMA_VERSION), device: me.deviceId, deviceName: me.deviceName.slice(0, 60) },
    }, opts);
  }

  /** Delete the files a retention plan gave up (only ever OUR snapshots). A failed delete is reported, never fatal. */
  private async prune(prune: DriveFile[], opts: DriveOptions): Promise<{ pruned: number; warnings: string[] }> {
    const warnings: string[] = [];
    let pruned = 0;
    for (const f of prune) {
      try { await this.writer.deleteFile(f.id, opts); pruned++; }
      catch (e) { warnings.push(`Could not delete the old snapshot ${f.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return { pruned, warnings };
  }

  async listSnapshots(opts: DriveOptions = {}): Promise<SnapshotFileInfo[]> {
    const folder = await this.folder(opts, false);
    return folder ? sortNewestFirst((await this.writer.listFolder(folder, opts)).map(toInfo)) : [];
  }

  /** The safety copies taken just before earlier restores (newest first), so a restore can itself be undone. */
  async listSafetyCopies(opts: DriveOptions = {}): Promise<SnapshotFileInfo[]> {
    const folder = await this.folder(opts, false);
    return folder ? sortNewestFirst((await this.writer.listFolder(folder, opts)).map(toInfo), PRE_RESTORE_PREFIX) : [];
  }

  /** Download and parse one snapshot (migrations run in memory). */
  async download(fileId: string, opts: DriveOptions = {}): Promise<Snapshot> {
    return parseSnapshot(await this.writer.downloadText(fileId, opts));
  }
}

export interface LoadedSnapshot {
  info: SnapshotFileInfo;
  /** The file exactly as downloaded (kept as the viewer's local cache). */
  text: string;
  snapshot: Snapshot;
}

/**
 * The VIEWER's side of Drive. It is constructed with a DriveReader, which has no write operations,
 * so a viewer cannot write to Drive or change a snapshot even by mistake.
 */
export class ViewerService {
  constructor(private readonly reader: DriveReader) {}

  async listSnapshots(opts: DriveOptions = {}): Promise<SnapshotFileInfo[]> {
    const folder = await this.reader.findFolder(BACKUP_FOLDER_NAME, opts);
    return folder ? sortNewestFirst((await this.reader.listFolder(folder, opts)).map(toInfo)) : [];
  }

  async loadLatest(opts: DriveOptions = {}): Promise<LoadedSnapshot> {
    const newest = (await this.listSnapshots(opts))[0];
    if (!newest) throw new NoBackupsError();
    const text = await this.reader.downloadText(newest.id, opts);
    return { info: newest, text, snapshot: parseSnapshot(text) };
  }

  /** What taking over the master role would mean (read-only; a viewer may ask before it becomes master). */
  inspectMaster(me: DeviceIdentity, opts: DriveOptions = {}): Promise<MasterInspection> {
    return inspectMaster(this.reader, me, opts);
  }

  /** Download and parse one snapshot (migrations run in memory). */
  async download(fileId: string, opts: DriveOptions = {}): Promise<Snapshot> {
    return parseSnapshot(await this.reader.downloadText(fileId, opts));
  }

  /** The current master device, for display. */
  async currentMaster(opts: DriveOptions = {}): Promise<MasterFile | null> {
    const folder = await this.reader.findFolder(BACKUP_FOLDER_NAME, opts);
    if (!folder) return null;
    const { read } = await readMasterFile(this.reader, await this.reader.listFolder(folder, opts), opts);
    return read.kind === 'ok' ? read.file : null;
  }
}
