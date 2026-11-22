import { describe, expect, it } from 'vitest';
import {
  FLIGHTS_TABLE, FSTD_TABLE, PAGE, USABLE_WIDTH, buildDocument, dmy, flightCarryIn, flightRow, formatCell, fstdRow,
  paginate, placeColumns, rowsPerPage, sumColumnIds,
} from './pdfLayout';
import { flight } from './testFactories';
import { emptyExperience } from './experience';
import { computeTotals } from './totals';
import type { FstdSession, Person, PreviousExperience } from './types';

const self: Person = { id: 'p', name: 'SELF', nameKey: 'self', isSelf: true, createdAt: 1, updatedAt: 1 };
const exp = (o: Partial<PreviousExperience> = {}): PreviousExperience => ({ id: 'e', createdAt: 1, updatedAt: 1, ...emptyExperience('2024-12-31'), ...o });
const fstd = (date: string, totalMin: number, fstdType = 'FNPT II'): FstdSession => ({ id: date + fstdType, createdAt: 1, updatedAt: 1, date, fstdType, totalMin, remarks: '' });
const input = (o = {}) => ({ flights: [], persons: [self], fstd: [], experience: [], pilotName: 'A. Pilot', generatedOn: '2025-06-30', ...o });
const days = (n: number) => Array.from({ length: n }, (_, i) => `2025-03-${String(i + 1).padStart(2, '0')}`);

describe('column specification (AMC1 FCL.050)', () => {
  it('has the AMC column groups in order', () => {
    expect(FLIGHTS_TABLE.groups.map((g) => g.label.join(' '))).toEqual([
      'DATE (dd/mm/yyyy)', 'DEPARTURE', 'ARRIVAL', 'AIRCRAFT', 'SINGLE-PILOT TIME', 'MULTI-PILOT TIME', 'TOTAL TIME OF FLIGHT',
      'NAME(S) OF PIC', 'LANDINGS', 'OPERATIONAL CONDITION TIME', 'PILOT FUNCTION TIME', 'REMARKS AND ENDORSEMENTS',
    ]);
    expect(FLIGHTS_TABLE.groups.flatMap((g) => g.columns.map((c) => c.id))).toEqual([
      'date', 'depPlace', 'depTime', 'arrPlace', 'arrTime', 'aircraftType', 'registration', 'spSe', 'spMe', 'mp', 'total',
      'picName', 'ldgDay', 'ldgNight', 'night', 'ifr', 'pic', 'copi', 'dual', 'inst', 'remarks',
    ]);
  });
  it('sums exactly the time and landing columns', () => {
    expect(sumColumnIds(FLIGHTS_TABLE)).toEqual(['spSe', 'spMe', 'mp', 'total', 'ldgDay', 'ldgNight', 'night', 'ifr', 'pic', 'copi', 'dual', 'inst']);
    expect(sumColumnIds(FSTD_TABLE)).toEqual(['total']);
  });
  it('column ids are unique and widths fill the page exactly, leaving a readable remarks column', () => {
    for (const t of [FLIGHTS_TABLE, FSTD_TABLE]) {
      const placed = placeColumns(t);
      expect(new Set(placed.map((c) => c.id)).size).toBe(placed.length);
      const last = placed[placed.length - 1]!;
      expect(last.x + last.w).toBeCloseTo(PAGE.width - PAGE.margin, 6);
      expect(placed.reduce((a, c) => a + c.w, 0)).toBeCloseTo(USABLE_WIDTH, 6);
      expect(placed.find((c) => c.id === 'remarks')!.w).toBeGreaterThan(100);
      for (let i = 1; i < placed.length; i++) expect(placed[i]!.x).toBeCloseTo(placed[i - 1]!.x + placed[i - 1]!.w, 6);
    }
  });
  it('is A4 landscape', () => {
    expect(PAGE.width).toBeGreaterThan(PAGE.height);
    expect(PAGE.width).toBeCloseTo(841.89, 2);
    expect(PAGE.height).toBeCloseTo(595.28, 2);
  });
  it('fits a sensible number of rows per page', () => {
    expect(rowsPerPage()).toBeGreaterThanOrEqual(18);
    expect(rowsPerPage()).toBeLessThanOrEqual(30);
  });
});

