import type { MasterFile } from '../domain/driveRules';

/** Gives the Drive client an access token. Real implementation: Google Identity Services (gis.ts). */
export interface TokenProvider {
  /**
   * A valid access token. With `interactive: false` it must not show UI; if it cannot get a token silently
   * it throws NeedsSignInError. With `interactive: true` (a user gesture) it may open Google's sign-in popup.
   */
  getToken(opts?: { interactive?: boolean }): Promise<string>;
  /** Forget the current token (it was rejected or the user disconnected). */
  invalidate(): void;
  /** Revoke the grant at Google. */
  revoke?(): Promise<void>;
}

/** No token without showing the sign-in popup: the UI should offer a "Connect / sign in" button. */
export class NeedsSignInError extends Error {
  constructor(message = 'Sign in to Google to continue.') { super(message); this.name = 'NeedsSignInError'; }
}

export class DriveError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'DriveError'; }
}

/** The device is offline or Drive could not be reached. */
export class DriveUnreachableError extends Error {
  constructor(message = 'Google Drive could not be reached.') { super(message); this.name = 'DriveUnreachableError'; }
}

/** Another device is the master: this device must not write backups. */
export class MasterMismatchError extends Error {
  constructor(readonly current: MasterFile | null) { super('Another device is the master logbook.'); this.name = 'MasterMismatchError'; }
}

export class NoBackupsError extends Error {
  constructor() { super('No backups were found in Google Drive yet. Make a backup on the master device first.'); this.name = 'NoBackupsError'; }
}

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime?: string;
  size?: number;
  appProperties?: Record<string, string>;
}
