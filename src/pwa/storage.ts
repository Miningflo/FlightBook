export type PersistenceStatus = 'unknown' | 'granted' | 'denied' | 'unsupported';

/** Whether the browser has promised not to evict our IndexedDB data. */
export async function persistenceStatus(): Promise<PersistenceStatus> {
  if (!navigator.storage?.persisted) return 'unsupported';
  return (await navigator.storage.persisted()) ? 'granted' : 'denied';
}

/** Ask the browser for persistent storage. Important on Android, where site data can be evicted. */
export async function requestPersistence(): Promise<PersistenceStatus> {
  if (!navigator.storage?.persist) return 'unsupported';
  try {
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
