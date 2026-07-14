import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import {
  initializeWorkbenchDirectory,
  type WorkbenchStorageAdapter
} from '@/domain/storage/workbenchStorage';

import {
  exportPortableUpidProject,
  importPortableUpidProject
} from '../portableUpidProject';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];

  constructor(readonly name = 'portable-upid-workbench') {}

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.writes.push(path);
    this.files.set(path, contents);
  }

  async deleteText(path: string) {
    this.files.delete(path);
  }
}

describe('portable UPID projects', () => {
  it('exports only detached UPID state while preserving path intent', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-14T08:00:00.000Z')
    });
    const imported = await importDxfProject(workbench, {
      fileName: 'Shared Bracket.dxf',
      text: closedPolylineDxf(),
      now: new Date('2026-07-14T09:00:00.000Z')
    });
    const projectPath = imported.workbench.manifest.projects[0].path;
    const storedProject = structuredClone(imported.project);
    const operation = storedProject.upid!.document.plan.operations[0];
    operation.direction = 'reverse';
    operation.overrides = {
      ...operation.overrides,
      direction: { kind: 'manual', direction: 'reverse' },
      leadIn: {
        kind: 'manual',
        move: 'cut',
        from: { x: -2, y: 0 },
        to: { x: 0, y: 0 },
        source: 'manual-point',
        sourceSegmentId: operation.segmentRefs[0].segmentId,
        sourceSegmentIndex: 0
      }
    };
    operation.compensationIntent = {
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'manual'
    };
    const pathElement = storedProject.upid!.document.pathElements.find(
      (element) => element.operationId === operation.id
    )!;
    pathElement.direction = operation.direction;
    pathElement.overrides = structuredClone(operation.overrides);
    pathElement.compensationIntent = structuredClone(operation.compensationIntent);
    storedProject.machine.name = 'Must not travel';
    const extendedDocument = storedProject.upid!.document as PathPlanningDocument & {
      machine?: { name: string };
    };
    const extendedSource = extendedDocument.source as typeof extendedDocument.source & {
      rawDxf?: string;
    };
    const extendedOperation = operation as typeof operation & { generatedGcode?: string };
    extendedDocument.machine = { name: 'Embedded Machine Secret' };
    extendedSource.rawDxf = 'RAW DXF SECRET';
    extendedOperation.generatedGcode = 'G-CODE SECRET';
    adapter.files.set(projectPath, JSON.stringify(storedProject));

    const exported = await exportPortableUpidProject(imported.workbench, projectPath);
    const parsed = JSON.parse(exported.text);

    expect(exported.fileName).toBe('Shared Bracket.upid.json');
    expect(parsed).toMatchObject({
      format: 'upid',
      schemaVersion: 1,
      document: {
        plan: {
          operations: [
            {
              direction: 'reverse',
              compensationIntent: {
                mode: 'controller',
                keptMaterial: 'inside',
                source: 'manual'
              },
              overrides: {
                leadIn: {
                  from: { x: -2, y: 0 },
                  to: { x: 0, y: 0 }
                }
              }
            }
          ]
        }
      }
    });
    expect(parsed.document.source).not.toHaveProperty('projectId');
    expect(parsed).not.toHaveProperty('machine');
    expect(parsed).not.toHaveProperty('source');
    expect(parsed).not.toHaveProperty('editor');
    expect(parsed).not.toHaveProperty('name');
    expect(parsed.document).not.toHaveProperty('machine');
    expect(parsed.document.source).not.toHaveProperty('rawDxf');
    expect(parsed.document.plan.operations[0]).not.toHaveProperty('generatedGcode');
    expect(exported.text).not.toContain('Embedded Machine Secret');
    expect(exported.text).not.toContain('RAW DXF SECRET');
    expect(exported.text).not.toContain('G-CODE SECRET');
    expect(JSON.parse(adapter.files.get(projectPath)!)).toEqual(storedProject);
  });

  it('imports path intent with a new identity and the receiving active machine', async () => {
    const sourceAdapter = new MemoryWorkbenchAdapter('source');
    const sourceWorkbench = await initializeWorkbenchDirectory(sourceAdapter, {
      now: new Date('2026-07-14T08:00:00.000Z')
    });
    const sourceImport = await importDxfProject(sourceWorkbench, {
      fileName: 'Portable Part.dxf',
      text: closedPolylineDxf(),
      now: new Date('2026-07-14T09:00:00.000Z')
    });
    const sourceProjectPath = sourceImport.workbench.manifest.projects[0].path;
    const portable = await exportPortableUpidProject(sourceImport.workbench, sourceProjectPath);
    const senderDocument = JSON.parse(portable.text);
    senderDocument.document.source.projectId = 'sender-local-project-id';
    senderDocument.document.machine = { name: 'Sender Machine Secret' };
    senderDocument.document.source.rawDxf = 'SENDER RAW DXF';
    const senderText = JSON.stringify(senderDocument);

    const targetAdapter = new MemoryWorkbenchAdapter('target');
    const targetWorkbench = await initializeWorkbenchDirectory(targetAdapter, {
      now: new Date('2026-07-14T10:00:00.000Z')
    });
    targetWorkbench.activeMachineProfile = {
      ...targetWorkbench.activeMachineProfile,
      id: 'recipient-machine',
      name: 'Recipient Machine',
      templates: { header: 'RECIPIENT HEADER', footer: 'RECIPIENT FOOTER' }
    };
    const orphanPath = 'projects/portable-part-2026-07-14/project.json';
    targetAdapter.files.set(orphanPath, 'ORPHAN MUST NOT BE OVERWRITTEN');

    const first = await importPortableUpidProject(targetWorkbench, {
      fileName: portable.fileName,
      text: senderText,
      now: new Date('2026-07-14T11:00:00.000Z')
    });
    const second = await importPortableUpidProject(first.workbench, {
      fileName: portable.fileName,
      text: senderText,
      now: new Date('2026-07-14T12:00:00.000Z')
    });

    expect(first.project).toMatchObject({
      id: 'portable-part-2026-07-14-2',
      name: 'Portable Part',
      source: { kind: 'upid', files: [] },
      machine: {
        id: 'recipient-machine',
        name: 'Recipient Machine',
        templates: { header: 'RECIPIENT HEADER', footer: 'RECIPIENT FOOTER' }
      }
    });
    expect(first.pathDocument.source.projectId).toBe(first.project.id);
    expect(first.pathDocument).not.toHaveProperty('machine');
    expect(first.pathDocument.source).not.toHaveProperty('rawDxf');
    expect(first.pathDocument.segments).toEqual(sourceImport.pathDocument.segments);
    expect(first.pathDocument.plan).toEqual(sourceImport.pathDocument.plan);
    expect(second.project.id).toBe('portable-part-2026-07-14-3');
    expect(second.pathDocument.source.projectId).toBe(second.project.id);
    expect(second.workbench.manifest.projects.map(({ sourceKind }) => sourceKind)).toEqual([
      'upid',
      'upid'
    ]);
    expect(targetAdapter.files.has(`projects/${first.project.id}/project.json`)).toBe(true);
    expect(targetAdapter.files.has(`projects/${second.project.id}/project.json`)).toBe(true);
    expect([...targetAdapter.files.keys()].some((path) => path.endsWith('.dxf'))).toBe(false);
    expect(targetAdapter.files.get(orphanPath)).toBe('ORPHAN MUST NOT BE OVERWRITTEN');
    expect(targetAdapter.writes.indexOf(`projects/${first.project.id}/project.json`)).toBeLessThan(
      targetAdapter.writes.lastIndexOf('workbench.json')
    );
  });

  it('rejects malformed and structurally invalid UPID before writing project state', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-14T08:00:00.000Z')
    });
    adapter.writes.length = 0;

    await expect(importPortableUpidProject(workbench, {
      fileName: 'broken.upid.json',
      text: '{',
      now: new Date('2026-07-14T09:00:00.000Z')
    })).rejects.toThrow('valid JSON');

    await expect(importPortableUpidProject(workbench, {
      fileName: 'broken.upid.json',
      text: JSON.stringify({
        format: 'upid',
        schemaVersion: 1,
        document: { schemaVersion: 1 }
      }),
      now: new Date('2026-07-14T09:00:00.000Z')
    })).rejects.toThrow('Invalid UPID document');

    expect(adapter.writes).toEqual([]);
    expect(workbench.manifest.projects).toEqual([]);
  });
});

function closedPolylineDxf() {
  return [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '90', '4', '70', '1',
    '10', '0', '20', '0',
    '10', '10', '20', '0',
    '10', '10', '20', '10',
    '10', '0', '20', '10',
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}
