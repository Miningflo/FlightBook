import type { BaseRecord, FstdSession, IsoDate } from './types';
import { isValidIsoDate } from './time';
import type { ValidationIssue } from './flightForm';

export type FstdInput = Omit<FstdSession, keyof BaseRecord>;

export function emptyFstd(today: IsoDate): FstdInput {
  return { date: today, fstdType: '', totalMin: 0, remarks: '' };
}

export function validateFstd(d: FstdInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!isValidIsoDate(d.date)) out.push({ field: 'date', message: 'Enter a valid date.', severity: 'error' });
  if (!d.fstdType.trim()) out.push({ field: 'fstdType', message: 'Enter the FSTD type (e.g. FNPT II).', severity: 'error' });
  if (!Number.isInteger(d.totalMin) || d.totalMin <= 0) out.push({ field: 'totalMin', message: 'Session time must be greater than zero.', severity: 'error' });
  else if (d.totalMin > 12 * 60) out.push({ field: 'totalMin', message: 'More than 12 hours in one session; check this is right.', severity: 'warning' });
  return out;
}

export function normalizeFstd(d: FstdInput): FstdInput {
  return { ...d, fstdType: d.fstdType.trim(), remarks: d.remarks.trim() };
}

/** Known types, most recently used first, for suggestions. */
export function fstdTypeSuggestions(sessions: FstdSession[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
    if (!seen.has(s.fstdType)) { seen.add(s.fstdType); out.push(s.fstdType); }
  }
  return out;
}
