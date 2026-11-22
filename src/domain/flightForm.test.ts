import { describe, expect, it } from 'vitest';
import {
  applyAircraft,
  applyAuto,
  autoCounts,
  editableSnapshot,
  setLandings,
  setNightMinutes,
  setTakeoffs,
  resetToComputed,
  emptyForm,
  formFromFlight,
  formToFlightInput,
  hasErrors,
  resetTotal,
  setTotal,
  updateForm,
  validateForm,
} from './flightForm';
import { toggleRole } from './roles';
import type { Aircraft, Flight } from './types';

const base = () =>
  updateForm(emptyForm({ today: '2025-06-01', picName: 'SELF' }), {
    depClock: '09:30',
    arrClock: '11:05',
    depPlace: 'ebos',
    arrPlace: 'EBAW',
    registration: 'oo-abc',
    make: 'Cessna',
    model: '172',
  });

describe('form derivation', () => {
  it('total follows block time', () => {
    expect(base().totalMin).toBe(95);
  });
  it('selected role follows total, including when times change', () => {
    let s = base();
    s = updateForm(s, { roles: toggleRole(s.roles, 'PIC', s.totalMin) });
    expect(s.roles.PIC.min).toBe(95);
    s = updateForm(s, { arrClock: '11:30' });
    expect(s.totalMin).toBe(120);
    expect(s.roles.PIC.min).toBe(120);
  });
  it('manual total stops following block time and can be reset', () => {
    let s = setTotal(base(), 100);
    expect(s.totalManual).toBe(true);
    s = updateForm(s, { arrClock: '12:00' });
    expect(s.totalMin).toBe(100);
    s = resetTotal(s);
    expect(s.totalMin).toBe(150);
    expect(s.totalManual).toBe(false);
  });
  it('typing the block time as total is not an override', () => {
    expect(setTotal(base(), 95).totalManual).toBe(false);
  });
  it('applies a known aircraft', () => {
    const a = { registration: 'OO-XYZ', make: 'Piper', model: 'PA-28', variant: '181', engineClass: 'SP-SE', classRating: 'SEP_LAND' } as Aircraft;
    const s = applyAircraft(base(), a);
    expect([s.registration, s.make, s.model, s.variant]).toEqual(['OO-XYZ', 'Piper', 'PA-28', '181']);
  });
});

describe('validation', () => {
  it('accepts a complete form', () => {
    let s = base();
    s = updateForm(s, { roles: toggleRole(s.roles, 'PIC', s.totalMin) });
    expect(hasErrors(validateForm(s))).toBe(false);
  });
  it('rejects missing times, zero length and missing fields', () => {
    expect(hasErrors(validateForm(emptyForm({ today: '2025-06-01', picName: 'SELF' })))).toBe(true);
    expect(validateForm(updateForm(base(), { arrClock: '09:30' })).some((i) => i.field === 'times')).toBe(true);
  });
  it('rejects role, night or ifr time above total', () => {
    const s = updateForm(base(), { nightMin: 200, ifrMin: 96 });
    const fields = validateForm(s).filter((i) => i.severity === 'error').map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['nightMin', 'ifrMin']));
  });
  it('rejects fractional or negative landings', () => {
    expect(validateForm({ ...base(), landingsDay: 1.5 }).some((i) => i.field === 'landingsDay')).toBe(true);
    expect(validateForm({ ...base(), takeoffsNight: -1 }).some((i) => i.field === 'takeoffsNight')).toBe(true);
  });
  it('warns, but does not fail, on non-ICAO places', () => {
    const issues = validateForm(updateForm(base(), { depPlace: 'Private strip' }));
    expect(issues.find((i) => i.field === 'depPlace')?.severity).toBe('warning');
  });
  it('refuses to convert an invalid form', () => {
    expect(() => formToFlightInput(emptyForm({ today: '2025-06-01', picName: 'SELF' }))).toThrow();
  });
});

