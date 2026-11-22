import type { PhotoCacheEntry } from '../../domain/types';

/**
 * Online aircraft photos from Wikimedia Commons (open API, CORS enabled, photos
 * under free licences). Only the registration is sent. Results are untrusted
 * input: URLs are restricted to Wikimedia hosts and text is rendered as text.
 */

interface CommonsPage {
  title?: string;
  imageinfo?: Array<{
    thumburl?: string;
    url?: string;
    descriptionurl?: string;
    mime?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }>;
}
export interface CommonsResponse {
  query?: { pages?: Record<string, CommonsPage> };
}

const IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);
const PAGE_HOST = 'commons.wikimedia.org';

function safeUrl(u: string | undefined, hosts: Set<string>): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u.startsWith('//') ? `https:${u}` : u);
    return url.protocol === 'https:' && hosts.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&nbsp;': ' ' };

/** Metadata comes as HTML. Reduce it to plain text (it is only ever rendered as text). */
export function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const t = html.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, (m) => ENTITIES[m] ?? m).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 120) : undefined;
}

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Choose the best matching photo for a registration, or null.
 * The search is fuzzy, so a result is accepted only if its file name contains the
 * registration (with or without the hyphen). Wrong aircraft are worse than none.
 */
export function pickCommonsPhoto(registration: string, res: CommonsResponse, now: number): PhotoCacheEntry | null {
  const reg = registration.trim().toUpperCase();
  if (squash(reg).length < 3) return null;
  // Registration as a whole token in the file name, hyphen optional.
  const pattern = [...reg].map((c) => (c === '-' ? '-?' : c.replace(/[^A-Z0-9]/g, ''))).join('');
  const re = new RegExp(`(^|[^A-Z0-9])${pattern}($|[^A-Z0-9])`, 'i');
  const pages = Object.values(res.query?.pages ?? {});
  for (const p of pages) {
    const title = (p.title ?? '').replace(/^File:/, '');
    if (!re.test(title)) continue;
    const info = p.imageinfo?.[0];
    const imageUrl = safeUrl(info?.thumburl ?? info?.url, IMAGE_HOSTS);
    const pageUrl = safeUrl(info?.descriptionurl, new Set([PAGE_HOST]));
    if (!imageUrl || !pageUrl) continue;
    if (info?.mime && !info.mime.startsWith('image/')) continue;
    const meta = info?.extmetadata ?? {};
    return {
      registration: reg,
      status: 'found',
      source: 'commons',
      fetchedAt: now,
      imageUrl,
      pageUrl,
      title,
      artist: htmlToText(meta.Artist?.value),
      license: htmlToText(meta.LicenseShortName?.value),
    };
  }
  return null;
}

export function commonsQueryUrl(registration: string): string {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '8',
    gsrsearch: `"${registration}" filetype:bitmap`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: '900',
    iiextmetadatafilter: 'Artist|LicenseShortName',
  });
  return `https://commons.wikimedia.org/w/api.php?${q.toString()}`;
}

/** Throws on network or HTTP failure (so callers don't cache a failure as "no photo"). */
export async function lookupCommonsPhoto(
  registration: string,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
): Promise<PhotoCacheEntry> {
  const res = await fetchFn(commonsQueryUrl(registration), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Commons lookup failed: HTTP ${res.status}`);
  const json = (await res.json()) as CommonsResponse;
  return pickCommonsPhoto(registration, json, now) ?? { registration: registration.toUpperCase(), status: 'none', fetchedAt: now };
}
