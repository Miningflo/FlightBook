import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { name: 'list' }
  | { name: 'flight'; id: string }
  | { name: 'new' }
  | { name: 'edit'; id: string }
  | { name: 'settings' }
  | { name: 'export' }
  | { name: 'totals' }
  | { name: 'currency' }
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
    case 'fstd': return '#/fstd';
    case 'fstd-new': return '#/fstd/new';
    case 'fstd-edit': return `#/fstd/edit/${r.id}`;
    case 'experience': return '#/experience';
    case 'experience-new': return '#/experience/new';
    case 'experience-edit': return `#/experience/edit/${r.id}`;
  }
}

/** Minimal hash router: works on static hosting (GitHub Pages) with no rewrite rules. */
export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route) => { window.location.hash = routeToHash(r); }, []);
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
