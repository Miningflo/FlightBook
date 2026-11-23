import { Suspense, lazy, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppContext, type AppContextValue, type AppData } from './AppContext';
import { applyImport, applyReplace, readBundle } from './db/importer';
import { OnlinePhotoStore } from './features/photos/photoStore';
import { AirportStore } from './features/airports/airportStore';
import { snapshotFromDb } from './features/export/backup';
import { ExportScreen } from './features/export/ExportScreen';
import { bridge, db, drive, repo } from './driveRuntime';
import { parentRoute, useMediaQuery, useRoute, useScrollMemory } from './hooks';
import { registerServiceWorker } from './pwa/register';
import { runAlertCheck } from './pwa/alerts';
import { newestFirst } from './domain/suggestions';
import { snapshotRecords, snapshotToBundle } from './domain/snapshot';
import { BackIcon, EditIcon, PlusIcon, SettingsIcon } from './ui/Icons';
import { Snackbar } from './ui/components';
import { NavBar } from './ui/NavBar';
import { TotalsScreen } from './features/totals/TotalsScreen';
import { CurrencyScreen } from './features/currency/CurrencyScreen';
// the map (with its coastline data) loads when first opened; it is still precached for offline use
const MapScreen = lazy(() => import('./features/map/MapScreen').then((m) => ({ default: m.MapScreen })));
import { FstdForm, FstdList } from './features/fstd/FstdScreens';
import { ExperienceForm, ExperienceList } from './features/experience/ExperienceScreens';
import { FlightList } from './features/flights/FlightList';
import { FlightDetail } from './features/flights/FlightDetail';
import { FlightFormScreen } from './features/flights/FlightFormScreen';
import { SettingsScreen, SetupScreen } from './features/settings/SettingsScreen';
import { DriveBanners, ViewerGate } from './features/drive/DriveBanners';
import { applyMapColor } from './features/map/mapColors';

const onlinePhotos = new OnlinePhotoStore(db);
const airports = new AirportStore(db);

const masterPortability: AppContextValue['portability'] = {
  readBundle: () => readBundle(db),
  snapshot: () => snapshotFromDb(db),
  apply: (...args) => applyImport(db, ...args),
  replace: (snapshot) => applyReplace(db, snapshot),
};
const viewerRefusal = () => Promise.reject(new Error('This device is a read-only viewer; it cannot change the logbook.'));

