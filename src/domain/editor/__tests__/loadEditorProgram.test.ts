import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { importDxfProject } from '@/domain/dxf/importDxfProject';

import { importExternalProgram } from '../importExternalProgram';
import { loadEditorProgram } from '../loadEditorProgram';

describe('loadEditorProgram', () => {
  it('loads UPID or cleaned external content through a catalog project ID', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const dxf = await importDxfProject(initialized.workbench, {
      fileName: 'path.dxf',
      text: lineDxf(),
      unitCandidateId: 'millimeters',
      declaredUnitOverrideAcknowledged: false
    });
    if (!dxf.ok) throw new Error(dxf.error.message);
    const upid = await loadEditorProgram(dxf.workbench, dxf.project.id);
    expect(upid).toMatchObject({
      ok: true,
      editorProgram: {
        model: 'upid-document',
        filePath: `projects/${dxf.project.id}.json`,
        project: { id: dxf.project.id }
      }
    });

    const external = await importExternalProgram(dxf.workbench, {
      fileName: 'program.iso',
      text: ['%', 'G0 X0 Y0', 'M02'].join('\n')
    });
    if (!external.ok) throw new Error(external.error.message);
    if (external.project.content.kind !== 'external-gcode') throw new Error('Expected external project.');
    expect(await loadEditorProgram(external.workbench, external.project.id)).toMatchObject({
      ok: true,
      editorProgram: {
        model: 'gcode-text',
        filePath: external.project.content.activeFilePath,
        text: 'G0 X0 Y0'
      }
    });
  });

  it('returns the catalog not-found error for an unknown project ID', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);

    expect(await loadEditorProgram(initialized.workbench, 'missing')).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_PROJECT_NOT_FOUND', projectId: 'missing' }
    });
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'Editor load';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}

function lineDxf() {
  return [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4',
    '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'CUT', '10', '0', '20', '0', '11', '1', '21', '0',
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}
