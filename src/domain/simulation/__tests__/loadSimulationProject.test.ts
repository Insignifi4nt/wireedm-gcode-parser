import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import type { ConnectedWorkbench, WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';
import { createProjectUpid } from '@/domain/upid/projectUpid';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';

import { loadSimulationProject } from '../loadSimulationProject';

describe('loadSimulationProject', () => {
  it('loads a path project and returns its validated UPID document', async () => {
    const project = createWorkbenchProject({ name: 'Simulation Part', sourceKind: 'dxf' });
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines());
    project.upid = createProjectUpid(project, document);
    const workbench = workbenchWithProject(project);

    const loaded = await loadSimulationProject(workbench, `projects/${project.id}/project.json`);

    expect(loaded.project.id).toBe(project.id);
    expect(loaded.document.source.projectId).toBe(project.id);
    expect(loaded.document.plan.operations).toHaveLength(1);
    expect(loaded.project.machine.controller.verification.status).toBe('unverified');
  });

  it('rejects Machine Programs because the geometric spike requires UPID state', async () => {
    const project = createWorkbenchProject({ name: 'Posted Program', sourceKind: 'external-gcode' });
    const workbench = workbenchWithProject(project);

    await expect(
      loadSimulationProject(workbench, `projects/${project.id}/project.json`)
    ).rejects.toThrow('3D simulation currently supports Path Projects only.');
  });
});

function workbenchWithProject(project: ReturnType<typeof createWorkbenchProject>) {
  const projectPath = `projects/${project.id}/project.json`;
  const files = new Map([[projectPath, JSON.stringify(project)]]);
  const adapter: WorkbenchStorageAdapter = {
    kind: 'memory',
    name: 'Simulation test',
    deleteText: async (path) => {
      files.delete(path);
    },
    ensureDirectory: async () => undefined,
    readText: async (path) => files.get(path) ?? null,
    writeText: async (path, contents) => {
      files.set(path, contents);
    }
  };

  return { adapter } as ConnectedWorkbench;
}

function rectangleLines(): DxfEntity[] {
  return [
    line(0, 0, 30, 0),
    line(30, 0, 30, 20),
    line(30, 20, 0, 20),
    line(0, 20, 0, 0)
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
