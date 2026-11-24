/**
 * Regenerates the README screenshots from a built app and the demo logbook.
 *
 *   npm install --no-save playwright-core pdfjs-dist  # once: this script needs them, the app does not.
 *                                                      # One command: a later --no-save install drops the earlier one.
 *   npx playwright-core install chromium              # once: the browser for that version
 *   npx vite-node scripts/make-demo-logbook.ts -- /tmp/demo.json
 *   VITE_BASE=/FlightBook/ npm run build
 *   VITE_BASE=/FlightBook/ npx vite preview --port 4330 --strictPort &
 *   node scripts/make-screenshots.mjs http://localhost:4330/FlightBook/ /tmp/demo.json
 *
 * The preview needs VITE_BASE as well as the build: without it the server answers at / instead of
 * /FlightBook/, the page's scripts 404 and it renders blank.
 *
 * The clock is pinned to the demo logbook's DEMO_TODAY, so the currency and rating states -- and so the
 * screenshots -- are identical every run.
 *
 * Screenshots are viewport-sized, never fullPage: the bottom navigation is fixed, so a fullPage capture
 * strands it in the middle of the image. Where a card sits below the fold, the page is scrolled to it first.
 *
 * Planespotters is blocked for the whole run, so the aircraft photos can only come from Wikimedia Commons.
 * That is a licensing requirement, not a preference: Commons photos are freely licensed and can be credited
 * (see the photo credits in README.md), Planespotters photos are not and must never end up committed under
 * docs/.
 *
 * Attribution is part of the run, not a follow-up chore. Each screenshot records which photos are visible in
 * it; at the end the credits (title, author, licence, source, and which screenshot shows them) are built from
 * the app's own photo cache, written to docs/screenshots/photo-credits.json, and written into the README's
 * "Photo credits" section (see photo-credits.mjs). The screenshots are taken into a temporary folder and only
 * copied into docs/screenshots once every photo in them can be credited: if one cannot (no author, no
 * licence, not from Commons, or a licence that cannot be combined under CC BY-SA 4.0), the run stops and
 * changes nothing, so an uncredited photo can never be committed. A unit test keeps the README section and
 * the JSON in step.
 *
 * An optional third argument is an OurAirports airports.csv; with it, the airport names and the map work.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreditError, publish } from './photo-credits.mjs';

const [url, demoPath, airportsPath] = process.argv.slice(2);
if (!url || !demoPath) { console.error('usage: make-screenshots.mjs <app-url> <demo.json> [airports.csv]'); process.exit(1); }

const OUT = 'docs/screenshots';
/** Shots land here first, and are copied to OUT only once every photo in them is credited. */
const STAGE = mkdtempSync(join(tmpdir(), 'flightbook-shots-'));
// removed however the run ends: success, refusal, an error, or process.exit
process.on('exit', () => rmSync(STAGE, { recursive: true, force: true }));
/** What each screenshot shows: { file, imageUrls } in the order they were taken. */
const shots = [];
const DEMO_TODAY = '2026-11-23T09:30:00Z';
/** 412x915 at 2x: the same frame as the screenshots that were already in the README. */
const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 };

function findChromium() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = join(process.env.HOME, '.cache/ms-playwright');
  if (!existsSync(root)) throw new Error('No Chromium: run `npx playwright install chromium`');
  for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium'))) {
    for (const exe of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) {
      const p = join(root, dir, exe);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No Chromium binary found under ~/.cache/ms-playwright');
}

const browser = await chromium.launch({ executablePath: findChromium() });