describe('form <-> flight input', () => {
  it('normalises text and fills engine-class minutes', () => {
    let s = base();
    s = updateForm(s, { roles: toggleRole(s.roles, 'PIC', s.totalMin), engineClass: 'SP-SE' });
    const input = formToFlightInput(s);
    expect(input.depPlace).toBe('EBOS');
    expect(input.registration).toBe('OO-ABC');
    expect(input.spSeMin).toBe(95);
    expect(input.spMeMin + input.mpMin).toBe(0);
    expect(input.picMin).toBe(95);
    expect(input.copiMin + input.dualMin + input.instMin).toBe(0);
    expect(input.date).toBe('2025-06-01');
    expect(input.overrides.totalMin).toBeUndefined();
  });
  it('records a total override; override flags are owned by the form, so a stale stored one is not carried over', () => {
    let s = setTotal(base(), 100);
    s = updateForm(s, { roles: toggleRole(s.roles, 'PIC', s.totalMin) });
    const input = formToFlightInput(s, { previousOverrides: { nightMin: true } });
    expect(input.overrides).toEqual({ totalMin: true }); // night is not overridden in this form state
  });
  it('round-trips through a stored flight', () => {
    let s = base();
    s = updateForm(s, {
      roles: toggleRole(s.roles, 'DUAL', s.totalMin),
      engineClass: 'SP-SE',
      takeoffsDay: 2,
      landingsDay: 2,
      remarks: ' hi ',
    });
    const input = formToFlightInput(s);
    const { picName: _p, engineClass: _e, ...rest } = input;
    const flight: Flight = { ...rest, id: 'x', aircraftId: 'a', picNameId: 'p', createdAt: 1, updatedAt: 1 };
    const back = formFromFlight(flight, 'SELF');
    expect(back.depClock).toBe('09:30');
    expect(back.arrClock).toBe('11:05');
    expect(back.totalMin).toBe(95);
    expect(back.totalManual).toBe(false);
    expect(back.roles.DUAL).toEqual({ on: true, min: 95, manual: false });
    expect(back.takeoffsDay).toBe(2);
    expect(back.remarks).toBe('hi');
    expect(formToFlightInput(back)).toEqual(input);
  });
});