describe('cells and rows', () => {
  it('formats dates as dd/mm/yyyy and durations as HH:MM, blank for zero only in data rows', () => {
    expect(dmy('2025-06-01')).toBe('01/06/2025');
    expect(formatCell('date', '2025-06-01', { blankZero: true })).toBe('01/06/2025');
    expect(formatCell('duration', 95, { blankZero: true })).toBe('01:35');
    expect(formatCell('duration', 0, { blankZero: true })).toBe('');
    expect(formatCell('duration', 0, { blankZero: false })).toBe('00:00');
    expect(formatCell('duration', 6000 * 60, { blankZero: false })).toBe('6000:00');
    expect(formatCell('count', 0, { blankZero: true })).toBe('');
    expect(formatCell('count', 12, { blankZero: false })).toBe('12');
  });
  it('builds a flight row in UTC with the PIC name, landings (not take-offs) and flags in the remarks', () => {
    const r = flightRow(flight('2025-06-01', { depTimeUtc: Date.parse('2025-06-01T09:30:00Z'), arrTimeUtc: Date.parse('2025-06-01T11:05:00Z'), totalMin: 95, spSeMin: 95, picMin: 95, landingsDay: 2, landingsNight: 1, takeoffsDay: 9, isPicus: true, remarks: ' hello ' }), [self]);
    expect(r).toMatchObject({ date: '2025-06-01', depTime: '09:30', arrTime: '11:05', depPlace: 'EBOS', arrPlace: 'EBAW', registration: 'OO-ABC', aircraftType: 'Cessna 172', total: 95, spSe: 95, picName: 'SELF', ldgDay: 2, ldgNight: 1, remarks: 'PICUS · hello' });
    expect(Object.keys(r)).not.toContain('takeoffsDay');
  });
  it('shows an unknown PIC as a question mark rather than hiding the flight', () => {
    expect(flightRow(flight('2025-06-01', { picNameId: 'gone' }), [self]).picName).toBe('?');
  });
  it('builds an FSTD row', () => {
    expect(fstdRow(fstd('2025-02-02', 45))).toEqual({ date: '2025-02-02', fstdType: 'FNPT II', total: 45, remarks: '' });
  });
});

describe('pagination and totals', () => {
  const per = rowsPerPage();
  const rowsOf = (n: number) => days(Math.min(n, 31)).concat(n > 31 ? Array.from({ length: n - 31 }, () => '2025-04-01') : []).map((d) => flightRow(flight(d, { totalMin: 60, spSeMin: 60, picMin: 60, landingsDay: 1 }), [self]));

  it('an empty logbook is one blank page that can be printed as a form', () => {
    const p = paginate(FLIGHTS_TABLE, [], flightCarryIn([]));
    expect(p).toHaveLength(1);
    expect(p[0]!.rows).toEqual([]);
    expect(p[0]!.thisPage.total).toBe(0);
  });
  it('fills a page exactly, then starts the next page with one row', () => {
    expect(paginate(FLIGHTS_TABLE, rowsOf(per), {}).length).toBe(1);
    const pages = paginate(FLIGHTS_TABLE, rowsOf(per + 1), {});
    expect(pages.map((p) => p.rows.length)).toEqual([per, 1]);
  });
  it('page totals, brought-forward and to-date chain correctly across pages', () => {
    const pages = paginate(FLIGHTS_TABLE, rowsOf(per * 2 + 5), {});
    expect(pages).toHaveLength(3);
    expect(pages[0]!.thisPage.total).toBe(per * 60);
    expect(pages[0]!.previous.total).toBe(0);
    expect(pages[1]!.previous.total).toBe(per * 60);
    expect(pages[1]!.toDate.total).toBe(per * 2 * 60);
    expect(pages[2]!.previous.total).toBe(per * 2 * 60);
    expect(pages[2]!.thisPage.total).toBe(5 * 60);
    expect(pages[2]!.toDate.total).toBe((per * 2 + 5) * 60);
    expect(pages[2]!.thisPage.ldgDay).toBe(5);
    for (const p of pages) for (const k of Object.keys(p.toDate)) expect(p.toDate[k]).toBe(p.previous[k]! + p.thisPage[k]!);
  });
  it('page 1 is brought forward from previous experience, and only page 1 says so', () => {
    const carry = flightCarryIn([exp({ totalMin: 6000, spSeMin: 6000, picMin: 4000, landingsDay: 200, landingsNight: 10, nightMin: 300 }), exp({ totalMin: 600, spSeMin: 600, picMin: 600 })]);
    expect(carry).toMatchObject({ total: 6600, spSe: 6600, pic: 4600, ldgDay: 200, ldgNight: 10, night: 300 });
    const pages = paginate(FLIGHTS_TABLE, rowsOf(per + 1), carry);
    expect(pages[0]!.previous.total).toBe(6600);
    expect(pages[0]!.includesCarryIn).toBe(true);
    expect(pages[1]!.includesCarryIn).toBe(false);
    expect(pages[1]!.previous.total).toBe(6600 + per * 60);
    expect(pages[1]!.toDate.total).toBe(6600 + (per + 1) * 60);
  });
});

