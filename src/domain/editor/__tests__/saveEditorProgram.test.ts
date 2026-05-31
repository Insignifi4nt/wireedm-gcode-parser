import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import type { DxfEntity } from '@/domain/dxf/types';
import {
  reversePathOperation,
  setPathOperationClassification
} from '@/domain/path-editor/pathDocumentOperations';
import { pathPlanToGcodeBody } from '@/domain/path-intel/postGcode';
import { composeGCodeProgram } from '@/domain/post/gcodeTemplates';
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
    expect(saved.editorProgram.parseResult.stats.linearMoves).toBe(2);
    expect(saved.editorProgram.parseResult.stats.arcMoves).toBe(1);
    expect(saved.editorProgram.parseResult.path.at(1)).toMatchObject({
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
    const body = pathPlanToGcodeBody(
      editedDocument!.plan,
      editedDocument!.segments,
      editedDocument!.options
    );
    const text = composeGCodeProgram({
      header: imported.project.machine.templates.header,
      body,
      footer: imported.project.machine.templates.footer,
      lineEnding: imported.project.machine.output.lineEnding
    });

    const saved = await saveEditorProgram(imported.workbench, {
      filePath: imported.project.source.files[0].path,
      now: new Date('2026-05-29T12:00:00.000Z'),
      pathDocument: editedDocument,
      project: imported.project,
      text
    });

    const projectPath = 'projects/rectangle-2026-05-29/project.json';
    const bodyPath = 'generated/rectangle-2026-05-29.body.gcode';
    const savedProject = JSON.parse(adapter.files.get(projectPath) || '{}');
    const savedManifest = JSON.parse(adapter.files.get('workbench.json') || '{}');

    expect(adapter.files.has(bodyPath)).toBe(false);
    expect(savedProject.generated).toEqual({ body: '', files: [] });
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
    expect(savedProject.pathPlanning.document.plan.operations[0].direction).toBe('reverse');
    expect(savedProject.pathPlanning.document.plan.operations[0].overrides.direction).toEqual({
      direction: 'reverse',
      kind: 'manual'
    });
    expect(savedProject.pathPlanning.document.plan.operations[0].overrides.classification).toEqual({
      classification: 'hole',
      kind: 'manual'
    });
    expect(savedProject.updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(saved.editorProgram.text).toBe('');
    expect(saved.editorProgram.parseResult.path).toHaveLength(0);
    expect(saved.editorProgram.filePath).toBe(imported.project.source.files[0].path);
    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(rectangleDxf());
    expect(savedManifest.projects[0].updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(saved.workbench.manifest.projects[0].updatedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(saved.editorProgram.project?.pathPlanning?.document.plan.operations[0].direction).toBe(
      'reverse'
    );
    expect(saved.editorProgram.project?.upid?.document.plan.operations[0].direction).toBe('reverse');
  });

  it('clears stale generated artifact metadata when saving UPID geometry', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'stale-text.dxf',
      text: rectangleDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const reversedDocument = reversePathOperation(
      imported.pathDocument,
      imported.pathDocument.plan.operations[0].id
    );
    expect(reversedDocument).not.toBeNull();
    const postedArtifacts = addPostedProgramArtifacts(adapter, imported);

    const saved = await saveEditorProgram(imported.workbench, {
      filePath: postedArtifacts.programPath,
      now: new Date('2026-05-29T12:00:00.000Z'),
      pathDocument: reversedDocument,
      project: postedArtifacts.project,
      text: imported.generatedProgram
    });

    expect(adapter.files.get(postedArtifacts.programPath)).toBe(postedArtifacts.programText);
    expect(saved.editorProgram.filePath).toBe(imported.project.source.files[0].path);
    expect(saved.editorProgram.text).toBe('');
    expect(saved.editorProgram.parseResult.path).toHaveLength(0);
    expect(saved.editorProgram.project?.editor.activeFilePath).toBeNull();
    expect(saved.editorProgram.project?.generated).toEqual({ body: '', files: [] });
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
    expect(saved.editorProgram.parseResult.path).toHaveLength(0);
    expect(savedProject.upid.document.plan.operations[0].direction).toBe('reverse');
    expect(savedProject.generated).toEqual({ body: '', files: [] });
  });

  it('clears stale path planning when manual text edits are saved without a path document', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'manual-edit.dxf',
      text: rectangleDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const postedArtifacts = addPostedProgramArtifacts(adapter, imported);
    const text = `${postedArtifacts.programText}\n(MANUAL EDIT)`;

    const saved = await saveEditorProgram(imported.workbench, {
      filePath: postedArtifacts.programPath,
      now: new Date('2026-05-29T12:00:00.000Z'),
      pathDocument: null,
      project: postedArtifacts.project,
      text
    });

    const projectPath = 'projects/manual-edit-2026-05-29/project.json';
    const savedProject = JSON.parse(adapter.files.get(projectPath) || '{}');

    expect(savedProject.pathPlanning).toBeUndefined();
    expect(savedProject.upid).toBeUndefined();
    expect(saved.editorProgram.project?.pathPlanning).toBeUndefined();
    expect(saved.editorProgram.project?.upid).toBeUndefined();
    expect(savedProject.generated.body).toContain('G1 X10.000 Y0.000');
    expect(savedProject.generated.body).not.toContain('G40');
    expect(savedProject.generated.body).not.toContain('MANUAL EDIT');
  });

  it('does not persist changed header lines into the generated body artifact', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'header-edit.dxf',
      text: rectangleDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    const postedArtifacts = addPostedProgramArtifacts(adapter, imported);
    const text = postedArtifacts.programText.replace('G90 G21 G17 G40', 'G90 G21 G17');

    await saveEditorProgram(imported.workbench, {
      filePath: postedArtifacts.programPath,
      now: new Date('2026-05-29T12:00:00.000Z'),
      pathDocument: null,
      project: postedArtifacts.project,
      text
    });

    const projectPath = 'projects/header-edit-2026-05-29/project.json';
    const savedProject = JSON.parse(adapter.files.get(projectPath) || '{}');

    expect(savedProject.generated.body).toContain('G0 X0.000 Y0.000');
    expect(savedProject.generated.body).not.toContain('%');
    expect(savedProject.generated.body).not.toContain('G90 G21 G17');
    expect(savedProject.generated.body).not.toContain('G54');
    expect(savedProject.generated.body).not.toContain('G40');
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

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return {
    type: 'line',
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}

function addPostedProgramArtifacts(
  adapter: MemoryWorkbenchAdapter,
  imported: Awaited<ReturnType<typeof importDxfProject>>
) {
  const body = pathPlanToGcodeBody(
    imported.pathDocument.plan,
    imported.pathDocument.segments,
    imported.pathDocument.options
  );
  const programText = composeGCodeProgram({
    header: imported.project.machine.templates.header,
    body,
    footer: imported.project.machine.templates.footer,
    lineEnding: imported.project.machine.output.lineEnding
  });
  const createdAt = imported.project.createdAt;
  const bodyPath = `generated/${imported.project.id}.body.gcode`;
  const programPath = `generated/${imported.project.id}.iso`;

  adapter.files.set(bodyPath, body);
  adapter.files.set(programPath, programText);

  return {
    body,
    programPath,
    programText,
    project: {
      ...imported.project,
      editor: {
        ...imported.project.editor,
        activeFilePath: programPath
      },
      generated: {
        body,
        files: [
          {
            createdAt,
            kind: 'generated' as const,
            name: `${imported.project.id}.body.gcode`,
            path: bodyPath
          },
          {
            createdAt,
            kind: 'generated' as const,
            name: `${imported.project.id}.iso`,
            path: programPath
          }
        ]
      }
    }
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
