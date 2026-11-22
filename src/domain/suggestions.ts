import type { Aircraft, Flight, Person } from './types';

/** Registrations are stored upper-case and trimmed ("OO-ABC"). Inner spacing is collapsed. */
export function normalizeRegistration(reg: string): string {
  return reg.trim().replace(/\s+/g, '').toUpperCase();
}

export function personKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function findAircraftByRegistration(aircraft: Aircraft[], reg: string): Aircraft | undefined {
  const key = normalizeRegistration(reg);
  if (!key) return undefined;
  return aircraft.find((a) => a.registration === key);
}

/** Flights sorted newest first by off-blocks. Does not mutate the input. */
export function newestFirst(flights: Flight[]): Flight[] {
  return [...flights].sort((a, b) => b.depTimeUtc - a.depTimeUtc || b.createdAt - a.createdAt);
}

/** Defaults for a new flight, taken from the most recent entry. */
export function defaultsFromHistory(
  flights: Flight[],
  aircraft: Aircraft[],
  persons: Person[],
): { registration: string; picName: string; depPlace: string } {
  const last = newestFirst(flights)[0];
  const self = persons.find((p) => p.isSelf);
  if (!last) return { registration: '', picName: self?.name ?? 'SELF', depPlace: '' };
  const pic = persons.find((p) => p.id === last.picNameId);
  const ac = aircraft.find((a) => a.id === last.aircraftId);
  return {
    registration: ac?.registration ?? last.registration,
    picName: pic?.name ?? self?.name ?? 'SELF',
    // A new flight usually departs where the previous one landed.
    depPlace: last.arrPlace,
  };
}
