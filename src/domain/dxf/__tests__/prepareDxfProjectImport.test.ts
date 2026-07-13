import { describe, expect, it, vi } from 'vitest';

import { normalizeMachineProfile } from '@/domain/machine/machineProfiles';
import type { ConnectedWorkbench, WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type { MachineProfile } from '@/domain/workbench/types';

import {
  prepareDxfProjectImport,
  previewDxfProjectImport,
  unitCandidatesForDxfImport
} from '../prepareDxfProjectImport';

describe('prepareDxfProjectImport', () => {
  it('orders and deduplicates candidates for the selected machine profile', () => {
    const inchMachine = machine('inch-machine', 'inches');
    const millimeterMachine = machine('millimeter-machine', 'millimeters');
    const automaticMachine = machine('automatic-machine', null);
    const workbench = createWorkbench(
      [inchMachine, millimeterMachine, automaticMachine],
      inchMachine.id
    );
    const prepared = prepareDxfProjectImport(workbench, {
      fileName: 'declared-feet.dxf',
      text: lineDxf({ unitsCode: 2 })
    });

    expect(prepared.unitCandidates.map(({ id, source }) => [id, source])).toEqual([
      ['dxf-insunits-2', 'dxf-declared'],
      ['inches', 'machine-suggestion'],
      ['millimeters', 'fallback']
    ]);
    expect(
      unitCandidatesForDxfImport(prepared, millimeterMachine.id).map(({ id, source }) => [
        id,
        source
      ])
    ).toEqual([
      ['dxf-insunits-2', 'dxf-declared'],
      ['millimeters', 'machine-suggestion']
    ]);
    expect(
      unitCandidatesForDxfImport(prepared, automaticMachine.id).map(({ id, source }) => [
        id,
        source
      ])
    ).toEqual([
      ['dxf-insunits-2', 'dxf-declared'],
      ['millimeters', 'fallback']
    ]);
    expect(prepared.defaultSelection).toEqual({
      machineProfileId: inchMachine.id,
      unitCandidateId: 'dxf-insunits-2'
    });
  });

  it('keeps the declared source when it duplicates the machine suggestion', () => {
    const selectedMachine = machine('inch-machine', 'inches');
    const prepared = prepareDxfProjectImport(
      createWorkbench([selectedMachine], selectedMachine.id),
      { fileName: 'declared-inch.dxf', text: lineDxf({ unitsCode: 1 }) }
    );

    expect(prepared.unitCandidates.map(({ id, source }) => [id, source])).toEqual([
      ['inches', 'dxf-declared'],
      ['millimeters', 'fallback']
    ]);
  });

  it('uses only the machine suggestion and millimeter fallback for unitless DXF', () => {
    const selectedMachine = machine('inch-machine', 'inches');
    const prepared = prepareDxfProjectImport(
      createWorkbench([selectedMachine], selectedMachine.id),
      { fileName: 'unitless.dxf', text: lineDxf({ unitsCode: 0 }) }
    );

    expect(prepared.unitCandidates.map(({ id, source }) => [id, source])).toEqual([
      ['inches', 'machine-suggestion'],
      ['millimeters', 'fallback']
    ]);
  });

  it('prepares and previews without any adapter activity', () => {
    const selectedMachine = machine('inch-machine', 'inches', {
      widthMm: 250,
      lengthMm: 130
    });
    const workbench = createWorkbench([selectedMachine], selectedMachine.id);
    const prepared = prepareDxfProjectImport(workbench, {
      fileName: 'bounded.dxf',
      text: lineDxf({
        endX: 10,
        endY: 5,
        extents: { minX: -500, minY: -500, maxX: 500, maxY: 500 }
      })
    });
    const rawEntities = structuredClone(prepared.parseResult.entities);
    const preview = previewDxfProjectImport(prepared, {
      machineProfileId: selectedMachine.id,
      unitCandidateId: 'inches'
    });

    expect(prepared).toMatchObject({
      fileName: 'bounded.dxf',
      entityCount: 1,
      warningCount: 0,
      unsupportedEntityCount: 0
    });
    expect(preview.boundsMm).toEqual({ minX: 0, minY: 0, maxX: 254, maxY: 127 });
    expect(preview.sizeMm).toEqual({ widthMm: 254, lengthMm: 127 });
    expect(preview.machineFit).toMatchObject({
      status: 'too-large',
      issues: [{ axis: 'width', actualMm: 254, limitMm: 250 }]
    });
    expect(preview.unitCandidates.map(({ id }) => id)).toEqual(['inches', 'millimeters']);
    expect(prepared.parseResult.drawing?.extents).toEqual({
      min: { x: -500, y: -500 },
      max: { x: 500, y: 500 }
    });
    expect(prepared.parseResult.entities).toEqual(rawEntities);
    expect(adapterActivity(workbench.adapter)).toEqual({
      deleteText: 0,
      ensureDirectory: 0,
      readText: 0,
      writeText: 0
    });
  });

  it('rejects missing machine profiles and candidates instead of falling back silently', () => {
    const selectedMachine = machine('selected-machine', null);
    const prepared = prepareDxfProjectImport(
      createWorkbench([selectedMachine], selectedMachine.id),
      { fileName: 'part.dxf', text: lineDxf({}) }
    );

    expect(() => unitCandidatesForDxfImport(prepared, 'deleted-machine')).toThrow(
      /machine profile.*deleted-machine/i
    );
    expect(() => previewDxfProjectImport(prepared, {
      machineProfileId: selectedMachine.id,
      unitCandidateId: 'inches'
    })).toThrow(/unit candidate.*inches/i);
  });

  it('rejects files without valid supported cut geometry during preparation', () => {
    const selectedMachine = machine('selected-machine', null);

    expect(() => prepareDxfProjectImport(
      createWorkbench([selectedMachine], selectedMachine.id),
      { fileName: 'empty.dxf', text: unsupportedOnlyDxf() }
    )).toThrow(/supported cut geometry/i);
  });

  it('rejects a selected scale that makes supported geometry non-finite', () => {
    const selectedMachine = machine('selected-machine', null);
    const prepared = prepareDxfProjectImport(
      createWorkbench([selectedMachine], selectedMachine.id),
      {
        fileName: 'overflow.dxf',
        text: lineDxf({ unitsCode: 20, endX: 1e300 })
      }
    );

    expect(() => previewDxfProjectImport(prepared, {
      machineProfileId: selectedMachine.id,
      unitCandidateId: 'dxf-insunits-20'
    })).toThrow(/non-finite coordinate/i);
  });
});

function machine(
  id: string,
  preferredDxfImportUnit: MachineProfile['preferredDxfImportUnit'],
  workArea: MachineProfile['workArea'] = { widthMm: null, lengthMm: null }
) {
  return normalizeMachineProfile({
    ...createDefaultMachineProfile(),
    id,
    name: id,
    preferredDxfImportUnit,
    workArea
  });
}

function createWorkbench(profiles: MachineProfile[], activeMachineProfileId: string): ConnectedWorkbench {
  const activeMachineProfile = profiles.find(({ id }) => id === activeMachineProfileId)!;
  const activity = {
    deleteText: vi.fn(async () => undefined),
    ensureDirectory: vi.fn(async () => undefined),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => undefined)
  };
  const adapter: WorkbenchStorageAdapter = {
    kind: 'memory',
    name: 'Preparation test',
    ...activity
  };

  return {
    adapter,
    manifest: {
      schemaVersion: 1,
      name: 'Preparation test',
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
      templates: {
        headerPath: 'templates/header.gcode',
        footerPath: 'templates/footer.gcode'
      },
      output: activeMachineProfile.output,
      activeMachineProfileId,
      machineProfiles: profiles,
      projects: []
    },
    activeMachineProfile,
    header: activeMachineProfile.templates.header,
    footer: activeMachineProfile.templates.footer
  };
}

