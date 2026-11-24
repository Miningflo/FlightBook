import { describe, expect, it } from 'vitest';
import { byClass, classExpiryOf, classExpiryPatch, collectEvents, irStatus, languageStatus, medicalStatus, nightCurrency, nightExemptByIr, passengerCurrency, proficiencyCheckStatus, rolling, routeSectors, sepRevalidation, typeRatingStatus, typeRouteSectors, unassignedTypeFlights, currencyClasses } from './currency';
import { DEFAULT_RULES } from './rules';
import { flight } from './testFactories';
import { addDays } from './time';

const today = '2025-06-30';
const laps = (date: string, n: number, o = {}) => flight(date, { takeoffsDay: n, landingsDay: n, ...o });

describe('rolling', () => {
  it('has no history: lapsed, nothing valid', () => {
    expect(rolling([], 3, 90, today, 14)).toEqual({ count: 0, need: 3, state: 'lapsed', validUntil: null, daysLeft: null });
  });
  it('counts an event for its own day and the next 89 days (conservative 90-day window)', () => {
    const e = addDays(today, -89);
    const r = rolling([e, e, e], 3, 90, today, 14);
    expect(r.count).toBe(3);
    expect(r.validUntil).toBe(today); // last valid day is today
    expect(r.daysLeft).toBe(0);
    expect(r.state).toBe('expiring');
    const tomorrow = rolling([e, e, e], 3, 90, addDays(today, 1), 14);
    expect(tomorrow.state).toBe('lapsed');
    expect(tomorrow.count).toBe(0);
  });
  it('an event exactly 90 days old no longer counts', () => {
    const e = addDays(today, -90);
    const r = rolling([e, e, e], 3, 90, today, 14);
    expect(r.count).toBe(0);
    expect(r.state).toBe('lapsed');
    expect(r.validUntil).toBe(addDays(today, -1));
  });
  it('amber exactly when 14 or fewer days remain', () => {
    const e14 = addDays(today, -75); // valid until today + 14
    expect(rolling([e14, e14, e14], 3, 90, today, 14)).toMatchObject({ daysLeft: 14, state: 'expiring' });
    const e15 = addDays(today, -74);
    expect(rolling([e15, e15, e15], 3, 90, today, 14)).toMatchObject({ daysLeft: 15, state: 'current' });
  });
  it('the Nth most recent event decides when it lapses', () => {
    const dates = [today, today, addDays(today, -60), addDays(today, -100), addDays(today, -100)];
    const r = rolling(dates, 3, 90, today, 14);
    expect(r.count).toBe(3);
    expect(r.validUntil).toBe(addDays(today, 29)); // 3rd most recent is 60 days old
    expect(r.state).toBe('current');
  });
  it('ignores events dated after today', () => {
    const f = addDays(today, 5);
    expect(rolling([f, f, f], 3, 90, today, 14).state).toBe('lapsed');
  });
  it('a requirement of zero is always met', () => {
    expect(rolling([], 0, 90, today, 14).state).toBe('current');
  });
});

