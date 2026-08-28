import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { initializeWorkbenchCatalog, WORKBENCH_CATALOG_PATH } from '../workbenchCatalog';
import {
  addStoredWorkbenchProject,
  deleteStoredWorkbenchProject,
  readStoredWorkbenchProject,
  replaceStoredWorkbenchProject
} from '../workbenchCatalogMutations';
import {
  createWorkbenchProjectDocument,
  type WorkbenchProjectDocument,
  type WorkbenchProjectDocumentValue
} from '../workbenchProject';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly mutations: string[] = [];
  private failure: { operation: 'write' | 'delete'; path: string } | null = null;

  constructor(readonly name = 'catalog-mutations') {}
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) {
    this.mutations.push(`write:${path}`);
    if (this.consumeFailure('write', path)) throw new Error('injected write failure');
    this.files.set(path, contents);
  }
  async deleteText(path: string) {
    this.mutations.push(`delete:${path}`);
    if (this.consumeFailure('delete', path)) throw new Error('injected delete failure');
    this.files.delete(path);
  }
  failNext(operation: 'write' | 'delete', path: string) {
    this.failure = { operation, path };
  }
  private consumeFailure(operation: 'write' | 'delete', path: string) {
    if (this.failure?.operation !== operation || this.failure.path !== path) return false;
    this.failure = null;
    return true;
  }
}

