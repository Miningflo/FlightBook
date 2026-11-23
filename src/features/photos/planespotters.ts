import type { PhotoCacheEntry } from '../../domain/types';

/**
 * Planespotters.net public photo API (the same one flight-tracking sites embed).
 * Called from the user's own browser. Terms: show the photographer's name and link
 * back to the photo page. Responses are untrusted: URLs are restricted to
 * Planespotters hosts and text is only ever rendered as text.
 *
 * The response shape below was checked against the live API on 23 November 2026: `photos[]` with
 * `thumbnail.src`, `thumbnail_large.src`, `link` and `photographer`, images on t.plnspttrs.net, pages
 * on www.planespotters.net, and `{"photos":[]}` for a registration it has no photo of. The API sends
 * `access-control-allow-origin: *`, which is what makes the browser call possible, and
 * `cache-control: public, max-age=3600`. If the shape ever changes, the lookup yields nothing and the
 * app falls back to Wikimedia Commons, then a placeholder.
 *
 * Keep the call in the page. The API rejects non-browser callers whose User-Agent carries no contact
 * URL (403 with a message saying so), and a browser cannot set User-Agent, so moving this into the
 * service worker or a server would break it until a contact URL is added there.
 */

interface PsPhoto {
  thumbnail?: { src?: string };
  thumbnail_large?: { src?: string };
  link?: string;
  photographer?: string;
}
export interface PlanespottersResponse {
  photos?: PsPhoto[];
}

const IMAGE_HOSTS = new Set(['t.plnspttrs.net']);
const PAGE_HOSTS = new Set(['www.planespotters.net', 'planespotters.net']);

function safeUrl(u: unknown, hosts: Set<string>): string | undefined {
  if (typeof u !== 'string') return undefined;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && hosts.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function pickPlanespottersPhoto(registration: string, res: PlanespottersResponse, now: number): PhotoCacheEntry | null {
  const reg = registration.trim().toUpperCase();
  const photos = Array.isArray(res?.photos) ? res.photos : [];
  for (const p of photos) {
    const imageUrl = safeUrl(p.thumbnail_large?.src, IMAGE_HOSTS) ?? safeUrl(p.thumbnail?.src, IMAGE_HOSTS);
    const pageUrl = safeUrl(p.link, PAGE_HOSTS);
    if (!imageUrl || !pageUrl) continue; // attribution link is mandatory, so no link = no photo
    const artist = typeof p.photographer === 'string' ? p.photographer.replace(/\s+/g, ' ').trim().slice(0, 120) || undefined : undefined;
    return { registration: reg, status: 'found', source: 'planespotters', fetchedAt: now, imageUrl, pageUrl, artist };
  }
  return null;
}

export function planespottersUrl(registration: string): string {
  return `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(registration.trim().toUpperCase())}`;
}

/** Returns a found entry or null for "no photo". Throws on network/HTTP failure. */
export async function lookupPlanespottersPhoto(
  registration: string,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
): Promise<PhotoCacheEntry | null> {
  const res = await fetchFn(planespottersUrl(registration), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Planespotters lookup failed: HTTP ${res.status}`);
  return pickPlanespottersPhoto(registration, (await res.json()) as PlanespottersResponse, now);
}
