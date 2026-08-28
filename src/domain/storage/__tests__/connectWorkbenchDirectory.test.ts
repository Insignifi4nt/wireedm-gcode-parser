import { afterEach, describe, expect, it } from 'vitest';

import {
  connectRememberedWorkbenchDirectory,
  connectWorkbenchDirectory,
  type WorkbenchDirectoryHandleStore
} from '../connectWorkbenchDirectory';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

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

  async write(handle: FileSystemDirectoryHandle) {
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
        manifest: { schemaVersion: 2, name: 'wire-jobs' },
        posts: { installations: [] },
        machines: { machines: [] }
      }
    });
    expect(JSON.parse(adapter.files.get('workbench.json') ?? '')).toMatchObject({ schemaVersion: 2 });
    expect(handleStore.handle).toBe(pickedHandle);
  });

  it('reuses a permitted remembered directory before showing the picker', async () => {
    const adapter = new MemoryWorkbenchAdapter('remembered-jobs');
    const handleStore = new MemoryHandleStore();
    handleStore.handle = directoryHandle('remembered-jobs');

    const result = await connectWorkbenchDirectory({
      requestDirectory: async () => {
        throw new Error('folder picker should not open');
      },
      createAdapter: () => adapter,
      handleStore,
      now: new Date('2026-08-28T12:00:00.000Z')
    });

    expect(result).toMatchObject({ ok: true, kind: 'created' });
  });

  it('propagates a V1 directory error without rewriting it', async () => {
    const adapter = new MemoryWorkbenchAdapter('legacy-jobs');
    const handleStore = new MemoryHandleStore();
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
      error: { code: 'WORKBENCH_CATALOG_VERSION_UNSUPPORTED', foundVersion: 1 }
    });
    expect(adapter.files.get('workbench.json')).toBe(original);
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
      workbench: { manifest: { schemaVersion: 2, name: 'remembered-jobs' } }
    });
  });

  it('propagates a remembered V1 catalog error as the typed initialization result', async () => {
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
      error: { code: 'WORKBENCH_CATALOG_VERSION_UNSUPPORTED', foundVersion: 1 }
    });
  });

  it('keeps a missing remembered folder explicit', async () => {
    const handleStore = new MemoryHandleStore();
    window.showDirectoryPicker = async () => directoryHandle('unused');

    expect(await connectRememberedWorkbenchDirectory({ handleStore })).toEqual({
      status: 'missing'
    });
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
