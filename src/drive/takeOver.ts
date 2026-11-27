/** The steps of becoming the master, so that a failure part-way leaves the device's role as it was. */
export interface TakeOverSteps {
  wasMaster: boolean;
  setMaster(isMaster: boolean): Promise<void>;
  /** Replace this logbook with the newest snapshot (saving a safety copy first). Left out to keep the local data. */
  restore?: () => Promise<void>;
  claim(): Promise<void>;
  backUp(): Promise<void>;
}

export async function takeOver(steps: TakeOverSteps): Promise<void> {
  let replaced = false;
  try {
    // set first, so the master-only steps are allowed
    await steps.setMaster(true);
    if (steps.restore) { await steps.restore(); replaced = true; }
    await steps.claim();
  } catch (e) {
    if (!steps.wasMaster) await steps.setMaster(false).catch(() => undefined);
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`${why} The take-over did not finish. ${replaced
      ? 'The data on this device was already replaced with the snapshot; the copy of what was here before is in Google Drive.'
      : 'Nothing on this device was replaced.'}`);
  }
  // the role is taken: a backup that fails from here shows in the backup banner and is retried
  await steps.backUp();
}
