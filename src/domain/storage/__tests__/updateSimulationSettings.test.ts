import { describe, expect, it } from 'vitest';

import {
  defaultProjectSimulationSettings,
  normalizeWorkbenchSimulationSettings,
  type ProjectSimulationSettings,
  type WorkbenchSimulationSettings
} from '@/domain/simulation/simulationConfig';
import { createDefaultMachineProfile, createWorkbenchProject } from '@/domain/workbench/defaultProject';

import {
  initializeWorkbenchDirectory,
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchStorageAdapter
} from '../workbenchStorage';
import {
  updateProjectSimulationSettings,
  updateWorkbenchSimulationSettings
} from '../updateSimulationSettings';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  failPath: string | null = null;

  constructor(readonly name = 'simulation-settings') {}

  async ensureDirectory() {}

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.writes.push(path);
    if (path === this.failPath) throw new Error(`Injected write failure for ${path}.`);
    this.files.set(path, contents);
  }

  async deleteText(path: string) {
    this.files.delete(path);
  }
}

function simulationSettings(machineProfileId = 'default-wire-machine'): ProjectSimulationSettings {
  const project = createWorkbenchProject({
    id: 'target-project',
    name: 'Target project',
    sourceKind: 'upid'
  });
  return {
    ...defaultProjectSimulationSettings(project, {
      minX: 0,
      minY: 0,
      maxX: 20,
      maxY: 10
    }),
    machineProfileId,
    stock: {
      widthMm: 75,
      lengthMm: 50,
      thicknessMm: 8,
      originX: -5,
      originY: -7,
      topZMm: 2,
      material: 'Copper'
    }
  };
}

async function connectedWorkbench() {
  const adapter = new MemoryWorkbenchAdapter();
  const workbench = await initializeWorkbenchDirectory(adapter, {
    now: new Date('2026-07-15T08:00:00.000Z')
  });
  const target = createWorkbenchProject({
    id: 'target-project',
    name: 'Target project',
    sourceKind: 'upid',
    now: new Date('2026-07-15T08:15:00.000Z')
  });
  const other = createWorkbenchProject({
    id: 'other-project',
    name: 'Other project',
    sourceKind: 'dxf',
    now: new Date('2026-07-15T08:20:00.000Z')
  });
  const targetPath = 'projects/target-project/project.json';
  const otherPath = 'projects/other-project/project.json';
  workbench.manifest.projects = [
    {
      id: target.id,
      name: target.name,
      path: targetPath,
      sourceKind: target.source.kind,
      updatedAt: target.updatedAt
    },
    {
      id: other.id,
      name: other.name,
      path: otherPath,
      sourceKind: other.source.kind,
      updatedAt: other.updatedAt
    }
  ];
  adapter.files.set(WORKBENCH_MANIFEST_FILE, JSON.stringify(workbench.manifest, null, 2));
  adapter.files.set(targetPath, JSON.stringify(target, null, 2));
  adapter.files.set(otherPath, JSON.stringify(other, null, 2));
  adapter.writes.length = 0;

  return { adapter, workbench, target, other, targetPath, otherPath };
}

describe('updateProjectSimulationSettings', () => {
  it('writes simulation setup only to the target project file', async () => {
    const { adapter, workbench, targetPath, otherPath } = await connectedWorkbench();
    const manifestBefore = adapter.files.get(WORKBENCH_MANIFEST_FILE);
    const otherBefore = adapter.files.get(otherPath);
    const exportMachineBefore = JSON.parse(adapter.files.get(targetPath) ?? '{}').machine;
    const settings = simulationSettings('simulation-only-machine');

    const result = await updateProjectSimulationSettings(
      workbench,
      'target-project',
      settings,
      new Date('2026-07-15T09:00:00.000Z')
    );

    const persisted = JSON.parse(adapter.files.get(targetPath) ?? '{}');
    expect(adapter.writes).toEqual([targetPath]);
    expect(persisted.simulation).toEqual(settings);
    expect(persisted.machine).toEqual(exportMachineBefore);
    expect(persisted.updatedAt).toBe('2026-07-15T09:00:00.000Z');
    expect(adapter.files.get(otherPath)).toBe(otherBefore);
    expect(adapter.files.get(WORKBENCH_MANIFEST_FILE)).toBe(manifestBefore);
    expect(result.project).toEqual(persisted);
    expect(result.workbench).toBe(workbench);
  });

  it('rejects a project write failure without mutating the connected workbench', async () => {
    const { adapter, workbench, targetPath } = await connectedWorkbench();
    const projectBefore = adapter.files.get(targetPath);
    const workbenchBefore = JSON.stringify({
      manifest: workbench.manifest,
      activeMachineProfile: workbench.activeMachineProfile,
      header: workbench.header,
      footer: workbench.footer
    });
    adapter.failPath = targetPath;

    await expect(updateProjectSimulationSettings(
      workbench,
      'target-project',
      simulationSettings()
    )).rejects.toThrow(`Injected write failure for ${targetPath}`);

    expect(adapter.files.get(targetPath)).toBe(projectBefore);
    expect(JSON.stringify({
      manifest: workbench.manifest,
      activeMachineProfile: workbench.activeMachineProfile,
      header: workbench.header,
      footer: workbench.footer
    })).toBe(workbenchBefore);
  });
});

