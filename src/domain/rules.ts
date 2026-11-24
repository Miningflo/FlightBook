/**
 * Regulatory parameters used by the currency checks, taken from Commission Regulation (EU) No 1178/2011
 * (Part-FCL) as published in the EASA Easy Access Rules for Aircrew, revision from October 2026
 * (https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-aircrew),
 * checked word by word against the text of FCL.060, FCL.740 and FCL.740.A on 23 November 2026 (all three
 * carrying the amendments of Regulation (EU) 2024/2076 in that revision), and FCL.625 and FCL.625.A
 * (Regulation (EU) 2020/2193) on the same day, and FCL.055 and MED.A.045 (Regulation (EU) 2019/27).
 *
 * MED.A.045 is Part-MED, not Part-FCL: the medical certificate is the one document that grounds you
 * whatever your ratings say, so it is tracked here even though it comes from a different Annex.
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
    'Part-FCL asks for "route sectors" and nowhere says what one is. The only definition EASA gives is in Part-ORO, ORO.FTL.105: the segment between the aircraft first moving to take off and coming to rest after landing -- one flight, with no requirement that it end anywhere else. "Route" is usually read as a flight from one aerodrome to another, which would leave local flying out.',
    'Both readings are therefore shown: every flight in the class, and the subset that landed away. The status follows the narrower one, so it can tell you that you are short when you are not, but never the reverse. Check which reading the authority that issued your licence takes.',
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

/**
 * Type ratings. FCL.740.A(a) covers "multi-engine class ratings AND type ratings" in one breath, so the
 * revalidation rule is the one already used for MEP; only the validity period and the route-sector
 * counting differ in what the app can do about them.
 */
export const TYPE_RATING: ProficiencyRule = {
  windowMonths: 3,
  reference: 'Part-FCL FCL.740.A(a)(1): pass a proficiency check in accordance with Appendix 9, or complete an EBT practical assessment in accordance with Appendix 10, in the relevant type of aeroplane or an FSTD representing it, within the 3 months immediately preceding the expiry date. FCL.740(a)(1): a type rating is valid for 1 year unless the operational suitability data says otherwise.',
  verified: true,
  todo: [
    'Validity is 1 year "unless otherwise determined in the OSD" (FCL.740(a)(1)), and for many types the OSD does determine otherwise. Enter the expiry date from your licence; the app never works it out.',
    'FCL.740.A(a)(2) also asks for 10 route sectors in the type during the validity period, or 1 flown with an examiner. Each flight names the type rating it was flown under, so the sectors are counted per rating, on the same two readings as for MEP: every flight, and the subset that landed away.',
    'Limit: the sectors are counted over the 12 months before the expiry date, which is the default 1-year validity. Where the OSD sets a different validity for your type, the window does not follow it.',
    'Limit: the alternative of 1 route sector flown with an examiner (it may be the proficiency check) is not tracked; the counter only shows the 10-sector route.',
    'A pilot flying for a commercial air transport operator who passes the operator proficiency check combined with the revalidation check is exempt from the route sectors (FCL.740.A(a)(3)).',
    'If you fail a section of the check before expiry you may not use the rating until you have passed it (FCL.740.A(c)). An expired type rating is renewed under FCL.740(b), the same steps as a class rating.',
  ],
};

/**
 * Medical certificate (Annex IV, Part-MED). The app stores the expiry date printed on the certificate
 * and never computes it: the validity period depends on the class and on your age, and the age bands
 * have edges the app could not get right without knowing your date of birth, which it deliberately
 * does not ask for.
 */
export const MEDICAL: MedicalRule = {
  /** The revalidation examination may be done this many days before expiry (MED.A.045(b)). */
  revalidationWindowDays: 45,
  reference: 'Part-MED MED.A.045(a): a class 1 medical certificate is valid for 12 months (6 months from age 60, or from 40 in single-pilot commercial air transport with passengers); a class 2 certificate for 60 months until age 40, 24 months from 40 to 50, and 12 months above 50; a LAPL certificate for 60 months until age 40 and 24 months after. MED.A.045(b): the revalidation examination may be undertaken up to 45 days before the expiry date.',
  verified: true,
  todo: [
    'The app does not know your age, so it does not work out the validity period. Enter the expiry date printed on the certificate, which already accounts for it.',
    'Watch the age edges: a class 2 or LAPL certificate issued before you turn 40 stops being valid once you reach 42, and a class 2 issued before 50 stops once you reach 51 (MED.A.045(a)(3)-(4)). The printed expiry date may therefore be later than the date it actually ceases to be valid.',
    'Revalidating inside the 45-day window keeps the old expiry date as the starting point; an examination outside it counts as a renewal and the new period runs from the examination (MED.A.045(a)(5)).',
    'Once expired, a renewal examination is needed, and after 2 years (and again after 5) the examiner has to look at your aero-medical records first (MED.A.045(c)). The app only tells you it has expired.',
  ],
};

/**
 * Language proficiency endorsement (FCL.055). Without it you may not use the radio, and without the
 * radio you may not exercise the privileges of the licence at all -- so it grounds you like a medical.
 */
export const LANGUAGE_PROFICIENCY: LanguageRule = {
  /** Re-evaluation interval in years, by the level demonstrated. Level 6 never expires. */
  yearsByLevel: { 4: 4, 5: 6, 6: null },
  reference: 'Part-FCL FCL.055(a): pilots required to use the radio telephone shall not exercise the privileges of their licences and ratings without a language proficiency endorsement. FCL.055(c): the endorsement is re-evaluated every 4 years at operational level (level 4) and every 6 years at extended level (level 5); an expert level (level 6) endorsement is not re-evaluated.',
  verified: true,
  todo: [
    'The app stores the expiry date from your licence, not the interval: it does not work out when the re-evaluation falls due.',
    'Level 6 is recorded as not expiring, which is what FCL.055(c) says. Some authorities re-assess it anyway; if yours does, enter it as a level 5 with the date they gave you.',
    'Limit: only the endorsement for the language you fly in is tracked, and only one of them.',
  ],
};

/** App-defined traffic-light thresholds. These are usability choices, NOT regulatory. */
export const APP_THRESHOLDS: AppThresholds = {
  /** Amber when a rolling currency lapses within this many days. */
  amberDaysBeforeLapse: 14,
  /** Revalidation requirements still unmet with this many days (or fewer) to expiry: red. */
  revalidationRedDaysLeft: 60,
  proficiencyCheckRedDaysLeft: 30,
  licenceAmberDaysLeft: 90,
  licenceRedDaysLeft: 30,
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
  /** A licence document (medical, language endorsement) expiring within this many days: amber. */
  licenceAmberDaysLeft: number;
  /** ...and within this many: red. */
  licenceRedDaysLeft: number;
}
export interface MedicalRule extends RuleSource {
  revalidationWindowDays: number;
}
export interface LanguageRule extends RuleSource {
  yearsByLevel: Record<LanguageLevel, number | null>;
}
/** Operational, extended, expert (FCL.055(c) / Appendix 2). */
export type LanguageLevel = 4 | 5 | 6;
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
  typeRating: ProficiencyRule;
  medical: MedicalRule;
  language: LanguageRule;
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
  typeRating: TYPE_RATING,
  medical: MEDICAL,
  language: LANGUAGE_PROFICIENCY,
  proficiencyCheck: PROFICIENCY_CHECK_REVALIDATION,
  renewal: RENEWAL,
  mepSectors: MULTI_ENGINE_SECTORS,
  app: APP_THRESHOLDS,
};
