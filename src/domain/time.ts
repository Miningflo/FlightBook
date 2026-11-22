import type { IsoDate, Minutes, Timestamp } from './types';

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Minutes -> "HH:MM". Hours are not capped (e.g. 1234:05 for lifetime totals). */
export function formatHHMM(totalMinutes: Minutes): string {
  const sign = totalMinutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(totalMinutes));
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** "H:MM" / "HH:MM" -> minutes, or null if malformed (minutes must be 00-59). */
export function parseHHMM(text: string): Minutes | null {
  const m = /^(\d{1,6}):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "HH:MM" clock time of day -> minutes since midnight (00:00-23:59), or null. */
export function parseClock(text: string): Minutes | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True if `text` is a real calendar date `YYYY-MM-DD`. */
export function isValidIsoDate(text: string): boolean {
  const m = DATE_RE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** UTC timestamp for a date plus a clock time. Returns null if either is invalid. */
export function utcTimestamp(date: IsoDate, clock: string): Timestamp | null {
  if (!isValidIsoDate(date)) return null;
  const mins = parseClock(clock);
  if (mins === null) return null;
  const m = DATE_RE.exec(date)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + mins * MS_PER_MIN;
}

/** `YYYY-MM-DD` of a UTC timestamp. */
export function dateOfTimestamp(ts: Timestamp): IsoDate {
  return new Date(ts).toISOString().slice(0, 10);
}

/** `HH:MM` (UTC) of a timestamp. */
export function clockOfTimestamp(ts: Timestamp): string {
  const d = new Date(ts);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** Whole minutes between two timestamps (arr - dep). Negative if arrival precedes departure. */
export function minutesBetween(dep: Timestamp, arr: Timestamp): Minutes {
  return Math.round((arr - dep) / MS_PER_MIN);
}

/**
 * Resolve on-blocks from the departure date and two clock times (UTC).
 * If the arrival clock is earlier than the departure clock the flight is taken
 * to cross midnight UTC (arrival on the next day). Equal clocks give a
 * zero-length flight, which validation rejects. Flights of 24 h or more
 * are not representable this way (not a concern for a PPL logbook).
 */
export function resolveBlockTimes(
  date: IsoDate,
  depClock: string,
  arrClock: string,
): { dep: Timestamp; arr: Timestamp } | null {
  const dep = utcTimestamp(date, depClock);
  let arr = utcTimestamp(date, arrClock);
  if (dep === null || arr === null) return null;
  if (arr < dep) arr += MS_PER_DAY;
  return { dep, arr };
}

/** Block time in minutes from off-blocks / on-blocks inputs, or null if inputs are invalid. */
export function blockMinutes(date: IsoDate, depClock: string, arrClock: string): Minutes | null {
  const t = resolveBlockTimes(date, depClock, arrClock);
  return t ? minutesBetween(t.dep, t.arr) : null;
}

// ---- calendar-date arithmetic (UTC dates, no time zones involved) ----

function parseDate(d: IsoDate): { y: number; m: number; day: number } {
  const m = DATE_RE.exec(d);
  if (!m) throw new Error(`Invalid date: ${d}`);
  return { y: Number(m[1]), m: Number(m[2]), day: Number(m[3]) };
}

const fmt = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

/** Today's UTC date for a timestamp. */
export function utcDateOf(ts: Timestamp): IsoDate {
  return fmt(ts);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const { y, m, day } = parseDate(d);
  return fmt(Date.UTC(y, m - 1, day) + n * MS_PER_DAY);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const pa = parseDate(a), pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.day) - Date.UTC(pa.y, pa.m - 1, pa.day)) / MS_PER_DAY);
}

/** Add calendar months; a day that does not exist in the target month is clamped (31 Mar - 1 month = 28/29 Feb). */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const { y, m, day } = parseDate(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fmt(Date.UTC(ny, nm, Math.min(day, last)));
}
