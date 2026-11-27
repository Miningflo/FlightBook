import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogbookDB } from './db';
import { DexieRepository } from './repository';
import { masterPortability } from './portability';
import { clearPendingChange, readPendingChange } from './changes';
import { planImport } from '../domain/importPlan';
import { toFlightImport } from '../domain/records';
import { emptyExperience } from '../domain/experience';
import { flight } from '../domain/testFactories';
import { emptyForm, formToFlightInput, updateForm } from '../domain/flightForm';
import type { Person } from '../domain/types';

const self: Person = { id: 'p', name: 'SELF', nameKey: 'self', isSelf: true, createdAt: 1, updatedAt: 1 };
const input = () => formToFlightInput(updateForm(emptyForm({ today: '2025-06-01', picName: 'SELF' }), { depClock: '09:00', arrClock: '10:00', depPlace: 'EBOS', arrPlace: 'EBAW', registration: 'OO-ABC', make: 'Cessna', model: '172' }));

let n = 0; let db: LogbookDB; let repo: DexieRepository; let scheduled = 0;
const portability = () => masterPortability(db, () => scheduled++);
beforeEach(async () => { db = new LogbookDB(`chg-${++n}`); await db.open(); repo = new DexieRepository(db); scheduled = 0; });
afterEach(async () => { db.close(); await db.delete(); });

/** Run a change and say whether it left a new "not backed up" marker. */
async function marks(change: () => Promise<unknown>): Promise<boolean> {
  const before = await readPendingChange(db);
  await change();
  const after = await readPendingChange(db);
  return after !== null && after !== before;
}

describe('every change to the logbook is marked as not backed up', () => {
  it('flights, simulator sessions and previous experience: saving and deleting', async () => {
    let flightId = '', simId = '', expId = '';
    expect(await marks(async () => { flightId = (await repo.saveFlight(input())).id; })).toBe(true);
    expect(await marks(() => repo.deleteFlight(flightId))).toBe(true);
    expect(await marks(async () => { simId = (await repo.saveFstd({ date: '2025-01-01', fstdType: 'FNPT II', totalMin: 60, remarks: '' })).id; })).toBe(true);
    expect(await marks(() => repo.deleteFstd(simId))).toBe(true);
    expect(await marks(async () => { expId = (await repo.savePreviousExperience({ ...emptyExperience('2024-12-31'), source: 'Vol. 1' })).id; })).toBe(true);
    expect(await marks(() => repo.deletePreviousExperience(expId))).toBe(true);
  });
  it('licence data, but not device settings', async () => {
    expect(await marks(() => repo.updateSettings({ irExpiry: '2027-01-01' }))).toBe(true);
    expect(await marks(() => repo.updateSettings({ theme: 'dark', deviceName: 'x', lastBackupAt: 5 }))).toBe(false);
  });
  it('an import and a restore, which also schedule a backup', async () => {
    const plan = planImport({ flights: [toFlightImport(flight('2025-01-01'), [self])], fstd: [], experience: [] }, { flights: [], fstd: [], experience: [] });
    expect(await marks(() => portability().apply(plan, 'skip'))).toBe(true);
    expect(scheduled).toBe(1);
    const snapshot = await portability().snapshot();
    expect(await marks(() => portability().replace(snapshot))).toBe(true);
    expect(scheduled).toBe(2);
  });
  it('an import that writes nothing changes nothing', async () => {
    const empty = planImport({ flights: [], fstd: [], experience: [] }, { flights: [], fstd: [], experience: [] });
    expect(await marks(() => portability().apply(empty, 'skip', { settings: {} }))).toBe(false);
    expect(scheduled).toBe(0);
  });
  it('the marker stays on this device: it is not part of a backup', async () => {
    await repo.saveFlight(input());
    expect(JSON.stringify(await portability().snapshot())).not.toContain('pendingChange');
  });
  it('is cleared only by the backup that read the same marker', async () => {
    await repo.updateSettings({ irExpiry: '2027-01-01' });
    const read = (await readPendingChange(db))!;
    await repo.updateSettings({ irExpiry: '2027-02-02' }); // while the backup runs
    await clearPendingChange(db, read);
    expect(await readPendingChange(db)).not.toBeNull();
    await clearPendingChange(db, (await readPendingChange(db))!);
    expect(await readPendingChange(db)).toBeNull();
  });
});

describe('settings saved at the same moment', () => {
  it('both survive', async () => {
    await Promise.all([repo.updateSettings({ irExpiry: '2027-01-01' }), repo.updateSettings({ lastBackupAt: 123 }), repo.updateSettings({ theme: 'dark' })]);
    expect(await db.settings.get('main')).toMatchObject({ irExpiry: '2027-01-01', lastBackupAt: 123, theme: 'dark' });
  });
});