describe('computed night values and overrides', () => {
  const night = { nightMin: 40, takeoffNight: false, landingNight: true };

  it('new flights follow the computed values', () => {
    const s = applyAuto(base(), night, 'follow');
    expect(s.nightMin).toBe(40);
    expect([s.takeoffsDay, s.takeoffsNight]).toEqual([1, 0]);
    expect([s.landingsDay, s.landingsNight]).toEqual([0, 1]);
    expect(s.nightManual || s.takeoffsManual || s.landingsManual).toBe(false);
  });
  it('recomputed values replace earlier computed ones when times change', () => {
    let s = applyAuto(base(), night, 'follow');
    s = applyAuto(s, { nightMin: 10, takeoffNight: true, landingNight: true }, 'follow');
    expect(s.nightMin).toBe(10);
    expect([s.takeoffsDay, s.takeoffsNight]).toEqual([0, 1]);
  });
  it('a manual night time is kept when the calculation is re-run, and is flagged', () => {
    let s = applyAuto(base(), night, 'follow');
    s = setNightMinutes(s, 25);
    expect(s.nightManual).toBe(true);
    s = applyAuto(s, { nightMin: 55, takeoffNight: false, landingNight: true }, 'follow');
    expect(s.nightMin).toBe(25);
    expect(s.nightManual).toBe(true);
  });
  it('typing the computed value is not an override', () => {
    let s = applyAuto(base(), night, 'follow');
    s = setNightMinutes(s, 25);
    s = setNightMinutes(s, 40);
    expect(s.nightManual).toBe(false);
  });
  it('a night time typed BEFORE the airports were known is not overwritten when the calculation arrives', () => {
    let s = setNightMinutes(base(), 33);
    expect(s.nightManual).toBe(true);
    s = applyAuto(s, night, 'follow');
    expect(s.nightMin).toBe(33);
  });
  it('take-off and landing counts are overridden as a group, and reset as a group', () => {
    let s = applyAuto(base(), night, 'follow');
    s = setTakeoffs(s, { takeoffsDay: 3 });
    expect(s.takeoffsManual).toBe(true);
    expect(s.landingsManual).toBe(false);
    s = applyAuto(s, { nightMin: 40, takeoffNight: true, landingNight: true }, 'follow');
    expect([s.takeoffsDay, s.takeoffsNight]).toEqual([3, 0]); // untouched
    expect([s.landingsDay, s.landingsNight]).toEqual([0, 1]); // still follows
    s = resetToComputed(s, 'takeoffs');
    expect([s.takeoffsDay, s.takeoffsNight, s.takeoffsManual]).toEqual([0, 1, false]);
  });
  it('setting counts back to the computed split clears the override', () => {
    let s = applyAuto(base(), night, 'follow');
    s = setLandings(s, { landingsDay: 2 });
    expect(s.landingsManual).toBe(true);
    s = setLandings(s, { landingsDay: 0 });
    expect(s.landingsManual).toBe(false);
  });
  it('with no calculation available, edits are manual and nothing else changes', () => {
    const s = setTakeoffs(base(), { takeoffsDay: 1 });
    expect(s.takeoffsManual).toBe(true);
    expect(applyAuto(s, null, 'follow')).toEqual({ ...s, autoNight: null });
    expect(resetToComputed(s, 'night')).toBe(s);
  });
  it('opening an existing flight NEVER rewrites stored values: differing ones become overrides', () => {
    let s = base();
    s = { ...s, nightMin: 12, takeoffsDay: 2, takeoffsNight: 0, landingsDay: 0, landingsNight: 1 }; // as stored, no flags
    const before = { n: s.nightMin, td: s.takeoffsDay, tn: s.takeoffsNight, ld: s.landingsDay, ln: s.landingsNight };
    s = applyAuto(s, night, 'adopt');
    expect([s.nightMin, s.takeoffsDay, s.takeoffsNight, s.landingsDay, s.landingsNight]).toEqual([before.n, before.td, before.tn, before.ld, before.ln]);
    expect(s.nightManual).toBe(true); // 12 differs from 40
    expect(s.takeoffsManual).toBe(true); // 2 day differs from 1 day
    expect(s.landingsManual).toBe(false); // 0 day / 1 night equals the computed landing
  });
  it('after adopting, a stored value that equals the computed one still follows later recalculation', () => {
    let s = { ...base(), nightMin: 40 };
    s = applyAuto(s, night, 'adopt');
    expect(s.nightManual).toBe(false);
    s = applyAuto(s, { ...night, nightMin: 50 }, 'follow');
    expect(s.nightMin).toBe(50);
  });
  it('resetToComputed restores the computed night time', () => {
    let s = setNightMinutes(applyAuto(base(), night, 'follow'), 5);
    s = resetToComputed(s, 'night');
    expect([s.nightMin, s.nightManual]).toEqual([40, false]);
  });
  it('saves override flags and reads them back', () => {
    let s = applyAuto(base(), night, 'follow');
    s = updateForm(s, { roles: toggleRole(s.roles, 'PIC', s.totalMin) });
    s = setNightMinutes(s, 20);
    s = setLandings(s, { landingsDay: 2 });
    const input = formToFlightInput(s);
    expect(input.overrides).toEqual({ nightMin: true, landingsDay: true, landingsNight: true });
    const { picName: _p, engineClass: _e, ...rest } = input;
    const back = formFromFlight({ ...rest, id: 'x', aircraftId: 'a', picNameId: 'p', createdAt: 1, updatedAt: 1 } as Flight, 'SELF');
    expect([back.nightManual, back.takeoffsManual, back.landingsManual]).toEqual([true, false, true]);
  });
  it('clearing an override removes the flag when saved', () => {
    let s = applyAuto(base(), night, 'follow');
    s = updateForm(s, { roles: toggleRole(s.roles, 'PIC', s.totalMin) });
    s = resetToComputed(setNightMinutes(s, 5), 'night');
    expect(formToFlightInput(s, { previousOverrides: { nightMin: true } }).overrides.nightMin).toBeUndefined();
  });
  it('computed bookkeeping does not count as an unsaved edit', () => {
    const s = base();
    expect(editableSnapshot(applyAuto(s, night, 'adopt'))).toBe(editableSnapshot(s));
    expect(editableSnapshot(setNightMinutes(s, 3))).not.toBe(editableSnapshot(s));
  });
  it('autoCounts assigns a single take-off or landing to day or night', () => {
    expect(autoCounts(false)).toEqual({ day: 1, night: 0 });
    expect(autoCounts(true)).toEqual({ day: 0, night: 1 });
  });
});

