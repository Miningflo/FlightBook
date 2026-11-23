import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { LogbookDB } from './db/db';
import { checkAlerts } from './pwa/alertCheck';

/**
 * The app's service worker: offline caching (as before) plus the daily alert check.
 * It is written by hand (vite-plugin-pwa "injectManifest") because the alert check has to run in here.
 */

declare global {
  interface Window { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }
}

interface ExtendableEventLike { waitUntil(p: Promise<unknown>): void }
interface NotificationClickEventLike extends ExtendableEventLike { notification: Notification }
const worker = self as unknown as {
  skipWaiting(): Promise<void>;
  registration: ServiceWorkerRegistration;
  clients: { matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<Array<{ focus(): Promise<unknown> }>>; openWindow(url: string): Promise<unknown> };
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Single-page app: any navigation shows the app, except the static privacy page.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/privacy\.html$/] }));

// Aircraft photos (Planespotters, Wikimedia): cached after first view so they work offline.
registerRoute(
  ({ url }) => ['t.plnspttrs.net', 'upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname),
  new CacheFirst({
    cacheName: 'aircraft-photos',
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 90 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// A new version waits until the user agrees (see pwa/register.ts).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void worker.skipWaiting();
});

// Daily check for currencies and ratings that got worse, where the browser runs periodic background sync.
self.addEventListener('periodicsync', (event) => {
  const e = event as unknown as ExtendableEventLike & { tag: string };
  if (e.tag !== 'flightbook-alerts') return;
  const db = new LogbookDB();
  e.waitUntil(
    checkAlerts(db, (item) => worker.registration.showNotification(item.title, {
      body: item.body,
      tag: item.key,
      icon: new URL('icon-192.png', worker.registration.scope).href,
      data: { url: worker.registration.scope },
    })).finally(() => db.close()),
  );
});

// Tapping a notification brings the app to the front, or opens it.
self.addEventListener('notificationclick', (event) => {
  const e = event as unknown as NotificationClickEventLike;
  e.notification.close();
  const url = (e.notification.data as { url?: string } | null)?.url ?? worker.registration.scope;
  e.waitUntil(
    worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => (all[0] ? all[0].focus() : worker.clients.openWindow(url))),
  );
});
