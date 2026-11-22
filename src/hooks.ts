import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type Route =
  | { name: 'list' }
  | { name: 'flight'; id: string }
  | { name: 'new' }
  | { name: 'edit'; id: string }
  | { name: 'settings' }
  | { name: 'export' }
  | { name: 'totals' }
  | { name: 'currency' }
  | { name: 'map' }
  | { name: 'fstd' }
  | { name: 'fstd-new' }
  | { name: 'fstd-edit'; id: string }
  | { name: 'experience' }
  | { name: 'experience-new' }
  | { name: 'experience-edit'; id: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b, c] = parts;
  if (a === 'flight' && b) return { name: 'flight', id: b };
  if (a === 'edit' && b) return { name: 'edit', id: b };
  if (a === 'new') return { name: 'new' };
  if (a === 'settings') return { name: 'settings' };
  if (a === 'export') return { name: 'export' };
  if (a === 'totals') return { name: 'totals' };
  if (a === 'currency') return { name: 'currency' };
  if (a === 'map') return { name: 'map' };
  if (a === 'fstd') return b === 'new' ? { name: 'fstd-new' } : b === 'edit' && c ? { name: 'fstd-edit', id: c } : { name: 'fstd' };
  if (a === 'experience') return b === 'new' ? { name: 'experience-new' } : b === 'edit' && c ? { name: 'experience-edit', id: c } : { name: 'experience' };
  return { name: 'list' };
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'list': return '#/';
    case 'flight': return `#/flight/${r.id}`;
    case 'edit': return `#/edit/${r.id}`;
    case 'new': return '#/new';
    case 'settings': return '#/settings';
    case 'export': return '#/export';
    case 'totals': return '#/totals';
    case 'currency': return '#/currency';
    case 'map': return '#/map';
    case 'fstd': return '#/fstd';
    case 'fstd-new': return '#/fstd/new';
    case 'fstd-edit': return `#/fstd/edit/${r.id}`;
    case 'experience': return '#/experience';
    case 'experience-new': return '#/experience/new';
    case 'experience-edit': return `#/experience/edit/${r.id}`;
  }
}

/**
 * Where the top-left "Back" button goes: one level UP the screen hierarchy, never "wherever the browser came
 * from". (Browser history can contain screens the user has already left, e.g. an edit form after saving.)
 */
export function parentRoute(r: Route): Route | null {
  switch (r.name) {
    case 'flight': case 'new': case 'settings': return { name: 'list' };
    case 'edit': return { name: 'flight', id: r.id };
    case 'export': return { name: 'settings' };
    case 'fstd': case 'experience': return { name: 'totals' };
    case 'fstd-new': case 'fstd-edit': return { name: 'fstd' };
    case 'experience-new': case 'experience-edit': return { name: 'experience' };
    case 'list': case 'totals': case 'currency': case 'map': return null;
  }
}

export interface GoOptions {
  /** Replace the current history entry instead of adding one (after saving, deleting, cancelling, or going up). */
  replace?: boolean;
}

/** Minimal hash router: works on static hosting (GitHub Pages) with no rewrite rules. */
export function useRoute(): [Route, (r: Route, opts?: GoOptions) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route, opts?: GoOptions) => {
    if (opts?.replace) {
      // replaceState does not fire "hashchange", so the route state is updated directly
      window.history.replaceState(null, '', routeToHash(r));
      setRoute(r);
    } else {
      window.location.hash = routeToHash(r);
    }
  }, []);
  return [route, go];
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Overview screens you come back to: returning to one restores where you were scrolled. Every other screen opens at the top. */
const RETURN_TO: ReadonlySet<Route['name']> = new Set<Route['name']>(['list', 'totals', 'currency', 'settings', 'export', 'fstd', 'experience']);

/** Which scroll position a route uses. On wide screens the list stays on screen beside the selected flight. */
export function scrollKey(r: Route, wide: boolean): string {
  if (wide && (r.name === 'list' || r.name === 'flight')) return 'list';
  return routeToHash(r);
}

/** What to do with the page's scroll position when the screen changes: restore a remembered position, or go to the top. */
export function scrollTarget(r: Route, saved: number | undefined): number {
  return RETURN_TO.has(r.name) && saved !== undefined ? saved : 0;
}

/**
 * A new screen opens at the top instead of wherever the previous screen was scrolled to, and going back to an
 * overview screen (the logbook list, Totals, Settings...) returns to where you were on it.
 */
export function useScrollMemory(route: Route, wide: boolean): void {
  const key = scrollKey(route, wide);
  const memory = useRef(new Map<string, number>());
  const current = useRef(key);
  useEffect(() => {
    const on = () => { memory.current.set(current.current, window.scrollY); };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useLayoutEffect(() => {
    if (current.current === key) return;
    current.current = key;
    window.scrollTo(0, scrollTarget(route, memory.current.get(key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
