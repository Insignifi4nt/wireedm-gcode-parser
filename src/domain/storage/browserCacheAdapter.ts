import type { WorkbenchStorageAdapter } from './workbenchStorage';

interface BrowserCacheAdapterOptions {
  name?: string;
  namespace?: string;
}

export interface BrowserCacheWorkbenchAdapter extends WorkbenchStorageAdapter {
  clear(): Promise<void>;
  listDirectories(): Promise<string[]>;
}

export function createBrowserCacheAdapter(
  storage: Storage,
  options: BrowserCacheAdapterOptions = {}
): BrowserCacheWorkbenchAdapter {
  const namespace = options.namespace ?? 'wire-edm-workbench';
  const directoriesKey = `${namespace}:directories`;

  return {
    name: options.name ?? 'Browser cache',
    kind: 'browser-cache',
    ensureDirectory: async (path: string) => {
      const directories = readDirectories(storage, directoriesKey);
      if (!directories.includes(path)) {
        directories.push(path);
        directories.sort();
        storage.setItem(directoriesKey, JSON.stringify(directories));
      }
    },
    readText: async (path: string) => storage.getItem(fileKey(namespace, path)),
    writeText: async (path: string, contents: string) => {
      storage.setItem(fileKey(namespace, path), contents);
    },
    clear: async () => {
      const keysToRemove: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(`${namespace}:`)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => storage.removeItem(key));
    },
    listDirectories: async () => readDirectories(storage, directoriesKey)
  };
}

function fileKey(namespace: string, path: string) {
  return `${namespace}:file:${path}`;
}

function readDirectories(storage: Storage, key: string) {
  const raw = storage.getItem(key);
  if (!raw) return [];
  return JSON.parse(raw) as string[];
}