describe('buildDocument', () => {
  it('sorts flights chronologically and numbers pages across the document', () => {
    const f1 = flight('2025-03-05', { depTimeUtc: Date.parse('2025-03-05T10:00:00Z') });
    const f2 = flight('2025-03-01', { depTimeUtc: Date.parse('2025-03-01T10:00:00Z') });
    const doc = buildDocument(input({ flights: [f1, f2] }));
    expect(doc.pages[0]!.rows.map((r) => r.date)).toEqual(['2025-03-01', '2025-03-05']);
    expect(doc.pages.map((p) => [p.number, p.of])).toEqual([[1, 1]]);
  });
  it('adds an FSTD section only when there is something to show', () => {
    expect(buildDocument(input()).pages.map((p) => p.table)).toEqual(['flights']);
    const withSessions = buildDocument(input({ fstd: [fstd('2025-02-02', 45), fstd('2025-01-01', 30)] }));
    expect(withSessions.pages.map((p) => p.table)).toEqual(['flights', 'fstd']);
    expect(withSessions.pages[1]!.rows.map((r) => r.date)).toEqual(['2025-01-01', '2025-02-02']);
    expect(withSessions.pages[1]!.thisPage.total).toBe(75);
    expect(withSessions.pages.map((p) => [p.number, p.of])).toEqual([[1, 2], [2, 2]]);
    const carryOnly = buildDocument(input({ experience: [exp({ fstdMin: 600 })] }));
    expect(carryOnly.pages.map((p) => p.table)).toEqual(['flights', 'fstd']);
    expect(carryOnly.pages[1]!.previous.total).toBe(600);
  });
  it('printed totals agree with the Totals screen (the same records, computed two independent ways)', () => {
    const flights = Array.from({ length: 53 }, (_, i) => flight(`2025-0${1 + (i % 6)}-${String(1 + (i % 27)).padStart(2, '0')}`, {
      depTimeUtc: Date.parse('2025-01-01T08:00:00Z') + i * 86_400_000, totalMin: 30 + i, spSeMin: 30 + i, picMin: i % 2 ? 30 + i : 0, dualMin: i % 2 ? 0 : 30 + i,
      nightMin: i % 5, landingsDay: i % 3, landingsNight: i % 2,
    }));
    const experience = [exp({ totalMin: 6000, spSeMin: 6000, picMin: 4000, dualMin: 2000, nightMin: 300, landingsDay: 200, landingsNight: 10, fstdMin: 90 })];
    const sessions = [fstd('2025-01-05', 45), fstd('2025-02-05', 20)];
    const doc = buildDocument(input({ flights, experience, fstd: sessions }));
    const t = computeTotals({ flights, fstd: sessions, experience });
    const lastFlights = [...doc.pages].reverse().find((p) => p.table === 'flights')!;
    const lastFstd = [...doc.pages].reverse().find((p) => p.table === 'fstd')!;
    expect(lastFlights.toDate).toMatchObject({
      total: t.flightMin, spSe: t.spSeMin, spMe: t.spMeMin, mp: t.mpMin, night: t.nightMin, ifr: t.ifrMin,
      pic: t.roles.PIC, copi: t.roles.COPI, dual: t.roles.DUAL, inst: t.roles.INS, ldgDay: t.landingsDay, ldgNight: t.landingsNight,
    });
    expect(lastFstd.toDate.total).toBe(t.fstdMin);
    expect(doc.pages.filter((p) => p.table === 'flights').reduce((a, p) => a + p.rows.length, 0)).toBe(53);
  });
});