describe('strict V2 workbench project persistence', () => {
  it('adds explicit owned files and reads the document only by indexed project id', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    const project = projectFixture('imports/fixture.dxf');

    const added = await addStoredWorkbenchProject(workbench, {
      project,
      ownedFiles: [{ path: 'imports/fixture.dxf', contents: 'DXF SOURCE' }]
    });

    if (!added.ok) throw new Error(added.error.message);
    expect(adapter.files.get('imports/fixture.dxf')).toBe('DXF SOURCE');
    expect(await readStoredWorkbenchProject(added.workbench, 'fixture')).toEqual({
      ok: true,
      project
    });
    expect(await readStoredWorkbenchProject(added.workbench, 'missing')).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_PROJECT_NOT_FOUND', projectId: 'missing' }
    });
  });

  it('rejects incomplete and undeclared owned-file sets before writing anything', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    const project = projectFixture('imports/fixture.dxf');

    expect(await addStoredWorkbenchProject(workbench, { project, ownedFiles: [] })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_OWNED_FILE_PLAN_INVALID', path: 'imports/fixture.dxf' }
    });
    expect(await addStoredWorkbenchProject(workbench, {
      project,
      ownedFiles: [
        { path: 'imports/fixture.dxf', contents: 'DXF SOURCE' },
        { path: 'imports/not-owned.dxf', contents: 'SURPRISE' }
      ]
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_OWNED_FILE_PLAN_INVALID', path: 'imports/not-owned.dxf' }
    });
    expect(adapter.files.has('imports/fixture.dxf')).toBe(false);
    expect(adapter.files.has('projects/fixture.json')).toBe(false);
  });

  it('reserves saved revision IDs for the atomic revision mutation', async () => {
    const { workbench } = await initializedWorkbench();
    const imported = structuredClone(projectFixture('imports/fixture.dxf')) as WorkbenchProjectDocumentValue;
    imported.savedRevisionIds = ['revision.0001'];
    expect(await addStoredWorkbenchProject(workbench, {
      project: imported,
      ownedFiles: [{ path: 'imports/fixture.dxf', contents: 'SOURCE' }]
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_REVISION_PLAN_INVALID', projectId: 'fixture' }
    });

    const added = await addStoredWorkbenchProject(workbench, {
      project: projectFixture('imports/fixture.dxf'),
      ownedFiles: [{ path: 'imports/fixture.dxf', contents: 'SOURCE' }]
    });
    if (!added.ok) throw new Error(added.error.message);
    expect(await replaceStoredWorkbenchProject(added.workbench, {
      project: imported,
      ownedFileChanges: []
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_REVISION_PLAN_INVALID', projectId: 'fixture' }
    });
  });

  it('rolls back every owned file and the project document when the manifest commit fails', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    const manifestBefore = adapter.files.get(WORKBENCH_CATALOG_PATH);
    adapter.failNext('write', WORKBENCH_CATALOG_PATH);

    expect(await addStoredWorkbenchProject(workbench, {
      project: projectFixture('imports/fixture.dxf'),
      ownedFiles: [{ path: 'imports/fixture.dxf', contents: 'DXF SOURCE' }]
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_MUTATION_MANIFEST_WRITE_FAILED' }
    });
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(manifestBefore);
    expect(adapter.files.has('imports/fixture.dxf')).toBe(false);
    expect(adapter.files.has('projects/fixture.json')).toBe(false);
  });

  it('does not roll back paths that were never changed', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    adapter.mutations.length = 0;
    adapter.failNext('write', 'imports/fixture.dxf');

    expect(await addStoredWorkbenchProject(workbench, {
      project: projectFixture('imports/fixture.dxf'),
      ownedFiles: [{ path: 'imports/fixture.dxf', contents: 'DXF SOURCE' }]
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED', operation: 'write' }
    });
    expect(adapter.mutations).toEqual(['write:imports/fixture.dxf']);
  });

  it('rejects a stale catalog snapshot instead of overwriting a completed mutation', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    const first = await addStoredWorkbenchProject(workbench, {
      project: projectFixture('imports/fixture.dxf'),
      ownedFiles: [{ path: 'imports/fixture.dxf', contents: 'FIRST' }]
    });
    if (!first.ok) throw new Error(first.error.message);

    expect(await addStoredWorkbenchProject(workbench, {
      project: projectFixture('imports/second.dxf', 'second'),
      ownedFiles: [{ path: 'imports/second.dxf', contents: 'SECOND' }]
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_MUTATION_MANIFEST_STALE' }
    });
    expect(adapter.files.has('imports/second.dxf')).toBe(false);
    expect(first.workbench.manifest.projects.map(({ id }) => id)).toEqual(['fixture']);
  });

  it('rejects a new project that claims a path owned by another project', async () => {
    const { workbench } = await initializedWorkbench();
    const first = await addStoredWorkbenchProject(workbench, {
      project: projectFixture('imports/shared.dxf'),
      ownedFiles: [{ path: 'imports/shared.dxf', contents: 'FIRST' }]
    });
    if (!first.ok) throw new Error(first.error.message);

    expect(await addStoredWorkbenchProject(first.workbench, {
      project: projectFixture('imports/shared.dxf', 'second'),
      ownedFiles: [{ path: 'imports/shared.dxf', contents: 'SECOND' }]
    })).toMatchObject({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_PROJECT_PATH_COLLISION',
        path: 'imports/shared.dxf',
        firstProjectId: 'fixture',
        secondProjectId: 'second'
      }
    });
  });

  it('replaces owned files only through an explicit, complete change set', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    const original = projectFixture('imports/original.dxf');
    const added = await addStoredWorkbenchProject(workbench, {
      project: original,
      ownedFiles: [{ path: 'imports/original.dxf', contents: 'ORIGINAL' }]
    });
    if (!added.ok) throw new Error(added.error.message);
    const replacement = renamedProject(projectFixture('imports/replacement.dxf'));

    const replaced = await replaceStoredWorkbenchProject(added.workbench, {
      project: replacement,
      ownedFileChanges: [
        { kind: 'delete', path: 'imports/original.dxf' },
        { kind: 'write', path: 'imports/replacement.dxf', contents: 'REPLACEMENT' }
      ]
    });

    if (!replaced.ok) throw new Error(replaced.error.message);
    expect(adapter.files.has('imports/original.dxf')).toBe(false);
    expect(adapter.files.get('imports/replacement.dxf')).toBe('REPLACEMENT');
    expect(replaced.workbench.manifest.projects[0]).toMatchObject({
      name: 'Renamed fixture',
      updatedAt: '2026-08-28T13:00:00.000Z'
    });
  });

  it('restores old sources, removes new sources, and restores document and manifest on replace failure', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    const original = projectFixture('imports/original.dxf');
    const added = await addStoredWorkbenchProject(workbench, {
      project: original,
      ownedFiles: [{ path: 'imports/original.dxf', contents: 'ORIGINAL' }]
    });
    if (!added.ok) throw new Error(added.error.message);
    const projectBefore = adapter.files.get('projects/fixture.json');
    const manifestBefore = adapter.files.get(WORKBENCH_CATALOG_PATH);
    adapter.failNext('write', WORKBENCH_CATALOG_PATH);

    expect(await replaceStoredWorkbenchProject(added.workbench, {
      project: renamedProject(projectFixture('imports/replacement.dxf')),
      ownedFileChanges: [
        { kind: 'delete', path: 'imports/original.dxf' },
        { kind: 'write', path: 'imports/replacement.dxf', contents: 'REPLACEMENT' }
      ]
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_MUTATION_MANIFEST_WRITE_FAILED' }
    });
    expect(adapter.files.get('imports/original.dxf')).toBe('ORIGINAL');
    expect(adapter.files.has('imports/replacement.dxf')).toBe(false);
    expect(adapter.files.get('projects/fixture.json')).toBe(projectBefore);
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(manifestBefore);
  });

  it('deletes all project-owned source files and the document', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    const project = externalProjectFixture();
    const added = await addStoredWorkbenchProject(workbench, {
      project,
      ownedFiles: [
        { path: 'imports/raw.nc', contents: 'RAW' },
        { path: 'projects/cleaned.nc', contents: 'CLEANED' }
      ]
    });
    if (!added.ok) throw new Error(added.error.message);

    const deleted = await deleteStoredWorkbenchProject(added.workbench, {
      projectId: project.id,
      deletedAt: new Date('2026-08-28T14:00:00.000Z')
    });

    if (!deleted.ok) throw new Error(deleted.error.message);
    expect(adapter.files.has('imports/raw.nc')).toBe(false);
    expect(adapter.files.has('projects/cleaned.nc')).toBe(false);
    expect(adapter.files.has('projects/external.json')).toBe(false);
    expect(deleted.workbench.manifest.projects).toEqual([]);
  });

  it('restores every deleted file when a later delete fails', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    const project = externalProjectFixture();
    const added = await addStoredWorkbenchProject(workbench, {
      project,
      ownedFiles: [
        { path: 'imports/raw.nc', contents: 'RAW' },
        { path: 'projects/cleaned.nc', contents: 'CLEANED' }
      ]
    });
    if (!added.ok) throw new Error(added.error.message);
    const projectBefore = adapter.files.get('projects/external.json');
    const manifestBefore = adapter.files.get(WORKBENCH_CATALOG_PATH);
    adapter.failNext('delete', 'projects/cleaned.nc');

    expect(await deleteStoredWorkbenchProject(added.workbench, {
      projectId: project.id,
      deletedAt: new Date('2026-08-28T14:00:00.000Z')
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED', operation: 'delete' }
    });
    expect(adapter.files.get('imports/raw.nc')).toBe('RAW');
    expect(adapter.files.get('projects/cleaned.nc')).toBe('CLEANED');
    expect(adapter.files.get('projects/external.json')).toBe(projectBefore);
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(manifestBefore);
  });
});

