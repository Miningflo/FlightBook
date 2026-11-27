import { describe, expect, it } from 'vitest';
import { takeOver, type TakeOverSteps } from './takeOver';

function steps(over: Partial<TakeOverSteps> = {}) {
  const log: string[] = [];
  const s: TakeOverSteps = {
    wasMaster: false,
    setMaster: async (m) => { log.push(`master=${m}`); },
    claim: async () => { log.push('claim'); },
    backUp: async () => { log.push('backup'); },
    ...over,
  };
  return { s, log };
}
const fail = async () => { throw new Error('Drive said 500.'); };

describe('taking over as master', () => {
  it('takes the role, restores, claims and backs up', async () => {
    const t = steps();
    await takeOver({ ...t.s, restore: async () => { t.log.push('restore'); } });
    expect(t.log).toEqual(['master=true', 'restore', 'claim', 'backup']);
  });
  it('a failed restore leaves a viewer a viewer, and says nothing was replaced', async () => {
    const t = steps({ restore: fail });
    await expect(takeOver(t.s)).rejects.toThrow(/Nothing on this device was replaced/);
    expect(t.log).toEqual(['master=true', 'master=false']);
  });
  it('a failed claim after a restore says the data was replaced, and gives the role back', async () => {
    const t = steps({ restore: async () => {}, claim: fail });
    await expect(takeOver(t.s)).rejects.toThrow(/already replaced/);
    expect(t.log).toEqual(['master=true', 'master=false']);
  });
  it('a device that was master before stays master', async () => {
    const t = steps({ wasMaster: true, claim: fail });
    await expect(takeOver(t.s)).rejects.toThrow(/did not finish/);
    expect(t.log).toEqual(['master=true']);
  });
});
