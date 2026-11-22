import { describe, expect, it } from 'vitest';
import { emptyClassCarryIn, emptyExperience, normalizeExperience, validateExperience } from './experience';
import { emptyFstd, fstdTypeSuggestions, normalizeFstd, validateFstd } from './fstd';
import type { FstdSession } from './types';

const ok = () => ({ ...emptyExperience('2024-12-31'), source: 'Paper logbook vol. 1', totalMin: 6000, spSeMin: 6000, picMin: 4000 });
const fields = (d: ReturnType<typeof ok>, sev: 'error' | 'warning' = 'error') => validateExperience(d).filter((i) => i.severity === sev).map((i) => i.field);

describe('validateExperience', () => {
  it('accepts a complete record', () => expect(validateExperience(ok())).toEqual([]));
  it('requires a source and a valid end date', () => {
    expect(fields({ ...ok(), source: '  ' })).toContain('source');
    expect(fields({ ...ok(), periodTo: '2024-02-30' })).toContain('periodTo');
  });
  it('checks the start date', () => {
    expect(fields({ ...ok(), periodFrom: '2025-01-01' })).toContain('periodFrom');
    expect(fields({ ...ok(), periodFrom: 'garbage' })).toContain('periodFrom');
    expect(fields({ ...ok(), periodFrom: '2019-01-01' })).not.toContain('periodFrom');
  });
  it('rejects negative and fractional numbers', () => {
    expect(fields({ ...ok(), nightMin: -1 })).toContain('nightMin');
    expect(fields({ ...ok(), takeoffsDay: 1.5 })).toContain('takeoffsDay');
  });
  it('rejects any sub-total above the total flight time', () => {
    for (const f of ['picMin', 'copiMin', 'dualMin', 'instMin', 'nightMin', 'ifrMin', 'picusMin', 'spicMin'] as const) {
      expect(fields({ ...ok(), [f]: 6001 })).toContain(f);
    }
  });
  it('warns, without blocking, when SE + ME + MP does not equal the total', () => {
    const d = { ...ok(), spSeMin: 5000 };
    expect(validateExperience(d).find((i) => i.field === 'spSeMin')?.severity).toBe('warning');
    expect(fields(d)).toEqual([]);
  });
  it('checks per-class figures, and that classes do not add up to more than the total', () => {
    const c = (totalMin: number, picMin = 0) => ({ ...emptyClassCarryIn(), totalMin, picMin });
    expect(fields({ ...ok(), byClass: { SEP_LAND: c(4000), TMG: c(2000) } })).toEqual([]);
    expect(fields({ ...ok(), byClass: { SEP_LAND: c(4000), TMG: c(2001) } })).toContain('byClass');
    expect(fields({ ...ok(), byClass: { SEP_LAND: c(100, 200) } })).toContain('class-SEP_LAND');
  });
  it('simulator time is independent of flight time', () => {
    expect(fields({ ...ok(), fstdMin: 99999 })).toEqual([]);
  });
  it('warns about a future end date', () => {
    expect(validateExperience({ ...ok(), periodTo: '2030-01-01' }, '2025-06-30').some((i) => i.field === 'periodTo' && i.severity === 'warning')).toBe(true);
  });
});

describe('normalizeExperience', () => {
  it('trims text, drops all-zero class rows and turns an empty start into null', () => {
    const d = normalizeExperience({ ...ok(), source: ' vol 1 ', note: ' x ', periodFrom: '' as unknown as null, byClass: { SEP_LAND: { totalMin: 10, picMin: 0, takeoffs: 0, landings: 0 }, TMG: emptyClassCarryIn() } });
    expect(d.source).toBe('vol 1');
    expect(d.note).toBe('x');
    expect(d.periodFrom).toBeNull();
    expect(Object.keys(d.byClass)).toEqual(['SEP_LAND']);
  });
});

describe('FSTD sessions', () => {
  const good = { ...emptyFstd('2025-06-30'), fstdType: 'FNPT II', totalMin: 60 };
  it('validates date, type and time', () => {
    expect(validateFstd(good)).toEqual([]);
    expect(validateFstd({ ...good, fstdType: ' ' }).map((i) => i.field)).toContain('fstdType');
    expect(validateFstd({ ...good, totalMin: 0 }).map((i) => i.field)).toContain('totalMin');
    expect(validateFstd({ ...good, date: '2025-13-01' }).map((i) => i.field)).toContain('date');
    expect(validateFstd({ ...good, totalMin: 13 * 60 })[0]!.severity).toBe('warning');
  });
  it('normalises text', () => {
    expect(normalizeFstd({ ...good, fstdType: ' FNPT II ', remarks: ' x ' })).toMatchObject({ fstdType: 'FNPT II', remarks: 'x' });
  });
  it('suggests types by most recent use, without duplicates', () => {
    const s = (date: string, fstdType: string): FstdSession => ({ id: date, createdAt: 1, updatedAt: 1, date, fstdType, totalMin: 60, remarks: '' });
    expect(fstdTypeSuggestions([s('2025-01-01', 'BITD'), s('2025-03-01', 'FNPT II'), s('2025-02-01', 'BITD')])).toEqual(['FNPT II', 'BITD']);
  });
});
