import { initializeWorkbenchConnection, type WorkbenchConnectionResult } from './initializeWorkbenchConnection';
import { recoveryStorageSource, type RecoveryStorageSource } from './workbenchRecovery';
import { MAX_STORAGE_INVENTORY_ENTRIES } from './workbenchStorageAdapter';

import { createBrowserCacheAdapter } from './browserCacheAdapter';

export const BROWSER_WORKBENCH_NAMESPACE = 'wire-edm-workbench';

interface ConnectCachedWorkbenchOptions {
  storage?: Storage;
  now?: Date;
}

export async function connectCachedWorkbench(options: ConnectCachedWorkbenchOptions = {}): Promise<WorkbenchConnectionResult> {
  const storageSource = options.storage && typeof navigator !== 'undefined' && navigator.locks
    ? { storage: options.storage, persistent: true }
    : getBrowserStorage(options.storage);
  const adapter = createBrowserCacheAdapter(storageSource.storage, {
    kind: storageSource.persistent ? 'browser-cache' : 'memory',
    name: storageSource.persistent ? 'Local storage' : 'Temporary storage',
    namespace: BROWSER_WORKBENCH_NAMESPACE,
    ...('warning' in storageSource ? { persistenceWarning: storageSource.warning } : {})
  });

  const result = await initializeWorkbenchConnection(adapter, options.now);
  return result.recoverySource || !('recoverySource' in storageSource) ? result : { ...result, recoverySource: storageSource.recoverySource };
}

function getBrowserStorage(override?: Storage) {
  try {
    if (!navigator.locks) {
      let recoverySource: RecoveryStorageSource | undefined;
      // Discovery has no write probe and never initializes the persistent cache without locks.
      try {
        const existing = override ?? window.localStorage;
        if (hasCachedWorkbenchFiles(existing)) recoverySource = recoveryStorageSource(createBrowserCacheAdapter(existing, { namespace: BROWSER_WORKBENCH_NAMESPACE }),
          { code: 'PERSISTENT_STORAGE_UNCOORDINATED', message: 'Persistent browser cache is readable, but this browser cannot coordinate edits. Only read-only recovery export is available.' });
      } catch { /* Storage itself may be inaccessible; the temporary fallback remains explicit. */ }
      return { persistent: false, storage: createVolatileStorage(), recoverySource,
        warning: 'This browser cannot coordinate persistent edits across tabs. Temporary storage is active; changes last only until this page closes or reloads. Existing browser-cache projects are untouched. Open this site in a browser with Web Locks support to use them.' };
    }
    const storage = override ?? window.localStorage;
    const probeKey = `${BROWSER_WORKBENCH_NAMESPACE}:storage-probe`;
    try {
      storage.setItem(probeKey, '1');
      storage.removeItem(probeKey);
    } catch (error) {
      // A full cache can still be read and backed up. Keep its normal validation
      // and recovery path instead of hiding existing data behind an empty cache.
      if (!hasCachedWorkbenchFiles(storage)) throw error;
      return {
        persistent: true,
        storage,
        warning: 'Browser storage could not confirm writes. Existing browser-cache data remains active. Download a workbench backup; saving may fail until storage is available.'
      };
    }
    return {
      persistent: true,
      storage
    };
  } catch {
    return {
      persistent: false,
      warning: 'Persistent browser storage is unavailable. Temporary changes last only until this page closes or reloads.',
      storage: createVolatileStorage()
    };
  }
}

function hasCachedWorkbenchFiles(storage: Storage) {
  const prefix = `${BROWSER_WORKBENCH_NAMESPACE}:file:`;
  for (let index = 0; index < Math.min(storage.length, MAX_STORAGE_INVENTORY_ENTRIES); index++) {
    if (storage.key(index)?.startsWith(prefix)) return true;
  }
  // An incomplete scan cannot establish that the remaining cache is empty.
  return storage.length > MAX_STORAGE_INVENTORY_ENTRIES;
}

function createVolatileStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value)
  };
}
