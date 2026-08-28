import { describe, expect, it } from 'vitest';

import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import {
  prepareDxfProjectImport,
  previewDxfProjectImport
} from '../prepareDxfProjectImport';

describe('prepareDxfProjectImport', () => {
  it('uses the explicit workbench unit preference without machine state', () => {
    const prepared = prepareDxfProjectImport(
      workbenchWithImportUnits({ mode: 'fixed', unit: 'inches' }),
      {
        fileName: 'declared-mm.dxf',
        text: lineDxf(4),
        now: new Date('2026-08-28T10:00:00.000Z')
      }
    );
    if (!prepared.ok) throw new Error(prepared.error.message);

    expect(prepared.preparation.defaultUnitCandidateId).toBe('inches');
    expect(prepared.preparation.unitCandidates.map(({ id, source }) => [id, source])).toEqual([
      ['inches', 'workbench-preference'],
      ['millimeters', 'dxf-declared']
    ]);
    expect('machineProfiles' in prepared.preparation).toBe(false);

    expect(previewDxfProjectImport(prepared.preparation, {
      unitCandidateId: 'inches'
    })).toMatchObject({
      ok: true,
      preview: {
        boundsMm: { minX: 0, minY: 0, maxX: 25.4, maxY: 0 },
        sizeMm: { widthMm: 25.4, lengthMm: 0 }
      }
    });
  });

  it('requires an explicit choice for a unitless DXF when the preference is ask', () => {
    const prepared = prepareDxfProjectImport(
      workbenchWithImportUnits({ mode: 'ask' }),
      { fileName: 'unitless.dxf', text: lineDxf(0) }
    );
    if (!prepared.ok) throw new Error(prepared.error.message);

    expect(prepared.preparation.defaultUnitCandidateId).toBeNull();
    expect(prepared.preparation.unitCandidates.map(({ id, source }) => [id, source])).toEqual([
      ['millimeters', 'explicit-choice'],
      ['inches', 'explicit-choice']
    ]);
  });

  it('returns typed errors for missing geometry and an unknown reviewed candidate', () => {
    const workbench = workbenchWithImportUnits({ mode: 'ask' });
    expect(prepareDxfProjectImport(workbench, {
      fileName: 'empty.dxf',
      text: ['0', 'SECTION', '2', 'ENTITIES', '0', 'TEXT', '1', 'note', '0', 'ENDSEC', '0', 'EOF'].join('\n')
    })).toMatchObject({
      ok: false,
      error: { code: 'DXF_IMPORT_GEOMETRY_REQUIRED' }
    });

    const prepared = prepareDxfProjectImport(workbench, {
      fileName: 'part.dxf',
      text: lineDxf(0)
    });
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(previewDxfProjectImport(prepared.preparation, {
      unitCandidateId: 'deleted-choice'
    })).toMatchObject({
      ok: false,
      error: { code: 'DXF_IMPORT_UNIT_CANDIDATE_NOT_FOUND' }
    });
  });
});

function workbenchWithImportUnits(
  importUnits: ConnectedWorkbenchCatalog['manifest']['preferences']['importUnits']
): ConnectedWorkbenchCatalog {
  return {
    adapter: {
      name: 'DXF preparation',
      kind: 'memory',
      ensureDirectory: async () => undefined,
      readText: async () => null,
      deleteText: async () => undefined,
      writeText: async () => undefined
    },
    manifest: {
      format: 'wire-edm-workbench',
      schemaVersion: 2,
      name: 'DXF preparation',
      createdAt: '2026-08-28T09:00:00.000Z',
      updatedAt: '2026-08-28T09:00:00.000Z',
      preferences: {
        importUnits,
        export: { status: 'unconfigured' },
        recentPlanningMachineId: null
      },
      projects: []
    },
    posts: { schemaVersion: 1, installations: [] },
    machines: { schemaVersion: 1, machines: [] }
  };
}

function lineDxf(unitsCode: number) {
  return [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', String(unitsCode),
    '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'CUT', '10', '0', '20', '0', '11', '1', '21', '0',
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}
