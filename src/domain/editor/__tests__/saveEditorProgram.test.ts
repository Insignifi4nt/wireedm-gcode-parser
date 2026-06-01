import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import type { DxfEntity } from '@/domain/dxf/types';
import {
  reversePathOperation,
  setPathOperationClassification
} from '@/domain/path-editor/pathDocumentOperations';
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
    expect(saved.editorProgram).toMatchObject({
      filePath: imported.editorProgram.filePath,
      text: updatedText
    });
    expect(saved.editorProgram.parseResult).not.toBeNull();
    expect(saved.editorProgram.parseResult?.stats.linearMoves).toBe(2);
    expect(saved.editorProgram.parseResult?.stats.arcMoves).toBe(1);
    expect(saved.editorProgram.parseResult?.path.at(1)).toMatchObject({
      type: 'cut',
      x: 12,
      y: 4,
      line: 4
    });
  });

  it('does not cache generated body state while saving external editor text', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importExternalProgram(workbench, {
      fileName: 'external-edit.nc',
      text: ['%', 'G90 G21', 'G0 X0 Y0', 'G1 X5 Y0', 'M30', '%'].join('\n'),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const updatedText = ['%', 'G90 G21', 'G0 X0 Y0', 'G1 X12 Y4', 'M30', '%'].join('\n');

    const saved = await saveEditorProgram(imported.workbench, {
      filePath: imported.editorProgram.filePath,
      pathDocument: undefined,
      project: imported.project,
      text: updatedText
    });

    const storedProject = JSON.parse(
      adapter.files.get('projects/external-edit-2026-05-29/project.json') || '{}'
    );

    expect(adapter.files.get(imported.editorProgram.filePath)).toBe(updatedText);
    expect('generated' in storedProject).toBe(false);
    expect('generated' in (saved.editorProgram.project ?? {})).toBe(false);
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

  it('persists edited path documents and project metadata without generated body state', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'rectangle.dxf',
      text: rectangleDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const reversedDocument = reversePathOperation(
      imported.pathDocument,
      imported.pathDocument.plan.operations[0].id
    );
    expect(reversedDocument).not.toBeNull();
    const editedDocument = setPathOperationClassification(
      reversedDocument!,
      reversedDocument!.plan.operations[0].id,
      'hole'
    );
    expect(editedDocument).not.toBeNull();

    const saved = await saveEditorProgram(imported.workbench, {
      filePath: imported.project.source.files[0].path,
      now: new Date('2026-05-29T12:00:00.000Z'),
      pathDocument: editedDocument,
      project: imported.project,
      text: ''
    });

    const projectPath = 'projects/rectangle-2026-05-29/project.json';
    const bodyPath = 'generated/rectangle-2026-05-29.body.gcode';
    const savedProject = JSON.parse(adapter.files.get(projectPath) || '{}');
    const savedManifest = JSON.parse(adapter.files.get('workbench.json') || '{}');

    expect(adapter.files.has(bodyPath)).toBe(false);
    expect('generated' in savedProject).toBe(false);
    expect(savedProject.editor.activeFilePath).toBeNull();
    expect(savedProject.upid.format).toBe('upid');
    expect(savedProject.upid.document.plan.operations[0].direction).toBe('reverse');
    expect(savedProject.upid.document.plan.operations[0].overrides.direction).toEqual({
      direction: 'reverse',
      kind: 'manual'
    });
    expect(savedProject.upid.document.plan.operations[0].classification).toBe('hole');
    expect(savedProject.upid.document.plan.operations[0].overrides.classification).toEqual({
      classification: 'hole',
      kind: 'manual'
    });
    expect(savedProject.pathPlanning).toBeUndefined();
    expect(savedProject.updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(saved.editorProgram.text).toBe('');
    expect(saved.editorProgram.parseResult).toBeNull();
    expect(saved.editorProgram.filePath).toBe(projectPath);
    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(rectangleDxf());
    expect(savedManifest.projects[0].updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(saved.workbench.manifest.projects[0].updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect('pathPlanning' in (saved.editorProgram.project ?? {})).toBe(false);
    expect(saved.editorProgram.project?.upid?.document.plan.operations[0].direction).toBe('reverse');
  });

  it('saves UPID path edits even when no generated editor program file exists', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'missing-generated.dxf',
      text: rectangleDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const reversedDocument = reversePathOperation(
      imported.pathDocument,
      imported.pathDocument.plan.operations[0].id
    );
    expect(reversedDocument).not.toBeNull();
    const saved = await saveEditorProgram(imported.workbench, {
      filePath: imported.project.source.files[0].path,
      now: new Date('2026-05-29T12:00:00.000Z'),
      pathDocument: reversedDocument,
      project: imported.project,
      text: ''
    });

    const savedProject = JSON.parse(
      adapter.files.get('projects/missing-generated-2026-05-29/project.json') || '{}'
    );

    expect([...adapter.files.keys()].some((path) => path.startsWith('generated/'))).toBe(false);
    expect(saved.editorProgram.text).toBe('');
    expect(saved.editorProgram.parseResult).toBeNull();
    expect(saved.editorProgram.filePath).toBe('projects/missing-generated-2026-05-29/project.json');
    expect(savedProject.upid.document.plan.operations[0].direction).toBe('reverse');
    expect('generated' in savedProject).toBe(false);
  });

  it('does not persist export-time post diagnostics while saving a UPID path document', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'healed-save.dxf',
      text: rectangleDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const healedDocument = dxfEntitiesToUpidDocument(gappedRectangle(0.004), {
      endpointTolerance: 0.01
    });

    await saveEditorProgram(imported.workbench, {
      filePath: imported.project.source.files[0].path,
      now: new Date('2026-05-29T12:00:00.000Z'),
      pathDocument: healedDocument,
      project: imported.project,
      text: ''
    });

    const savedProject = JSON.parse(adapter.files.get('projects/healed-save-2026-05-29/project.json') || '{}');

    expect(
      savedProject.upid.document.diagnostics.some(
        (diagnostic: { code: string }) => diagnostic.code === 'endpoint-cluster-snap'
      )
    ).toBe(true);
    expect('postDiagnostics' in savedProject.upid).toBe(false);
  });

  it('rejects text-mode saves for UPID projects instead of clearing path state', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'manual-edit.dxf',
      text: rectangleDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const text = 'G1 X999.000 Y999.000\n(MANUAL EDIT)';

    await expect(
      saveEditorProgram(imported.workbench, {
        filePath: imported.project.source.files[0].path,
        now: new Date('2026-05-29T12:00:00.000Z'),
        pathDocument: null,
        project: imported.project,
        text
      })
    ).rejects.toThrow('UPID path projects must be saved with a path document.');

    const projectPath = 'projects/manual-edit-2026-05-29/project.json';
    const savedProject = JSON.parse(adapter.files.get(projectPath) || '{}');

    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(rectangleDxf());
    expect(savedProject.upid?.format).toBe('upid');
    expect('generated' in savedProject).toBe(false);
  });
});

function rectangleDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...rectangleLines(0, 0, 10, 5).flatMap(lineEntityToDxf),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function rectangleLines(minX: number, minY: number, maxX: number, maxY: number): DxfEntity[] {
  return [
    line(minX, minY, maxX, minY),
    line(maxX, minY, maxX, maxY),
    line(maxX, maxY, minX, maxY),
    line(minX, maxY, minX, minY)
  ];
}

function gappedRectangle(gap: number): DxfEntity[] {
  return [
    line(0, 0, 10, 0),
    line(10 + gap, 0, 10, 5),
    line(10, 5, 0, 5),
    line(0, 5, 0, 0)
  ];
}

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return {
    type: 'line',
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}

function lineEntityToDxf(entity: DxfEntity) {
  if (entity.type !== 'line') return [];

  return [
    '0',
    'LINE',
    '8',
    entity.layer ?? 'CUT',
    '10',
    String(entity.start.x),
    '20',
    String(entity.start.y),
    '11',
    String(entity.end.x),
    '21',
    String(entity.end.y)
  ];
}
