import Dexie, { type Table } from 'dexie';
import type {
  Aircraft,
  Airport,
  Attachment,
  Flight,
  FstdSession,
  Person,
  PhotoCacheEntry,
  PreviousExperience,
  Settings,
} from '../domain/types';
import { uuid } from '../domain/id';

/**
 * Current schema version.
 *
 * MIGRATION RULES (data safety):
 *  - Never edit a released `version(n)` block. Add `version(n+1)` with a new
 *    `.stores()` (only the tables that change) and an `.upgrade()` that
 *    transforms existing rows without dropping data.
 *  - Bump this constant and `SNAPSHOT_SCHEMA_VERSION` (backups, phase 5) together
 *    and add a fixture test that opens a database written by the previous version.
 */
export const DB_VERSION = 2;

export class LogbookDB extends Dexie {
  flights!: Table<Flight, string>;
  aircraft!: Table<Aircraft, string>;
  persons!: Table<Person, string>;
  fstdSessions!: Table<FstdSession, string>;
  previousExperience!: Table<PreviousExperience, string>;
  attachments!: Table<Attachment, string>;
  airports!: Table<Airport, string>;
  settings!: Table<Settings, string>;
  photoCache!: Table<PhotoCacheEntry, string>;

  constructor(name = 'flightbook') {
    super(name);

    this.version(1).stores({
      flights: 'id, date, depTimeUtc, aircraftId, picNameId',
      aircraft: 'id, &registration',
      persons: 'id, &nameKey',
      fstdSessions: 'id, date',
      previousExperience: 'id, periodTo',
      attachments: 'id, flightId',
      airports: 'icao',
      settings: 'key',
    });

    // v2: an online-photo lookup cache (device-local metadata only, never backed up,
    // safe to delete). Existing rows are untouched; the only other change is a new
    // default on the settings row.
    this.version(2)
      .stores({
        photoCache: 'registration',
      })
      .upgrade(async (tx) => {
        await tx.table('settings').toCollection().modify((s: Partial<Settings>) => {
          if (s.fetchAircraftPhotos === undefined) s.fetchAircraftPhotos = true;
        });
      });

    // Fresh database only: create the owner ("SELF") and default settings.
    this.on('populate', (tx) => {
      const now = Date.now();
      tx.table('persons').add({
        id: uuid(),
        name: 'SELF',
        nameKey: 'self',
        isSelf: true,
        createdAt: now,
        updatedAt: now,
      } satisfies Person);
      tx.table('settings').add(defaultSettings());
    });
  }
}

export function defaultSettings(): Settings {
  return {
    key: 'main',
    deviceId: uuid(),
    deviceName: 'This device',
    isMaster: false,
    setupDone: false,
    theme: 'system',
    fetchAircraftPhotos: true,
    lastBackupAt: null,
  };
}
