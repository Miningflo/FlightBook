import type { LogbookDB } from './db';
import type { ConflictPolicy, ImportPlan } from '../domain/importPlan';
import type { FlightImport, ImportBundle } from '../domain/records';
import { aircraftFromFlight, toFlightImports } from '../domain/records';
import type { Aircraft, Attachment, ClassRating, Flight, IsoDate, MedicalClass, Person, Settings, TypeRating } from '../domain/types';
import { personKey } from '../domain/suggestions';
import { uuid } from '../domain/id';
import { type Snapshot, base64ToBytes, snapshotToBundle } from '../domain/snapshot';

/** Everything in the logbook, as portable records. The "existing" side of an import plan. */
export async function readBundle(db: LogbookDB): Promise<ImportBundle> {
  const [flights, persons, fstd, experience] = await Promise.all([db.flights.toArray(), db.persons.toArray(), db.fstdSessions.toArray(), db.previousExperience.toArray()]);
  return { flights: toFlightImports(flights, persons), fstd, experience };
}

export interface ImportExtras {
  attachments?: Attachment[];
  settings?: { pilotName?: string; licenceNumber?: string; address?: string; sepLandExpiry?: string | null; classExpiry?: Partial<Record<ClassRating, IsoDate>>; irExpiry?: IsoDate | null; medicalClass?: MedicalClass | null; medicalExpiry?: IsoDate | null; languageLevel?: 4 | 5 | 6 | null; languageExpiry?: IsoDate | null; typeRatings?: TypeRating[] };
}

export interface ImportResult {
  written: { flights: number; fstd: number; experience: number };
  replaced: { flights: number; fstd: number; experience: number };
  attachments: number;
  settingsApplied: string[];
}

/**
 * Apply a plan in ONE transaction: either every record is written or none is.
 * - Aircraft are matched by registration and people by name; missing ones are created.
 * - Conflicts are written only under the 'replace' policy (createdAt kept, updatedAt set to now).
 * - Settings from a backup only fill in values that are still empty; they never overwrite.
 */
export async function applyImport(db: LogbookDB, plan: ImportPlan, policy: ConflictPolicy, extras: ImportExtras = {}): Promise<ImportResult> {
  return db.transaction('rw', [db.flights, db.aircraft, db.persons, db.fstdSessions, db.previousExperience, db.attachments, db.settings], async () => {
    const now = Date.now();
    const result: ImportResult = { written: { flights: 0, fstd: 0, experience: 0 }, replaced: { flights: 0, fstd: 0, experience: 0 }, attachments: 0, settingsApplied: [] };

    const aircraft = new Map<string, Aircraft>((await db.aircraft.toArray()).map((a) => [a.registration, a]));
    const persons = new Map<string, Person>((await db.persons.toArray()).map((p) => [p.nameKey, p]));
    const current = (await db.settings.get('main')) as Settings | undefined;

    // The type ratings this logbook will hold once the import is applied. The incoming ones are applied below
    // only when there are none yet, so a new aircraft can be given a rating only if it is in this list.
    const incomingRatings = extras.settings?.typeRatings ?? [];
    const takesIncoming = !!current && incomingRatings.length > 0 && !current.typeRatings?.length;
    const held = new Set((takesIncoming ? incomingRatings : current?.typeRatings ?? []).map((t) => t.id));

    // A new aircraft takes its details from its registration's most recent incoming flight, as a normal save
    // does, not from whichever flight happens to come first in the file.
    const newest = new Map<string, FlightImport>();
    for (const f of [...plan.flights.added, ...(policy === 'replace' ? plan.flights.conflicts.map((c) => c.incoming) : [])]) {
      const seen = newest.get(f.registration);
      if (!seen || f.depTimeUtc > seen.depTimeUtc) newest.set(f.registration, f);
    }

    const resolve = async (f: FlightImport): Promise<Flight> => {
      let ac = aircraft.get(f.registration);
      if (!ac) { ac = aircraftFromFlight(newest.get(f.registration) ?? f, uuid(), now, held); aircraft.set(ac.registration, ac); await db.aircraft.add(ac); }
      const key = personKey(f.picName);
      let pe = persons.get(key);
      if (!pe) { pe = { id: uuid(), name: f.picName.trim().replace(/\s+/g, ' '), nameKey: key, isSelf: false, createdAt: now, updatedAt: now }; persons.set(key, pe); await db.persons.add(pe); }
      const { picName: _p, engineClass: _e, ...rest } = f;
      return { ...rest, aircraftId: ac.id, picNameId: pe.id };
    };

    for (const f of plan.flights.added) { await db.flights.add(await resolve(f)); result.written.flights++; }
    if (policy === 'replace') {
      for (const c of plan.flights.conflicts) {
        await db.flights.put({ ...(await resolve(c.incoming)), id: c.existing.id, createdAt: c.existing.createdAt, updatedAt: now });
        result.replaced.flights++;
      }
      for (const c of plan.fstd.conflicts) { await db.fstdSessions.put({ ...c.incoming, id: c.existing.id, createdAt: c.existing.createdAt, updatedAt: now }); result.replaced.fstd++; }
      for (const c of plan.experience.conflicts) { await db.previousExperience.put({ ...c.incoming, id: c.existing.id, createdAt: c.existing.createdAt, updatedAt: now }); result.replaced.experience++; }
    }
    for (const s of plan.fstd.added) { await db.fstdSessions.add(s); result.written.fstd++; }
    for (const e of plan.experience.added) { await db.previousExperience.add(e); result.written.experience++; }

    for (const a of extras.attachments ?? []) {
      if (await db.attachments.get(a.id)) continue;
      if (!(await db.flights.get(a.flightId))) continue; // never store an attachment that points at nothing
      await db.attachments.add(a);
      result.attachments++;
    }

    if (extras.settings) {
      const cur = (await db.settings.get('main')) as Settings | undefined;
      if (cur) {
        const patch: Partial<Settings> = {};
        if (extras.settings.pilotName && !cur.pilotName) { patch.pilotName = extras.settings.pilotName; result.settingsApplied.push('pilotName'); }
        if (extras.settings.licenceNumber && !cur.licenceNumber) { patch.licenceNumber = extras.settings.licenceNumber; result.settingsApplied.push('licenceNumber'); }
        if (extras.settings.address && !cur.address) { patch.address = extras.settings.address; result.settingsApplied.push('address'); }
        if (extras.settings.sepLandExpiry && !cur.sepLandExpiry) { patch.sepLandExpiry = extras.settings.sepLandExpiry; result.settingsApplied.push('sepLandExpiry'); }
        if (extras.settings.irExpiry && !cur.irExpiry) { patch.irExpiry = extras.settings.irExpiry; result.settingsApplied.push('irExpiry'); }
        if (extras.settings.medicalExpiry && !cur.medicalExpiry) { patch.medicalExpiry = extras.settings.medicalExpiry; patch.medicalClass = extras.settings.medicalClass ?? null; result.settingsApplied.push('medicalExpiry'); }
        if (extras.settings.languageExpiry && !cur.languageExpiry) { patch.languageExpiry = extras.settings.languageExpiry; result.settingsApplied.push('languageExpiry'); }
        if (extras.settings.languageLevel && !cur.languageLevel) { patch.languageLevel = extras.settings.languageLevel; result.settingsApplied.push('languageLevel'); }
        if (extras.settings.typeRatings?.length && !cur.typeRatings?.length) { patch.typeRatings = extras.settings.typeRatings; result.settingsApplied.push('typeRatings'); }
        const missing = Object.entries(extras.settings.classExpiry ?? {}).filter(([k, v]) => v && !cur.classExpiry?.[k as ClassRating]);
        if (missing.length > 0) { patch.classExpiry = { ...cur.classExpiry, ...Object.fromEntries(missing) }; result.settingsApplied.push('classExpiry'); }
        if (Object.keys(patch).length > 0) await db.settings.put({ ...cur, ...patch });
      }
    }
    return result;
  });
}

