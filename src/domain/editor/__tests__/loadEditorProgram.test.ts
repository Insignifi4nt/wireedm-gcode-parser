import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import { initializeWorkbenchDirectory, type WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';

import { loadEditorProgram } from '../loadEditorProgram';

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

describe('loadEditorProgram', () => {
  it('opens and parses the generated program from a DXF import project', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'editor-source.dxf',
      text: simpleArcDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    const editorProgram = await loadEditorProgram(imported.workbench, imported.project);

    expect(editorProgram.filePath).toBe('generated/editor-source-2026-05-29.iso');
    expect(editorProgram.text).toContain('G3 X20.000 Y10.000 I0.000 J10.000');
    expect(editorProgram.parseResult.path).toHaveLength(3);
    expect(editorProgram.parseResult.stats.arcMoves).toBe(1);
  });
});

function simpleArcDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '10',
    '0',
    '20',
    '0',
    '11',
    '10',
    '21',
    '0',
    '0',
    'ARC',
    '10',
    '10',
    '20',
    '10',
    '40',
    '10',
    '50',
    '270',
    '51',
    '0',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}
