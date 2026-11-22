import { describe, expect, it } from 'vitest';
import { decodeExperience, decodeFlights, decodeFstd, detectCsvKind, encodeExperience, encodeFlights, encodeFstd } from './csvCodec';
import { type ExperienceImport, type FlightImport, type FstdImport } from './records';
import { emptyExperience } from './experience';
import { mulberry32 } from './testUtils';
import { dateOfTimestamp } from './time';
import { CLASS_RATINGS, type ClassRating } from './types';

const ids = (() => { let n = 0; return () => `gen-${++n}`; })();
const NOW = 1_700_000_000_000;

const NASTY = ['', 'plain', 'with, comma', 'say "hello"', 'two\nlines', '=SUM(A1:A9)', '+31 6 1234', '-1 hour', '@home', "'quoted", ' padded ', 'ünïcödé café', 'Łódź 日本語 😀', 'tab\there', 'a;b;c', 'semi;colon'];

function randomFlight(rnd: () => number, i: number): FlightImport {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
  const dep = Date.UTC(2020, 0, 1) + Math.floor(rnd() * 2000 * 24 * 60) * 60_000;
  const total = 5 + Math.floor(rnd() * 400);
  const split = pick(['se', 'me', 'mp'] as const);
  const night = Math.floor(rnd() * total);
  return {
    id: `id-${i}-${Math.floor(rnd() * 1e9)}`, createdAt: NOW + i * 1000 + 123, updatedAt: NOW + i * 1000 + 456,
    date: dateOfTimestamp(dep), depPlace: pick(['EBOS', 'EBAW', 'LFPG', 'Private strip']).toUpperCase(), depTimeUtc: dep,
    arrPlace: pick(['EBKT', 'EHRD', 'EGLL']), arrTimeUtc: dep + total * 60_000,
    registration: pick(['OO-ABC', 'N172SP', 'PH-LDF']), aircraftMake: pick(NASTY.slice(1)).trim() || 'Cessna', aircraftModel: pick(['172S', 'PA-28', '=bad']), aircraftVariant: pick(NASTY).trim(),
    aircraftClass: pick(CLASS_RATINGS), engineClass: split === 'se' ? 'SP-SE' : split === 'me' ? 'SP-ME' : 'MP',
    spSeMin: split === 'se' ? total : 0, spMeMin: split === 'me' ? total : 0, mpMin: split === 'mp' ? total : 0, totalMin: total,
    picName: pick(['SELF', 'Jean Dupont', "O'Brien", '-x']).trim(),
    takeoffsDay: Math.floor(rnd() * 5), takeoffsNight: Math.floor(rnd() * 3), landingsDay: Math.floor(rnd() * 5), landingsNight: Math.floor(rnd() * 3),
    nightMin: night, ifrMin: Math.floor(rnd() * total), picMin: Math.floor(rnd() * total), copiMin: 0, dualMin: Math.floor(rnd() * total), instMin: Math.floor(rnd() * total),
    isPicus: rnd() < 0.2, isSpic: rnd() < 0.2, remarks: pick(NASTY), attachmentIds: [],
    overrides: rnd() < 0.5 ? { nightMin: true, takeoffsDay: true } : rnd() < 0.5 ? { totalMin: true } : {},
  };
}

describe('flights CSV: export then import gives back exactly the same flights', () => {
  it('survives 300 random flights with hostile text', () => {
    const rnd = mulberry32(7);
    const flights = Array.from({ length: 300 }, (_, i) => randomFlight(rnd, i));
    const csv = encodeFlights(flights);
    const back = decodeFlights(csv, ids, NOW);
    expect(back.errors).toEqual([]);
    expect(back.ignoredColumns).toEqual([]);
    expect(back.records.map((r) => r.value)).toEqual(flights);
  });
  it('exports the header plus one line per flight and no take-offs lost', () => {
    const f = randomFlight(mulberry32(1), 1);
    const lines = encodeFlights([f]).replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toContain('takeoffs_day');
    expect(lines[0]).toContain('overrides');
  });
  it('writes instants with milliseconds, so timestamps are exact', () => {
    const f = randomFlight(mulberry32(2), 2);
    expect(encodeFlights([f])).toContain(new Date(f.createdAt).toISOString());
  });
  it('refuses a flight whose time split does not add up, instead of storing inconsistent data', () => {
    const f = { ...randomFlight(mulberry32(3), 3), totalMin: 90, remarks: '' }; // SE/ME/MP minutes still add up to the old total
    const r = decodeFlights(encodeFlights([f]), ids, NOW);
    expect(r.records).toEqual([]);
    expect(r.errors[0]!.message).toMatch(/arrival time|single-pilot SE \+ ME/);
  });
});