export class ReplaceRefusedError extends Error {}

/**
 * "Replace everything": make this logbook exactly the snapshot. All logbook tables are cleared and refilled
 * with the snapshot's records (original ids, aircraft and people included) in ONE transaction, so a failure
 * leaves the logbook untouched. A snapshot with any invalid record is refused: a replace must be complete.
 * Device settings (role, device name, theme, Drive state) and reference data (airports, photo cache) are not touched.
 * Callers must make a safety copy of the current logbook first; see features/drive.
 */
export async function applyReplace(db: LogbookDB, snapshot: Snapshot): Promise<{ flights: number; fstd: number; experience: number }> {
  const { bundle, problems } = snapshotToBundle(snapshot);
  if (problems.length > 0) throw new ReplaceRefusedError(`The snapshot has ${problems.length} invalid record(s), e.g. ${problems[0]!.record}: ${problems[0]!.message}. Nothing was changed.`);
  const now = Date.now();
  return db.transaction('rw', [db.flights, db.aircraft, db.persons, db.fstdSessions, db.previousExperience, db.attachments, db.settings], async () => {
    await Promise.all([db.flights.clear(), db.aircraft.clear(), db.persons.clear(), db.fstdSessions.clear(), db.previousExperience.clear(), db.attachments.clear()]);
    await db.aircraft.bulkAdd(snapshot.aircraft);
    const persons = [...snapshot.persons];
    // the logbook always has its owner ("SELF")
    if (!persons.some((p) => p.isSelf)) persons.push({ id: uuid(), name: 'SELF', nameKey: 'self', isSelf: true, createdAt: now, updatedAt: now });
    await db.persons.bulkAdd(persons);
    await db.flights.bulkAdd(snapshot.flights);
    await db.fstdSessions.bulkAdd(snapshot.fstdSessions);
    await db.previousExperience.bulkAdd(snapshot.previousExperience);
    await db.attachments.bulkAdd(snapshot.attachments.map((a) => ({ id: a.id, flightId: a.flightId, mime: a.mime, name: a.name, createdAt: a.createdAt, updatedAt: a.updatedAt, blob: new Blob([base64ToBytes(a.data) as BlobPart], { type: a.mime }) })));
    const cur = await db.settings.get('main');
    if (cur) await db.settings.put({ ...cur, pilotName: snapshot.settings.pilotName ?? cur.pilotName, licenceNumber: snapshot.settings.licenceNumber ?? cur.licenceNumber, address: snapshot.settings.address ?? cur.address, sepLandExpiry: snapshot.settings.sepLandExpiry ?? null, classExpiry: snapshot.settings.classExpiry ?? {}, irExpiry: snapshot.settings.irExpiry ?? null, medicalClass: snapshot.settings.medicalClass ?? null, medicalExpiry: snapshot.settings.medicalExpiry ?? null, languageLevel: snapshot.settings.languageLevel ?? null, languageExpiry: snapshot.settings.languageExpiry ?? null, typeRatings: snapshot.settings.typeRatings ?? [] });
    return { flights: bundle.flights.length, fstd: bundle.fstd.length, experience: bundle.experience.length };
  });
}
