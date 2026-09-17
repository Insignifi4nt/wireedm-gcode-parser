import { gunzip, gunzipSync, gzip, gzipSync, strFromU8, strToU8 } from 'fflate';

import { MAX_STORAGE_INVENTORY_ENTRIES, type WorkbenchStorageAdapter } from './workbenchStorageAdapter';

const COMPRESSED_TEXT_PREFIX = '\u0000wire-edm-cache-gzip-v1:';
const MIN_COMPRESS_LENGTH = 4096;

interface BrowserCacheAdapterOptions {
  kind?: 'browser-cache' | 'memory';
  name?: string;
  namespace?: string;
  persistenceWarning?: string;
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
    mutationScope: `browser-storage:${namespace}`,
    ...(options.persistenceWarning ? { persistenceWarning: options.persistenceWarning } : {}),
    ensureDirectory: async (path: string) => {
      const directories = readDirectories(storage, namespace);
      if (!directories.includes(path)) {
        directories.push(path);
        directories.sort();
        storage.setItem(directoriesKey, JSON.stringify(directories));
      }
    },
    readText: async (path: string) => decodeStoredText(storage.getItem(fileKey(namespace, path))),
    deleteText: async (path: string) => {
      storage.removeItem(fileKey(namespace, path));
    },
    writeText: async (path: string, contents: string) => {
      storage.setItem(fileKey(namespace, path), await encodeStoredText(contents));
    },
    listFiles: async () => {
      const paths: string[] = [];
      const prefix = `${namespace}:file:`;
      const count = Math.min(storage.length, MAX_STORAGE_INVENTORY_ENTRIES);
      for (let index = 0; index < count; index++) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) paths.push(key.slice(prefix.length));
      }
      return { paths: paths.sort(), truncated: storage.length > count };
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

async function encodeStoredText(contents: string): Promise<string> {
  if (contents.length < MIN_COMPRESS_LENGTH) return contents;
  const compressed = COMPRESSED_TEXT_PREFIX + btoa(strFromU8(await gzipAsync(strToU8(contents)), true));
  return compressed.length < contents.length ? compressed : contents;
}

async function decodeStoredText(stored: string | null): Promise<string | null> {
  if (stored === null || !stored.startsWith(COMPRESSED_TEXT_PREFIX)) return stored;
  return strFromU8(await gunzipAsync(strToU8(atob(stored.slice(COMPRESSED_TEXT_PREFIX.length)), true)));
}

function gzipAsync(value: Uint8Array): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return Promise.resolve(gzipSync(value));
  return new Promise((resolve, reject) => gzip(value, (error, output) =>
    error ? reject(error) : resolve(output)));
}

function gunzipAsync(value: Uint8Array): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return Promise.resolve(gunzipSync(value));
  return new Promise((resolve, reject) => gunzip(value, (error, output) =>
    error ? reject(error) : resolve(output)));
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
