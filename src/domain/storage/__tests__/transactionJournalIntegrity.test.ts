import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import { beginCatalogPairTransaction, CATALOG_PAIR_TRANSACTION_PATH, recoverCatalogPairTransaction } from '../catalogPairTransaction';
import { beginSavedRevisionTransaction, beginRevisionDeletionTransaction, recoverSavedRevisionTransaction, SAVED_REVISION_TRANSACTION_PATH } from '../savedRevisionTransaction';
import { commitProjectTrashTransaction, commitProjectPurgeTransaction, PROJECT_TRASH_TRANSACTION_PATH, recoverProjectTrashTransaction } from '../projectTrashTransaction';
import { readExactTransactionText as exact } from '../transactionFileState';
import { commitWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH } from '../workbenchFileTransaction';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

const typedOperations = [
  {
    name: 'package installation', journal: CATALOG_PAIR_TRANSACTION_PATH,
    recover: recoverCatalogPairTransaction,
    begin: (adapter: WorkbenchStorageAdapter) => beginCatalogPairTransaction(adapter, {
      previousPosts: 'OLD POSTS', previousMachines: 'OLD MACHINES', nextPosts: 'NEW POSTS', nextMachines: 'NEW MACHINES'
    })
  },
  {
    name: 'saved revision', journal: SAVED_REVISION_TRANSACTION_PATH,
    recover: recoverSavedRevisionTransaction,
    begin: (adapter: WorkbenchStorageAdapter) => beginSavedRevisionTransaction(adapter, {
      projectId: 'part', revisionId: 'revision.one', previousProject: 'OLD PROJECT', previousManifest: 'OLD CATALOG',
      nextProject: 'NEW PROJECT', nextManifest: 'NEW CATALOG', nextRevision: 'NEW REVISION'
    })
  },
  {
    name: 'revision deletion', journal: SAVED_REVISION_TRANSACTION_PATH,
    recover: recoverSavedRevisionTransaction,
    begin: (adapter: WorkbenchStorageAdapter) => beginRevisionDeletionTransaction(adapter, {
      projectId: 'part', revisionIds: ['revision.one'], previousProject: 'OLD PROJECT', previousManifest: 'OLD CATALOG',
      nextProject: 'NEW PROJECT', nextManifest: 'NEW CATALOG'
    })
  },
  {
    name: 'project trash', journal: PROJECT_TRASH_TRANSACTION_PATH,
    recover: recoverProjectTrashTransaction,
    begin: (adapter: WorkbenchStorageAdapter) => commitProjectTrashTransaction(adapter, 'NEW CATALOG')
  },
  {
    name: 'project purge', journal: PROJECT_TRASH_TRANSACTION_PATH,
    recover: recoverProjectTrashTransaction,
    begin: (adapter: WorkbenchStorageAdapter) => commitProjectPurgeTransaction(adapter, {
      projectId: 'part', ownedPaths: ['projects/part.json'], next: 'NEW CATALOG'
    })
  }
];
const operations = [...typedOperations,
  {
    name: 'generic file transaction', journal: WORKBENCH_FILE_TRANSACTION_PATH,
    begin: async (adapter: WorkbenchStorageAdapter) => {
      try {
        await commitWorkbenchFileTransaction(adapter, [{ path: 'projects/new.json', contents: 'NEW PROJECT' }]);
        return { ok: true } as const;
      } catch (error) { return { ok: false, error } as const; }
    }
  }
];

