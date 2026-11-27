import { afterEach, describe, expect, it } from 'vitest';
import { createRouter, parentRoute, parseHash, routeToHash, scrollKey, scrollTarget, setLeaveGuard, type Route, type RouterWindow } from './hooks';

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
    for (const r of [{ name: 'list' }, { name: 'totals' }, { name: 'currency' }, { name: 'map' }] as Route[]) expect(parentRoute(r)).toBeNull();
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
    for (const r of [{ name: 'list' }, { name: 'flight', id: 'abc' }, { name: 'export' }, { name: 'map' }, { name: 'fstd-edit', id: 'q' }] as Route[]) expect(parseHash(routeToHash(r))).toEqual(r);
  });
});

describe('scroll position when the screen changes', () => {
  it('overview screens restore where you were; everything else opens at the top', () => {
    for (const name of ['list', 'totals', 'currency', 'settings', 'export', 'fstd', 'experience'] as const) {
      expect(scrollTarget({ name } as Route, 1234)).toBe(1234);
      expect(scrollTarget({ name } as Route, undefined)).toBe(0);
    }
    expect(scrollTarget({ name: 'flight', id: 'a' }, 900)).toBe(0);
    expect(scrollTarget({ name: 'edit', id: 'a' }, 900)).toBe(0);
    expect(scrollTarget({ name: 'new' }, 900)).toBe(0);
    expect(scrollTarget({ name: 'experience-new' }, 900)).toBe(0);
  });
  it('each screen has its own position; on wide screens the list and a selected flight share one', () => {
    expect(scrollKey({ name: 'flight', id: 'a' }, false)).not.toBe(scrollKey({ name: 'list' }, false));
    expect(scrollKey({ name: 'flight', id: 'a' }, true)).toBe(scrollKey({ name: 'list' }, true));
    expect(scrollKey({ name: 'flight', id: 'a' }, true)).toBe(scrollKey({ name: 'flight', id: 'b' }, true));
    expect(scrollKey({ name: 'totals' }, true)).toBe('#/totals');
  });
});

describe('the Currency class and the way back from fixing a flight', () => {
  it('keeps the selected class in the address, and the default chip keeps the plain one', () => {
    expect(routeToHash({ name: 'currency', cls: 'OTHER' })).toBe('#/currency/OTHER');
    expect(parseHash('#/currency/OTHER')).toEqual({ name: 'currency', cls: 'OTHER' });
    expect(parseHash('#/currency')).toEqual({ name: 'currency' });
    expect(parseHash('#/currency/NOT_A_CLASS')).toEqual({ name: 'currency' });
  });
  it('an edit opened from a list on the Currency screen goes back up to that list and chip, not to the flight', () => {
    const r = { name: 'edit', id: 'f1', from: 'OTHER' } as const;
    expect(routeToHash(r)).toBe('#/edit/f1/currency/OTHER');
    expect(parseHash('#/edit/f1/currency/OTHER')).toEqual(r);
    expect(parentRoute(r)).toEqual({ name: 'currency', cls: 'OTHER' });
    expect(parentRoute({ name: 'edit', id: 'f1', from: 'MEP_LAND' })).toEqual({ name: 'currency', cls: 'MEP_LAND' });
    expect(parentRoute({ name: 'edit', id: 'f1', from: 'SEP_LAND' })).toEqual({ name: 'currency' }); // the default chip
    expect(parentRoute({ name: 'edit', id: 'f1' })).toEqual({ name: 'flight', id: 'f1' });
    expect(parseHash('#/edit/f1/currency/NOPE')).toEqual({ name: 'edit', id: 'f1' });
    expect(parseHash('#/edit/f1/whatever')).toEqual({ name: 'edit', id: 'f1' });
  });
  it('switching class chips keeps one scroll position for the Currency screen', () => {
    expect(scrollKey({ name: 'currency', cls: 'OTHER' }, false)).toBe(scrollKey({ name: 'currency' }, false));
  });
});

describe('asking before a form is left', () => {
  /** A browser history of addresses, enough to see where each navigation really ends up. */
  function browser(...start: string[]) {
    const stack = [...start];
    let at = stack.length - 1;
    const shown: Route[] = [];
    const win: RouterWindow = {
      location: {
        get hash() { return stack[at]!; },
        set hash(h: string) { stack.splice(++at, stack.length, h); router.onHashChange(); },
      },
      history: {
        pushState: (_d, _u, url) => { stack.splice(++at, stack.length, url); },
        replaceState: (_d, _u, url) => { stack[at] = url; },
        back: () => { if (at > 0) { at--; router.onHashChange(); } },
      },
    };
    const router = createRouter(win, (r) => shown.push(r));
    return { ...router, back: win.history.back, where: () => stack[at], shown };
  }
  let release = () => {};
  afterEach(() => release());
  function guard() {
    const asked: (() => void)[] = [];
    release = setLeaveGuard((proceed) => asked.push(proceed));
    return asked;
  }

  it("the browser's Back stays on the form until confirmed, then goes where it was headed", () => {
    const b = browser('#/', '#/new');
    const asked = guard();
    b.back();
    expect(b.where()).toBe('#/new');
    expect(b.shown).toEqual([]);
    b.back(); // "keep editing", then Back again: asks again
    expect(asked).toHaveLength(2);
    asked[1]!();
    expect(b.where()).toBe('#/');
    expect(b.shown).toEqual([{ name: 'list' }]);
  });
  it("the app's own buttons ask too", () => {
    const b = browser('#/', '#/new');
    const asked = guard();
    b.go({ name: 'list' }, { replace: true });
    b.go({ name: 'settings' });
    expect(b.where()).toBe('#/new');
    asked[0]!();
    expect(b.where()).toBe('#/');
  });
  it('a typed address asks, and confirming goes there', () => {
    const b = browser('#/', '#/new');
    const asked = guard();
    b.go({ name: 'new' }); // staying on the same screen is not leaving
    expect(asked).toHaveLength(0);
    b.go({ name: 'totals' });
    asked[0]!();
    expect(b.where()).toBe('#/totals');
  });
  it('saving leaves without asking', () => {
    const b = browser('#/', '#/new');
    const asked = guard();
    b.go({ name: 'flight', id: 'a' }, { replace: true, force: true });
    expect(asked).toHaveLength(0);
    expect(b.where()).toBe('#/flight/a');
  });
  it('without a guard nothing changes', () => {
    const b = browser('#/', '#/new');
    b.back();
    expect(b.shown).toEqual([{ name: 'list' }]);
  });
});