async function initializedWorkbench() {
  const adapter = new MemoryAdapter();
  const initialized = await initializeWorkbenchCatalog(adapter, {
    now: new Date('2026-08-28T12:00:00.000Z')
  });
  if (!initialized.ok) throw new Error(initialized.error.message);
  return { adapter, workbench: initialized.workbench };
}

function projectFixture(sourcePath: string, id = 'fixture') {
  const created = createWorkbenchProjectDocument({
    id,
    name: id === 'fixture' ? 'Fixture' : 'Second',
    now: new Date('2026-08-28T12:00:00.000Z'),
    source: {
      kind: 'dxf',
      files: [{
        kind: 'dxf',
        name: 'fixture.dxf',
        path: sourcePath,
        createdAt: '2026-08-28T12:00:00.000Z'
      }]
    },
    content: { kind: 'upid-document', document: upidFixture() }
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.project;
}

function externalProjectFixture() {
  const created = createWorkbenchProjectDocument({
    id: 'external',
    name: 'External',
    now: new Date('2026-08-28T12:00:00.000Z'),
    source: {
      kind: 'external-gcode',
      files: [
        { kind: 'external-gcode', name: 'raw.nc', path: 'imports/raw.nc', createdAt: '2026-08-28T12:00:00.000Z' },
        { kind: 'external-gcode', name: 'cleaned.nc', path: 'projects/cleaned.nc', createdAt: '2026-08-28T12:00:00.000Z' }
      ]
    },
    content: { kind: 'external-gcode', activeFilePath: 'projects/cleaned.nc' }
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.project;
}

function renamedProject(project: WorkbenchProjectDocument): WorkbenchProjectDocument {
  const renamed = structuredClone(project) as WorkbenchProjectDocumentValue;
  renamed.name = 'Renamed fixture';
  renamed.updatedAt = '2026-08-28T13:00:00.000Z';
  return renamed;
}

function upidFixture() {
  return createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
  ]);
}
