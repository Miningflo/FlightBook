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