function adapterActivity(adapter: WorkbenchStorageAdapter) {
  return {
    deleteText: vi.mocked(adapter.deleteText).mock.calls.length,
    ensureDirectory: vi.mocked(adapter.ensureDirectory).mock.calls.length,
    readText: vi.mocked(adapter.readText).mock.calls.length,
    writeText: vi.mocked(adapter.writeText).mock.calls.length
  };
}

function lineDxf({
  endX = 10,
  endY = 0,
  extents,
  unitsCode
}: {
  endX?: number;
  endY?: number;
  extents?: { minX: number; minY: number; maxX: number; maxY: number };
  unitsCode?: number;
}) {
  const headerVariables = [
    ...(unitsCode === undefined ? [] : ['9', '$INSUNITS', '70', String(unitsCode)]),
    ...(extents === undefined
      ? []
      : [
          '9', '$EXTMIN', '10', String(extents.minX), '20', String(extents.minY),
          '9', '$EXTMAX', '10', String(extents.maxX), '20', String(extents.maxY)
        ])
  ];

  return [
    '0', 'SECTION', '2', 'HEADER',
    ...headerVariables,
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'CUT',
    '10', '0', '20', '0', '11', String(endX), '21', String(endY),
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}

function unsupportedOnlyDxf() {
  return `
0
SECTION
2
ENTITIES
0
TEXT
1
NO CUT GEOMETRY
10
0
20
0
0
ENDSEC
0
EOF
`;
}
