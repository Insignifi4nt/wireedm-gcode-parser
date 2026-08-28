import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectListPanel } from '../ProjectListPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProjectListPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens and exports catalog projects by project ID rather than storage path', async () => {
    const onOpenProject = vi.fn();
    const onExportUpidProject = vi.fn();
    await act(async () => root.render(
      <ProjectListPanel
        interactionLocked={false}
        onDeleteProject={vi.fn()}
        onExportUpidProject={onExportUpidProject}
        onOpenProject={onOpenProject}
        onRenameProject={vi.fn()}
        projects={[{
          id: 'project-1',
          name: 'Catalog project',
          path: 'projects/project-1.json',
          sourceKind: 'upid',
          updatedAt: '2026-08-28T10:00:00.000Z'
        }]}
      />
    ));

    await act(async () => {
      button('Open project project-1 in editor').click();
      button('Export UPID project project-1').click();
    });

    expect(onOpenProject).toHaveBeenCalledWith('project-1');
    expect(onExportUpidProject).toHaveBeenCalledWith('project-1');
    expect(onOpenProject).not.toHaveBeenCalledWith('projects/project-1.json');
  });

  function button(label: string) {
    const element = container.querySelector(`button[aria-label="${label}"]`);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
    return element;
  }
});
