import { describe, expect, it } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { WorkbenchStorageFullError } from '../storageFull';
import { readExactTransactionText as exact } from '../transactionFileState';
import { commitWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH } from '../workbenchFileTransaction';
import { withWorkbenchMutationLock } from '../workbenchMutationLock';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';

type RefuseWrite = (path: string, contents: string) => boolean;

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
    if (this.refuse(path, value)) throw this.quotaError();
    this.values.set(key, value);
  }
}

function cacheStorage() {
  const storage = new RefusingStorage('full');
  const adapter = createBrowserCacheAdapter(storage, { namespace: 'full' });
  return { adapter, refuse: (refuse: RefuseWrite) => { storage.refuse = refuse; }, storage };
}

function folderStorage() {
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

describe('full browser storage', () => {
  it.each([
    ['QuotaExceededError', new DOMException('Setting the value exceeded the quota.', 'QuotaExceededError')],
    ['the legacy Firefox name', Object.assign(new Error('Persistent storage maximum size reached'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' })]
  ])('explains how to keep working when a write is refused with %s', async (_label, quotaError) => {
    const { adapter, refuse, storage } = cacheStorage();
    await adapter.writeText('projects/part.json', 'ORIGINAL');
    storage.quotaError = () => quotaError;
    refuse(() => true);

    const failure = adapter.writeText('projects/part.json', 'REPLACEMENT');
    await expect(failure).rejects.toBeInstanceOf(WorkbenchStorageFullError);
    await expect(failure).rejects.toMatchObject({
      storageKind: 'browser-cache',
      path: 'projects/part.json',
      cause: quotaError,
      message: expect.stringContaining('Settings → Storage → Backup & restore')
    });
    await expect(adapter.ensureDirectory('cad')).rejects.toBeInstanceOf(WorkbenchStorageFullError);
    expect(await adapter.readText('projects/part.json')).toBe('ORIGINAL');
  });

  it('passes other write failures through unchanged', async () => {
    const { adapter, storage, refuse } = cacheStorage();
    const denied = new DOMException('Access denied', 'SecurityError');
    storage.quotaError = () => denied;
    refuse(() => true);
    await expect(adapter.writeText('projects/part.json', 'NEXT')).rejects.toBe(denied);
  });

  it('still lists directories when full storage refuses to repair their rebuildable metadata', async () => {
    const { adapter, refuse, storage } = cacheStorage();
    await adapter.writeText('projects/part.json', 'PART');
    storage.setItem('full:directories', 'not json');
    refuse(() => true);
    expect(await adapter.listDirectories()).toEqual(['projects']);
  });

  it('explains a full disk under a folder workbench', async () => {
    const { adapter, refuse } = folderStorage();
    refuse(() => true);
    await expect(adapter.writeText('projects/part.json', 'NEXT')).rejects.toMatchObject({
      name: 'WorkbenchStorageFullError',
      storageKind: 'directory',
      message: expect.stringContaining('Free disk space')
    });
  });
});

describe.each(['cache', 'folder'] as const)('%s file transaction on full storage', (kind) => {
  function setup(): { adapter: WorkbenchStorageAdapter; refuse: (refuse: RefuseWrite) => void } {
    return kind === 'cache' ? cacheStorage() : folderStorage();
  }

  it('keeps every original and explains the full storage when a data write is refused', async () => {
    const { adapter, refuse } = setup();
    await adapter.writeText('projects/part.json', 'OLD PROJECT');
    await adapter.writeText('workbench.json', 'OLD INDEX');
    refuse((path, contents) => path === 'workbench.json' && contents === 'NEW INDEX');

    await expect(withWorkbenchMutationLock(adapter, () => commitWorkbenchFileTransaction(adapter, [
      { path: 'projects/part.json', contents: 'NEW PROJECT' },
      { path: 'workbench.json', contents: 'NEW INDEX' }
    ]))).rejects.toMatchObject({ path: 'workbench.json', message: expect.stringMatching(/full/) });
    expect(await exact(adapter, 'projects/part.json')).toBe('OLD PROJECT');
    expect(await exact(adapter, 'workbench.json')).toBe('OLD INDEX');
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it('retains recovery data and still explains the full storage when rollback is refused too', async () => {
    const { adapter, refuse } = setup();
    await adapter.writeText('projects/part.json', 'OLD PROJECT');
    await adapter.writeText('workbench.json', 'OLD INDEX');
    refuse((path, contents) => (path === 'workbench.json' && contents === 'NEW INDEX') ||
      (path === 'projects/part.json' && contents === 'OLD PROJECT'));

    await expect(withWorkbenchMutationLock(adapter, () => commitWorkbenchFileTransaction(adapter, [
      { path: 'projects/part.json', contents: 'NEW PROJECT' },
      { path: 'workbench.json', contents: 'NEW INDEX' }
    ]))).rejects.toThrow(/^Storage write and rollback failed\. Recovery data is retained; reopen the workbench before editing\. .*full/);
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
    expect(await exact(adapter, 'workbench.json')).toBe('OLD INDEX');
  });
});
