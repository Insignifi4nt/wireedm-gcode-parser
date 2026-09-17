import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import { inspectWorkbenchStorage } from '../workbenchStorageReport';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { addStoredWorkbenchProject, deleteStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { MAX_STORAGE_INVENTORY_ENTRIES, type WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

beforeEach(() => localStorage.clear());

describe.each(['cache', 'folder'] as const)('storage review with %s persistence', (kind) => {
  function adapter(): WorkbenchStorageAdapter {
    return kind === 'cache' ? createBrowserCacheAdapter(localStorage, { kind: 'memory' })
      : { ...createBrowserDirectoryAdapter(new FakeDirectoryHandle('report') as unknown as FileSystemDirectoryHandle), kind: 'memory' };
  }

  it('protects trash ownership, classifies retained files, and never writes during review', async () => {
    const storage = adapter();
    const created = await initializeWorkbenchCatalog(storage);
    if (!created.ok) throw new Error(created.error.message);
    const project = createWorkbenchProjectDocument({ id: 'part', name: 'Part', now: new Date(),
      source: { kind: 'upid', files: [{ kind: 'upid', name: 'part.upid', path: 'imports/part.upid', createdAt: new Date().toISOString() }] },
      content: { kind: 'upid-document', document: createUpidFromDxfEntities([]) }
    });
    if (!project.ok) throw new Error(project.error.message);
    const added = await addStoredWorkbenchProject(created.workbench, { project: project.project, ownedFiles: [{ path: 'imports/part.upid', contents: 'SOURCE' }] });
    if (!added.ok) throw new Error(added.error.message);
    const deleted = await deleteStoredWorkbenchProject(added.workbench, { projectId: 'part', deletedAt: new Date() });
    if (!deleted.ok) throw new Error(deleted.error.message);
    await storage.writeText('legacy/v2/workbench.json', 'EXACT BACKUP');
    await storage.writeText('exports/old.iso', 'KEEP');
    const write = vi.spyOn(storage, 'writeText');
    const remove = vi.spyOn(storage, 'deleteText');
    const report = await inspectWorkbenchStorage(deleted.workbench);
    expect(report.complete).toBe(true);
    expect(report.files).toEqual(expect.arrayContaining([
      { path: 'imports/part.upid', category: 'referenced' },
      { path: 'projects/part.json', category: 'referenced' },
      { path: 'legacy/v2/workbench.json', category: 'retained-backup' },
      { path: 'exports/old.iso', category: 'unreferenced' }
    ]));
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('EXACT BACKUP');
    expect(JSON.stringify(report)).not.toContain('SOURCE');
  });

  it('reports incomplete scans and pending recovery without deleting transaction files', async () => {
    const storage = adapter();
    const created = await initializeWorkbenchCatalog(storage);
    if (!created.ok) throw new Error(created.error.message);
    await storage.writeText('transactions/saved-revision.json', 'RECOVERY DATA');
    vi.spyOn(storage, 'listFiles').mockResolvedValue({ paths: ['transactions/saved-revision.json'], truncated: true });
    const report = await inspectWorkbenchStorage(created.workbench);
    expect(report.complete).toBe(false);
    expect(report.problems).toHaveLength(2);
    expect(await storage.readText('transactions/saved-revision.json')).toBe('RECOVERY DATA');
  });

  it('backs up a version-2 catalog through the real adapter before upgrading', async () => {
    const storage = adapter();
    const created = await initializeWorkbenchCatalog(storage);
    if (!created.ok) throw new Error(created.error.message);
    const original = JSON.stringify({ ...created.workbench.manifest, schemaVersion: 2,
      preferences: { ...created.workbench.manifest.preferences, export: { status: 'unconfigured' } } });
    await storage.writeText('workbench.json', original);
    expect(await initializeWorkbenchCatalog(storage)).toMatchObject({ ok: true });
    expect(await storage.readText('legacy/v2/workbench.json')).toBe(original);
  });

  it('does not create an empty catalog over project files whose manifest was lost', async () => {
    const storage = adapter();
    await storage.writeText('projects/recover-me.json', 'RECOVERABLE PROJECT');
    const write = vi.spyOn(storage, 'writeText');
    expect(await initializeWorkbenchCatalog(storage)).toMatchObject({
      ok: false, error: { code: 'WORKBENCH_CATALOG_INCOMPLETE', existingPaths: ['projects/recover-me.json'] }
    });
    expect(write).not.toHaveBeenCalled();
    expect(await storage.readText('projects/recover-me.json')).toBe('RECOVERABLE PROJECT');
  });
});

it('only inventories namespaced browser files, even if directory metadata is corrupt', async () => {
  const storage = createBrowserCacheAdapter(localStorage, { namespace: 'report' });
  localStorage.setItem('unrelated:file:secret.txt', 'SECRET');
  localStorage.setItem('report:directories', 'BROKEN');
  await storage.writeText('projects/part.json', '{}');
  expect(await storage.listFiles!()).toEqual({ paths: ['projects/part.json'], truncated: false });
  expect(localStorage.getItem('report:directories')).toBe('BROKEN');
});

it('bounds folder traversal and reports truncation instead of silently omitting files', async () => {
  const root = new FakeDirectoryHandle('large');
  for (let index = 0; index <= MAX_STORAGE_INVENTORY_ENTRIES; index++) root.files.set(`${index}.txt`, '');
  const storage = createBrowserDirectoryAdapter(root as unknown as FileSystemDirectoryHandle);
  const inventory = await storage.listFiles!();
  expect(inventory.truncated).toBe(true);
  expect(inventory.paths).toHaveLength(MAX_STORAGE_INVENTORY_ENTRIES);
});
