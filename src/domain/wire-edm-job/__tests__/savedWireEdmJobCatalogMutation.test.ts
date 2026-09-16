import { describe, expect, it } from 'vitest';

import {
  createMachinePostBinding,
  parseMachineDefinition,
  type MachineDefinitionValue
} from '@/domain/machine-definition/machineDefinition';
import { minimalPostPackage } from '@/domain/post-processor/__tests__/postPackageFixture';
import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { beginRevisionDeletionTransaction, SAVED_REVISION_TRANSACTION_PATH } from '@/domain/storage/savedRevisionTransaction';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { initializeWorkbenchCatalog, WORKBENCH_CATALOG_PATH } from '@/domain/workbench-catalog/workbenchCatalog';
import {
  addStoredWorkbenchProject,
  deleteStoredWorkbenchProject,
  purgeArchivedWorkbenchProject,
  restoreStoredWorkbenchProject,
  readStoredWorkbenchProject
} from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { updateWorkbenchCatalogPreferences } from '@/domain/workbench-catalog/storage/updateWorkbenchCatalogPreferences';
import { workbenchProjectRevisionPath } from '@/domain/workbench-catalog/workbenchProjectStorage';

import {
  createSavedWireEdmJobRevision,
  saveStoredWireEdmJobRevision
} from '../savedWireEdmJobRevision';
import { deleteStoredWireEdmJobRevisions } from '../deleteSavedWireEdmJobRevisions';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly mutations: string[] = [];
  readonly durableStates: Map<string, string>[] = [];
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
    this.durableStates.push(new Map(this.files));
  }
  async deleteText(path: string) {
    this.mutations.push(`delete:${path}`);
    this.files.delete(path);
    this.durableStates.push(new Map(this.files));
  }
  failNextWrite(path: string) { this.failurePath = path; }
}

