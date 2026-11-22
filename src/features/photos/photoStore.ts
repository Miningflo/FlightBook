import type { LogbookDB } from '../../db/db';
import type { PhotoCacheEntry } from '../../domain/types';
import { LOOKUP_VERSION, lookupOnlinePhoto } from './online';

const FOUND_TTL = 180 * 86_400_000; // re-check a found photo twice a year
const NONE_TTL = 14 * 86_400_000; // look again for a missing photo after two weeks

export function isFresh(e: PhotoCacheEntry, now: number): boolean {
  if ((e.lookupVersion ?? 1) < LOOKUP_VERSION) return false; // written by older lookup logic: re-check
  return now - e.fetchedAt < (e.status === 'found' ? FOUND_TTL : NONE_TTL);
}

/**
 * Online photo lookup with a device-local cache. Concurrent requests for the same
 * registration (many cards, one aircraft) share a single network call. Failures are
 * not cached as "no photo"; they are only remembered for this session to avoid hammering.
 */
export class OnlinePhotoStore {
  private inflight = new Map<string, Promise<PhotoCacheEntry | undefined>>();
  private failedThisSession = new Set<string>();

  constructor(
    private readonly db: LogbookDB,
    private readonly lookup: typeof lookupOnlinePhoto = lookupOnlinePhoto,
  ) {}

  cached(registration: string): Promise<PhotoCacheEntry | undefined> {
    return this.db.photoCache.get(registration);
  }

  /** Cached entry if fresh, otherwise one network lookup (if allowed). Never throws. */
  resolve(registration: string, opts: { allowNetwork: boolean; now?: number }): Promise<PhotoCacheEntry | undefined> {
    const now = opts.now ?? Date.now();
    const existing = this.inflight.get(registration);
    if (existing) return existing;
    const p = (async () => {
      const hit = await this.cached(registration);
      if (hit && isFresh(hit, now)) return hit;
      if (!opts.allowNetwork || this.failedThisSession.has(registration)) return hit?.status === 'found' ? hit : undefined;
      try {
        const fresh = await this.lookup(registration, fetch, now);
        await this.db.photoCache.put(fresh);
        return fresh;
      } catch {
        this.failedThisSession.add(registration);
        return hit?.status === 'found' ? hit : undefined; // keep showing a stale photo rather than nothing
      }
    })().finally(() => this.inflight.delete(registration));
    this.inflight.set(registration, p);
    return p;
  }

  async clear(): Promise<void> {
    await this.db.photoCache.clear();
  }
}
