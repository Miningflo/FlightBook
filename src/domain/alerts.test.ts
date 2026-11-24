import { describe, expect, it } from 'vitest';
import { alertOutcome, watchedItems, type AlertItem } from './alerts';
import { flight } from './testFactories';

const today = '2025-06-30';
const item = (key: string, level: AlertItem['level']): AlertItem => ({ key, level, title: key, body: '' });

describe('alertOutcome', () => {
  it('remembers everything without notifying on the first run', () => {
    expect(alertOutcome([item('a', 'red'), item('b', 'green')], undefined)).toEqual({ fresh: [], state: { a: 'red', b: 'green' } });
  });
  it('notifies only when a level gets worse, worst first', () => {
    const r = alertOutcome([item('a', 'amber'), item('b', 'expired'), item('c', 'green'), item('d', 'red')], { a: 'green', b: 'red', c: 'green', d: 'red' });
    expect(r.fresh.map((i) => i.key)).toEqual(['b', 'a']);
  });
  it('does not repeat, and re-arms after an improvement', () => {
    const first = alertOutcome([item('a', 'amber')], { a: 'green' });
    expect(first.fresh).toHaveLength(1);
    expect(alertOutcome([item('a', 'amber')], first.state).fresh).toHaveLength(0);
    const better = alertOutcome([item('a', 'green')], first.state);
    expect(better.state).toEqual({ a: 'green' });
    expect(alertOutcome([item('a', 'red')], better.state).fresh).toHaveLength(1);
  });
  it('treats an item with no earlier level as new, not as worse', () => {
    expect(alertOutcome([item('a', 'red')], { b: 'green' }).fresh).toEqual([]);
  });
});

describe('watchedItems', () => {
  it('watches currency only for classes that were flown, and ratings that have an expiry date', () => {
    const items = watchedItems([flight(today, { takeoffsDay: 3, landingsDay: 3 })], { classExpiry: { SET_LAND: '2025-08-15' } }, today);
    expect(items.map((i) => i.key).sort()).toEqual(['SEP_LAND:night', 'SEP_LAND:passengers', 'SET_LAND:rating']);
  });
  it('can leave night currency out', () => {
    const items = watchedItems([flight(today)], { alerts: { enabled: true, night: false } }, today);
    expect(items.map((i) => i.key)).toEqual(['SEP_LAND:passengers']);
  });
  it('maps a proficiency check window, an urgent rating and an expired rating to amber, red and expired', () => {
    const level = (expiry: string) => watchedItems([], { classExpiry: { MEP_LAND: expiry } }, today)[0]!.level;
    expect(level('2025-08-15')).toBe('amber');
    expect(level('2025-07-20')).toBe('red');
    expect(level('2025-06-01')).toBe('expired');
    expect(level('2026-06-01')).toBe('green');
  });
  it('a currency that is about to lapse is amber, and lapsed is red', () => {
    const lapsing = watchedItems([flight('2025-04-10', { takeoffsDay: 3, landingsDay: 3 })], { alerts: { enabled: true, night: false } }, today)[0]!;
    expect(lapsing.level).toBe('amber');
    const lapsed = watchedItems([flight('2025-01-10', { takeoffsDay: 3, landingsDay: 3 })], { alerts: { enabled: true, night: false } }, today)[0]!;
    expect(lapsed.level).toBe('red');
  });
});

describe('SEP rating alert once the requirements are met', () => {
  const expiry = '2025-07-20'; // 20 days after today
  const enough = [flight('2025-01-15', { totalMin: 720, picMin: 360, dualMin: 60, takeoffsDay: 12, landingsDay: 12 })];
  const rating = (e: string) => watchedItems(enough, { sepLandExpiry: e, alerts: { enabled: true, night: false } }, today).find((i) => i.key === 'SEP_LAND:rating')!;
  it('is green while there is time to have the revalidation entered', () => {
    expect(rating('2025-09-30').level).toBe('green');
  });
  it('turns amber near expiry instead of staying green until it expires', () => {
    const i = rating(expiry);
    expect(i.level).toBe('amber');
    expect(i.title).toBe('SEP (land) rating expires in 20 days');
    expect(i.body).toMatch(/requirements are met.*entered in your licence/);
  });
  it('notifies on the change from green to amber, so the reminder is not silent', () => {
    const before = alertOutcome([rating('2025-09-30')], undefined).state;
    expect(alertOutcome([{ ...rating(expiry) }], before).fresh.map((i) => i.key)).toEqual(['SEP_LAND:rating']);
  });
});

