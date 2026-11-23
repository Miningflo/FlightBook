import type { Flight, FstdSession, IsoDate, Minutes, Person, PreviousExperience } from './types';
import { clockOfTimestamp, formatHHMM } from './time';

/**
 * Layout specification of the printed logbook (A4 landscape), following the column
 * structure of AMC1 FCL.050. This module is PURE: it knows nothing about pdf-lib or the
 * app's screens. It decides which columns exist, how wide they are, which rows go on which
 * page, and the per-page / brought-forward / to-date totals. The renderer only draws it.
 *
 * Checked against AMC1 FCL.050 "Pilot logbook" (ED Decision 2025/022/R) in the EASA Easy Access Rules
 * for Aircrew, revision from October 2026, on 23 November 2026. The AMC numbers 12 columns, and the
 * groups below reproduce that set and order exactly:
 *   (1) date  (2) departure place + time  (3) arrival place + time  (4) aircraft make,
 *   model, variant + registration  (5) single-pilot time SE / ME, multi-pilot time
 *   (6) total time of flight  (7) name(s) of PIC  (8) landings day / night
 *   (9) operational condition time night / IFR  (10) pilot function time PIC / co-pilot /
 *   dual / instructor  (11) FSTD session date, type, total time  (12) remarks and endorsements.
 * The AMC's own totals rows are TOTAL THIS PAGE / TOTAL FROM PREVIOUS PAGES / TOTAL TIME, as here,
 * and it has no take-off and no PICUS/SPIC column, so printing landings only and putting PICUS/SPIC
 * in the remarks is right.
 *
 * One table, as in the AMC: a simulator session is a row that fills only the FSTD SESSION group
 * (column 11, which carries its own date) and the remarks, so sessions and flights stay in one
 * chronological sequence and the flight-time columns are never polluted by session time. Column
 * widths are therefore tight: 680 pt of the 786 usable points are fixed, leaving 106 pt for remarks.
 * The renderer shrinks and wraps text that does not fit and counts what it had to cut, so a narrow
 * column degrades visibly rather than silently.
 *
 * The holder block the AMC puts on the inside cover (holder's name(s), licence number, address) is
 * printed on every page instead of once, so each sheet identifies its holder on its own. Where a
 * value has not been entered, a blank rule is drawn to be filled in by hand.
 *
 * TODO(verify): FCL.050 itself only says the record must be kept "in a form and manner established by
 * the competent authority", and this AMC is one acceptable means, not the only one. Check what the
 * authority that issued your licence actually requires before using the printout as your logbook of
 * record. Known cosmetic difference: the AMC header reads DATE (dd/mm/yy) where this prints 4-digit
 * years, which is deliberate -- a two-digit year in a lifetime logbook is ambiguous.
 */

export const PAGE = {
  width: 841.89, // A4 landscape, points
  height: 595.28,
  margin: 28,
  /** Title line plus the two holder-block lines (AMC1 FCL.050). 36 pt costs no data rows. */
  titleH: 36,
  groupH: 14,
  colHeadH: 24,
  rowH: 18,
  totalRowH: 16,
  signatureH: 34,
} as const;

export const USABLE_WIDTH = PAGE.width - 2 * PAGE.margin;

export type CellKind = 'text' | 'date' | 'time' | 'duration' | 'count';
export type Align = 'left' | 'right' | 'center';

export interface ColumnSpec {
  id: string;
  /** Header text, one entry per line. */
  label: string[];
  /** Width in points; 'flex' takes whatever width is left. */
  width: number | 'flex';
  align: Align;
  kind: CellKind;
  /** Summed in the page / brought-forward / to-date rows. */
  sum: boolean;
}

export interface GroupSpec {
  label: string[];
  columns: ColumnSpec[];
}

export interface TableSpec {
  id: 'logbook';
  title: string;
  groups: GroupSpec[];
}

const col = (id: string, label: string[], width: number | 'flex', kind: CellKind, o: Partial<ColumnSpec> = {}): ColumnSpec => ({
  id, label, width, kind, align: kind === 'duration' || kind === 'count' ? 'right' : kind === 'text' ? 'left' : 'center', sum: false, ...o,
});
const dur = (id: string, label: string[], width = 27): ColumnSpec => col(id, label, width, 'duration', { sum: true });

