import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';
import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';

import {
  initializeWorkbenchCatalog,
  WORKBENCH_CATALOG_PATH
} from '../workbenchCatalog';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

  constructor(
    readonly name = 'catalog-test',
    private failCatalogWriteOnce = false
  ) {}
  async ensureDirectory(path: string) { this.directories.add(path); }
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) {
    if (path === WORKBENCH_CATALOG_PATH && this.failCatalogWriteOnce) {
      this.failCatalogWriteOnce = false;
      throw new Error('catalog write denied');
    }
    this.files.set(path, contents);
  }
  async deleteText(path: string) { this.files.delete(path); }
}

describe('clean-break workbench catalog', () => {
  it('creates explicit empty state without a default machine, post, or export configuration', async () => {
    const adapter = new MemoryAdapter('Shop workbench');

    const result = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: true,
      kind: 'created',
      workbench: {
        manifest: {
          format: 'wire-edm-workbench',
          schemaVersion: 2,
          name: 'Shop workbench',
          preferences: {
            importUnits: { mode: 'ask' },
            export: { status: 'unconfigured' },
            recentPlanningMachineId: null
          },
          projects: []
        },
        posts: { installations: [] },
        machines: { machines: [] }
      }
    });
    expect(adapter.files.has(POST_LIBRARY_PATH)).toBe(true);
    expect(adapter.files.has(MACHINE_LIBRARY_PATH)).toBe(true);
    expect(JSON.parse(adapter.files.get(WORKBENCH_CATALOG_PATH) ?? '')).toMatchObject({
      schemaVersion: 2
    });
  });

  it('rejects a version-1 manifest without rewriting or creating companion libraries', async () => {
    const adapter = new MemoryAdapter();
    const original = JSON.stringify({ schemaVersion: 1, machineProfiles: [] });
    adapter.files.set(WORKBENCH_CATALOG_PATH, original);

    expect(await initializeWorkbenchCatalog(adapter)).toEqual({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_VERSION_UNSUPPORTED',
        message: 'Workbench schema version 1 is unsupported. Create a new version-2 workbench.',
        foundVersion: 1,
        supportedVersion: 2
      }
    });
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(original);
    expect(adapter.files.has(POST_LIBRARY_PATH)).toBe(false);
    expect(adapter.files.has(MACHINE_LIBRARY_PATH)).toBe(false);
  });

  it('rejects a remembered planning machine that does not exist instead of selecting another', async () => {
    const adapter = new MemoryAdapter();
    const created = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!created.ok) throw new Error(created.error.message);
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify({
      ...created.workbench.manifest,
      preferences: {
        ...created.workbench.manifest.preferences,
        recentPlanningMachineId: 'missing.machine'
      }
    }));

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_MACHINE_NOT_FOUND',
        path: '/preferences/recentPlanningMachineId',
        machineId: 'missing.machine'
      }
    });
  });

  it('rolls back companion files when initial manifest creation fails', async () => {
    const adapter = new MemoryAdapter('catalog-test', true);

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_ACCESS_FAILED', operation: 'write' }
    });
    expect(adapter.files.has(POST_LIBRARY_PATH)).toBe(false);
    expect(adapter.files.has(MACHINE_LIBRARY_PATH)).toBe(false);
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: true, kind: 'created' });
  });
});
