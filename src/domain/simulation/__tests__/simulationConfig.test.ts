import { describe, expect, it } from 'vitest';

import { createDefaultMachineProfile, createWorkbenchProject } from '@/domain/workbench/defaultProject';

import {
  defaultProjectSimulationSettings,
  normalizeProjectSimulationSettings,
  normalizeWorkbenchSimulationSettings
} from '../simulationConfig';

function project() {
  return createWorkbenchProject({
    id: 'simulation-project',
    name: 'Simulation project',
    sourceKind: 'upid',
    now: new Date('2026-07-15T08:00:00.000Z')
  });
}

describe('project simulation configuration', () => {
  it('derives legacy defaults from path bounds with 10 mm stock padding', () => {
    const settings = defaultProjectSimulationSettings(project(), {
      minX: 10,
      minY: -5,
      maxX: 50,
      maxY: 15
    });

    expect(settings).toEqual({
      schemaVersion: 1,
      machineProfileId: 'default-wire-machine',
      stock: {
        widthMm: 60,
        lengthMm: 40,
        thicknessMm: 10,
        originX: 0,
        originY: -15,
        topZMm: 0,
        material: 'Tool steel'
      },
      entryHoleDiameterMm: 1,
      visualPlaybackSpeed: 1
    });
  });

  it('fills missing legacy values and replaces non-finite or non-positive dimensions', () => {
    const legacy = {
      machineProfileId: '',
      stock: {
        widthMm: Number.NaN,
        lengthMm: -2,
        thicknessMm: 0,
        originX: Number.POSITIVE_INFINITY,
        originY: 4,
        topZMm: Number.NEGATIVE_INFINITY,
        material: '   '
      },
      entryHoleDiameterMm: -0.5,
      visualPlaybackSpeed: Number.NaN
    };

    const normalized = normalizeProjectSimulationSettings(legacy, project(), {
      minX: 0,
      minY: 5,
      maxX: 20,
      maxY: 15
    });

    expect(normalized).toMatchObject({
      schemaVersion: 1,
      machineProfileId: 'default-wire-machine',
      stock: {
        widthMm: 40,
        lengthMm: 30,
        thicknessMm: 10,
        originX: -10,
        originY: 4,
        topZMm: 0,
        material: 'Tool steel'
      },
      entryHoleDiameterMm: 1,
      visualPlaybackSpeed: 1
    });
    expect([
      normalized.stock.widthMm,
      normalized.stock.lengthMm,
      normalized.stock.thicknessMm,
      normalized.entryHoleDiameterMm,
      normalized.visualPlaybackSpeed
    ].every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  });

  it('preserves valid finite setup values without changing the project export machine snapshot', () => {
    const sourceProject = project();
    const exportMachineBefore = JSON.stringify(sourceProject.machine);

    const normalized = normalizeProjectSimulationSettings({
      schemaVersion: 1,
      machineProfileId: 'simulation-only-machine',
      stock: {
        widthMm: 120,
        lengthMm: 80,
        thicknessMm: 6,
        originX: -12.5,
        originY: 3.25,
        topZMm: 1.5,
        material: '  Copper  '
      },
      entryHoleDiameterMm: 0.8,
      visualPlaybackSpeed: 2.5
    }, sourceProject, null);

    expect(normalized).toMatchObject({
      machineProfileId: 'simulation-only-machine',
      stock: {
        widthMm: 120,
        lengthMm: 80,
        thicknessMm: 6,
        originX: -12.5,
        originY: 3.25,
        topZMm: 1.5,
        material: 'Copper'
      },
      entryHoleDiameterMm: 0.8,
      visualPlaybackSpeed: 2.5
    });
    expect(JSON.stringify(sourceProject.machine)).toBe(exportMachineBefore);
  });
});

describe('workbench simulation configuration', () => {
  it('keeps settings only for configured machines and supplies defaults for missing machines', () => {
    const first = createDefaultMachineProfile();
    const second = { ...createDefaultMachineProfile(), id: 'second-machine', name: 'Second machine' };

    const normalized = normalizeWorkbenchSimulationSettings({
      schemaVersion: 1,
      renderingQuality: 'quality',
      machines: {
        [first.id]: {
          upperGuideZMm: 35,
          lowerGuideZMm: -25,
          tankDepthMm: 90,
          defaultWireDiameterMm: 0.2,
          fixtureClearanceMm: 8
        },
        'removed-machine': {
          upperGuideZMm: 999,
          lowerGuideZMm: -999,
          tankDepthMm: 999,
          defaultWireDiameterMm: 9,
          fixtureClearanceMm: 999
        }
      }
    }, [first, second]);

    expect(normalized.schemaVersion).toBe(1);
    expect(normalized.renderingQuality).toBe('quality');
    expect(Object.keys(normalized.machines)).toEqual([first.id, second.id]);
    expect(normalized.machines[first.id]).toEqual({
      upperGuideZMm: 35,
      lowerGuideZMm: -25,
      tankDepthMm: 90,
      defaultWireDiameterMm: 0.2,
      fixtureClearanceMm: 8
    });
    expect(normalized.machines[second.id]).toEqual({
      upperGuideZMm: 25,
      lowerGuideZMm: -25,
      tankDepthMm: 80,
      defaultWireDiameterMm: 0.25,
      fixtureClearanceMm: 10
    });
  });

  it('normalizes invalid legacy machine values to finite safe defaults', () => {
    const machine = createDefaultMachineProfile();
    const normalized = normalizeWorkbenchSimulationSettings({
      machines: {
        [machine.id]: {
          upperGuideZMm: Number.NaN,
          lowerGuideZMm: Number.POSITIVE_INFINITY,
          tankDepthMm: 0,
          defaultWireDiameterMm: -1,
          fixtureClearanceMm: -2
        }
      }
    }, [machine]);

    expect(normalized).toEqual({
      schemaVersion: 1,
      renderingQuality: 'balanced',
      machines: {
        [machine.id]: {
          upperGuideZMm: 25,
          lowerGuideZMm: -25,
          tankDepthMm: 80,
          defaultWireDiameterMm: 0.25,
          fixtureClearanceMm: 10
        }
      }
    });
  });
});
