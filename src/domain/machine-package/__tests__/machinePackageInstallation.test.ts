import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';
import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';
import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import { CATALOG_PAIR_TRANSACTION_PATH } from '@/domain/storage/catalogPairTransaction';

import { buildMachinePackageArchive, MACHINE_PACKAGE_ENTRY } from '../machinePackage';
import {
  commitStoredMachinePackageInstallation,
  prepareStoredMachinePackageInstallation
} from '../machinePackageInstallation';
import { machinePackageFixture } from './machinePackageFixture';

describe('complete machine package installation', () => {
  it('preserves and reports exact post-conformance diagnostics from an invalid package', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const source = await machinePackageFixture();
    const post = source.document.posts[0];
    const firstFixture = post.fixtures[0];
    const expectedProgram = 'INTENTIONALLY DIFFERENT';
    const document = {
      ...source.document,
      posts: [{
        ...post,
        fixtures: [{ ...firstFixture, expectedProgram }, ...post.fixtures.slice(1)]
      }]
    };
    const archive = zipSync({
      [MACHINE_PACKAGE_ENTRY]: strToU8(`${canonicalJson(document)}\n`),
      ...source.files
    });

    const prepared = await prepareStoredMachinePackageInstallation(
      initialized.workbench,
      archive
    );

    expect(prepared).toMatchObject({
      ok: false,
      error: {
        code: 'MACHINE_PACKAGE_INVALID',
        message: expect.stringContaining('POST_CONFORMANCE_EXPECTED_PROGRAM_MISMATCH')
      },
      diagnostics: [{
        code: 'MACHINE_PACKAGE_POST_INSTALL_FAILED',
        conformanceDiagnostics: [{
          code: 'POST_CONFORMANCE_EXPECTED_PROGRAM_MISMATCH',
          fixtureId: firstFixture.id,
          expectedProgram
        }]
      }]
    });
  });

  it('previews and atomically installs a new machine with its post and setup', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));

    const prepared = await prepareStoredMachinePackageInstallation(
      initialized.workbench,
      built.archive
    );

    expect(prepared).toMatchObject({
      ok: true,
      preview: {
        packageHash: built.package.contentHash,
        machine: { kind: 'new', incoming: { id: 'shop.robofil-100' } },
        posts: [{ kind: 'install', name: 'Example Robofil Classic', version: '1.0.0' }],
        activeBindingId: 'production'
      }
    });
    if (!prepared.ok) throw new Error(prepared.error.message);

    const committed = await commitStoredMachinePackageInstallation(
      prepared.prepared,
      { kind: 'install-new' }
    );

    expect(committed).toMatchObject({
      ok: true,
      workbench: {
        machines: {
          machines: [{ id: 'shop.robofil-100', bindings: [{ id: 'production' }] }]
        },
        posts: {
          installations: [{ ref: { packageId: 'example.robofil-classic', version: '1.0.0' } }]
        }
      }
    });
  });

  it('deduplicates the machine while adding and activating a new post version', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const firstBuilt = await buildMachinePackageArchive(await machinePackageFixture());
    if (!firstBuilt.ok) throw new Error(JSON.stringify(firstBuilt.diagnostics));
    const firstPrepared = await prepareStoredMachinePackageInstallation(
      initialized.workbench,
      firstBuilt.archive
    );
    if (!firstPrepared.ok) throw new Error(firstPrepared.error.message);
    const firstCommitted = await commitStoredMachinePackageInstallation(
      firstPrepared.prepared,
      { kind: 'install-new' }
    );
    if (!firstCommitted.ok) throw new Error(firstCommitted.error.message);

    const updateBuilt = await buildMachinePackageArchive(await machinePackageFixture({
      packageVersion: '2.0.0',
      postVersion: '2.0.0',
      bindingId: 'production-v2'
    }));
    if (!updateBuilt.ok) throw new Error(JSON.stringify(updateBuilt.diagnostics));
    const updatePrepared = await prepareStoredMachinePackageInstallation(
      firstCommitted.workbench,
      updateBuilt.archive
    );

    expect(updatePrepared).toMatchObject({
      ok: true,
      preview: {
        machine: {
          kind: 'exact',
          existing: { id: 'shop.robofil-100', activeBindingId: 'production' }
        },
        posts: [{ kind: 'install', version: '2.0.0' }],
        activeBindingId: 'production-v2'
      }
    });
    if (!updatePrepared.ok) throw new Error(updatePrepared.error.message);
    const committed = await commitStoredMachinePackageInstallation(
      updatePrepared.prepared,
      { kind: 'reuse-existing', machineId: 'shop.robofil-100', activate: 'package' }
    );

    expect(committed).toMatchObject({
      ok: true,
      workbench: {
        machines: {
          machines: [{
            id: 'shop.robofil-100',
            activeBindingId: 'production-v2',
            bindings: [{ id: 'production' }, { id: 'production-v2' }]
          }]
        },
        posts: {
          installations: [
            { ref: { version: '1.0.0' } },
            { ref: { version: '2.0.0' } }
          ]
        }
      }
    });
  });

  it('rejects an added setup when its merged machine exceeds the catalog setup limit', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const source = await machinePackageFixture();
    const setupLimit = 256;
    const firstBuilt = await buildMachinePackageArchive({
      ...source,
      document: {
        ...source.document,
        machine: {
          ...source.document.machine,
          bindings: Array.from({ length: setupLimit }, (_, index) => ({
            ...source.document.machine.bindings[0],
            id: `setup-${index}`,
            name: `Setup ${index}`
          })),
          activeBindingId: 'setup-0'
        },
        activeBindingId: 'setup-0'
      }
    });
    if (!firstBuilt.ok) throw new Error(JSON.stringify(firstBuilt.diagnostics));
    const firstPrepared = await prepareStoredMachinePackageInstallation(
      initialized.workbench,
      firstBuilt.archive
    );
    if (!firstPrepared.ok) throw new Error(firstPrepared.error.message);
    const firstCommitted = await commitStoredMachinePackageInstallation(
      firstPrepared.prepared,
      { kind: 'install-new' }
    );
    if (!firstCommitted.ok) throw new Error(firstCommitted.error.message);

    const updateSource = await machinePackageFixture({ bindingId: 'setup-overflow' });
    const updateBuilt = await buildMachinePackageArchive(updateSource);
    if (!updateBuilt.ok) throw new Error(JSON.stringify(updateBuilt.diagnostics));
    const updatePrepared = await prepareStoredMachinePackageInstallation(
      firstCommitted.workbench,
      updateBuilt.archive
    );
    if (!updatePrepared.ok) throw new Error(updatePrepared.error.message);
    const beforePosts = adapter.files.get(POST_LIBRARY_PATH);
    const beforeMachines = adapter.files.get(MACHINE_LIBRARY_PATH);

    const committed = await commitStoredMachinePackageInstallation(updatePrepared.prepared, {
      kind: 'reuse-existing',
      machineId: source.document.machine.id,
      activate: 'package'
    });

    expect(committed).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_PACKAGE_MERGED_CATALOG_INVALID' }
    });
    expect(adapter.files.get(POST_LIBRARY_PATH)).toBe(beforePosts);
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(beforeMachines);
  });

  it('shows physical changes before replacing a machine with the same stable ID', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const firstBuilt = await buildMachinePackageArchive(await machinePackageFixture());
    if (!firstBuilt.ok) throw new Error(JSON.stringify(firstBuilt.diagnostics));
    const firstPrepared = await prepareStoredMachinePackageInstallation(
      initialized.workbench,
      firstBuilt.archive
    );
    if (!firstPrepared.ok) throw new Error(firstPrepared.error.message);
    const firstCommitted = await commitStoredMachinePackageInstallation(
      firstPrepared.prepared,
      { kind: 'install-new' }
    );
    if (!firstCommitted.ok) throw new Error(firstCommitted.error.message);

    const changedFixture = await machinePackageFixture({ packageVersion: '1.1.0' });
    const changedInput = {
      ...changedFixture,
      document: {
        ...changedFixture.document,
        machine: {
          ...changedFixture.document.machine,
          limits: {
            ...changedFixture.document.machine.limits,
            yTravel: { status: 'known' as const, millimeters: 180 }
          }
        }
      }
    };
    const changedBuilt = await buildMachinePackageArchive(changedInput);
    if (!changedBuilt.ok) throw new Error(JSON.stringify(changedBuilt.diagnostics));

    const prepared = await prepareStoredMachinePackageInstallation(
      firstCommitted.workbench,
      changedBuilt.archive
    );

    expect(prepared).toMatchObject({
      ok: true,
      preview: {
        machine: {
          kind: 'changed',
          changes: [{
            path: '/limits/yTravel',
            before: { status: 'unknown' },
            after: { status: 'known', millimeters: 180 }
          }]
        }
      }
    });
  });

  it('reports controller identity changes as exact leaf fields', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const firstBuilt = await buildMachinePackageArchive(await machinePackageFixture({
      controllerModel: 'Controller model with a deliberately shared long prefix A'
    }));
    if (!firstBuilt.ok) throw new Error(JSON.stringify(firstBuilt.diagnostics));
    const firstPrepared = await prepareStoredMachinePackageInstallation(initialized.workbench, firstBuilt.archive);
    if (!firstPrepared.ok) throw new Error(firstPrepared.error.message);
    const firstCommitted = await commitStoredMachinePackageInstallation(firstPrepared.prepared, { kind: 'install-new' });
    if (!firstCommitted.ok) throw new Error(firstCommitted.error.message);
    const changedBuilt = await buildMachinePackageArchive(await machinePackageFixture({
      packageVersion: '2.0.0',
      postVersion: '2.0.0',
      bindingId: 'production-v2',
      controllerModel: 'Controller model with a deliberately shared long prefix B',
      firmware: 'Updated firmware'
    }));
    if (!changedBuilt.ok) throw new Error(JSON.stringify(changedBuilt.diagnostics));

    const prepared = await prepareStoredMachinePackageInstallation(firstCommitted.workbench, changedBuilt.archive);

    expect(prepared).toMatchObject({
      ok: true,
      preview: {
        machine: {
          kind: 'changed',
          changes: [
            {
              path: '/identity/controller/model',
              before: 'Controller model with a deliberately shared long prefix A',
              after: 'Controller model with a deliberately shared long prefix B'
            },
            {
              path: '/identity/controller/firmware',
              before: 'Local verified configuration',
              after: 'Updated firmware'
            }
          ]
        }
      }
    });
  });

  it('reports a serial-number-only physical identity change', async () => {
    const { built, committed } = await installedFixture();
    const source = await machinePackageFixture({ packageVersion: '2.0.0' });
    const serialNumber = 'CORRECTED-SERIAL-123';
    const changedBuilt = await buildMachinePackageArchive({
      ...source,
      document: {
        ...source.document,
        machine: {
          ...source.document.machine,
          identity: { ...source.document.machine.identity, serialNumber }
        }
      }
    });
    if (!changedBuilt.ok) throw new Error(JSON.stringify(changedBuilt.diagnostics));

    const prepared = await prepareStoredMachinePackageInstallation(committed.workbench, changedBuilt.archive);

    expect(prepared).toMatchObject({
      ok: true,
      preview: {
        machine: {
          kind: 'changed',
          changes: [{
            path: '/identity/serialNumber',
            before: built.package.document.machine.identity.serialNumber,
            after: serialNumber
          }]
        }
      }
    });
  });

  it('reinstalls identical content idempotently without duplicating the machine, post, or setup', async () => {
    const { adapter, built, committed } = await installedFixture();
    const prepared = await prepareStoredMachinePackageInstallation(committed.workbench, built.archive);
    expect(prepared).toMatchObject({
      ok: true,
      preview: { machine: { kind: 'exact' }, posts: [{ kind: 'already-installed' }] }
    });
    if (!prepared.ok) throw new Error(prepared.error.message);
    const writesBeforeCommit = adapter.writeCount;

    const repeated = await commitStoredMachinePackageInstallation(prepared.prepared, {
      kind: 'reuse-existing',
      machineId: 'shop.robofil-100',
      activate: 'keep-current'
    });

    expect(repeated).toMatchObject({
      ok: true,
      workbench: {
        machines: { machines: [{ bindings: [{ id: 'production' }] }] },
        posts: { installations: [{ ref: { version: '1.0.0' } }] }
      }
    });
    expect(adapter.files.has(MACHINE_LIBRARY_PATH)).toBe(true);
    expect(adapter.writeCount).toBe(writesBeforeCommit);
  });

  it('keeps an existing machine without an active setup inactive when requested', async () => {
    const { adapter, built } = await installedFixture();
    const stored = JSON.parse(adapter.files.get(MACHINE_LIBRARY_PATH) ?? '{}');
    stored.machines[0].activeBindingId = null;
    adapter.files.set(MACHINE_LIBRARY_PATH, JSON.stringify(stored, null, 2));
    const reopened = await initializeWorkbenchCatalog(adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const prepared = await prepareStoredMachinePackageInstallation(reopened.workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);

    const committed = await commitStoredMachinePackageInstallation(prepared.prepared, {
      kind: 'reuse-existing',
      machineId: 'shop.robofil-100',
      activate: 'keep-current'
    });

    expect(committed).toMatchObject({
      ok: true,
      workbench: { machines: { machines: [{ activeBindingId: null }] } }
    });
  });

  it('never auto-merges a similar machine with another stable ID', async () => {
    const { committed } = await installedFixture();
    const source = await machinePackageFixture({ packageVersion: '1.1.0' });
    const built = await buildMachinePackageArchive({
      ...source,
      document: {
        ...source.document,
        machine: {
          ...source.document.machine,
          id: 'shop.robofil-100.alias',
          name: 'Alias that must not replace the installed physical record'
        }
      }
    });
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));

    const prepared = await prepareStoredMachinePackageInstallation(committed.workbench, built.archive);

    expect(prepared).toMatchObject({
      ok: true,
      preview: {
        machine: { kind: 'possible', candidates: [{ id: 'shop.robofil-100' }] }
      }
    });
    if (!prepared.ok) throw new Error(prepared.error.message);
    const merged = await commitStoredMachinePackageInstallation(prepared.prepared, {
      kind: 'reuse-existing',
      machineId: 'shop.robofil-100',
      activate: 'package'
    });
    expect(merged).toMatchObject({
      ok: true,
      workbench: {
        machines: {
          machines: [{ id: 'shop.robofil-100', name: 'Shop Robofil 100' }]
        }
      }
    });
  });

  it('rejects explicit possible-match reuse when the incoming post targets another controller', async () => {
    const { committed } = await installedFixture();
    const built = await buildMachinePackageArchive(await machinePackageFixture({
      packageVersion: '2.0.0',
      postVersion: '2.0.0',
      bindingId: 'controller-b',
      machineId: 'shop.robofil-100.controller-b-alias',
      controllerModel: 'Controller B',
      firmware: 'Firmware B'
    }));
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(committed.workbench, built.archive);
    expect(prepared).toMatchObject({
      ok: true,
      preview: { machine: { kind: 'possible', candidates: [{ id: 'shop.robofil-100' }] } }
    });
    if (!prepared.ok) throw new Error(prepared.error.message);

    expect(await commitStoredMachinePackageInstallation(prepared.prepared, {
      kind: 'reuse-existing',
      machineId: 'shop.robofil-100',
      activate: 'package'
    })).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_PACKAGE_MERGED_MACHINE_INVALID' }
    });
  });

  it('rejects a merged machine when replacement physical data invalidates an existing verified setup', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const first = await machinePackageFixture();
    const firstSource = first.document.posts[0].sources[0];
    const firstMachine = {
      ...first.document.machine,
      evidence: [{
        id: 'machine.verified-program',
        name: 'Machine verification program',
        uri: firstSource.uri,
        contentSha256: firstSource.contentSha256
      }]
    };
    const verifiedBinding = {
      ...firstMachine.bindings[0],
      verification: {
        status: 'claimed' as const,
        verifiedAt: '2026-09-04T08:00:00.000Z',
        verifiedBy: 'Fixture verifier',
        machineDefinitionHash: await hashJson({
          format: firstMachine.format,
          schemaVersion: firstMachine.schemaVersion,
          id: firstMachine.id,
          name: firstMachine.name,
          identity: firstMachine.identity,
          limits: firstMachine.limits,
          hardware: firstMachine.hardware,
          evidence: firstMachine.evidence,
          notes: firstMachine.notes
        }),
        postContentHash: firstMachine.bindings[0].post.contentHash,
        propertiesHash: await hashJson(firstMachine.bindings[0].properties),
        evidenceRefs: [firstMachine.evidence[0].id],
        notes: 'Valid only for the original physical definition.'
      }
    };
    const firstBuilt = await buildMachinePackageArchive({
      ...first,
      document: {
        ...first.document,
        machine: { ...firstMachine, bindings: [verifiedBinding] }
      }
    });
    if (!firstBuilt.ok) throw new Error(JSON.stringify(firstBuilt.diagnostics));
    const firstPrepared = await prepareStoredMachinePackageInstallation(initialized.workbench, firstBuilt.archive);
    if (!firstPrepared.ok) throw new Error(firstPrepared.error.message);
    const firstCommitted = await commitStoredMachinePackageInstallation(firstPrepared.prepared, { kind: 'install-new' });
    if (!firstCommitted.ok) throw new Error(firstCommitted.error.message);

    const update = await machinePackageFixture({ packageVersion: '2.0.0', postVersion: '2.0.0', bindingId: 'production-v2' });
    const updateBuilt = await buildMachinePackageArchive({
      ...update,
      document: {
        ...update.document,
        machine: {
          ...update.document.machine,
          limits: {
            ...update.document.machine.limits,
            yTravel: { status: 'known', millimeters: 180 }
          }
        }
      }
    });
    if (!updateBuilt.ok) throw new Error(JSON.stringify(updateBuilt.diagnostics));
    const updatePrepared = await prepareStoredMachinePackageInstallation(firstCommitted.workbench, updateBuilt.archive);
    if (!updatePrepared.ok) throw new Error(updatePrepared.error.message);

    expect(await commitStoredMachinePackageInstallation(updatePrepared.prepared, {
      kind: 'replace-existing',
      machineId: firstMachine.id,
      activate: 'package'
    })).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_PACKAGE_MERGED_MACHINE_INVALID' }
    });
  });

  it('rejects changed post content that reuses an installed ID and version', async () => {
    const { committed } = await installedFixture();
    const source = await machinePackageFixture({ packageVersion: '1.1.0' });
    const originalPost = source.document.posts[0];
    const changedPost = {
      ...originalPost,
      manifest: { ...originalPost.manifest, description: 'Changed content without a post version change.' }
    };
    const changedInstallation = await installPostPackage(createEmptyPostLibrary(), changedPost);
    if (!changedInstallation.ok) throw new Error(changedInstallation.error.message);
    const changedMachine = {
      ...source.document.machine,
      bindings: source.document.machine.bindings.map((binding) => ({
        ...binding,
        post: changedInstallation.installation.ref
      }))
    };
    const built = await buildMachinePackageArchive({
      ...source,
      document: {
        ...source.document,
        machine: changedMachine,
        posts: [changedPost]
      }
    });
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));

    const prepared = await prepareStoredMachinePackageInstallation(committed.workbench, built.archive);

    expect(prepared).toMatchObject({
      ok: false,
      error: { code: 'POST_LIBRARY_VERSION_CONFLICT' }
    });
  });

  it('restores both exact catalogs when readback detects a corrupt machine write', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(initialized.workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const beforePosts = adapter.files.get(POST_LIBRARY_PATH);
    const beforeMachines = adapter.files.get(MACHINE_LIBRARY_PATH);
    adapter.corruptNextMachineWrite = true;

    const committed = await commitStoredMachinePackageInstallation(prepared.prepared, { kind: 'install-new' });

    expect(committed).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_PACKAGE_INSTALLATION_READBACK_MISMATCH' }
    });
    expect(adapter.files.get(POST_LIBRARY_PATH)).toBe(beforePosts);
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(beforeMachines);
  });

  it('restores both catalogs when the committed transaction journal cannot be removed', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(initialized.workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const beforePosts = adapter.files.get(POST_LIBRARY_PATH);
    const beforeMachines = adapter.files.get(MACHINE_LIBRARY_PATH);
    adapter.retainNextTransactionDelete = true;

    const committed = await commitStoredMachinePackageInstallation(
      prepared.prepared,
      { kind: 'install-new' }
    );

    expect(committed).toMatchObject({
      ok: false,
      error: { code: 'CATALOG_PAIR_TRANSACTION_READBACK_MISMATCH' }
    });
    expect(adapter.files.get(POST_LIBRARY_PATH)).toBe(beforePosts);
    expect(adapter.files.get(MACHINE_LIBRARY_PATH)).toBe(beforeMachines);
    expect(adapter.files.has(CATALOG_PAIR_TRANSACTION_PATH)).toBe(false);
  });

  it('retains recovery data when rollback writes do not read back exactly', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(initialized.workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    adapter.corruptNextMachineWrite = true;
    adapter.corruptPostRollbackAfterMachineFailure = true;

    const committed = await commitStoredMachinePackageInstallation(
      prepared.prepared,
      { kind: 'install-new' }
    );

    expect(committed).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_PACKAGE_INSTALLATION_ROLLBACK_FAILED' }
    });
    expect(adapter.files.has(CATALOG_PAIR_TRANSACTION_PATH)).toBe(true);
  });
});

