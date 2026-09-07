import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DeletedProjectsPanel } from '../DeletedProjectsPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
    await act(async () => root.render(<DeletedProjectsPanel entries={entries} interactionLocked={false} onRestoreProject={restore} />));
    const button = container.querySelector('button');
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
