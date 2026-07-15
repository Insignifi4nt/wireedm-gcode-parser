import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkbenchProjectIndexEntry } from '@/domain/storage/workbenchStorage';

import { ProjectListPanel } from '../ProjectListPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProjectListPanel simulation entry', () => {
  const mounted: Array<{ container: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];

  afterEach(() => {
    for (const view of mounted.splice(0)) {
      act(() => view.root.unmount());
      view.container.remove();
    }
  });

  it('offers simulation only for path projects and reports the selected project path', () => {
    const projects: WorkbenchProjectIndexEntry[] = [
      project('path-job', 'Path Job', 'dxf'),
      project('machine-program', 'Machine Program', 'external-gcode')
    ];
    const onSimulateProject = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    act(() => {
      root.render(
        <ProjectListPanel
          interactionLocked={false}
          onDeleteProject={vi.fn()}
          onExportUpidProject={vi.fn()}
          onOpenProject={vi.fn()}
          onRenameProject={vi.fn()}
          onSimulateProject={onSimulateProject}
          projects={projects}
        />
      );
    });

    const simulatePath = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Simulate project path-job in 3D"]'
    );
    const simulateProgram = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Simulate project machine-program in 3D"]'
    );

    expect(simulatePath).not.toBeNull();
    expect(simulateProgram).toBeNull();

    act(() => simulatePath?.click());
    expect(onSimulateProject).toHaveBeenCalledWith(projects[0]);
  });
});

function project(
  id: string,
  name: string,
  sourceKind: WorkbenchProjectIndexEntry['sourceKind']
): WorkbenchProjectIndexEntry {
  return {
    id,
    name,
    path: `projects/${id}/project.json`,
    sourceKind,
    updatedAt: '2026-07-15T12:00:00.000Z'
  };
}