/** The twelve numbered column groups of AMC1 FCL.050, in the AMC's order. */
export const LOGBOOK_TABLE: TableSpec = {
  id: 'logbook',
  title: 'PILOT LOGBOOK',
  groups: [
    { label: ['DATE', '(dd/mm/yyyy)'], columns: [col('date', ['DATE'], 36, 'date')] },
    { label: ['DEPARTURE'], columns: [col('depPlace', ['Place'], 25, 'text'), col('depTime', ['Time', '(UTC)'], 23, 'time')] },
    { label: ['ARRIVAL'], columns: [col('arrPlace', ['Place'], 25, 'text'), col('arrTime', ['Time', '(UTC)'], 23, 'time')] },
    { label: ['AIRCRAFT'], columns: [col('aircraftType', ['Make, model,', 'variant'], 56, 'text'), col('registration', ['Registration'], 33, 'text')] },
    { label: ['SINGLE-PILOT', 'TIME'], columns: [dur('spSe', ['SE'], 26), dur('spMe', ['ME'], 26)] },
    { label: ['MULTI-PILOT', 'TIME'], columns: [dur('mp', ['MP'], 28)] },
    { label: ['TOTAL TIME', 'OF FLIGHT'], columns: [dur('total', ['TOTAL'], 30)] },
    // 54 pt, not less. Above 40 the renderer wraps to two lines, and 54 is what it takes for a long
    // surname ("Vandenbroucke") to fit one of them: NAME(S) OF PIC is a required column, so a name
    // must never come out with an ellipsis.
    { label: ['NAME(S) OF PIC'], columns: [col('picName', ['NAME(S) OF PIC'], 54, 'text')] },
    { label: ['LANDINGS'], columns: [col('ldgDay', ['Day'], 18, 'count', { sum: true }), col('ldgNight', ['Night'], 19, 'count', { sum: true })] },
    { label: ['OPERATIONAL', 'CONDITION TIME'], columns: [dur('night', ['Night'], 25), dur('ifr', ['IFR'], 25)] },
    { label: ['PILOT FUNCTION TIME'], columns: [dur('pic', ['PIC'], 26), dur('copi', ['CO-PILOT'], 27), dur('dual', ['DUAL'], 26), dur('inst', ['INSTR.'], 26)] },
    // Column 11. Carries its own date, so a session row leaves the flight columns empty.
    { label: ['FSTD SESSION'], columns: [col('fstdDate', ['Date'], 36, 'date'), col('fstdType', ['Type'], 40, 'text'), dur('fstdTotal', ['Total'], 27)] },
    { label: ['REMARKS AND', 'ENDORSEMENTS'], columns: [col('remarks', ['REMARKS AND ENDORSEMENTS'], 'flex', 'text')] },
  ],
};

export interface PlacedColumn extends ColumnSpec {
  x: number;
  w: number;
}

/** Columns with absolute x positions and resolved widths (the flex column takes the rest). */
export function placeColumns(table: TableSpec): PlacedColumn[] {
  const cols = table.groups.flatMap((g) => g.columns);
  const fixed = cols.reduce((a, c) => a + (c.width === 'flex' ? 0 : c.width), 0);
  const flexCount = cols.filter((c) => c.width === 'flex').length;
  const flexW = flexCount > 0 ? (USABLE_WIDTH - fixed) / flexCount : 0;
  let x = PAGE.margin;
  return cols.map((c) => {
    const w = c.width === 'flex' ? flexW : c.width;
    const placed = { ...c, x, w };
    x += w;
    return placed;
  });
}

export const sumColumnIds = (table: TableSpec): string[] => table.groups.flatMap((g) => g.columns).filter((c) => c.sum).map((c) => c.id);

/** How many data rows fit on one page after the title, header, totals block and signature line. */
export function rowsPerPage(): number {
  const free = PAGE.height - 2 * PAGE.margin - PAGE.titleH - PAGE.groupH - PAGE.colHeadH - 3 * PAGE.totalRowH - PAGE.signatureH;
  return Math.floor(free / PAGE.rowH);
}

// ---------------- rows ----------------

export type Cell = string | number;
export type PdfRow = Record<string, Cell>;
export type Totals = Record<string, number>;

export const dmy = (d: IsoDate): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Text of a cell. Zero is left blank in data rows (as on paper) but shown in the totals rows. */
export function formatCell(kind: CellKind, value: Cell | undefined, opts: { blankZero: boolean }): string {
  if (value === undefined || value === '') return '';
  switch (kind) {
    case 'date': return dmy(String(value));
    case 'duration': return opts.blankZero && value === 0 ? '' : formatHHMM(Number(value));
    case 'count': return opts.blankZero && value === 0 ? '' : String(value);
    default: return String(value);
  }
}

export function flightRow(f: Flight, persons: Person[]): PdfRow {
  const remarks = [f.isPicus ? 'PICUS' : '', f.isSpic ? 'SPIC' : '', f.remarks.trim()].filter(Boolean).join(' · ');
  return {
    date: f.date,
    depPlace: f.depPlace, depTime: clockOfTimestamp(f.depTimeUtc),
    arrPlace: f.arrPlace, arrTime: clockOfTimestamp(f.arrTimeUtc),
    aircraftType: [f.aircraftMake, f.aircraftModel, f.aircraftVariant].filter(Boolean).join(' '),
    registration: f.registration,
    spSe: f.spSeMin, spMe: f.spMeMin, mp: f.mpMin, total: f.totalMin,
    picName: persons.find((p) => p.id === f.picNameId)?.name ?? '?',
    ldgDay: f.landingsDay, ldgNight: f.landingsNight,
    night: f.nightMin, ifr: f.ifrMin,
    pic: f.picMin, copi: f.copiMin, dual: f.dualMin, inst: f.instMin,
    remarks,
  };
}

