import { type Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DEMO, freshMaster } from './helpers';

/** Failures seen only in a real browser: losing typed input, and screens that went blank. */

async function typedFlight(page: Page) {
  await freshMaster(page);
  await page.getByRole('button', { name: 'New flight' }).click();
  await page.fill('#f-reg', 'OO-TST');
}
const asks = (page: Page) => page.getByRole('heading', { name: 'Discard changes?' });

for (const [how, leave] of [
  ['the Back arrow', (page: Page) => page.getByRole('button', { name: 'Back', exact: true }).click()],
  ['Cancel', (page: Page) => page.getByRole('button', { name: 'Cancel' }).first().click()],
  ["the browser's Back", async (page: Page) => { await page.goBack(); }],
] as const) {
  test(`${how} asks before a typed flight is discarded`, async ({ page }) => {
    await typedFlight(page);
    await leave(page);
    await expect(asks(page)).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.locator('#f-reg')).toHaveValue('OO-TST');
    // a second time still asks, and discarding leaves for the logbook
    await leave(page);
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('button', { name: 'New flight' })).toBeVisible();
    await expect(page.locator('#f-reg')).toHaveCount(0);
  });
}

test('an untouched form is left without a question', async ({ page }) => {
  await freshMaster(page);
  await page.getByRole('button', { name: 'New flight' }).click();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'New flight' })).toBeVisible();
});

for (const [form, field, list] of [['experience/new', '#x-source', 'experience'], ['fstd/new', '#fs-type', 'fstd']] as const) {
  test(`${form} asks before its input is discarded`, async ({ page }) => {
    await freshMaster(page);
    await page.goto(`#/${form}`);
    await page.fill(field, 'Something typed');
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(asks(page)).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${list}$`));
  });
}

test('clearing the take-off date after setting a landing date keeps the form', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await typedFlight(page);
  await page.fill('#f-arrdate', '2026-11-25');
  await page.fill('#f-date', '');
  await page.fill('#f-date', '2026-11-20');
  await expect(page.locator('#f-reg')).toHaveValue('OO-TST');
  expect(errors).toEqual([]);
});

test('a backup with an unreadable date says so, and the Currency screen still works', async ({ page }) => {
  await freshMaster(page);
  await page.goto('#/export');
  const backup = JSON.parse(readFileSync(DEMO, 'utf8')) as { settings: Record<string, unknown> };
  backup.settings.irExpiry = '31/12/2027';
  await page.locator('input[type=file]').first().setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByText('the instrument rating expiry date cannot be read')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Import the valid records and skip these' }).check();
  await page.getByRole('button', { name: /^Import \d+ records?$/ }).click();
  await expect(page.getByText(/^Imported \d+ new records/)).toBeVisible();
  await page.goto('#/currency');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Instrument rating' })).toBeVisible();
});
