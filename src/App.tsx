import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, type AppContextValue, type AppData } from './AppContext';
import { LogbookDB } from './db/db';
import { DexieRepository } from './db/repository';
import { OnlinePhotoStore } from './features/photos/photoStore';
import { AirportStore } from './features/airports/airportStore';
import { applyImport, readBundle } from './db/importer';
import { snapshotFromDb } from './features/export/backup';
import { ExportScreen } from './features/export/ExportScreen';
import { useMediaQuery, useRoute } from './hooks';
import { registerServiceWorker } from './pwa/register';
import { newestFirst } from './domain/suggestions';
import { BackIcon, EditIcon, PlusIcon, SettingsIcon } from './ui/Icons';
import { Snackbar } from './ui/components';
import { NavBar } from './ui/NavBar';
import { TotalsScreen } from './features/totals/TotalsScreen';
import { CurrencyScreen } from './features/currency/CurrencyScreen';
import { FstdForm, FstdList } from './features/fstd/FstdScreens';
import { ExperienceForm, ExperienceList } from './features/experience/ExperienceScreens';
import { FlightList } from './features/flights/FlightList';
import { FlightDetail } from './features/flights/FlightDetail';
import { FlightFormScreen } from './features/flights/FlightFormScreen';
import { SettingsScreen, SetupScreen } from './features/settings/SettingsScreen';

const db = new LogbookDB();
const repo = new DexieRepository(db);
const onlinePhotos = new OnlinePhotoStore(db);
const airports = new AirportStore(db);
const portability = {
  readBundle: () => readBundle(db),
  snapshot: () => snapshotFromDb(db),
  apply: (...args: Parameters<typeof applyImport> extends [unknown, ...infer R] ? R : never) => applyImport(db, ...args),
};

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [route, go] = useRoute();
  const [updateApply, setUpdateApply] = useState<(() => void) | null>(null);
  const wide = useMediaQuery('(min-width: 900px)');

  const reload = useCallback(async () => {
    const [flights, aircraft, persons, fstd, previousExperience, settings] = await Promise.all([
      repo.listFlights(), repo.listAircraft(), repo.listPersons(), repo.listFstd(), repo.listPreviousExperience(), repo.getSettings(),
    ]);
    setData({ flights: newestFirst(flights), aircraft, persons, fstd, previousExperience, settings });
  }, []);

  useEffect(() => {
    reload().catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    registerServiceWorker((apply) => setUpdateApply(() => apply));
  }, [reload]);

  // Theme preference is applied on <html>; "system" leaves the OS to decide.
  useEffect(() => {
    const t = data?.settings.theme ?? 'system';
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, [data?.settings.theme]);

  const ctx = useMemo<AppContextValue | null>(() => {
    if (!data) return null;
    const canEdit = data.settings.isMaster;
    const updateSettings = async (patch: Parameters<typeof repo.updateSettings>[0]) => {
      await repo.updateSettings(patch);
      await reload();
    };
    return { data, repo, writer: canEdit ? repo : null, canEdit, updateSettings, airports, onlinePhotos, portability, reload, go };
  }, [data, reload, go]);

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

  return (
    <AppContext.Provider value={ctx}>
      <div className={`app${showNav ? ' has-nav' : ''}`}>
        <header className="topbar">
          {back && <button type="button" className="icon-btn back" aria-label="Back" onClick={() => history.length > 1 ? history.back() : go({ name: 'list' })}><BackIcon /></button>}
          <h1>{title}</h1>
          {showNav && wide && <NavBar route={route} go={go} />}
          {!back && !data.settings.isMaster && <span className="chip">Read-only</span>}
          {(!back || route.name === 'totals' || route.name === 'currency') && <button type="button" className="icon-btn" aria-label="Settings" onClick={() => go({ name: 'settings' })}><SettingsIcon /></button>}
          {route.name === 'flight' && wide && ctx.canEdit && flight && (
            <button type="button" className="icon-btn" aria-label="Edit flight" onClick={() => go({ name: 'edit', id: flight.id })}><EditIcon /></button>
          )}
        </header>
        <main className={`content${contentWide ? ' wide' : ''}`}>{body}</main>
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
