import { describe, expect, it } from 'vitest';
import { countKind, planImport, planKind, writeCount } from './importPlan';
import { contentKey, flightNaturalKey, toFlightImport } from './records';
import { flight } from './testFactories';
import type { Person } from './types';

const self: Person = { id: 'p', name: 'SELF', nameKey: 'self', isSelf: true, createdAt: 1, updatedAt: 1 };
const fi = (date: string, o = {}) => toFlightImport(flight(date, o), [self]);

describe('contentKey', () => {
  it('ignores identity and timestamps but sees every other change, regardless of key order', () => {
    const a = fi('2025-03-01');
    expect(contentKey(a)).toBe(contentKey({ ...a, id: 'other', createdAt: 5, updatedAt: 9 }));
    expect(contentKey(a)).not.toBe(contentKey({ ...a, remarks: 'changed' }));
    expect(contentKey(a)).not.toBe(contentKey({ ...a, overrides: { nightMin: true } }));
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(contentKey(reordered)).toBe(contentKey(a));
  });
});

describe('planKind', () => {
  const base = fi('2025-03-01');
  const nat = flightNaturalKey;

  it('classifies new, identical and conflicting records by id', () => {
    const existing = [base, { ...fi('2025-03-02'), id: 'x2' }];
    const incoming = [
      { ...base }, // identical
      { ...existing[1]!, remarks: 'edited elsewhere' }, // same id, different content
      { ...fi('2025-03-03'), id: 'new1' },
    ];
    const p = planKind(incoming, existing, nat);
    expect(countKind(p)).toEqual({ added: 1, identical: 1, conflicts: 1, duplicates: 0 });
    expect(p.conflicts[0]!.existing.remarks).toBe('');
    expect(p.conflicts[0]!.incoming.remarks).toBe('edited elsewhere');
  });
  it('an identical record that only differs in updatedAt is still identical (nothing to do)', () => {
    expect(countKind(planKind([{ ...base, updatedAt: base.updatedAt + 1000 }], [base], nat)).identical).toBe(1);
  });
  it('the same real flight under a different id is a duplicate, not a second flight', () => {
    const p = planKind([{ ...base, id: 'from-csv' }], [base], nat);
    expect(countKind(p)).toEqual({ added: 0, identical: 0, conflicts: 0, duplicates: 1 });
  });
  it('repeats inside the incoming file are duplicates (same id twice, or the same flight twice)', () => {
    const a = { ...fi('2025-03-05'), id: 'a' };
    expect(countKind(planKind([a, { ...a }], [], nat))).toMatchObject({ added: 1, duplicates: 1 });
    expect(countKind(planKind([a, { ...a, id: 'b' }], [], nat))).toMatchObject({ added: 1, duplicates: 1 });
  });
  it('an empty import plans nothing', () => {
    expect(countKind(planKind([], [base], nat))).toEqual({ added: 0, identical: 0, conflicts: 0, duplicates: 0 });
  });
  it('flights of different aircraft at the same time are different flights', () => {
    const p = planKind([{ ...fi('2025-03-01'), id: 'z', registration: 'OO-XYZ' }], [base], nat);
    expect(p.added).toHaveLength(1);
  });
});

describe('writeCount', () => {
  it('conflicts are only written under the replace policy', () => {
    const a = fi('2025-03-01');
    const plan = planImport({ flights: [{ ...a, remarks: 'x' }, { ...fi('2025-03-02'), id: 'n' }], fstd: [], experience: [] }, { flights: [a], fstd: [], experience: [] });
    expect(writeCount(plan, 'skip')).toBe(1);
    expect(writeCount(plan, 'replace')).toBe(2);
  });
  it('re-importing a logbook into itself writes nothing', () => {
    const bundle = { flights: [fi('2025-03-01'), { ...fi('2025-03-02'), id: 'b' }], fstd: [], experience: [] };
    expect(writeCount(planImport(bundle, bundle), 'replace')).toBe(0);
  });
});
