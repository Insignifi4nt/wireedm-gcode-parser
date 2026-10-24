import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it } from 'vitest';
import { boundMachineFixture } from '@/domain/machine-definition/__tests__/machineDefinitionFixture';
import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import { writeMachineLibraryStorage } from '@/domain/machine-definition/machineLibraryStorage';
import type { PostLibrary } from '@/domain/post-processor/postLibrary';
import { writePostLibraryStorage } from '@/domain/post-processor/postLibraryStorage';
import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { addStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createSavedWireEdmJobRevision, loadSavedWireEdmJobRevision, saveStoredWireEdmJobRevision } from '@/domain/wire-edm-job/savedWireEdmJobRevision';
import { generateControllerArtifact } from '@/domain/wire-edm-job/controllerArtifact';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { openIndexedDbWorkbench } from '../indexedDbWorkbenchAdapter';
import { createWorkbenchBackup } from '../workbenchBackup';

afterEach(() => localStorage.clear());

it('migrates and backs up BOM catalogs, installed libraries and saved revisions without normalizing exact originals', async () => {
  const legacy = createBrowserCacheAdapter(localStorage);
  const opened = await initializeWorkbenchCatalog(legacy);
  if (!opened.ok) throw new Error(opened.error.message);
  const bound = await boundMachineFixture();
  const machine: MachineDefinition = { ...bound.machine, activeBindingId: 'production',
    limits: { ...bound.machine.limits, yTravel: { status: 'known', millimeters: 200 } } };
  const posts: PostLibrary = { schemaVersion: 1, installations: [bound.installation] };
  expect(await writePostLibraryStorage(legacy, posts)).toMatchObject({ ok: true });
  expect(await writeMachineLibraryStorage(legacy, { schemaVersion: 1, machines: [machine] })).toMatchObject({ ok: true });
  const geometry = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
  ]);
  const document = setManualCompensationIntent(geometry, geometry.plan.operations[0].id, 'centerline');
  if (!document) throw new Error('Expected explicit compensation');
  document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
  const project = createWorkbenchProjectDocument({ id: 'bom.part', name: 'BOM part',
    source: { kind: 'upid', files: [] }, content: { kind: 'upid-document', document } });
  if (!project.ok) throw new Error(project.error.message);
  const added = await addStoredWorkbenchProject(opened.workbench, { project: project.project, ownedFiles: [] });
  if (!added.ok) throw new Error(added.error.message);
  const candidate = await createSavedWireEdmJobRevision({ revisionId: 'revision.bom', savedAt: new Date().toISOString(),
    project: project.project, machine, bindingId: 'production', postLibrary: posts });
  if (!candidate.ok) throw new Error(candidate.error.message);
  const saved = await saveStoredWireEdmJobRevision(added.workbench, candidate.candidate);
  if (!saved.ok) throw new Error(saved.error.message);
  const baseline = await generateControllerArtifact(saved.revision);
  if (!baseline.ok) throw new Error(JSON.stringify(baseline.error));
  const paths = ['workbench.json', 'posts/library.json', 'machines/library.json', 'projects/bom.part.json', saved.path];
  const originals = new Map<string, string>();
  for (const path of paths) {
    const text = await legacy.readExactText!(path);
    if (text === null) throw new Error(`Fixture file missing: ${path}`);
    const exact = '\uFEFF' + text;
    await legacy.writeText(path, exact); originals.set(path, exact);
  }
  const physical = new Map(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)!]));
  const migrated = await openIndexedDbWorkbench({ factory: new IDBFactory(), legacyStorage: localStorage });
  try {
    const reopened = await initializeWorkbenchCatalog(migrated);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.workbench.posts).toEqual(posts);
    const revision = await loadSavedWireEdmJobRevision(migrated, 'bom.part', saved.revision.revisionId);
    if (!revision.ok) throw new Error(revision.error.message);
    expect(await generateControllerArtifact(revision.revision)).toMatchObject({ ok: true, artifact: { sha256: baseline.artifact.sha256 } });
    const backup = await createWorkbenchBackup(reopened.workbench);
    expect(backup.summary).toMatchObject({ projects: 1, posts: 1, machines: 1, revisions: 1 });
    const archive: unknown = JSON.parse(backup.text);
    for (const [path, text] of originals) {
      expect(await migrated.readText(path)).toBe(text);
      expect(await migrated.readExactText!(path)).toBe(text);
      expect(archive).toMatchObject({ files: expect.arrayContaining([{ path, text, sha256: createHash('sha256').update(text).digest('hex') }]) });
    }
    expect(await migrated.readLegacyOriginals()).toEqual(physical);
    expect(new Map(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)!]))).toEqual(physical);
  } finally { migrated.close(); }
});
