import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogbookDB } from '../../db/db';
import { DexieRepository } from '../../db/repository';
import { snapshotFromDb } from './backup';
import { parseSnapshot, serializeSnapshot } from '../../domain/snapshot';
import { applyReplace } from '../../db/importer';
import type { Settings } from '../../domain/types';

/**
 * Currencies and rating states are never stored: they are computed from the flights plus the expiry
 * dates in settings. So "is it backed up" really asks whether those dates reach Google Drive. Three
 * things have to be true for each one, and each is easy to forget when a new rating is added:
 * it must be written into the snapshot, it must survive a restore, and changing it must schedule
 * a backup. These tests check all three against the real code rather than a copied list.
 */

/** Every settings field the currency screen computes from. Add a rating, add it here. */
const TRACKED = [
  'sepLandExpiry', 'classExpiry', 'irExpiry',
  'medicalClass', 'medicalExpiry', 'languageLevel', 'languageExpiry', 'typeRatings',
] as const;

const ALL: Partial<Settings> = {
  pilotName: 'A Pilot', licenceNumber: 'BE.FCL.PPL.1', address: 'Street 1',
  sepLandExpiry: '2027-02-26',
  classExpiry: { SEP_SEA: '2027-01-01', TMG: '2027-01-02', MEP_LAND: '2027-01-03', MEP_SEA: '2027-01-04', SET_LAND: '2027-01-05', SET_SEA: '2027-01-06' },
  irExpiry: '2027-02-02',
  medicalClass: 'CLASS2', medicalExpiry: '2026-12-31',
  languageLevel: 4, languageExpiry: '2027-12-28',
  typeRatings: [{ id: 't1', name: 'BE20', expiry: '2027-06-26' }],
};

let n = 0; let db: LogbookDB;
beforeEach(async () => { db = new LogbookDB(`bk-${++n}`); await db.open(); });
afterEach(async () => { db.close(); await db.delete(); });

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

describe('what a currency is computed from reaches Google Drive', () => {
  it('writes every tracked expiry into the snapshot', () => {
    const body = read('src/features/export/backup.ts');
    const from = body.indexOf('settings: {'); // the snapshot literal, not the destructuring above it
    const settingsLine = body.slice(from, body.indexOf('aircraft, persons', from));
    expect(settingsLine.length, 'could not find the snapshot settings literal').toBeGreaterThan(50);
    for (const f of TRACKED) {
      expect(settingsLine, `${f} is tracked but snapshotFromDb does not put it in the snapshot`).toContain(f);
    }
  });

  it('carries them all through a snapshot and back', async () => {
    await db.settings.toCollection().modify(ALL);
    const text = serializeSnapshot(await snapshotFromDb(db));
    await db.settings.toCollection().modify({
      sepLandExpiry: null, classExpiry: {}, irExpiry: null, medicalClass: null, medicalExpiry: null,
      languageLevel: null, languageExpiry: null, typeRatings: [],
    } as Partial<Settings>);
    await applyReplace(db, parseSnapshot(text));
    expect(await db.settings.get('main')).toMatchObject(ALL);
  });

  it('schedules a backup when any one of them changes', async () => {
    for (const f of TRACKED) {
      let wrote = false;
      const repo = new DexieRepository(db, () => { wrote = true; });
      await repo.updateSettings({ [f]: ALL[f] } as Partial<Settings>);
      expect(wrote, `changing ${f} does not schedule a Drive backup`).toBe(true);
    }
  });

  it('does not schedule a backup for a device-local setting', async () => {
    let wrote = false;
    const repo = new DexieRepository(db, () => { wrote = true; });
    await repo.updateSettings({ theme: 'dark' });
    expect(wrote, 'the theme is device-local and must not cost a Drive upload').toBe(false);
  });

  it('keeps the device-local alert settings out of the snapshot', async () => {
    await db.settings.toCollection().modify({ alerts: { enabled: true, night: false }, alertState: { 'SEP_LAND:night': 'red' } } as Partial<Settings>);
    const snap = await snapshotFromDb(db);
    expect(JSON.stringify(snap.settings)).not.toMatch(/alertState|"alerts"/);
  });
});