describe('landing on another UTC date', () => {
  const night = () => updateForm(base(), { date: '2025-06-10', depClock: '23:10', arrClock: '01:40' });
  it('a flight crossing midnight UTC saves the landing on the next day with the right block time', () => {
    const s = night();
    expect(s.totalMin).toBe(150);
    expect(hasErrors(validateForm(s))).toBe(false);
    const input = formToFlightInput(s);
    expect(input.date).toBe('2025-06-10');
    expect(new Date(input.depTimeUtc).toISOString()).toBe('2025-06-10T23:10:00.000Z');
    expect(new Date(input.arrTimeUtc).toISOString()).toBe('2025-06-11T01:40:00.000Z');
  });
  it('an explicit landing date is used and kept when the flight is reopened', () => {
    const s = updateForm(base(), { date: '2025-06-10', depClock: '10:00', arrClock: '12:00', arrDate: '2025-06-11' });
    expect(s.totalMin).toBe(26 * 60);
    expect(validateForm(s).some((i) => i.field === 'times' && i.severity === 'warning')).toBe(true); // over 24 h: check the dates
    expect(hasErrors(validateForm(s))).toBe(false);
    const input = formToFlightInput(s);
    const { picName: _p, engineClass: _e, ...rest } = input;
    const flight: Flight = { ...rest, id: 'x', aircraftId: 'a', picNameId: 'p', createdAt: 1, updatedAt: 1 };
    expect(formFromFlight(flight, 'SELF').arrDate).toBe('2025-06-11');
  });
  it('reopening an ordinary or midnight-crossing flight leaves the landing date automatic', () => {
    for (const s of [base(), night()]) {
      const input = formToFlightInput(s);
      const { picName: _p, engineClass: _e, ...rest } = input;
      const flight: Flight = { ...rest, id: 'x', aircraftId: 'a', picNameId: 'p', createdAt: 1, updatedAt: 1 };
      const back = formFromFlight(flight, 'SELF');
      expect(back.arrDate).toBe('');
      expect(formToFlightInput(back).arrTimeUtc).toBe(input.arrTimeUtc);
    }
  });
  it('rejects a landing date before take-off', () => {
    const s = updateForm(base(), { date: '2025-06-10', depClock: '10:00', arrClock: '12:00', arrDate: '2025-06-09' });
    const issue = validateForm(s).find((i) => i.field === 'times' && i.severity === 'error');
    expect(issue?.message).toMatch(/before off-blocks/);
    expect(() => formToFlightInput(s)).toThrow();
  });
});

describe('class and pilot-time category agree', () => {
  const w = (cls: Parameters<typeof updateForm>[1]['aircraftClass'], eng: Parameters<typeof updateForm>[1]['engineClass']) =>
    validateForm(updateForm(base(), { aircraftClass: cls, engineClass: eng })).filter((i) => i.field === 'engineClass');
  it('warns (never blocks) when an MEP class is logged as single-engine time', () => {
    for (const cls of ['MEP_LAND', 'MEP_SEA'] as const) {
      const issues = w(cls, 'SP-SE');
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe('warning');
    }
    expect(w('MEP_LAND', 'SP-ME')).toEqual([]);
  });
  it('warns when a single-engine class (SEP, SET, TMG) is logged as multi-engine time', () => {
    for (const cls of ['SEP_LAND', 'SEP_SEA', 'SET_LAND', 'SET_SEA', 'TMG'] as const) {
      expect(w(cls, 'SP-ME')).toHaveLength(1);
      expect(w(cls, 'SP-SE')).toEqual([]);
    }
  });
  it('leaves multi-pilot and "Other" alone', () => {
    for (const cls of ['SEP_LAND', 'MEP_LAND', 'SET_LAND', 'OTHER'] as const) expect(w(cls, 'MP')).toEqual([]);
    expect(w('OTHER', 'SP-SE')).toEqual([]);
    expect(w('OTHER', 'SP-ME')).toEqual([]);
  });
  it('the warning does not stop a flight from being saved', () => {
    const s = updateForm(base(), { aircraftClass: 'MEP_LAND', engineClass: 'SP-SE', roles: toggleRole(base().roles, 'PIC', 95) });
    expect(hasErrors(validateForm(s))).toBe(false);
    expect(() => formToFlightInput(s)).not.toThrow();
  });
});
