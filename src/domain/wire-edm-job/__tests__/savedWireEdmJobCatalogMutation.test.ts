import { describe, expect, it } from 'vitest';

import {
  createMachinePostBinding,
  parseMachineDefinition,
  type MachineDefinitionValue
} from '@/domain/machine-definition/machineDefinition';
import { builtInPostPackage } from '@/domain/post-processor/builtInPostPackages';
import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { initializeWorkbenchCatalog, WORKBENCH_CATALOG_PATH } from '@/domain/workbench-catalog/workbenchCatalog';
import {
  addStoredWorkbenchProject,
  deleteStoredWorkbenchProject,
  readStoredWorkbenchProject
} from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { workbenchProjectRevisionPath } from '@/domain/workbench-catalog/workbenchProjectStorage';

import {
  createSavedWireEdmJobRevision,
  saveStoredWireEdmJobRevision
} from '../savedWireEdmJobRevision';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly mutations: string[] = [];
  private failurePath: string | null = null;

  constructor(readonly name = 'saved-revision-catalog') {}
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) {
    this.mutations.push(`write:${path}`);
    if (path === this.failurePath) {
      this.failurePath = null;
      throw new Error('injected write failure');
    }
    this.files.set(path, contents);
  }
  async deleteText(path: string) {
    this.mutations.push(`delete:${path}`);
    this.files.delete(path);
  }
  failNextWrite(path: string) { this.failurePath = path; }
}

