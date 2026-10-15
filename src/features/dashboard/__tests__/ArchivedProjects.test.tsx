import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ProjectListPanel } from '../ProjectListPanel';
import { ProjectActionDialog, type ProjectAction } from '../ProjectActionDialog';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const callbacks = { onOpenProject: vi.fn(), onDeleteProject: vi.fn(), onExportUpidProject: vi.fn(), onSaveUpidProjectAs: vi.fn(), onShowRevisions: vi.fn(), onRenameProject: vi.fn() };
async function showArchive(container: HTMLElement) {
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Project state filter"]');
    if (!select) throw new Error('Project state filter missing');
    select.value = 'archived'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('prevents duplicate restores, displays failures, and allows retry', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let reject: (reason: Error) => void = () => {};
  const pending = new Promise<void>((_, fail) => { reject = fail; });
  const restore = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(undefined);
  const entries = [{ project: { id: 'plate', name: 'Plate', path: 'projects/plate.json',
    sourceKind: 'upid' as const, updatedAt: '2026-09-07T00:00:00.000Z' }, deletedAt: '2026-09-07T01:00:00.000Z' }];
  try {
    await act(async () => root.render(<ProjectListPanel {...callbacks} availability="ready" projects={[]} archivedProjects={entries} interactionLocked={false} onRestoreProject={restore} />));
    await showArchive(container);
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Restore Plate"]');
    if (!button) throw new Error('Restore action missing');
    await act(async () => { button.click(); button.click(); });
    expect(restore).toHaveBeenCalledExactlyOnceWith('plate');
    expect(button.disabled).toBe(true);
    await act(async () => { reject(new Error('Missing revision')); await pending.catch(() => {}); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Missing revision');
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(restore).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally { act(() => root.unmount()); container.remove(); }
});

it('requires confirmation before permanently deleting an archived project', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const purge = vi.fn().mockResolvedValue(undefined);
  const entries = [{ project: { id: 'plate', name: 'Plate', path: 'projects/plate.json',
    sourceKind: 'upid' as const, updatedAt: '2026-09-07T00:00:00.000Z' }, deletedAt: '2026-09-07T01:00:00.000Z' }];
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label);
    if (!button) throw new Error(`Missing ${label}`);
    await act(async () => button.click());
  };
  function Archive() {
    const [action, setAction] = useState<ProjectAction | null>(null);
    return <><ProjectListPanel {...callbacks} availability="ready" projects={[]} archivedProjects={entries} interactionLocked={false}
      onRestoreProject={vi.fn()} onPurgeArchivedProject={project => setAction({ kind: 'purge', project })} />
      <ProjectActionDialog action={action} interactionLocked={false} onClose={() => setAction(null)}
        onDeleteProject={vi.fn()} onRenameProject={vi.fn()} onPurgeProject={purge} /></>;
  }
  try {
    await act(async () => root.render(<Archive />));
    await showArchive(container);
    await click('Permanently delete Plate');
    expect(purge).not.toHaveBeenCalled();
    await click('Cancel');
    expect(container.textContent).not.toContain('This cannot be undone.');
    await click('Permanently delete Plate');
    await click('Delete');
    expect(purge).toHaveBeenCalledExactlyOnceWith('plate');
    expect(container.textContent).not.toContain('This cannot be undone.');
  } finally { act(() => root.unmount()); container.remove(); }
});