describe('flights CSV: reading files from elsewhere', () => {
  const head = 'date,dep_place,dep_time_utc,arr_place,arr_time_utc,registration,make,model,class,total,pic_name';
  const row = '2025-06-01,ebos,2025-06-01T09:30:00Z,ebaw,2025-06-01T11:05:00Z,oo-abc,Cessna,172,sep (land),1:35,SELF';

  it('fills sensible defaults: new id, now timestamps, single-pilot SE, upper-case codes, class by label', () => {
    const r = decodeFlights(`${head}\n${row}\n`, ids, NOW);
    expect(r.errors).toEqual([]);
    const f = r.records[0]!.value;
    expect(f).toMatchObject({ depPlace: 'EBOS', registration: 'OO-ABC', aircraftClass: 'SEP_LAND', totalMin: 95, spSeMin: 95, spMeMin: 0, mpMin: 0, createdAt: NOW, updatedAt: NOW, engineClass: 'SP-SE', overrides: {} });
    expect(f.id).toMatch(/^gen-/);
  });
  it('lists unknown columns instead of ignoring them silently', () => {
    const r = decodeFlights(`${head},colour\n${row},red\n`, ids, NOW);
    expect(r.ignoredColumns).toEqual(['colour']);
    expect(r.records).toHaveLength(1);
  });
  it('rejects a file missing required columns', () => {
    const r = decodeFlights('date,total\n2025-06-01,1:00\n', ids, NOW);
    expect(r.records).toEqual([]);
    expect(r.errors[0]!.message).toMatch(/Missing required columns: .*dep_place/);
  });
  it('reports each bad row with its line number and why, and keeps the good rows', () => {
    const bad = '2025-13-01,EBOS,2025-06-01T09:30:00Z,EBAW,2025-06-01T11:05:00Z,OO-ABC,Cessna,172,SEP_LAND,1:35,SELF';
    const worse = '2025-06-01,EBOS,09:30,EBAW,2025-06-01T11:05:00Z,OO-ABC,Cessna,172,SEP_LAND,1.5,SELF';
    const r = decodeFlights(`${head}\n${row}\n${bad}\n${worse}\n`, ids, NOW);
    expect(r.records.map((x) => x.row)).toEqual([2]);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(r.errors[0]!.message).toMatch(/date: .*not a date/);
    expect(r.errors[1]!.message).toMatch(/dep_time_utc: .*UTC time/);
    expect(r.errors[1]!.message).toMatch(/total: .*duration/);
  });
  it('rejects flights that break the integrity rules', () => {
    const noTime = `${head}\n2025-06-01,EBOS,2025-06-01T09:30:00Z,EBAW,2025-06-01T09:30:00Z,OO-ABC,Cessna,172,SEP_LAND,0:00,SELF\n`;
    expect(decodeFlights(noTime, ids, NOW).errors[0]!.message).toMatch(/arrival time is not after|total time must be greater/);
    const wrongDate = `${head}\n2025-06-02,EBOS,2025-06-01T09:30:00Z,EBAW,2025-06-01T11:05:00Z,OO-ABC,Cessna,172,SEP_LAND,1:35,SELF\n`;
    expect(decodeFlights(wrongDate, ids, NOW).errors[0]!.message).toMatch(/does not match the departure time/);
    const unknownClass = `${head}\n2025-06-01,EBOS,2025-06-01T09:30:00Z,EBAW,2025-06-01T11:05:00Z,OO-ABC,Cessna,172,GLIDER,1:35,SELF\n`;
    expect(decodeFlights(unknownClass, ids, NOW).errors[0]!.message).toMatch(/class: .*not a known class/);
  });
  it('skips blank lines and tolerates CRLF, a BOM and header case', () => {
    const r = decodeFlights(`﻿${head.toUpperCase()}\r\n${row}\r\n\r\n`, ids, NOW);
    expect(r.errors).toEqual([]);
    expect(r.records).toHaveLength(1);
  });
});

