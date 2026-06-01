import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import { initializeWorkbenchDirectory, type WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';
import { createProjectUpid } from '@/domain/upid/projectUpid';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { importExternalProgram } from '../importExternalProgram';
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
    expect(editorProgram.model).toBe('upid-document');
    expect(editorProgram.pathDocument).toBe(imported.pathDocument);
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

  it('rejects external G-code projects that contain UPID path state', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importExternalProgram(workbench, {
      fileName: 'external-with-upid.nc',
      text: 'G0 X0 Y0\nG1 X1 Y0',
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const project = {
      ...imported.project,
      upid: createProjectUpid(
        imported.project.id,
        createUpidFromDxfEntities([line(0, 0, 4, 0)])
      )
    };

    await expect(loadEditorProgram(imported.workbench, project)).rejects.toThrow(
      'External G-code projects cannot contain UPID path state.'
    );
  });

  it('rejects DXF projects without a UPID document instead of opening an active G-code file', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const project = {
      ...workbench.manifest.projects[0],
      schemaVersion: 1 as const,
      id: 'old-dxf-generated',
      name: 'Old DXF Generated',
      createdAt: '2026-05-29T11:00:00.000Z',
      updatedAt: '2026-05-29T11:00:00.000Z',
      source: {
        kind: 'dxf' as const,
        files: [
          {
            createdAt: '2026-05-29T11:00:00.000Z',
            kind: 'dxf' as const,
            name: 'old.dxf',
            path: 'imports/old.dxf'
          }
        ]
      },
      machine: workbench.activeMachineProfile,
      editor: {
        activeFilePath: 'generated/old.iso',
        pinnedLineNumbers: []
      }
    };
    await adapter.writeText('generated/old.iso', 'G0 X0 Y0\nG1 X10 Y0');

    await expect(loadEditorProgram(workbench, project)).rejects.toThrow(
      'DXF projects must contain a UPID document.'
    );
  });

  it('rejects unsupported UPID project schema versions instead of loading stale path state', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'future-upid.dxf',
      text: simpleArcDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const project = {
      ...imported.project,
      upid: {
        ...imported.project.upid!,
        schemaVersion: 2
      }
    } as unknown as typeof imported.project;

    await expect(loadEditorProgram(imported.workbench, project)).rejects.toThrow(
      'Unsupported UPID project schema version: 2.'
    );
  });

  it('rejects UPID project documents attached to a different workbench project id', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'wrong-project.dxf',
      text: simpleArcDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const project = {
      ...imported.project,
      upid: {
        ...imported.project.upid!,
        document: {
          ...imported.project.upid!.document,
          source: {
            ...imported.project.upid!.document.source,
            projectId: 'other-project'
          }
        }
      }
    };

    await expect(loadEditorProgram(imported.workbench, project)).rejects.toThrow(
      'UPID document project mismatch: other-project cannot be used by wrong-project-2026-05-29.'
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

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
