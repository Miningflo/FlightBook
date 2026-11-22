import { type ImportBundle, contentKey } from './records';

/**
 * Preview of a "replace everything" restore: what would be added, changed, left alone, and REMOVED
 * (records that exist on this device but are not in the snapshot). Records are matched by id, because
 * a replace restores the snapshot exactly as it was.
 */
export interface KindDiff {
  added: number;
  changed: number;
  unchanged: number;
  removed: number;
}

export interface ReplacePlan {
  flights: KindDiff;
  fstd: KindDiff;
  experience: KindDiff;
  /** True if applying the restore would delete or change anything on this device. */
  destructive: boolean;
}

function diff<T extends { id: string }>(incoming: T[], existing: T[]): KindDiff {
  const ex = new Map(existing.map((e) => [e.id, e]));
  const inc = new Set(incoming.map((i) => i.id));
  let added = 0, changed = 0, unchanged = 0;
  for (const i of incoming) {
    const e = ex.get(i.id);
    if (!e) added++;
    else if (contentKey(e) === contentKey(i)) unchanged++;
    else changed++;
  }
  return { added, changed, unchanged, removed: existing.filter((e) => !inc.has(e.id)).length };
}

export function planReplace(incoming: ImportBundle, existing: ImportBundle): ReplacePlan {
  const flights = diff(incoming.flights, existing.flights);
  const fstd = diff(incoming.fstd, existing.fstd);
  const experience = diff(incoming.experience, existing.experience);
  const destructive = [flights, fstd, experience].some((d) => d.changed > 0 || d.removed > 0);
  return { flights, fstd, experience, destructive };
}
