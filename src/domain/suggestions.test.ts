import { describe, expect, it } from 'vitest';
import {
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
