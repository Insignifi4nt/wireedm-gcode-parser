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
  let savedRevisionIds: string[];
  const adapter = { readText: vi.fn() };
  const workbench = { adapter } as unknown as ConnectedWorkbenchCatalog;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    savedRevisionIds = ['revision.1', 'revision.2'];
    storage.readProject.mockImplementation(async () => ({ ok: true, project: { savedRevisionIds } }));
    adapter.readText.mockImplementation(async (path: string) => revisionText(path.split('/').at(-1)!.replace('.wireedm-job.json', '')));
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
    const onDeleteRevisions = vi.fn(async (_projectId: string, ids: readonly string[]) => {
      savedRevisionIds = savedRevisionIds.filter((id) => !ids.includes(id));
    });
    await act(async () => root.render(<ProjectRevisionsDialog workbench={workbench}
      projectId="gear" projectName="Gear" onClose={vi.fn()}
      onDeleteRevisions={onDeleteRevisions} />));
    expect(container.querySelector('[aria-label="Select all revisions on this page"]')).toBeNull();
    await act(async () => click('Delete…'));
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Select revision revision.2"]')!.click());
    expect(container.textContent).toContain('1 selected');
    await act(async () => {
      const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Select all revisions on this page"]')!;
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

  it('hides stale rows while loading and returns to the populated page after deleting the last older revision', async () => {
    savedRevisionIds = Array.from({ length: 21 }, (_, index) => `revision.${index + 1}`);
    let releaseOlder: (() => void) | undefined;
    const olderGate = new Promise<void>((resolve) => { releaseOlder = resolve; });
    adapter.readText.mockImplementation(async (path: string) => {
      const id = path.split('/').at(-1)!.replace('.wireedm-job.json', '');
      if (id === 'revision.1') await olderGate;
      return revisionText(id);
    });
    const onDeleteRevisions = vi.fn(async (_projectId: string, ids: readonly string[]) => {
      savedRevisionIds = savedRevisionIds.filter((id) => !ids.includes(id));
    });
    await act(async () => root.render(<ProjectRevisionsDialog workbench={workbench}
      projectId="gear" projectName="Gear" onClose={vi.fn()}
      onDeleteRevisions={onDeleteRevisions} />));
    expect(container.querySelectorAll('ol li')).toHaveLength(20);
    expect(container.textContent).toContain('Page 1 of 2');

    await act(async () => click('Older'));
    expect(container.textContent).toContain('Loading revisions…');
    expect(container.querySelectorAll('ol li')).toHaveLength(0);
    expect(container.querySelectorAll('button')).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ textContent: 'Controller file' })
    ]));
    await act(async () => releaseOlder?.());
    expect(container.textContent).toContain('Page 2 of 2');
    expect(container.querySelectorAll('ol li')).toHaveLength(1);

    await act(async () => click('Delete…'));
    expect(container.textContent).toContain('Select all on this page');
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Select revision revision.1"]')!.click());
    await act(async () => click('Delete selected'));
    await act(async () => click('Delete 1'));
    expect(onDeleteRevisions).toHaveBeenCalledWith('gear', ['revision.1']);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelectorAll('ol li')).toHaveLength(20);
    expect(container.textContent).not.toContain('No saved revisions yet');
    expect(container.textContent).not.toContain('Page 2 of 2');
  });

  function click(label: string) {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    button.click();
  }
});

function revisionText(revisionId: string) {
  return JSON.stringify({ format: 'wire-edm-job-revision', revisionId,
    project: { id: 'gear' }, savedAt: '2026-09-16T12:00:00.000Z',
    machine: { name: 'Robofil 100' }, post: { installation: { ref: { packageId: 'robofil-v2' } } } });
}
