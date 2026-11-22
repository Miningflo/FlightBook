import { registerSW } from 'virtual:pwa-register';

/**
 * Registers the service worker. A new version is never applied automatically:
 * the app shows a prompt and only reloads when the user agrees, so an update
 * can't interrupt a flight being entered.
 */
export function registerServiceWorker(onNeedRefresh: (apply: () => void) => void): void {
  const update = registerSW({
    onNeedRefresh() { onNeedRefresh(() => void update(true)); },
  });
}
