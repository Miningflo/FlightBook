import { expect, test } from '@playwright/test';
import { card, withDemoLogbook } from './helpers';

test.beforeEach(async ({ page }) => { await withDemoLogbook(page); });

test('marking a route sector from the unmarked list counts it, and comes back to the same tab', async ({ page }) => {
  await page.goto('#/currency/MEP_LAND');
  const ratings = card(page, 'Type ratings');
  const sectorRow = ratings.locator('.progress-row .line', { hasText: 'Route sectors' }).first();
  await expect(sectorRow).toContainText('0 / 10');

  const fold = ratings.locator('details', { hasText: 'not marked as a route sector' }).first();
  await fold.locator('summary').click();
  await fold.locator('.link-row').first().click();
  await expect(page).toHaveURL(/#\/edit\/[^/]+\/currency\/MEP_LAND$/);

  await page.getByRole('button', { name: 'Route sector', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/#\/currency\/MEP_LAND$/);
  await expect(card(page, 'Type ratings').locator('.progress-row .line', { hasText: 'Route sectors' }).first()).toContainText('1 / 10');
});

test('removing a type rating asks first, and its flights are then listed as without a rating', async ({ page }) => {
  await page.goto('#/currency');
  const ratings = card(page, 'Type ratings');
  const name = (await ratings.locator('.progress-row strong').first().innerText()).trim();
  const dialog = page.locator('dialog[open]');

  await ratings.getByRole('button', { name: 'Change expiry date' }).first().click();
  await ratings.getByRole('button', { name: 'Remove rating' }).first().click();
  await expect(dialog).toContainText(`Remove the ${name} type rating?`);
  await expect(dialog).toContainText(/flights? (is|are) logged under this rating/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(ratings.locator('.progress-row strong', { hasText: name })).toBeVisible();

  await ratings.getByRole('button', { name: 'Remove rating' }).first().click();
  await dialog.getByRole('button', { name: 'Remove rating' }).click();
  await expect(ratings.locator('.progress-row strong', { hasText: name })).toHaveCount(0);

  await page.locator('[aria-label="Aircraft class"]').getByRole('button', { name: 'Other' }).click();
  const stranded = card(page, 'Flights without a type rating');
  await expect(stranded.locator('.link-row').first()).toContainText('rating removed');
});

test('an IR waives only the extra night landing, never the 3 take-offs and landings', async ({ page }) => {
  await page.goto('#/currency/SEP_SEA'); // nothing flown in SEP (sea): the 3 are not met
  const night = card(page, 'Passengers at night');
  await expect(night.locator('.status-pill')).toContainText('Waived (IR)');
  await expect(night).toContainText('no passengers, by day or at night');
  await expect(night.locator('.progress-row')).toHaveCount(0); // the waived counters are not shown
  await expect(card(page, 'Carrying passengers').locator('.progress-row')).toHaveCount(2);
});