export function App() {
  const [local, setLocal] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [route, go] = useRoute();
  const [updateApply, setUpdateApply] = useState<(() => void) | null>(null);
  const wide = useMediaQuery('(min-width: 900px)');
  useScrollMemory(route, wide);
  const driveState = useSyncExternalStore(drive.subscribe, drive.getState);

  const reload = useCallback(async () => {
    const [flights, aircraft, persons, fstd, previousExperience, settings] = await Promise.all([
      repo.listFlights(), repo.listAircraft(), repo.listPersons(), repo.listFstd(), repo.listPreviousExperience(), repo.getSettings(),
    ]);
    bridge.settings = settings; // the Drive controller reads the current settings from here
    setLocal({ flights: newestFirst(flights), aircraft, persons, fstd, previousExperience, settings });
    drive.settingsChanged();
  }, []);

  useEffect(() => {
    bridge.reload = reload;
    reload().catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    registerServiceWorker((apply) => setUpdateApply(() => apply));
  }, [reload]);

  const isMaster = local?.settings.isMaster ?? false;
  const setupDone = local?.settings.setupDone ?? false;

  // On start (and whenever the role changes): the master considers a backup, a viewer loads the logbook from Drive.
  useEffect(() => {
    if (!setupDone) return;
    if (isMaster) drive.scheduler.appOpened();
    else void drive.startViewer();
  }, [isMaster, setupDone]);

  // Alerts: look for anything that got worse when the app opens and whenever it comes back to the front.
  const alertsOn = local?.settings.alerts?.enabled ?? false;
  useEffect(() => {
    if (!isMaster || !setupDone || !alertsOn || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const check = () => { void runAlertCheck().catch(() => undefined); };
    check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isMaster, setupDone, alertsOn]);

  useEffect(() => {
    const on = () => drive.scheduler.backOnline();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);

  // A viewer shows the downloaded snapshot; the master shows its own database. Local settings always come from this device.
  const viewerSnap = drive.getViewerSnapshot();
  const viewerRecords = useMemo(() => (viewerSnap ? snapshotRecords(viewerSnap) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewerSnap, driveState.viewerRevision]);
  const data = useMemo<AppData | null>(() => {
    if (!local) return null;
    if (local.settings.isMaster) return local;
    return {
      flights: newestFirst(viewerRecords?.flights ?? []),
      aircraft: viewerSnap?.aircraft ?? [], persons: viewerSnap?.persons ?? [],
      fstd: viewerRecords?.fstd ?? [], previousExperience: viewerRecords?.experience ?? [],
      settings: { ...local.settings, pilotName: viewerSnap?.settings.pilotName ?? local.settings.pilotName, licenceNumber: viewerSnap?.settings.licenceNumber ?? local.settings.licenceNumber, address: viewerSnap?.settings.address ?? local.settings.address, sepLandExpiry: viewerSnap ? viewerSnap.settings.sepLandExpiry ?? null : local.settings.sepLandExpiry, classExpiry: viewerSnap ? viewerSnap.settings.classExpiry ?? {} : local.settings.classExpiry, irExpiry: viewerSnap ? viewerSnap.settings.irExpiry ?? null : local.settings.irExpiry },
    };
  }, [local, viewerRecords, viewerSnap]);

  // Theme preference is applied on <html>; "system" leaves the OS to decide.
  useEffect(() => {
    const t = data?.settings.theme ?? 'system';
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, [data?.settings.theme]);

  // Map colours are a device preference, applied as CSS variables on <html>.
  useEffect(() => { applyMapColor(data?.settings.mapColor); }, [data?.settings.mapColor]);

  const ctx = useMemo<AppContextValue | null>(() => {
    if (!data) return null;
    const canEdit = data.settings.isMaster;
    const updateSettings = async (patch: Parameters<typeof repo.updateSettings>[0]) => {
      await repo.updateSettings(patch);
      await reload();
    };
    const portability: AppContextValue['portability'] = canEdit ? masterPortability : {
      readBundle: async () => (viewerSnap ? snapshotToBundle(viewerSnap).bundle : { flights: [], fstd: [], experience: [] }),
      snapshot: async () => { if (!viewerSnap) throw new Error('No logbook has been loaded from Google Drive yet.'); return viewerSnap; },
      apply: viewerRefusal, replace: viewerRefusal,
    };
    return { data, repo, writer: canEdit ? repo : null, canEdit, updateSettings, airports, onlinePhotos, portability, drive: { controller: drive, state: driveState }, reload, go };
  }, [data, reload, go, viewerSnap, driveState]);

  if (loadError) {
    return (
      <div className="content">
        <div className="empty">
          <h2>Could not open the logbook database</h2>
          <p>{loadError}</p>
          <p className="hint">Nothing has been changed or deleted. Reload the page; if this persists, do not clear site data.</p>
        </div>
      </div>
    );
  }
  if (!ctx || !data) return null;

  if (!data.settings.setupDone) {
    return <AppContext.Provider value={ctx}><SetupScreen /></AppContext.Provider>;
  }

  const flightId = route.name === 'flight' || route.name === 'edit' ? route.id : undefined;
  const flight = flightId ? data.flights.find((f) => f.id === flightId) : undefined;
  const missing = flightId !== undefined && !flight;

  let title = 'FlightBook';
  let back = false;
  let body: React.ReactNode;
  let showFab = false;
  let contentWide = false;

  const notMaster = <ReadOnlyNotice />;
  let showNav = false;

  if (route.name === 'settings') {
    title = 'Settings'; back = true; body = <SettingsScreen />;
  } else if (route.name === 'export') {
    title = 'Export & backup'; back = true; body = <ExportScreen />;
  } else if (route.name === 'totals') {
    title = 'Totals'; showNav = true; body = <TotalsScreen />;
  } else if (route.name === 'map') {
    title = 'Map'; showNav = true; body = <Suspense fallback={<div className="empty"><p className="hint">Loading the map…</p></div>}><MapScreen /></Suspense>;
  } else if (route.name === 'currency') {
    title = 'Currency'; showNav = true; body = <CurrencyScreen />;
  } else if (route.name === 'fstd') {
    title = 'Simulator sessions'; back = true; body = <FstdList />;
  } else if (route.name === 'fstd-new') {
    title = 'New simulator session'; back = true; body = ctx.canEdit ? <FstdForm key="fstd-new" /> : notMaster;
  } else if (route.name === 'fstd-edit') {
    const s = data.fstd.find((x) => x.id === route.id);
    title = 'Edit simulator session'; back = true;
    body = !s ? <NotFound what="session" /> : ctx.canEdit ? <FstdForm key={`fstd-${s.id}`} session={s} /> : notMaster;
  } else if (route.name === 'experience') {
    title = 'Previous experience'; back = true; body = <ExperienceList />;
  } else if (route.name === 'experience-new') {
    title = 'New previous experience'; back = true; body = ctx.canEdit ? <ExperienceForm key="exp-new" /> : notMaster;
  } else if (route.name === 'experience-edit') {
    const e = data.previousExperience.find((x) => x.id === route.id);
    title = 'Edit previous experience'; back = true;
    body = !e ? <NotFound what="record" /> : ctx.canEdit ? <ExperienceForm key={`exp-${e.id}`} record={e} /> : notMaster;
  } else if (route.name === 'new') {
    title = 'New flight'; back = true; body = ctx.canEdit ? <FlightFormScreen key="new" /> : notMaster;
  } else if (route.name === 'edit') {
    title = 'Edit flight'; back = true;
    // keyed so a form's state can never leak into another flight's form (state is initialised once per mount)
    body = missing ? <NotFound what="flight" /> : ctx.canEdit ? <FlightFormScreen key={`edit-${flight!.id}`} flight={flight} /> : notMaster;
  } else if (route.name === 'flight' && !wide) {
    title = 'Flight'; back = true;
    body = missing ? <NotFound what="flight" /> : <FlightDetail flight={flight!} onEdit={() => go({ name: 'edit', id: flight!.id })} />;
  } else {
    // list (and, on wide screens, list + detail side by side using the same components)
    showNav = true;
    showFab = ctx.canEdit;
    contentWide = wide;
    const list = <FlightList selectedId={flightId} onOpen={(id) => go({ name: 'flight', id })} />;
    body = wide ? (
      <div className="split">
        <div>{list}</div>
        <div className="detail-pane">
          {flight ? <FlightDetail flight={flight} onEdit={() => go({ name: 'edit', id: flight.id })} />
            : <div className="empty">Select a flight to see its details.</div>}
        </div>
      </div>
    ) : list;
  }
  if (showNav && wide) contentWide = true;

  // A viewer with nothing loaded yet sees a status screen on the main routes instead of an empty logbook.
  const gated = !data.settings.isMaster && !viewerSnap && ['list', 'flight', 'totals', 'currency', 'map'].includes(route.name);
  if (gated) { body = <ViewerGate />; showFab = false; }

  return (
    <AppContext.Provider value={ctx}>
      <div className={`app${showNav ? ' has-nav' : ''}${route.name === 'map' && !gated ? ' map-fixed' : ''}`}>
        <header className="topbar">
          {back && <button type="button" className="icon-btn back" aria-label="Back" onClick={() => go(parentRoute(route) ?? { name: 'list' }, { replace: true })}><BackIcon /></button>}
          <h1>{title}</h1>
          {showNav && wide && <NavBar route={route} go={go} />}
          {!back && !data.settings.isMaster && <span className="chip">Read-only</span>}
          {(!back || route.name === 'totals' || route.name === 'currency' || route.name === 'map') && <button type="button" className="icon-btn" aria-label="Settings" onClick={() => go({ name: 'settings' })}><SettingsIcon /></button>}
          {route.name === 'flight' && wide && ctx.canEdit && flight && (
            <button type="button" className="icon-btn" aria-label="Edit flight" onClick={() => go({ name: 'edit', id: flight.id })}><EditIcon /></button>
          )}
        </header>
        <main className={`content${contentWide ? ' wide' : ''}${route.name === 'map' && !gated ? ' fill' : ''}`}>
          {!gated && <DriveBanners hiddenRecords={viewerRecords?.hidden ?? 0} />}
          {body}
        </main>
        {showNav && !wide && <NavBar route={route} go={go} />}
        {showFab && (
          <button type="button" className="fab" aria-label="New flight" onClick={() => go({ name: 'new' })}><PlusIcon /></button>
        )}
        {updateApply && <Snackbar message="A new version is available." action="Update" onAction={updateApply} />}
      </div>
    </AppContext.Provider>
  );
}

const ReadOnlyNotice = () => <div className="empty">This device is not the master logbook, so editing is disabled.</div>;
const NotFound = ({ what }: { what: string }) => <div className="empty">This {what} no longer exists.</div>;
