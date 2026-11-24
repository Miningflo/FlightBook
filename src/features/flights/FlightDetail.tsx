import type { ReactNode } from 'react';
import { useApp } from '../../AppContext';
import type { Flight, OverridableField, Role } from '../../domain/types';
import { CLASS_RATING_LABELS } from '../../domain/types';
import { rolesOfFlight } from '../../domain/roles';
import { formatHHMM } from '../../domain/time';
import { engineClassOfFlight } from '../../domain/flightForm';
import { routeSectorApplies, typeRatingOf } from '../../domain/currency';
import { RoleChip } from '../../ui/components';
import { ArrivalIcon, ClockIcon, MoonIcon, PlaneGlyph, TakeoffIcon } from '../../ui/Icons';
import { PhotoCreditLine, PhotoFrame } from '../photos/AircraftPhoto';
import { useAircraftPhoto } from '../photos/usePhoto';
import { aircraftLabel, formatDate } from './format';
import { RouteLine } from './RouteLine';

function Tile({ icon, label, value, tone, overridden }: { icon?: ReactNode; label: string; value: string; tone?: Role; overridden?: boolean }) {
  return (
    <div className={`tile${tone ? ` role-${tone}` : ''}`}>
      <div className="tile-label">{icon}{label}</div>
      <div className="tile-value">{value}</div>
      {overridden && <div className="badge-override">overridden</div>}
    </div>
  );
}

function Hero({ flight }: { flight: Flight }) {
  const photo = useAircraftPhoto(flight.registration);
  return (
    <div>
      <PhotoFrame registration={flight.registration} photo={photo} className="hero">
        <div className="hero-shade" />
        <div className="hero-text">
          <div className="reg">{flight.registration}</div>
          <div className="type">{aircraftLabel(flight)}</div>
        </div>
      </PhotoFrame>
      <PhotoCreditLine photo={photo} />
    </div>
  );
}

export function FlightDetail({ flight, onEdit }: { flight: Flight; onEdit: () => void }) {
  const { data, canEdit } = useApp();
  const pic = data.persons.find((p) => p.id === flight.picNameId)?.name ?? '?';
  const o = (k: OverridableField) => flight.overrides[k] === true;
  const roles = rolesOfFlight(flight);
  const roleMin: Record<Role, number> = { PIC: flight.picMin, COPI: flight.copiMin, DUAL: flight.dualMin, INS: flight.instMin };
  const rating = typeRatingOf(flight, data.settings.typeRatings ?? []);

  return (
    <div className="detail">
      <Hero flight={flight} />

      <div className="card summary">
        <div className="date">{formatDate(flight.date)}</div>
        <div className="detail-total">{formatHHMM(flight.totalMin)}{o('totalMin') && <span className="badge-override">overridden</span>}</div>
        <RouteLine flight={flight} />
        {(roles.length > 0 || flight.isPicus || flight.isSpic) && (
          <div className="chips" style={{ marginTop: 14 }}>
            {roles.map((r) => <RoleChip key={r} role={r} />)}
            {flight.isPicus && <span className="chip flag">PICUS</span>}
            {flight.isSpic && <span className="chip flag">SPIC</span>}
          </div>
        )}
      </div>

      <div className="tiles">
        {roles.map((r) => <Tile key={r} label={r} tone={r} value={formatHHMM(roleMin[r])} />)}
        <Tile icon={<TakeoffIcon />} label="Take-offs" value={`${flight.takeoffsDay} day · ${flight.takeoffsNight} night`} overridden={o('takeoffsDay') || o('takeoffsNight')} />
        <Tile icon={<ArrivalIcon />} label="Landings" value={`${flight.landingsDay} day · ${flight.landingsNight} night`} overridden={o('landingsDay') || o('landingsNight')} />
        {flight.nightMin > 0 && <Tile icon={<MoonIcon />} label="Night" value={formatHHMM(flight.nightMin)} overridden={o('nightMin')} />}
        {flight.ifrMin > 0 && <Tile icon={<ClockIcon />} label="IFR" value={formatHHMM(flight.ifrMin)} />}
      </div>

      <div className="card facts">
        <div><PlaneGlyph className="fact-icon" /><span>{CLASS_RATING_LABELS[flight.aircraftClass]} · {engineClassOfFlight(flight)}</span></div>
        {rating.kind === 'held' && <div><span className="fact-icon">Type</span><span>{rating.rating.name}</span></div>}
        {(rating.kind === 'none' || rating.kind === 'removed') && (
          <div className="fact-warn"><span className="fact-icon">Type</span>
            <span>{rating.kind === 'none' ? 'No type rating' : 'Its type rating has been removed'}: this flight counts towards no currency.{canEdit ? ' Edit it to pick one.' : ''}</span>
          </div>
        )}
        {routeSectorApplies(flight.aircraftClass) && (
          <div><span className="fact-icon">RS</span><span>{flight.routeSector ? 'Route sector (FCL.010)' : 'Not marked as a route sector'}</span></div>
        )}
        <div><span className="fact-icon">PIC</span><span>{pic}</span></div>
      </div>

      {flight.remarks && (
        <div className="card">
          <div className="hint">Remarks</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{flight.remarks}</div>
        </div>
      )}

      {canEdit && <button type="button" className="btn tonal" onClick={onEdit}>Edit flight</button>}
    </div>
  );
}
