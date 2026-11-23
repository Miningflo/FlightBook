/**
 * Regulatory parameters used by the currency checks, taken from Commission Regulation (EU) No 1178/2011
 * (Part-FCL) as published in the EASA Easy Access Rules for Aircrew, revision from October 2026
 * (https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-aircrew),
 * checked word by word against the text of FCL.060, FCL.740 and FCL.740.A on 23 November 2026 (all three
 * carrying the amendments of Regulation (EU) 2024/2076 in that revision), and FCL.625 and FCL.625.A
 * (Regulation (EU) 2020/2193) on the same day.
 * (Ground rule: do not invent regulatory rules; flag uncertainty instead of guessing.)
 *
 * Check against EASA's own text, not a national library. The UK CAA's retained version of
 * FCL.740.A(b)(1)(ii) differs: there the 12 hours may be spread over the whole validity period as long as
 * 6 of them fall in the last 12 months. The EASA text below requires all 12 within the 12 months before
 * expiry, so these numbers are wrong for a UK licence.
 *
 * `verified` is true when the numbers below match that text. The `todo` lists are the remaining limits of
 * the app (data the logbook does not record), not doubts about the rule itself.
 *
 * Keep every number that comes from regulation in THIS file so a correction is a one-line change.
 */

export interface RuleSource {
  /** Where the rule comes from, so it can be checked. */
  reference: string;
  verified: boolean;
  /** Open questions or limits of how the rule is applied to logbook data. */
  todo: string[];
}

export const PASSENGER_CURRENCY: RollingRule = {
  windowDays: 90,
  takeoffs: 3,
  landings: 3,
  reference: 'Part-FCL FCL.060(b)(1): a pilot shall not operate an aircraft in commercial air transport or to carry passengers as PIC or co-pilot unless, in the preceding 90 days, they carried out at least 3 take-offs, approaches and landings as pilot flying in an aircraft of the same type or class (or an FFS representing it).',
  verified: true,
  todo: [
    'Limit: the logbook does not record who was flying, so every logged take-off and landing is counted although the rule requires them as pilot flying.',
    'Limit: take-offs and landings in a simulator (FFS) of the class also count under the rule; none are counted here.',
    'Limit: approaches are not recorded, only take-offs and landings.',
    'Limit: "preceding 90 days" is applied conservatively: an event counts on the day it happens and the 89 days after.',
  ],
};

export const NIGHT_CURRENCY: RollingRule = {
  windowDays: 90,
  takeoffs: 1,
  landings: 1,
  reference: 'Part-FCL FCL.060(b)(2)(i): to act as PIC at night, at least 1 take-off, approach and landing at night as pilot flying in the preceding 90 days, in an aircraft of the same type or class (or an FFS representing it). FCL.060(b)(2)(ii) exempts holders of an IR.',
  verified: true,
  todo: [
    'Holders of an IR are exempt from this requirement. Enter your IR expiry date and the app stops asking, for as long as the rating is valid.',
    'Limit: FCL.060(b)(2)(ii) says "holds an IR", not "holds a valid IR". The app takes the strict reading and only exempts you while the rating has not expired, because being told you are not current when you are is the harmless way round.',
    'Limit: the logbook does not record who was flying, so every logged night take-off and landing is counted.',
    'Limit: night take-offs and landings in a simulator (FFS) of the class also count under the rule; none are counted here.',
  ],
};

/**
 * Instrument rating. The dates come from FCL.625; FCL.625.A says what the check contains, which the
 * logbook cannot see. Tracked because an IR exempts you from the night requirement (FCL.060(b)(2)(ii))
 * and because it expires twice as fast as a single-engine class rating.
 */
