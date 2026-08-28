import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import { createEmptyPostLibrary } from '@/domain/post-processor/postLibrary';
import {
  installStoredPostPackage,
  removeStoredPostInstallation
} from '@/domain/post-processor/postLibraryMutations';
import {
  initializePostLibraryStorage,
  POST_LIBRARY_PATH
} from '@/domain/post-processor/postLibraryStorage';
import { minimalPostPackage } from '@/domain/post-processor/__tests__/postPackageFixture';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { updateWorkbenchCatalogPreferences } from '@/domain/workbench-catalog/storage/updateWorkbenchCatalogPreferences';
import { addStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import {
  parseMachineDefinition,
  serializeMachineDefinition,
  type MachineDefinitionValue
} from '../machineDefinition';
import {
  createStoredMachinePostBinding,
  duplicateStoredMachinePostBinding,
  installStoredMachineDefinition,
  removeStoredMachineDefinition,
  removeStoredMachinePostBinding,
  replaceStoredMachineDefinition
} from '../machineLibraryMutations';
import {
  initializeMachineLibraryStorage,
  MACHINE_LIBRARY_PATH,
  readMachineLibraryStorage
} from '../machineLibraryStorage';
import {
  compatibilityFixture,
  machineDefinitionFixture,
  machineDefinitionValue
} from './machineDefinitionFixture';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  corruptNextMachineWrite = false;
  constructor(readonly name = 'machine-mutations') {}
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) {
    this.files.set(
      path,
      path === MACHINE_LIBRARY_PATH && this.corruptNextMachineWrite
        ? `${contents}corrupt`
        : contents
    );
    this.corruptNextMachineWrite = false;
  }
  async deleteText(path: string) { this.files.delete(path); }
}

function unboundMachineText() {
  return serializeMachineDefinition(machineDefinitionFixture());
}

