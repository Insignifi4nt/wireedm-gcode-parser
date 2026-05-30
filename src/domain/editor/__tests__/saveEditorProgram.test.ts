import { describe, expect, it } from 'vitest';

import {
  initializeWorkbenchDirectory,
  type WorkbenchStorageAdapter
} from '@/domain/storage/workbenchStorage';

import { importExternalProgram } from '../importExternalProgram';
import { saveEditorProgram } from '../saveEditorProgram';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  constructor(readonly name = 'cache-workbench') {}

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.files.set(path, contents);
  }
}

describe('saveEditorProgram', () => {
  it('overwrites an existing editor file and returns a fresh parse result', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importExternalProgram(workbench, {
      fileName: 'fixture.nc',
      text: ['%', 'G90 G21', 'G0 X0 Y0', 'G1 X5 Y0', 'M30', '%'].join('\n'),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const updatedText = [
      '%',
      'G90 G21',
      'G0 X0 Y0',
      'G1 X12 Y4',
      'G2 X16 Y4 I2 J0',
      'M30',
      '%'
    ].join('\n');

    const saved = await saveEditorProgram(imported.workbench, {
      filePath: imported.editorProgram.filePath,
      text: updatedText
    });

    expect(adapter.files.get(imported.editorProgram.filePath)).toBe(updatedText);
    expect(saved).toMatchObject({
      filePath: imported.editorProgram.filePath,
      text: updatedText
    });
    expect(saved.parseResult.stats.linearMoves).toBe(2);
    expect(saved.parseResult.stats.arcMoves).toBe(1);
    expect(saved.parseResult.path.at(1)).toMatchObject({
      type: 'cut',
      x: 12,
      y: 4,
      line: 4
    });
  });

  it('rejects saves to files that are not already part of the workbench', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    await expect(
      saveEditorProgram(workbench, {
        filePath: 'imports/missing.nc',
        text: 'G0 X0 Y0'
      })
    ).rejects.toThrow('Editor program file not found: imports/missing.nc');
    expect(adapter.files.has('imports/missing.nc')).toBe(false);
  });
});
