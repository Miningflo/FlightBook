import type { LogbookDB } from './db';
import { defaultSettings } from './db';
import type { Aircraft, Flight, FstdSession, Person, PreviousExperience, Settings } from '../domain/types';
import type { FstdInput } from '../domain/fstd';
import type { ExperienceDraft } from '../domain/experience';
import type { FlightInput } from '../domain/flightForm';
import { uuid } from '../domain/id';
import { newestFirst, normalizeRegistration, personKey } from '../domain/suggestions';
import { LOGBOOK_SETTINGS, markChanged } from './changes';

/** Read side. Implemented by the Dexie master repo now and by the snapshot viewer repo in phase 5. */
export interface LogbookRepository {
  listFlights(): Promise<Flight[]>;
  getFlight(id: string): Promise<Flight | undefined>;
  listAircraft(): Promise<Aircraft[]>;
  listPersons(): Promise<Person[]>;
  getSettings(): Promise<Settings>;
  /** Simulator sessions, newest first. */
  listFstd(): Promise<FstdSession[]>;
  /** Previous-experience carry-in records, most recent period first. */
  listPreviousExperience(): Promise<PreviousExperience[]>;
}

/** Write side. Only the master device gets one of these. */
export interface WritableLogbookRepository extends LogbookRepository {
  /** Insert (no id) or update (id). Resolves/creates the aircraft and PIC records atomically. */
  saveFlight(input: FlightInput, existingId?: string): Promise<Flight>;
  deleteFlight(id: string): Promise<void>;
  updateSettings(patch: Partial<Omit<Settings, 'key'>>): Promise<Settings>;
  /** Insert (no id) or update (id). Updating an id that does not exist is an error, never a silent insert. */
  saveFstd(input: FstdInput, existingId?: string): Promise<FstdSession>;
  deleteFstd(id: string): Promise<void>;
  savePreviousExperience(input: ExperienceDraft, existingId?: string): Promise<PreviousExperience>;
  deletePreviousExperience(id: string): Promise<void>;
}

export class DexieRepository implements WritableLogbookRepository {
  /**
   * `onWrite` is called after every successful change to logbook data (flights, simulator sessions,
   * previous experience, pilot name, SEP expiry), e.g. to schedule a Drive backup. Device settings do not count.
   */
  constructor(private readonly db: LogbookDB, private readonly onWrite?: () => void) {}

  async listFlights(): Promise<Flight[]> {
    return newestFirst(await this.db.flights.toArray());
  }

  getFlight(id: string): Promise<Flight | undefined> {
    return this.db.flights.get(id);
  }

  listAircraft(): Promise<Aircraft[]> {
    return this.db.aircraft.toArray();
  }

  listPersons(): Promise<Person[]> {
    return this.db.persons.toArray();
  }

  async listFstd(): Promise<FstdSession[]> {
    return (await this.db.fstdSessions.toArray()).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }

  async listPreviousExperience(): Promise<PreviousExperience[]> {
    return (await this.db.previousExperience.toArray()).sort((a, b) => b.periodTo.localeCompare(a.periodTo) || b.createdAt - a.createdAt);
  }

  saveFstd(input: FstdInput, existingId?: string): Promise<FstdSession> {
    return this.notify(this.saveRecord(this.db.fstdSessions, input, existingId, 'Simulator session'));
  }

  deleteFstd(id: string): Promise<void> {
    return this.notify(this.deleteRecord(this.db.fstdSessions, id));
  }

  savePreviousExperience(input: ExperienceDraft, existingId?: string): Promise<PreviousExperience> {
    return this.notify(this.saveRecord(this.db.previousExperience, input, existingId, 'Previous experience record'));
  }

  deletePreviousExperience(id: string): Promise<void> {
    return this.notify(this.deleteRecord(this.db.previousExperience, id));
  }

  /** Run `onWrite` once a change has been committed (never when it failed). */
  private async notify<T>(work: Promise<T>): Promise<T> {
    const result = await work;
    this.onWrite?.();
    return result;
  }

  /** Shared insert/update for simple records: keeps id and createdAt on update, never creates a duplicate. */
  private saveRecord<T extends { id: string; createdAt: number; updatedAt: number }>(
    table: import('dexie').Table<T, string>, input: Omit<T, 'id' | 'createdAt' | 'updatedAt'>, existingId: string | undefined, what: string,
  ): Promise<T> {
    return this.db.transaction('rw', table, this.db.settings, async () => {
      const now = Date.now();
      const existing = existingId ? await table.get(existingId) : undefined;
      if (existingId && !existing) throw new Error(`${what} ${existingId} not found; refusing to create a duplicate`);
      const record = { ...input, id: existing?.id ?? uuid(), createdAt: existing?.createdAt ?? now, updatedAt: now } as T;
      await table.put(record);
      await markChanged(this.db);
      return record;
    });
  }

