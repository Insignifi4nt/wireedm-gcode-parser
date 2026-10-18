import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import { beginCatalogPairTransaction, CATALOG_PAIR_TRANSACTION_PATH, finishCatalogPairTransaction } from '../catalogPairTransaction';
import { beginSavedRevisionTransaction, beginRevisionDeletionTransaction, finishSavedRevisionTransaction, SAVED_REVISION_TRANSACTION_PATH } from '../savedRevisionTransaction';
import { readExactTransactionText as exact } from '../transactionFileState';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

const revision = { projectId: 'part', revisionId: 'revision.one', previousProject: 'OLD PROJECT', previousManifest: 'OLD CATALOG', nextProject: 'NEW PROJECT', nextManifest: 'NEW CATALOG', nextRevision: 'NEW REVISION' };
const revisionPath = 'projects/part/revisions/revision.one.wireedm-job.json';

describe.each(['cache', 'folder'] as const)('%s legacy explicit transaction finish', (kind) => {
  const storage = (): WorkbenchStorageAdapter => kind === 'cache'
    ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
    : createBrowserDirectoryAdapter(new FakeDirectoryHandle('finish-integrity') as unknown as FileSystemDirectoryHandle);

  it.each([
    { path: CATALOG_PAIR_TRANSACTION_PATH, finish: finishCatalogPairTransaction },
    { path: SAVED_REVISION_TRANSACTION_PATH, finish: finishSavedRevisionTransaction }
  ])('retains unknown bytes at $path without adopting them as a cleanup image', async ({ path, finish }) => {
    const adapter = storage();
    const unknown = '\ufeffREPLACED UNKNOWN JOURNAL\r\n';
    await adapter.writeText(path, unknown);
    const remove = vi.spyOn(adapter, 'deleteText');
    const write = vi.spyOn(adapter, 'writeText');
    expect(await finish(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, path)).toBe(unknown);
    expect(remove).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['before', 'committed'] as const)('finishes a package journal only when both final catalogs prove the %s state', async (state) => {
    const adapter = storage();
    const values = { previousPosts: 'OLD POSTS', previousMachines: 'OLD MACHINES', nextPosts: 'NEW POSTS', nextMachines: 'NEW MACHINES' };
    await beginCatalogPairTransaction(adapter, values);
    await adapter.writeText('posts/library.json', state === 'committed' ? values.nextPosts : values.previousPosts);
    await adapter.writeText('machines/library.json', state === 'committed' ? values.nextMachines : values.previousMachines);
    const before = await exact(adapter, CATALOG_PAIR_TRANSACTION_PATH);
    const write = vi.spyOn(adapter, 'writeText');
    expect(await finishCatalogPairTransaction(adapter)).toEqual(state === 'committed' ? { ok: true } : expect.objectContaining({ ok: false }));
    expect(write).not.toHaveBeenCalled();
    expect(await exact(adapter, CATALOG_PAIR_TRANSACTION_PATH)).toBe(state === 'committed' ? null : before);
  });

  it.each(['before', 'committed'] as const)('finishes a saved revision journal only when every final image proves the %s state', async (state) => {
    const adapter = storage();
    await beginSavedRevisionTransaction(adapter, revision);
    await adapter.writeText('projects/part.json', state === 'committed' ? revision.nextProject : revision.previousProject);
    await adapter.writeText('workbench.json', state === 'committed' ? revision.nextManifest : revision.previousManifest);
    if (state === 'committed') await adapter.writeText(revisionPath, revision.nextRevision);
    const before = await exact(adapter, SAVED_REVISION_TRANSACTION_PATH);
    const write = vi.spyOn(adapter, 'writeText');
    expect(await finishSavedRevisionTransaction(adapter)).toEqual(state === 'committed' ? { ok: true } : expect.objectContaining({ ok: false }));
    expect(write).not.toHaveBeenCalled();
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).toBe(state === 'committed' ? null : before);
  });

  it.each(['remaining', 'removed'] as const)('finishes a revision-deletion journal only when deletion files are %s', async (state) => {
    const adapter = storage();
    await adapter.writeText(revisionPath, 'EXACT SAVED REVISION');
    await beginRevisionDeletionTransaction(adapter, { projectId: revision.projectId, revisionIds: [revision.revisionId],
      previousProject: revision.previousProject, nextProject: revision.nextProject,
      previousManifest: revision.previousManifest, nextManifest: revision.nextManifest });
    await adapter.writeText('projects/part.json', revision.nextProject);
    await adapter.writeText('workbench.json', revision.nextManifest);
    if (state === 'removed') await adapter.deleteText(revisionPath);
    const before = await exact(adapter, SAVED_REVISION_TRANSACTION_PATH);
    const remove = vi.spyOn(adapter, 'deleteText');
    const write = vi.spyOn(adapter, 'writeText');
    expect(await finishSavedRevisionTransaction(adapter)).toEqual(state === 'removed' ? { ok: true } : expect.objectContaining({ ok: false }));
    expect(write).not.toHaveBeenCalled();
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).toBe(state === 'removed' ? null : before);
    if (state === 'remaining') {
      expect(remove).not.toHaveBeenCalled();
      expect(await exact(adapter, revisionPath)).toBe('EXACT SAVED REVISION');
    }
  });

  it('retains inconsistent deletion fingerprints even when all recorded files are absent', async () => {
    const adapter = storage();
    const raw = JSON.stringify({ format: 'wire-edm-revision-deletion-transaction', schemaVersion: 2,
      projectId: revision.projectId, revisionIds: [revision.revisionId], previousRevisionHashes: [null, null],
      previousProject: revision.previousProject, nextProject: revision.nextProject,
      previousManifest: revision.previousManifest, nextManifest: revision.nextManifest });
    await adapter.writeText(SAVED_REVISION_TRANSACTION_PATH, raw);
    await adapter.writeText('projects/part.json', revision.nextProject);
    await adapter.writeText('workbench.json', revision.nextManifest);
    const remove = vi.spyOn(adapter, 'deleteText');
    expect(await finishSavedRevisionTransaction(adapter)).toMatchObject({ ok: false });
    expect(remove).not.toHaveBeenCalled();
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).toBe(raw);
  });
});
