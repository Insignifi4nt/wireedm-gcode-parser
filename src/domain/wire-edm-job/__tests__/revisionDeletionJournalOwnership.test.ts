import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { recoverSavedRevisionTransaction, SAVED_REVISION_TRANSACTION_PATH } from '@/domain/storage/savedRevisionTransaction';
import { readExactTransactionText as exact, transactionFileHash } from '@/domain/storage/transactionFileState';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { initializeWorkbenchCatalog, WORKBENCH_CATALOG_PATH } from '@/domain/workbench-catalog/workbenchCatalog';
import { addStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { createWorkbenchProjectDocument, parseWorkbenchProjectDocument, serializeWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { workbenchProjectDocumentPath, workbenchProjectRevisionPath } from '@/domain/workbench-catalog/workbenchProjectStorage';
import { deleteStoredWireEdmJobRevisions } from '../deleteSavedWireEdmJobRevisions';

const projectId = 'fixture.part';
const projectPath = workbenchProjectDocumentPath(projectId);
const selectedPath = workbenchProjectRevisionPath(projectId, 'revision.selected');
const keptPath = workbenchProjectRevisionPath(projectId, 'revision.kept');
const foreignPath = workbenchProjectRevisionPath(projectId, 'revision.foreign');
const paths = [projectPath, WORKBENCH_CATALOG_PATH, selectedPath, keptPath, foreignPath, SAVED_REVISION_TRANSACTION_PATH];
const deletionInput = { projectId, revisionIds: ['revision.selected'], deletedAt: new Date('2026-08-28T13:00:00.000Z') };

async function fixture(adapter: WorkbenchStorageAdapter) {
  const now = new Date('2026-08-28T12:00:00.000Z');
  const initialized = await initializeWorkbenchCatalog(adapter, { now });
  if (!initialized.ok) throw new Error(initialized.error.message);
  const created = createWorkbenchProjectDocument({
    id: projectId, name: 'Fixture part', now, source: { kind: 'upid', files: [] },
    content: { kind: 'upid-document', document: createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 5, y: 5 }, radius: 2 }
    ]) }
  });
  if (!created.ok) throw new Error(created.error.message);
  const added = await addStoredWorkbenchProject(initialized.workbench, { project: created.project, ownedFiles: [] });
  if (!added.ok) throw new Error(added.error.message);
  const indexed = parseWorkbenchProjectDocument(JSON.stringify({ ...added.project,
    savedRevisionIds: ['revision.selected', 'revision.kept'] }));
  if (!indexed.ok) throw new Error(indexed.error.message);
  const serialized = serializeWorkbenchProjectDocument(indexed.project);
  if (!serialized.ok) throw new Error(serialized.error.message);
  await adapter.writeText(projectPath, serialized.text);
  // Deletion fingerprints exact saved bytes without interpreting their contents.
  await adapter.writeText(selectedPath, '\ufeffSELECTED IMMUTABLE REVISION\r\n');
  await adapter.writeText(keptPath, 'KEPT IMMUTABLE REVISION');
  await adapter.writeText(foreignPath, '\ufeffUNINDEXED FOREIGN REVISION EVIDENCE\r\n');
  return { workbench: added.workbench, original: await Promise.all(paths.map(path => exact(adapter, path))) };
}

