import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { createBrowserCacheAdapter } from './browserCacheAdapter';

export const BROWSER_WORKBENCH_NAMESPACE = 'wire-edm-workbench';

interface ConnectCachedWorkbenchOptions {
  storage?: Storage;
  now?: Date;
}

export async function connectCachedWorkbench(options: ConnectCachedWorkbenchOptions = {}) {
  const storageSource = options.storage && typeof navigator !== 'undefined' && navigator.locks
    ? { storage: options.storage, persistent: true }
    : getBrowserStorage();
  const adapter = createBrowserCacheAdapter(storageSource.storage, {
    kind: storageSource.persistent ? 'browser-cache' : 'memory',
    name: storageSource.persistent ? 'Local storage' : 'Temporary storage',
    namespace: BROWSER_WORKBENCH_NAMESPACE,
    ...('warning' in storageSource ? { persistenceWarning: storageSource.warning } : {})
  });

  return initializeWorkbenchCatalog(adapter, {
    now: options.now
  });
}

function getBrowserStorage() {
  try {
    if (!navigator.locks) {
      return { persistent: false, storage: createVolatileStorage(),
        warning: 'This browser cannot coordinate persistent edits across tabs. Temporary storage is active; changes last only until this page closes or reloads. Existing browser-cache projects are untouched. Open this site in a browser with Web Locks support to use them.' };
    }
    const storage = window.localStorage;
    const probeKey = `${BROWSER_WORKBENCH_NAMESPACE}:storage-probe`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
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