/**
 * A simulator session fills column 11 only: that group has its own date, so leaving column 1 and
 * every flight-time column empty keeps session time out of the flight totals, exactly as on paper.
 */
export function fstdRow(s: FstdSession): PdfRow {
  return { fstdDate: s.date, fstdType: s.fstdType, fstdTotal: s.totalMin, remarks: s.remarks.trim() };
}

/** Flights and simulator sessions as one chronological sequence, as the AMC's single table expects. */
export function logbookRows(flights: Flight[], fstd: FstdSession[], persons: Person[]): PdfRow[] {
  const items = [
    // a session has no clock time, so it sorts before the day's flights; createdAt keeps ties stable
    ...flights.map((f) => ({ date: f.date, at: f.depTimeUtc, createdAt: f.createdAt, row: flightRow(f, persons) })),
    ...fstd.map((s) => ({ date: s.date, at: 0, createdAt: s.createdAt, row: fstdRow(s) })),
  ];
  items.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at || a.createdAt - b.createdAt);
  return items.map((i) => i.row);
}

/** Previous-experience records summed into the "brought forward" figures of the first page. */
export function carryInTotals(experience: PreviousExperience[]): Totals {
  let spSe = 0, spMe = 0, mp = 0, total = 0, ldgDay = 0, ldgNight = 0, night = 0, ifr = 0, pic = 0, copi = 0, dual = 0, inst = 0, fstdTotal = 0;
  for (const e of experience) {
    spSe += e.spSeMin; spMe += e.spMeMin; mp += e.mpMin; total += e.totalMin;
    ldgDay += e.landingsDay; ldgNight += e.landingsNight; night += e.nightMin; ifr += e.ifrMin;
    pic += e.picMin; copi += e.copiMin; dual += e.dualMin; inst += e.instMin;
    fstdTotal += e.fstdMin;
  }
  return { spSe, spMe, mp, total, ldgDay, ldgNight, night, ifr, pic, copi, dual, inst, fstdTotal };
}

// ---------------- pagination and totals ----------------

export interface Page {
  /** 1-based number across the whole document. */
  number: number;
  /** Total pages in the document. */
  of: number;
  rows: PdfRow[];
  /** Sum of the rows on this page. */
  thisPage: Totals;
  /** Brought forward: previous experience plus all earlier pages of this table. */
  previous: Totals;
  /** previous + thisPage. */
  toDate: Totals;
  /** True on the first page of a table, whose "previous" figure is previous experience only. */
  includesCarryIn: boolean;
}

const zero = (ids: string[]): Totals => Object.fromEntries(ids.map((i) => [i, 0]));
const add = (a: Totals, b: Totals): Totals => Object.fromEntries(Object.keys(a).map((k) => [k, a[k]! + (b[k] ?? 0)]));
const sumRows = (ids: string[], rows: PdfRow[]): Totals => {
  const t = zero(ids);
  for (const r of rows) for (const id of ids) t[id]! += Number(r[id] ?? 0);
  return t;
};

/** Split rows over pages. An empty table still yields one (blank) page so the log can be printed as a form. */
export function paginate(table: TableSpec, rows: PdfRow[], carryIn: Totals, perPage = rowsPerPage()): Omit<Page, 'number' | 'of'>[] {
  const ids = sumColumnIds(table);
  const chunks: PdfRow[][] = [];
  for (let i = 0; i < rows.length; i += perPage) chunks.push(rows.slice(i, i + perPage));
  if (chunks.length === 0) chunks.push([]);
  let previous = add(zero(ids), carryIn);
  return chunks.map((chunk, i) => {
    const thisPage = sumRows(ids, chunk);
    const page = { rows: chunk, thisPage, previous, toDate: add(previous, thisPage), includesCarryIn: i === 0 };
    previous = page.toDate;
    return page;
  });
}

export interface DocumentInput {
  flights: Flight[];
  persons: Person[];
  fstd: FstdSession[];
  experience: PreviousExperience[];
  /** AMC1 FCL.050 holder block. Blank values are printed as a rule to fill in by hand. */
  pilotName: string;
  licenceNumber?: string;
  address?: string;
  /** "Generated on" date, dd/mm/yyyy. Passed in so the layout stays deterministic. */
  generatedOn: IsoDate;
}

export interface DocumentModel {
  pilotName: string;
  licenceNumber: string;
  address: string;
  generatedOn: IsoDate;
  pages: Page[];
}

/** The whole printed logbook: one table, flights and simulator sessions in date order. */
export function buildDocument(input: DocumentInput): DocumentModel {
  const rows = logbookRows(input.flights, input.fstd, input.persons);
  const pages = paginate(LOGBOOK_TABLE, rows, carryInTotals(input.experience));
  return {
    pilotName: input.pilotName,
    licenceNumber: input.licenceNumber ?? '',
    address: input.address ?? '',
    generatedOn: input.generatedOn,
    pages: pages.map((p, i) => ({ ...p, number: i + 1, of: pages.length })),
  };
}

/** Minutes in a totals cell, for tests and callers that want plain numbers. */
export const minutesOf = (t: Totals, id: string): Minutes => t[id] ?? 0;
