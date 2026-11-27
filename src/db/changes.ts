import type { LogbookDB } from './db';
import type { Settings } from '../domain/types';
import { uuid } from '../domain/id';

/**
 * "The logbook has changes that are not in a Drive backup yet", kept in the database so it survives the app
 * being closed. Every write to logbook data sets a new token INSIDE the same transaction, so the change and
 * the marker are saved together or not at all. A backup reads the token before it reads the logbook, and
 * clears the marker only if the token is still the same: a change made while a backup runs stays pending.
 */

/** Settings that belong to the logbook (they go into backups). The rest are device-local. */
export const LOGBOOK_SETTINGS = [
  'pilotName', 'licenceNumber', 'address', 'sepLandExpiry', 'classExpiry', 'irExpiry',
  'medicalClass', 'medicalExpiry', 'languageLevel', 'languageExpiry', 'typeRatings',
] as const satisfies readonly (keyof Settings)[];

/** Call inside a read-write transaction that includes `db.settings`. */
export async function markChanged(db: LogbookDB): Promise<void> {
  await db.settings.update('main', { pendingChange: uuid() });
}

export async function readPendingChange(db: LogbookDB): Promise<string | null> {
  return (await db.settings.get('main'))?.pendingChange ?? null;
}

/** A backup that started when the marker was `token` has succeeded. */
export function clearPendingChange(db: LogbookDB, token: string): Promise<void> {
  return db.transaction('rw', db.settings, async () => {
    if ((await readPendingChange(db)) === token) await db.settings.update('main', { pendingChange: null });
  });
}
