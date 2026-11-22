import type { Flight, FstdSession, IsoDate, Minutes, Person, PreviousExperience } from './types';
import { clockOfTimestamp, formatHHMM } from './time';

/**
 * Layout specification of the printed logbook (A4 landscape), following the column
 * structure of AMC1 FCL.050. This module is PURE: it knows nothing about pdf-lib or the
 * app's screens. It decides which columns exist, how wide they are, which rows go on which
 * page, and the per-page / brought-forward / to-date totals. The renderer only draws it.
 *
 * TODO(verify): the column set and order below are written from memory of AMC1 FCL.050
 * and must be compared with the current AMC text (or your paper logbook):
 *   (1) date  (2) departure place + time  (3) arrival place + time  (4) aircraft make,
 *   model, variant + registration  (5) single-pilot time SE / ME, multi-pilot time
 *   (6) total time of flight  (7) name(s) of PIC  (8) landings day / night
 *   (9) operational condition time night / IFR  (10) pilot function time PIC / co-pilot /
 *   dual / instructor  (11) FSTD session date, type, total time  (12) remarks and endorsements.
 * Open points: FSTD sessions are printed as a separate section (the AMC may place them in the
 * same table); PICUS/SPIC are printed in the remarks column because the AMC has no column for them;
 * take-offs are not printed (the AMC lists landings only).
 */

export const PAGE = {
  width: 841.89, // A4 landscape, points
  height: 595.28,
  margin: 28,
  titleH: 24,
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
  id: 'flights' | 'fstd';
  title: string;
  groups: GroupSpec[];
}

const col = (id: string, label: string[], width: number | 'flex', kind: CellKind, o: Partial<ColumnSpec> = {}): ColumnSpec => ({
  id, label, width, kind, align: kind === 'duration' || kind === 'count' ? 'right' : kind === 'text' ? 'left' : 'center', sum: false, ...o,
});
const dur = (id: string, label: string[], width = 27): ColumnSpec => col(id, label, width, 'duration', { sum: true });

export const FLIGHTS_TABLE: TableSpec = {
  id: 'flights',
  title: "PILOT'S LOGBOOK",
  groups: [
    { label: ['DATE', '(dd/mm/yyyy)'], columns: [col('date', ['DATE'], 44, 'date')] },
    { label: ['DEPARTURE'], columns: [col('depPlace', ['Place'], 28, 'text'), col('depTime', ['Time', '(UTC)'], 26, 'time')] },
    { label: ['ARRIVAL'], columns: [col('arrPlace', ['Place'], 28, 'text'), col('arrTime', ['Time', '(UTC)'], 26, 'time')] },
    { label: ['AIRCRAFT'], columns: [col('aircraftType', ['Make, model,', 'variant'], 80, 'text'), col('registration', ['Registration'], 40, 'text')] },
    { label: ['SINGLE-PILOT', 'TIME'], columns: [dur('spSe', ['SE']), dur('spMe', ['ME'])] },
    { label: ['MULTI-PILOT', 'TIME'], columns: [dur('mp', ['MP'], 34)] },
    { label: ['TOTAL TIME', 'OF FLIGHT'], columns: [dur('total', ['TOTAL'], 36)] },
    { label: ['NAME(S) OF PIC'], columns: [col('picName', ['NAME(S) OF PIC'], 52, 'text')] },
    { label: ['LANDINGS'], columns: [col('ldgDay', ['Day'], 20, 'count', { sum: true }), col('ldgNight', ['Night'], 22, 'count', { sum: true })] },
    { label: ['OPERATIONAL', 'CONDITION TIME'], columns: [dur('night', ['Night']), dur('ifr', ['IFR'])] },
    { label: ['PILOT FUNCTION TIME'], columns: [dur('pic', ['PIC']), dur('copi', ['CO-PILOT'], 30), dur('dual', ['DUAL']), dur('inst', ['INSTR.'])] },
    { label: ['REMARKS AND', 'ENDORSEMENTS'], columns: [col('remarks', ['REMARKS AND ENDORSEMENTS'], 'flex', 'text')] },
  ],
};

