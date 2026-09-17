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
  private failure: { operation: 'write' | 'delete'; path: string; afterMutation: boolean } | null = null;

  constructor(readonly name = 'catalog-mutations') {}
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) {
    this.mutations.push(`write:${path}`);
    const failure = this.consumeFailure('write', path);
    if (failure && !failure.afterMutation) throw new Error('injected write failure');
    this.files.set(path, contents);
    if (failure) throw new Error('injected partial write failure');
  }
  async deleteText(path: string) {
    this.mutations.push(`delete:${path}`);
    const failure = this.consumeFailure('delete', path);
    if (failure && !failure.afterMutation) throw new Error('injected delete failure');
    this.files.delete(path);
    if (failure) throw new Error('injected partial delete failure');
  }
  failNext(operation: 'write' | 'delete', path: string) {
    this.failure = { operation, path, afterMutation: false };
  }
  failNextAfterMutation(operation: 'write' | 'delete', path: string) {
    this.failure = { operation, path, afterMutation: true };
  }
  private consumeFailure(operation: 'write' | 'delete', path: string) {
    if (this.failure?.operation !== operation || this.failure.path !== path) return null;
    const failure = this.failure;
    this.failure = null;
    return failure;
  }
}

describe('strict V2 workbench project persistence', () => {
  it('refuses an oversized imported or replacement document before changing any owned files', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    const project = projectFixture('imports/fixture.dxf');
    const document = createUpidFromDxfEntities([]);
    document.source.importWarnings = ['x'.repeat(64 * 1024 * 1024)];
    const created = createWorkbenchProjectDocument({
      id: project.id, name: project.name, source: { kind: 'upid', files: [] },
      content: { kind: 'upid-document', document }
    });
    if (!created.ok) throw new Error(created.error.message);
    if (created.project.content.kind !== 'upid-document' || project.source.kind !== 'dxf') throw new Error('Expected path project fixtures.');
    const beforeAdd = new Map(adapter.files);
    adapter.mutations.length = 0;
    expect(await addStoredWorkbenchProject(workbench, { project: created.project, ownedFiles: [] })).toMatchObject({
      ok: false, error: { code: 'WORKBENCH_PROJECT_FILE_TOO_LARGE', maximumBytes: 64 * 1024 * 1024 }
    });
    expect(adapter.files).toEqual(beforeAdd);
    expect(adapter.mutations).toEqual([]);
    const added = await addStoredWorkbenchProject(workbench, {
      project, ownedFiles: [{ path: 'imports/fixture.dxf', contents: 'ORIGINAL' }]
    });
    if (!added.ok) throw new Error(added.error.message);
    const beforeReplace = new Map(adapter.files);
    adapter.mutations.length = 0;
    expect(await replaceStoredWorkbenchProject(added.workbench, {
      project: { ...project, source: project.source, content: created.project.content },
      ownedFileChanges: [{ kind: 'write', path: 'imports/fixture.dxf', contents: 'CHANGED' }]
    })).toMatchObject({ ok: false, error: { code: 'WORKBENCH_PROJECT_FILE_TOO_LARGE' } });
    expect(adapter.files).toEqual(beforeReplace);
    expect(adapter.mutations).toEqual([]);
  });

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

  it('restores the captured path when a write reports failure after it may have partially changed storage', async () => {
    const { adapter, workbench } = await initializedWorkbench();
    adapter.mutations.length = 0;
    adapter.failNextAfterMutation('write', 'imports/fixture.dxf');

    expect(await addStoredWorkbenchProject(workbench, {
      project: projectFixture('imports/fixture.dxf'),
      ownedFiles: [{ path: 'imports/fixture.dxf', contents: 'DXF SOURCE' }]
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED', operation: 'write' }
    });
    expect(adapter.files.has('imports/fixture.dxf')).toBe(false);
    expect(adapter.files.has('projects/fixture.json')).toBe(false);
    expect(adapter.files.has('transactions/workbench-files.json')).toBe(false);
    expect(JSON.parse(adapter.files.get('workbench.json')!)).toEqual(workbench.manifest);
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

  it('moves a project to deleted projects while retaining all owned files', async () => {
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
    expect(adapter.files.get('imports/raw.nc')).toBe('RAW');
    expect(adapter.files.get('projects/cleaned.nc')).toBe('CLEANED');
    expect(adapter.files.has('projects/external.json')).toBe(true);
    expect(deleted.workbench.manifest.deletedProjects?.[0].project.id).toBe(project.id);
    expect(deleted.workbench.manifest.projects).toEqual([]);
  });

  it('retains the active project when the deletion manifest write fails', async () => {
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
    adapter.failNext('write', WORKBENCH_CATALOG_PATH);

    expect(await deleteStoredWorkbenchProject(added.workbench, {
      projectId: project.id,
      deletedAt: new Date('2026-08-28T14:00:00.000Z')
    })).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_TRASH_TRANSACTION_FAILED' }
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
