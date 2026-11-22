import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import { sampleGreatCircle } from '../../domain/geo';
import { type MapAirport, type PlaceInfo, buildMapData, connectionsOf, markerRadius, placeCodes, routeWidth } from '../../domain/mapData';
import {
  type Size, type View, fitView, graticuleStep, panBy, project, scaleOf, splitAtAntimeridian, toScreen, unproject, wrapNear, zoomAt,
} from '../../domain/mapProjection';
import { PATH_WORLD_WIDTH, basemapPaths } from './basemap';
import { CloseIcon, FitIcon, MinusIcon, PlusIcon } from '../../ui/Icons';
import { type RangePreset, presetRange } from '../../domain/totals';
import { utcDateOf } from '../../domain/time';

const PRESETS: [RangePreset, string][] = [['all', 'All time'], ['year', 'This year'], ['12m', 'Last 12 months'], ['90d', 'Last 90 days']];

/** A projected line as an SVG path, kept in one piece even when the map is centred near the date line. */
function pathFor(points: { x: number; y: number }[], view: View, size: Size): string {
  const mid = points[Math.floor(points.length / 2)]!.x;
  const shift = wrapNear(mid, view.cx) - mid;
  return points.map((p, i) => {
    const s = toScreen({ x: p.x + shift, y: p.y }, view, size);
    return `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
  }).join(' ');
}

export function MapScreen() {
  const { data, airports, go } = useApp();
  const [preset, setPreset] = useState<RangePreset>('all');
  const [places, setPlaces] = useState<Map<string, PlaceInfo> | null>(null);
  const [dbCount, setDbCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, startDist: 0, startZoom: 0 });
  const base = useMemo(() => basemapPaths(), []);

  const today = utcDateOf(Date.now());
  const range = useMemo(() => presetRange(preset, today), [preset, today]);

  // coordinates of the airports the flights use (the airports database is reference data on this device)
  const codes = useMemo(() => placeCodes(data.flights), [data.flights]);
  useEffect(() => {
    let live = true;
    void Promise.all([airports.count(), airports.getMany(codes)]).then(([count, found]) => {
      if (!live) return;
      setDbCount(count);
      setPlaces(new Map([...found].map(([icao, a]) => [icao, { name: a.name, lat: a.lat, lon: a.lon }])));
    });
    return () => { live = false; };
  }, [airports, codes]);

  const map = useMemo(() => buildMapData(data.flights, places ?? new Map(), range), [data.flights, places, range]);
  const byIcao = useMemo(() => new Map(map.airports.map((a) => [a.icao, a])), [map.airports]);
  const maxRoute = map.routes[0]?.flights ?? 1;

  // follow the size of the container
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [dbCount]);

  // frame everything whenever the set of airports (or the container) changes; the user's own pan/zoom is kept otherwise
  const fitKey = `${map.airports.map((a) => a.icao).join(',')}|${size.w > 0}`;
  const fit = useCallback(() => { if (size.w > 0) setView(fitView(map.airports, size)); }, [map.airports, size]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fit(); }, [fitKey]);

  // ---- gestures: drag to pan, pinch or wheel to zoom ----
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = local(e);
      setView((v) => (v ? zoomAt(v, { w: el.clientWidth, h: el.clientHeight }, at, v.zoom - e.deltaY * 0.0018) : v));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [dbCount]);

  const onDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, local(e));
    gesture.current.moved = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.startDist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      gesture.current.startZoom = view?.zoom ?? 0;
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !view) return;
    const cur = local(e);
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 1) {
      gesture.current.moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      setView((v) => (v ? panBy(v, cur.x - prev.x, cur.y - prev.y) : v));
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      gesture.current.moved += 10;
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      setView((v) => (v ? zoomAt(v, size, mid, gesture.current.startZoom + Math.log2(dist / gesture.current.startDist)) : v));
    }
  };
  const onUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); };
  const zoomBy = (d: number) => setView((v) => (v ? zoomAt(v, size, { x: size.w / 2, y: size.h / 2 }, v.zoom + d) : v));
  // Selecting shows a card over the lower part of the map, so move the airport up if it would end up underneath.
  const select = useCallback((icao: string | null) => {
    setSelected(icao);
    const a = icao ? byIcao.get(icao) : null;
    if (!a) return;
    setView((v) => {
      if (!v) return v;
      const y = toScreen(project(a), v, size).y;
      return y > size.h * 0.45 || y < 0 ? panBy(v, 0, size.h * 0.28 - y) : v;
    });
  }, [byIcao, size]);
  const pick = (icao: string) => { if (gesture.current.moved < 6) select(selected === icao ? null : icao); };

  // ---- what to draw ----
  const lines = useMemo(() => {
    if (!view || size.w === 0) return [];
    return map.routes.flatMap((r) => {
      const a = places?.get(r.a), b = places?.get(r.b);
      if (!a || !b) return [];
      return splitAtAntimeridian(sampleGreatCircle(a, b, 40).map(project)).map((part, i) => ({ key: `${r.a}-${r.b}-${i}`, d: pathFor(part, view, size), width: routeWidth(r.flights, maxRoute), route: r }));
    });
  }, [map.routes, places, view, size, maxRoute]);

  const grid = useMemo(() => {
    if (!view || size.w === 0) return { lats: [] as { y: number; label: string }[], lons: [] as { x: number; label: string }[] };
    const step = graticuleStep(view.zoom);
    const s = scaleOf(view.zoom);
    const topLat = unproject({ x: view.cx, y: view.cy - size.h / 2 / s }).lat, botLat = unproject({ x: view.cx, y: view.cy + size.h / 2 / s }).lat;
    const w = view.cx - size.w / 2 / s, e = view.cx + size.w / 2 / s;
    const lats: { y: number; label: string }[] = [], lons: { x: number; label: string }[] = [];
    for (let lat = Math.ceil(botLat / step) * step; lat <= topLat; lat += step) lats.push({ y: toScreen(project({ lat, lon: 0 }), view, size).y, label: `${Math.abs(lat).toFixed(step < 1 ? 1 : 0)}°${lat >= 0 ? 'N' : 'S'}` });
    for (let lon = Math.ceil((w * 360 - 180) / step) * step; lon <= e * 360 - 180; lon += step) {
      const wl = ((lon + 540) % 360) - 180;
      lons.push({ x: toScreen({ x: (lon + 180) / 360, y: view.cy }, view, size).x, label: `${Math.abs(wl).toFixed(step < 1 ? 1 : 0)}°${wl >= 0 ? 'E' : 'W'}` });
    }
    return { lats: lats.slice(0, 40), lons: lons.slice(0, 40) };
  }, [view, size]);

  // biggest circles first, so the small ones stay on top and can be tapped
  const markers = useMemo(() => (view && size.w > 0 ? [...map.airports].reverse().map((a) => ({ a, p: toScreen(project(a), view, size), r: markerRadius(a.flights) })) : []), [map.airports, view, size]);
  const sel = selected ? byIcao.get(selected) ?? null : null;

  if (data.flights.length === 0) return <div className="empty"><h2>No flights yet</h2><p>Your flights will appear here as airports joined by great-circle routes.</p></div>;
  if (dbCount === 0 || (dbCount !== null && places !== null && places.size === 0 && data.flights.length > 0)) {
    return (
      <div className="empty">
        <h2>The map needs the airports database</h2>
        <p>Your flights are placed using airport coordinates from the OurAirports data, which has not been imported on this device yet. It is reference data (about 13 MB, downloaded once), not part of your logbook.</p>
        <button type="button" className="btn filled" onClick={() => go({ name: 'settings' })}>Open Settings</button>
      </div>
    );
  }

  return (
    <div>
      <section className="map-hero" aria-label="Airports">
        <div className="num" aria-live="polite">{map.airports.length}</div>
        <div className="label">{map.airports.length === 1 ? 'airport' : 'airports'}</div>
        <div className="sub">{map.routes.length} route{map.routes.length === 1 ? '' : 's'} · {map.totalFlights} flight{map.totalFlights === 1 ? '' : 's'}</div>
      </section>
      <div className="range-chips" role="group" aria-label="Date range">
        {PRESETS.map(([k, label]) => <button key={k} type="button" className="chip" aria-pressed={preset === k} onClick={() => setPreset(k)}>{label}</button>)}
      </div>
      <div className="map-wrap" ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}>
        {view && size.w > 0 && (
          <svg width={size.w} height={size.h} role="group" aria-label="Map of your flights" className="map-svg">
            {/* coastlines and borders: one path in world units, positioned with a transform, plus a copy of the world either side */}
            <g className="map-base" aria-hidden="true" transform={`translate(${(size.w / 2 - view.cx * scaleOf(view.zoom)).toFixed(2)} ${(size.h / 2 - view.cy * scaleOf(view.zoom)).toFixed(2)}) scale(${2 ** view.zoom})`}>
              {[-1, 0, 1].map((c) => (
                <g key={c} transform={`translate(${c * PATH_WORLD_WIDTH} 0)`}>
                  <path className="map-land" d={base.land} />
                  <path className="map-border" d={base.borders} />
                </g>
              ))}
            </g>
            <g className="map-grid" aria-hidden="true">
              {grid.lats.map((l) => <g key={`la${l.label}`}><line x1={0} x2={size.w} y1={l.y} y2={l.y} /><text x={4} y={l.y - 3}>{l.label}</text></g>)}
              {grid.lons.map((l) => <g key={`lo${l.label}${l.x}`}><line y1={0} y2={size.h} x1={l.x} x2={l.x} /><text x={l.x + 3} y={size.h - 5}>{l.label}</text></g>)}
            </g>
            <g className="map-routes">
              {lines.map((l) => {
                const on = sel && (l.route.a === sel.icao || l.route.b === sel.icao);
                return <path key={l.key} d={l.d} strokeWidth={l.width} className={`map-route${on ? ' on' : sel ? ' dim' : ''}`}><title>{l.route.a} – {l.route.b}: {l.route.flights} flight{l.route.flights === 1 ? '' : 's'}</title></path>;
              })}
            </g>
            <g className="map-airports">
              {markers.map(({ a, p, r }) => {
                const digits = String(a.flights).length;
                const fs = Math.min(14, (2 * r * 0.8) / (Math.max(2, digits) * 0.62));
                const isSel = sel?.icao === a.icao;
                return (
                  <g key={a.icao} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} className={`map-airport${isSel ? ' selected' : ''}`} role="button" tabIndex={0}
                    aria-label={`${a.icao}, ${a.name}, ${a.flights} flight${a.flights === 1 ? '' : 's'}`} aria-pressed={isSel}
                    onClick={() => pick(a.icao)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(selected === a.icao ? null : a.icao); } }}>
                    {isSel && <circle r={r + 5} className="ring" />}
                    <circle r={r} className="dot" />
                    <text className="count" fontSize={fs} textAnchor="middle" dominantBaseline="central">{a.flights}</text>
                    {(view.zoom >= 7 || isSel) && <text className="code" y={r + 13} textAnchor="middle">{a.icao}</text>}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        <div className="map-controls">
          <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1)}><PlusIcon /></button>
          <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(-1)}><MinusIcon /></button>
          <button type="button" className="icon-btn" aria-label="Show all airports" onClick={fit}><FitIcon /></button>
        </div>
        {sel && (
          <div className="map-info" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <AirportPanel airport={sel} map={map} byIcao={byIcao} onPick={select} />
            <button type="button" className="icon-btn map-info-close" aria-label="Close airport details" onClick={() => select(null)}><CloseIcon /></button>
          </div>
        )}
      </div>

      {map.unplaced.flights > 0 && (
        <p className="msg warning" role="status">
          {map.unplaced.flights} flight{map.unplaced.flights === 1 ? '' : 's'} cannot be drawn as {map.unplaced.flights === 1 ? 'a route' : 'routes'} because an airport is not in the database
          ({map.unplaced.codes.slice(0, 6).join(', ')}{map.unplaced.codes.length > 6 ? '…' : ''}). Airports that are known are still counted.
        </p>
      )}

      <p className="hint" style={{ margin: '0 4px 12px' }}>The number in a circle is how many flights started or ended there; thicker lines are routes flown more often. {!sel && 'Tap an airport to see its connections. Drag to move the map, pinch or scroll to zoom. '}Coastlines and borders: Natural Earth (public domain).</p>
    </div>
  );
}

function AirportPanel({ airport, map, byIcao, onPick }: { airport: MapAirport; map: ReturnType<typeof buildMapData>; byIcao: Map<string, MapAirport>; onPick: (icao: string | null) => void }) {
  const conns = connectionsOf(map, airport.icao);
  return (
    <div>
      <div className="main">{airport.icao} · {airport.name}</div>
      <div className="hint">{airport.flights} flight{airport.flights === 1 ? '' : 's'} started or ended here{conns.length === 0 ? '; no routes to other airports in this range' : ''}.</div>
      {conns.length > 0 && (
        <div className="chips" style={{ marginTop: 10 }}>
          {conns.map((c) => <button key={c.icao} type="button" className="chip" onClick={() => onPick(c.icao)} title={byIcao.get(c.icao)?.name}>{c.icao} · {c.flights}</button>)}
        </div>
      )}
    </div>
  );
}
