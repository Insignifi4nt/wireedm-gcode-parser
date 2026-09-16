import { describe, expect, it } from 'vitest';
import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { PROJECT_TRASH_TRANSACTION_PATH } from '@/domain/storage/projectTrashTransaction';
import { initializeWorkbenchCatalog } from '../workbenchCatalog';
import { deleteStoredWorkbenchProject, purgeArchivedWorkbenchProject, restoreStoredWorkbenchProject } from '../workbenchCatalogMutations';

describe('recoverable project deletion', () => {
  it('purges only the selected archive entry and all its owned files', async () => {
    const { adapter, workbench, id } = await deletedFixture();
    const other = await importExternalProgram(workbench, { fileName: 'other.nc', text: 'G1 X2 Y3' });
    if (!other.ok) throw new Error(other.error.message);
    const owned = [...adapter.files.keys()].filter((path) => path.includes(id));
    expect(owned.length).toBeGreaterThan(1);
    const purged = await purgeArchivedWorkbenchProject(other.workbench, { projectId: id });
    if (!purged.ok) throw new Error(purged.error.message);
    expect(purged.workbench.manifest.deletedProjects).toEqual([]);
    expect(purged.workbench.manifest.projects).toHaveLength(1);
    for (const path of owned) expect(adapter.files.has(path)).toBe(false);
    expect(adapter.files.has(`projects/${other.project.id}.json`)).toBe(true);
    const reopened = await initializeWorkbenchCatalog(adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.workbench.manifest.projects).toHaveLength(1);
    expect(reopened.workbench.manifest.deletedProjects).toEqual([]);
    expect(await restoreStoredWorkbenchProject(reopened.workbench, { projectId: id })).toMatchObject({ ok: false });
  });

  it('recovers an interrupted purge after its archive index was committed', async () => {
    const { adapter, workbench, id } = await deletedFixture();
    const previous = adapter.files.get('workbench.json');
    const next = JSON.stringify({ ...workbench.manifest, deletedProjects: [] }, null, 2) + '\n';
    const ownedPaths = [...adapter.files.keys()].filter((path) => path.includes(id));
    adapter.files.set(PROJECT_TRASH_TRANSACTION_PATH, JSON.stringify({
      format: 'wire-edm-project-purge-transaction', schemaVersion: 1,
      projectId: id, ownedPaths, previous, next
    }));
    adapter.files.set('workbench.json', next);
    adapter.files.delete(ownedPaths[0]);
    const reopened = await initializeWorkbenchCatalog(adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.workbench.manifest.deletedProjects).toEqual([]);
    for (const path of ownedPaths) expect(adapter.files.has(path)).toBe(false);
    expect(adapter.files.has(PROJECT_TRASH_TRANSACTION_PATH)).toBe(false);
  });

  it('preserves an archive entry when purge manifest writing fails before commit', async () => {
    const { adapter, workbench, id } = await deletedFixture();
    const before = new Map(adapter.files);
    adapter.partialManifestFailure = true;
    expect(await purgeArchivedWorkbenchProject(workbench, { projectId: id })).toMatchObject({ ok: false });
    expect(adapter.files).toEqual(before);
  });
  it('retains multiple deletions across reload and restores exact source and project bytes', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    let workbench = initialized.workbench;
    const ids: string[] = [];
    for (const name of ['first', 'second']) {
      const imported = await importExternalProgram(workbench, { fileName: `${name}.nc`, text: 'N10G1X1Y2\r\n' });
      if (!imported.ok) throw new Error(imported.error.message);
      ids.push(imported.project.id);
      const deleted = await deleteStoredWorkbenchProject(imported.workbench, { projectId: imported.project.id, deletedAt: new Date() });
      if (!deleted.ok) throw new Error(deleted.error.message);
      workbench = deleted.workbench;
    }
    const retained = new Map([...adapter.files].filter(([path]) => path !== 'workbench.json'));
    const reopened = await initializeWorkbenchCatalog(adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.workbench.manifest.deletedProjects).toHaveLength(2);
    const restored = await restoreStoredWorkbenchProject(reopened.workbench, { projectId: ids[0] });
    if (!restored.ok) throw new Error(restored.error.message);
    expect(restored.workbench.manifest.projects.map(({ id }) => id)).toEqual([ids[0]]);
    expect(restored.workbench.manifest.deletedProjects?.map(({ project }) => project.id)).toEqual([ids[1]]);
    expect(new Map([...adapter.files].filter(([path]) => path !== 'workbench.json'))).toEqual(retained);
  });

  it('reserves deleted identities when the same filename is imported again', async () => {
    const { adapter, workbench, id } = await deletedFixture();
    const before = adapter.files.get(`projects/${id}.json`);
    const imported = await importExternalProgram(workbench, { fileName: 'part.nc', text: 'G1 X9 Y9', now: new Date('2026-09-07T10:00:00Z') });
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.project.id).not.toBe(id);
    expect(adapter.files.get(`projects/${id}.json`)).toBe(before);
    expect((await restoreStoredWorkbenchProject(imported.workbench, { projectId: id })).ok).toBe(true);
  });

  it('keeps the active library open when deleted files are missing, but refuses restoration', async () => {
    const { adapter, id } = await deletedFixture();
    adapter.files.delete(`projects/${id}.json`);
    const reopened = await initializeWorkbenchCatalog(adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const before = new Map(adapter.files);
    expect(await restoreStoredWorkbenchProject(reopened.workbench, { projectId: id })).toMatchObject({ ok: false });
    expect(adapter.files).toEqual(before);
    expect(reopened.workbench.manifest.deletedProjects).toHaveLength(1);
  });

  it('rolls back a partial restore write and permits retry', async () => {
    const { adapter, workbench, id } = await deletedFixture();
    const before = new Map(adapter.files);
    adapter.partialManifestFailure = true;
    expect(await restoreStoredWorkbenchProject(workbench, { projectId: id })).toMatchObject({
      ok: false, error: { code: 'PROJECT_TRASH_TRANSACTION_FAILED' }
    });
    expect(adapter.files).toEqual(before);
    expect((await restoreStoredWorkbenchProject(workbench, { projectId: id })).ok).toBe(true);
  });

  it('recovers an interrupted catalog write before parsing it on reload', async () => {
    const { adapter, workbench, id } = await deletedFixture();
    const previous = adapter.files.get('workbench.json');
    const restored = await restoreStoredWorkbenchProject(workbench, { projectId: id });
    if (!restored.ok) throw new Error(restored.error.message);
    const next = adapter.files.get('workbench.json');
    adapter.files.set(PROJECT_TRASH_TRANSACTION_PATH, JSON.stringify({
      format: 'wire-edm-project-trash-transaction', schemaVersion: 1, previous, next
    }));
    adapter.files.set('workbench.json', '{partial');
    const reopened = await initializeWorkbenchCatalog(adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.workbench.manifest.projects).toEqual([]);
    expect(reopened.workbench.manifest.deletedProjects).toHaveLength(1);
    expect(adapter.files.get('workbench.json')).toBe(previous);
    expect(adapter.files.has(PROJECT_TRASH_TRANSACTION_PATH)).toBe(false);
  });

  it('rolls back a completed write when its verification read fails', async () => {
    const { adapter, workbench, id } = await deletedFixture();
    const before = new Map(adapter.files);
    adapter.failManifestReadAfterWrite = true;
    expect(await restoreStoredWorkbenchProject(workbench, { projectId: id })).toMatchObject({ ok: false });
    expect(adapter.files).toEqual(before);
    expect((await restoreStoredWorkbenchProject(workbench, { projectId: id })).ok).toBe(true);
  });

  it('reports committed restoration when only journal cleanup fails and recovers before the next deletion', async () => {
    const { adapter, workbench, id } = await deletedFixture();
    adapter.failJournalDelete = true;
    const restored = await restoreStoredWorkbenchProject(workbench, { projectId: id });
    if (!restored.ok) throw new Error(restored.error.message);
    expect(adapter.files.has(PROJECT_TRASH_TRANSACTION_PATH)).toBe(true);
    const deleted = await deleteStoredWorkbenchProject(restored.workbench, { projectId: id, deletedAt: new Date() });
    if (!deleted.ok) throw new Error(deleted.error.message);
    expect(deleted.workbench.manifest.projects).toEqual([]);
    expect(deleted.workbench.manifest.deletedProjects).toHaveLength(1);
    expect(adapter.files.has(PROJECT_TRASH_TRANSACTION_PATH)).toBe(false);
  });
});

