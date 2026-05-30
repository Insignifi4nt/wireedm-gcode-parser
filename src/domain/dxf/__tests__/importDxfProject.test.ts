import { describe, expect, it } from 'vitest';

import { initializeWorkbenchDirectory, type WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';

import { importDxfProject } from '../importDxfProject';

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

describe('importDxfProject', () => {
  it('imports a DXF into source, generated, project, and manifest files', async () => {
    const adapter = new MemoryWorkbenchAdapter('Browser cache');
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    const result = await importDxfProject(workbench, {
      fileName: 'Top Slot.dxf',
      text: simpleSlotDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    expect(result.project).toMatchObject({
      id: 'top-slot-2026-05-29',
      name: 'Top Slot',
      source: {
        kind: 'dxf'
      },
      editor: {
        sourceRequiresCleanup: false
      }
    });
    expect(result.project.generated.body).toContain('G3 X20.000 Y10.000 I0.000 J10.000');
    expect(result.generatedBody).toBe(result.project.generated.body);
    expect(result.generatedProgram).toContain('G90 G21 G17 G40');
    expect(result.generatedProgram).toContain('G3 X20.000 Y10.000 I0.000 J10.000');
    expect(result.generatedProgram).toContain('M30');
    expect(result.generatedProgram).not.toMatch(/\bF\d/);

    const projectPath = 'projects/top-slot-2026-05-29/project.json';
    const bodyPath = 'generated/top-slot-2026-05-29.body.gcode';
    const programPath = 'generated/top-slot-2026-05-29.iso';

    expect(adapter.files.get('imports/top-slot-2026-05-29.dxf')).toBe(simpleSlotDxf());
    expect(adapter.files.get(bodyPath)).toBe(result.generatedBody);
    expect(adapter.files.get(programPath)).toBe(result.generatedProgram);
    expect(JSON.parse(adapter.files.get(projectPath) || '{}')).toEqual(result.project);

    const manifest = JSON.parse(adapter.files.get('workbench.json') || '{}');
    expect(manifest.projects).toEqual([
      {
        id: 'top-slot-2026-05-29',
        name: 'Top Slot',
        path: projectPath,
        sourceKind: 'dxf',
        updatedAt: '2026-05-29T11:00:00.000Z'
      }
    ]);
    expect(result.workbench.manifest.projects).toHaveLength(1);
  });

  it('keeps same-name imports separate instead of replacing the earlier project', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    let workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    const firstImport = await importDxfProject(workbench, {
      fileName: 'part.dxf',
      text: simpleSlotDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });
    workbench = firstImport.workbench;
    const secondImport = await importDxfProject(workbench, {
      fileName: 'part.dxf',
      text: simpleSlotDxf(),
      now: new Date('2026-05-29T11:30:00.000Z')
    });

    expect(firstImport.project.id).toBe('part-2026-05-29');
    expect(secondImport.project.id).toBe('part-2026-05-29-2');
    expect(adapter.files.has('imports/part-2026-05-29.dxf')).toBe(true);
    expect(adapter.files.has('imports/part-2026-05-29-2.dxf')).toBe(true);
    expect(secondImport.workbench.manifest.projects.map((project) => project.id)).toEqual([
      'part-2026-05-29',
      'part-2026-05-29-2'
    ]);
  });

  it('keeps unsupported DXF warnings while still importing supported geometry', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    const result = await importDxfProject(workbench, {
      fileName: 'mixed.dxf',
      text: dxfWithUnsupportedSpline(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    expect(result.parseResult.warnings).toEqual(['Unsupported DXF entity: SPLINE']);
    expect(result.generatedBody).toBe(['G0 X0.000 Y0.000', 'G1 X5.000 Y0.000'].join('\n'));
    expect(result.entityCount).toBe(1);
  });

  it('rejects DXF files with no supported cut geometry', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    await expect(
      importDxfProject(workbench, {
        fileName: 'empty.dxf',
        text: emptyDxf(),
        now: new Date('2026-05-29T11:00:00.000Z')
      })
    ).rejects.toThrow('DXF did not contain supported cut geometry.');

    expect(adapter.files.has('imports/empty.dxf')).toBe(false);
    const manifest = JSON.parse(adapter.files.get('workbench.json') || '{}');
    expect(manifest.projects).toEqual([]);
  });
});

function simpleSlotDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '8',
    'CUT',
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
    '8',
    'CUT',
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

function dxfWithUnsupportedSpline() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'SPLINE',
    '8',
    'CAD-ONLY',
    '0',
    'LINE',
    '10',
    '0',
    '20',
    '0',
    '11',
    '5',
    '21',
    '0',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function emptyDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'SPLINE',
    '8',
    'CAD-ONLY',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}