describe('passengerCurrency', () => {
  it('is current with three take-offs and three landings today', () => {
    const r = passengerCurrency([laps(today, 3)], byClass('SEP_LAND'), today);
    expect(r).toMatchObject({ status: 'green', state: 'current', validUntil: addDays(today, 89), daysLeft: 89 });
    expect(r.takeoffs.count).toBe(3);
    expect(r.landings.count).toBe(3);
  });
  it('counts every take-off of a flight, day and night together', () => {
    const r = passengerCurrency([flight(today, { takeoffsDay: 1, takeoffsNight: 1, landingsDay: 2, landingsNight: 0 }), laps(addDays(today, -1), 1)], byClass('SEP_LAND'), today);
    expect(r.takeoffs.count).toBe(3);
    expect(r.landings.count).toBe(3);
    expect(r.state).toBe('current');
  });
  it('lapses when take-offs are enough but landings are not (the weaker one wins)', () => {
    const r = passengerCurrency([flight(today, { takeoffsDay: 3, landingsDay: 2 })], byClass('SEP_LAND'), today);
    expect(r.state).toBe('lapsed');
    expect(r.status).toBe('red');
    expect(r.takeoffs.state).toBe('current');
    expect(r.landings.state).toBe('lapsed');
  });
  it('turns amber and reports the earlier of the two lapse dates', () => {
    const r = passengerCurrency([
      flight(addDays(today, -80), { takeoffsDay: 3, landingsDay: 0, arrTimeUtc: Date.parse(`${addDays(today, -80)}T11:00:00Z`) }),
      flight(addDays(today, -10), { takeoffsDay: 0, landingsDay: 3 }),
    ], byClass('SEP_LAND'), today);
    expect(r.status).toBe('amber');
    expect(r.validUntil).toBe(addDays(today, 9)); // take-offs lapse first: -80 + 89
    expect(r.daysLeft).toBe(9);
  });
  it('dates a landing by the arrival day when the flight crosses midnight UTC', () => {
    const f = flight('2025-06-29', {
      depTimeUtc: Date.parse('2025-06-29T23:30:00Z'), arrTimeUtc: Date.parse('2025-06-30T00:10:00Z'),
      takeoffsDay: 1, landingsDay: 1,
    });
    expect(collectEvents([f], byClass('SEP_LAND'), false)).toEqual({ takeoffs: ['2025-06-29'], landings: ['2025-06-30'] });
  });
  it('only counts flights of the selected class', () => {
    const flights = [laps(today, 3), laps(today, 3, { aircraftClass: 'TMG' })];
    expect(passengerCurrency(flights, byClass('TMG'), today).takeoffs.count).toBe(3);
    expect(passengerCurrency(flights, byClass('SEP_LAND'), today).takeoffs.count).toBe(3);
    expect(passengerCurrency(flights, byClass('MEP_LAND'), today).state).toBe('lapsed');
  });
});

describe('nightCurrency', () => {
  it('counts night take-offs and landings only: 1 of each is enough (FCL.060(b)(2))', () => {
    const r = nightCurrency([flight(today, { takeoffsDay: 5, landingsDay: 5, takeoffsNight: 1, landingsNight: 1 })], byClass('SEP_LAND'), today);
    expect(r.takeoffs.count).toBe(1);
    expect(r.state).toBe('current');
  });
  it('day take-offs and landings do not count', () => {
    expect(nightCurrency([flight(today, { takeoffsDay: 5, landingsDay: 5 })], byClass('SEP_LAND'), today).state).toBe('lapsed');
  });
  it('follows the configured requirement, so a corrected rule is a one-line change', () => {
    const rules = { ...DEFAULT_RULES, night: { ...DEFAULT_RULES.night, takeoffs: 3, landings: 3 } };
    expect(nightCurrency([flight(today, { takeoffsNight: 1, landingsNight: 1 })], byClass('SEP_LAND'), today, rules).state).toBe('lapsed');
  });
});

