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
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          runtimeCaching: [
            {
              // Optional map background (OpenStreetMap): tiles you have looked at stay available offline for a week,
              // and are refreshed in the background when online (respecting the tile server's caching rules).
              urlPattern: ({ url }) => url.hostname === 'tile.openstreetmap.org',
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'map-tiles', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 }, cacheableResponse: { statuses: [0, 200] } },
            },
            {
              // Aircraft photos (Planespotters, Wikimedia): cached after first view so they work offline.
              urlPattern: ({ url }) => ['t.plnspttrs.net', 'upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'aircraft-photos',
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
