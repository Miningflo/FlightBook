import { useMemo, useState } from 'react';
import { useApp } from '../../AppContext';
import { CLASS_RATING_LABELS, ROLES } from '../../domain/types';
import { type RangePreset, classesWithTime, computeTotals, percentOf, presetRange } from '../../domain/totals';
import { formatHHMM, utcDateOf } from '../../domain/time';
import { Bar } from '../../ui/components';
import { ChevronIcon } from '../../ui/Icons';
import { formatShortDate } from '../flights/format';

const PRESETS: [RangePreset, string][] = [['all', 'All time'], ['year', 'This year'], ['12m', 'Last 12 months'], ['90d', 'Last 90 days'], ['custom', 'Custom']];

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="tile"><div className="tile-label">{label}</div><div className="tile-value">{value}</div></div>;
}

export function TotalsScreen() {
  const { data, go } = useApp();
  const [preset, setPreset] = useState<RangePreset>('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [includeExp, setIncludeExp] = useState(true);
  const today = utcDateOf(Date.now());
  const range = useMemo(() => presetRange(preset, today, custom), [preset, today, custom]);
  const badRange = range.from !== undefined && range.to !== undefined && range.from > range.to;
  const t = useMemo(
    () => computeTotals({ flights: data.flights, fstd: data.fstd, experience: data.previousExperience, range: badRange ? { from: '9999-12-31' } : range, includeExperience: includeExp }),
    [data, range, badRange, includeExp],
  );
  const classes = classesWithTime(t);
  const fstdAll = data.fstd.reduce((a, s) => a + s.totalMin, 0);

  return (
    <div>
      <div className="range-chips" role="group" aria-label="Date range">
        {PRESETS.map(([k, label]) => <button key={k} type="button" className="chip" aria-pressed={preset === k} onClick={() => setPreset(k)}>{label}</button>)}
      </div>
      {preset === 'custom' && (
        <div className="card">
          <div className="grid2">
            <label className="field"><span className="label">From</span><input className="input" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label className="field"><span className="label">To</span><input className="input" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
          </div>
          {badRange && <div className="msg error" role="alert">The start date is after the end date.</div>}
        </div>
      )}
      {preset !== 'all' && !badRange && (range.from || range.to) && (
        <p className="hint" style={{ margin: '0 4px 8px' }}>{range.from ? formatShortDate(range.from) : 'Beginning'} – {range.to ? formatShortDate(range.to) : 'today'}</p>
      )}

      <section className="hero-stats" aria-label="Total flight time">
        <div className="label">Flight time</div>
        <div className="big">{formatHHMM(t.flightMin)}<span className="unit"> h</span></div>
        <div className="mini-stats">
          <div><b>{t.flights}</b><span>flights</span></div>
          <div><b>{formatHHMM(t.fstdMin)}</b><span>simulator</span></div>
          <div><b>{t.takeoffsDay + t.takeoffsNight}</b><span>take-offs</span></div>
        </div>
      </section>

      {(data.previousExperience.length > 0) && (
        <div className="card">
          <label className="switch-row">
            <div>
              <div>Include previous experience</div>
              <div className="hint">
                {t.experienceIncluded} of {data.previousExperience.length} record{data.previousExperience.length === 1 ? '' : 's'} included
                {t.experienceExcluded > 0 && includeExp ? '. A record is left out when the date range cuts through its period, because a lump sum cannot be split by date. A record without a start date covers everything up to its end date.' : '.'}
              </div>
            </div>
            <input type="checkbox" checked={includeExp} onChange={(e) => setIncludeExp(e.target.checked)} aria-label="Include previous experience" />
          </label>
        </div>
      )}

      <h2 className="section-label">Pilot function</h2>
      <div className="card">
        {ROLES.map((r) => (
          <div className="role-line" key={r}>
            <span className={`chip role-${r}`}>{r}</span>
            <Bar value={t.roles[r]} max={t.flightMin} tone={`role-${r}`} label={`${r} ${Math.round(percentOf(t.roles[r], t.flightMin))}% of flight time`} />
            <div><div className="time">{formatHHMM(t.roles[r])}</div><div className="pct">{percentOf(t.roles[r], t.flightMin).toFixed(1)}%</div></div>
          </div>
        ))}
        <p className="hint" style={{ margin: 0 }}>Percent of total flight time. A flight can carry more than one function, so these need not add up to 100%.</p>
      </div>

      <h2 className="section-label">Crew and conditions</h2>
      <div className="tiles">
        <Tile label="Single-pilot SE" value={formatHHMM(t.spSeMin)} />
        <Tile label="Single-pilot ME" value={formatHHMM(t.spMeMin)} />
        <Tile label="Multi-pilot" value={formatHHMM(t.mpMin)} />
        <Tile label="PICUS" value={formatHHMM(t.picusMin)} />
        <Tile label="SPIC" value={formatHHMM(t.spicMin)} />
        <Tile label="Night" value={formatHHMM(t.nightMin)} />
        <Tile label="IFR" value={formatHHMM(t.ifrMin)} />
        <Tile label="Simulator" value={formatHHMM(t.fstdMin)} />
      </div>
      <div className="tiles">
        <Tile label="Take-offs day / night" value={`${t.takeoffsDay} / ${t.takeoffsNight}`} />
        <Tile label="Landings day / night" value={`${t.landingsDay} / ${t.landingsNight}`} />
      </div>

      <h2 className="section-label">By class</h2>
      <div className="card">
        {classes.length === 0 && <p className="hint" style={{ margin: 0 }}>No flights in this range.</p>}
        {classes.map((k) => {
          const c = t.byClass[k]!;
          return (
            <div className="class-row" key={k}>
              <div><div className="name">{CLASS_RATING_LABELS[k]}</div><div className="sub">PIC {formatHHMM(c.picMin)} · {c.takeoffs} T/O · {c.landings} LDG</div></div>
              <div className="val">{formatHHMM(c.totalMin)}</div>
            </div>
          );
        })}
      </div>

      <h2 className="section-label">Records</h2>
      <button type="button" className="card tappable link-card" onClick={() => go({ name: 'fstd' })}>
        <div><div className="main">Simulator sessions</div><div className="hint">{data.fstd.length} session{data.fstd.length === 1 ? '' : 's'} · {formatHHMM(fstdAll)}</div></div><ChevronIcon />
      </button>
      <button type="button" className="card tappable link-card" onClick={() => go({ name: 'experience' })}>
        <div><div className="main">Previous experience</div><div className="hint">{data.previousExperience.length} record{data.previousExperience.length === 1 ? '' : 's'} · hours logged before this app</div></div><ChevronIcon />
      </button>
    </div>
  );
}
