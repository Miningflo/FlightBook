import {
  type ExperienceImport, type FlightImport, type FstdImport, type ImportBundle,
  contentKey, experienceNaturalKey, flightNaturalKey, fstdNaturalKey,
} from './records';

/**
 * Decides, before anything is written, what an import would do to each record:
 *  - added:      not in the logbook yet
 *  - identical:  already there with the same content (nothing to do)
 *  - conflict:   the same id exists with different content (the user chooses keep / replace)
 *  - duplicate:  the same real-world record under a different id, or repeated inside the file (skipped;
 *                see planKind for the records that may legitimately look alike)
 * Nothing is ever overwritten or dropped without being counted and shown.
 */

export type ConflictPolicy = 'skip' | 'replace';

export interface Conflict<T> {
  incoming: T;
  existing: T;
}

export interface KindPlan<T> {
  added: T[];
  identical: T[];
  conflicts: Conflict<T>[];
  duplicates: T[];
}

export interface ImportPlan {
  flights: KindPlan<FlightImport>;
  fstd: KindPlan<FstdImport>;
  experience: KindPlan<ExperienceImport>;
}

/**
 * `repeatable`: two records can share a natural key and both be real, as two simulator sessions of the same
 * type and length on one day are. For those, records in the file are only told apart by id, and each record
 * already in the logbook can account for at most one incoming record with another id. Flights are not
 * repeatable: the same aircraft cannot leave the same place twice at the same minute.
 */
export function planKind<T extends { id: string }>(incoming: T[], existing: T[], natural: (t: T) => string, { repeatable = false } = {}): KindPlan<T> {
  const byId = new Map(existing.map((e) => [e.id, e]));
  // existing records that an incoming one with a different id could be a copy of (not already matched by id)
  const incomingIds = new Set(incoming.map((t) => t.id));
  const unclaimed = new Map<string, number>();
  for (const e of existing) if (!repeatable || !incomingIds.has(e.id)) unclaimed.set(natural(e), (unclaimed.get(natural(e)) ?? 0) + 1);
  const seenIds = new Set<string>();
  const seenNatural = new Set<string>();
  const plan: KindPlan<T> = { added: [], identical: [], conflicts: [], duplicates: [] };
  for (const t of incoming) {
    const key = natural(t);
    if (seenIds.has(t.id) || (!repeatable && seenNatural.has(key))) { plan.duplicates.push(t); continue; }
    seenIds.add(t.id);
    seenNatural.add(key);
    const ex = byId.get(t.id);
    const copies = unclaimed.get(key) ?? 0;
    if (ex) {
      if (contentKey(ex) === contentKey(t)) plan.identical.push(t);
      else plan.conflicts.push({ incoming: t, existing: ex });
    } else if (copies > 0) {
      plan.duplicates.push(t);
      if (repeatable) unclaimed.set(key, copies - 1);
    } else plan.added.push(t);
  }
  return plan;
}

export function planImport(incoming: ImportBundle, existing: ImportBundle): ImportPlan {
  return {
    flights: planKind(incoming.flights, existing.flights, flightNaturalKey),
    fstd: planKind(incoming.fstd, existing.fstd, fstdNaturalKey, { repeatable: true }),
    experience: planKind(incoming.experience, existing.experience, experienceNaturalKey, { repeatable: true }),
  };
}

export interface PlanCounts {
  added: number;
  identical: number;
  conflicts: number;
  duplicates: number;
}

export function countKind(p: KindPlan<unknown>): PlanCounts {
  return { added: p.added.length, identical: p.identical.length, conflicts: p.conflicts.length, duplicates: p.duplicates.length };
}

/** Number of records an import would write under a policy. Zero means the import would change nothing. */
export function writeCount(plan: ImportPlan, policy: ConflictPolicy): number {
  return [plan.flights, plan.fstd, plan.experience].reduce((n, p) => n + p.added.length + (policy === 'replace' ? p.conflicts.length : 0), 0);
}