describe('catalog-owned saved revision persistence', () => {
  it('atomically indexes a revision and project deletion removes its exact file', async () => {
    const fixture = await catalogRevisionFixture();

    const saved = await saveStoredWireEdmJobRevision(
      fixture.workbench,
      fixture.candidate
    );

    if (!saved.ok) throw new Error(saved.error.message);
    expect(saved.path).toBe(workbenchProjectRevisionPath('fixture.part', 'revision.0001'));
    expect(fixture.adapter.files.has(saved.path)).toBe(true);
    expect(saved.project.savedRevisionIds).toEqual(['revision.0001']);
    expect(saved.workbench.manifest.projects[0].updatedAt).toBe('2026-08-28T12:30:00.000Z');
    expect(await readStoredWorkbenchProject(saved.workbench, 'fixture.part')).toMatchObject({
      ok: true,
      project: { savedRevisionIds: ['revision.0001'] }
    });

    const deleted = await deleteStoredWorkbenchProject(saved.workbench, {
      projectId: 'fixture.part',
      deletedAt: new Date('2026-08-28T13:00:00.000Z')
    });
    if (!deleted.ok) throw new Error(deleted.error.message);
    expect(fixture.adapter.files.has(saved.path)).toBe(false);
    expect(fixture.adapter.files.has('projects/fixture.part.json')).toBe(false);
  });

  it('restores revision, project, and manifest bytes when the final manifest write fails', async () => {
    const fixture = await catalogRevisionFixture();
    const projectBefore = fixture.adapter.files.get('projects/fixture.part.json');
    const manifestBefore = fixture.adapter.files.get(WORKBENCH_CATALOG_PATH);
    fixture.adapter.failNextWrite(WORKBENCH_CATALOG_PATH);

    expect(await saveStoredWireEdmJobRevision(
      fixture.workbench,
      fixture.candidate
    )).toMatchObject({
      ok: false,
      error: { code: 'SAVED_REVISION_CATALOG_MANIFEST_WRITE_FAILED' }
    });
    expect(fixture.adapter.files.has(
      workbenchProjectRevisionPath('fixture.part', 'revision.0001')
    )).toBe(false);
    expect(fixture.adapter.files.get('projects/fixture.part.json')).toBe(projectBefore);
    expect(fixture.adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(manifestBefore);
  });

  it('does not restore project paths when the revision write never succeeds', async () => {
    const fixture = await catalogRevisionFixture();
    const revisionPath = workbenchProjectRevisionPath('fixture.part', 'revision.0001');
    fixture.adapter.mutations.length = 0;
    fixture.adapter.failNextWrite(revisionPath);

    expect(await saveStoredWireEdmJobRevision(
      fixture.workbench,
      fixture.candidate
    )).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED', operation: 'write' }
    });
    expect(fixture.adapter.mutations).toEqual([`write:${revisionPath}`]);
  });

  it('restores an indexed revision when project deletion cannot commit its manifest', async () => {
    const fixture = await catalogRevisionFixture();
    const saved = await saveStoredWireEdmJobRevision(fixture.workbench, fixture.candidate);
    if (!saved.ok) throw new Error(saved.error.message);
    const revisionBefore = fixture.adapter.files.get(saved.path);
    const projectBefore = fixture.adapter.files.get('projects/fixture.part.json');
    const manifestBefore = fixture.adapter.files.get(WORKBENCH_CATALOG_PATH);
    fixture.adapter.failNextWrite(WORKBENCH_CATALOG_PATH);

    expect(await deleteStoredWorkbenchProject(saved.workbench, {
      projectId: 'fixture.part',
      deletedAt: new Date('2026-08-28T13:00:00.000Z')
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_MUTATION_MANIFEST_WRITE_FAILED' }
    });
    expect(fixture.adapter.files.get(saved.path)).toBe(revisionBefore);
    expect(fixture.adapter.files.get('projects/fixture.part.json')).toBe(projectBefore);
    expect(fixture.adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(manifestBefore);
  });
});

async function catalogRevisionFixture() {
  const adapter = new MemoryAdapter();
  const initialized = await initializeWorkbenchCatalog(adapter, {
    now: new Date('2026-08-28T12:00:00.000Z')
  });
  if (!initialized.ok) throw new Error(initialized.error.message);
  const document = createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 5, y: 5 }, radius: 2 }
  ]);
  document.setup = {
    initialWirePosition: { kind: 'manual', point: { x: 7, y: 5 }, review: 'reviewed' }
  };
  const createdProject = createWorkbenchProjectDocument({
    id: 'fixture.part',
    name: 'Fixture part',
    now: new Date('2026-08-28T12:00:00.000Z'),
    source: { kind: 'upid', files: [] },
    content: { kind: 'upid-document', document }
  });
  if (!createdProject.ok) throw new Error(createdProject.error.message);
  const added = await addStoredWorkbenchProject(initialized.workbench, {
    project: createdProject.project,
    ownedFiles: []
  });
  if (!added.ok) throw new Error(added.error.message);

  const installed = await installPostPackage(
    createEmptyPostLibrary(),
    builtInPostPackage('generic-iso')
  );
  if (!installed.ok) throw new Error(installed.error.message);
  const parsedMachine = parseMachineDefinition(JSON.stringify(machineValue()));
  if (!parsedMachine.ok) throw new Error(JSON.stringify(parsedMachine.diagnostics));
  const bound = createMachinePostBinding(parsedMachine.machine, installed.installation, {
    id: 'production',
    name: 'Production',
    properties: { coordinatePrecision: 3, arcCenterMode: 'incremental' },
    compatibility: {
      status: 'acknowledged',
      acknowledgedAt: '2026-08-28T12:00:00.000Z',
      acknowledgedBy: 'Test operator',
      notes: 'Exact target checked.'
    }
  });
  if (!bound.ok) throw new Error(bound.error.message);
  const candidate = await createSavedWireEdmJobRevision({
    revisionId: 'revision.0001',
    savedAt: '2026-08-28T12:30:00.000Z',
    project: createdProject.project,
    machine: bound.machine,
    bindingId: 'production',
    postLibrary: installed.library
  });
  if (!candidate.ok) throw new Error(candidate.error.message);
  return { adapter, workbench: added.workbench, candidate: candidate.candidate };
}

function machineValue(): MachineDefinitionValue {
  return {
    format: 'wire-edm-machine',
    schemaVersion: 1,
    id: 'fixture.machine',
    name: 'Fixture machine',
    identity: {
      manufacturer: 'Fixture',
      model: 'Machine',
      controller: { manufacturer: 'Fixture', model: 'Controller' }
    },
    limits: {
      xTravel: { status: 'known', millimeters: 100 },
      yTravel: { status: 'known', millimeters: 100 }
    },
    hardware: { manualThreading: true, automaticThreading: false },
    evidence: [],
    bindings: [],
    notes: 'Test fixture.'
  };
}
