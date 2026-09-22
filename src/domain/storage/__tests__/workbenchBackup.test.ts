import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import { createWorkbenchBackup, prepareWorkbenchBackup, restoreWorkbenchBackup, removeUnreferencedWorkbenchFiles } from '../workbenchBackup';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { addStoredWorkbenchProject, deleteStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { buildMachinePackageArchive } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import { prepareStoredMachinePackageInstallation, commitStoredMachinePackageInstallation } from '@/domain/machine-package/machinePackageInstallation';
import { createSavedWireEdmJobRevision, saveStoredWireEdmJobRevision } from '@/domain/wire-edm-job/savedWireEdmJobRevision';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

function storage(kind: 'cache' | 'folder'): WorkbenchStorageAdapter {
  return kind === 'cache' ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
    : createBrowserDirectoryAdapter(new FakeDirectoryHandle('backup') as unknown as FileSystemDirectoryHandle);
}
async function empty(adapter: WorkbenchStorageAdapter) {
  const opened = await initializeWorkbenchCatalog(adapter);
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.workbench;
}
async function fixture(adapter: WorkbenchStorageAdapter) {
  const workbench = await empty(adapter);
  const packageInput = await machinePackageFixture();
  const archive = await buildMachinePackageArchive({ ...packageInput, document: { ...packageInput.document,
    machine: { ...packageInput.document.machine, limits: { ...packageInput.document.machine.limits, yTravel: { status: 'known', millimeters: 150 } } }
  } });
  if (!archive.ok) throw new Error('Fixture archive invalid');
  const prepared = await prepareStoredMachinePackageInstallation(workbench, archive.archive);
  if (!prepared.ok) throw new Error(prepared.error.message);
  const installed = await commitStoredMachinePackageInstallation(prepared.prepared, { kind: 'install-new' });
  if (!installed.ok) throw new Error(installed.error.message);
  let document = createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }]);
  for (const operation of document.plan.operations) document = setManualCompensationIntent(document, operation.id, 'centerline') ?? document;
  document.setup = { initialWirePosition: { kind: 'manual', point: { x: 5, y: 0 }, review: 'reviewed' } };
  const project = createWorkbenchProjectDocument({ id: 'part', name: 'Saved part', now: new Date(), source: { kind: 'dxf', files: [] }, content: { kind: 'upid-document', document } });
  if (!project.ok) throw new Error(project.error.message);
  const added = await addStoredWorkbenchProject(installed.workbench, { project: project.project, ownedFiles: [] });
  if (!added.ok) throw new Error(added.error.message);
  const machine = added.workbench.machines.machines[0];
  const revision = await createSavedWireEdmJobRevision({ revisionId: 'revision.one', savedAt: new Date().toISOString(), project: project.project,
    machine, bindingId: machine.activeBindingId!, postLibrary: added.workbench.posts });
  if (!revision.ok) throw new Error(revision.error.message);
  const saved = await saveStoredWireEdmJobRevision(added.workbench, revision.candidate);
  if (!saved.ok) throw new Error(saved.error.message);
  const trashed = await deleteStoredWorkbenchProject(saved.workbench, { projectId: 'part', deletedAt: new Date() });
  if (!trashed.ok) throw new Error(trashed.error.message);
  await adapter.writeText('exports/old.iso', '%\r\nN10 M02\r\n');
  await adapter.writeText('legacy/v2/workbench.json', 'EXACT LEGACY BACKUP');
  return trashed.workbench;
}

