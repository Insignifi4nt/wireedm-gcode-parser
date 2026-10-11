import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import { commitWorkbenchFileTransaction, recoverWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH } from '../workbenchFileTransaction';
import { readExactTransactionText as exact } from '../transactionFileState';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

const parent = 'imports/original.nc';
const child = `${parent}/source.txt`;
const cache = () => createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() });

describe.each(['cache', 'folder'] as const)('%s file transaction path trees', (kind) => {
  function storage(): WorkbenchStorageAdapter {
    return kind === 'cache' ? cache()
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('path-tree') as unknown as FileSystemDirectoryHandle);
  }

  it.each(['parent-first', 'child-first'] as const)('rejects a final file/directory collision %s before journal writes', async (order) => {
    const adapter = storage();
    const plan = [{ path: parent, contents: 'PARENT' }, { path: child, contents: 'CHILD' }];
    if (order === 'child-first') plan.reverse();
    const write = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    const ensure = vi.spyOn(adapter, 'ensureDirectory');
    await expect(commitWorkbenchFileTransaction(adapter, plan)).rejects.toThrow('collision');
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it('rejects a file at the journal directory root before creating recovery data', async () => {
    const adapter = storage();
    const write = vi.spyOn(adapter, 'writeText');
    const ensure = vi.spyOn(adapter, 'ensureDirectory');
    await expect(commitWorkbenchFileTransaction(adapter, [{ path: 'transactions', contents: 'FILE AT JOURNAL ROOT' }])).rejects.toThrow('Invalid');
    expect(write).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it.each(['imports', 'projects', 'machines', 'posts'])('retains an existing file below %s instead of creating its parent as a file', async (directory) => {
    const adapter = storage();
    const path = `${directory}/original.txt`;
    await adapter.writeText(path, '\ufeffEXACT ORIGINAL');
    const write = vi.spyOn(adapter, 'writeText');
    await expect(commitWorkbenchFileTransaction(adapter, [{ path: directory, contents: 'PARENT FILE' }])).rejects.toThrow('collision');
    expect(write).not.toHaveBeenCalled();
    expect(await exact(adapter, path)).toBe('\ufeffEXACT ORIGINAL');
  });

  it.each(['parent', 'child'] as const)('retains an unchanged existing %s that conflicts with a proposed path', async (existing) => {
    const adapter = storage();
    const existingPath = existing === 'parent' ? parent : child;
    await adapter.writeText(existingPath, '\ufeffEXACT ORIGINAL\r\n');
    const write = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    await expect(commitWorkbenchFileTransaction(adapter, [
      { path: existing === 'parent' ? child : parent, contents: 'NEW FILE' }
    ])).rejects.toThrow('collision');
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await exact(adapter, existingPath)).toBe('\ufeffEXACT ORIGINAL\r\n');
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it.each(['previous', 'next'] as const)('retains a journal with an impossible %s file tree before replay changes files', async (image) => {
    const adapter = storage();
    const files = [parent, child].map(path => ({ path, previous: image === 'previous' ? 'ORIGINAL' : null, next: image === 'next' ? 'NEW FILE' : null }));
    const raw = JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files });
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, raw);
    const write = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    await expect(recoverWorkbenchFileTransaction(adapter)).rejects.toThrow('collision');
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBe(raw);
  });
});

describe('best available path inventory checks', () => {
  it.each(['missing', 'failed', 'partial'] as const)('finds direct parent files when inventory is %s', async (availability) => {
    const base = cache();
    await base.writeText(parent, 'EXACT PARENT ORIGINAL');
    const adapter: WorkbenchStorageAdapter = { ...base,
      listFiles: availability === 'missing' ? undefined : availability === 'failed'
        ? async () => { throw new Error('Optional inventory unavailable'); }
        : async () => ({ paths: [], truncated: true })
    };
    const write = vi.spyOn(adapter, 'writeText');
    await expect(commitWorkbenchFileTransaction(adapter, [{ path: child, contents: 'CHILD' }])).rejects.toThrow('collision');
    expect(write).not.toHaveBeenCalled();
    expect(await exact(adapter, parent)).toBe('EXACT PARENT ORIGINAL');
  });

  it.each(['missing', 'failed', 'partial'] as const)('keeps ordinary file creation available when optional inventory is %s', async (availability) => {
    const base = cache();
    const adapter: WorkbenchStorageAdapter = { ...base,
      listFiles: availability === 'missing' ? undefined : availability === 'failed'
        ? async () => { throw new Error('Optional inventory unavailable'); }
        : async () => ({ paths: [], truncated: true })
    };
    await commitWorkbenchFileTransaction(adapter, [{ path: 'projects/new.json', contents: 'NEW PROJECT' }]);
    expect(await exact(adapter, 'projects/new.json')).toBe('NEW PROJECT');
  });
});

describe('existing cache path-tree transitions', () => {
  it.each(['parent-first', 'child-first'] as const)('preserves delete-parent/create-child in %s order', async (order) => {
    const adapter = cache();
    await adapter.writeText(parent, 'ORIGINAL');
    const plan = [{ path: parent, contents: null }, { path: child, contents: 'CHILD' }];
    if (order === 'child-first') plan.reverse();
    await commitWorkbenchFileTransaction(adapter, plan);
    expect(await exact(adapter, parent)).toBeNull();
    expect(await exact(adapter, child)).toBe('CHILD');
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it.each(['before', 'interrupted', 'committed'] as const)('replays the unchanged journal schema for a %s parent-to-child transition', async (state) => {
    const adapter = cache();
    const files = [{ path: child, previous: null, next: 'CHILD' }, { path: parent, previous: 'ORIGINAL', next: null }];
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files }));
    if (state !== 'committed') await adapter.writeText(parent, 'ORIGINAL');
    if (state !== 'before') await adapter.writeText(child, 'CHILD');
    await recoverWorkbenchFileTransaction(adapter);
    expect(await exact(adapter, parent)).toBe(state === 'committed' ? null : 'ORIGINAL');
    expect(await exact(adapter, child)).toBe(state === 'committed' ? 'CHILD' : null);
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
});

it.each(['parent-first', 'child-first'] as const)('keeps the existing folder TypeMismatch behavior for parent-to-child transitions in %s order', async (order) => {
  class TypeSafeDirectory extends FakeDirectoryHandle {
    override async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
      if (this.files.has(name)) throw new DOMException('A file already has this name', 'TypeMismatchError');
      return super.getDirectoryHandle(name, options);
    }
    override async getFileHandle(name: string, options: { create?: boolean } = {}) {
      if (this.directories.has(name)) throw new DOMException('A directory already has this name', 'TypeMismatchError');
      return super.getFileHandle(name, options);
    }
  }
  const root = new FakeDirectoryHandle('native-path-rules');
  root.directories.set('imports', new TypeSafeDirectory('imports'));
  const adapter = createBrowserDirectoryAdapter(root as unknown as FileSystemDirectoryHandle);
  await adapter.writeText(parent, 'EXACT ORIGINAL');
  const plan = [{ path: parent, contents: null }, { path: child, contents: 'CHILD' }];
  if (order === 'child-first') plan.reverse();
  const write = vi.spyOn(adapter, 'writeText');
  await expect(commitWorkbenchFileTransaction(adapter, plan)).rejects.toThrow('A file already has this name');
  expect(write).not.toHaveBeenCalled();
  expect(await exact(adapter, parent)).toBe('EXACT ORIGINAL');
  expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
});
