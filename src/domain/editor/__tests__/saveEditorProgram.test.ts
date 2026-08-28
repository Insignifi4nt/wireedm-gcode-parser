import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { importExternalProgram } from '../importExternalProgram';
import { saveEditorProgram } from '../saveEditorProgram';

describe('saveEditorProgram', () => {
  it('replaces only the catalog-owned editable external file and strict project document', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const originalText = ['%', 'G0 X0 Y0', 'M02'].join('\n');
    const imported = await importExternalProgram(initialized.workbench, {
      fileName: 'fixture.iso',
      text: originalText,
      now: new Date('2026-08-28T09:00:00.000Z')
    });
    if (!imported.ok) throw new Error(imported.error.message);

    const saved = await saveEditorProgram(imported.workbench, {
      projectId: imported.project.id,
      draft: { model: 'gcode-text', text: 'G0 X2 Y3' },
      now: new Date('2026-08-28T10:00:00.000Z')
    });
    if (!saved.ok) throw new Error(saved.error.message);

    const [originalFile, editableFile] = saved.project.source.files;
    expect(adapter.files.get(originalFile.path)).toBe(originalText);
    expect(adapter.files.get(editableFile.path)).toBe('G0 X2 Y3');
    expect(saved.project.updatedAt).toBe('2026-08-28T10:00:00.000Z');
    expect(saved.editorProgram).toMatchObject({ model: 'gcode-text', text: 'G0 X2 Y3' });
  });

  it('replaces a UPID document without accepting machine or post draft state', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const imported = await importDxfProject(initialized.workbench, {
      fileName: 'path.dxf',
      text: lineDxf(),
      unitCandidateId: 'millimeters',
      declaredUnitOverrideAcknowledged: false
    });
    if (!imported.ok) throw new Error(imported.error.message);
    const document = structuredClone(imported.pathDocument);
    document.setup = {
      initialWirePosition: {
        kind: 'manual',
        point: { x: -1, y: 0 },
        review: 'reviewed'
      }
    };

    const saved = await saveEditorProgram(imported.workbench, {
      projectId: imported.project.id,
      draft: { model: 'upid-document', pathDocument: document }
    });
    expect(saved).toMatchObject({
      ok: true,
      project: {
        content: {
          kind: 'upid-document',
          document: { setup: document.setup }
        }
      },
      editorProgram: { model: 'upid-document' }
    });
    if (saved.ok) {
      expect('machine' in saved.project).toBe(false);
      expect('post' in saved.project).toBe(false);
    }

    if (!saved.ok) throw new Error(saved.error.message);
    expect(await saveEditorProgram(saved.workbench, {
      projectId: imported.project.id,
      draft: { model: 'gcode-text', text: 'G0 X0' }
    })).toMatchObject({
      ok: false,
      error: { code: 'EDITOR_SAVE_MODEL_MISMATCH' }
    });
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'Editor save';
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
