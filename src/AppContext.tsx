import { createContext, useContext } from 'react';
import type { Aircraft, Flight, FstdSession, Person, PreviousExperience, Settings } from './domain/types';
import type { LogbookRepository, WritableLogbookRepository } from './db/repository';
import type { Route } from './hooks';
import type { OnlinePhotoStore } from './features/photos/photoStore';
import type { AirportStore } from './features/airports/airportStore';
import type { ImportBundle } from './domain/records';
import type { Snapshot } from './domain/snapshot';
import type { ConflictPolicy, ImportPlan } from './domain/importPlan';
import type { ImportExtras, ImportResult } from './db/importer';

export interface AppData {
  flights: Flight[];
  aircraft: Aircraft[];
  persons: Person[];
  fstd: FstdSession[];
  previousExperience: PreviousExperience[];
  settings: Settings;
}

export interface AppContextValue {
  data: AppData;
  repo: LogbookRepository;
  /** Present only on the master device. Edit UI must be gated on `canEdit`. */
  writer: WritableLogbookRepository | null;
  canEdit: boolean;
  /**
   * Device-local settings (role, device name, theme). Always writable, because they
   * are not logbook data and must work before this device has been made master.
   */
  updateSettings: (patch: Partial<Omit<Settings, 'key'>>) => Promise<void>;
  /** Reading the whole logbook for export, and applying imports atomically. */
  portability: {
    readBundle: () => Promise<ImportBundle>;
    snapshot: () => Promise<Snapshot>;
    apply: (plan: ImportPlan, policy: ConflictPolicy, extras?: ImportExtras) => Promise<ImportResult>;
  };
  /** Airports reference data (OurAirports), used to compute night time. */
  airports: AirportStore;
  /** Device-local online photo lookup + cache (not logbook data). */
  onlinePhotos: OnlinePhotoStore;
  reload: () => Promise<void>;
  go: (r: Route) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp outside provider');
  return v;
}
