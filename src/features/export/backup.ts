import type { LogbookDB } from '../../db/db';
import { type Snapshot, bytesToBase64, buildSnapshot } from '../../domain/snapshot';

/** Read the whole logbook from the database into a snapshot (attachments encoded as base64). */
export async function snapshotFromDb(db: LogbookDB, exportedAt = new Date().toISOString()): Promise<Snapshot> {
  const [aircraft, persons, flights, fstdSessions, previousExperience, attachments, settings] = await Promise.all([
    db.aircraft.toArray(), db.persons.toArray(), db.flights.toArray(), db.fstdSessions.toArray(),
    db.previousExperience.toArray(), db.attachments.toArray(), db.settings.get('main'),
  ]);
  return buildSnapshot({
    exportedAt,
    deviceId: settings?.deviceId,
    deviceName: settings?.deviceName ?? '',
    settings: { pilotName: settings?.pilotName, licenceNumber: settings?.licenceNumber, address: settings?.address, sepLandExpiry: settings?.sepLandExpiry ?? null, classExpiry: settings?.classExpiry, irExpiry: settings?.irExpiry ?? null },
    aircraft, persons, flights, fstdSessions, previousExperience,
    attachments: await Promise.all(attachments.map(async ({ blob, ...a }) => ({ ...a, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) }))),
  });
}
