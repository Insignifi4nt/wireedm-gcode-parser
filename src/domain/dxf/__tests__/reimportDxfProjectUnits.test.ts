import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import { createVerifiedCharmillesRobofil100Profile } from '@/domain/machine/machineProfiles';
import {
  initializeWorkbenchDirectory,
  type WorkbenchStorageAdapter
} from '@/domain/storage/workbenchStorage';

import {
  commitDxfProjectReimport,
  prepareDxfProjectReimport
} from '../reimportDxfProjectUnits';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly writeAttempts = new Map<string, number>();
  readonly failedWrites = new Map<string, Set<number>>();
  readonly failedReads = new Set<string>();

  constructor(readonly name = 'reimport-test') {}
  async ensureDirectory() {}
  async readText(path: string) {
    this.reads.push(path);
    if (this.failedReads.has(path)) throw new Error(`Injected read failure for ${path}.`);
    return this.files.get(path) ?? null;
  }
  async deleteText(path: string) {
    this.files.delete(path);
  }
  async writeText(path: string, contents: string) {
    const attempt = (this.writeAttempts.get(path) ?? 0) + 1;
    this.writeAttempts.set(path, attempt);
    this.writes.push(path);
    if (this.failedWrites.get(path)?.has(attempt)) {
      throw new Error(`Injected write failure for ${path}.`);
    }
    this.files.set(path, contents);
  }
  failNextWrite(path: string) {
    this.failedWrites.set(path, new Set([(this.writeAttempts.get(path) ?? 0) + 1]));
  }
  failRead(path: string) {
    this.failedReads.add(path);
  }
}

