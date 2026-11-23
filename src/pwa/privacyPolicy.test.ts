import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The privacy policy has to stay reachable at a plain URL on the deployed site: Google's OAuth
 * verification points at it, so it is a legal requirement, not a nicety. It is a static file in
 * `public/` (copied to the root of `dist/`, no JavaScript needed) and the service worker must keep
 * letting navigations through to it instead of answering with the single-page app.
 */

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('privacy policy stays published', () => {
  const page = read('public/privacy.html');

  it('is a self-contained static page in public/', () => {
    expect(page).toMatch(/<title>[^<]*Privacy policy<\/title>/i);
    // relative links only, so it works under any VITE_BASE
    expect(page).not.toMatch(/(href|src)="\//);
  });

  it('names the Drive scope the app actually asks for and the Google Limited Use policy', () => {
    expect(page).toContain('https://www.googleapis.com/auth/drive.file');
    expect(page).toContain('api-services-user-data-policy');
  });

  it('is excluded from the service worker navigation fallback', () => {
    const sw = read('src/sw.ts');
    const route = sw.match(/new NavigationRoute\([^;]*\);/s)?.[0] ?? '';
    expect(route).toContain('denylist');
    expect(new RegExp(route.match(/\/(privacy[^/]*)\//)?.[1] ?? 'no-match').test('privacy.html')).toBe(true);
  });

  it('is linked from Settings', () => {
    expect(read('src/features/settings/SettingsScreen.tsx')).toContain('privacy.html');
  });

  it('is precached, so it also opens offline', () => {
    expect(read('vite.config.ts')).toMatch(/globPatterns:.*html/);
  });
});
