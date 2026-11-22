import type { Settings, ViewerCacheEntry } from '../domain/types';
import type { MasterFile, SnapshotFileInfo } from '../domain/driveRules';
import { type Snapshot, SnapshotError, parseSnapshot } from '../domain/snapshot';
import { BackupService, type MasterInspection, ViewerService } from './backupService';
import { DriveReader, DriveWriter } from './driveApi';
import { BackupScheduler, type BackupStatus } from './scheduler';
import { DriveUnreachableError, NeedsSignInError, NoBackupsError, type TokenProvider } from './types';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'needs-signin' | 'empty' | 'offline' | 'error';

export interface DriveState {
  configured: boolean;
  enabled: boolean;
  backup: { status: BackupStatus; error?: string; otherMaster?: MasterFile | null; lastBackupAt: number | null; warnings: string[] };
  viewer: {
    status: ViewerStatus;
    error?: string;
    /** The snapshot currently shown, and when this device downloaded it. */
    info?: SnapshotFileInfo & { loadedAt: number };
    master?: MasterFile | null;
  };
  /** Bumped whenever the viewer's snapshot changes, so screens re-read it. */
  viewerRevision: number;
}

export interface ControllerDeps {
  configured: boolean;
  tokens: TokenProvider;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  getSettings: () => Settings;
  updateSettings: (patch: Partial<Omit<Settings, 'key'>>) => Promise<void>;
  /** The logbook as a snapshot (master only). */
  buildSnapshot: () => Promise<Snapshot>;
  readViewerCache: () => Promise<ViewerCacheEntry | undefined>;
  writeViewerCache: (e: ViewerCacheEntry) => Promise<void>;
  now?: () => number;
  isOnline?: () => boolean;
  debounceMs?: number;
}

/**
 * Everything about Drive for one device. The MASTER path uses a DriveWriter; the VIEWER path is only ever given
 * a DriveReader. State is observable (subscribe/getState) so React screens can follow it.
 */
export class DriveController {
  private listeners = new Set<() => void>();
  private loaded: Snapshot | null = null;
  private state: DriveState;
  readonly scheduler: BackupScheduler;
  private backupService: BackupService | null = null;
  private viewerService: ViewerService | null = null;

  constructor(private readonly d: ControllerDeps) {
    const s = d.getSettings();
    this.state = {
      configured: d.configured, enabled: !!s.driveEnabled,
      backup: { status: 'idle', lastBackupAt: s.lastBackupAt, warnings: [] },
      viewer: { status: 'idle' }, viewerRevision: 0,
    };
    this.scheduler = new BackupScheduler({
      run: (interactive) => this.runBackup(interactive),
      getLastBackupAt: () => this.d.getSettings().lastBackupAt,
      isActive: () => this.d.configured && !!this.d.getSettings().driveEnabled && !!this.d.getSettings().isMaster,
      isOnline: d.isOnline, now: d.now, debounceMs: d.debounceMs,
    });
    this.scheduler.subscribe(() => this.syncBackupState());
  }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getState = (): DriveState => this.state;
  /** The snapshot a viewer is showing (null until one is loaded). */
  getViewerSnapshot = (): Snapshot | null => this.loaded;
  private now(): number { return (this.d.now ?? Date.now)(); }
  private set(patch: Partial<DriveState>): void { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }

  private syncBackupState(): void {
    const s = this.scheduler.getState();
    this.set({ backup: { ...this.state.backup, status: s.status, error: s.error, otherMaster: s.otherMaster, lastBackupAt: this.d.getSettings().lastBackupAt } });
  }

  /** Called when settings change (role, Drive on/off), so cached services and the visible state follow. */
  settingsChanged(): void {
    const s = this.d.getSettings();
    if (!s.isMaster) this.backupService = null;
    this.set({ enabled: !!s.driveEnabled, backup: { ...this.state.backup, lastBackupAt: s.lastBackupAt } });
  }

  private writerService(): BackupService {
    if (!this.d.getSettings().isMaster) throw new Error('Only the master logbook can write to Google Drive.');
    return (this.backupService ??= new BackupService(new DriveWriter({ tokens: this.d.tokens, fetchFn: this.d.fetchFn, sleep: this.d.sleep }), {
      device: () => { const s = this.d.getSettings(); return { deviceId: s.deviceId, deviceName: s.deviceName }; },
      buildSnapshot: this.d.buildSnapshot, now: () => new Date(this.now()),
    }));
  }
  private readerService(): ViewerService {
    return (this.viewerService ??= new ViewerService(new DriveReader({ tokens: this.d.tokens, fetchFn: this.d.fetchFn, sleep: this.d.sleep })));
  }

  // ---------- connection ----------

  /** The user taps "Connect Google Drive": sign in (popup), remember the choice. */
  async connect(): Promise<void> {
    await this.d.tokens.getToken({ interactive: true });
    await this.d.updateSettings({ driveEnabled: true });
    this.settingsChanged();
  }