export const IR_REVALIDATION: ProficiencyRule = {
  windowMonths: 3,
  reference: 'Part-FCL FCL.625(a): an IR shall be valid for 1 year. FCL.625(b)(1): it shall be revalidated within the 3 months immediately preceding its expiry date by complying with the revalidation criteria for the relevant aircraft category.',
  verified: true,
  todo: [
    'For aeroplanes those criteria are FCL.625.A: hold the relevant class or type rating, and pass the instrument sections of an Appendix 9 proficiency check. It may be combined with the class or type rating check, in which case the whole check counts.',
    'Limit: an FNPT II or FFS may be used, provided at least each alternate check is flown in an aeroplane (FCL.625.A(a)(4)). The app does not know where your checks were done, so it cannot track that alternation.',
    'If you pass the check earlier than the 3-month window, the new validity period starts from the date of the check (FCL.625(b)(2)). Update the expiry date here afterwards.',
    'If you fail the relevant section of the check before the expiry date, you may not exercise the IR privileges until you have passed it (FCL.625(b)(3)).',
    'Limit: the BIR (FCL.835) and the IR(H)/IR(As) variants are not modelled; this card follows the IR(A).',
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
  reference: 'Part-FCL FCL.740.A(b)(1)(ii): within the 12 months preceding the expiry date of the rating, complete 12 hours of flight time in the relevant class, including (A) 6 hours as PIC, (B) 12 take-offs and 12 landings, and (C) refresher training of at least 1 hour of total flight time with and to the satisfaction of an FI or CRI. Applies to SEP (land and sea) and TMG class ratings. The alternative, FCL.740.A(b)(1)(i), is a proficiency check with an examiner within the 3 months preceding expiry.',
  verified: true,
  todo: [
    'Limit: the training flight must be with an FI or CRI; the logbook has no instructor flag, so DUAL time is used as a stand-in.',
    'Limit: the 1 hour refresher training is not needed if you passed a class or type rating proficiency check, a skill test, an EBT practical assessment or an assessment of competence in any class or type of aeroplane (FCL.740.A(b)(1)(ii)(C)); the app does not know about those and always asks for it.',
    'Limit: if you hold both SEP (land) and TMG the hours may be flown in either class or a combination and revalidate both (FCL.740.A(b)(2)); if you hold SEP (land) and SEP (sea) the same applies, with at least 1 hour of the PIC time and 6 of the 12 take-offs and landings in each class (FCL.740.A(b)(4)). The app counts the selected class only.',
    'Limit: flights before the app was used (previous experience carry-ins) have no dates and are not counted.',
    'Limit: these are the EASA figures. A UK CAA licence follows the retained wording, which lets the 12 hours be spread over the whole validity period provided 6 fall in the last 12 months.',
  ],
};

/**
 * Revalidation by proficiency check only: SET (single-engine turbo-prop, FCL.740.A(b)(3)) and multi-engine
 * class ratings (FCL.740.A(a)). There is no experience route for these.
 */
export const PROFICIENCY_CHECK_REVALIDATION: ProficiencyRule = {
  /** The check must be passed within this many months before the expiry date. */
  windowMonths: 3,
  reference: 'Part-FCL FCL.740.A(b)(3) (single-engine turbo-prop): pass a proficiency check on the relevant class in accordance with Appendix 9 with an examiner, within the 3 months preceding the expiry date of the rating. FCL.740.A(a)(1) sets the same 3-month window for multi-engine class ratings.',
  verified: true,
  todo: [
    'Limit: for multi-engine ratings FCL.740.A(a)(1) also accepts an EBT practical assessment (Appendix 10) instead of the proficiency check, and allows it in an FSTD representing the class. The app only names the check.',
    'Limit: if you pass the check earlier than that window, the new validity period starts from the date of the check (FCL.740(a)(1)). Update the expiry date here afterwards; the app does not compute it.',
    'Validity is 1 year, except for single-pilot single-engine class ratings (SEP, TMG, SET) which are valid for 2 years, unless the operational suitability data says otherwise (FCL.740(a)(1)). You enter the expiry date from your licence.',
    'The regulation names "single-pilot single-engine turbo-prop aeroplanes"; the app applies the same rule to SET (land and sea).',
    'If you fail a section of the check before expiry you may not use the rating until you have passed it (FCL.740.A(c)).',
  ],
};

/** Multi-engine class ratings also need route sectors during the validity period (FCL.740.A(a)(2)). */
export const MULTI_ENGINE_SECTORS: SectorRule = {
  /**
   * FCL.740.A(a)(2) counts the sectors over "the period of validity of the rating", which it does not
   * state: FCL.740(a)(1) does, as 1 year for a multi-engine class rating. These two numbers belong
   * together — if the validity of a multi-engine class rating ever changes, change this with it.
   */
  validityMonths: 12,
  sectors: 10,
  reference: 'Part-FCL FCL.740.A(a)(2): complete during the period of validity of the rating at least (i) 10 route sectors as pilot of the relevant class, or (ii) 1 route sector as pilot flown with an examiner, which may be flown during the proficiency check. A multi-engine class rating is valid for 1 year (FCL.740(a)(1)), so the window here is the 12 months before expiry.',
  verified: true,
  todo: [
    'Limit: the logbook does not record route sectors, so every logged flight in the class during the 12 months before expiry counts as one sector.',
    'Limit: the alternative of 1 route sector flown with an examiner (it may be the proficiency check) is not tracked; the counter only shows the 10-sector route.',
    'Limit: a pilot working for a commercial air transport operator who passes the operator proficiency check combined with the revalidation check is exempt (FCL.740.A(a)(3)); not tracked.',
  ],
};

/** Renewal of a class rating that has already expired (FCL.740(b)). Shown as a checklist; nothing is counted. */
export const RENEWAL: RenewalRule = {
  reference: 'Part-FCL FCL.740(b), renewal of class and type ratings, with AMC1 FCL.740(b).',
  verified: true,
  steps: [
    'Assessment at an ATO to decide whether you need refresher training. For an expired non-high-performance SEP or TMG rating a DTO may do it too, and with an instructor if the rating expired no more than 3 years ago.',
    'Refresher training at that organisation or with that instructor, only if the assessment says it is necessary. The amount is decided case by case; you receive a training completion certificate to show the examiner.',
    'Pass a proficiency check with an examiner (Appendix 9 to Part-FCL), or complete an EBT practical assessment (Appendix 10) if your operator runs one.',
    'Enter the new expiry date here once it is on your licence.',
  ],
  todo: [
    'Applicants are exempt from the assessment and refresher training if they hold a valid rating for the same class on a licence from a third country (ICAO Annex 1) and may exercise its privileges (FCL.740(b)).',
    'The assessment may also be done at an EBT operator specifically approved for the refresher training (FCL.740(b)(1)(iv)); not relevant to a private SEP or TMG rating.',
    'Limit: the app does not check these steps; it only lists them.',
  ],
};

/**
 * Renewal of an expired instrument rating (FCL.625(c)). Deliberately NOT the class-rating list above:
 * the three steps look alike, but an IR assessment must be at an ATO or an approved EBT operator, where
 * a lapsed SEP or TMG may be assessed at a DTO or even with an instructor. Showing the class-rating
 * steps on the IR card would tell a pilot they can renew somewhere they cannot.
 */
export const IR_RENEWAL: RenewalRule = {
  reference: 'Part-FCL FCL.625(c), renewal of an expired instrument rating.',
  verified: true,
  steps: [
    'Assessment at an ATO (or at an EBT operator specifically approved for the refresher training) to decide whether you need refresher training to reach the level needed to pass the instrument element of the skill test.',
    'Refresher training at that same organisation, only if the assessment says it is necessary.',
    'Pass a proficiency check with an examiner (Appendix 9 to Part-FCL) in the relevant aircraft category, or complete an EBT practical assessment.',
    'Hold the relevant class or type rating (FCL.625(c)(4)), and enter the new expiry date here once it is on your licence.',
  ],
  todo: [
    'If the IR has not been revalidated or renewed in the preceding 7 years you must pass the IR theoretical knowledge examination and the skill test again (FCL.625(d)). The app does not know your rating history, so it never tells you this applies.',
    'Holders of a valid IR on a third-country licence (ICAO Annex 1) are partly exempted (FCL.625(e)).',
    'Limit: the app does not check these steps; it only lists them.',
  ],
};

/** App-defined traffic-light thresholds. These are usability choices, NOT regulatory. */
export const APP_THRESHOLDS: AppThresholds = {
  /** Amber when a rolling currency lapses within this many days. */
  amberDaysBeforeLapse: 14,
  /** Revalidation requirements still unmet with this many days (or fewer) to expiry: red. */
  revalidationRedDaysLeft: 60,
  proficiencyCheckRedDaysLeft: 30,
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
  /** Proficiency check still not done with this many days (or fewer) to expiry: red. */
  proficiencyCheckRedDaysLeft: number;
}
export interface SectorRule extends RuleSource {
  validityMonths: number;
  sectors: number;
}
export interface RenewalRule extends RuleSource {
  steps: string[];
}
export interface ProficiencyRule extends RuleSource {
  windowMonths: number;
}

export interface Rules {
  passenger: RollingRule;
  night: RollingRule;
  sep: SepRule;
  ir: ProficiencyRule;
  irRenewal: RenewalRule;
  proficiencyCheck: ProficiencyRule;
  renewal: RenewalRule;
  mepSectors: SectorRule;
  app: AppThresholds;
}

export const DEFAULT_RULES: Rules = {
  passenger: PASSENGER_CURRENCY,
  night: NIGHT_CURRENCY,
  sep: SEP_REVALIDATION,
  ir: IR_REVALIDATION,
  irRenewal: IR_RENEWAL,
  proficiencyCheck: PROFICIENCY_CHECK_REVALIDATION,
  renewal: RENEWAL,
  mepSectors: MULTI_ENGINE_SECTORS,
  app: APP_THRESHOLDS,
};
