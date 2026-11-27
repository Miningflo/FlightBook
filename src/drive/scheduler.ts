import { BACKUP_INTERVAL_MS } from '../domain/driveRules';
import { DriveUnreachableError, MasterMismatchError, NeedsSignInError } from './types';

export type BackupStatus = 'idle' | 'scheduled' | 'running' | 'pending-signin' | 'offline' | 'not-master' | 'error';

export interface SchedulerState {
  status: BackupStatus;
  error?: string;
  /** Set when status is 'not-master'. */
  otherMaster?: MasterMismatchError['current'];
}

export interface SchedulerOptions {
  /** Do one backup. Throws NeedsSignInError / MasterMismatchError / DriveUnreachableError / other. */
  run: (interactive: boolean) => Promise<void>;
  getLastBackupAt: () => number | null;
  /** The logbook has changes no backup includes yet. Stored with the logbook, so it survives a restart. */
  hasUnbackedChanges?: () => boolean;
  /** True only on the master device with Drive connected. Everything else is a no-op. */
  isActive: () => boolean;
  isOnline?: () => boolean;
  now?: () => number;
  /** Wait this long after the last change before backing up. */
  debounceMs?: number;
  intervalMs?: number;
}

/**
 * When to back up (master only): on app open if the last backup is over 24 hours old, shortly after a change
 * (debounced, so a burst of edits makes one backup), when the connection returns, and on demand.
 * It never throws: every failure becomes a visible state.
 */
export class BackupScheduler {
  private state: SchedulerState = { status: 'idle' };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private rerun = false;
  private dirty = false;

  constructor(private readonly o: SchedulerOptions) {}

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getState = (): SchedulerState => this.state;
  private set(s: SchedulerState): void { this.state = s; this.listeners.forEach((l) => l()); }
  private now(): number { return (this.o.now ?? Date.now)(); }
  private online(): boolean { return this.o.isOnline ? this.o.isOnline() : true; }

  /** On app start: back up changes left over from last time, or if the last backup is over a day old. */
  appOpened(): void {
    if (!this.o.isActive()) return;
    const last = this.o.getLastBackupAt();
    if (this.unbacked() || last === null || this.now() - last >= (this.o.intervalMs ?? BACKUP_INTERVAL_MS)) void this.attempt(false);
  }

  private unbacked(): boolean { return this.o.hasUnbackedChanges?.() ?? false; }

  /** A logbook record was saved or deleted. */
  dataChanged(): void {
    if (!this.o.isActive()) return;
    this.dirty = true;
    if (this.running) { this.rerun = true; return; }
    if (this.timer) clearTimeout(this.timer);
    // an existing notice (sign-in needed, offline, another master) stays visible; the retry will refresh it
    if (this.state.status === 'idle' || this.state.status === 'error') this.set({ status: 'scheduled' });
    this.timer = setTimeout(() => { this.timer = null; void this.attempt(false); }, this.o.debounceMs ?? 20_000);
  }

  /** The device is back online: retry what could not be done. */
  backOnline(): void {
    if (!this.o.isActive()) return;
    if (this.state.status === 'offline' || this.dirty || this.unbacked()) void this.attempt(false);
  }

  /** "Backup now": runs immediately and may show Google's sign-in popup (it is a tap). */
  manual(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return this.attempt(true);
  }

  /** Forget a "not master" state, e.g. after the user took the role back. */
  clearNotMaster(): void {
    if (this.state.status === 'not-master') this.set({ status: 'idle' });
  }

  private async attempt(interactive: boolean): Promise<void> {
    if (!this.o.isActive()) return;
    if (this.running) { this.rerun = true; return; }
    if (!this.online()) { this.set({ status: 'offline' }); return; }
    this.running = true;
    this.set({ status: 'running' });
    try {
      await this.o.run(interactive);
      this.dirty = false;
      this.set({ status: 'idle' });
    } catch (e) {
      if (e instanceof NeedsSignInError) this.set({ status: 'pending-signin' });
      else if (e instanceof MasterMismatchError) this.set({ status: 'not-master', otherMaster: e.current });
      else if (e instanceof DriveUnreachableError) this.set({ status: 'offline' });
      else this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.running = false;
    }
    if (this.rerun) {
      this.rerun = false;
      // changes that arrived during the run get their own backup, but never while we are blocked
      if (this.state.status === 'idle') this.dataChanged();
    }
  }
}
