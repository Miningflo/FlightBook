/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/';
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        // 'prompt': never swap the running app under the user mid-entry.
        registerType: 'prompt',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'FlightBook',
          short_name: 'FlightBook',
          description: 'Personal EASA pilot logbook',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'any',
          theme_color: '#1b5e8c',
          background_color: '#f6f9fc',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        // The service worker is src/sw.ts (offline caching plus the daily alert check).
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // a single self-contained file, so it can be registered as a classic worker
          rollupFormat: 'iife',
        },
      }),
    ],
    test: {
      environment: 'node',
      // scripts/photo-credits.test.mjs: the README screenshots' photo credits are checked in CI too
      include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    },
  };
});
