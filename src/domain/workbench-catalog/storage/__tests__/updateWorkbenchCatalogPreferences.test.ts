import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { recoverWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import { buildMachinePackageArchive, commitStoredMachinePackageInstallation, prepareStoredMachinePackageInstallation } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import { removeStoredMachineDefinition } from '@/domain/machine-definition/machineLibraryMutations';
import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';
import {
  initializeWorkbenchCatalog,
  WORKBENCH_CATALOG_PATH
} from '../../workbenchCatalog';
import { updateWorkbenchCatalogPreferences } from '../updateWorkbenchCatalogPreferences';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  corruptNextManifestWrite = false;

  constructor(readonly name = 'preference-test') {}

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.files.set(
      path,
      path === WORKBENCH_CATALOG_PATH && this.corruptNextManifestWrite
        ? `${contents}corrupt`
        : contents
    );
    if (path === WORKBENCH_CATALOG_PATH) this.corruptNextManifestWrite = false;
  }

  async deleteText(path: string) {
    this.files.delete(path);
  }
}

const configuredPreferences = {
  importUnits: { mode: 'fixed', unit: 'inches' },
  recentPlanningMachineId: null
} as const;

describe('updateWorkbenchCatalogPreferences', () => {
  it('atomically replaces every explicit workbench preference and returns a new catalog snapshot', async () => {
    const { adapter, workbench } = await connectedCatalog();

    const result = await updateWorkbenchCatalogPreferences(workbench, {
      preferences: configuredPreferences,
      updatedAt: new Date('2026-08-28T13:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: true,
      workbench: {
        manifest: {
          updatedAt: '2026-08-28T13:00:00.000Z',
          preferences: configuredPreferences
        }
      }
    });
    expect(workbench.manifest.preferences).toEqual({
      importUnits: { mode: 'ask' },
      recentPlanningMachineId: null
    });
    expect(JSON.parse(adapter.files.get(WORKBENCH_CATALOG_PATH) ?? '')).toMatchObject({
      updatedAt: '2026-08-28T13:00:00.000Z',
      preferences: configuredPreferences
    });
  });

  it('rejects an unknown recent planning machine without clearing or replacing it', async () => {
    const { adapter, workbench } = await connectedCatalog();
    const before = adapter.files.get(WORKBENCH_CATALOG_PATH);

    const result = await updateWorkbenchCatalogPreferences(workbench, {
      preferences: {
        ...configuredPreferences,
        recentPlanningMachineId: 'missing.machine'
      },
      updatedAt: new Date('2026-08-28T13:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_MACHINE_NOT_FOUND',
        path: '/preferences/recentPlanningMachineId',
        machineId: 'missing.machine'
      }
    });
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(before);
  });

  it('rejects a stale catalog snapshot without overwriting the current manifest', async () => {
    const { adapter, workbench } = await connectedCatalog();
    const externallyUpdated = JSON.stringify({
      ...workbench.manifest,
      updatedAt: '2026-08-28T12:30:00.000Z'
    });
    adapter.files.set(WORKBENCH_CATALOG_PATH, externallyUpdated);

    const result = await updateWorkbenchCatalogPreferences(workbench, {
      preferences: configuredPreferences,
      updatedAt: new Date('2026-08-28T13:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_PREFERENCES_MANIFEST_STALE' }
    });
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(externallyUpdated);
  });

  it('returns catalog corruption as a typed hard error without rewriting it', async () => {
    const { adapter, workbench } = await connectedCatalog();
    adapter.files.set(WORKBENCH_CATALOG_PATH, '{broken');

    const result = await updateWorkbenchCatalogPreferences(workbench, {
      preferences: configuredPreferences,
      updatedAt: new Date('2026-08-28T13:00:00.000Z')
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_JSON_INVALID',
        message: 'Workbench manifest is not valid JSON.'
      }
    });
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe('{broken');
  });

  it('detects corrupted preference readback and retains the unknown bytes and journal', async () => {
    const { adapter, workbench } = await connectedCatalog();
    const before = adapter.files.get(WORKBENCH_CATALOG_PATH);
    adapter.corruptNextManifestWrite = true;

    const result = await updateWorkbenchCatalogPreferences(workbench, {
      preferences: configuredPreferences,
      updatedAt: new Date('2026-08-28T13:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_PREFERENCES_ACCESS_FAILED',
        message: expect.stringContaining('Recovery data is retained') }
    });
    const journal = JSON.parse(adapter.files.get(WORKBENCH_FILE_TRANSACTION_PATH)!);
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(`${journal.files[0].next}corrupt`);
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).not.toBe(before);
    await expect(recoverWorkbenchFileTransaction(adapter)).rejects.toThrow('changed outside');
  });

  it('serializes concurrent mutations so only the current snapshot can commit', async () => {
    const { adapter, workbench } = await connectedCatalog();

    const [first, second] = await Promise.all([
      updateWorkbenchCatalogPreferences(workbench, {
        preferences: configuredPreferences,
        updatedAt: new Date('2026-08-28T13:00:00.000Z')
      }),
      updateWorkbenchCatalogPreferences(workbench, {
        preferences: {
          importUnits: { mode: 'ask' },
          recentPlanningMachineId: null
        },
        updatedAt: new Date('2026-08-28T14:00:00.000Z')
      })
    ]);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_PREFERENCES_MANIFEST_STALE' }
    });
    expect(JSON.parse(adapter.files.get(WORKBENCH_CATALOG_PATH) ?? '')).toMatchObject({
      updatedAt: '2026-08-28T13:00:00.000Z',
      preferences: configuredPreferences
    });
  });
});

