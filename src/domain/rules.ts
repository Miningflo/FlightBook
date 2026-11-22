/**
 * Regulatory parameters used by the currency checks. ALL of them are UNVERIFIED:
 * they are written from memory of Commission Regulation (EU) No 1178/2011 (Part-FCL) and
 * must be confirmed against the current consolidated EASA text before being relied upon.
 * (Ground rule: do not invent regulatory rules; flag uncertainty instead of guessing.)
 *
 * `verified` flips to true only after the owner has checked the source. The UI shows an
 * "unverified" notice for every rule while it is false.
 *
 * Keep every number that comes from regulation in THIS file so a correction is a one-line change.
 */

export interface RuleSource {
  /** Where the rule comes from, so it can be checked. */
  reference: string;
  verified: boolean;
  /** Open questions about how to apply the rule to logbook data. */
  todo: string[];
}

export const PASSENGER_CURRENCY: RollingRule = {
  windowDays: 90,
  takeoffs: 3,
  landings: 3,
  reference: 'Part-FCL FCL.060(b), recent experience for carrying passengers',
  verified: false,
  todo: [
    'TODO(verify): confirm 3 take-offs and 3 landings in the preceding 90 days for the class being flown.',
    'TODO(verify): the rule requires them as sole manipulator of the controls; the logbook does not record who was flying, so every logged take-off/landing is counted.',
    'TODO(verify): whether take-offs/landings in an FSTD may count for a class rating; none are counted here.',
    'TODO(verify): "preceding 90 days" is applied conservatively: an event counts on the day it happens and the 89 days after.',
  ],
};

export const NIGHT_CURRENCY: RollingRule = {
  windowDays: 90,
  // Deliberately the stricter reading of instructions.md ("3 ... passengers, and night separately").
  // I suspect the EASA minimum for night is lower (1 night take-off and landing, or an IR), which is
  // unverified: a stricter default can only ever show amber/red when the pilot is in fact legal, never the reverse.
  takeoffs: 3,
  landings: 3,
  reference: 'Part-FCL FCL.060(b), carrying passengers at night',
  verified: false,
  todo: [
    'TODO(verify): the number of night take-offs and landings required (3 is assumed; EASA may require fewer).',
    'TODO(verify): holders of an instrument rating may be exempt from the night requirement; the app does not track ratings other than the SEP expiry.',
  ],
};

export const SEP_REVALIDATION: SepRule = {
  /** Window before expiry in which the experience must have been gained. */
  windowMonths: 12,
  flightMin: 12 * 60,
  picMin: 6 * 60,
  takeoffs: 12,
  landings: 12,
  /** Refresher training flight with an instructor. */
  instructorTrainingMin: 60,
  reference: 'Part-FCL FCL.740.A(b), revalidation of SEP class ratings by experience',
  verified: false,
  todo: [
    'TODO(verify): 12 h flight time in the class in the 12 months before expiry, including 6 h as PIC, 12 take-offs and 12 landings, plus a 1 h training flight with an instructor.',
    'TODO(verify): the training flight must be with an FI or CRI; the logbook has no instructor flag, so DUAL time is used as a stand-in.',
    'TODO(verify): the alternative (proficiency check with an examiner) and renewal rules once the rating has expired are not evaluated.',
    'TODO(verify): flights before the app was used (previous experience carry-ins) have no dates and are not counted.',
  ],
};

/** App-defined traffic-light thresholds. These are usability choices, NOT regulatory. */
export const APP_THRESHOLDS: AppThresholds = {
  /** Amber when a rolling currency lapses within this many days. */
  amberDaysBeforeLapse: 14,
  /** Revalidation requirements still unmet with this many days (or fewer) to expiry: red. */
  revalidationRedDaysLeft: 60,
};

export interface RollingRule extends RuleSource {
  windowDays: number;
  takeoffs: number;
  landings: number;
}
export interface SepRule extends RuleSource {
  windowMonths: number;
  flightMin: number;
  picMin: number;
  takeoffs: number;
  landings: number;
  instructorTrainingMin: number;
}
export interface AppThresholds {
  amberDaysBeforeLapse: number;
  revalidationRedDaysLeft: number;
}

export interface Rules {
  passenger: RollingRule;
  night: RollingRule;
  sep: SepRule;
  app: AppThresholds;
}

export const DEFAULT_RULES: Rules = {
  passenger: PASSENGER_CURRENCY,
  night: NIGHT_CURRENCY,
  sep: SEP_REVALIDATION,
  app: APP_THRESHOLDS,
};
