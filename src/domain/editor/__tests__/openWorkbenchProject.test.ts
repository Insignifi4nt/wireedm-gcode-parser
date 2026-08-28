import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { importExternalProgram } from '../importExternalProgram';
import { openWorkbenchProject } from '../openWorkbenchProject';

describe('openWorkbenchProject', () => {
  it('opens a strict project by ID and returns its loaded editor program', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const imported = await importExternalProgram(initialized.workbench, {
      fileName: 'fixture.nc',
      text: ['%', 'G0 X0 Y0', 'M02'].join('\n')
    });
    if (!imported.ok) throw new Error(imported.error.message);

    expect(await openWorkbenchProject(imported.workbench, imported.project.id)).toMatchObject({
      ok: true,
      project: imported.project,
      editorProgram: { model: 'gcode-text', text: 'G0 X0 Y0' }
    });
    expect(await openWorkbenchProject(imported.workbench, 'projects/fixture.nc')).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_PROJECT_NOT_FOUND' }
    });
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'Editor open';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}
