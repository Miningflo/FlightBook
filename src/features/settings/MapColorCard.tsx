import { useApp } from '../../AppContext';
import { MAP_COLORS, lightDark, mapColorById } from '../map/mapColors';

/** Choose the colour of airports and routes on the map. A small preview shows how each one looks in the current theme. */
export function MapColorCard() {
  const { data, updateSettings } = useApp();
  const current = mapColorById(data.settings.mapColor).id;
  return (
    <div className="card">
      <div>Map colours</div>
      <p className="hint">The colour of the airport circles and the routes between them.</p>
      <div className="swatches" role="radiogroup" aria-label="Map colour">
        {MAP_COLORS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={current === c.id} className="swatch"
            onClick={() => void updateSettings({ mapColor: c.id })}>
            <svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true" className="swatch-art">
              <rect width="64" height="40" rx="10" className="swatch-bg" />
              <path d="M12 28 Q32 6 52 14" fill="none" strokeWidth="3" strokeLinecap="round" style={{ stroke: lightDark(c.light.route, c.dark.route), opacity: 0.85 }} />
              <circle cx="12" cy="28" r="8" style={{ fill: lightDark(c.light.dot, c.dark.dot) }} className="swatch-dot" />
              <circle cx="52" cy="14" r="6" style={{ fill: lightDark(c.light.dot, c.dark.dot) }} className="swatch-dot" />
              <text x="12" y="28" textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="700" style={{ fill: lightDark(c.light.text, c.dark.text) }}>7</text>
              <text x="52" y="14" textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" style={{ fill: lightDark(c.light.text, c.dark.text) }}>2</text>
            </svg>
            <span className="swatch-label">{current === c.id ? '✓ ' : ''}{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