/** A fresh device that has become the master and loaded the demo logbook through the app's own import. */
async function openApp({ dark = false } = {}) {
  const ctx = await browser.newContext({
    ...PHONE, colorScheme: dark ? 'dark' : 'light', acceptDownloads: true,
    // native date and time inputs follow the browser locale; en-GB/UTC gives the dd/mm/yyyy and 24-hour
    // clock a European logbook is kept in (the app's own formatting already forces en-GB)
    locale: 'en-GB', timezoneId: 'UTC',
    // so the alerts card can be shown switched on; the permission prompt cannot be answered headlessly
    permissions: ['notifications'],
  });
  // Commons only: a Planespotters photo must never reach a committed screenshot (not freely licensed)
  await ctx.route('**://*.planespotters.net/**', (r) => r.abort());
  await ctx.route('**://*.plnspttrs.net/**', (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.clock.setFixedTime(new Date(DEMO_TODAY));
  await page.goto(url, { waitUntil: 'networkidle' });
  const master = page.getByRole('button', { name: 'This device is the master logbook' });
  if (await master.isVisible().catch(() => false)) await master.click();
  await page.goto(`${url}#/export`, { waitUntil: 'networkidle' });
  await page.locator('input[type=file]').setInputFiles(demoPath);
  const apply = page.locator('.btn.filled').last();
  await apply.waitFor({ state: 'visible', timeout: 15_000 });
  await apply.click();
  await page.waitForTimeout(2500);
  if (airportsPath) {
    await page.goto(`${url}#/settings`, { waitUntil: 'networkidle' });
    const csv = page.locator('input[type=file][accept*="csv"]').last();
    await csv.setInputFiles(airportsPath);
    await page.getByText(/airports? (imported|ready)|imported/i).first().waitFor({ timeout: 180_000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  // A real reload, not a hash change: the import leaves its summary dialog open, and that dialog
  // swallows clicks on whatever is behind it. go() only changes the hash, which the SPA handles
  // without reloading, so the dialog would survive into the next step.
  await page.reload({ waitUntil: 'networkidle' });
  return { ctx, page };
}

/** What the app really showed, read back out of its own photo cache, for the README credits. */
async function photoCredits(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('flightbook');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photoCache')) return resolve([]);
      const all = db.transaction('photoCache').objectStore('photoCache').getAll();
      all.onsuccess = () => resolve(all.result.filter((e) => e.status === 'found'));
      all.onerror = () => resolve([]);
    };
    req.onerror = () => resolve([]);
  }));
}

async function go(page, hash) {
  await page.goto(`${url}#${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
}

/**
 * Viewport shot, optionally scrolled so `anchor` sits just under the title bar. The scroll is verified
 * afterwards: a shot that silently missed its anchor still produces a plausible-looking image, which is
 * exactly the kind of wrong screenshot that gets committed without anyone noticing.
 */
async function shot(page, name, { anchor, offset = 76 } = {}) {
  if (anchor) {
    const el = page.locator(anchor).first();
    await el.evaluate((node, off) => {
      const y = node.getBoundingClientRect().top + window.scrollY - off;
      window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    }, offset);
    await page.waitForTimeout(400);
    const ok = await el.evaluate((node, off) => {
      const top = node.getBoundingClientRect().top;
      return Math.abs(top - off) < 6 || (top >= 0 && top < window.innerHeight - 40);
    }, offset);
    if (!ok) throw new Error(`${name}: the anchor ${anchor} is not in frame after scrolling`);
  }
  // which photos are on screen in this shot: they all have to be credited
  const imageUrls = await page.$$eval('.photo img', (els) => els.filter((e) => {
    const r = e.getBoundingClientRect();
    return e.complete && e.naturalWidth > 0 && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }).map((e) => e.getAttribute('src')));
  shots.push({ file: `${name}.png`, imageUrls: [...new Set(imageUrls)] });
  await page.screenshot({ path: join(STAGE, `${name}.png`) });
  console.log(`${name}.png${imageUrls.length ? ` (${imageUrls.length} photo${imageUrls.length === 1 ? '' : 's'})` : ''}`);
}

/**
 * pdf-logbook.png: a page of the PDF the app itself generated, rendered with pdf.js in the same browser (no
 * PDF tool needed on the machine). The page shown is the first one with two simulator sessions on it, which
 * is what the README's caption describes; the PDF carries no photos, so it needs no credit.
 */
async function renderPdfPage(pdfPath, width = 1287) {
  const ctx = await browser.newContext({ viewport: { width: width + 40, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const base = 'https://pdf-render.invalid/';
  // the legacy build: it runs in older engines too, such as the Chromium a pinned playwright-core brings
  const build = join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build');
  if (!existsSync(join(build, 'pdf.min.mjs'))) throw new Error('pdf.js is missing: npm install --no-save playwright-core pdfjs-dist');
  await page.route(`${base}**`, (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'index.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#fff"><canvas id="c"></canvas></body>' });
    if (name === 'logbook.pdf') return route.fulfill({ contentType: 'application/pdf', path: pdfPath });
    if (name === 'pdf.mjs') return route.fulfill({ contentType: 'text/javascript', path: join(build, 'pdf.min.mjs') });
    if (name === 'pdf.worker.mjs') return route.fulfill({ contentType: 'text/javascript', path: join(build, 'pdf.worker.min.mjs') });
    // the PDF uses the standard Helvetica without embedding it; without pdf.js's own font data it falls back to
    // a font with other metrics, and the totals rows came out as "TOTAL FROMPREVIOUS PAGES"
    if (name.startsWith('standard_fonts/')) return route.fulfill({ path: join(process.cwd(), 'node_modules/pdfjs-dist', name) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${base}index.html`);
  const r = await page.evaluate(async ({ base, width }) => {
    const pdfjs = await import(`${base}pdf.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.mjs`;
    // useSystemFonts: false, or the browser's own (missing) fonts are preferred over pdf.js's Helvetica-metric ones
    const doc = await pdfjs.getDocument({ url: `${base}logbook.pdf`, standardFontDataUrl: `${base}standard_fonts/`, useSystemFonts: false }).promise;
    let chosen = 0;
    for (let n = 1; n <= doc.numPages && !chosen; n++) {
      const text = (await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str).join(' ');
      if ((text.match(/FNPT|BITD/g) ?? []).length >= 2) chosen = n;
    }
    if (!chosen) return { chosen, of: doc.numPages };
    const pg = await doc.getPage(chosen);
    const viewport = pg.getViewport({ scale: width / pg.getViewport({ scale: 1 }).width });
    const canvas = document.getElementById('c');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    await pg.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { chosen, of: doc.numPages };
  }, { base, width });
  if (!r.chosen) throw new Error(`pdf-logbook: none of the ${r.of} PDF pages has two simulator sessions; the README caption would be wrong`);
  await page.locator('#c').screenshot({ path: join(STAGE, 'pdf-logbook.png') });
  shots.push({ file: 'pdf-logbook.png', imageUrls: [] });
  console.log(`pdf-logbook.png (page ${r.chosen} of ${r.of})`);
  await ctx.close();
}

/** Credits for the photos this context loaded, printed and checked. */
async function reportCredits(page, label) {
  const credits = await photoCredits(page);
  for (const c of credits) console.log(`  ${c.registration} | ${c.source} | ${c.title ?? ''} | ${c.artist ?? ''} | ${c.license ?? ''} | ${c.pageUrl ?? ''}`);
  if (credits.some((c) => c.source !== 'commons')) throw new Error(`${label}: a non-Commons photo was used; do not commit these screenshots`);
  return credits;
}

/**
 * Which screens are dark is deliberate, not incidental: the README shows the theme setting by having
 * some screens in dark mode, and the map colour options by putting the map on "Aviation magenta".
 */

// ---------- light ----------
const light = await openApp();
await go(light.page, '/');
await light.page.waitForTimeout(4000); // photo look-ups are lazy and rate-limited
await shot(light.page, 'logbook');

// the new-flight form, filled the way a pilot would: the aircraft and the airport names are the
// app's own autofill, not typed in
await go(light.page, '/new');
await light.page.fill('#f-dep', '09:30');
await light.page.fill('#f-arr', '11:05');
await light.page.fill('#f-from', 'EBKT');
await light.page.fill('#f-to', 'EHRD');
await light.page.fill('#f-reg', 'OO-CEU');
await light.page.locator('#f-reg').blur();
await light.page.waitForTimeout(1500);
await shot(light.page, 'new-flight', { anchor: '#f-date', offset: 92 });

await go(light.page, '/currency');
await shot(light.page, 'currency');

// the proficiency-check route: pick MEP (land), whose check window is open. Anchor on the class card
// itself, not on the last one: the licence cards below it are not class ratings.
await light.page.getByRole('button', { name: 'MEP (land)', exact: true }).click();
await light.page.waitForTimeout(400);
await shot(light.page, 'currency-rating', { anchor: '.cur-card:has-text("class rating")' });

// the licence section: the ratings and documents that are not tied to a class
await shot(light.page, 'licence', { anchor: 'h2:has-text("Your licence")', offset: 112 }); // clear the title bar

// the PDF, made by the app itself from this same logbook
await go(light.page, '/export');
const dl = light.page.waitForEvent('download', { timeout: 60_000 });
await light.page.getByRole('button', { name: /Create PDF/i }).click();
await (await dl).saveAs('/tmp/demo-logbook.pdf');
console.log('/tmp/demo-logbook.pdf');
await shot(light.page, 'export', { anchor: '#pilot-name', offset: 110 }); // 110: keep the field's label in frame

console.log('\n--- aircraft photos the app looked up (credited below, per screenshot) ---');
const lightCredits = await reportCredits(light.page, 'light');
await light.ctx.close();

// ---------- dark ----------
const dark = await openApp({ dark: true });

// the map colour options are a setting worth showing, so put the map on "Aviation magenta"
await go(dark.page, '/settings');
await dark.page.getByRole('radio', { name: /Aviation magenta/i }).click(); // role=radio, not button
await dark.page.waitForTimeout(600);
const chosen = await dark.page.getByRole('radio', { name: /Aviation magenta/i }).getAttribute('aria-checked');
if (chosen !== 'true') throw new Error('the map colour did not change; the map screenshot would be wrong');
// plain click, not .check(): the switch only flips once the permission request and the seed resolve,
// which is slower than check()'s own state assertion allows for
await dark.page.locator('input[aria-label="Alerts for currency and ratings"]').click();
await dark.page.waitForTimeout(2500);
await shot(dark.page, 'alerts', { anchor: 'text=Alerts for currency and ratings' });

await go(dark.page, '/');
await dark.page.waitForTimeout(4000);
await dark.page.locator('.flight-card, [class*=flight] a, main a').first().click().catch(() => {});
await dark.page.waitForTimeout(3000);
await shot(dark.page, 'flight');

await go(dark.page, '/totals');
await shot(dark.page, 'totals');

if (airportsPath) {
  await go(dark.page, '/map');
  await dark.page.waitForTimeout(2500);
  await shot(dark.page, 'map');
}

const darkCredits = await reportCredits(dark.page, 'dark');
await dark.ctx.close();

await renderPdfPage('/tmp/demo-logbook.pdf');

await browser.close();

// ---------- credits: nothing reaches docs/ unless every photo in it is credited ----------
let credits;
try {
  credits = publish({ shots, cache: [...lightCredits, ...darkCredits], stage: STAGE, out: OUT, readmePath: 'README.md' });
} catch (e) {
  if (!(e instanceof CreditError)) throw e;
  console.error(`\nNOT WRITTEN: ${e.message}\nThe screenshots in ${OUT} and the README are unchanged.`);
  process.exit(1);
}
console.log(`\n${shots.length} screenshots written to ${OUT}; ${credits.length} third-party photo(s), credited in README.md and ${OUT}/photo-credits.json:`);
for (const c of credits) console.log(`  ${c.registration} | "${c.title}" | ${c.artist} | ${c.license} | ${c.files.join(', ')}`);
