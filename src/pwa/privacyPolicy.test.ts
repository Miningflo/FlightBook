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

  it('only claims the one Google scope the app actually requests', () => {
    const scopes = [...read('src/drive/config.ts').matchAll(/https:\/\/www\.googleapis\.com\/auth\/[\w.]+/g)].map((m) => m[0]);
    expect(scopes).toEqual(['https://www.googleapis.com/auth/drive.file']);
    for (const s of scopes) expect(page).toContain(s);
  });

  it('names every outside host the app can contact', () => {
    const src = ['src/features/photos/planespotters.ts', 'src/features/photos/commons.ts', 'src/features/airports/airportStore.ts', 'src/drive/config.ts']
      .map((f) => { try { return read(f); } catch { return ''; } }).join('\n');
    const hosts = new Set([...src.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]!));
    // every third party the code can reach must be disclosed, by host or by the name the page uses for it
    const disclosed: Record<string, string> = {
      'api.planespotters.net': 'planespotters.net', 'www.planespotters.net': 'planespotters.net', 't.plnspttrs.net': 'planespotters.net',
      'commons.wikimedia.org': 'wikimedia.org', 'upload.wikimedia.org': 'wikimedia.org',
      'davidmegginson.github.io': 'GitHub', 'ourairports.com': 'ourairports.com',
      'www.googleapis.com': 'googleapis.com', 'accounts.google.com': 'google',
    };
    for (const h of hosts) {
      expect(disclosed, `undisclosed host ${h}: add it to the privacy policy`).toHaveProperty(h);
      expect(page.toLowerCase()).toContain(disclosed[h]!.toLowerCase());
    }
  });

  it('covers the GDPR disclosures a reader needs', () => {
    for (const needed of ['Legal basis', 'Your rights', 'Portability', 'international transfers', 'data protection', 'Other people in your logbook']) {
      expect(page, `privacy policy is missing: ${needed}`).toContain(needed);
    }
  });

  it('does not promise a push service the app does not use', () => {
    expect(read('src/pwa/alerts.ts') + read('src/sw.ts')).not.toContain('pushManager');
  });

  it('is explicit that the medical is a class and a date, never health data', () => {
    expect(page).toMatch(/Article 9/);
    expect(page).toMatch(/conditions, limitations or findings/);
    // and the data model must actually keep that promise
    const settings = read('src/domain/types.ts');
    const block = settings.slice(settings.indexOf('interface Settings'), settings.indexOf('interface Settings') + 2500);
    for (const forbidden of ['medicalCondition', 'medicalLimitation', 'medicalRestriction', 'medicalNotes']) {
      expect(block, `Settings must not record ${forbidden}: that is Article 9 health data`).not.toContain(forbidden);
    }
  });

  it('is linked from Settings', () => {
    expect(read('src/features/settings/SettingsScreen.tsx')).toContain('privacy.html');
  });

  it('is precached, so it also opens offline', () => {
    expect(read('vite.config.ts')).toMatch(/globPatterns:.*html/);
  });
});
