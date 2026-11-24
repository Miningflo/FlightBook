import { expect, test } from '@playwright/test';
import { freshMaster, withDemoLogbook } from './helpers';

test('a new master device logs a flight and finds it in the logbook', async ({ page }) => {
  await freshMaster(page);
  await page.getByRole('button', { name: 'New flight' }).click();
  await page.fill('#f-dep', '09:30');
  await page.fill('#f-arr', '11:05');
  await page.fill('#f-from', 'EBKT');
  await page.fill('#f-to', 'EHRD');
  await page.fill('#f-reg', 'OO-TST');
  await page.fill('#f-make', 'Cessna');
  await page.fill('#f-model', '172S');
  await page.getByRole('button', { name: 'PIC', exact: true }).click();
  await page.getByRole('button', { name: 'Save flight' }).click();

  await expect(page).toHaveURL(/#\/flight\//);
  await expect(page.getByText('01:35').first()).toBeVisible(); // block time 09:30-11:05
  await page.goto('#/');
  const flightCard = page.locator('.flight-card', { hasText: 'OO-TST' });
  await expect(flightCard).toContainText('EBKT');
  await expect(flightCard).toContainText('EHRD');
});

test('an incomplete flight is not saved, and says what is missing', async ({ page }) => {
  await freshMaster(page);
  await page.getByRole('button', { name: 'New flight' }).click();
  await page.getByRole('button', { name: 'Save flight' }).click();
  await expect(page).toHaveURL(/#\/new/);
  await expect(page.getByText('Departure place is required.')).toBeVisible();
  await page.goto('#/');
  await expect(page.locator('.flight-card')).toHaveCount(0);
});

test('the demo backup imports completely', async ({ page }) => {
  await withDemoLogbook(page);
  await page.goto('#/');
  await expect(page.locator('.hero-stats')).toContainText('52');
});