describe('DXF project unit reimport', () => {
  it('reads exactly one persisted raw DXF and locks preparation to the project machine snapshot', async () => {
    const { adapter, project, workbench } = await importedProject(inchDxf());
    project.machine = createVerifiedCharmillesRobofil100Profile(
      'project-machine',
      new Date('2026-07-13T08:00:00.000Z')
    );
    project.machine.preferredDxfImportUnit = 'millimeters';
    workbench.manifest.machineProfiles = [{
      ...project.machine,
      name: 'Changed library profile',
      preferredDxfImportUnit: 'inches'
    }];
    const rawPath = project.source.files[0].path;
    adapter.reads.length = 0;
    adapter.writes.length = 0;

    const preparation = await prepareDxfProjectReimport(workbench, project, {
      now: new Date('2026-07-13T12:00:00.000Z')
    });

    expect(adapter.reads).toEqual([rawPath]);
    expect(adapter.writes).toEqual([]);
    expect(preparation.projectId).toBe(project.id);
    expect(preparation.machineProfiles).toEqual([project.machine]);
    expect(preparation.machineProfiles[0]).not.toBe(project.machine);
    expect(preparation.activeMachineProfileId).toBe(project.machine.id);
    expect(preparation.defaultSelection.machineProfileId).toBe(project.machine.id);
  });

  it.each([
    ['missing', []],
    ['ambiguous', [sourceRef('a.dxf'), sourceRef('b.dxf')]]
  ])('rejects a $label raw DXF reference', async (_label, sourceFiles) => {
    const { project, workbench } = await importedProject(unitlessDxf());
    project.source.files = sourceFiles;

    await expect(prepareDxfProjectReimport(workbench, project)).rejects.toThrow(
      /exactly one persisted raw DXF/i
    );
  });

  it('blocks an unreadable raw DXF without writes', async () => {
    const { adapter, project, workbench } = await importedProject(unitlessDxf());
    adapter.files.delete(project.source.files[0].path);
    adapter.writes.length = 0;

    await expect(prepareDxfProjectReimport(workbench, project)).rejects.toThrow(
      /raw DXF.*unavailable/i
    );
    expect(adapter.writes).toEqual([]);
  });

  it('reports adapter read failures as an unreadable persisted raw DXF', async () => {
    const { adapter, project, workbench } = await importedProject(unitlessDxf());
    adapter.failRead(project.source.files[0].path);
    adapter.writes.length = 0;

    await expect(prepareDxfProjectReimport(workbench, project)).rejects.toThrow(
      /persisted raw DXF is unreadable/i
    );
    expect(adapter.writes).toEqual([]);
  });

  it('rebuilds changed-scale geometry in place while preserving project-owned state', async () => {
    const { adapter, project, workbench } = await importedProject(inchDxf());
    project.name = 'Urgent preserved name';
    project.editor.pinnedLineNumbers = [7, 11];
    project.machine.notes = 'Pinned controller snapshot';
    const projectBefore = structuredClone(project);
    const workbenchBefore = structuredClone(workbench.manifest);
    const rawPath = project.source.files[0].path;
    const rawBefore = adapter.files.get(rawPath);
    const preparation = await prepareDxfProjectReimport(workbench, project, {
      now: new Date('2026-07-13T12:00:00.000Z')
    });
    adapter.writes.length = 0;

    const result = await commitDxfProjectReimport(workbench, project, preparation, {
      machineProfileId: project.machine.id,
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: true,
      rebuildAcknowledged: true
    });

    expect(result.pathDocument.segments[0]).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 }
    });
    expect(result.pathDocument.source).toMatchObject({
      units: { label: 'inches', scaleToMillimeters: 25.4 },
      appliedUnits: {
        label: 'millimeters',
        scaleToMillimeters: 1,
        basis: 'user-confirmed',
        confirmed: true,
        confirmedAt: '2026-07-13T12:00:00.000Z'
      },
      coordinateScaleToMillimeters: 1,
      projectId: project.id
    });
    expect(result.project).toMatchObject({
      id: projectBefore.id,
      name: projectBefore.name,
      createdAt: projectBefore.createdAt,
      editor: projectBefore.editor,
      machine: projectBefore.machine,
      source: projectBefore.source
    });
    expect(result.workbench.manifest.projects).toHaveLength(1);
    expect(result.workbench.manifest.projects[0].id).toBe(project.id);
    expect(adapter.files.get(rawPath)).toBe(rawBefore);
    expect(adapter.writes).toEqual([
      result.projectPath,
      'workbench.json'
    ]);
    expect(project).toEqual(projectBefore);
    expect(workbench.manifest).toEqual(workbenchBefore);
  });

  it('requires confirmation, declaration override, rebuild acknowledgement, and the reviewed machine', async () => {
    const { adapter, project, workbench } = await importedProject(inchDxf());
    const preparation = await prepareDxfProjectReimport(workbench, project);
    adapter.writes.length = 0;
    const base = {
      machineProfileId: project.machine.id,
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: true,
      rebuildAcknowledged: true
    };

    await expect(commitDxfProjectReimport(workbench, project, preparation, {
      ...base,
      confirmed: false
    })).rejects.toThrow(/confirmed/i);
    await expect(commitDxfProjectReimport(workbench, project, preparation, {
      ...base,
      declaredUnitOverrideAcknowledged: false
    })).rejects.toThrow(/declared DXF units/i);
    await expect(commitDxfProjectReimport(workbench, project, preparation, {
      ...base,
      rebuildAcknowledged: false
    })).rejects.toThrow(/rebuild/i);
    await expect(commitDxfProjectReimport(workbench, project, preparation, {
      ...base,
      machineProfileId: 'different-machine'
    })).rejects.toThrow(/project machine snapshot/i);
    expect(adapter.writes).toEqual([]);
  });

  it('confirms legacy assumed millimetres by metadata only and preserves edited geometry', async () => {
    const { adapter, project, workbench } = await importedProject(unitlessDxf());
    project.upid!.document.plan.operations[0].displayName = 'Operator edit';
    project.upid!.document.pathElements[0].displayName = 'Operator edit';
    const documentBefore = structuredClone(project.upid!.document);
    const preparation = await prepareDxfProjectReimport(workbench, project, {
      now: new Date('2026-07-13T12:30:00.000Z')
    });
    adapter.writes.length = 0;

    const result = await commitDxfProjectReimport(workbench, project, preparation, {
      machineProfileId: project.machine.id,
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: false,
      rebuildAcknowledged: false
    });

    expect(result.mode).toBe('metadata-only');
    expect(result.pathDocument.segments).toEqual(documentBefore.segments);
    expect(result.pathDocument.plan).toEqual(documentBefore.plan);
    expect(result.pathDocument.pathElements).toEqual(documentBefore.pathElements);
    expect(result.pathDocument.source.appliedUnits).toEqual({
      label: 'millimeters',
      scaleToMillimeters: 1,
      basis: 'user-confirmed',
      confirmed: true,
      confirmedAt: '2026-07-13T12:30:00.000Z'
    });
    expect(result.pathDocument.diagnostics.map(({ code }) => code)).not.toContain(
      'units-assumed-millimeters'
    );
    expect(adapter.writes).toEqual([result.projectPath, 'workbench.json']);
  });

  it('rejects a stale project index before persistence', async () => {
    const { adapter, project, workbench } = await importedProject(unitlessDxf());
    const preparation = await prepareDxfProjectReimport(workbench, project);
    workbench.manifest.projects[0] = {
      ...workbench.manifest.projects[0],
      path: 'projects/moved/project.json'
    };
    adapter.writes.length = 0;

    await expect(commitDxfProjectReimport(workbench, project, preparation, {
      machineProfileId: project.machine.id,
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: false,
      rebuildAcknowledged: false
    })).rejects.toThrow(/changed after unit review/i);
    expect(adapter.writes).toEqual([]);
  });

  it('rejects a raw DXF changed after review before persistence', async () => {
    const { adapter, project, workbench } = await importedProject(unitlessDxf());
    const preparation = await prepareDxfProjectReimport(workbench, project);
    adapter.files.set(project.source.files[0].path, inchDxf());
    adapter.writes.length = 0;

    await expect(commitDxfProjectReimport(workbench, project, preparation, {
      machineProfileId: project.machine.id,
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: false,
      rebuildAcknowledged: false
    })).rejects.toThrow(/raw DXF changed after unit review/i);
    expect(adapter.writes).toEqual([]);
  });

  it('rolls project and manifest back when the manifest write fails', async () => {
    const { adapter, project, workbench } = await importedProject(inchDxf());
    const preparation = await prepareDxfProjectReimport(workbench, project);
    const projectPath = workbench.manifest.projects[0].path;
    const before = {
      project: adapter.files.get(projectPath),
      manifest: adapter.files.get('workbench.json'),
      raw: adapter.files.get(project.source.files[0].path)
    };
    adapter.failNextWrite('workbench.json');

    await expect(commitDxfProjectReimport(workbench, project, preparation, {
      machineProfileId: project.machine.id,
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: true,
      rebuildAcknowledged: true
    })).rejects.toThrow(/Injected write failure/);

    expect(adapter.files.get(projectPath)).toBe(before.project);
    expect(adapter.files.get('workbench.json')).toBe(before.manifest);
    expect(adapter.files.get(project.source.files[0].path)).toBe(before.raw);
  });
});

async function importedProject(text: string) {
  const adapter = new MemoryAdapter();
  let workbench = await initializeWorkbenchDirectory(adapter, {
    now: new Date('2026-07-13T08:00:00.000Z')
  });
  const imported = await importDxfProject(workbench, {
    fileName: 'source-part.dxf',
    text,
    now: new Date('2026-07-13T09:00:00.000Z')
  });
  workbench = imported.workbench;
  return { adapter, project: imported.project, workbench };
}

function sourceRef(path: string) {
  return {
    name: path,
    path: `imports/${path}`,
    kind: 'dxf' as const,
    createdAt: '2026-07-13T09:00:00.000Z'
  };
}

function inchDxf() {
  return lineDxf(['9', '$INSUNITS', '70', '1']);
}

function unitlessDxf() {
  return lineDxf([]);
}

function lineDxf(header: string[]) {
  return [
    '0', 'SECTION', '2', 'HEADER', ...header, '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'CUT', '10', '0', '20', '0', '11', '1', '21', '0',
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}