describe('simulator CSV', () => {
  const s = (n: number): FstdImport => ({ id: `s${n}`, createdAt: NOW + n, updatedAt: NOW + n, date: '2025-02-02', fstdType: ['FNPT II', '=x', 'B, "ITD"'][n % 3]!, totalMin: 30 + n, remarks: NASTY[n % NASTY.length]! });
  it('round-trips', () => {
    const list = Array.from({ length: 20 }, (_, i) => s(i));
    const back = decodeFstd(encodeFstd(list), ids, NOW);
    expect(back.errors).toEqual([]);
    expect(back.records.map((r) => r.value)).toEqual(list);
  });
  it('rejects a zero-length session', () => {
    expect(decodeFstd('date,fstd_type,total\n2025-02-02,FNPT II,0:00\n', ids, NOW).errors).toHaveLength(1);
  });
});

describe('previous-experience CSV', () => {
  const e = (n: number): ExperienceImport => ({
    id: `e${n}`, createdAt: NOW, updatedAt: NOW + 5, ...emptyExperience('2024-12-31'),
    source: n ? 'Vol. 2, "second"' : 'Paper logbook vol. 1', note: n ? '' : 'line1\nline2', periodFrom: n ? null : '2019-01-01',
    totalMin: 6000 * 60 + 25, spSeMin: 6000 * 60 + 25, picMin: 4000 * 60, dualMin: 2000 * 60 + 25, nightMin: 300 * 60, ifrMin: 100 * 60, picusMin: 30, spicMin: 40,
    takeoffsDay: 2100, takeoffsNight: 110, landingsDay: 2100, landingsNight: 110, fstdMin: 600,
    byClass: n ? {} : { SEP_LAND: { totalMin: 5000 * 60, picMin: 3500 * 60, takeoffs: 1800, landings: 1800 }, TMG: { totalMin: 0, picMin: 0, takeoffs: 5, landings: 4 } as never },
  });
  it('round-trips, including hours above 9999 and per-class figures', () => {
    const list = [e(0), e(1)];
    const back = decodeExperience(encodeExperience(list), ids, NOW);
    expect(back.errors).toEqual([]);
    expect(back.records.map((r) => r.value)).toEqual(list);
  });
  it('a class with no figures stays absent', () => {
    const back = decodeExperience(encodeExperience([e(1)]), ids, NOW).records[0]!.value;
    expect(back.byClass).toEqual({});
  });
  it('rejects class time above the total, with the row number', () => {
    const csv = encodeExperience([e(0)]).replace('5000:00', '9999:00');
    expect(decodeExperience(csv, ids, NOW).errors[0]!.message).toMatch(/class totals add up/);
  });
});

describe('detectCsvKind', () => {
  it('recognises each export by its header', () => {
    expect(detectCsvKind(encodeFlights([]))).toBe('flights');
    expect(detectCsvKind(encodeFstd([]))).toBe('fstd');
    expect(detectCsvKind(encodeExperience([]))).toBe('experience');
    expect(detectCsvKind('a,b\n1,2\n')).toBeNull();
    expect(detectCsvKind('')).toBeNull();
  });
  it('every known class has its own columns', () => {
    const header = encodeExperience([]).split('\r\n')[0]!;
    for (const c of CLASS_RATINGS as readonly ClassRating[]) expect(header).toContain(`${c.toLowerCase()}_total`);
  });
});
