import { type ReactNode, useMemo, useState } from 'react';
import { useApp } from '../../AppContext';
import { CLASS_RATING_LABELS, type Minutes, ROLES } from '../../domain/types';
import { type RangePreset, classesWithTime, computeTotals, percentOf, presetRange } from '../../domain/totals';
import { formatHHMM, utcDateOf } from '../../domain/time';
import { Bar } from '../../ui/components';
import { CapIcon, ChevronIcon, CloudIcon, EyeIcon, LandingIcon, MonitorIcon, MoonIcon, PeopleIcon, PersonIcon } from '../../ui/Icons';
import { formatShortDate } from '../flights/format';

const PRESETS: [RangePreset, string][] = [['all', 'All time'], ['year', 'This year'], ['12m', 'Last 12 months'], ['90d', 'Last 90 days'], ['custom', 'Custom']];

/**
 * Colour follows meaning, and only hues the screen does not already use for something else: the pilot
 * functions above own green, cyan, orange and purple. Flight time by crew category is the primary blue of
 * the hero card; PICUS and SPIC take the PIC green on purpose, because they are PIC time; night is a dark
 * night sky (lightness, not a hue, so it never reads as INS purple); IFR is cloud grey. Text keeps the text
 * colours: the tint, the icon badge and the share bar carry the colour.
 */
type Tone = 'crew' | 'pic' | 'night' | 'ifr';

function StatTile({ icon, label, value, tone, share }: {
  icon: ReactNode; label: string; value: Minutes; tone: Tone;
  /** Draw the share of this total (flight time). Left out where it is not part of that total (simulator). */
  share?: Minutes;
}) {
  return (
    <div className={`tile stat tone-${tone}`}>
      <div className="tile-label"><span className="badge">{icon}</span>{label}</div>
      <div className="tile-value">{formatHHMM(value)}</div>
      {share !== undefined && <Bar value={value} max={share} label={`${label} ${Math.round(percentOf(value, share))}% of flight time`} />}
    </div>
  );
}

/** Day and night counts, with a split bar: day in sun yellow, night in the night-sky navy of the Night tile. */
function DayNightTile({ icon, label, day, night }: { icon: ReactNode; label: string; day: number; night: number }) {
  return (
    <div className="tile stat tone-daynight">
      <div className="tile-label"><span className="badge">{icon}</span>{label}</div>
      <div className="tile-value">{day} <span className="unit">day</span> · {night} <span className="unit">night</span></div>
      <div className="split" role="img" aria-label={`${day} by day, ${night} at night`}>
        {day > 0 && <span className="day" style={{ flexGrow: day }} />}
        {night > 0 && <span className="night" style={{ flexGrow: night }} />}
      </div>
    </div>
  );
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
                {t.experienceExcluded > 0 && includeExp ? '. A record is left out when the date range cuts through its period, because a lump sum cannot be split by date.' : '.'}
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
        <StatTile tone="crew" icon={<PersonIcon />} label="Single-pilot SE" value={t.spSeMin} share={t.flightMin} />
        <StatTile tone="crew" icon={<PersonIcon />} label="Single-pilot ME" value={t.spMeMin} share={t.flightMin} />
        <StatTile tone="crew" icon={<PeopleIcon />} label="Multi-pilot" value={t.mpMin} share={t.flightMin} />
        <StatTile tone="pic" icon={<EyeIcon />} label="PICUS" value={t.picusMin} share={t.flightMin} />
        <StatTile tone="pic" icon={<CapIcon />} label="SPIC" value={t.spicMin} share={t.flightMin} />
        <StatTile tone="night" icon={<MoonIcon />} label="Night" value={t.nightMin} share={t.flightMin} />
        <StatTile tone="ifr" icon={<CloudIcon />} label="IFR" value={t.ifrMin} share={t.flightMin} />
        <StatTile tone="crew" icon={<MonitorIcon />} label="Simulator" value={t.fstdMin} />
      </div>
      <div className="tiles">
        <DayNightTile icon={<LandingIcon />} label="Take-offs" day={t.takeoffsDay} night={t.takeoffsNight} />
        <DayNightTile icon={<LandingIcon />} label="Landings" day={t.landingsDay} night={t.landingsNight} />
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
