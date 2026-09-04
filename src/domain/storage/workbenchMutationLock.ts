import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

const mutationTails = new WeakMap<WorkbenchStorageAdapter, Promise<void>>();

export async function withWorkbenchMutationLock<Result>(
  adapter: WorkbenchStorageAdapter,
  mutation: () => Promise<Result>
): Promise<Result> {
  const predecessor = mutationTails.get(adapter) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = predecessor.then(() => turn);
  mutationTails.set(adapter, tail);

  await predecessor;
  try {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks
      ? await locks.request(`wire-edm-workbench:${adapter.kind}:${adapter.name}`, mutation)
      : await mutation();
  } finally {
    release();
    if (mutationTails.get(adapter) === tail) mutationTails.delete(adapter);
  }
}
