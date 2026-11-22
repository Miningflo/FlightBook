import type { LogbookDB } from './db';
import type { ConflictPolicy, ImportPlan } from '../domain/importPlan';
import type { FlightImport, ImportBundle } from '../domain/records';
import { aircraftFromFlight, toFlightImports } from '../domain/records';
import type { Aircraft, Attachment, Flight, Person, Settings } from '../domain/types';
import { personKey } from '../domain/suggestions';
import { uuid } from '../domain/id';

/** Everything in the logbook, as portable records. The "existing" side of an import plan. */
export async function readBundle(db: LogbookDB): Promise<ImportBundle> {
  const [flights, persons, fstd, experience] = await Promise.all([db.flights.toArray(), db.persons.toArray(), db.fstdSessions.toArray(), db.previousExperience.toArray()]);
  return { flights: toFlightImports(flights, persons), fstd, experience };
}

export interface ImportExtras {
  attachments?: Attachment[];
  settings?: { pilotName?: string; sepLandExpiry?: string | null };
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

    const resolve = async (f: FlightImport): Promise<Flight> => {
      let ac = aircraft.get(f.registration);
      if (!ac) { ac = aircraftFromFlight(f, uuid(), now); aircraft.set(ac.registration, ac); await db.aircraft.add(ac); }
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
        if (extras.settings.sepLandExpiry && !cur.sepLandExpiry) { patch.sepLandExpiry = extras.settings.sepLandExpiry; result.settingsApplied.push('sepLandExpiry'); }
        if (Object.keys(patch).length > 0) await db.settings.put({ ...cur, ...patch });
      }
    }
    return result;
  });
}
