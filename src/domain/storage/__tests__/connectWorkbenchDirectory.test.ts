import { afterEach, describe, expect, it } from 'vitest';

import {
  connectRememberedWorkbenchDirectory,
  connectWorkbenchDirectory,
  type WorkbenchDirectoryHandleStore
} from '../connectWorkbenchDirectory';
import type { WorkbenchStorageAdapter } from '../workbenchStorage';

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

  it('requests a directory handle, adapts it, and initializes the workbench folder', async () => {
    const adapter = new MemoryWorkbenchAdapter('wire-jobs');
    const handleStore = new MemoryHandleStore();
    const pickedHandle = directoryHandle('wire-jobs');
    const result = await connectWorkbenchDirectory({
      requestDirectory: async () => pickedHandle,
      createAdapter: () => adapter,
      handleStore,
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    expect(result.manifest.name).toBe('wire-jobs');
    expect(result.header).toContain('G90 G21 G17 G40');
    expect(result.footer).toContain('M30');
    expect(adapter.files.has('workbench.json')).toBe(true);
    expect(handleStore.handle).toBe(pickedHandle);
  });

  it('reuses a remembered directory handle before showing the folder picker', async () => {
    const adapter = new MemoryWorkbenchAdapter('remembered-jobs');
    const handleStore = new MemoryHandleStore();
    handleStore.handle = directoryHandle('remembered-jobs');

    const result = await connectWorkbenchDirectory({
      requestDirectory: async () => {
        throw new Error('folder picker should not open');
      },
      createAdapter: () => adapter,
      handleStore,
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    expect(result.manifest.name).toBe('remembered-jobs');
    expect(adapter.files.has('workbench.json')).toBe(true);
  });

  it('restores a remembered directory only when permission is already granted', async () => {
    const adapter = new MemoryWorkbenchAdapter('remembered-jobs');
    const handleStore = new MemoryHandleStore();
    handleStore.handle = directoryHandle('remembered-jobs', 'granted');
    window.showDirectoryPicker = async () => handleStore.handle!;

    const restored = await connectRememberedWorkbenchDirectory({
      createAdapter: () => adapter,
      handleStore,
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    expect(restored.status).toBe('connected');
    if (restored.status === 'connected') {
      expect(restored.workbench.manifest.name).toBe('remembered-jobs');
    }
  });

  it('reports permission-needed for remembered folders that need a user gesture', async () => {
    const handleStore = new MemoryHandleStore();
    handleStore.handle = directoryHandle('remembered-jobs', 'prompt');
    window.showDirectoryPicker = async () => handleStore.handle!;

    const restored = await connectRememberedWorkbenchDirectory({
      handleStore
    });

    expect(restored.status).toBe('permission-needed');
  });

  it('returns an error result when the remembered handle store read rejects', async () => {
    window.showDirectoryPicker = async () => directoryHandle('unused');

    const result = await connectRememberedWorkbenchDirectory({
      handleStore: {
        read: async () => {
          throw new Error('IndexedDB failed');
        },
        write: async () => {}
      }
    });

    expect(result).toEqual({ status: 'error', message: 'IndexedDB failed' });
  });
});