describe.each(['cache', 'folder'] as const)('%s revision deletion journal ownership', kind => {
  function storage(): WorkbenchStorageAdapter {
    return kind === 'cache' ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('revision-delete-ownership') as unknown as FileSystemDirectoryHandle);
  }

  describe.each(['project-write-failure', 'manifest-committed'] as const)('%s', stage => {
    it.each(['missing', 'empty', 'recognized'] as const)('preserves a replaced %s journal and all current files', async image => {
      const adapter = storage();
      const setup = await fixture(adapter);
      const foreignHash = await transactionFileHash(adapter, foreignPath);
      const write = adapter.writeText.bind(adapter);
      const erase = adapter.deleteText.bind(adapter);
      let ownJournal = '';
      let replaced = false;
      let replacementState: (string | null)[] = [];
      vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
        if (path === SAVED_REVISION_TRANSACTION_PATH) ownJournal = text;
        await write(path, text);
        if (!replaced && path === (stage === 'project-write-failure' ? projectPath : WORKBENCH_CATALOG_PATH)) {
          replaced = true;
          const recorded: unknown = JSON.parse(ownJournal);
          if (!recorded || typeof recorded !== 'object') throw new Error('Expected the recorded deletion journal');
          const replacement = image === 'empty' ? '' : JSON.stringify({ ...recorded,
            revisionIds: ['revision.foreign'], previousRevisionHashes: [foreignHash] });
          if (image === 'missing') await erase(SAVED_REVISION_TRANSACTION_PATH);
          else await write(SAVED_REVISION_TRANSACTION_PATH, replacement);
          replacementState = await Promise.all(paths.map(path => exact(adapter, path)));
          if (stage === 'project-write-failure') throw new Error('Project write reported failure after journal replacement');
        }
      });
      const remove = vi.spyOn(adapter, 'deleteText');
      expect(await deleteStoredWireEdmJobRevisions(setup.workbench, deletionInput)).toMatchObject({
        ok: false, error: { code: 'REVISION_DELETION_FAILED', message: expect.stringContaining('changed outside this transaction') }
      });
      expect(replaced).toBe(true);
      expect(await Promise.all(paths.map(path => exact(adapter, path)))).toEqual(replacementState);
      expect(remove).not.toHaveBeenCalled();
    });
  });

  it('restores its exact indexes after its own project write reports failure', async () => {
    const adapter = storage();
    const setup = await fixture(adapter);
    const write = adapter.writeText.bind(adapter);
    let failed = false;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      await write(path, text);
      if (!failed && path === projectPath) { failed = true; throw new Error('Interrupted project index write'); }
    });
    expect(await deleteStoredWireEdmJobRevisions(setup.workbench, deletionInput)).toMatchObject({ ok: false });
    expect(await Promise.all(paths.map(path => exact(adapter, path)))).toEqual(setup.original);
  });

  it.each(['before-revision', 'after-revision', 'journal'] as const)('retries its own %s deletion failure without touching other revisions', async failure => {
    const adapter = storage();
    const setup = await fixture(adapter);
    const remove = adapter.deleteText.bind(adapter);
    let failed = false;
    vi.spyOn(adapter, 'deleteText').mockImplementation(async path => {
      if (!failed && path === (failure === 'journal' ? SAVED_REVISION_TRANSACTION_PATH : selectedPath)) {
        failed = true;
        if (failure === 'after-revision') await remove(path);
        throw new Error('Interrupted deletion');
      }
      await remove(path);
    });
    expect(await deleteStoredWireEdmJobRevisions(setup.workbench, deletionInput)).toMatchObject({
      ok: true, deletedCount: 1, project: { savedRevisionIds: ['revision.kept'] }
    });
    expect(failed).toBe(true);
    expect(await exact(adapter, selectedPath)).toBeNull();
    expect(await exact(adapter, keptPath)).toBe(setup.original[3]);
    expect(await exact(adapter, foreignPath)).toBe(setup.original[4]);
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).toBeNull();
  });

  it('retains its interrupted deletion journal so startup recovery can finish later', async () => {
    const adapter = storage();
    const setup = await fixture(adapter);
    const remove = adapter.deleteText.bind(adapter);
    const fault = vi.spyOn(adapter, 'deleteText').mockImplementation(async path => {
      if (path === selectedPath) throw new Error('Revision deletion unavailable');
      await remove(path);
    });
    expect(await deleteStoredWireEdmJobRevisions(setup.workbench, deletionInput)).toMatchObject({ ok: false });
    expect(await exact(adapter, selectedPath)).toBe(setup.original[2]);
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).not.toBeNull();
    fault.mockRestore();
    expect(await recoverSavedRevisionTransaction(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, selectedPath)).toBeNull();
    expect(await exact(adapter, keptPath)).toBe(setup.original[3]);
    expect(await exact(adapter, foreignPath)).toBe(setup.original[4]);
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).toBeNull();
  });

  it.each(['absent', 'replaced-during-proof'] as const)('checks the %s journal before accepting a completed cleanup receipt', async journalState => {
    const adapter = storage();
    const setup = await fixture(adapter);
    const remove = adapter.deleteText.bind(adapter);
    if (!adapter.readExactText) throw new Error('Expected exact adapter reads');
    const read = adapter.readExactText.bind(adapter);
    const write = adapter.writeText.bind(adapter);
    const replacement = '\ufeffFOREIGN JOURNAL AFTER CLEANUP\r\n';
    let journalRemoved = false;
    let failed = false;
    let replaced = false;
    vi.spyOn(adapter, 'deleteText').mockImplementation(async path => {
      await remove(path);
      if (path === SAVED_REVISION_TRANSACTION_PATH) journalRemoved = true;
    });
    vi.spyOn(adapter, 'readExactText').mockImplementation(async path => {
      if (path === SAVED_REVISION_TRANSACTION_PATH && journalRemoved && !failed) {
        failed = true;
        throw new Error('Journal removal readback unavailable');
      }
      const contents = await read(path);
      if (journalState === 'replaced-during-proof' && failed && path === projectPath && !replaced) {
        replaced = true;
        await write(SAVED_REVISION_TRANSACTION_PATH, replacement);
      }
      return contents;
    });
    expect(await deleteStoredWireEdmJobRevisions(setup.workbench, deletionInput)).toMatchObject(journalState === 'absent'
      ? { ok: true, deletedCount: 1, project: { savedRevisionIds: ['revision.kept'] } }
      : { ok: false, error: { code: 'REVISION_DELETION_FAILED', message: expect.stringContaining('changed outside this transaction') } });
    expect(failed).toBe(true);
    expect(replaced).toBe(journalState === 'replaced-during-proof');
    expect(await exact(adapter, selectedPath)).toBeNull();
    expect(await exact(adapter, keptPath)).toBe(setup.original[3]);
    expect(await exact(adapter, foreignPath)).toBe(setup.original[4]);
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).toBe(journalState === 'absent' ? null : replacement);
  });
});