describe('persisted machine library mutations', () => {
  it('replaces one exact portable machine definition against authoritative catalog state', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const installed = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!installed.ok) throw new Error(installed.error.message);
    const replacement = machineDefinitionValue('Renamed Robofil 100');
    replacement.limits.yTravel = { status: 'known', millimeters: 160 };

    const result = await replaceStoredMachineDefinition(
      initialized.workbench,
      JSON.stringify(replacement)
    );

    expect(result).toMatchObject({
      ok: true,
      machine: {
        id: 'shop.robofil-100',
        name: 'Renamed Robofil 100',
        limits: { yTravel: { status: 'known', millimeters: 160 } }
      },
      workbench: {
        machines: {
          machines: [{ id: 'shop.robofil-100', name: 'Renamed Robofil 100' }]
        }
      }
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(await readMachineLibraryStorage(adapter, result.workbench.posts))
      .toMatchObject({
        ok: true,
        library: { machines: [{ name: 'Renamed Robofil 100' }] }
      });
  });

  it('rejects replacement with a dangling exact post reference and preserves stored bytes', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const installed = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!installed.ok) throw new Error(installed.error.message);
    const replacement = machineDefinitionValue('Invalid replacement');
    replacement.bindings.push({
      id: 'dangling',
      name: 'Dangling',
      post: { packageId: 'missing.post', version: '1.0.0', contentHash: '0'.repeat(64) },
      properties: {},
      compatibility: compatibilityFixture(),
      verification: { status: 'unverified' }
    });
    const before = adapter.files.get(MACHINE_LIBRARY_PATH);

    const result = await replaceStoredMachineDefinition(
      initialized.workbench,
      JSON.stringify(replacement)
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_MUTATION_DANGLING_POST_BINDING',
        machineId: 'shop.robofil-100',
        bindingId: 'dangling'
      }
    });
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(before);
  });

  it('restores exact machine-library bytes when a replacement fails readback', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const installed = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!installed.ok) throw new Error(installed.error.message);
    const before = adapter.files.get(MACHINE_LIBRARY_PATH);
    adapter.corruptNextMachineWrite = true;

    const result = await replaceStoredMachineDefinition(
      initialized.workbench,
      JSON.stringify(machineDefinitionValue('Corrupted replacement'))
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_LIBRARY_MUTATION_READBACK_MISMATCH' }
    });
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(before);
  });

  it('requires an explicit preference change before removing the remembered planning machine', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const installed = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!installed.ok) throw new Error(installed.error.message);
    const reopened = await initializeWorkbenchCatalog(adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const selected = await updateWorkbenchCatalogPreferences(reopened.workbench, {
      preferences: {
        ...reopened.workbench.manifest.preferences,
        recentPlanningMachineId: installed.machine.id
      },
      updatedAt: new Date('2026-08-28T13:00:00.000Z')
    });
    if (!selected.ok) throw new Error(selected.error.message);
    const before = adapter.files.get(MACHINE_LIBRARY_PATH);

    expect(await removeStoredMachineDefinition(
      selected.workbench,
      installed.machine.id
    )).toMatchObject({
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
      updatedAt: new Date('2026-08-28T14:00:00.000Z')
    });
    if (!cleared.ok) throw new Error(cleared.error.message);
    const removed = await removeStoredMachineDefinition(cleared.workbench, installed.machine.id);

    expect(removed).toMatchObject({
      ok: true,
      removed: { id: 'shop.robofil-100' },
      workbench: {
        manifest: { preferences: { recentPlanningMachineId: null } },
        machines: { machines: [] }
      }
    });
  });

  it('removes a machine while leaving immutable saved-revision snapshots untouched', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const installed = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!installed.ok) throw new Error(installed.error.message);
    const project = createWorkbenchProjectDocument({
      id: 'revision-owner',
      name: 'Revision owner',
      now: new Date('2026-08-28T12:00:00.000Z'),
      source: { kind: 'upid', files: [] },
      content: {
        kind: 'upid-document',
        document: createUpidFromDxfEntities([
          { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }
        ])
      }
    });
    if (!project.ok) throw new Error(project.error.message);
    const added = await addStoredWorkbenchProject(initialized.workbench, {
      project: project.project,
      ownedFiles: []
    });
    if (!added.ok) throw new Error(added.error.message);
    const revisionId = 'revision.0001';
    const updatedAt = '2026-08-28T13:00:00.000Z';
    const storedProject = JSON.parse(adapter.files.get('projects/revision-owner.json') ?? '');
    storedProject.savedRevisionIds = [revisionId];
    storedProject.updatedAt = updatedAt;
    adapter.files.set('projects/revision-owner.json', JSON.stringify(storedProject));
    const revisionPath = `projects/revision-owner/revisions/${revisionId}.wireedm-job.json`;
    const revisionBytes = JSON.stringify({ machine: { id: installed.machine.id } });
    adapter.files.set(revisionPath, revisionBytes);
    const storedManifest = JSON.parse(adapter.files.get('workbench.json') ?? '');
    storedManifest.updatedAt = updatedAt;
    storedManifest.projects[0].updatedAt = updatedAt;
    adapter.files.set('workbench.json', JSON.stringify(storedManifest));

    const removed = await removeStoredMachineDefinition(
      added.workbench,
      installed.machine.id
    );

    expect(removed).toMatchObject({ ok: true, removed: { id: 'shop.robofil-100' } });
    expect(adapter.files.get(revisionPath)).toBe(revisionBytes);
  });

  it('duplicates an exact binding property preset with new identity and acknowledgment', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const post = await installStoredPostPackage(adapter, JSON.stringify(minimalPostPackage()));
    if (!post.ok) throw new Error(post.error.message);
    const installed = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!installed.ok) throw new Error(installed.error.message);
    const source = await createStoredMachinePostBinding(
      adapter,
      installed.machine.id,
      post.installation.ref,
      {
        id: 'production',
        name: 'Production',
        properties: { coordinatePrecision: 3 },
        compatibility: compatibilityFixture()
      }
    );
    if (!source.ok) throw new Error(source.error.message);
    const evidence = [{
      id: 'production-test',
      name: 'Production test',
      uri: 'local://production-test',
      contentSha256: '1'.repeat(64)
    }];
    const machineDefinitionHash = await sha256(canonicalJson({
      format: source.machine.format,
      schemaVersion: source.machine.schemaVersion,
      id: source.machine.id,
      name: source.machine.name,
      identity: source.machine.identity,
      limits: source.machine.limits,
      hardware: source.machine.hardware,
      evidence,
      notes: source.machine.notes
    }));
    const propertiesHash = await sha256(canonicalJson(source.binding.properties));
    const claimed = parseMachineDefinition(JSON.stringify({
      ...source.machine,
      evidence,
      bindings: source.machine.bindings.map((binding) => ({
        ...binding,
        verification: {
          status: 'claimed',
          verifiedAt: '2026-08-28T14:00:00.000Z',
          verifiedBy: 'Cristian',
          machineDefinitionHash,
          postContentHash: binding.post.contentHash,
          propertiesHash,
          evidenceRefs: ['production-test'],
          notes: 'Validated fixture claim.'
        }
      }))
    }));
    if (!claimed.ok) throw new Error(JSON.stringify(claimed.diagnostics));
    adapter.files.set(MACHINE_LIBRARY_PATH, JSON.stringify({
      format: 'wire-edm-machine-library',
      schemaVersion: 1,
      machines: [claimed.machine]
    }, null, 2));
    const duplicateCompatibility = {
      ...compatibilityFixture(),
      acknowledgedAt: '2026-08-28T15:00:00.000Z',
      notes: 'Acknowledged separately for the duplicated preset.'
    };

    const result = await duplicateStoredMachinePostBinding(
      initialized.workbench,
      installed.machine.id,
      'production',
      {
        id: 'roughing',
        name: 'Roughing',
        compatibility: duplicateCompatibility
      }
    );

    expect(result).toMatchObject({
      ok: true,
      binding: {
        id: 'roughing',
        name: 'Roughing',
        post: post.installation.ref,
        properties: { coordinatePrecision: 3 },
        compatibility: duplicateCompatibility,
        verification: { status: 'unverified' }
      },
      machine: {
        bindings: [
          { id: 'production', verification: { status: 'claimed' } },
          { id: 'roughing', verification: { status: 'unverified' } }
        ]
      }
    });
  });

  it('rejects duplicate binding identity conflicts and dangling source post references', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const post = await installStoredPostPackage(adapter, JSON.stringify(minimalPostPackage()));
    if (!post.ok) throw new Error(post.error.message);
    const installed = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!installed.ok) throw new Error(installed.error.message);
    const source = await createStoredMachinePostBinding(
      adapter,
      installed.machine.id,
      post.installation.ref,
      {
        id: 'production',
        name: 'Production',
        properties: { coordinatePrecision: 3 },
        compatibility: compatibilityFixture()
      }
    );
    if (!source.ok) throw new Error(source.error.message);
    const before = adapter.files.get(MACHINE_LIBRARY_PATH);

    expect(await duplicateStoredMachinePostBinding(
      initialized.workbench,
      installed.machine.id,
      'production',
      {
        id: 'production',
        name: 'Conflict',
        compatibility: compatibilityFixture()
      }
    )).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_POST_BINDING_ID_CONFLICT', bindingId: 'production' }
    });
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(before);

    adapter.files.set(POST_LIBRARY_PATH, JSON.stringify({
      format: 'wire-edm-post-library',
      schemaVersion: 1,
      installations: []
    }));
    expect(await duplicateStoredMachinePostBinding(
      initialized.workbench,
      installed.machine.id,
      'production',
      {
        id: 'roughing',
        name: 'Roughing',
        compatibility: compatibilityFixture()
      }
    )).toMatchObject({
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_STORAGE_DANGLING_POST_BINDING',
        machineId: 'shop.robofil-100',
        bindingId: 'production'
      }
    });
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(before);
  });

  it('installs a portable machine and persists exact binding add/remove operations', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    const post = await installStoredPostPackage(adapter, JSON.stringify(minimalPostPackage()));
    if (!post.ok) throw new Error(post.error.message);
    await initializeMachineLibraryStorage(adapter, post.library);

    expect(await installStoredMachineDefinition(adapter, unboundMachineText())).toMatchObject({
      ok: true,
      kind: 'installed',
      machine: { id: 'shop.robofil-100', bindings: [] }
    });
    expect(await createStoredMachinePostBinding(adapter, 'shop.robofil-100', post.installation.ref, {
      id: 'production',
      name: 'Production',
      properties: { coordinatePrecision: 3 },
      compatibility: compatibilityFixture()
    })).toMatchObject({ ok: true, binding: { id: 'production' } });

    expect(await removeStoredMachinePostBinding(adapter, 'shop.robofil-100', 'production')).toMatchObject({
      ok: true,
      removed: { id: 'production' }
    });
    expect(await readMachineLibraryStorage(adapter, post.library)).toMatchObject({
      ok: true,
      library: { machines: [{ id: 'shop.robofil-100', bindings: [] }] }
    });
  });

  it('rejects an imported machine with a dangling post and preserves stored bytes', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    await initializeMachineLibraryStorage(adapter, createEmptyPostLibrary());
    const installed = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!installed.ok) throw new Error(installed.error.message);
    const tampered = structuredClone(installed.machine) as MachineDefinitionValue;
    tampered.bindings.push({
      id: 'dangling',
      name: 'Dangling',
      post: { packageId: 'missing.post', version: '1.0.0', contentHash: '0'.repeat(64) },
      properties: {},
      compatibility: {
        status: 'acknowledged',
        acknowledgedAt: '2026-08-28T12:00:00.000Z',
        acknowledgedBy: 'Cristian',
        notes: 'Fixture.'
      },
      verification: { status: 'unverified' }
    });
    const before = adapter.files.get(MACHINE_LIBRARY_PATH);

    expect(await installStoredMachineDefinition(adapter, serializeMachineDefinition(tampered))).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_LIBRARY_MUTATION_DANGLING_POST_BINDING' }
    });
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(before);
  });

  it('serializes binding creation with post removal so persisted references cannot race', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    const post = await installStoredPostPackage(adapter, JSON.stringify(minimalPostPackage()));
    if (!post.ok) throw new Error(post.error.message);
    await initializeMachineLibraryStorage(adapter, post.library);
    const machine = await installStoredMachineDefinition(adapter, unboundMachineText());
    if (!machine.ok) throw new Error(machine.error.message);

    const [binding, removal] = await Promise.all([
      createStoredMachinePostBinding(adapter, machine.machine.id, post.installation.ref, {
        id: 'production',
        name: 'Production',
        properties: { coordinatePrecision: 3 },
        compatibility: compatibilityFixture()
      }),
      removeStoredPostInstallation(adapter, post.installation.ref)
    ]);

    expect(binding).toMatchObject({ ok: true, binding: { id: 'production' } });
    expect(removal).toMatchObject({
      ok: false,
      error: { code: 'POST_LIBRARY_INSTALLATION_IN_USE' }
    });
    expect(await readMachineLibraryStorage(adapter, post.library)).toMatchObject({
      ok: true,
      library: {
        machines: [{ id: 'shop.robofil-100', bindings: [{ id: 'production' }] }]
      }
    });
  });
});

async function sha256(value: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
