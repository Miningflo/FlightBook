import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: the built app in a real browser. They exist for what Vitest (Node, no DOM, no layout)
 * cannot see: flows across screens, and layout, such as the Totals bars that were 0 px tall on desktop.
 *
 * The app is built and served the way GitHub Pages serves it (base /FlightBook/). Every test opens a fresh
 * browser context, so each starts with an empty IndexedDB.
 *
 * On a machine where Playwright cannot install its own browser (it no longer supports Ubuntu 20.04, for
 * example), point PLAYWRIGHT_CHROMIUM at a Chromium binary instead; CI uses Playwright's own.
 */
const PORT = 4174;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/FlightBook/`,
    locale: 'en-GB',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      ...(process.env.PLAYWRIGHT_CHROMIUM ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM } } : {}),
    },
  }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    env: { VITE_BASE: '/FlightBook/' },
    url: `http://localhost:${PORT}/FlightBook/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