describe.each(['cache', 'folder'] as const)('%s complete workbench backup', (kind) => {
  it('round-trips trash, exact packages, revisions, retained originals and controller line endings', async () => {
    const source = storage(kind);
    const workbench = await fixture(source);
    const backup = await createWorkbenchBackup(workbench);
    expect(backup.summary).toMatchObject({ projects: 0, trashedProjects: 1, machines: 1, posts: 1, revisions: 1 });
    const verified = await prepareWorkbenchBackup(backup.text);
    const target = storage(kind === 'cache' ? 'folder' : 'cache');
    await empty(target);
    await restoreWorkbenchBackup(target, verified);
    const paths = (await source.listFiles!()).paths;
    expect((await target.listFiles!()).paths).toEqual(paths);
    for (const path of paths) expect(await target.readText(path)).toBe(await source.readText(path));
    expect((await createWorkbenchBackup(await empty(target))).contentHash).toBe(backup.contentHash);
  });
  it('refuses restoring over existing data and rolls a failed restore back to its empty target', async () => {
    const source = storage(kind);
    const workbench = await fixture(source);
    const backup = await createWorkbenchBackup(workbench);
    await expect(restoreWorkbenchBackup(source, backup)).rejects.toThrow('empty workbench');
    const target = storage(kind);
    const before = await createWorkbenchBackup(await empty(target));
    const write = target.writeText.bind(target);
    let failed = false;
    vi.spyOn(target, 'writeText').mockImplementation(async (path, text) => {
      if (path === 'projects/part.json' && !failed) { failed = true; throw new Error('Disk full'); }
      return write(path, text);
    });
    await expect(restoreWorkbenchBackup(target, backup)).rejects.toThrow('Disk full');
    expect((await createWorkbenchBackup(await empty(target))).contentHash).toBe(before.contentHash);
  });
  it('requires current verified backup for cleanup and protects trash, revisions and legacy originals', async () => {
    const adapter = storage(kind);
    const workbench = await fixture(adapter);
    const backup = await createWorkbenchBackup(workbench);
    expect(backup.unreferencedPaths).toEqual(['exports/old.iso']);
    await expect(removeUnreferencedWorkbenchFiles(workbench, backup, ['projects/part.json'])).rejects.toThrow('explicitly selected');
    await adapter.writeText('exports/new.iso', 'NEW DATA');
    await expect(removeUnreferencedWorkbenchFiles(workbench, backup, ['exports/old.iso'])).rejects.toThrow('changed after backup');
    const current = await createWorkbenchBackup(workbench);
    await removeUnreferencedWorkbenchFiles(workbench, current, ['exports/old.iso']);
    expect(await adapter.readText('exports/old.iso')).toBeNull();
    expect(await adapter.readText('exports/new.iso')).toBe('NEW DATA');
    const recovery = storage(kind);
    await empty(recovery);
    await restoreWorkbenchBackup(recovery, await prepareWorkbenchBackup(current.text));
    expect(await recovery.readText('exports/old.iso')).toBe('%\r\nN10 M02\r\n');
  });
});

it('rejects tampered text, unsafe paths, duplicates and unsupported backup versions', async () => {
  const backup = await createWorkbenchBackup(await empty(storage('cache')));
  const original = JSON.parse(backup.text);
  for (const mutate of [
    (value: typeof original) => { value.files[0].text += 'CORRUPTED'; },
    (value: typeof original) => { value.files[0].path = '../outside'; },
    (value: typeof original) => { value.files.push(value.files[0]); },
    (value: typeof original) => { value.schemaVersion = 2; }
  ]) {
    const value = structuredClone(original); mutate(value);
    await expect(prepareWorkbenchBackup(JSON.stringify(value))).rejects.toThrow();
  }
});

it('does not recover or mutate pending journals while preparing a backup', async () => {
  const adapter = storage('cache');
  const workbench = await empty(adapter);
  await adapter.writeText('transactions/workbench-files.json', 'PRESERVE RECOVERY DATA');
  const write = vi.spyOn(adapter, 'writeText');
  const remove = vi.spyOn(adapter, 'deleteText');
  await expect(createWorkbenchBackup(workbench)).rejects.toThrow('Pending recovery');
  expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});

it('rejects incomplete inventories rather than presenting a partial backup as complete', async () => {
  const adapter = storage('cache');
  const workbench = await empty(adapter);
  vi.spyOn(adapter, 'listFiles').mockResolvedValue({ paths: ['workbench.json'], truncated: true });
  await expect(createWorkbenchBackup(workbench)).rejects.toThrow('incomplete');
});

it('preserves a UTF-8 BOM and rejects binary files instead of silently changing their bytes', async () => {
  const source = storage('folder');
  const workbench = await empty(source);
  await source.writeText('exports/bom.iso', '\uFEFF%\r\nM02\r\n');
  const backup = await createWorkbenchBackup(workbench);
  const target = storage('folder');
  await empty(target);
  await restoreWorkbenchBackup(target, backup);
  expect(await target.readExactText!('exports/bom.iso')).toBe('\uFEFF%\r\nM02\r\n');
  const fakeBinaryRoot = { name: 'binary', getFileHandle: async () => ({ getFile: async () => ({ arrayBuffer: async () => new Uint8Array([0xff, 0xfe]).buffer }) }) } as unknown as FileSystemDirectoryHandle;
  await expect(createBrowserDirectoryAdapter(fakeBinaryRoot).readExactText!('binary.bin')).rejects.toThrow('exact UTF-8');
});

it.each(['cache', 'folder'] as const)('preserves a compressed-size BOM-prefixed original when backing up %s and restoring to the other adapter', async (kind) => {
  const source = storage(kind);
  const workbench = await empty(source);
  const original = `\uFEFF${'G1 X1.25 Y2.5 (Oțel ⚙)\r\n'.repeat(2000)}`;
  await source.writeText('imports/original.nc', original);
  const backup = await createWorkbenchBackup(workbench);
  expect(JSON.parse(backup.text).files.find((file: { path: string }) => file.path === 'imports/original.nc').text)
    .toBe(original);
  const target = storage(kind === 'cache' ? 'folder' : 'cache');
  await empty(target);
  await restoreWorkbenchBackup(target, await prepareWorkbenchBackup(backup.text));
  expect(await target.readExactText!('imports/original.nc')).toBe(original);
  expect((await createWorkbenchBackup(await empty(target))).contentHash).toBe(backup.contentHash);
});