describe('catalog-owned saved revision persistence', () => {
  it('permanently removes an archived project and its saved revision', async () => {
    const fixture = await catalogRevisionFixture();
    const saved = await saveStoredWireEdmJobRevision(fixture.workbench, fixture.candidate);
    if (!saved.ok) throw new Error(saved.error.message);
    const archived = await deleteStoredWorkbenchProject(saved.workbench, {
      projectId: saved.project.id, deletedAt: new Date('2026-08-28T13:00:00.000Z')
    });
    if (!archived.ok) throw new Error(archived.error.message);
    const purged = await purgeArchivedWorkbenchProject(archived.workbench, {
      projectId: saved.project.id, deletedAt: new Date('2026-08-28T13:01:00.000Z')
    });
    if (!purged.ok) throw new Error(purged.error.message);
    expect(fixture.adapter.files.has(saved.path)).toBe(false);
    expect(fixture.adapter.files.has(`projects/${saved.project.id}.json`)).toBe(false);
    expect(purged.workbench.manifest.deletedProjects).toEqual([]);
    const reopened = await initializeWorkbenchCatalog(fixture.adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.workbench.manifest.deletedProjects).toEqual([]);
  });

  it('deletes one selected revision while keeping the other indexed and reproducible', async () => {
    const fixture = await catalogRevisionFixture();
    const first = await saveStoredWireEdmJobRevision(fixture.workbench, fixture.candidate);
    if (!first.ok) throw new Error(first.error.message);
    const secondCandidate = await createSavedWireEdmJobRevision({
      revisionId: 'revision.0002',
      savedAt: '2026-08-28T12:45:00.000Z',
      project: first.project,
      machine: fixture.machine,
      bindingId: 'production',
      postLibrary: fixture.library
    });
    if (!secondCandidate.ok) throw new Error(secondCandidate.error.message);
    const second = await saveStoredWireEdmJobRevision(first.workbench, secondCandidate.candidate);
    if (!second.ok) throw new Error(second.error.message);

    const deleted = await deleteStoredWireEdmJobRevisions(second.workbench, {
      projectId: 'fixture.part', revisionIds: ['revision.0001'],
      deletedAt: new Date('2026-08-28T13:00:00.000Z')
    });
    if (!deleted.ok) throw new Error(deleted.error.message);
    expect(deleted.deletedCount).toBe(1);
    expect(deleted.project.savedRevisionIds).toEqual(['revision.0002']);
    expect(fixture.adapter.files.has(first.path)).toBe(false);
    expect(fixture.adapter.files.has(second.path)).toBe(true);
    const reopened = await initializeWorkbenchCatalog(fixture.adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(await readStoredWorkbenchProject(reopened.workbench, 'fixture.part')).toMatchObject({
      ok: true, project: { savedRevisionIds: ['revision.0002'] }
    });
  });

  it('deletes all selected revisions while retaining the project and rolls back a failed deletion', async () => {
    const fixture = await catalogRevisionFixture();
    const first = await saveStoredWireEdmJobRevision(fixture.workbench, fixture.candidate);
    if (!first.ok) throw new Error(first.error.message);
    const candidate = await createSavedWireEdmJobRevision({
      revisionId: 'revision.0002', savedAt: '2026-08-28T12:45:00.000Z',
      project: first.project, machine: fixture.machine, bindingId: 'production', postLibrary: fixture.library
    });
    if (!candidate.ok) throw new Error(candidate.error.message);
    const saved = await saveStoredWireEdmJobRevision(first.workbench, candidate.candidate);
    if (!saved.ok) throw new Error(saved.error.message);
    const before = new Map(fixture.adapter.files);
    fixture.adapter.failNextWrite(WORKBENCH_CATALOG_PATH);
    expect(await deleteStoredWireEdmJobRevisions(saved.workbench, {
      projectId: 'fixture.part', revisionIds: ['revision.0001', 'revision.0002'],
      deletedAt: new Date('2026-08-28T13:00:00.000Z')
    })).toMatchObject({ ok: false });
    expect(fixture.adapter.files).toEqual(before);

    const deleted = await deleteStoredWireEdmJobRevisions(saved.workbench, {
      projectId: 'fixture.part', revisionIds: ['revision.0001', 'revision.0002'],
      deletedAt: new Date('2026-08-28T13:00:00.000Z')
    });
    if (!deleted.ok) throw new Error(deleted.error.message);
    expect(deleted.project.savedRevisionIds).toEqual([]);
    expect(fixture.adapter.files.has(first.path)).toBe(false);
    expect(fixture.adapter.files.has(saved.path)).toBe(false);
    expect(await readStoredWorkbenchProject(deleted.workbench, 'fixture.part')).toMatchObject({
      ok: true, project: { savedRevisionIds: [] }
    });
  });

  it('recovers an interrupted deletion before reopening the workbench', async () => {
    const fixture = await catalogRevisionFixture();
    const saved = await saveStoredWireEdmJobRevision(fixture.workbench, fixture.candidate);
    if (!saved.ok) throw new Error(saved.error.message);
    const previousProject = fixture.adapter.files.get('projects/fixture.part.json')!;
    const previousManifest = fixture.adapter.files.get(WORKBENCH_CATALOG_PATH)!;
    const nextProject = JSON.stringify({ ...JSON.parse(previousProject),
      updatedAt: '2026-08-28T13:00:00.000Z', savedRevisionIds: [] });
    const nextManifest = JSON.stringify({ ...JSON.parse(previousManifest),
      updatedAt: '2026-08-28T13:00:00.000Z',
      projects: [{ ...saved.workbench.manifest.projects[0], updatedAt: '2026-08-28T13:00:00.000Z' }] });
    const begun = await beginRevisionDeletionTransaction(fixture.adapter, {
      projectId: 'fixture.part',
      revisionIds: ['revision.0001'],
      previousProject,
      nextProject,
      previousManifest,
      nextManifest
    });
    expect(begun).toMatchObject({ ok: true });
    await fixture.adapter.writeText('projects/fixture.part.json', nextProject);
    const reopened = await initializeWorkbenchCatalog(fixture.adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(fixture.adapter.files.has(saved.path)).toBe(true);
    expect(fixture.adapter.files.get('projects/fixture.part.json')).toBe(previousProject);
    expect(fixture.adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(previousManifest);
    expect(fixture.adapter.files.has(SAVED_REVISION_TRANSACTION_PATH)).toBe(false);

    expect(await beginRevisionDeletionTransaction(fixture.adapter, {
      projectId: 'fixture.part', revisionIds: ['revision.0001'], previousProject, nextProject,
      previousManifest, nextManifest
    })).toMatchObject({ ok: true });
    await fixture.adapter.writeText('projects/fixture.part.json', nextProject);
    await fixture.adapter.writeText(WORKBENCH_CATALOG_PATH, nextManifest);
    const completed = await initializeWorkbenchCatalog(fixture.adapter);
    if (!completed.ok) throw new Error(completed.error.message);
    expect(fixture.adapter.files.has(saved.path)).toBe(false);
    expect(await readStoredWorkbenchProject(completed.workbench, 'fixture.part')).toMatchObject({
      ok: true, project: { savedRevisionIds: [] }
    });
  });

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
    expect(fixture.adapter.files.has(saved.path)).toBe(true);
    expect(fixture.adapter.files.has('projects/fixture.part.json')).toBe(true);
    expect(deleted.workbench.manifest.projects).toEqual([]);
    expect(deleted.workbench.manifest.deletedProjects?.[0].project.id).toBe('fixture.part');
    const revisionBytes = fixture.adapter.files.get(saved.path);
    const reopened = await initializeWorkbenchCatalog(fixture.adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const restored = await restoreStoredWorkbenchProject(reopened.workbench, { projectId: 'fixture.part' });
    if (!restored.ok) throw new Error(restored.error.message);
    expect(restored.project).toEqual(saved.project);
    expect(fixture.adapter.files.get(saved.path)).toBe(revisionBytes);
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

  it('removes a possibly partial revision after its write reports failure', async () => {
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
    expect(fixture.adapter.mutations).toEqual([
      `write:${SAVED_REVISION_TRANSACTION_PATH}`,
      `write:${revisionPath}`,
      `delete:${revisionPath}`,
      `delete:${SAVED_REVISION_TRANSACTION_PATH}`
    ]);
  });

  it('reopens consistently after termination at every saved-revision write boundary', async () => {
    const fixture = await catalogRevisionFixture();
    const before = new Map(fixture.adapter.files);
    fixture.adapter.durableStates.length = 0;
    const saved = await saveStoredWireEdmJobRevision(fixture.workbench, fixture.candidate);
    if (!saved.ok) throw new Error(saved.error.message);
    const after = new Map(fixture.adapter.files);
    expect(fixture.adapter.durableStates).toHaveLength(5);

    for (const [index, state] of fixture.adapter.durableStates.entries()) {
      const restarted = new MemoryAdapter(`restart-${index}`);
      for (const [path, text] of state) restarted.files.set(path, text);
      // A fresh adapter represents a new process: no original catch/finally runs.
      const reopened = await initializeWorkbenchCatalog(restarted);
      if (!reopened.ok) throw new Error(`Boundary ${index}: ${reopened.error.message}`);
      expect(restarted.files).toEqual(index < 3 ? before : after);
      expect(await readStoredWorkbenchProject(reopened.workbench, 'fixture.part')).toMatchObject({
        ok: true,
        project: { savedRevisionIds: index < 3 ? [] : ['revision.0001'] }
      });
      // Recovery is idempotent.
      expect(await initializeWorkbenchCatalog(restarted)).toMatchObject({ ok: true });
    }
  });

  it('recovers before parsing a manifest interrupted mid-write and can retry recovery', async () => {
    const fixture = await catalogRevisionFixture();
    const before = new Map(fixture.adapter.files);
    fixture.adapter.durableStates.length = 0;
    expect(await saveStoredWireEdmJobRevision(fixture.workbench, fixture.candidate)).toMatchObject({ ok: true });
    const interrupted = fixture.adapter.durableStates[2];
    const restarted = new MemoryAdapter('partial-manifest');
    for (const [path, text] of interrupted) restarted.files.set(path, text);
    restarted.files.set(WORKBENCH_CATALOG_PATH, '{"format":');
    restarted.failNextWrite(WORKBENCH_CATALOG_PATH);
    expect(await initializeWorkbenchCatalog(restarted)).toMatchObject({ ok: false });
    expect(restarted.files.has(SAVED_REVISION_TRANSACTION_PATH)).toBe(true);
    expect(await initializeWorkbenchCatalog(restarted)).toMatchObject({ ok: true });
    expect(restarted.files).toEqual(before);
  });

  it('recovers a pending revision before a subsequent preference mutation', async () => {
    const fixture = await catalogRevisionFixture();
    fixture.adapter.durableStates.length = 0;
    expect(await saveStoredWireEdmJobRevision(fixture.workbench, fixture.candidate)).toMatchObject({ ok: true });
    const interrupted = fixture.adapter.durableStates[2];
    fixture.adapter.files.clear();
    for (const [path, text] of interrupted) fixture.adapter.files.set(path, text);

    const updated = await updateWorkbenchCatalogPreferences(fixture.workbench, {
      preferences: { ...fixture.workbench.manifest.preferences, importUnits: { mode: 'fixed', unit: 'inches' } },
      updatedAt: new Date('2026-08-28T14:00:00.000Z')
    });
    if (!updated.ok) throw new Error(updated.error.message);
    expect(fixture.adapter.files.has(SAVED_REVISION_TRANSACTION_PATH)).toBe(false);
    const reopened = await initializeWorkbenchCatalog(fixture.adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.workbench.manifest.preferences.importUnits).toEqual({ mode: 'fixed', unit: 'inches' });
    expect(await readStoredWorkbenchProject(reopened.workbench, 'fixture.part')).toMatchObject({
      ok: true, project: { savedRevisionIds: [] }
    });
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
      error: { code: 'PROJECT_TRASH_TRANSACTION_FAILED' }
    });
    expect(fixture.adapter.files.get(saved.path)).toBe(revisionBefore);
    expect(fixture.adapter.files.get('projects/fixture.part.json')).toBe(projectBefore);
    expect(fixture.adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(manifestBefore);
  });

  it('refuses to restore a deleted project with a corrupted saved revision without losing its recovery entry', async () => {
    const fixture = await catalogRevisionFixture();
    const saved = await saveStoredWireEdmJobRevision(fixture.workbench, fixture.candidate);
    if (!saved.ok) throw new Error(saved.error.message);
    const deleted = await deleteStoredWorkbenchProject(saved.workbench, { projectId: 'fixture.part', deletedAt: new Date() });
    if (!deleted.ok) throw new Error(deleted.error.message);
    fixture.adapter.files.set(saved.path, '{corrupted');
    const before = new Map(fixture.adapter.files);
    expect(await restoreStoredWorkbenchProject(deleted.workbench, { projectId: 'fixture.part' })).toMatchObject({
      ok: false, error: { code: 'WORKBENCH_PROJECT_SCHEMA_INVALID', path: saved.path }
    });
    expect(fixture.adapter.files).toEqual(before);
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
    minimalPostPackage()
  );
  if (!installed.ok) throw new Error(installed.error.message);
  const parsedMachine = parseMachineDefinition(JSON.stringify(machineValue()));
  if (!parsedMachine.ok) throw new Error(JSON.stringify(parsedMachine.diagnostics));
  const bound = createMachinePostBinding(parsedMachine.machine, installed.installation, {
    id: 'production',
    name: 'Production',
    properties: { coordinatePrecision: 3 },
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
  return { adapter, workbench: added.workbench, candidate: candidate.candidate,
    machine: bound.machine, library: installed.library };
}

function machineValue(): MachineDefinitionValue {
  return {
    format: 'wire-edm-machine',
    schemaVersion: 1,
    id: 'fixture.machine',
    name: 'Fixture machine',
    identity: {
      manufacturer: 'Charmilles',
      model: 'Robofil 100',
      controller: {
        manufacturer: 'Charmilles',
        model: 'Robofil Classic',
        firmware: 'Local verified configuration'
      }
    },
    limits: {
      xTravel: { status: 'known', millimeters: 100 },
      yTravel: { status: 'known', millimeters: 100 }
    },
    hardware: { manualThreading: true, automaticThreading: false },
    evidence: [],
    bindings: [],
    activeBindingId: null,
    notes: 'Test fixture.'
  };
}
