import { describe, expect, it } from 'vitest';
import { applyRoleDefaults, emptyRoleState, rolesOfFlight, setRoleMinutes, toggleRole } from './roles';

describe('role defaults', () => {
  it('selecting a role defaults it to total time', () => {
    const s = toggleRole(emptyRoleState(), 'PIC', 95);
    expect(s.PIC).toEqual({ on: true, min: 95, manual: false });
    expect(s.DUAL.min).toBe(0);
  });
  it('un-selected roles stay at zero', () => {
    const s = applyRoleDefaults(emptyRoleState(), 120);
    expect(Object.values(s).every((e) => e.min === 0 && !e.on)).toBe(true);
  });
  it('auto roles follow a changed total, manual roles do not', () => {
    let s = toggleRole(emptyRoleState(), 'PIC', 60);
    s = toggleRole(s, 'INS', 60);
    s = setRoleMinutes(s, 'INS', 30);
    const after = applyRoleDefaults(s, 90);
    expect(after.PIC.min).toBe(90);
    expect(after.INS.min).toBe(30);
  });
  it('toggling off clears minutes', () => {
    let s = toggleRole(emptyRoleState(), 'DUAL', 45);
    s = toggleRole(s, 'DUAL', 45);
    expect(s.DUAL).toEqual({ on: false, min: 0, manual: false });
  });
  it('lists roles of a stored flight in canonical order', () => {
    expect(rolesOfFlight({ picMin: 0, copiMin: 0, dualMin: 30, instMin: 30 })).toEqual(['DUAL', 'INS']);
  });
});
