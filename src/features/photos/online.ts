import type { PhotoCacheEntry } from '../../domain/types';
import { lookupCommonsPhoto } from './commons';
import { lookupPlanespottersPhoto } from './planespotters';

/** Bump when lookup logic changes so cached "no photo" results are re-checked. */
export const LOOKUP_VERSION = 2;

/**
 * Planespotters first (aircraft-specific, curated), then Wikimedia Commons.
 * A failure of one source falls through to the next. "No photo" is only returned
 * when no source failed, so an outage is never cached as "this aircraft has no photo".
 * Throws if every source that was tried failed.
 */
export async function lookupOnlinePhoto(
  registration: string,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
): Promise<PhotoCacheEntry> {
  const reg = registration.trim().toUpperCase();
  let failures = 0;
  let lastError: unknown;

  try {
    const ps = await lookupPlanespottersPhoto(reg, fetchFn, now);
    if (ps) return { ...ps, lookupVersion: LOOKUP_VERSION };
  } catch (e) {
    failures++;
    lastError = e;
  }
  try {
    const c = await lookupCommonsPhoto(reg, fetchFn, now);
    if (c.status === 'found') return { ...c, lookupVersion: LOOKUP_VERSION };
  } catch (e) {
    failures++;
    lastError = e;
  }
  if (failures > 0) throw lastError instanceof Error ? lastError : new Error('Photo lookup failed');
  return { registration: reg, status: 'none', fetchedAt: now, lookupVersion: LOOKUP_VERSION };
}