describe('watchedItems and the instrument rating', () => {
  const flown = [flight(today, { takeoffsNight: 0, landingsNight: 0 })];
  it('stops watching night currency while a valid IR is held', () => {
    const keys = (s: Parameters<typeof watchedItems>[1]) => watchedItems(flown, s, today).map((i) => i.key);
    expect(keys({})).toContain('SEP_LAND:night');
    expect(keys({ irExpiry: '2027-01-01' })).not.toContain('SEP_LAND:night');
  });
  it('watches it again once the IR has expired', () => {
    expect(watchedItems(flown, { irExpiry: '2025-01-01' }, today).map((i) => i.key)).toContain('SEP_LAND:night');
  });
  it('watches the IR itself, and only when a date is set', () => {
    expect(watchedItems([], {}, today).map((i) => i.key)).not.toContain('IR:rating');
    const level = (e: string) => watchedItems([], { irExpiry: e }, today).find((i) => i.key === 'IR:rating')!.level;
    expect(level('2027-06-01')).toBe('green');
    expect(level('2025-08-15')).toBe('amber');
    expect(level('2025-07-20')).toBe('red');
    expect(level('2025-06-01')).toBe('expired');
  });
  it('says night currency applies again when the IR expires', () => {
    const item = watchedItems([], { irExpiry: '2025-06-01' }, today).find((i) => i.key === 'IR:rating')!;
    expect(item.body).toMatch(/night currency now applies again/i);
  });
});

describe('licence documents in the alerts', () => {
  const lvl = (e: string) => watchedItems([], { medicalExpiry: e }, today).find((i) => i.key === 'MEDICAL')!.level;
  it('watches the medical only when a date is set', () => {
    expect(watchedItems([], {}, today).map((i) => i.key)).not.toContain('MEDICAL');
    expect(lvl('2027-01-01')).toBe('green');
    expect(lvl('2025-08-15')).toBe('amber');
    expect(lvl('2025-07-20')).toBe('red');
    expect(lvl('2025-06-01')).toBe('expired');
  });
  it('says plainly that an expired medical grounds you', () => {
    const m = watchedItems([], { medicalExpiry: '2025-06-01' }, today).find((i) => i.key === 'MEDICAL')!;
    expect(m.body).toMatch(/may not fly/i);
  });
  it('never watches a level 6 language endorsement, which does not expire', () => {
    expect(watchedItems([], { languageLevel: 6 }, today).map((i) => i.key)).not.toContain('LANGUAGE');
    expect(watchedItems([], { languageLevel: 4, languageExpiry: '2025-06-01' }, today).map((i) => i.key)).toContain('LANGUAGE');
  });
});

describe('type ratings in the alerts', () => {
  const t = (id: string, name: string, expiry: string) => ({ id, name, expiry });
  it('watches one item per rating, keyed by id so a rename is not a new rating', () => {
    const items = watchedItems([], { typeRatings: [t('a', 'B737 300-900', '2025-08-15'), t('b', 'BE20', '2027-01-01')] }, today);
    expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(['TYPE:a', 'TYPE:b']));
    expect(items.find((i) => i.key === 'TYPE:a')!.level).toBe('amber');
    expect(items.find((i) => i.key === 'TYPE:b')!.level).toBe('green');
    const renamed = watchedItems([], { typeRatings: [t('a', 'Boeing 737', '2025-08-15')] }, today);
    expect(renamed[0]!.key).toBe('TYPE:a'); // same key, so the alert does not re-fire
  });
  it('names the rating in the alert, so several are tellable apart', () => {
    const i = watchedItems([], { typeRatings: [t('a', 'BE20', '2025-06-01')] }, today)[0]!;
    expect(i.level).toBe('expired');
    expect(i.title).toContain('BE20');
  });
  it('watches nothing when none are held', () => {
    expect(watchedItems([], { typeRatings: [] }, today).map((i) => i.key)).not.toContain('TYPE:a');
  });
});

