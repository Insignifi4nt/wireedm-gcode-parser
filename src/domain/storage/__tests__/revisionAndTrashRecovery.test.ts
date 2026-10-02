import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import { beginRevisionDeletionTransaction, beginSavedRevisionTransaction, recoverSavedRevisionTransaction, SAVED_REVISION_TRANSACTION_PATH } from '../savedRevisionTransaction';
import { commitProjectPurgeTransaction, commitProjectTrashTransaction, recoverProjectTrashTransaction, PROJECT_TRASH_TRANSACTION_PATH } from '../projectTrashTransaction';
import { readExactTransactionText as exact, transactionFileHash } from '../transactionFileState';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

const projectPath = 'projects/part.json';
const revisionPath = 'projects/part/revisions/revision.one.wireedm-job.json';
const otherRevisionPath = 'projects/part/revisions/revision.two.wireedm-job.json';
const save = { projectId: 'part', revisionId: 'revision.one', previousProject: '\uFEFFPREVIOUS PROJECT\r\n',
  previousManifest: '\uFEFFPREVIOUS CATALOG\r\n', nextProject: 'NEXT PROJECT', nextManifest: 'NEXT CATALOG', nextRevision: 'SAVED REVISION' };

describe.each(['cache', 'folder'] as const)('%s revision and trash recovery', (kind) => {
  function storage(): WorkbenchStorageAdapter {
    return kind === 'cache' ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('recovery') as unknown as FileSystemDirectoryHandle);
  }
  async function savedFixture() {
    const adapter = storage();
    await adapter.writeText(projectPath, save.previousProject);
    await adapter.writeText('workbench.json', save.previousManifest);
    expect(await beginSavedRevisionTransaction(adapter, save)).toEqual({ ok: true });
    await adapter.writeText(revisionPath, save.nextRevision);
    await adapter.writeText(projectPath, save.nextProject);
    return adapter;
  }
  async function deletionFixture() {
    const adapter = storage();
    await adapter.writeText(projectPath, save.previousProject);
    await adapter.writeText('workbench.json', save.previousManifest);
    await adapter.writeText(revisionPath, '\uFEFFREVISION ONE');
    await adapter.writeText(otherRevisionPath, 'REVISION TWO');
    expect(await beginRevisionDeletionTransaction(adapter, {
      projectId: 'part', revisionIds: ['revision.one', 'revision.two'],
      previousProject: save.previousProject, previousManifest: save.previousManifest,
      nextProject: save.nextProject, nextManifest: save.nextManifest
    })).toEqual({ ok: true });
    await adapter.writeText(projectPath, save.nextProject);
    await adapter.writeText('workbench.json', save.nextManifest);
    return adapter;
  }

  it.each([projectPath, 'workbench.json', revisionPath])('preserves conflicting %s and every saved-revision journal image', async (path) => {
    const adapter = await savedFixture();
    await adapter.writeText(path, '\uFEFFUNRELATED CONTENT');
    const paths = [projectPath, 'workbench.json', revisionPath, SAVED_REVISION_TRANSACTION_PATH];
    const before = await Promise.all(paths.map((file) => exact(adapter, file)));
    const writes = vi.spyOn(adapter, 'writeText');
    const deletes = vi.spyOn(adapter, 'deleteText');
    expect(await recoverSavedRevisionTransaction(adapter)).toMatchObject({ ok: false });
    expect(writes).not.toHaveBeenCalled();
    expect(deletes).not.toHaveBeenCalled();
    expect(await Promise.all(paths.map((file) => exact(adapter, file)))).toEqual(before);
    await adapter.writeText(path, path === projectPath ? save.nextProject : path === revisionPath ? save.nextRevision : save.previousManifest);
    expect(await recoverSavedRevisionTransaction(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, projectPath)).toBe(save.previousProject);
    expect(await exact(adapter, 'workbench.json')).toBe(save.previousManifest);
    expect(await exact(adapter, revisionPath)).toBeNull();
  });

  it('does not mistake an added BOM or partial catalog for a recorded state', async () => {
    const adapter = await savedFixture();
    for (const unknown of [`\uFEFF${save.nextProject}`, '{partial']) {
      await adapter.writeText(projectPath, unknown);
      expect(await recoverSavedRevisionTransaction(adapter)).toMatchObject({ ok: false });
      expect(await exact(adapter, projectPath)).toBe(unknown);
      expect(await exact(adapter, revisionPath)).toBe(save.nextRevision);
      expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).not.toBeNull();
    }
  });

  it('finalizes complete saves and rolls back empty first-write revision handles', async () => {
    const adapter = await savedFixture();
    await adapter.writeText('workbench.json', save.nextManifest);
    expect(await recoverSavedRevisionTransaction(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, revisionPath)).toBe(save.nextRevision);
    const interrupted = await savedFixture();
    await interrupted.writeText(projectPath, save.previousProject);
    await interrupted.writeText(revisionPath, '');
    expect(await recoverSavedRevisionTransaction(interrupted)).toEqual({ ok: true });
    expect(await exact(interrupted, revisionPath)).toBeNull();
    expect(await exact(interrupted, projectPath)).toBe(save.previousProject);
  });

  it.each(['project', 'committed'] as const)('preserves an empty revision after the %s index state advanced', async (state) => {
    const adapter = await savedFixture();
    if (state === 'committed') await adapter.writeText('workbench.json', save.nextManifest);
    await adapter.writeText(revisionPath, '');
    const paths = [revisionPath, projectPath, 'workbench.json', SAVED_REVISION_TRANSACTION_PATH];
    const before = await Promise.all(paths.map((path) => exact(adapter, path)));
    expect(await recoverSavedRevisionTransaction(adapter)).toMatchObject({ ok: false });
    expect(await Promise.all(paths.map((path) => exact(adapter, path)))).toEqual(before);
  });

  it.each([projectPath, 'workbench.json', otherRevisionPath])('preflights all revision-deletion files before changing %s', async (path) => {
    const adapter = await deletionFixture();
    await adapter.writeText(path, 'UNRELATED CONTENT');
    const paths = [projectPath, 'workbench.json', revisionPath, otherRevisionPath, SAVED_REVISION_TRANSACTION_PATH];
    const before = await Promise.all(paths.map((file) => exact(adapter, file)));
    expect(await recoverSavedRevisionTransaction(adapter)).toMatchObject({ ok: false });
    expect(await Promise.all(paths.map((file) => exact(adapter, file)))).toEqual(before);
  });

  it('retries deletion after a crash between files, preserving exact-hash verification', async () => {
    const adapter = await deletionFixture();
    const remove = adapter.deleteText.bind(adapter);
    const spy = vi.spyOn(adapter, 'deleteText').mockImplementation(async (path) => {
      if (path === otherRevisionPath) throw new Error('Interrupted deletion');
      await remove(path);
    });
    expect(await recoverSavedRevisionTransaction(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, revisionPath)).toBeNull();
    expect(await exact(adapter, otherRevisionPath)).toBe('REVISION TWO');
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).not.toBeNull();
    spy.mockRestore();
    expect(await recoverSavedRevisionTransaction(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, otherRevisionPath)).toBeNull();
  });

  it('preserves deletion evidence when an owned revision changes before index commit', async () => {
    const adapter = await deletionFixture();
    await adapter.writeText('workbench.json', save.previousManifest);
    await adapter.writeText(otherRevisionPath, 'EXTERNAL REVISION');
    expect(await recoverSavedRevisionTransaction(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, projectPath)).toBe(save.nextProject);
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).not.toBeNull();
    await adapter.writeText(otherRevisionPath, 'REVISION TWO');
    expect(await recoverSavedRevisionTransaction(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, projectPath)).toBe(save.previousProject);
    expect(await exact(adapter, revisionPath)).toBe('\uFEFFREVISION ONE');
  });

  it('retains legacy deletion evidence while unverified revision files remain', async () => {
    const adapter = await deletionFixture();
    const journal = JSON.parse((await exact(adapter, SAVED_REVISION_TRANSACTION_PATH))!);
    journal.schemaVersion = 1;
    delete journal.previousRevisionHashes;
    await adapter.writeText(SAVED_REVISION_TRANSACTION_PATH, JSON.stringify(journal));
    expect(await recoverSavedRevisionTransaction(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, revisionPath)).toBe('\uFEFFREVISION ONE');
    expect(await exact(adapter, SAVED_REVISION_TRANSACTION_PATH)).not.toBeNull();
    await adapter.deleteText(revisionPath);
    await adapter.deleteText(otherRevisionPath);
    expect(await recoverSavedRevisionTransaction(adapter)).toEqual({ ok: true });
  });

  it('captures exact trash before-images and preserves a conflicting catalog on restart', async () => {
    const adapter = storage();
    await adapter.writeText('workbench.json', save.previousManifest);
    const remove = vi.spyOn(adapter, 'deleteText').mockRejectedValue(new Error('Keep journal'));
    expect(await commitProjectTrashTransaction(adapter, save.nextManifest)).toEqual({ ok: true });
    remove.mockRestore();
    const journal = (await exact(adapter, PROJECT_TRASH_TRANSACTION_PATH))!;
    expect(JSON.parse(journal).previous).toBe(save.previousManifest);
    for (const unknown of ['{partial', `\uFEFF${save.nextManifest}`]) {
      await adapter.writeText('workbench.json', unknown);
      expect(await recoverProjectTrashTransaction(adapter)).toMatchObject({ ok: false });
      expect(await exact(adapter, 'workbench.json')).toBe(unknown);
      expect(await exact(adapter, PROJECT_TRASH_TRANSACTION_PATH)).toBe(journal);
    }
    await adapter.writeText('workbench.json', save.previousManifest);
    expect(await recoverProjectTrashTransaction(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, 'workbench.json')).toBe(save.previousManifest);
  });

  it('refuses purge of changed content before deleting any owned file and safely retries', async () => {
    const adapter = storage();
    await adapter.writeText('workbench.json', save.previousManifest);
    await adapter.writeText(projectPath, '\uFEFFPROJECT');
    await adapter.writeText(revisionPath, 'REVISION');
    const write = adapter.writeText.bind(adapter);
    const spy = vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      await write(path, text);
      if (path === 'workbench.json') await write(revisionPath, '\uFEFFREVISION');
    });
    expect(await commitProjectPurgeTransaction(adapter, { projectId: 'part', ownedPaths: [projectPath, revisionPath], next: save.nextManifest })).toMatchObject({ ok: false });
    spy.mockRestore();
    const journal = (await exact(adapter, PROJECT_TRASH_TRANSACTION_PATH))!;
    expect(JSON.parse(journal)).toMatchObject({ schemaVersion: 2, previous: save.previousManifest });
    expect(await exact(adapter, projectPath)).toBe('\uFEFFPROJECT');
    expect(await exact(adapter, revisionPath)).toBe('\uFEFFREVISION');
    await adapter.writeText(revisionPath, 'REVISION');
    expect(await recoverProjectTrashTransaction(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, projectPath)).toBeNull();
    expect(await exact(adapter, revisionPath)).toBeNull();
  });

  it('resumes interrupted purge with fingerprints and blocks legacy unverified deletions', async () => {
    const adapter = storage();
    await adapter.writeText(projectPath, 'PROJECT');
    await adapter.writeText(revisionPath, 'REVISION');
    const ownedPaths = [projectPath, revisionPath];
    const ownedHashes = await Promise.all(ownedPaths.map((path) => transactionFileHash(adapter, path)));
    const journal = { format: 'wire-edm-project-purge-transaction', schemaVersion: 1,
      projectId: 'part', ownedPaths, previous: save.previousManifest, next: save.nextManifest };
    await adapter.writeText('workbench.json', save.nextManifest);
    await adapter.writeText(PROJECT_TRASH_TRANSACTION_PATH, JSON.stringify(journal));
    expect(await recoverProjectTrashTransaction(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, projectPath)).toBe('PROJECT');
    await adapter.writeText(PROJECT_TRASH_TRANSACTION_PATH, JSON.stringify({ ...journal, schemaVersion: 2, ownedHashes }));
    await adapter.deleteText(projectPath);
    expect(await recoverProjectTrashTransaction(adapter)).toEqual({ ok: true });
    expect(await exact(adapter, revisionPath)).toBeNull();
  });
});