async function installedFixture() {
  const adapter = new MemoryAdapter();
  const initialized = await initializeWorkbenchCatalog(adapter, {
    now: new Date('2026-09-04T08:00:00.000Z')
  });
  if (!initialized.ok) throw new Error(initialized.error.message);
  const built = await buildMachinePackageArchive(await machinePackageFixture());
  if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
  const prepared = await prepareStoredMachinePackageInstallation(initialized.workbench, built.archive);
  if (!prepared.ok) throw new Error(prepared.error.message);
  const committed = await commitStoredMachinePackageInstallation(prepared.prepared, { kind: 'install-new' });
  if (!committed.ok) throw new Error(committed.error.message);
  return { adapter, built, committed };
}

async function hashJson(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  corruptNextMachineWrite = false;
  corruptPostRollbackAfterMachineFailure = false;
  corruptNextPostWrite = false;
  retainNextTransactionDelete = false;
  writeCount = 0;
  constructor(readonly name = 'machine-package-installation') {}
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) {
    this.writeCount += 1;
    if (path === POST_LIBRARY_PATH && this.corruptNextPostWrite) {
      this.corruptNextPostWrite = false;
      this.files.set(path, `${contents}corrupt`);
      return;
    }
    if (path === MACHINE_LIBRARY_PATH && this.corruptNextMachineWrite) {
      this.corruptNextMachineWrite = false;
      this.corruptNextPostWrite = this.corruptPostRollbackAfterMachineFailure;
      this.files.set(path, `${contents}corrupt`);
      return;
    }
    this.files.set(path, contents);
  }
  async deleteText(path: string) {
    if (path === CATALOG_PAIR_TRANSACTION_PATH && this.retainNextTransactionDelete) {
      this.retainNextTransactionDelete = false;
      return;
    }
    this.files.delete(path);
  }
}
