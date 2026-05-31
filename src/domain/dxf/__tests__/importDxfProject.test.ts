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
  it('imports a DXF into source, UPID project, and manifest files without generated G-code artifacts', async () => {
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
    expect(result.project.generated.body).toBe('');
    expect('generatedBody' in result).toBe(false);
    expect('generatedProgram' in result).toBe(false);
    expect(result.pathDocument.contours).toHaveLength(1);
    expect(result.pathDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['open-chain']);
    expect('postDiagnostics' in result).toBe(false);
    expect(result.project.upid?.format).toBe('upid');
    expect(result.project.upid?.document).toBe(result.pathDocument);
    expect('postDiagnostics' in (result.project.upid ?? {})).toBe(false);

    const projectPath = 'projects/top-slot-2026-05-29/project.json';

    expect(adapter.files.get('imports/top-slot-2026-05-29.dxf')).toBe(simpleSlotDxf());
    expect([...adapter.files.keys()].some((path) => path.startsWith('generated/'))).toBe(false);
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

  it('uses the active machine profile templates, output, and work area on imported projects', async () => {
    const adapter = new MemoryWorkbenchAdapter('Profiled');
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    workbench.activeMachineProfile = {
      ...workbench.activeMachineProfile,
      name: 'Shop Machine',
      templates: {
        header: '%\nPROFILE HEADER',
        footer: 'PROFILE FOOTER\n%'
      },
      output: {
        extension: 'nc',
        lineEnding: 'lf'
      },
      workArea: {
        widthMm: 30,
        lengthMm: 20
      }
    };
    workbench.header = workbench.activeMachineProfile.templates.header;
    workbench.footer = workbench.activeMachineProfile.templates.footer;
    workbench.manifest = {
      ...workbench.manifest,
      activeMachineProfileId: workbench.activeMachineProfile.id,
      machineProfiles: [workbench.activeMachineProfile],
      output: workbench.activeMachineProfile.output
    };

    const result = await importDxfProject(workbench, {
      fileName: 'profiled.dxf',
      text: simpleSlotDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    expect(result.project.machine).toMatchObject({
      name: 'Shop Machine',
      output: {
        extension: 'nc',
        lineEnding: 'lf'
      },
      workArea: {
        widthMm: 30,
        lengthMm: 20
      }
    });
    expect('generatedProgram' in result).toBe(false);
    expect(result.project.generated.files).toEqual([]);
    expect(result.project.editor.activeFilePath).toBeNull();
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
    expect('generatedBody' in result).toBe(false);
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

  it('rejects DXF files when all supported entities are filtered out as invalid geometry', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    await expect(
      importDxfProject(workbench, {
        fileName: 'invalid.dxf',
        text: zeroLengthLineDxf(),
        now: new Date('2026-05-29T11:00:00.000Z')
      })
    ).rejects.toThrow('DXF did not contain valid cut geometry.');

    expect(adapter.files.has('imports/invalid.dxf')).toBe(false);
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

function zeroLengthLineDxf() {
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
    '4',
    '20',
    '7',
    '11',
    '4',
    '21',
    '7',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}
