import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';

import { initializeWorkbenchCatalog, WORKBENCH_CATALOG_PATH } from '../workbenchCatalog';
import {
  addStoredWorkbenchProject,
  deleteStoredWorkbenchProject,
  replaceStoredWorkbenchProject
} from '../workbenchCatalogMutations';
import {
  createWorkbenchProjectDocument,
  type WorkbenchProjectDocumentValue
} from '../workbenchProject';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  failWritePath: string | null = null;
  constructor(readonly name = 'catalog-mutations') {}
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) {
    if (path === this.failWritePath) throw new Error('injected write failure');
    this.files.set(path, contents);
  }
  async deleteText(path: string) { this.files.delete(path); }
}

describe('strict V2 workbench project mutations', () => {
  it('adds, replaces, and deletes one authoritative project document', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const project = projectFixture();
    const added = await addStoredWorkbenchProject(initialized.workbench, project);
    if (!added.ok) throw new Error(added.error.message);
    expect(added.workbench.manifest.projects).toEqual([expect.objectContaining({
      id: 'fixture', path: 'projects/fixture.json'
    })]);

    const renamed = structuredClone(project) as WorkbenchProjectDocumentValue;
    renamed.name = 'Renamed fixture';
    renamed.updatedAt = '2026-08-28T13:00:00.000Z';
    const replaced = await replaceStoredWorkbenchProject(added.workbench, renamed);
    if (!replaced.ok) throw new Error(replaced.error.message);
    expect(replaced.workbench.manifest.projects[0].name).toBe('Renamed fixture');

    const deleted = await deleteStoredWorkbenchProject(
      replaced.workbench,
      project.id,
      new Date('2026-08-28T14:00:00.000Z')
    );
    if (!deleted.ok) throw new Error(deleted.error.message);
    expect(deleted.workbench.manifest.projects).toEqual([]);
    expect(adapter.files.has('projects/fixture.json')).toBe(false);
  });

  it('removes a newly written project when the manifest commit fails', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    adapter.failWritePath = WORKBENCH_CATALOG_PATH;

    expect(await addStoredWorkbenchProject(initialized.workbench, projectFixture())).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_MUTATION_MANIFEST_WRITE_FAILED' }
    });
    expect(adapter.files.has('projects/fixture.json')).toBe(false);
  });
});

function projectFixture() {
  const document = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
  ]);
  const created = createWorkbenchProjectDocument({
    id: 'fixture',
    name: 'Fixture',
    now: new Date('2026-08-28T12:00:00.000Z'),
    source: { kind: 'upid', files: [] },
    content: { kind: 'upid-document', document }
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.project;
}
