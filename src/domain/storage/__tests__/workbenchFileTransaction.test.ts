import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import { commitWorkbenchFileTransaction, recoverWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH } from '../workbenchFileTransaction';
import { withWorkbenchMutationLock } from '../workbenchMutationLock';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

describe.each(['cache', 'folder'] as const)('%s file transaction recovery', (kind) => {
  function storage(): WorkbenchStorageAdapter {
    if (kind === 'folder') return createBrowserDirectoryAdapter(new FakeDirectoryHandle('transactions') as unknown as FileSystemDirectoryHandle);
    return createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() });
  }
  const files = [
    { path: 'imports/new.dxf', previous: null, next: 'SOURCE' },
    { path: 'projects/part.json', previous: 'OLD PROJECT', next: 'NEW PROJECT' },
    { path: 'workbench.json', previous: 'OLD INDEX', next: 'NEW INDEX' }
  ];
  it.each([0, 1, 2, 3])('recovers after %i completed file writes without leaving mixed revisions', async (completed) => {
    const adapter = storage();
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files }));
    for (const [index, file] of files.entries()) {
      const contents = index < completed ? file.next : file.previous;
      if (contents !== null) await adapter.writeText(file.path, contents);
    }
    await withWorkbenchMutationLock(adapter, async () => {
      for (const file of files) expect(await adapter.readText(file.path)).toBe(completed === files.length ? file.next : file.previous);
      expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    });
    await recoverWorkbenchFileTransaction(adapter);
  });
  it('makes no project writes if the recovery journal cannot be stored', async () => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'ORIGINAL');
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === WORKBENCH_FILE_TRANSACTION_PATH) throw new Error('Quota');
      return write(path, text);
    });
    await expect(commitWorkbenchFileTransaction(adapter, [{ path: 'workbench.json', contents: 'NEXT' }])).rejects.toThrow('Quota');
    expect(await adapter.readText('workbench.json')).toBe('ORIGINAL');
  });
  it('removes an empty newly created file left before its first write completed', async () => {
    const adapter = storage();
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files: [files[0]] }));
    await adapter.writeText(files[0].path, '');
    await recoverWorkbenchFileTransaction(adapter);
    expect(await adapter.readText(files[0].path)).toBeNull();
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('retains evidence and refuses unexpected external edits during recovery', async () => {
    const adapter = storage();
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files }));
    await adapter.writeText('projects/part.json', 'EXTERNAL CHANGE');
    await expect(recoverWorkbenchFileTransaction(adapter)).rejects.toThrow('outside');
    expect(await adapter.readText('projects/part.json')).toBe('EXTERNAL CHANGE');
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
  });
  it('retries cleanup after committed writes without reporting them as failed', async () => {
    const adapter = storage();
    const remove = adapter.deleteText.bind(adapter);
    vi.spyOn(adapter, 'deleteText').mockRejectedValueOnce(new Error('Cleanup interrupted')).mockImplementation(remove);
    await commitWorkbenchFileTransaction(adapter, [{ path: 'projects/new.json', contents: 'SAVED' }]);
    expect(await adapter.readText('projects/new.json')).toBe('SAVED');
    await recoverWorkbenchFileTransaction(adapter);
    expect(await adapter.readText('projects/new.json')).toBe('SAVED');
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
});
