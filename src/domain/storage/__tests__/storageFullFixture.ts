import { gunzipSync } from 'node:zlib';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';

export type RefuseWrite = (path: string, contents: string) => boolean;

class RefusingStorage implements Storage {
  private readonly values = new Map<string, string>();
  refuse: RefuseWrite = () => false;
  quotaError = () => new DOMException('Setting the value exceeded the quota.', 'QuotaExceededError') as Error;

  constructor(private readonly namespace: string) {}
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    const path = key.startsWith(`${this.namespace}:file:`) ? key.slice(`${this.namespace}:file:`.length) : key;
    const prefix = '\u0000wire-edm-cache-gzip-v1:';
    const text = value.startsWith(prefix) ? gunzipSync(Buffer.from(value.slice(prefix.length), 'base64')).toString('utf8') : value;
    if (this.refuse(path, text)) throw this.quotaError();
    this.values.set(key, value);
  }
}

export function cacheStorage() {
  const storage = new RefusingStorage('full');
  const adapter = createBrowserCacheAdapter(storage, { namespace: 'full' });
  return { adapter, refuse: (refuse: RefuseWrite) => { storage.refuse = refuse; }, storage };
}

export function folderStorage() {
  const root = new FakeDirectoryHandle('full');
  let refuse: RefuseWrite = () => false;
  const patch = (directory: FakeDirectoryHandle, prefix: string) => {
    const getFileHandle = directory.getFileHandle.bind(directory);
    directory.getFileHandle = async (name, options) => {
      const handle = await getFileHandle(name, options);
      const createWritable = handle.createWritable.bind(handle);
      return Object.assign(Object.create(Object.getPrototypeOf(handle) as object) as typeof handle, handle, {
        createWritable: async () => {
          const writable = await createWritable();
          return {
            ...writable,
            write: async (contents: string) => {
              if (refuse(`${prefix}${name}`, contents)) throw new DOMException('The disk is full.', 'QuotaExceededError');
              await writable.write(contents);
            },
            abort: async () => undefined
          };
        }
      });
    };
    const getDirectoryHandle = directory.getDirectoryHandle.bind(directory);
    directory.getDirectoryHandle = async (name, options) => {
      const child = await getDirectoryHandle(name, options);
      if (!(child as { patched?: boolean }).patched) {
        patch(child, `${prefix}${name}/`);
        Object.assign(child, { patched: true });
      }
      return child;
    };
  };
  patch(root, '');
  const adapter = createBrowserDirectoryAdapter(root as unknown as FileSystemDirectoryHandle);
  return { adapter, refuse: (next: RefuseWrite) => { refuse = next; } };
}
