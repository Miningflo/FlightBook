import { describe, expect, it } from 'vitest';
import {
  filterSuggestions,
  recentPlaces,
  defaultsFromHistory,
  findAircraftByRegistration,
  normalizeRegistration,
  personKey,
  recentAircraft,
  recentPersons,
} from './suggestions';
import type { Aircraft, Flight, Person } from './types';

const ac = (id: string, registration: string): Aircraft =>
  ({ id, registration, make: 'M', model: 'X', variant: '', engineClass: 'SP-SE', classRating: 'SEP_LAND', createdAt: 0, updatedAt: 0 });
const pe = (id: string, name: string, isSelf = false): Person => ({ id, name, nameKey: personKey(name), isSelf, createdAt: 0, updatedAt: 0 });
const fl = (id: string, dep: number, aircraftId: string, picNameId: string, arrPlace = 'EBAW'): Flight =>
  ({ id, depTimeUtc: dep, createdAt: dep, aircraftId, picNameId, arrPlace, registration: 'R' } as Flight);

describe('suggestions', () => {
  it('normalises registrations and names', () => {
    expect(normalizeRegistration(' oo -abc ')).toBe('OO-ABC');
    expect(personKey('  John   SMITH ')).toBe('john smith');
  });
  it('finds aircraft by registration case-insensitively', () => {
    const list = [ac('1', 'OO-ABC')];
    expect(findAircraftByRegistration(list, 'oo-abc')?.id).toBe('1');
    expect(findAircraftByRegistration(list, '')).toBeUndefined();
    expect(findAircraftByRegistration(list, 'OO-ZZZ')).toBeUndefined();
  });
  it('orders aircraft and people by recent use, then alphabetically', () => {
    const aircraft = [ac('a', 'OO-AAA'), ac('b', 'OO-BBB'), ac('c', 'OO-CCC')];
    const persons = [pe('s', 'SELF', true), pe('j', 'Jane'), pe('k', 'Kim')];
    const flights = [fl('1', 100, 'b', 'j'), fl('2', 200, 'c', 's')];
    expect(recentAircraft(flights, aircraft).map((a) => a.id)).toEqual(['c', 'b', 'a']);
    expect(recentPersons(flights, persons).map((p) => p.id)).toEqual(['s', 'j', 'k']);
  });
  it('defaults a new flight from the latest entry', () => {
    const aircraft = [ac('a', 'OO-AAA'), ac('b', 'OO-BBB')];
    const persons = [pe('s', 'SELF', true), pe('j', 'Jane')];
    const d = defaultsFromHistory([fl('1', 100, 'a', 's'), fl('2', 200, 'b', 'j', 'EBOS')], aircraft, persons);
    expect(d).toEqual({ registration: 'OO-BBB', picName: 'Jane', depPlace: 'EBOS' });
  });
  it('defaults to SELF with no history', () => {
    expect(defaultsFromHistory([], [], [pe('s', 'SELF', true)]).picName).toBe('SELF');
  });
});

describe('recentPlaces', () => {
  const f = (dep: number, depPlace: string, arrPlace: string) => ({ id: String(dep), depTimeUtc: dep, createdAt: dep, depPlace, arrPlace } as Flight);
  it('lists each place once, most recent first, arrival before departure', () => {
    expect(recentPlaces([f(1, 'EBOS', 'EBAW'), f(2, 'EBAW', 'EBKT'), f(3, 'EBKT', 'EBOS')])).toEqual(['EBOS', 'EBKT', 'EBAW']);
  });
  it('normalises case and spacing, skips empties, and respects the limit', () => {
    expect(recentPlaces([f(1, ' ebos ', ''), f(2, 'ebaw', 'EBOS')])).toEqual(['EBOS', 'EBAW']);
    const many = Array.from({ length: 20 }, (_, i) => f(i + 1, `AA${String(i).padStart(2, '0')}`, `BB${String(i).padStart(2, '0')}`));
    expect(recentPlaces(many, 5)).toHaveLength(5);
    expect(recentPlaces([])).toEqual([]);
  });
});

describe('filterSuggestions', () => {
  const fleet = [
    { reg: 'OO-ABC', text: 'OO-ABC Cessna 172S' },
    { reg: 'PH-LDF', text: 'PH-LDF Piper PA-28' },
    { reg: 'N172SP', text: 'N172SP Cessna 172SP' },
    { reg: 'OO-DEF', text: 'OO-DEF Diamond DA40' },
  ];
  const f = (q: string, limit?: number) => filterSuggestions(fleet, q, (x) => x.text, limit).map((x) => x.reg);
  it('an empty or blank query returns the list as it is (most recent first), up to the limit', () => {
    expect(f('')).toEqual(['OO-ABC', 'PH-LDF', 'N172SP', 'OO-DEF']);
    expect(f('   ', 2)).toEqual(['OO-ABC', 'PH-LDF']);
  });
  it('matches anywhere, in any case, and all words must match', () => {
    expect(f('cessna')).toEqual(['OO-ABC', 'N172SP']);
    expect(f('CESSNA 172SP')).toEqual(['N172SP']);
    expect(f('da40 oo')).toEqual(['OO-DEF']);
    expect(f('zzz')).toEqual([]);
  });
  it('puts matches that start with the first word first, keeping recency order otherwise', () => {
    expect(f('oo')).toEqual(['OO-ABC', 'OO-DEF']);
    expect(f('172')).toEqual(['N172SP', 'OO-ABC'].sort((a, b) => ['OO-ABC', 'N172SP'].indexOf(a) - ['OO-ABC', 'N172SP'].indexOf(b)));
    expect(f('n17')).toEqual(['N172SP']);
  });
  it('copes with hundreds of entries and respects the limit', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ t: `OO-${String(i).padStart(3, '0')} Cessna 172` }));
    expect(filterSuggestions(many, 'oo-4', (x) => x.t, 40)).toHaveLength(40);
    expect(filterSuggestions(many, 'oo-499', (x) => x.t)).toEqual([{ t: 'OO-499 Cessna 172' }]);
    expect(filterSuggestions(many, '', (x) => x.t, 40)).toHaveLength(40);
  });
});
