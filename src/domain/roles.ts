import type { Flight, Minutes, Role } from './types';
import { ROLES } from './types';

/** UI-side state of one pilot-function chip. */
export interface RoleEntry {
  on: boolean;
  min: Minutes;
  /** True once the user typed a custom value; the default no longer follows total time. */
  manual: boolean;
}
export type RoleState = Record<Role, RoleEntry>;

export function emptyRoleState(): RoleState {
  return {
    PIC: { on: false, min: 0, manual: false },
    COPI: { on: false, min: 0, manual: false },
    DUAL: { on: false, min: 0, manual: false },
    INS: { on: false, min: 0, manual: false },
  };
}

/** Selected roles that haven't been manually edited default to the total flight time. */
export function applyRoleDefaults(state: RoleState, totalMin: Minutes): RoleState {
  const next = emptyRoleState();
  for (const r of ROLES) {
    const e = state[r];
    next[r] = e.on ? { ...e, min: e.manual ? e.min : totalMin } : { on: false, min: 0, manual: false };
  }
  return next;
}

export function toggleRole(state: RoleState, role: Role, totalMin: Minutes): RoleState {
  const turningOn = !state[role].on;
  const next: RoleState = {
    ...state,
    [role]: turningOn ? { on: true, min: totalMin, manual: false } : { on: false, min: 0, manual: false },
  };
  return next;
}

export function setRoleMinutes(state: RoleState, role: Role, min: Minutes): RoleState {
  return { ...state, [role]: { on: true, min, manual: true } };
}

/** Rebuild chip state from a stored flight. A role is "on" if it has any minutes. */
export function roleStateFromFlight(f: Pick<Flight, 'picMin' | 'copiMin' | 'dualMin' | 'instMin' | 'totalMin'>): RoleState {
  const mk = (min: Minutes): RoleEntry => ({ on: min > 0, min, manual: min > 0 && min !== f.totalMin });
  return { PIC: mk(f.picMin), COPI: mk(f.copiMin), DUAL: mk(f.dualMin), INS: mk(f.instMin) };
}

/** Roles that carry time on a stored flight, in canonical order. */
export function rolesOfFlight(f: Pick<Flight, 'picMin' | 'copiMin' | 'dualMin' | 'instMin'>): Role[] {
  const out: Role[] = [];
  if (f.picMin > 0) out.push('PIC');
  if (f.copiMin > 0) out.push('COPI');
  if (f.dualMin > 0) out.push('DUAL');
  if (f.instMin > 0) out.push('INS');
  return out;
}
