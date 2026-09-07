import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { importExternalProgram } from '../importExternalProgram';

describe('importExternalProgram', () => {
  it('preserves offset-control command arguments in both original and editable files', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const text = 'N10G92.1\nN20G92.2\nN30G92.3';
    const imported = await importExternalProgram(initialized.workbench, { fileName: 'offsets.nc', text });
    if (!imported.ok) throw new Error(imported.error.message);
    const [original, editable] = imported.project.source.files;
    expect(adapter.files.get(original.path)).toBe(text);
    expect(adapter.files.get(editable.path)).toBe('G92.1\nG92.2\nG92.3');
  });

  it('stores original and cleaned text as explicit V2 project-owned files', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const original = ['%', 'N10G92', 'N20G01X1Y2', 'N30M02'].join('\n');

    const imported = await importExternalProgram(initialized.workbench, {
      fileName: 'numbered.iso',
      text: original,
      now: new Date('2026-08-28T09:00:00.000Z')
    });
    if (!imported.ok) throw new Error(imported.error.message);

    expect(imported.project).toMatchObject({
      format: 'wire-edm-project',
      schemaVersion: 2,
      source: { kind: 'external-gcode', files: [{ kind: 'external-gcode' }, { kind: 'external-gcode' }] },
      content: { kind: 'external-gcode' }
    });
    expect('machine' in imported.project).toBe(false);
    if (imported.project.content.kind !== 'external-gcode') throw new Error('Expected external project.');
    const [originalFile, editableFile] = imported.project.source.files;
    expect(adapter.files.get(originalFile.path)).toBe(original);
    expect(adapter.files.get(editableFile.path)).toBe(
      ['G92 X0.000 Y0.000', 'G1X1Y2'].join('\n')
    );
    expect(imported.project.content.activeFilePath).toBe(editableFile.path);
    expect(imported.editorProgram).toMatchObject({
      model: 'gcode-text',
      filePath: editableFile.path,
      text: ['G92 X0.000 Y0.000', 'G1X1Y2'].join('\n')
    });
  });

  it('returns typed validation errors before writing project state', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);

    expect(await importExternalProgram(initialized.workbench, {
      fileName: 'part.tap',
      text: 'G0 X0 Y0'
    })).toMatchObject({
      ok: false,
      error: { code: 'EXTERNAL_PROGRAM_EXTENSION_UNSUPPORTED' }
    });
    expect(await importExternalProgram(initialized.workbench, {
      fileName: 'empty.iso',
      text: ''
    })).toMatchObject({
      ok: false,
      error: { code: 'EXTERNAL_PROGRAM_EMPTY' }
    });
    expect([...adapter.files.keys()].filter((path) => path.startsWith('projects/'))).toEqual([]);
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'External import';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}
