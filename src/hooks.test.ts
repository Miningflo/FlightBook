import { describe, expect, it } from 'vitest';
import { parentRoute, parseHash, routeToHash, type Route } from './hooks';

describe('parentRoute: the Back button goes UP, not through browser history', () => {
  it('a saved flight goes back to the home list, and an edit form goes back to its flight', () => {
    expect(parentRoute({ name: 'flight', id: 'x' })).toEqual({ name: 'list' });
    expect(parentRoute({ name: 'edit', id: 'x' })).toEqual({ name: 'flight', id: 'x' });
    expect(parentRoute({ name: 'new' })).toEqual({ name: 'list' });
  });
  it('the other screens return to the screen that owns them', () => {
    expect(parentRoute({ name: 'settings' })).toEqual({ name: 'list' });
    expect(parentRoute({ name: 'export' })).toEqual({ name: 'settings' });
    expect(parentRoute({ name: 'fstd' })).toEqual({ name: 'totals' });
    expect(parentRoute({ name: 'fstd-edit', id: 'a' })).toEqual({ name: 'fstd' });
    expect(parentRoute({ name: 'fstd-new' })).toEqual({ name: 'fstd' });
    expect(parentRoute({ name: 'experience' })).toEqual({ name: 'totals' });
    expect(parentRoute({ name: 'experience-new' })).toEqual({ name: 'experience' });
    expect(parentRoute({ name: 'experience-edit', id: 'a' })).toEqual({ name: 'experience' });
  });
  it('top-level screens have nothing above them', () => {
    for (const r of [{ name: 'list' }, { name: 'totals' }, { name: 'currency' }] as Route[]) expect(parentRoute(r)).toBeNull();
  });
  it('walking up from any screen reaches a top-level screen without looping', () => {
    const all: Route[] = [{ name: 'flight', id: 'a' }, { name: 'edit', id: 'a' }, { name: 'new' }, { name: 'settings' }, { name: 'export' }, { name: 'fstd' }, { name: 'fstd-new' }, { name: 'fstd-edit', id: 'a' }, { name: 'experience' }, { name: 'experience-new' }, { name: 'experience-edit', id: 'a' }];
    for (const start of all) {
      let r: Route | null = start; let steps = 0;
      while (r && steps < 6) { r = parentRoute(r); steps++; }
      expect(r).toBeNull();
    }
  });
  it('routes round-trip through the hash', () => {
    for (const r of [{ name: 'list' }, { name: 'flight', id: 'abc' }, { name: 'export' }, { name: 'fstd-edit', id: 'q' }] as Route[]) expect(parseHash(routeToHash(r))).toEqual(r);
  });
});