export const FSTD_TABLE: TableSpec = {
  id: 'fstd',
  title: 'FSTD SESSIONS',
  groups: [
    { label: ['DATE', '(dd/mm/yyyy)'], columns: [col('date', ['DATE'], 60, 'date')] },
    { label: ['FSTD TYPE'], columns: [col('fstdType', ['TYPE'], 160, 'text')] },
    { label: ['TOTAL TIME', 'OF SESSION'], columns: [dur('total', ['TOTAL'], 60)] },
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

export function fstdRow(s: FstdSession): PdfRow {
  return { date: s.date, fstdType: s.fstdType, total: s.totalMin, remarks: s.remarks.trim() };
}

/** Previous-experience records summed into the "brought forward" figures of the first page. */
export function flightCarryIn(experience: PreviousExperience[]): Totals {
  let spSe = 0, spMe = 0, mp = 0, total = 0, ldgDay = 0, ldgNight = 0, night = 0, ifr = 0, pic = 0, copi = 0, dual = 0, inst = 0;
  for (const e of experience) {
    spSe += e.spSeMin; spMe += e.spMeMin; mp += e.mpMin; total += e.totalMin;
    ldgDay += e.landingsDay; ldgNight += e.landingsNight; night += e.nightMin; ifr += e.ifrMin;
    pic += e.picMin; copi += e.copiMin; dual += e.dualMin; inst += e.instMin;
  }
  return { spSe, spMe, mp, total, ldgDay, ldgNight, night, ifr, pic, copi, dual, inst };
}

export function fstdCarryIn(experience: PreviousExperience[]): Totals {
  return { total: experience.reduce((a, e) => a + e.fstdMin, 0) };
}

// ---------------- pagination and totals ----------------

export interface Page {
  table: TableSpec['id'];
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
    const page = { table: table.id, rows: chunk, thisPage, previous, toDate: add(previous, thisPage), includesCarryIn: i === 0 };
    previous = page.toDate;
    return page;
  });
}

export interface DocumentInput {
  flights: Flight[];
  persons: Person[];
  fstd: FstdSession[];
  experience: PreviousExperience[];
  pilotName: string;
  /** "Generated on" date, dd/mm/yyyy. Passed in so the layout stays deterministic. */
  generatedOn: IsoDate;
}

export interface DocumentModel {
  pilotName: string;
  generatedOn: IsoDate;
  pages: Page[];
}

/** The whole printed logbook: flight pages, then (if there is anything to show) FSTD pages. */
export function buildDocument(input: DocumentInput): DocumentModel {
  const flights = [...input.flights].sort((a, b) => a.depTimeUtc - b.depTimeUtc || a.createdAt - b.createdAt);
  const fstd = [...input.fstd].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const flightPages = paginate(FLIGHTS_TABLE, flights.map((f) => flightRow(f, input.persons)), flightCarryIn(input.experience));
  const showFstd = fstd.length > 0 || input.experience.some((e) => e.fstdMin > 0);
  const fstdPages = showFstd ? paginate(FSTD_TABLE, fstd.map(fstdRow), fstdCarryIn(input.experience)) : [];
  const all = [...flightPages, ...fstdPages];
  return {
    pilotName: input.pilotName,
    generatedOn: input.generatedOn,
    pages: all.map((p, i) => ({ ...p, number: i + 1, of: all.length })),
  };
}

export const tableFor = (id: TableSpec['id']): TableSpec => (id === 'flights' ? FLIGHTS_TABLE : FSTD_TABLE);

/** Minutes in a totals cell, for tests and callers that want plain numbers. */
export const minutesOf = (t: Totals, id: string): Minutes => t[id] ?? 0;
