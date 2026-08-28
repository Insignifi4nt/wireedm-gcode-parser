import { describe, expect, it } from 'vitest';

import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

import { deleteWorkbenchProject } from '../deleteWorkbenchProject';

describe('deleteWorkbenchProject', () => {
  it('atomically deletes the V2 project document and every catalog-owned source file', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const imported = await importExternalProgram(initialized.workbench, {
      fileName: 'fixture.iso',
      text: ['%', 'G0 X0 Y0', 'M02'].join('\n')
    });
    if (!imported.ok) throw new Error(imported.error.message);
    const ownedPaths = imported.project.source.files.map(({ path }) => path);

    const deleted = await deleteWorkbenchProject(imported.workbench, {
      projectId: imported.project.id,
      now: new Date('2026-08-28T10:00:00.000Z')
    });
    expect(deleted).toMatchObject({
      ok: true,
      deleted: { id: imported.project.id },
      workbench: { manifest: { projects: [] } }
    });
    expect(adapter.files.has(`projects/${imported.project.id}.json`)).toBe(false);
    ownedPaths.forEach((path) => expect(adapter.files.has(path)).toBe(false));
  });

  it('returns a typed catalog error for an unknown project ID', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);

    expect(await deleteWorkbenchProject(initialized.workbench, {
      projectId: 'missing'
    })).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_PROJECT_NOT_FOUND', projectId: 'missing' }
    });
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'Delete project';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}
