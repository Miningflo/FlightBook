import type { AppContextValue } from '../AppContext';
import type { LogbookDB } from './db';
import { applyImport, applyReplace, importChanged, readBundle } from './importer';
import { snapshotFromDb } from '../features/export/backup';

/**
 * Export, import and restore on the master device. Import and restore write to the database directly, not
 * through the repository, so `onChange` (schedule a Drive backup) has to be called here.
 */
export function masterPortability(db: LogbookDB, onChange: () => void): AppContextValue['portability'] {
  return {
    readBundle: () => readBundle(db),
    snapshot: () => snapshotFromDb(db),
    apply: async (...args) => {
      const result = await applyImport(db, ...args);
      if (importChanged(result)) onChange();
      return result;
    },
    replace: async (snapshot) => {
      const result = await applyReplace(db, snapshot);
      onChange();
      return result;
    },
  };
}
