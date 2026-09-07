import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectActionDialog, type ProjectAction } from '../ProjectActionDialog';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
const project = { id: 'project-1', name: 'Plate', path: 'projects/project-1.json', sourceKind: 'upid' as const, updatedAt: '2026-09-07T00:00:00.000Z' };
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

it.each(['rename', 'delete'] as const)('keeps a pending %s open, prevents duplicate submission, and permits retry after failure', async (kind) => {
  let reject: (error: Error) => void = () => {};
  const pending = new Promise<void>((_, rejectPromise) => { reject = rejectPromise; });
  const mutate = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(undefined);
  const close = vi.fn();
  const action: ProjectAction = { kind, project };
  await act(async () => root.render(<ProjectActionDialog action={action} interactionLocked={false}
    onClose={close} onDeleteProject={mutate} onRenameProject={mutate} />));
  const form = container.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    form.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    container.querySelector<HTMLButtonElement>(`[aria-label="Close ${kind} dialog"]`)!.click();
  });
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  expect(form.getAttribute('aria-busy')).toBe('true');
  await act(async () => { reject(new Error('Storage unavailable')); await pending.catch(() => {}); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Storage unavailable');
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mutate).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(1);
});

it('focuses the rename field, traps focus, and restores the opener and background attributes', async () => {
  const close = vi.fn();
  const render = (action: ProjectAction | null) => root.render(<>
    <button id="opener">Rename</button>
    <section><ProjectActionDialog action={action} interactionLocked={false} onClose={close}
      onDeleteProject={vi.fn()} onRenameProject={vi.fn()} /></section>
  </>);
  await act(async () => render(null));
  const opener = container.querySelector<HTMLButtonElement>('#opener')!;
  opener.focus();
  await act(async () => render({ kind: 'rename', project }));
  expect(document.activeElement).toBe(container.querySelector('input'));
  expect(opener.hasAttribute('inert')).toBe(true);
  const form = container.querySelector('form')!;
  form.querySelector<HTMLButtonElement>('button[type="submit"]')!.focus();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(form.querySelector('button'));
  await act(async () => render(null));
  expect(document.activeElement).toBe(opener);
  expect(opener.hasAttribute('inert')).toBe(false);
  expect(opener.hasAttribute('aria-hidden')).toBe(false);
});

it('validates rename drafts before calling storage and recovers after correction', async () => {
  const mutate = vi.fn().mockResolvedValue(undefined);
  await act(async () => root.render(<ProjectActionDialog action={{ kind: 'rename', project }} interactionLocked={false}
    onClose={vi.fn()} onDeleteProject={vi.fn()} onRenameProject={mutate} />));
  const input = container.querySelector('input')!;
  const form = container.querySelector('form')!;
  const setName = (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  for (const invalid of ['   ', 'x'.repeat(161), 'Part\u00002']) {
    await act(async () => setName(invalid));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }
  expect(mutate).not.toHaveBeenCalled();
  await act(async () => setName('  Placă Ø20  '));
  expect(input.getAttribute('aria-invalid')).toBe('false');
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mutate).toHaveBeenCalledWith(project.id, 'Placă Ø20');
});
