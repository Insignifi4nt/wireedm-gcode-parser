import { describe, expect, it } from 'vitest';

import {
  createCharmillesRobofil100V2CandidateProfile,
  createVerifiedCharmillesRobofil100Profile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import { initializeWorkbenchDirectory, type WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';
import { composeUpidGCodeExport } from '@/domain/upid/upidDocument';

import { commitDxfProjectImport, importDxfProject } from '../importDxfProject';
import { prepareDxfProjectImport } from '../prepareDxfProjectImport';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();
  readonly calls: Array<{ method: string; path: string }> = [];

  constructor(readonly name = 'cache-workbench') {}

  async ensureDirectory(path: string) {
    this.calls.push({ method: 'ensureDirectory', path });
    this.directories.add(path);
  }

  async readText(path: string) {
    this.calls.push({ method: 'readText', path });
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.calls.push({ method: 'writeText', path });
    this.files.set(path, contents);
  }

  async deleteText(path: string) {
    this.calls.push({ method: 'deleteText', path });
    this.files.delete(path);
  }
}

describe('importDxfProject', () => {
  it('rejects an unconfirmed reviewed import before any storage activity', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-13T08:00:00.000Z')
    });
    const preparation = prepareDxfProjectImport(workbench, {
      fileName: 'urgent-gear.dxf',
      text: simpleSlotDxf(),
      now: new Date('2026-07-13T09:00:00.000Z')
    });
    adapter.calls.length = 0;

    await expect(commitDxfProjectImport(workbench, preparation, {
      ...preparation.defaultSelection,
      confirmed: false,
      declaredUnitOverrideAcknowledged: false
    })).rejects.toThrow('DXF import must be confirmed before it can be committed.');

    expect(adapter.calls).toEqual([]);
  });

  it('rejects selected-machine or reviewed-candidate semantic drift before storage activity', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-13T08:00:00.000Z')
    });
    const preparation = prepareDxfProjectImport(workbench, {
      fileName: 'drift-check.dxf',
      text: dxfWithInchUnits(),
      now: new Date('2026-07-13T09:00:00.000Z')
    });
    const decision = {
      ...preparation.defaultSelection,
      confirmed: true,
      declaredUnitOverrideAcknowledged: false
    };
    workbench.manifest.machineProfiles[0].notes = 'Changed after review';
    adapter.calls.length = 0;

    await expect(commitDxfProjectImport(workbench, preparation, decision)).rejects.toThrow(
      'Selected machine profile changed after DXF import review.'
    );
    expect(adapter.calls).toEqual([]);

    workbench.manifest.machineProfiles[0] = structuredClone(
      preparation.machineProfiles[0]
    );
    preparation.unitCandidates[0] = {
      ...preparation.unitCandidates[0],
      label: 'reviewed-as-a-different-unit'
    };

    await expect(commitDxfProjectImport(workbench, preparation, decision)).rejects.toThrow(
      'Selected DXF unit candidate changed after import review.'
    );
    expect(adapter.calls).toEqual([]);
  });

  it('requires acknowledgement for a declared-unit override and applies the reviewed unit exactly once', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-13T08:00:00.000Z')
    });
    const preparation = prepareDxfProjectImport(workbench, {
      fileName: 'declared-inch.dxf',
      text: dxfWithInchUnits(),
      now: new Date('2026-07-13T09:00:00.000Z')
    });
    const decision = {
      machineProfileId: preparation.defaultSelection.machineProfileId,
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: false
    };
    adapter.calls.length = 0;

    await expect(commitDxfProjectImport(workbench, preparation, decision)).rejects.toThrow(
      'Changing declared DXF units requires explicit acknowledgement.'
    );
    expect(adapter.calls).toEqual([]);

    const result = await commitDxfProjectImport(workbench, preparation, {
      ...decision,
      declaredUnitOverrideAcknowledged: true
    });

    expect(result.parseResult.entities[0]).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 }
    });
    expect(result.pathDocument.segments[0]).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 }
    });
    expect(result.pathDocument.source).toMatchObject({
      units: {
        code: 1,
        label: 'inches',
        scaleToMillimeters: 25.4
      },
      unitDeclaration: {
        status: 'recognized',
        units: { code: 1, label: 'inches', scaleToMillimeters: 25.4 }
      },
      appliedUnits: {
        label: 'millimeters',
        scaleToMillimeters: 1,
        basis: 'user-confirmed',
        confirmed: true,
        confirmedAt: '2026-07-13T09:00:00.000Z'
      },
      coordinateScaleToMillimeters: 1
    });
    expect(result.pathDocument.source.importWarnings).toContain(
      'Declared DXF units "inches" were overridden with confirmed units "millimeters".'
    );
    expect(result.pathDiagnostics.map(({ code }) => code)).toContain('dxf-import-warning');
    expect(result.pathDiagnostics.map(({ code }) => code)).not.toContain(
      'units-assumed-millimeters'
    );
    expect(adapter.calls.filter(({ method }) => method === 'writeText')).toEqual([
      { method: 'writeText', path: 'imports/declared-inch-2026-07-13.dxf' },
      { method: 'writeText', path: 'projects/declared-inch-2026-07-13/project.json' },
      { method: 'writeText', path: 'workbench.json' }
    ]);
  });

  it('resolves and deeply snapshots the selected current machine without changing the default', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-13T08:00:00.000Z')
    });
    const defaultProfile = workbench.activeMachineProfile;
    const selectedProfile = createVerifiedCharmillesRobofil100Profile(
      'selected-robofil',
      new Date('2026-07-13T08:30:00.000Z')
    );
    selectedProfile.preferredDxfImportUnit = 'millimeters';
    workbench.manifest = {
      ...workbench.manifest,
      activeMachineProfileId: defaultProfile.id,
      machineProfiles: [defaultProfile, selectedProfile]
    };
    const preparation = prepareDxfProjectImport(workbench, {
      fileName: 'selected-machine.dxf',
      text: simpleSlotDxf(),
      now: new Date('2026-07-13T09:00:00.000Z')
    });

    const result = await commitDxfProjectImport(workbench, preparation, {
      machineProfileId: selectedProfile.id,
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: false
    });
    const snapshot = structuredClone(result.project.machine);

    expect(result.project.machine).toEqual(selectedProfile);
    expect(result.project.machine).not.toBe(selectedProfile);
    expect(result.project.machine.controller).not.toBe(selectedProfile.controller);
    expect(result.workbench.manifest.activeMachineProfileId).toBe(defaultProfile.id);
    expect(result.workbench.activeMachineProfile.id).toBe(defaultProfile.id);

    selectedProfile.controller.arcCenterMode = 'incremental-from-start';
    selectedProfile.compensation.preActivationCodes[0] = 'G61';
    expect(result.project.machine).toEqual(snapshot);
  });

  it('initializes automatic compensation when importing with a verified enabled machine', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-13T08:00:00.000Z')
    });
    const candidate = markMachineProfileUserVerified(
      createCharmillesRobofil100V2CandidateProfile(),
      new Date('2026-07-13T08:30:00.000Z')
    );
    workbench.manifest = {
      ...workbench.manifest,
      activeMachineProfileId: candidate.id,
      machineProfiles: [...workbench.manifest.machineProfiles, candidate]
    };
    const preparation = prepareDxfProjectImport(workbench, {
      fileName: 'compensated-circle.dxf',
      text: circleDxf(),
      now: new Date('2026-07-13T09:00:00.000Z')
    });

    const result = await commitDxfProjectImport(workbench, preparation, {
      ...preparation.defaultSelection,
      confirmed: true,
      declaredUnitOverrideAcknowledged: false
    });

    expect(result.pathDocument.geometryBasis).toBe('finished-contour');
    expect(result.pathDocument.plan.operations[0].compensationIntent).toMatchObject({
      mode: 'controller',
      source: 'automatic'
    });
    const persistedProject = JSON.parse(
      adapter.files.get(`projects/${result.project.id}/project.json`) ?? '{}'
    );
    expect(persistedProject.upid.document.geometryBasis).toBe('finished-contour');
  });

  it('rejects a machine removed after review before writing and allocates the project ID at commit time', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-13T08:00:00.000Z')
    });
    const selectedProfile = createVerifiedCharmillesRobofil100Profile(
      'temporary-machine',
      new Date('2026-07-13T08:30:00.000Z')
    );
    selectedProfile.preferredDxfImportUnit = 'millimeters';
    workbench.manifest = {
      ...workbench.manifest,
      machineProfiles: [...workbench.manifest.machineProfiles, selectedProfile]
    };
    const preparation = prepareDxfProjectImport(workbench, {
      fileName: 'late-collision.dxf',
      text: simpleSlotDxf(),
      now: new Date('2026-07-13T09:00:00.000Z')
    });
    adapter.calls.length = 0;

    workbench.manifest = {
      ...workbench.manifest,
      machineProfiles: workbench.manifest.machineProfiles.filter(
        ({ id }) => id !== selectedProfile.id
      )
    };
    await expect(commitDxfProjectImport(workbench, preparation, {
      machineProfileId: selectedProfile.id,
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: false
    })).rejects.toThrow('Selected machine profile is no longer available: temporary-machine.');
    expect(adapter.calls).toEqual([]);

    workbench.manifest = {
      ...workbench.manifest,
      projects: [{
        id: 'late-collision-2026-07-13',
        name: 'Existing',
        path: 'projects/existing/project.json',
        sourceKind: 'dxf',
        updatedAt: '2026-07-13T08:45:00.000Z'
      }]
    };
    const result = await commitDxfProjectImport(workbench, preparation, {
      ...preparation.defaultSelection,
      confirmed: true,
      declaredUnitOverrideAcknowledged: false
    });
    expect(result.project.id).toBe('late-collision-2026-07-13-2');
  });

  it('serializes simultaneous commits so project IDs and manifest entries cannot overwrite', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-13T08:00:00.000Z')
    });
    const preparation = prepareDxfProjectImport(workbench, {
      fileName: 'simultaneous.dxf',
      text: simpleSlotDxf(),
      now: new Date('2026-07-13T09:00:00.000Z')
    });
    const decision = {
      ...preparation.defaultSelection,
      confirmed: true,
      declaredUnitOverrideAcknowledged: false
    };

    const results = await Promise.all([
      commitDxfProjectImport(workbench, preparation, decision),
      commitDxfProjectImport(workbench, preparation, decision)
    ]);

    expect(results.map(({ project }) => project.id)).toEqual([
      'simultaneous-2026-07-13',
      'simultaneous-2026-07-13-2'
    ]);
    expect(adapter.files.has('imports/simultaneous-2026-07-13.dxf')).toBe(true);
    expect(adapter.files.has('imports/simultaneous-2026-07-13-2.dxf')).toBe(true);
    expect(adapter.files.has('projects/simultaneous-2026-07-13/project.json')).toBe(true);
    expect(adapter.files.has('projects/simultaneous-2026-07-13-2/project.json')).toBe(true);
    expect(JSON.parse(adapter.files.get('workbench.json') || '{}').projects.map(
      ({ id }: { id: string }) => id
    )).toEqual([
      'simultaneous-2026-07-13',
      'simultaneous-2026-07-13-2'
    ]);
  });

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
      }
    });
    expect('sourceRequiresCleanup' in result.project.editor).toBe(false);
    expect('generated' in result.project).toBe(false);
    expect('generatedBody' in result).toBe(false);
    expect('generatedProgram' in result).toBe(false);
    expect(result.pathDocument.contours).toHaveLength(1);
    expect(result.pathDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'units-assumed-millimeters',
      'open-chain'
    ]);
    expect('postDiagnostics' in result).toBe(false);
    expect(result.project.upid?.format).toBe('upid');
    expect(result.project.upid?.document).toBe(result.pathDocument);
    expect('postDiagnostics' in (result.project.upid ?? {})).toBe(false);
    expect(result.project.upid?.document.source).toMatchObject({
      coordinateScaleToMillimeters: 1,
      fileName: 'Top Slot.dxf',
      importedAt: '2026-05-29T11:00:00.000Z',
      projectId: 'top-slot-2026-05-29'
    });

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
        lineEnding: 'lf',
        coordinatePrecision: 3
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
    expect('generated' in result.project).toBe(false);
    expect(result.project.editor.activeFilePath).toBeNull();
  });

  it('snapshots every nested active-machine policy without sharing library references', async () => {
    const adapter = new MemoryWorkbenchAdapter('Profile snapshot');
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });
    const libraryProfile = createVerifiedCharmillesRobofil100Profile(
      'shop-robofil',
      new Date('2026-07-13T09:30:00.000Z')
    );
    workbench.activeMachineProfile = libraryProfile;
    workbench.manifest = {
      ...workbench.manifest,
      activeMachineProfileId: libraryProfile.id,
      machineProfiles: [libraryProfile],
      output: libraryProfile.output
    };

    const result = await importDxfProject(workbench, {
      fileName: 'snapshotted-machine.dxf',
      text: simpleSlotDxf(),
      now: new Date('2026-07-13T10:00:00.000Z')
    });
    const snapshotBeforeLibraryEdit = JSON.parse(
      JSON.stringify(result.project.machine)
    );

    expect(result.project.machine).not.toBe(libraryProfile);
    expect(result.project.machine.controller).not.toBe(libraryProfile.controller);
    expect(result.project.machine.controller.verification)
      .not.toBe(libraryProfile.controller.verification);
    expect(result.project.machine.compensation).not.toBe(libraryProfile.compensation);
    expect(result.project.machine.compensation.preActivationCodes)
      .not.toBe(libraryProfile.compensation.preActivationCodes);
    expect(result.project.machine.templates).not.toBe(libraryProfile.templates);
    expect(result.project.machine.output).not.toBe(libraryProfile.output);
    expect(result.project.machine.workArea).not.toBe(libraryProfile.workArea);
    expect(result.project.machine.controller.verification)
      .toEqual(libraryProfile.controller.verification);

    libraryProfile.controller.arcCenterMode = 'incremental-from-start';
    libraryProfile.controller.verification.status = 'unverified';
    libraryProfile.compensation.offsetSelection.index = 8;
    libraryProfile.compensation.preActivationCodes[0] = 'G61';
    libraryProfile.templates.header = 'LIBRARY HEADER EDIT';
    libraryProfile.output.coordinatePrecision = 6;
    libraryProfile.workArea.widthMm = 900;

    expect(result.project.machine).toEqual(snapshotBeforeLibraryEdit);
  });

  it('imports geometry stored inside a DXF BLOCK through INSERT into the UPID document', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    const result = await importDxfProject(workbench, {
      fileName: 'inserted-block.dxf',
      text: blockInsertDxf(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    expect(result.entityCount).toBe(1);
    expect(result.pathDocument.segments).toHaveLength(1);
    expect(result.pathDocument.segments[0]).toMatchObject({
      kind: 'line',
      source: {
        dxf: {
          blockName: 'PROFILE',
          insertChain: [
            {
              blockName: 'PROFILE',
              column: 0,
              row: 0,
              transform: {
                blockBasePoint: { x: 0, y: 0 },
                insertion: { x: 100, y: 200 },
                rotationDegrees: 90,
                scaleX: 1,
                scaleY: 1
              }
            }
          ]
        }
      },
      start: { x: 100, y: 200 },
      end: { x: 100, y: 210 }
    });
    expect(result.project.upid?.document).toBe(result.pathDocument);
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

  it('preserves DXF drawing units metadata on the UPID source without scaling coordinates', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    const result = await importDxfProject(workbench, {
      fileName: 'metric-profile.dxf',
      text: dxfWithMillimeterUnits(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    expect(result.parseResult.units).toEqual({
      code: 4,
      label: 'millimeters',
      scaleToMillimeters: 1,
      source: 'dxf-insunits'
    });
    expect(result.pathDocument.source.units).toEqual(result.parseResult.units);
    expect(result.pathDocument.source.coordinateScaleToMillimeters).toBe(1);
    expect(result.pathDocument.segments[0].start).toEqual({ x: 0, y: 0 });
    expect(result.pathDocument.segments[0].end).toEqual({ x: 10, y: 0 });
  });

  it('normalizes inch DXF coordinates to millimeters while retaining the original source units', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-05-29T10:00:00.000Z')
    });

    const result = await importDxfProject(workbench, {
      fileName: 'inch-profile.dxf',
      text: dxfWithInchUnits(),
      now: new Date('2026-05-29T11:00:00.000Z')
    });

    expect(result.parseResult.entities[0]).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 }
    });
    expect(result.pathDocument.source).toMatchObject({
      coordinateScaleToMillimeters: 25.4,
      units: {
        code: 1,
        label: 'inches',
        scaleToMillimeters: 25.4,
        source: 'dxf-insunits'
      }
    });
    expect(result.pathDocument.segments[0]).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 25.4, y: 0 }
    });
    expect(result.pathDiagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'units-assumed-millimeters'
    );
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
    expect(result.pathDocument.source.importWarnings).toEqual([
      'Unsupported DXF entity: SPLINE'
    ]);
    expect(result.pathDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dxf-import-warning',
          severity: 'warning',
          message: 'Unsupported DXF entity: SPLINE'
        })
      ])
    );
    const exportResult = composeUpidGCodeExport(result.pathDocument, {
      header: 'G90 G90.1 G17',
      footer: 'M30'
    });
    expect(exportResult.canDownload).toBe(true);
    expect(exportResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dxf-import-warning',
          message: 'Unsupported DXF entity: SPLINE'
        })
      ])
    );
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

function circleDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'CIRCLE',
    '8',
    'CUT',
    '10',
    '10',
    '20',
    '10',
    '40',
    '5',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function blockInsertDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'PROFILE',
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
    'ENDBLK',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'INSERT',
    '8',
    'CUT',
    '2',
    'PROFILE',
    '10',
    '100',
    '20',
    '200',
    '50',
    '90',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function dxfWithMillimeterUnits() {
  return [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$INSUNITS',
    '70',
    '4',
    '0',
    'ENDSEC',
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
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function dxfWithInchUnits() {
  return [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$INSUNITS',
    '70',
    '1',
    '0',
    'ENDSEC',
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
    '1',
    '21',
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
