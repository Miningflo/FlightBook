/**
 * Regenerates the README screenshots from a built app and the demo logbook.
 *
 *   npx vite-node scripts/make-demo-logbook.ts -- /tmp/demo.json
 *   VITE_BASE=/FlightBook/ npm run build
 *   npx vite preview --port 4330 --strictPort &
 *   node scripts/make-screenshots.mjs http://localhost:4330/FlightBook/ /tmp/demo.json
 *
 * The clock is pinned to the demo logbook's DEMO_TODAY, so the currency and rating states -- and so the
 * screenshots -- are identical every run. Needs a Chromium from `npx playwright install chromium`.
 *
 * Screenshots are viewport-sized, never fullPage: the bottom navigation is fixed, so a fullPage capture
 * strands it in the middle of the image. Where a card sits below the fold, the page is scrolled to it first.
 */
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [url, demoPath] = process.argv.slice(2);
if (!url || !demoPath) { console.error('usage: make-screenshots.mjs <app-url> <demo.json>'); process.exit(1); }

const OUT = 'docs/screenshots';
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
    // so the alerts card can be shown switched on; the permission prompt cannot be answered headlessly
    permissions: ['notifications'],
  });
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
  return { ctx, page };
}

async function go(page, hash) {
  await page.goto(`${url}#${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
}

/** Viewport shot, optionally scrolled so `anchor` sits just under the title bar. */
async function shot(page, name, { anchor, offset = 76 } = {}) {
  if (anchor) {
    await page.locator(anchor).first().evaluate((el, off) => {
      const y = el.getBoundingClientRect().top + window.scrollY - off;
      window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    }, offset);
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
}

// ---- light: currency ----
const { ctx, page } = await openApp();
await go(page, '/currency');
await shot(page, 'currency');

// the proficiency-check route: pick MEP (land), whose check window is open
await page.getByRole('button', { name: 'MEP (land)', exact: true }).click();
await page.waitForTimeout(400);
await shot(page, 'currency-rating', { anchor: '.cur-card:last-of-type' });

// the PDF, made by the app itself from this same logbook
await go(page, '/export');
const dl = page.waitForEvent('download', { timeout: 60_000 });
await page.getByRole('button', { name: /Create PDF/i }).click();
await (await dl).saveAs('/tmp/demo-logbook.pdf');
console.log('/tmp/demo-logbook.pdf');
await shot(page, 'export', { anchor: '#pilot-name', offset: 110 }); // 110: keep the field's label in frame
await ctx.close();

// ---- dark: the alerts card in Settings ----
const d = await openApp({ dark: true });
await go(d.page, '/settings');
// plain click, not .check(): the switch only flips once the permission request and the seed resolve,
// which is slower than check()'s own state assertion allows for
await d.page.locator('input[aria-label="Alerts for currency and ratings"]').click();
await d.page.waitForTimeout(2500);
await shot(d.page, 'alerts', { anchor: 'text=Alerts for currency and ratings' });
await d.ctx.close();

await browser.close();