describe('routeSectors (multi-engine)', () => {
  const expiry = '2026-03-31';
  const mep = (date: string) => ({ ...flight(date), aircraftClass: 'MEP_LAND' as const });
  it('counts flights in the class in the 12 months before expiry, both readings of "sector"', () => {
    const r = routeSectors([mep('2025-06-01'), mep('2025-04-01'), mep('2025-03-31'), flight('2025-06-01')], 'MEP_LAND', expiry, '2025-12-01');
    expect(r).toMatchObject({ flights: 2, routeFlights: 2, need: 10, windowStart: '2025-04-01', met: false });
  });
  it('separates flights that landed away from local ones, and the status follows the stricter count', () => {
    const local = (d: string) => ({ ...mep(d), depPlace: 'EBKT', arrPlace: 'EBKT' });
    const away = (d: string) => ({ ...mep(d), depPlace: 'EBKT', arrPlace: 'EBOS' });
    const flights = [...Array.from({ length: 6 }, (_, i) => local(`2025-05-0${i + 1}`)), ...Array.from({ length: 5 }, (_, i) => away(`2025-06-0${i + 1}`))];
    const r = routeSectors(flights, 'MEP_LAND', expiry, '2025-12-01')!;
    expect(r.flights).toBe(11);
    expect(r.routeFlights).toBe(5);
    expect(r.metIfLocalCount).toBe(true);   // 11 flights, if every flight is a sector
    expect(r.met).toBe(false);              // only 5 landed away, so the strict reading is not met
  });
  it('treats the same aerodrome written differently as local', () => {
    const r = routeSectors([{ ...mep('2025-06-01'), depPlace: ' ebkt ', arrPlace: 'EBKT' }], 'MEP_LAND', expiry, '2025-12-01')!;
    expect(r.routeFlights).toBe(0);
  });
  it('only applies to multi-engine classes with an expiry date', () => {
    expect(routeSectors([], 'SET_LAND', expiry, today)).toBeNull();
    expect(routeSectors([], 'MEP_LAND', null, today)).toBeNull();
  });
});

describe('sepRevalidation', () => {
  const expiry = '2026-03-31';
  const enough = (date: string, o = {}) => flight(date, { totalMin: 720, picMin: 360, dualMin: 60, takeoffsDay: 12, landingsDay: 12, ...o });

  it('asks for the expiry date when it is not set', () => {
    expect(sepRevalidation([], null, today)).toMatchObject({ status: 'unknown', state: 'not-set' });
    expect(sepRevalidation([], undefined, today).progress).toEqual([]);
  });
  it('the experience window is the 12 months before expiry, excluding the anniversary day', () => {
    expect(sepRevalidation([], expiry, today).windowStart).toBe('2025-04-01');
  });
  it('is green and informational before the window opens', () => {
    const r = sepRevalidation([], expiry, '2025-03-01');
    expect(r).toMatchObject({ status: 'green', state: 'window-not-open' });
  });
  it('is amber while in the window with requirements unmet and time left', () => {
    const r = sepRevalidation([], expiry, '2025-12-01');
    expect(r).toMatchObject({ status: 'amber', state: 'in-progress', daysToExpiry: 120 });
    expect(r.progress.map((p) => p.met)).toEqual([false, false, false, false, false]);
  });
  it('turns red with 60 or fewer days left and requirements unmet', () => {
    expect(sepRevalidation([], expiry, addDays(expiry, -60))).toMatchObject({ status: 'red', state: 'urgent' });
    expect(sepRevalidation([], expiry, addDays(expiry, -61))).toMatchObject({ status: 'amber', state: 'in-progress' });
  });
  it('is green once every requirement is met, while there is time to have it entered', () => {
    const r = sepRevalidation([enough('2025-09-01')], expiry, addDays(expiry, -31));
    expect(r).toMatchObject({ status: 'green', state: 'requirements-met' });
    expect(r.progress.every((p) => p.met)).toBe(true);
  });
  it('turns amber when met with 30 or fewer days left, because met is not yet revalidated', () => {
    expect(sepRevalidation([enough('2025-09-01')], expiry, addDays(expiry, -30))).toMatchObject({ status: 'amber', state: 'met-sign-off' });
    expect(sepRevalidation([enough('2025-09-01')], expiry, '2026-03-20')).toMatchObject({ status: 'amber', state: 'met-sign-off', daysToExpiry: 11 });
    expect(sepRevalidation([enough('2025-09-01')], expiry, expiry)).toMatchObject({ status: 'amber', state: 'met-sign-off', daysToExpiry: 0 });
  });
  it('is expired the day after, met or not', () => {
    expect(sepRevalidation([enough('2025-09-01')], expiry, addDays(expiry, 1))).toMatchObject({ status: 'red', state: 'expired' });
  });
  it('goes back to green once the new expiry date is entered', () => {
    expect(sepRevalidation([enough('2025-09-01')], '2028-03-31', '2026-03-20')).toMatchObject({ status: 'green' });
  });
  it('one unmet requirement is enough to stay short', () => {
    const r = sepRevalidation([enough('2025-09-01', { dualMin: 30 })], expiry, '2026-03-20');
    expect(r.state).toBe('urgent');
    expect(r.progress.find((p) => p.key === 'training')).toMatchObject({ have: 30, need: 60, met: false });
  });
  it('sums several flights, and only SEP (land) flights inside the window', () => {
    const flights = [
      flight('2025-03-31', { totalMin: 600 }), // the anniversary day: outside
      flight('2025-04-01', { totalMin: 200, picMin: 100, takeoffsDay: 2, landingsDay: 2 }), // first day: inside
      flight('2025-08-01', { totalMin: 300, picMin: 300, takeoffsDay: 3, takeoffsNight: 1, landingsDay: 4, dualMin: 45 }),
      flight('2025-08-02', { totalMin: 999, aircraftClass: 'TMG' }),
      flight('2026-01-10', { totalMin: 500 }), // after "today"
    ];
    const r = sepRevalidation(flights, expiry, '2025-12-01');
    expect(r.progress).toEqual([
      { key: 'flight', have: 500, need: 720, unit: 'min', met: false },
      { key: 'pic', have: 400, need: 360, unit: 'min', met: true },
      { key: 'takeoffs', have: 6, need: 12, unit: 'count', met: false },
      { key: 'landings', have: 6, need: 12, unit: 'count', met: false },
      { key: 'training', have: 45, need: 60, unit: 'min', met: false },
    ]);
  });
  it('is red after expiry even if the requirements were met (renewal rules are not evaluated)', () => {
    expect(sepRevalidation([enough('2025-09-01')], expiry, '2026-04-01')).toMatchObject({ status: 'red', state: 'expired' });
  });
  it('on the expiry day itself the rating is still valid', () => {
    expect(sepRevalidation([], expiry, expiry)).toMatchObject({ state: 'urgent', daysToExpiry: 0 });
  });
});