describe.each(['cache', 'folder'] as const)('%s transaction journal ownership', (kind) => {
  function storage(): WorkbenchStorageAdapter {
    return kind === 'cache' ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('journal-integrity') as unknown as FileSystemDirectoryHandle);
  }

  it.each(operations)('preserves an externally replaced $name journal after failed creation', async (operation) => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'OLD CATALOG');
    await adapter.writeText('projects/part.json', '\ufeffOLD PROJECT\r\n');
    const write = adapter.writeText.bind(adapter);
    const replacement = '\ufeffEXTERNAL RECOVERY EVIDENCE\r\n';
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      await write(path, path === operation.journal ? replacement : text);
      if (path === operation.journal) throw new Error('Interrupted journal creation');
    });
    const remove = vi.spyOn(adapter, 'deleteText');
    expect(await operation.begin(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, operation.journal)).toBe(replacement);
    expect(await exact(adapter, 'workbench.json')).toBe('OLD CATALOG');
    expect(await exact(adapter, 'projects/part.json')).toBe('\ufeffOLD PROJECT\r\n');
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(operations)('preserves a truncated $name journal after its first write completed', async (operation) => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'OLD CATALOG');
    await adapter.writeText('projects/part.json', 'OLD PROJECT');
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      await write(path, text);
      // The first write resolves. An external truncation is not its initial creation handle.
      if (path === operation.journal) await write(path, '');
    });
    const remove = vi.spyOn(adapter, 'deleteText');
    expect(await operation.begin(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, operation.journal)).toBe('');
    expect(await exact(adapter, 'workbench.json')).toBe('OLD CATALOG');
    expect(await exact(adapter, 'projects/part.json')).toBe('OLD PROJECT');
    expect(await exact(adapter, 'projects/new.json')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(operations)('does not clean up a $name journal when directory preparation fails before its write', async (operation) => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'OLD CATALOG');
    await adapter.writeText('projects/part.json', 'OLD PROJECT');
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'ensureDirectory').mockImplementation(async () => {
      // Another writer's empty journal appears during directory preparation.
      await write(operation.journal, '');
      throw new Error('Directory preparation failed');
    });
    const attemptedWrite = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    expect(await operation.begin(adapter)).toMatchObject({ ok: false });
    expect(attemptedWrite).not.toHaveBeenCalled();
    expect(await exact(adapter, operation.journal)).toBe('');
    expect(await exact(adapter, 'workbench.json')).toBe('OLD CATALOG');
    expect(await exact(adapter, 'projects/part.json')).toBe('OLD PROJECT');
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(operations)('keeps ordinary $name journal creation available', async (operation) => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'OLD CATALOG');
    await adapter.writeText('projects/part.json', 'OLD PROJECT');
    expect(await operation.begin(adapter)).toEqual({ ok: true });
  });

  it.each(operations)('preserves an existing unknown journal before beginning $name', async (operation) => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'OLD CATALOG');
    await adapter.writeText('projects/part.json', '\ufeffOLD PROJECT\r\n');
    const unknown = '\ufeffEXISTING UNKNOWN RECOVERY\r\n';
    await adapter.writeText(operation.journal, unknown);
    const write = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    expect(await operation.begin(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, operation.journal)).toBe(unknown);
    expect(await exact(adapter, 'workbench.json')).toBe('OLD CATALOG');
    expect(await exact(adapter, 'projects/part.json')).toBe('\ufeffOLD PROJECT\r\n');
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(typedOperations)('preserves an existing empty $name journal until explicit recovery permits retry', async (operation) => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'OLD CATALOG');
    await adapter.writeText('projects/part.json', 'OLD PROJECT');
    await adapter.writeText(operation.journal, '');
    const write = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    expect(await operation.begin(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, operation.journal)).toBe('');
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await operation.recover(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, operation.journal)).toBeNull();
    expect(await operation.begin(adapter)).toEqual({ ok: true });
  });

  it.each(operations)('preserves an unexpected $name journal created during directory preparation', async (operation) => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'OLD CATALOG');
    await adapter.writeText('projects/part.json', 'OLD PROJECT');
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'ensureDirectory').mockImplementation(async () => {
      await write(operation.journal, '');
    });
    const attemptedWrite = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    expect(await operation.begin(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, operation.journal)).toBe('');
    expect(await exact(adapter, 'workbench.json')).toBe('OLD CATALOG');
    expect(await exact(adapter, 'projects/part.json')).toBe('OLD PROJECT');
    expect(attemptedWrite).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  describe.each(['own', 'empty'] as const)('recognized %s failed first-write image', (image) => {
    it.each(operations)('removes only its $name journal and permits retry', async (operation) => {
      const adapter = storage();
      await adapter.writeText('workbench.json', 'OLD CATALOG');
      await adapter.writeText('projects/part.json', 'OLD PROJECT');
      const write = adapter.writeText.bind(adapter);
      const spy = vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
        await write(path, path === operation.journal && image === 'empty' ? '' : text);
        if (path === operation.journal) throw new Error('Interrupted journal creation');
      });
      expect(await operation.begin(adapter)).toMatchObject({ ok: false });
      expect(await exact(adapter, operation.journal)).toBeNull();
      expect(await exact(adapter, 'workbench.json')).toBe('OLD CATALOG');
      expect(await exact(adapter, 'projects/part.json')).toBe('OLD PROJECT');
      spy.mockRestore();
      expect(await operation.begin(adapter)).toEqual({ ok: true });
    });
  });

  it('preserves a changed trash journal and catalog before immediate rollback', async () => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'OLD CATALOG');
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      await write(path, text);
      if (path === 'workbench.json' && text === 'NEW CATALOG') {
        await write(PROJECT_TRASH_TRANSACTION_PATH, 'REPLACED JOURNAL');
        throw new Error('Interrupted catalog update');
      }
    });
    const remove = vi.spyOn(adapter, 'deleteText');
    expect(await commitProjectTrashTransaction(adapter, 'NEW CATALOG')).toMatchObject({ ok: false });
    expect(await exact(adapter, 'workbench.json')).toBe('NEW CATALOG');
    expect(await exact(adapter, PROJECT_TRASH_TRANSACTION_PATH)).toBe('REPLACED JOURNAL');
    expect(remove).not.toHaveBeenCalled();
  });
});
