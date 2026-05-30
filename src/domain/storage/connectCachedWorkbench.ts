import { createBrowserCacheAdapter } from './browserCacheAdapter';
import { initializeWorkbenchDirectory } from './workbenchStorage';

export const BROWSER_WORKBENCH_NAMESPACE = 'wire-edm-workbench';

interface ConnectCachedWorkbenchOptions {
  storage?: Storage;
  now?: Date;
}

export async function connectCachedWorkbench(options: ConnectCachedWorkbenchOptions = {}) {
  const storageSource = options.storage
    ? { storage: options.storage, persistent: true }
    : getBrowserStorage();
  const adapter = createBrowserCacheAdapter(storageSource.storage, {
    kind: storageSource.persistent ? 'browser-cache' : 'memory',
    name: storageSource.persistent ? 'Local storage' : 'Temporary storage',
    namespace: BROWSER_WORKBENCH_NAMESPACE
  });

  return initializeWorkbenchDirectory(adapter, {
    now: options.now
  });
}

function getBrowserStorage() {
  try {
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
