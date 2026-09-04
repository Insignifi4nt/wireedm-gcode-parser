import { describe, expect, it } from 'vitest';

import {
  buildMachinePackageArchive,
  commitStoredMachinePackageInstallation,
  prepareStoredMachinePackageInstallation
} from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import {
  beginCatalogPairTransaction,
  CATALOG_PAIR_TRANSACTION_PATH
} from '@/domain/storage/catalogPairTransaction';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { addStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { updateWorkbenchCatalogPreferences } from '@/domain/workbench-catalog/storage/updateWorkbenchCatalogPreferences';

import {
  activateStoredMachinePostBinding,
  removeStoredMachineDefinition
} from '../machineLibraryMutations';
import { MACHINE_LIBRARY_PATH } from '../machineLibraryStorage';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  constructor(readonly name = 'machine-mutations') {}
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
  async deleteText(path: string) { this.files.delete(path); }
}

async function workbenchWithMachine(adapter: MemoryAdapter) {
  const initialized = await initializeWorkbenchCatalog(adapter, {
    now: new Date('2026-09-04T08:00:00.000Z')
  });
  if (!initialized.ok) throw new Error(initialized.error.message);
  const built = await buildMachinePackageArchive(await machinePackageFixture());
  if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
  const prepared = await prepareStoredMachinePackageInstallation(initialized.workbench, built.archive);
  if (!prepared.ok) throw new Error(prepared.error.message);
  const committed = await commitStoredMachinePackageInstallation(
    prepared.prepared,
    { kind: 'install-new' }
  );
  if (!committed.ok) throw new Error(committed.error.message);
  return committed.workbench;
}

describe('persisted machine library mutations', () => {
  it('activates an installed setup without exposing loose machine or post installation APIs', async () => {
    const adapter = new MemoryAdapter();
    const first = await workbenchWithMachine(adapter);
    const built = await buildMachinePackageArchive(await machinePackageFixture({
      packageVersion: '2.0.0',
      postVersion: '2.0.0',
      bindingId: 'production-v2'
    }));
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(first, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const second = await commitStoredMachinePackageInstallation(
      prepared.prepared,
      { kind: 'reuse-existing', machineId: 'shop.robofil-100', activate: 'keep-current' }
    );
    if (!second.ok) throw new Error(second.error.message);

    const activated = await activateStoredMachinePostBinding(
      adapter,
      'shop.robofil-100',
      'production-v2'
    );

    expect(activated).toMatchObject({
      ok: true,
      machine: { id: 'shop.robofil-100', activeBindingId: 'production-v2' }
    });
  });

  it('requires an explicit preference change before removing the remembered planning machine', async () => {
    const adapter = new MemoryAdapter();
    const workbench = await workbenchWithMachine(adapter);
    const selected = await updateWorkbenchCatalogPreferences(workbench, {
      preferences: {
        ...workbench.manifest.preferences,
        recentPlanningMachineId: 'shop.robofil-100'
      },
      updatedAt: new Date('2026-09-04T09:00:00.000Z')
    });
    if (!selected.ok) throw new Error(selected.error.message);
    const before = adapter.files.get(MACHINE_LIBRARY_PATH);

    expect(await removeStoredMachineDefinition(selected.workbench, 'shop.robofil-100')).toMatchObject({
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_MUTATION_MACHINE_IS_RECENT',
        machineId: 'shop.robofil-100'
      }
    });
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(before);

    const cleared = await updateWorkbenchCatalogPreferences(selected.workbench, {
      preferences: {
        ...selected.workbench.manifest.preferences,
        recentPlanningMachineId: null
      },
      updatedAt: new Date('2026-09-04T10:00:00.000Z')
    });
    if (!cleared.ok) throw new Error(cleared.error.message);
    expect(await removeStoredMachineDefinition(cleared.workbench, 'shop.robofil-100')).toMatchObject({
      ok: true,
      removed: { id: 'shop.robofil-100' },
      workbench: { machines: { machines: [] } }
    });
  });

  it('removes a machine while leaving immutable saved-revision snapshots untouched', async () => {
    const adapter = new MemoryAdapter();
    const workbench = await workbenchWithMachine(adapter);
    const project = createWorkbenchProjectDocument({
      id: 'revision-owner',
      name: 'Revision owner',
      now: new Date('2026-09-04T08:00:00.000Z'),
      source: { kind: 'upid', files: [] },
      content: {
        kind: 'upid-document',
        document: createUpidFromDxfEntities([
          { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }
        ])
      }
    });
    if (!project.ok) throw new Error(project.error.message);
    const added = await addStoredWorkbenchProject(workbench, { project: project.project, ownedFiles: [] });
    if (!added.ok) throw new Error(added.error.message);
    const revisionId = 'revision.0001';
    const revisionPath = `projects/revision-owner/revisions/${revisionId}.wireedm-job.json`;
    const revisionBytes = JSON.stringify({ machine: { id: 'shop.robofil-100' } });
    adapter.files.set(revisionPath, revisionBytes);

    const removed = await removeStoredMachineDefinition(added.workbench, 'shop.robofil-100');

    expect(removed).toMatchObject({ ok: true, removed: { id: 'shop.robofil-100' } });
    expect(adapter.files.get(revisionPath)).toBe(revisionBytes);
  });

  it('recovers an interrupted package transaction before another catalog mutation', async () => {
    const adapter = new MemoryAdapter();
    const workbench = await workbenchWithMachine(adapter);
    const previousPosts = adapter.files.get(POST_LIBRARY_PATH);
    const previousMachines = adapter.files.get(MACHINE_LIBRARY_PATH);
    if (previousPosts === undefined || previousMachines === undefined) {
      throw new Error('Expected initialized machine and post catalogs.');
    }
    const nextPosts = `${previousPosts} interrupted`;
    const nextMachines = `${previousMachines} interrupted`;
    const begun = await beginCatalogPairTransaction(adapter, {
      previousPosts,
      previousMachines,
      nextPosts,
      nextMachines
    });
    if (!begun.ok) throw new Error(begun.error.message);
    adapter.files.set(POST_LIBRARY_PATH, nextPosts);

    const removed = await removeStoredMachineDefinition(workbench, 'shop.robofil-100');

    expect(removed).toMatchObject({ ok: true, removed: { id: 'shop.robofil-100' } });
    expect(adapter.files.get(POST_LIBRARY_PATH)).toBe(previousPosts);
    expect(adapter.files.has(CATALOG_PAIR_TRANSACTION_PATH)).toBe(false);
  });
});
