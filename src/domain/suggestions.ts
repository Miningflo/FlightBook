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

/** Registrations ordered by most recent use, then any never-flown aircraft alphabetically. */
export function recentAircraft(flights: Flight[], aircraft: Aircraft[]): Aircraft[] {
  const byId = new Map(aircraft.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const out: Aircraft[] = [];
  for (const f of newestFirst(flights)) {
    const a = byId.get(f.aircraftId);
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  const rest = aircraft.filter((a) => !seen.has(a.id)).sort((a, b) => a.registration.localeCompare(b.registration));
  return [...out, ...rest];
}

/** People ordered by most recent use as PIC, then the rest alphabetically. */
export function recentPersons(flights: Flight[], persons: Person[]): Person[] {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const f of newestFirst(flights)) {
    const p = byId.get(f.picNameId);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  const rest = persons.filter((p) => !seen.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  return [...out, ...rest];
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

/**
 * Airports used recently, most recent first, each once (for quick-pick buttons). An arrival comes before the
 * departure of the same flight, because the next flight usually starts where the last one ended.
 */
export function recentPlaces(flights: Flight[], limit = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of newestFirst(flights)) {
    for (const raw of [f.arrPlace, f.depPlace]) {
      const p = raw.trim().toUpperCase();
      if (p && !seen.has(p)) { seen.add(p); out.push(p); if (out.length >= limit) return out; }
    }
  }
  return out;
}