describe.each(['cache', 'folder'] as const)('%s preference rollback integrity', (kind) => {
  async function fixture() {
    const adapter = kind === 'cache'
      ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('preference-rollback') as unknown as FileSystemDirectoryHandle);
    const opened = await initializeWorkbenchCatalog(adapter);
    if (!opened.ok) throw new Error(opened.error.message);
    return { adapter, workbench: opened.workbench };
  }

  it('blocks rollback before it overwrites unknown preference readback bytes', async () => {
    const { adapter, workbench } = await fixture();
    const write = adapter.writeText.bind(adapter);
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation((path, contents) => write(path,
      path === WORKBENCH_CATALOG_PATH ? `${contents}CORRUPTED` : contents));

    const result = await updateWorkbenchCatalogPreferences(workbench, {
      preferences: configuredPreferences, updatedAt: new Date('2026-08-28T13:00:00.000Z')
    });
    expect(result).toMatchObject({ ok: false, error: {
      code: 'WORKBENCH_CATALOG_PREFERENCES_ACCESS_FAILED',
      message: expect.stringContaining('Recovery data is retained')
    } });
    // The former overwrite expectation contradicted the preserve-data invariant.
    const journal = JSON.parse((await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH))!);
    expect(await adapter.readExactText!(WORKBENCH_CATALOG_PATH)).toBe(`${journal.files[0].next}CORRUPTED`);
    expect(writes.mock.calls.filter(([path]) => path === WORKBENCH_CATALOG_PATH)).toHaveLength(1);
    await expect(recoverWorkbenchFileTransaction(adapter)).rejects.toThrow('changed outside');
  });

  it('restores the exact original manifest, including a folder UTF-8 BOM, after a rejected write', async () => {
    const { adapter, workbench } = await fixture();
    const original = `${kind === 'folder' ? '\uFEFF' : ''}${JSON.stringify(workbench.manifest, null, '\t')}\r\n`;
    await adapter.writeText(WORKBENCH_CATALOG_PATH, original);
    const write = adapter.writeText.bind(adapter);
    let failed = false;
    vi.spyOn(adapter, 'writeText').mockImplementation((path, contents) => {
      if (path === WORKBENCH_CATALOG_PATH && !failed) {
        failed = true;
        throw new Error('Transient manifest write failure');
      }
      return write(path, contents);
    });

    const result = await updateWorkbenchCatalogPreferences(workbench, {
      preferences: configuredPreferences, updatedAt: new Date('2026-08-28T13:00:00.000Z')
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'WORKBENCH_CATALOG_PREFERENCES_ACCESS_FAILED' } });
    expect(await (adapter.readExactText?.(WORKBENCH_CATALOG_PATH) ?? adapter.readText(WORKBENCH_CATALOG_PATH))).toBe(original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });

  it('rejects a removed machine from another tab and returns current libraries on a valid preference save', async () => {
    const { adapter, workbench } = await fixture();
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const installed = await commitStoredMachinePackageInstallation(prepared.prepared, { kind: 'install-new' });
    if (!installed.ok) throw new Error(installed.error.message);
    expect(await removeStoredMachineDefinition(installed.workbench, 'shop.robofil-100')).toMatchObject({ ok: true });
    const unchanged = await Promise.all([WORKBENCH_CATALOG_PATH, POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH].map(path => adapter.readExactText!(path)));
    const input = { preferences: { ...configuredPreferences, recentPlanningMachineId: 'shop.robofil-100' }, updatedAt: new Date('2026-08-28T13:00:00.000Z') };
    expect(await updateWorkbenchCatalogPreferences(installed.workbench, input)).toMatchObject({ ok: false,
      error: { code: 'WORKBENCH_CATALOG_MACHINE_NOT_FOUND', machineId: 'shop.robofil-100' } });
    expect(await Promise.all([WORKBENCH_CATALOG_PATH, POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH].map(path => adapter.readExactText!(path)))).toEqual(unchanged);
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: true });
    const valid = await updateWorkbenchCatalogPreferences(installed.workbench, { ...input, preferences: configuredPreferences });
    expect(valid).toMatchObject({ ok: true, workbench: { machines: { machines: [] }, posts: { installations: [{ ref: expect.any(Object) }] } } });
    expect(await adapter.readExactText!(POST_LIBRARY_PATH)).toBe(unchanged[1]);
    expect(await adapter.readExactText!(MACHINE_LIBRARY_PATH)).toBe(unchanged[2]);
  });

  it('recovers an interrupted preference write and rollback with exact originals before retrying', async () => {
    const { adapter, workbench } = await fixture();
    const original = `${kind === 'folder' ? '\uFEFF' : ''}${JSON.stringify(workbench.manifest, null, '\t')}\r\n`;
    await adapter.writeText(WORKBENCH_CATALOG_PATH, original);
    const write = adapter.writeText.bind(adapter);
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation((path, text) => {
      if (path === WORKBENCH_CATALOG_PATH) throw new Error('Manifest access interrupted');
      return write(path, text);
    });
    const input = { preferences: configuredPreferences, updatedAt: new Date('2026-08-28T13:00:00.000Z') };
    expect(await updateWorkbenchCatalogPreferences(workbench, input)).toMatchObject({ ok: false });
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
    writes.mockRestore();
    await recoverWorkbenchFileTransaction(adapter);
    expect(await adapter.readExactText!(WORKBENCH_CATALOG_PATH)).toBe(original);
    expect(await updateWorkbenchCatalogPreferences(workbench, input)).toMatchObject({ ok: true });
  });

  it('rejects full journal storage before changing preference or library files', async () => {
    const { adapter, workbench } = await fixture();
    const paths = [WORKBENCH_CATALOG_PATH, POST_LIBRARY_PATH, MACHINE_LIBRARY_PATH];
    const original = await Promise.all(paths.map(path => adapter.readExactText!(path)));
    const write = adapter.writeText.bind(adapter);
    const writes = vi.spyOn(adapter, 'writeText').mockImplementation((path, text) => {
      if (path === WORKBENCH_FILE_TRANSACTION_PATH) throw new DOMException('Full storage', 'QuotaExceededError');
      return write(path, text);
    });
    expect(await updateWorkbenchCatalogPreferences(workbench, { preferences: configuredPreferences, updatedAt: new Date() })).toMatchObject({ ok: false });
    expect(await Promise.all(paths.map(path => adapter.readExactText!(path)))).toEqual(original);
    expect(writes.mock.calls.some(([path]) => paths.includes(path))).toBe(false);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
});

async function connectedCatalog() {
  const adapter = new MemoryAdapter();
  const initialized = await initializeWorkbenchCatalog(adapter, {
    now: new Date('2026-08-28T12:00:00.000Z')
  });
  if (!initialized.ok) throw new Error(initialized.error.message);
  return { adapter, workbench: initialized.workbench };
}
