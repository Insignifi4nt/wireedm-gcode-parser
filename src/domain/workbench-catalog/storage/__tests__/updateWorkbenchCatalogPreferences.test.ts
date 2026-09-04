import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
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
    this.corruptNextManifestWrite = false;
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

  it('restores the exact manifest bytes when storage corrupts the preference write', async () => {
    const { adapter, workbench } = await connectedCatalog();
    const before = adapter.files.get(WORKBENCH_CATALOG_PATH);
    adapter.corruptNextManifestWrite = true;

    const result = await updateWorkbenchCatalogPreferences(workbench, {
      preferences: configuredPreferences,
      updatedAt: new Date('2026-08-28T13:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_PREFERENCES_READBACK_MISMATCH' }
    });
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(before);
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

async function connectedCatalog() {
  const adapter = new MemoryAdapter();
  const initialized = await initializeWorkbenchCatalog(adapter, {
    now: new Date('2026-08-28T12:00:00.000Z')
  });
  if (!initialized.ok) throw new Error(initialized.error.message);
  return { adapter, workbench: initialized.workbench };
}
