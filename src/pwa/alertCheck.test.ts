import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogbookDB } from '../db/db';
import { flight } from '../domain/testFactories';
import { checkAlerts } from './alertCheck';
import type { AlertItem } from '../domain/alerts';
import type { Settings } from '../domain/types';

let n = 0;
let db: LogbookDB;
beforeEach(() => { db = new LogbookDB(`alerts-${++n}`); });
afterEach(async () => { db.close(); await db.delete(); });

const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const setup = async (patch: Partial<Settings>) => {
  await db.settings.toCollection().modify(patch);
};
async function sent(now: string, seed = false) {
  const out: AlertItem[] = [];
  await checkAlerts(db, async (i) => { out.push(i); }, at(now), seed);
  return out;
}

describe('checkAlerts', () => {
  beforeEach(async () => {
    await db.open();
    await db.flights.add(flight('2025-04-10', { takeoffsDay: 3, landingsDay: 3 }));
  });

  it('does nothing unless this is the master and alerts are on', async () => {
    await setup({ isMaster: true });
    expect(await sent('2025-06-30')).toEqual([]);
    await setup({ isMaster: false, alerts: { enabled: true, night: false } });
    expect(await sent('2025-06-30')).toEqual([]);
  });

  it('notifies once when a currency goes amber and again only when it goes red', async () => {
    await setup({ isMaster: true, alerts: { enabled: true, night: false } });
    expect(await sent('2025-06-01', true)).toEqual([]); // turned on: seeded as green
    expect(await sent('2025-06-02')).toEqual([]);
    const amber = await sent('2025-06-30');
    expect(amber.map((i) => [i.key, i.level])).toEqual([['SEP_LAND:passengers', 'amber']]);
    expect(await sent('2025-07-01')).toEqual([]); // same level: no repeat
    const red = await sent('2025-07-20');
    expect(red.map((i) => i.level)).toEqual(['red']);
  });

  it('notifies when a rating expires', async () => {
    await setup({ isMaster: true, alerts: { enabled: true, night: false }, classExpiry: { SET_LAND: '2025-07-01' } });
    await sent('2025-06-01', true);
    const out = await sent('2025-07-05');
    expect(out.find((i) => i.key === 'SET_LAND:rating')?.level).toBe('expired');
  });

  it('remembers the level even if showing the notification fails', async () => {
    await setup({ isMaster: true, alerts: { enabled: true, night: false } });
    await sent('2025-06-01', true);
    await checkAlerts(db, async () => { throw new Error('blocked'); }, at('2025-06-30'));
    expect(await sent('2025-07-01')).toEqual([]);
  });
});
