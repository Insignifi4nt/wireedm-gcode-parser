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
    const onShowRevisions = vi.fn();
    await act(async () => root.render(
      <ProjectListPanel
        availability="ready"
        interactionLocked={false}
        onDeleteProject={vi.fn()}
        onExportUpidProject={onExportUpidProject}
        onOpenProject={onOpenProject}
        onShowRevisions={onShowRevisions}
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
      button('Show revisions for project project-1').click();
    });

    expect(onOpenProject).toHaveBeenCalledWith('project-1');
    expect(onExportUpidProject).toHaveBeenCalledWith('project-1');
    expect(onShowRevisions).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-1' }));
    expect(onOpenProject).not.toHaveBeenCalledWith('projects/project-1.json');
  });

  function button(label: string) {
    const element = container.querySelector(`button[aria-label="${label}"]`);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
    return element;
  }

  const projects = [
    { id: 'a', name: 'Alpha', path: 'projects/a.json', sourceKind: 'dxf' as const, updatedAt: '2026-09-01T00:00:00Z' },
    { id: 'b', name: 'Beta', path: 'projects/b.json', sourceKind: 'external-gcode' as const, updatedAt: '2026-09-03T00:00:00Z' },
    { id: 'c', name: 'Gamma', path: 'projects/c.json', sourceKind: 'upid' as const, updatedAt: '2026-09-02T00:00:00Z' }
  ];

  it('combines search and source filters, sorts results, and clears filters without changing the catalog', async () => {
    await act(async () => root.render(<ProjectListPanel availability="ready" interactionLocked={false} projects={projects}
      onOpenProject={vi.fn()} onDeleteProject={vi.fn()} onRenameProject={vi.fn()} onExportUpidProject={vi.fn()} onShowRevisions={vi.fn()} />));
    const visible = () => [...container.querySelectorAll('[data-project-row]')].map((row) =>
      row.querySelector('button[aria-label^="Open project"]')?.getAttribute('aria-label'));
    expect(visible()).toEqual(['Open project b in editor', 'Open project c in editor', 'Open project a in editor']);
    const select = async (label: string, value: string) => act(async () => {
      const input = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await select('Project source filter', 'dxf');
    expect(visible()).toEqual(['Open project c in editor', 'Open project a in editor']);
    await select('Project sort', 'name-asc');
    expect(visible()).toEqual(['Open project a in editor', 'Open project c in editor']);
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search projects"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, ' BETA ');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(visible()).toEqual([]);
    await select('Project source filter', 'all');
    expect(visible()).toEqual(['Open project b in editor']);
    await select('Project source filter', 'dxf');
    await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent === 'Clear filters')!.click());
    expect(visible()).toEqual(['Open project a in editor', 'Open project b in editor', 'Open project c in editor']);
    for (const [mode, ids] of [
      ['updated-asc', ['a', 'c', 'b']], ['name-desc', ['c', 'b', 'a']], ['type', ['b', 'a', 'c']]
    ] as const) {
      await select('Project sort', mode);
      expect(visible()).toEqual(ids.map((id) => `Open project ${id} in editor`));
    }
    expect(projects.map((project) => project.id)).toEqual(['a', 'b', 'c']);
  });

  it('distinguishes loading, unavailable and empty states and blocks project actions while busy', async () => {
    const action = vi.fn();
    const render = (availability: 'loading' | 'unavailable' | 'ready', rows = projects, locked = false) =>
      root.render(<ProjectListPanel availability={availability} interactionLocked={locked} projects={rows}
        onOpenProject={action} onDeleteProject={action} onRenameProject={action} onExportUpidProject={action} onShowRevisions={action} />);
    await act(async () => render('loading', []));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading projects');
    expect(container.querySelector('[data-project-library]')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => render('unavailable', []));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Open storage settings to reconnect');
    await act(async () => render('ready', []));
    expect(container.querySelector('[aria-label="Project list"]')?.textContent).toContain('No projects yet');
    await act(async () => render('ready', projects, true));
    await act(async () => {
      button('Open project a in editor').click();
      button('Rename project a').click();
      button('Delete project a').click();
      button('Export UPID project a').click();
    });
    expect(action).not.toHaveBeenCalled();
    await act(async () => render('ready', projects));
    await act(async () => button('Open project a in editor').click());
    expect(action).toHaveBeenCalledWith('a');
  });
});
