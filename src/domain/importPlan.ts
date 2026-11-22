import {
  type ExperienceImport, type FlightImport, type FstdImport, type ImportBundle,
  contentKey, experienceNaturalKey, flightNaturalKey, fstdNaturalKey,
} from './records';

/**
 * Decides, before anything is written, what an import would do to each record:
 *  - added:      not in the logbook yet
 *  - identical:  already there with the same content (nothing to do)
 *  - conflict:   the same id exists with different content (the user chooses keep / replace)
 *  - duplicate:  the same real-world record under a different id, or repeated inside the file (skipped)
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

export function planKind<T extends { id: string }>(incoming: T[], existing: T[], natural: (t: T) => string): KindPlan<T> {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const byNatural = new Map<string, T>();
  for (const e of existing) if (!byNatural.has(natural(e))) byNatural.set(natural(e), e);
  const seenIds = new Set<string>();
  const seenNatural = new Set<string>();
  const plan: KindPlan<T> = { added: [], identical: [], conflicts: [], duplicates: [] };
  for (const t of incoming) {
    const key = natural(t);
    if (seenIds.has(t.id) || seenNatural.has(key)) { plan.duplicates.push(t); continue; }
    seenIds.add(t.id);
    seenNatural.add(key);
    const ex = byId.get(t.id);
    if (ex) {
      if (contentKey(ex) === contentKey(t)) plan.identical.push(t);
      else plan.conflicts.push({ incoming: t, existing: ex });
    } else if (byNatural.has(key)) plan.duplicates.push(t);
    else plan.added.push(t);
  }
  return plan;
}

export function planImport(incoming: ImportBundle, existing: ImportBundle): ImportPlan {
  return {
    flights: planKind(incoming.flights, existing.flights, flightNaturalKey),
    fstd: planKind(incoming.fstd, existing.fstd, fstdNaturalKey),
    experience: planKind(incoming.experience, existing.experience, experienceNaturalKey),
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
