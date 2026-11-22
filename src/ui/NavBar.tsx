import type { ReactNode } from 'react';
import type { Route } from '../hooks';
import { ChartIcon, ListIcon, ShieldIcon } from './Icons';

const ITEMS: { name: 'list' | 'totals' | 'currency'; label: string; icon: ReactNode }[] = [
  { name: 'list', label: 'Logbook', icon: <ListIcon /> },
  { name: 'totals', label: 'Totals', icon: <ChartIcon /> },
  { name: 'currency', label: 'Currency', icon: <ShieldIcon /> },
];

/** Bottom navigation on phones; the same items sit in the top bar on wide screens. */
export function NavBar({ route, go }: { route: Route; go: (r: Route) => void }) {
  const active = route.name === 'flight' ? 'list' : route.name;
  return (
    <nav className="navbar" aria-label="Main">
      {ITEMS.map((i) => (
        <button key={i.name} type="button" className="nav-item" aria-current={active === i.name ? 'page' : undefined} onClick={() => go({ name: i.name })}>
          <span className="pill">{i.icon}<span className="nav-label">{i.label}</span></span>
        </button>
      ))}
    </nav>
  );
}