  async disconnect(): Promise<void> {
    try { await this.d.tokens.revoke?.(); } catch { /* the local forget below is what matters */ }
    this.d.tokens.invalidate();
    this.backupService = null;
    await this.d.updateSettings({ driveEnabled: false });
    this.scheduler.clearNotMaster();
    this.set({ viewer: { status: 'idle' }, enabled: false });
  }

  // ---------- master ----------

  private async runBackup(interactive: boolean): Promise<void> {
    const r = await this.writerService().runBackup({ interactive });
    await this.d.updateSettings({ lastBackupAt: this.now() });
    this.set({ backup: { ...this.state.backup, lastBackupAt: this.now(), warnings: r.warnings } });
  }

  backupNow(): Promise<void> { return this.scheduler.manual(); }

  /** What taking over would mean (read-only, allowed on any device). Used before showing the take-over dialog. */
  async inspectMaster(interactive = true): Promise<MasterInspection> {
    const st = this.d.getSettings();
    return this.readerService().inspectMaster({ deviceId: st.deviceId, deviceName: st.deviceName }, { interactive });
  }

  /**
   * Claim the master role. The caller has already shown the take-over warning and got explicit confirmation
   * whenever `inspectMaster` said a take-over was needed.
   */
  async claimMaster(): Promise<MasterFile> {
    const f = await this.writerService().claim({ interactive: true });
    this.scheduler.clearNotMaster();
    return f;
  }

  async listSnapshots(): Promise<SnapshotFileInfo[]> { return this.writerService().listSnapshots({ interactive: true }); }
  async downloadSnapshot(id: string): Promise<Snapshot> { return this.writerService().download(id, { interactive: true }); }
  async saveSafetyCopy(): Promise<SnapshotFileInfo> { return this.writerService().saveSafetyCopy({ interactive: true }); }

  // ---------- viewer ----------

  /** Show the cached snapshot at once, then refresh in the background (silently if possible). */
  async startViewer(): Promise<void> {
    if (!this.d.configured) return;
    this.set({ viewer: { status: 'loading' } });
    const cached = await this.d.readViewerCache();
    if (cached) {
      try {
        this.adopt(parseSnapshot(cached.text), { id: cached.driveFileId, name: cached.fileName, createdTime: cached.createdTime }, cached.loadedAt, 'ready');
      } catch { /* a damaged cache is ignored; the download below replaces it */ }
    }
    if (this.d.getSettings().driveEnabled) await this.refreshViewer(false);
    else if (!this.loaded) this.set({ viewer: { status: 'needs-signin' } });
  }

  /** Load the newest snapshot. `interactive` is true when the user tapped Refresh or Connect. */
  async refreshViewer(interactive: boolean): Promise<void> {
    if (!this.d.configured) return;
    const keep = this.state.viewer.info ? this.state.viewer : null;
    this.set({ viewer: { ...(keep ?? {}), status: 'loading' } });
    try {
      if (this.d.isOnline && !this.d.isOnline()) throw new DriveUnreachableError();
      const svc = this.readerService();
      const loaded = await svc.loadLatest({ interactive });
      const master = await svc.currentMaster({ interactive }).catch(() => null);
      const at = this.now();
      this.adopt(loaded.snapshot, loaded.info, at, 'ready', master);
      await this.d.writeViewerCache({ key: 'latest', text: loaded.text, driveFileId: loaded.info.id, fileName: loaded.info.name, createdTime: loaded.info.createdTime, loadedAt: at });
    } catch (e) {
      const shown = this.loaded ? { info: this.state.viewer.info, master: this.state.viewer.master } : {};
      if (e instanceof NeedsSignInError) this.set({ viewer: { ...shown, status: this.loaded ? 'ready' : 'needs-signin' } });
      else if (e instanceof NoBackupsError) this.set({ viewer: { status: 'empty' } });
      else if (e instanceof DriveUnreachableError) this.set({ viewer: { ...shown, status: this.loaded ? 'ready' : 'offline' } });
      else this.set({ viewer: { ...shown, status: this.loaded ? 'ready' : 'error', error: e instanceof SnapshotError || e instanceof Error ? e.message : String(e) } });
    }
  }

  private adopt(snapshot: Snapshot, f: { id: string; name: string; createdTime: string }, loadedAt: number, status: ViewerStatus, master?: MasterFile | null): void {
    this.loaded = snapshot;
    this.set({
      viewer: { status, info: { id: f.id, name: f.name, createdTime: f.createdTime, deviceId: snapshot.deviceId, deviceName: snapshot.deviceName, schemaVersion: snapshot.schemaVersion, loadedAt }, master: master ?? this.state.viewer.master },
      viewerRevision: this.state.viewerRevision + 1,
    });
  }
}
