import type { ClassCarryIn, ClassRating, Flight, FstdSession, IsoDate, Minutes, PreviousExperience, Role } from './types';
import { CLASS_RATINGS } from './types';
import { addDays, addMonths } from './time';

/**
 * Totals are always computed from the records, never stored (ground rule).
 * Role times can overlap on one flight (e.g. PIC + INS), so role percentages need not add up to 100.
 */

export interface DateRange {
  from?: IsoDate;
  to?: IsoDate;
}

export interface ClassTotals {
  totalMin: Minutes;
  picMin: Minutes;
  takeoffs: number;
  landings: number;
}

export interface Totals {
  flights: number;
  /** Total flight time (aeroplane flights), including carry-in. Excludes simulator time. */
  flightMin: Minutes;
  /** FSTD / simulator time, including carry-in. */
  fstdMin: Minutes;
  spSeMin: Minutes;
  spMeMin: Minutes;
  /** Multi-pilot time. */
  mpMin: Minutes;
  roles: Record<Role, Minutes>;
  /** Time of flights flagged PICUS / SPIC (whole flight). */
  picusMin: Minutes;
  spicMin: Minutes;
  nightMin: Minutes;
  ifrMin: Minutes;
  takeoffsDay: number;
  takeoffsNight: number;
  landingsDay: number;
  landingsNight: number;
  byClass: Partial<Record<ClassRating, ClassTotals>>;
  /** Number of previous-experience records included / left out because the date range does not cover them. */
  experienceIncluded: number;
  experienceExcluded: number;
}

export function inRange(date: IsoDate, range: DateRange): boolean {
  return (range.from === undefined || date >= range.from) && (range.to === undefined || date <= range.to);
}

/**
 * A carry-in record is a lump sum for a period, so it cannot be split by date. It is included only when
 * the selected range covers its whole period.
 */
export function experienceCovered(e: PreviousExperience, range: DateRange): boolean {
  const start = e.periodFrom ?? e.periodTo;
  return (range.from === undefined || range.from <= start) && (range.to === undefined || range.to >= e.periodTo);
}

const emptyClass = (): ClassTotals => ({ totalMin: 0, picMin: 0, takeoffs: 0, landings: 0 });

export function percentOf(part: Minutes, total: Minutes): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export function computeTotals(input: {
  flights: Flight[];
  fstd: FstdSession[];
  experience: PreviousExperience[];
  range?: DateRange;
  includeExperience?: boolean;
}): Totals {
  const range = input.range ?? {};
  const t: Totals = {
    flights: 0, flightMin: 0, fstdMin: 0, spSeMin: 0, spMeMin: 0, mpMin: 0,
    roles: { PIC: 0, COPI: 0, DUAL: 0, INS: 0 },
    picusMin: 0, spicMin: 0, nightMin: 0, ifrMin: 0,
    takeoffsDay: 0, takeoffsNight: 0, landingsDay: 0, landingsNight: 0,
    byClass: {}, experienceIncluded: 0, experienceExcluded: 0,
  };
  const cls = (c: ClassRating): ClassTotals => (t.byClass[c] ??= emptyClass());

  for (const f of input.flights) {
    if (!inRange(f.date, range)) continue;
    t.flights++;
    t.flightMin += f.totalMin;
    t.spSeMin += f.spSeMin; t.spMeMin += f.spMeMin; t.mpMin += f.mpMin;
    t.roles.PIC += f.picMin; t.roles.COPI += f.copiMin; t.roles.DUAL += f.dualMin; t.roles.INS += f.instMin;
    if (f.isPicus) t.picusMin += f.totalMin;
    if (f.isSpic) t.spicMin += f.totalMin;
    t.nightMin += f.nightMin; t.ifrMin += f.ifrMin;
    t.takeoffsDay += f.takeoffsDay; t.takeoffsNight += f.takeoffsNight;
    t.landingsDay += f.landingsDay; t.landingsNight += f.landingsNight;
    const c = cls(f.aircraftClass);
    c.totalMin += f.totalMin; c.picMin += f.picMin;
    c.takeoffs += f.takeoffsDay + f.takeoffsNight;
    c.landings += f.landingsDay + f.landingsNight;
  }
  for (const s of input.fstd) if (inRange(s.date, range)) t.fstdMin += s.totalMin;

  for (const e of input.experience) {
    if (input.includeExperience === false || !experienceCovered(e, range)) { t.experienceExcluded++; continue; }
    t.experienceIncluded++;
    t.flightMin += e.totalMin;
    t.spSeMin += e.spSeMin; t.spMeMin += e.spMeMin; t.mpMin += e.mpMin;
    t.roles.PIC += e.picMin; t.roles.COPI += e.copiMin; t.roles.DUAL += e.dualMin; t.roles.INS += e.instMin;
    t.picusMin += e.picusMin; t.spicMin += e.spicMin;
    t.nightMin += e.nightMin; t.ifrMin += e.ifrMin;
    t.takeoffsDay += e.takeoffsDay; t.takeoffsNight += e.takeoffsNight;
    t.landingsDay += e.landingsDay; t.landingsNight += e.landingsNight;
    t.fstdMin += e.fstdMin;
    for (const k of CLASS_RATINGS) {
      const v: ClassCarryIn | undefined = e.byClass[k];
      if (!v) continue;
      const c = cls(k);
      c.totalMin += v.totalMin; c.picMin += v.picMin; c.takeoffs += v.takeoffs; c.landings += v.landings;
    }
  }
  return t;
}

/** Classes that have any time, in canonical order. */
export function classesWithTime(t: Totals): ClassRating[] {
  return CLASS_RATINGS.filter((k) => {
    const c = t.byClass[k];
    return c !== undefined && (c.totalMin > 0 || c.takeoffs > 0 || c.landings > 0);
  });
}

export type RangePreset = 'all' | 'year' | '12m' | '90d' | 'custom';

/** Date range for a filter preset, relative to `today` (UTC). Empty custom bounds are open-ended. */
export function presetRange(preset: RangePreset, today: IsoDate, custom: { from?: string; to?: string } = {}): DateRange {
  switch (preset) {
    case 'all': return {};
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case '12m': return { from: addDays(addMonths(today, -12), 1), to: today };
    case '90d': return { from: addDays(today, -89), to: today };
    case 'custom': return { from: custom.from || undefined, to: custom.to || undefined };
  }
}
