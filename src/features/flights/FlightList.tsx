import { useMemo } from 'react';
import { useApp } from '../../AppContext';
import type { Flight } from '../../domain/types';
import { rolesOfFlight } from '../../domain/roles';
import { quickStats } from '../../domain/stats';
import { formatHHMM } from '../../domain/time';
import { RoleChip } from '../../ui/components';
import { PlaneGlyph } from '../../ui/Icons';
import { AircraftThumb } from '../photos/AircraftPhoto';
import { aircraftLabel, formatDate, formatMonth, monthKey } from './format';

export function FlightCard({ flight, selected, onOpen }: { flight: Flight; selected: boolean; onOpen: () => void }) {
  const roles = rolesOfFlight(flight);
  const night = flight.nightMin > 0;
  return (
    <button type="button" className={`card tappable flight-card${selected ? ' selected' : ''}`} onClick={onOpen}>
      <AircraftThumb registration={flight.registration} />
      <div className="body">
        <div className="row1">
          <span className="date">{formatDate(flight.date)}</span>
          <span className="total">{formatHHMM(flight.totalMin)}</span>
        </div>
        <div className="route">{flight.depPlace}<PlaneGlyph className="arrow" style={{ transform: 'rotate(90deg)' }} />{flight.arrPlace}</div>
        <div className="meta">{flight.registration} · {aircraftLabel(flight)}</div>
        <div className="chips">
          {roles.map((r) => <RoleChip key={r} role={r} />)}
          {flight.isPicus && <span className="chip flag">PICUS</span>}
          {flight.isSpic && <span className="chip flag">SPIC</span>}
          {night && <span className="chip flag">Night {formatHHMM(flight.nightMin)}</span>}
        </div>
      </div>
    </button>
  );
}

function StatsHeader({ flights }: { flights: Flight[] }) {
  const s = useMemo(() => quickStats(flights, Date.now()), [flights]);
  return (
    <section className="hero-stats" aria-label="Logbook summary">
      <div className="label">Logged in this logbook</div>
      <div className="big">{formatHHMM(s.totalMin)}<span className="unit"> h</span></div>
      <div className="mini-stats">
        <div><b>{s.flights}</b><span>flights</span></div>
        <div><b>{formatHHMM(s.last30DaysMin)}</b><span>last 30 days</span></div>
        <div><b>{s.landings}</b><span>landings</span></div>
      </div>
    </section>
  );
}

export function FlightList({ selectedId, onOpen }: { selectedId?: string; onOpen: (id: string) => void }) {
  const { data, canEdit } = useApp();
  const groups = useMemo(() => {
    const out: { key: string; flights: Flight[] }[] = [];
    for (const f of data.flights) {
      const k = monthKey(f.date);
      const last = out[out.length - 1];
      if (last && last.key === k) last.flights.push(f);
      else out.push({ key: k, flights: [f] });
    }
    return out;
  }, [data.flights]);

  if (data.flights.length === 0) {
    return (
      <div className="empty">
        <div className="empty-art" aria-hidden="true"><PlaneGlyph /></div>
        <h2>Ready for take-off</h2>
        <p>{canEdit ? 'Tap + to log your first flight.' : 'This device is a read-only viewer. Snapshots from Google Drive will appear here.'}</p>
      </div>
    );
  }
  return (
    <div>
      <StatsHeader flights={data.flights} />
      {groups.map((g) => (
        <section key={g.key} aria-label={formatMonth(g.key)}>
          <h2 className="section-label">{formatMonth(g.key)}</h2>
          {g.flights.map((f) => (
            <FlightCard key={f.id} flight={f} selected={f.id === selectedId} onOpen={() => onOpen(f.id)} />
          ))}
        </section>
      ))}
    </div>
  );
}