describe('proficiencyCheckStatus', () => {
  const expiry = '2026-03-31';
  it('is unknown without an expiry date', () => {
    expect(proficiencyCheckStatus(null, '2026-01-01')).toMatchObject({ status: 'unknown', state: 'not-set' });
  });
  it('opens the 3-month window the day after the same date three months before expiry', () => {
    expect(proficiencyCheckStatus(expiry, '2025-12-31')).toMatchObject({ status: 'green', state: 'window-not-open', windowStart: '2026-01-01' });
    expect(proficiencyCheckStatus(expiry, '2026-01-01').state).toBe('window-open');
  });
  it('is amber while the window is open, red in the last 30 days and after expiry', () => {
    expect(proficiencyCheckStatus(expiry, '2026-02-15')).toMatchObject({ status: 'amber', state: 'window-open' });
    expect(proficiencyCheckStatus(expiry, '2026-03-01')).toMatchObject({ status: 'red', state: 'urgent' });
    expect(proficiencyCheckStatus(expiry, '2026-04-01')).toMatchObject({ status: 'red', state: 'expired' });
  });
});

describe('class expiry helpers and per-class experience', () => {
  it('keeps SEP (land) in its own field and other classes in classExpiry', () => {
    expect(classExpiryOf({ sepLandExpiry: '2026-03-31' }, 'SEP_LAND')).toBe('2026-03-31');
    expect(classExpiryPatch({}, 'SET_LAND', '2026-05-31')).toEqual({ classExpiry: { SET_LAND: '2026-05-31' } });
    expect(classExpiryPatch({ classExpiry: { SET_LAND: '2026-05-31' } }, 'SET_LAND', null)).toEqual({ classExpiry: {} });
    expect(classExpiryPatch({}, 'SEP_LAND', null)).toEqual({ sepLandExpiry: null });
  });
  it('only counts flights of the selected class', () => {
    const f = { ...flight('2025-09-01'), aircraftClass: 'TMG' as const, totalMin: 800, picMin: 800, takeoffsDay: 12, landingsDay: 12 };
    expect(sepRevalidation([f], '2026-03-31', '2026-03-20', DEFAULT_RULES, 'TMG').progress.find((p) => p.key === 'flight')!.have).toBe(800);
    expect(sepRevalidation([f], '2026-03-31', '2026-03-20').progress.find((p) => p.key === 'flight')!.have).toBe(0);
  });
});

