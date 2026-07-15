import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import type {
  ConnectedWorkbench,
  WorkbenchStorageAdapter
} from '@/domain/storage/workbenchStorage';
import { createProjectUpid } from '@/domain/upid/projectUpid';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import { DashboardPage } from '@/features/dashboard/DashboardPage';

import { SimulationWorkspace } from '../SimulationWorkspace';

vi.mock('../SimulationScene', () => ({
  SimulationScene: () => <div data-testid="simulation-scene" />
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SimulationWorkspace', () => {
  const mounted: Array<{ container: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];

  afterEach(() => {
    for (const view of mounted.splice(0)) {
      act(() => view.root.unmount());
      view.container.remove();
    }
  });

  it('loads the exact requested project path', async () => {
    const { workbench, adapter, projectPath } = simulationWorkbench();
    const view = mount(
      <SimulationWorkspace
        onClose={vi.fn()}
        onSaveSettings={vi.fn()}
        projectPath={projectPath}
        workbench={workbench}
      />
    );

    await settle();

    expect(adapter.readText).toHaveBeenCalledWith(projectPath);
    expect(view.container.textContent).toContain('Simulation Part');
    expect(view.container.querySelector('[data-testid="simulation-scene"]')).not.toBeNull();
    expect(
      view.container.querySelector('input[aria-label="Visual playback speed multiplier"]')
    ).not.toBeNull();
  });

  it('keeps invalid numeric setup local and prevents saving it', async () => {
    const { workbench, projectPath } = simulationWorkbench();
    const onSaveSettings = vi.fn();
    const view = mount(
      <SimulationWorkspace
        onClose={vi.fn()}
        onSaveSettings={onSaveSettings}
        projectPath={projectPath}
        workbench={workbench}
      />
    );
    await settle();

    setInput(view.container, 'Stock width (mm)', '0');

    expect(view.container.textContent).toContain('Stock width must be greater than 0.');
    expect(button(view.container, 'Save simulation setup').disabled).toBe(true);
    expect(onSaveSettings).not.toHaveBeenCalled();
  });

  it('saves valid project simulation settings and reports success', async () => {
    const { workbench, projectPath } = simulationWorkbench();
    const onSaveSettings = vi.fn(async () => undefined);
    const view = mount(
      <SimulationWorkspace
        onClose={vi.fn()}
        onSaveSettings={onSaveSettings}
        projectPath={projectPath}
        workbench={workbench}
      />
    );
    await settle();

    setInput(view.container, 'Stock width (mm)', '45');
    await act(async () => button(view.container, 'Save simulation setup').click());

    expect(onSaveSettings).toHaveBeenCalledWith(expect.objectContaining({
      stock: expect.objectContaining({ widthMm: 45 })
    }));
    expect(view.container.textContent).toContain('Simulation setup saved.');
  });

  it('shows blocking diagnostics instead of the scene for an invalid post', async () => {
    const { workbench, projectPath } = simulationWorkbench([
      line(-10, 0, 10, 0),
      line(0, -10, 0, 10)
    ]);
    const view = mount(
      <SimulationWorkspace
        onClose={vi.fn()}
        onSaveSettings={vi.fn()}
        projectPath={projectPath}
        workbench={workbench}
      />
    );
    await settle();

    expect(view.container.textContent).toContain('Simulation blocked');
    expect(view.container.querySelector('[data-testid="simulation-scene"]')).toBeNull();
  });

  it('toggles visual playback and supports scrubbing', async () => {
    const { workbench, projectPath } = simulationWorkbench();
    const view = mount(
      <SimulationWorkspace
        onClose={vi.fn()}
        onSaveSettings={vi.fn()}
        projectPath={projectPath}
        workbench={workbench}
      />
    );
    await settle();

    act(() => button(view.container, 'Play visual playback').click());
    expect(button(view.container, 'Pause visual playback')).not.toBeNull();
    act(() => button(view.container, 'Pause visual playback').click());
    expect(button(view.container, 'Play visual playback')).not.toBeNull();

    setInput(view.container, 'Visual playback progress', '0.5');
    expect(view.container.querySelector('[data-simulation-telemetry]')?.textContent).toContain('50.0%');
  });

  it('closes from the workspace header', async () => {
    const { workbench, projectPath } = simulationWorkbench();
    const onClose = vi.fn();
    const view = mount(
      <SimulationWorkspace
        onClose={onClose}
        onSaveSettings={vi.fn()}
        projectPath={projectPath}
        workbench={workbench}
      />
    );
    await settle();

    act(() => button(view.container, 'Close 3D simulation').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('launches from the Dashboard and loads the selected row path', async () => {
    const { workbench, adapter, projectPath } = simulationWorkbench();
    const view = mount(
      <DashboardPage
        connectedWorkbench={workbench}
        importErrorMessage={null}
        importStatus="idle"
        interactionLocked={false}
        latestImport={null}
        onCancelDxfImport={vi.fn()}
        onConfirmDxfImport={vi.fn()}
        onDeleteProject={vi.fn()}
        onDxfImportMachineProfileChange={vi.fn()}
        onDxfImportOverrideAcknowledgedChange={vi.fn()}
        onDxfImportUnitCandidateChange={vi.fn()}
        onExportUpidProject={vi.fn()}
        onImportDxfFile={vi.fn()}
        onImportProgramFile={vi.fn()}
        onImportUpidFile={vi.fn()}
        onOpenEditor={vi.fn()}
        onOpenLatestImportInEditor={vi.fn()}
        onOpenProject={vi.fn()}
        onRenameProject={vi.fn()}
        pendingDxfImport={null}
        programImportErrorMessage={null}
        programImportStatus="idle"
        workbenchStatus="ready"
      />
    );

    act(() => button(view.container, 'Simulate project simulation-part in 3D').click());
    await settle();

    expect(adapter.readText).toHaveBeenCalledWith(projectPath);
    expect(view.container.querySelector('[data-simulation-workspace]')).not.toBeNull();
  });

  function mount(element: React.ReactNode) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => root.render(element));
    return { container, root };
  }
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInput(container: HTMLElement, label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`Missing input: ${label}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(container: HTMLElement, label: string) {
  const match = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function simulationWorkbench(entities: DxfEntity[] = rectangleLines()) {
  const project = createWorkbenchProject({
    id: 'simulation-part',
    name: 'Simulation Part',
    sourceKind: 'dxf'
  });
  const document = createPathPlanningDocumentFromDxfEntities(entities);
  project.upid = createProjectUpid(project, document);
  const projectPath = `projects/${project.id}/project.json`;
  const files = new Map([[projectPath, JSON.stringify(project)]]);
  const adapter: WorkbenchStorageAdapter = {
    kind: 'memory',
    name: 'Simulation test',
    deleteText: vi.fn(async (path: string) => {
      files.delete(path);
    }),
    ensureDirectory: vi.fn(async () => undefined),
    readText: vi.fn(async (path: string) => files.get(path) ?? null),
    writeText: vi.fn(async (path: string, contents: string) => {
      files.set(path, contents);
    })
  };
  const machine = project.machine;
  const workbench: ConnectedWorkbench = {
    adapter,
    activeMachineProfile: machine,
    header: machine.templates.header,
    footer: machine.templates.footer,
    manifest: {
      schemaVersion: 1,
      name: 'Simulation test',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      templates: {
        headerPath: 'templates/header.gcode',
        footerPath: 'templates/footer.gcode'
      },
      output: machine.output,
      activeMachineProfileId: machine.id,
      machineProfiles: [machine],
      projects: [{
        id: project.id,
        name: project.name,
        path: projectPath,
        sourceKind: project.source.kind,
        updatedAt: project.updatedAt
      }]
    }
  };
  return { adapter: adapter as WorkbenchStorageAdapter & { readText: ReturnType<typeof vi.fn> }, project, projectPath, workbench };
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
