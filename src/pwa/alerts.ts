import { db } from '../driveRuntime';
import { checkAlerts } from './alertCheck';
import type { AlertItem } from '../domain/alerts';

export const PERIODIC_TAG = 'flightbook-alerts';

export type AlertSupport = 'unsupported' | 'denied' | 'default' | 'granted';

export function alertSupport(): AlertSupport {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  return Notification.permission;
}

export async function showNotification(item: AlertItem): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(item.title, {
    body: item.body,
    tag: item.key, // a newer alert for the same thing replaces the old one
    icon: new URL('icon-192.png', reg.scope).href,
    data: { url: reg.scope },
  });
}

/** Asks for permission (must come from a tap). Returns the resulting state. */
export async function requestAlertPermission(): Promise<AlertSupport> {
  if (alertSupport() === 'unsupported') return 'unsupported';
  return (await Notification.requestPermission()) as AlertSupport;
}

interface PeriodicSyncManager { register(tag: string, o: { minInterval: number }): Promise<void>; unregister(tag: string): Promise<void> }
const periodicSync = async (): Promise<PeriodicSyncManager | null> => {
  if (!('serviceWorker' in navigator)) return null;
  const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager };
  return reg.periodicSync ?? null;
};

/** Daily background check, where the browser offers it (Chrome on Android, installed app). Returns whether it was set up. */
export async function setBackgroundCheck(on: boolean): Promise<boolean> {
  try {
    const ps = await periodicSync();
    if (!ps) return false;
    if (on) await ps.register(PERIODIC_TAG, { minInterval: 24 * 60 * 60 * 1000 });
    else await ps.unregister(PERIODIC_TAG);
    return on;
  } catch { return false; }
}

/** Check now and notify about anything that got worse (on app open and when the app comes back to the front). */
export const runAlertCheck = (): Promise<number> => checkAlerts(db, showNotification);

/** Remember the current levels without notifying. Called when alerts are turned on. */
export const seedAlerts = (): Promise<number> => checkAlerts(db, showNotification, Date.now(), true);