describe('instrument rating (FCL.625)', () => {
  const expiry = '2026-03-31';
  it('is unknown without an expiry date', () => {
    expect(irStatus(null, '2026-01-01')).toMatchObject({ status: 'unknown', state: 'not-set' });
  });
  it('opens the 3-month check window and goes red in the last 30 days, then expires', () => {
    expect(irStatus(expiry, '2025-12-31')).toMatchObject({ state: 'window-not-open', windowStart: '2026-01-01' });
    expect(irStatus(expiry, '2026-01-01')).toMatchObject({ status: 'amber', state: 'window-open' });
    expect(irStatus(expiry, '2026-03-02')).toMatchObject({ status: 'red', state: 'urgent' });
    expect(irStatus(expiry, '2026-04-01')).toMatchObject({ status: 'red', state: 'expired' });
  });
});

describe('nightExemptByIr', () => {
  it('exempts only while the rating has not expired', () => {
    expect(nightExemptByIr({}, '2026-03-31')).toBe(false);
    expect(nightExemptByIr({ irExpiry: null }, '2026-03-31')).toBe(false);
    expect(nightExemptByIr({ irExpiry: '2026-03-31' }, '2026-03-30')).toBe(true);
  });
  it('still exempts on the expiry date itself, and stops the day after', () => {
    expect(nightExemptByIr({ irExpiry: '2026-03-31' }, '2026-03-31')).toBe(true);
    expect(nightExemptByIr({ irExpiry: '2026-03-31' }, '2026-04-01')).toBe(false);
  });
  it('does not change what night currency itself counts', () => {
    // the exemption is about whether the requirement applies, not about the arithmetic
    const flights = [flight(today, { takeoffsNight: 1, landingsNight: 1 })];
    expect(nightCurrency(flights, byClass('SEP_LAND'), today).state).toBe('current');
  });
});

describe('renewal steps are rating-specific', () => {
  it('an expired IR may not be assessed at a DTO or with an instructor, unlike a lapsed SEP', () => {
    const cls = DEFAULT_RULES.renewal.steps.join(' ');
    const ir = DEFAULT_RULES.irRenewal.steps.join(' ');
    expect(cls).toMatch(/DTO/);
    expect(cls).toMatch(/instructor/);
    expect(ir).not.toMatch(/DTO/);
    expect(ir).toMatch(/ATO/);
  });
  it('the IR renewal carries the 7-year rule, which has no class-rating equivalent', () => {
    expect(DEFAULT_RULES.irRenewal.todo.join(' ')).toMatch(/7 years/);
  });
});

describe('medical certificate (MED.A.045)', () => {
  const expiry = '2026-06-30';
  it('is unknown without a date, and valid well before expiry', () => {
    expect(medicalStatus(null, '2026-01-01')).toMatchObject({ status: 'unknown', state: 'not-set' });
    expect(medicalStatus(expiry, '2026-01-01')).toMatchObject({ status: 'green', state: 'valid' });
  });
  it('reports the 45-day window in which the revalidation examination may be done', () => {
    expect(medicalStatus(expiry, '2026-01-01').windowStart).toBe('2026-05-16'); // 45 days before
    expect(medicalStatus(expiry, '2026-05-16')).toMatchObject({ state: 'due', status: 'amber' });
  });
  it('is red in the last 30 days and after expiry', () => {
    expect(medicalStatus(expiry, '2026-06-05')).toMatchObject({ status: 'red', state: 'urgent' });
    expect(medicalStatus(expiry, '2026-06-30')).toMatchObject({ status: 'red', state: 'urgent' }); // expiry day: still valid
    expect(medicalStatus(expiry, '2026-07-01')).toMatchObject({ status: 'red', state: 'expired' });
  });
});

