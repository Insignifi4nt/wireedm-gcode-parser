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
  it('opens DXF import projects from the UPID project document instead of a source or generated file', async () => {
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

    expect(editorProgram.filePath).toBe('projects/editor-source-2026-05-29/project.json');
    expect(editorProgram.text).toBe('');
    expect(editorProgram.parseResult).toBeNull();
    expect(editorProgram.project?.upid?.document.plan.operations).toHaveLength(1);
  });

  it('does not synthesize an editor program for non-UPID projects with missing files', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const project = {
      ...workbench.manifest.projects[0],
      schemaVersion: 1 as const,
      id: 'external-missing',
      name: 'External Missing',
      createdAt: '2026-05-29T11:00:00.000Z',
      updatedAt: '2026-05-29T11:00:00.000Z',
      source: {
        kind: 'external-gcode' as const,
        files: []
      },
      generated: {
        body: '',
        files: []
      },
      machine: workbench.activeMachineProfile,
      editor: {
        activeFilePath: 'editor/missing.iso',
        pinnedLineNumbers: []
      }
    };

    await expect(loadEditorProgram(workbench, project)).rejects.toThrow(
      'Editor program file not found: editor/missing.iso'
    );
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
