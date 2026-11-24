import { expect, test } from '@playwright/test';
import { withDemoLogbook } from './helpers';

/**
 * Layout checks, measured rather than looked at: both bugs here passed every unit test, because Vitest has
 * no layout engine. The Totals day/night bars were 0 px tall on screens 900 px and wider (a class name
 * shared with the wide-screen layout), and the record links had their chevron under the text everywhere.
 */
for (const [label, size] of [['phone', { width: 412, height: 915 }], ['desktop', { width: 1280, height: 900 }]] as const) {
  test.describe(`Totals on a ${label} (${size.width} px)`, () => {
    test.use({ viewport: size });
    test.beforeEach(async ({ page }) => { await withDemoLogbook(page); await page.goto('#/totals'); });

    test('the day/night bars of take-offs and landings are drawn', async ({ page }) => {
      const bars = page.locator('.daynight-bar');
      await expect(bars).toHaveCount(2);
      for (const bar of await bars.all()) {
        for (const part of await bar.locator('span').all()) {
          const box = (await part.boundingBox())!;
          expect(box.height, 'bar part height').toBeGreaterThanOrEqual(6);
          expect(box.width, 'bar part width').toBeGreaterThan(0);
        }
      }
    });

    test('the record links keep their chevron beside the text', async ({ page }) => {
      for (const link of await page.locator('.link-card').all()) {
        const text = (await link.locator(':scope > div').first().boundingBox())!;
        const chevron = (await link.locator('svg').boundingBox())!;
        expect(chevron.x, 'chevron to the right of the text').toBeGreaterThan(text.x + text.width - 1);
        expect(chevron.y, 'chevron on the same line').toBeLessThan(text.y + text.height);
      }
    });
  });
}