describe('language proficiency (FCL.055)', () => {
  it('never expires at level 6, whatever date is stored', () => {
    expect(languageStatus(6, null, '2026-01-01')).toMatchObject({ status: 'green', state: 'no-expiry' });
    expect(languageStatus(6, '2020-01-01', '2026-01-01')).toMatchObject({ state: 'no-expiry' });
  });
  it('expires at levels 4 and 5', () => {
    expect(languageStatus(4, '2026-06-30', '2026-01-01')).toMatchObject({ status: 'green', state: 'valid' });
    expect(languageStatus(5, '2026-06-30', '2026-05-01')).toMatchObject({ status: 'amber', state: 'due' });
    expect(languageStatus(4, '2026-06-30', '2026-07-01')).toMatchObject({ status: 'red', state: 'expired' });
  });
  it('is not-set without a level or a date', () => {
    expect(languageStatus(null, null, '2026-01-01')).toMatchObject({ state: 'not-set' });
  });
});

describe('type ratings (FCL.740.A(a))', () => {
  const expiry = '2026-03-31';
  it('uses the same 3-month check window as a multi-engine class rating', () => {
    expect(typeRatingStatus(expiry, '2026-01-01')).toEqual(proficiencyCheckStatus(expiry, '2026-01-01'));
    expect(typeRatingStatus(expiry, '2025-12-31')).toMatchObject({ state: 'window-not-open', windowStart: '2026-01-01' });
    expect(typeRatingStatus(expiry, '2026-04-01')).toMatchObject({ status: 'red', state: 'expired' });
  });
  it('counts route sectors per type rating, and the rule text says so and what it does not track', () => {
    expect(typeRouteSectors([flight('2025-12-01', { aircraftClass: 'OTHER', typeRatingId: 't' })], 't', expiry, '2026-01-01')).toMatchObject({ flights: 1, need: 10 });
    const text = DEFAULT_RULES.typeRating.todo.join(' ');
    expect(text).toMatch(/counted per rating/i);
    expect(text).not.toMatch(/does not count them/i);
    expect(text).toMatch(/1 route sector flown with an examiner .* not tracked/i);
    expect(text).toMatch(/OSD sets a different validity/i);
  });
});

describe('unassignedTypeFlights', () => {
  const held = [{ id: 't' }];
  const other = (typeRatingId: string | null) => flight(today, { aircraftClass: 'OTHER', typeRatingId });
  it('names flights with no rating, and flights whose rating is no longer held', () => {
    const none = other(null), removed = other('gone'), ok = other('t');
    expect(unassignedTypeFlights([none, removed, ok], held)).toEqual([none, removed]);
  });
  it('treats every rated flight as unassigned once the last rating is removed', () => {
    expect(unassignedTypeFlights([other('t')], [])).toHaveLength(1);
  });
  it('ignores flights in a class rating, whatever they carry', () => {
    expect(unassignedTypeFlights([flight(today, { typeRatingId: 'gone' })], held)).toEqual([]);
  });
});

describe('currencyClasses', () => {
  it('offers every real class but not Other when there is nothing behind it', () => {
    const c = currencyClasses([], []);
    expect(c).toContain('SEP_LAND');
    expect(c).toContain('MEP_SEA');
    expect(c).not.toContain('OTHER');
  });
  it('offers Other once a type rating is held, before any flight is logged in it', () => {
    expect(currencyClasses([], [{ id: 't' }])).toContain('OTHER');
  });
  it('offers Other for flights logged under it even without a rating, so they can be found', () => {
    expect(currencyClasses([flight(today, { aircraftClass: 'OTHER' })], [])).toContain('OTHER');
  });
  it('keeps Other last, in the canonical order', () => {
    expect(currencyClasses([], [{ id: 't' }]).at(-1)).toBe('OTHER');
  });
});