  private deleteRecord<T>(table: import('dexie').Table<T, string>, id: string): Promise<void> {
    return this.db.transaction('rw', table, this.db.settings, async () => {
      await table.delete(id);
      await markChanged(this.db);
    });
  }

  async getSettings(): Promise<Settings> {
    const existing = await this.db.settings.get('main');
    if (existing) return existing;
    const created = defaultSettings();
    await this.db.settings.put(created);
    return created;
  }

  async updateSettings(patch: Partial<Omit<Settings, 'key'>>): Promise<Settings> {
    const logbookData = LOGBOOK_SETTINGS.some((k) => k in patch);
    // read and write in one transaction: two changes at the same moment must not overwrite each other
    const next = await this.db.transaction('rw', this.db.settings, async () => {
      const merged = { ...(await this.getSettings()), ...patch };
      await this.db.settings.put(merged);
      if (logbookData) await markChanged(this.db);
      return merged;
    });
    if (logbookData) this.onWrite?.();
    return next;
  }

  saveFlight(input: FlightInput, existingId?: string): Promise<Flight> {
    return this.notify(this.saveFlightImpl(input, existingId));
  }

  private async saveFlightImpl(input: FlightInput, existingId?: string): Promise<Flight> {
    const { db } = this;
    return db.transaction('rw', db.flights, db.aircraft, db.persons, db.settings, async () => {
      const now = Date.now();
      const existing = existingId ? await db.flights.get(existingId) : undefined;
      if (existingId && !existing) throw new Error(`Flight ${existingId} not found; refusing to create a duplicate`);

      // Aircraft: reuse by registration. Every flight keeps its own copy of make/model/variant/class, so the
      // aircraft record is only what the form fills in next time. It follows the details of the aircraft's most
      // recent flight: correcting an older entry never changes what is filled in today.
      const reg = normalizeRegistration(input.registration);
      let aircraft = await db.aircraft.where('registration').equals(reg).first();
      if (aircraft) {
        const details = { make: input.aircraftMake, model: input.aircraftModel, variant: input.aircraftVariant, engineClass: input.engineClass, classRating: input.aircraftClass, typeRatingId: input.typeRatingId ?? null };
        const changed = (Object.keys(details) as (keyof typeof details)[]).some((k) => aircraft![k] !== details[k]);
        if (changed) {
          const later = await db.flights.where('aircraftId').equals(aircraft.id).filter((f) => f.id !== existingId && f.depTimeUtc > input.depTimeUtc).count();
          if (later === 0) {
            aircraft = { ...aircraft, ...details, updatedAt: now };
            await db.aircraft.put(aircraft);
          }
        }
      } else {
        aircraft = {
          id: uuid(),
          registration: reg,
          make: input.aircraftMake,
          model: input.aircraftModel,
          variant: input.aircraftVariant,
          engineClass: input.engineClass,
          classRating: input.aircraftClass,
          typeRatingId: input.typeRatingId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        await db.aircraft.add(aircraft);
      }

      // PIC: reuse by case-insensitive name, else create.
      const key = personKey(input.picName);
      let person = await db.persons.where('nameKey').equals(key).first();
      if (!person) {
        person = {
          id: uuid(),
          name: input.picName.trim().replace(/\s+/g, ' '),
          nameKey: key,
          isSelf: false,
          createdAt: now,
          updatedAt: now,
        };
        await db.persons.add(person);
      }

      const { picName: _picName, engineClass: _engineClass, ...rest } = input;
      const flight: Flight = {
        ...rest,
        id: existing?.id ?? uuid(),
        aircraftId: aircraft.id,
        picNameId: person.id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await db.flights.put(flight);
      await markChanged(db);
      return flight;
    });
  }

  deleteFlight(id: string): Promise<void> {
    return this.notify(this.deleteFlightImpl(id));
  }

  private async deleteFlightImpl(id: string): Promise<void> {
    const { db } = this;
    await db.transaction('rw', db.flights, db.attachments, db.settings, async () => {
      await db.attachments.where('flightId').equals(id).delete();
      await db.flights.delete(id);
      await markChanged(db);
    });
  }
}
