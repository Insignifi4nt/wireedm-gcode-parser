import { createBrowserCacheAdapter } from './browserCacheAdapter';
import { initializeWorkbenchDirectory } from './workbenchStorage';

interface ConnectCachedWorkbenchOptions {
  storage?: Storage;
  now?: Date;
}

export async function connectCachedWorkbench(options: ConnectCachedWorkbenchOptions = {}) {
  const storage = options.storage ?? getBrowserStorage();
  const adapter = createBrowserCacheAdapter(storage, {
    name: 'Browser cache',
    namespace: 'wire-edm-workbench'
  });

  return initializeWorkbenchDirectory(adapter, {
    now: options.now
  });
}

function getBrowserStorage() {
  try {
    const storage = window.localStorage;
    const probeKey = 'wire-edm-workbench:storage-probe';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return createVolatileStorage();
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
