import type { Flight } from '../../domain/types';
import { clockOfTimestamp, landingDayOffset } from '../../domain/time';
import { PlaneGlyph } from '../../ui/Icons';

/** Departure ——✈—— arrival, with UTC times under the codes. */
export function RouteLine({ flight }: { flight: Flight }) {
  const days = landingDayOffset(flight.depTimeUtc, flight.arrTimeUtc);
  return (
    <div className="route-line" role="group" aria-label={`${flight.depPlace} to ${flight.arrPlace}`}>
      <div className="stop">
        <div className="code">{flight.depPlace}</div>
        <div className="time">{clockOfTimestamp(flight.depTimeUtc)}</div>
      </div>
      <div className="track" aria-hidden="true"><span className="line" /><PlaneGlyph className="plane" style={{ transform: 'rotate(90deg)' }} /><span className="line" /></div>
      <div className="stop end">
        <div className="code">{flight.arrPlace}</div>
        <div className="time">
          {clockOfTimestamp(flight.arrTimeUtc)}
          {days > 0 && <sup className="day-offset" title={days === 1 ? 'Landed the next day (UTC)' : `Landed ${days} days later (UTC)`}> +{days}</sup>}
        </div>
      </div>
    </div>
  );
}
