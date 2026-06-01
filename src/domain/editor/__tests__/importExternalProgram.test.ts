import { describe, expect, it } from 'vitest';

import { initializeWorkbenchDirectory, type WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';

import { importExternalProgram } from '../importExternalProgram';

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

describe('importExternalProgram', () => {
  it('imports .gcode/.nc/.iso/.txt program text as an editor project', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    const result = await importExternalProgram(workbench, {
      fileName: 'shop-output.nc',
      text: ['%', 'G90 G21', 'G0 X0 Y0', 'G1 X5 Y0', 'M30', '%'].join('\n'),
      byteLength: 48,
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    expect(result.project).toMatchObject({
      id: 'shop-output-2026-05-29',
      name: 'shop-output',
      source: {
        kind: 'external-gcode'
      },
      editor: {
        activeFilePath: 'editor/shop-output-2026-05-29.nc'
      }
    });
    expect('sourceRequiresCleanup' in result.project.editor).toBe(false);
    expect(result.editorProgram.filePath).toBe('editor/shop-output-2026-05-29.nc');
    expect(result.editorProgram.model).toBe('gcode-text');
    expect(result.editorProgram.parseResult).not.toBeNull();
    expect(result.editorProgram.parseResult?.path).toHaveLength(2);
    expect(adapter.files.get('imports/shop-output-2026-05-29.nc')).toContain('G1 X5 Y0');
    expect(adapter.files.get('editor/shop-output-2026-05-29.nc')).toBe(
      ['G90 G21', 'G0 X0 Y0', 'G1 X5 Y0', 'M30'].join('\n')
    );
    expect(JSON.parse(adapter.files.get('projects/shop-output-2026-05-29/project.json') || '{}')).toEqual(
      result.project
    );
    expect(result.workbench.manifest.projects).toEqual([
      {
        id: 'shop-output-2026-05-29',
        name: 'shop-output',
        path: 'projects/shop-output-2026-05-29/project.json',
        sourceKind: 'external-gcode',
        updatedAt: '2026-05-29T11:00:00.000Z'
      }
    ]);
  });

  it.each(['part.gcode', 'part.nc', 'part.iso', 'part.txt'])(
    'accepts %s as an editor import',
    async (fileName) => {
      const adapter = new MemoryWorkbenchAdapter();
      const workbench = await initializeWorkbenchDirectory(adapter, {
        now: new Date('2026-05-29T10:00:00.000Z')
      });

      await expect(
        importExternalProgram(workbench, {
          fileName,
          text: 'G0 X0 Y0',
          byteLength: 8,
          now: new Date('2026-05-29T11:00:00.000Z')
        })
      ).resolves.toMatchObject({
        project: {
          source: {
            kind: 'external-gcode'
          }
        }
      });
    }
  );

  it('rejects unsupported extensions and oversized files before writing workbench state', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    await expect(
      importExternalProgram(workbench, {
        fileName: 'part.tap',
        text: 'G0 X0 Y0',
        byteLength: 8
      })
    ).rejects.toThrow('Unsupported editor file type.');

    await expect(
      importExternalProgram(workbench, {
        fileName: 'huge.nc',
        text: 'G0 X0 Y0',
        byteLength: 50 * 1024 * 1024 + 1
      })
    ).rejects.toThrow('File too large');

    await expect(
      importExternalProgram(workbench, {
        fileName: 'empty.nc',
        text: '',
        byteLength: 0
      })
    ).rejects.toThrow('File is empty');

    const manifest = JSON.parse(adapter.files.get('workbench.json') || '{}');
    expect(manifest.projects).toEqual([]);
  });

  it('keeps the raw external file and opens a stripped editor copy', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const rawText = ['%', 'N10G92', 'N20G01X1Y2', 'N30M02'].join('\n');

    const result = await importExternalProgram(workbench, {
      fileName: 'numbered.iso',
      text: rawText,
      byteLength: 34,
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    expect(adapter.files.get('imports/numbered-2026-05-29.iso')).toBe(rawText);
    expect(adapter.files.get('editor/numbered-2026-05-29.iso')).toBe(
      ['G92 X0.000 Y0.000', 'G1X1Y2'].join('\n')
    );
    expect(result.project.source.files).toEqual([
      {
        name: 'numbered-2026-05-29.iso',
        path: 'imports/numbered-2026-05-29.iso',
        kind: 'external-gcode',
        createdAt: '2026-05-29T11:00:00.000Z'
      }
    ]);
    expect(result.project.editor.activeFilePath).toBe('editor/numbered-2026-05-29.iso');
    expect(result.editorProgram.text).toBe(['G92 X0.000 Y0.000', 'G1X1Y2'].join('\n'));
    expect(result.editorProgram.parseResult).not.toBeNull();
    expect(result.editorProgram.parseResult?.path).toHaveLength(2);
  });
});
