import { type Page, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * The demo logbook (scripts/make-demo-logbook.ts), also behind the README screenshots: 52 flights over two
 * years, a valid IR, an MEP rating in its check window, two type ratings. Regenerate it with
 *   npx vite-node scripts/make-demo-logbook.ts -- e2e/fixtures/demo-logbook.json
 * Its dates are relative to DEMO_TODAY, so the clock is pinned there.
 */
export const DEMO = fileURLToPath(new URL('./fixtures/demo-logbook.json', import.meta.url));
export const DEMO_TODAY = '2026-11-23T09:30:00Z';

/** A new device, set up as the master logbook, on the demo's date. */
export async function freshMaster(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(DEMO_TODAY));
  await page.goto('./');
  await page.getByRole('button', { name: 'This device is the master logbook' }).click();
  await expect(page.getByRole('button', { name: 'New flight' })).toBeVisible();
}

/** The demo logbook loaded through the app's own import, as a pilot would restore a backup. */
export async function withDemoLogbook(page: Page): Promise<void> {
  await freshMaster(page);
  await page.goto('#/export');
  await page.locator('input[type=file]').first().setInputFiles(DEMO);
  await page.getByRole('button', { name: /^Import \d+ records?$/ }).click();
  await expect(page.getByText(/imported|added/i).first()).toBeVisible();
  // a real reload: the import's summary dialog stays open otherwise and swallows clicks
  await page.reload();
}

/** The card on the Currency screen with this heading. */
export const card = (page: Page, heading: string | RegExp) =>
  page.locator('.card', { has: page.getByRole('heading', { name: heading }) }).first();