describe('updateWorkbenchSimulationSettings', () => {
  it('writes normalized machine visualization settings only to workbench.json', async () => {
    const { adapter, workbench, targetPath, otherPath } = await connectedWorkbench();
    const targetBefore = adapter.files.get(targetPath);
    const otherBefore = adapter.files.get(otherPath);
    const settings: WorkbenchSimulationSettings = {
      schemaVersion: 1,
      renderingQuality: 'performance',
      machines: {
        [workbench.activeMachineProfile.id]: {
          upperGuideZMm: 40,
          lowerGuideZMm: -30,
          tankDepthMm: 100,
          defaultWireDiameterMm: 0.18,
          fixtureClearanceMm: 12
        },
        'not-configured': {
          upperGuideZMm: 500,
          lowerGuideZMm: -500,
          tankDepthMm: 500,
          defaultWireDiameterMm: 5,
          fixtureClearanceMm: 500
        }
      }
    };

    const result = await updateWorkbenchSimulationSettings(
      workbench,
      settings,
      new Date('2026-07-15T09:30:00.000Z')
    );

    const expected = normalizeWorkbenchSimulationSettings(
      settings,
      workbench.manifest.machineProfiles
    );
    expect(adapter.writes).toEqual([WORKBENCH_MANIFEST_FILE]);
    expect(result.manifest.simulation).toEqual(expected);
    expect(result.manifest.updatedAt).toBe('2026-07-15T09:30:00.000Z');
    expect(JSON.parse(adapter.files.get(WORKBENCH_MANIFEST_FILE) ?? '{}').simulation)
      .toEqual(expected);
    expect(adapter.files.get(targetPath)).toBe(targetBefore);
    expect(adapter.files.get(otherPath)).toBe(otherBefore);
  });

  it('rejects a manifest write failure without returning or mutating a falsely updated workbench', async () => {
    const { adapter, workbench } = await connectedWorkbench();
    const manifestFileBefore = adapter.files.get(WORKBENCH_MANIFEST_FILE);
    const connectedManifestBefore = JSON.stringify(workbench.manifest);
    adapter.failPath = WORKBENCH_MANIFEST_FILE;

    await expect(updateWorkbenchSimulationSettings(
      workbench,
      normalizeWorkbenchSimulationSettings(undefined, workbench.manifest.machineProfiles)
    )).rejects.toThrow(`Injected write failure for ${WORKBENCH_MANIFEST_FILE}`);

    expect(adapter.files.get(WORKBENCH_MANIFEST_FILE)).toBe(manifestFileBefore);
    expect(JSON.stringify(workbench.manifest)).toBe(connectedManifestBefore);
  });
});

describe('workbench simulation migration', () => {
  it('normalizes legacy workbench simulation settings when reconnecting', async () => {
    const adapter = new MemoryWorkbenchAdapter();
    const machine = createDefaultMachineProfile();
    adapter.files.set(WORKBENCH_MANIFEST_FILE, JSON.stringify({
      schemaVersion: 1,
      name: 'legacy-workbench',
      createdAt: '2026-07-14T08:00:00.000Z',
      updatedAt: '2026-07-14T08:00:00.000Z',
      templates: {
        headerPath: 'templates/header.gcode',
        footerPath: 'templates/footer.gcode'
      },
      output: machine.output,
      activeMachineProfileId: machine.id,
      machineProfiles: [machine],
      projects: [],
      simulation: {
        machines: {
          [machine.id]: {
            upperGuideZMm: 30,
            tankDepthMm: -1
          },
          stale: {
            upperGuideZMm: 300
          }
        }
      }
    }));

    const connected = await initializeWorkbenchDirectory(adapter, {
      now: new Date('2026-07-15T10:00:00.000Z')
    });

    expect(connected.manifest.simulation).toEqual({
      schemaVersion: 1,
      renderingQuality: 'balanced',
      machines: {
        [machine.id]: {
          upperGuideZMm: 30,
          lowerGuideZMm: -25,
          tankDepthMm: 80,
          defaultWireDiameterMm: 0.25,
          fixtureClearanceMm: 10
        }
      }
    });
  });
});
