import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

interface BrowserCacheAdapterOptions {
  kind?: 'browser-cache' | 'memory';
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
    name: options.name ?? 'Local storage',
    kind: options.kind ?? 'browser-cache',
    ensureDirectory: async (path: string) => {
      const directories = readDirectories(storage, namespace);
      if (!directories.includes(path)) {
        directories.push(path);
        directories.sort();
        storage.setItem(directoriesKey, JSON.stringify(directories));
      }
    },
    readText: async (path: string) => storage.getItem(fileKey(namespace, path)),
    deleteText: async (path: string) => {
      storage.removeItem(fileKey(namespace, path));
    },
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
    listDirectories: async () => readDirectories(storage, namespace)
  };
}

function fileKey(namespace: string, path: string) {
  return `${namespace}:file:${path}`;
}

function readDirectories(storage: Storage, namespace: string): string[] {
  const key = `${namespace}:directories`;
  const raw = storage.getItem(key);
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const isDirectory = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
  if (Array.isArray(parsed) && parsed.every(isDirectory)) return parsed;

  // Directory metadata is rebuildable; stored file contents remain authoritative.
  const directories = new Set<string>(Array.isArray(parsed) ? parsed.filter(isDirectory) : []);
  const prefix = `${namespace}:file:`;
  for (let index = 0; index < storage.length; index++) {
    const file = storage.key(index);
    if (!file?.startsWith(prefix)) continue;
    const path = file.slice(prefix.length);
    for (let separator = path.indexOf('/'); separator >= 0; separator = path.indexOf('/', separator + 1)) {
      if (separator > 0) directories.add(path.slice(0, separator));
    }
  }
  const recovered = [...directories].sort();
  if (raw !== null || recovered.length > 0) storage.setItem(key, JSON.stringify(recovered));
  return recovered;
}
