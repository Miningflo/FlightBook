import { LogbookDB, defaultSettings } from './db/db';
import { DexieRepository } from './db/repository';
import { clearPendingChange, readPendingChange } from './db/changes';
import { DriveController } from './drive/controller';
import { DRIVE_SCOPE, GOOGLE_CLIENT_ID, driveConfigured } from './drive/config';
import { GisTokenProvider } from './drive/gis';
import { DriveError, type TokenProvider } from './drive/types';
import { snapshotFromDb } from './features/export/backup';
import type { Settings } from './domain/types';

/**
 * The one database, repository and Drive controller of the running app. The controller needs the CURRENT
 * settings synchronously, so the app keeps `bridge.settings` up to date after every load.
 */
export const db = new LogbookDB();

export const bridge: { settings: Settings | null; reload: () => Promise<void> } = { settings: null, reload: async () => {} };

/**
 * Used only in the moment between the app starting and the settings being read from the database: not master,
 * Drive off, so nothing can be written or backed up until the real settings are known.
 */
const BEFORE_LOAD: Settings = defaultSettings();

export const repo = new DexieRepository(db, () => drive.scheduler.dataChanged());

const tokens: TokenProvider = driveConfigured()
  ? new GisTokenProvider(GOOGLE_CLIENT_ID, DRIVE_SCOPE)
  : { getToken: async () => { throw new DriveError('Google Drive is not configured in this build.'); }, invalidate: () => {} };

export const drive: DriveController = new DriveController({
  configured: driveConfigured(),
  tokens,
  getSettings: () => bridge.settings ?? BEFORE_LOAD,
  updateSettings: async (patch) => { await repo.updateSettings(patch); await bridge.reload(); },
  buildSnapshot: () => snapshotFromDb(db),
  readPendingChange: () => readPendingChange(db),
  clearPendingChange: (token) => clearPendingChange(db, token),
  readViewerCache: () => db.viewerCache.get('latest'),
  writeViewerCache: async (e) => { await db.viewerCache.put(e); },
  isOnline: () => navigator.onLine,
});
