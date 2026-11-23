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