async function deletedFixture() {
  const adapter = new MemoryAdapter();
  const initialized = await initializeWorkbenchCatalog(adapter);
  if (!initialized.ok) throw new Error(initialized.error.message);
  const imported = await importExternalProgram(initialized.workbench, {
    fileName: 'part.nc', text: 'G1 X1 Y2', now: new Date('2026-09-07T10:00:00Z')
  });
  if (!imported.ok) throw new Error(imported.error.message);
  const deleted = await deleteStoredWorkbenchProject(imported.workbench, { projectId: imported.project.id, deletedAt: new Date() });
  if (!deleted.ok) throw new Error(deleted.error.message);
  return { adapter, workbench: deleted.workbench, id: imported.project.id };
}
class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'Recovery';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  partialManifestFailure = false;
  failManifestReadAfterWrite = false;
  failNextManifestRead = false;
  failJournalDelete = false;
  async ensureDirectory() {}
  async readText(path: string) {
    if (path === 'workbench.json' && this.failNextManifestRead) {
      this.failNextManifestRead = false;
      throw new Error('Read failed after completed write');
    }
    return this.files.get(path) ?? null;
  }
  async deleteText(path: string) {
    if (path === PROJECT_TRASH_TRANSACTION_PATH && this.failJournalDelete) {
      this.failJournalDelete = false;
      throw new Error('Cleanup unavailable');
    }
    this.files.delete(path);
  }
  async writeText(path: string, contents: string) {
    if (path === 'workbench.json' && this.partialManifestFailure) {
      this.partialManifestFailure = false;
      this.files.set(path, contents.slice(0, 20));
      throw new Error('Interrupted write');
    }
    this.files.set(path, contents);
    if (path === 'workbench.json' && this.failManifestReadAfterWrite) {
      this.failManifestReadAfterWrite = false;
      this.failNextManifestRead = true;
    }
  }
}
