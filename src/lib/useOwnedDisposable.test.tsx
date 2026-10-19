import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOwnedDisposable } from './useOwnedDisposable';

interface Owned { readonly id: number; disposed: boolean; dispose(): void }
let root: Root, container: HTMLDivElement, created: Owned[], seen: Owned[];
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); created = []; seen = []; });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function create(): Owned {
  const owned: Owned = { id: created.length, disposed: false, dispose() { owned.disposed = true; } };
  created.push(owned); return owned;
}
function Owner({ owner }: { readonly owner: string }) {
  seen.push(useOwnedDisposable(create, owner)); return null;
}

it('never hands out an instance disposed by the StrictMode effect check and disposes per key and on unmount', async () => {
  await act(async () => root.render(<StrictMode><Owner owner="first" /></StrictMode>));
  const live = seen.at(-1)!; expect(live.disposed).toBe(false);
  expect(created.filter(owned => !owned.disposed)).toEqual([live]);
  await act(async () => root.render(<StrictMode><Owner owner="second" /></StrictMode>));
  const next = seen.at(-1)!; expect(next).not.toBe(live); expect(live.disposed).toBe(true); expect(next.disposed).toBe(false);
  act(() => root.unmount()); root = createRoot(container);
  expect(created.every(owned => owned.disposed)).toBe(true);
});
