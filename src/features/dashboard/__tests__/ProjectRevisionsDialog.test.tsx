import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { ProjectRevisionsDialog } from '../ProjectRevisionsDialog';

const storage = vi.hoisted(() => ({ readProject: vi.fn(), loadRevision: vi.fn() }));
vi.mock('@/domain/workbench-catalog/workbenchCatalogMutations', () => ({
  readStoredWorkbenchProject: storage.readProject
}));
vi.mock('@/domain/wire-edm-job', () => ({
  loadSavedWireEdmJobRevision: storage.loadRevision,
  generateControllerArtifact: vi.fn(),
  serializeSavedWireEdmJobRevision: vi.fn()
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProjectRevisionsDialog deletion selection', () => {
  let root: Root;
  let container: HTMLDivElement;
  const workbench = { adapter: {} } as ConnectedWorkbenchCatalog;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    storage.readProject.mockResolvedValue({ ok: true, project: { savedRevisionIds: ['revision.1', 'revision.2'] } });
    storage.loadRevision.mockImplementation(async (_adapter, _projectId, revisionId: string) => ({
      ok: true,
      revision: {
        revisionId,
        savedAt: '2026-09-16T12:00:00.000Z',
        machine: { name: 'Robofil 100' },
        post: { installation: { ref: { packageId: 'robofil-v2' } } }
      }
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows checkboxes only in delete mode and confirms the selected set once', async () => {
    const onDeleteRevisions = vi.fn(async () => undefined);
    await act(async () => root.render(<ProjectRevisionsDialog workbench={workbench}
      projectId="gear" projectName="Gear" onClose={vi.fn()}
      onDeleteRevisions={onDeleteRevisions} />));
    expect(container.querySelector('[aria-label="Select all revisions"]')).toBeNull();
    await act(async () => click('Delete…'));
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Select revision revision.2"]')!.click());
    expect(container.textContent).toContain('1 selected');
    await act(async () => {
      const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Select all revisions"]')!;
      checkbox.click();
    });
    expect(container.textContent).toContain('2 selected');
    await act(async () => click('Delete selected'));
    expect(onDeleteRevisions).not.toHaveBeenCalled();
    expect(container.textContent).toContain('cannot be undone');
    await act(async () => click('Delete 2'));
    expect(onDeleteRevisions).toHaveBeenCalledOnce();
    expect(onDeleteRevisions).toHaveBeenCalledWith('gear', ['revision.2', 'revision.1']);
    expect(container.querySelectorAll('ol li')).toHaveLength(0);
  });

  function click(label: string) {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    button.click();
  }
});
