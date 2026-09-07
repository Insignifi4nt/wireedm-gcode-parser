import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectRememberedWorkbenchDirectory,
  connectWorkbenchDirectory,
  forgetWorkbenchDirectory,
  type WorkbenchDirectoryHandleStore
} from '../connectWorkbenchDirectory';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  constructor(readonly name = 'wire-jobs') {}

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.files.set(path, contents);
  }

  async deleteText(path: string) {
    this.files.delete(path);
  }
}

class MemoryHandleStore implements WorkbenchDirectoryHandleStore {
  handle: FileSystemDirectoryHandle | null = null;

  async read() {
    return this.handle;
  }

  async write(handle: FileSystemDirectoryHandle | null) {
    this.handle = handle;
  }
}

function directoryHandle(name: string, permission: 'granted' | 'prompt' = 'granted') {
  return {
    name,
    queryPermission: async () => permission,
    requestPermission: async () => 'granted'
  } as unknown as FileSystemDirectoryHandle;
}

describe('connectWorkbenchDirectory', () => {
  const originalPicker = window.showDirectoryPicker;

  afterEach(() => {
    window.showDirectoryPicker = originalPicker;
    vi.unstubAllGlobals();
  });

  it('requests a directory and creates a strict V2 catalog', async () => {
    const adapter = new MemoryWorkbenchAdapter('wire-jobs');
    const handleStore = new MemoryHandleStore();
    const pickedHandle = directoryHandle('wire-jobs');

    const result = await connectWorkbenchDirectory({
      requestDirectory: async () => pickedHandle,
      createAdapter: () => adapter,
      handleStore,
      now: new Date('2026-08-28T12:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: true,
      kind: 'created',
      workbench: {
        manifest: { schemaVersion: 3, name: 'wire-jobs' },
        posts: { installations: [] },
        machines: { machines: [] }
      }
    });
    expect(JSON.parse(adapter.files.get('workbench.json') ?? '')).toMatchObject({ schemaVersion: 3 });
    expect(handleStore.handle).toBe(pickedHandle);
  });

  it('opens the picker immediately and replaces a remembered folder only after initialization', async () => {
    const root = new FakeDirectoryHandle('new-jobs');
    const pickedHandle = root as unknown as FileSystemDirectoryHandle;
    const handleStore = new MemoryHandleStore();
    handleStore.handle = directoryHandle('remembered-jobs');
    const remembered = handleStore.handle;
    const requestDirectory = vi.fn(async () => pickedHandle);
    const read = vi.spyOn(handleStore, 'read');
    vi.spyOn(handleStore, 'write').mockImplementation(async (handle) => {
      expect(handleStore.handle).toBe(remembered);
      expect(JSON.parse(root.files.get('workbench.json') ?? '')).toMatchObject({ name: 'new-jobs' });
      handleStore.handle = handle;
    });

    const connecting = connectWorkbenchDirectory({
      requestDirectory,
      handleStore,
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    expect(requestDirectory).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();

    expect(await connecting).toMatchObject({
      ok: true, kind: 'created', workbench: { adapter: { kind: 'directory', name: 'new-jobs' } }
    });
    expect(handleStore.handle).toBe(pickedHandle);
  });

  it('preserves the remembered folder when the picker is cancelled', async () => {
    const handleStore = new MemoryHandleStore();
    const remembered = directoryHandle('remembered-jobs');
    handleStore.handle = remembered;
    const cancelled = new DOMException('Cancelled', 'AbortError');
    await expect(connectWorkbenchDirectory({
      requestDirectory: async () => { throw cancelled; },
      handleStore
    })).rejects.toBe(cancelled);
    expect(handleStore.handle).toBe(remembered);
  });

  it('propagates an invalid V1 directory error without rewriting it', async () => {
    const adapter = new MemoryWorkbenchAdapter('legacy-jobs');
    const handleStore = new MemoryHandleStore();
    const remembered = directoryHandle('remembered-jobs');
    handleStore.handle = remembered;
    const handle = directoryHandle('legacy-jobs');
    const original = JSON.stringify({ schemaVersion: 1, machineProfiles: [] });
    adapter.files.set('workbench.json', original);

    const result = await connectWorkbenchDirectory({
      requestDirectory: async () => handle,
      createAdapter: () => adapter,
      handleStore
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_SCHEMA_INVALID', path: '/name' }
    });
    expect(adapter.files.get('workbench.json')).toBe(original);
    expect(handleStore.handle).toBe(remembered);
  });

  it('returns the V2 initialization result directly for a permitted remembered folder', async () => {
    const adapter = new MemoryWorkbenchAdapter('remembered-jobs');
    const handleStore = new MemoryHandleStore();
    handleStore.handle = directoryHandle('remembered-jobs', 'granted');
    window.showDirectoryPicker = async () => handleStore.handle!;

    const restored = await connectRememberedWorkbenchDirectory({
      createAdapter: () => adapter,
      handleStore,
      now: new Date('2026-08-28T12:00:00.000Z')
    });

    expect(restored).toMatchObject({
      ok: true,
      kind: 'created',
      workbench: { manifest: { schemaVersion: 3, name: 'remembered-jobs' } }
    });
  });

  it('propagates an invalid remembered V1 catalog as the typed initialization result', async () => {
    const adapter = new MemoryWorkbenchAdapter('legacy-remembered');
    const handleStore = new MemoryHandleStore();
    handleStore.handle = directoryHandle('legacy-remembered', 'granted');
    adapter.files.set('workbench.json', JSON.stringify({ schemaVersion: 1 }));
    window.showDirectoryPicker = async () => handleStore.handle!;

    expect(await connectRememberedWorkbenchDirectory({
      createAdapter: () => adapter,
      handleStore
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_SCHEMA_INVALID', path: '/name' }
    });
  });

  it('keeps a missing remembered folder explicit', async () => {
    const handleStore = new MemoryHandleStore();
    window.showDirectoryPicker = async () => directoryHandle('unused');

    expect(await connectRememberedWorkbenchDirectory({ handleStore })).toEqual({
      status: 'missing'
    });
  });

  it('stops reconnecting a folder after returning to browser cache', async () => {
    const handleStore = new MemoryHandleStore();
    handleStore.handle = directoryHandle('remembered-jobs');
    window.showDirectoryPicker = async () => directoryHandle('unused');
    await forgetWorkbenchDirectory(handleStore);
    expect(await connectRememberedWorkbenchDirectory({ handleStore })).toEqual({ status: 'missing' });
  });

  it.each(['complete', 'abort'] as const)('waits for the preference transaction to %s before reporting a switch', async (outcome) => {
    const request = { result: undefined };
    const transaction = {
      objectStore: () => ({ put: () => request }),
      oncomplete: () => {}, onabort: () => {},
      error: new DOMException('Storage transaction failed', 'AbortError')
    };
    const db = { transaction: () => transaction, close: vi.fn() };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const opening = { result: db, onsuccess: () => {} };
        queueMicrotask(() => opening.onsuccess());
        return opening;
      }
    });
    let settled = false;
    const switching = forgetWorkbenchDirectory();
    void switching.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(db.close).not.toHaveBeenCalled();
    if (outcome === 'complete') {
      transaction.oncomplete();
      await expect(switching).resolves.toBeUndefined();
    } else {
      transaction.onabort();
      await expect(switching).rejects.toThrow('Storage transaction failed');
    }
    expect(db.close).toHaveBeenCalledOnce();
  });

  it('keeps permission-needed explicit for a remembered folder requiring a gesture', async () => {
    const handleStore = new MemoryHandleStore();
    handleStore.handle = directoryHandle('remembered-jobs', 'prompt');
    window.showDirectoryPicker = async () => handleStore.handle!;

    expect(await connectRememberedWorkbenchDirectory({ handleStore })).toEqual({
      status: 'permission-needed'
    });
  });

  it('keeps remembered-handle store failures explicit', async () => {
    window.showDirectoryPicker = async () => directoryHandle('unused');

    expect(await connectRememberedWorkbenchDirectory({
      handleStore: {
        read: async () => {
          throw new Error('IndexedDB failed');
        },
        write: async () => {}
      }
    })).toEqual({ status: 'error', message: 'IndexedDB failed' });
  });
});
