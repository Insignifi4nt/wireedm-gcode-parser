import { describe, expect, it } from 'vitest';

import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

import { renameWorkbenchProject } from '../renameWorkbenchProject';

describe('renameWorkbenchProject', () => {
  it('atomically replaces the strict V2 project and catalog entry by project ID', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const imported = await importExternalProgram(initialized.workbench, {
      fileName: 'fixture.iso',
      text: 'G0 X0 Y0',
      now: new Date('2026-08-28T09:00:00.000Z')
    });
    if (!imported.ok) throw new Error(imported.error.message);

    const renamed = await renameWorkbenchProject(imported.workbench, {
      projectId: imported.project.id,
      name: '  Production fixture  ',
      now: new Date('2026-08-28T10:00:00.000Z')
    });
    expect(renamed).toMatchObject({
      ok: true,
      project: {
        format: 'wire-edm-project',
        schemaVersion: 2,
        name: 'Production fixture',
        updatedAt: '2026-08-28T10:00:00.000Z'
      },
      workbench: {
        manifest: { projects: [{ name: 'Production fixture' }] }
      }
    });
  });

  it.each(['  ', 'x'.repeat(161), 'Part\n2', 'Part\t2', 'Part\u00002', 'Part\u20282'])(
    'rejects invalid name %j without writing storage', async (name) => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);

    const before = [...adapter.files];
    expect(await renameWorkbenchProject(initialized.workbench, {
      projectId: 'missing',
      name
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_PROJECT_NAME_INVALID' }
    });
    expect([...adapter.files]).toEqual(before);
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'Rename project';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}