describe('MEP route sectors in the rating alert', () => {
  const expiry = '2026-06-01';              // validity window runs 2025-06-02 .. 2026-06-01
  const mep = (d: string, away = true) => ({ ...flight(d), aircraftClass: 'MEP_LAND' as const, depPlace: 'EBKT', arrPlace: away ? 'EBOS' : 'EBKT' });
  const level = (flights: ReturnType<typeof mep>[], on: string) =>
    watchedItems(flights, { classExpiry: { MEP_LAND: expiry } as never }, on).find((i) => i.key === 'MEP_LAND:rating')!;

  it('stays quiet through the first half of the validity period', () => {
    expect(level([], '2025-09-01').level).toBe('green'); // ~25% gone, no sectors yet: a slow start is normal
  });
  it('goes amber once past halfway and behind the pace', () => {
    const a = level([], '2026-01-01'); // ~59% gone, 0 of 10
    expect(a.level).toBe('amber');
    expect(a.title).toMatch(/route sectors behind/i);
    expect(a.body).toMatch(/0 of 10 route sectors/);
  });
  it('stays green when the sectors are keeping pace', () => {
    const onPace = Array.from({ length: 7 }, (_, i) => mep(`2025-1${i % 2}-0${(i % 9) + 1}`));
    expect(level(onPace, '2026-01-01').level).toBe('green');
  });
  it('stays green once the requirement is met outright', () => {
    const ten = Array.from({ length: 10 }, (_, i) => mep(`2025-08-${String(i + 1).padStart(2, '0')}`));
    expect(level(ten, '2026-01-01').level).toBe('green');
  });
  it('still goes amber when the check window opens, sectors met or not', () => {
    const ten = Array.from({ length: 10 }, (_, i) => mep(`2025-08-${String(i + 1).padStart(2, '0')}`));
    const a = level(ten, '2026-05-01'); // inside the 3-month check window
    expect(a.level).toBe('amber');
    expect(a.title).toMatch(/proficiency check due/i); // the check, not the sectors
  });
  it('mentions the wider reading when local flights would have met it', () => {
    const local = Array.from({ length: 12 }, (_, i) => mep(`2025-08-${String(i + 1).padStart(2, '0')}`, false));
    const a = level(local, '2026-01-01');
    expect(a.level).toBe('amber');
    expect(a.body).toMatch(/12 if local flights count/);
  });
  it('does not override a check-window warning that is already more urgent', () => {
    expect(level([], '2026-05-25').level).toBe('red'); // inside the 30-day red threshold
  });
});

describe('per-type currency (FCL.060 counts per "type or class")', () => {
  const t = { id: 't', name: 'B737', expiry: '2027-06-01' };
  const other = (d: string, typeRatingId: string | null) => ({ ...flight(d), aircraftClass: 'OTHER' as const, typeRatingId });

  it('watches currency for each type rating that has flights', () => {
    const keys = watchedItems([other(today, 't')], { typeRatings: [t] }, today).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['TYPE:t', 'TYPE:t:passengers', 'TYPE:t:night']));
  });
  it('warns that a valid rating does not make you current', () => {
    const items = watchedItems([other('2025-03-01', 't')], { typeRatings: [t] }, today); // flown, but long ago
    expect(items.find((i) => i.key === 'TYPE:t')!.level).toBe('green');          // the rating is fine
    expect(items.find((i) => i.key === 'TYPE:t:passengers')!.level).toBe('red'); // the currency is not
  });
  it('keeps one type\'s landings out of another\'s currency', () => {
    const u = { id: 'u', name: 'BE20', expiry: '2027-06-01' };
    const current = { ...other(today, 'u'), takeoffsDay: 3, landingsDay: 3 };
    const items = watchedItems([current], { typeRatings: [t, u] }, today);
    expect(items.some((i) => i.key === 'TYPE:t:passengers')).toBe(false); // no B737 flights, so nothing claimed
    expect(items.find((i) => i.key === 'TYPE:u:passengers')!.level).toBe('green'); // the BE20 landings count only here
  });
  it('names flights that belong to no rating instead of dropping them', () => {
    const i = watchedItems([other(today, null)], { typeRatings: [t] }, today).find((x) => x.key === 'TYPE:unassigned')!;
    expect(i.level).toBe('amber');
    expect(i.title).toMatch(/not counted towards any rating/);
  });
  it('counts a flight whose rating has been removed as unassigned, not as nothing', () => {
    const items = watchedItems([{ ...other(today, 'removed'), takeoffsDay: 3, landingsDay: 3 }], { typeRatings: [t] }, today);
    expect(items.find((x) => x.key === 'TYPE:unassigned')!.title).toMatch(/^1 flight not counted/);
    expect(items.some((x) => x.key.startsWith('TYPE:removed'))).toBe(false);
  });
  it('flags orphaned flights even when no type ratings are left at all', () => {
    expect(watchedItems([other(today, 'removed')], { typeRatings: [] }, today).map((i) => i.key)).toContain('TYPE:unassigned');
  });
  it('says nothing about unassigned flights when there are none', () => {
    expect(watchedItems([other(today, 't')], { typeRatings: [t] }, today).map((i) => i.key)).not.toContain('TYPE:unassigned');
  });
});
