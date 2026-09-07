import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

const mutationTails = new Map<WorkbenchStorageAdapter | string, Promise<void>>();

export async function withWorkbenchMutationLock<Result>(
  adapter: WorkbenchStorageAdapter,
  mutation: () => Promise<Result>
): Promise<Result> {
  const scope = adapter.mutationScope ?? adapter;
  const predecessor = mutationTails.get(scope) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = predecessor.then(() => turn);
  mutationTails.set(scope, tail);

  await predecessor;
  try {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks && adapter.kind !== 'memory') {
      throw new Error('Persistent storage requires Web Locks to coordinate edits across tabs. Use temporary storage in this browser or open a browser with Web Locks support.');
    }
    return locks
      ? await locks.request(`wire-edm-workbench:${adapter.mutationScope ?? `${adapter.kind}:${adapter.name}`}`, mutation)
      : await mutation();
  } finally {
    release();
    if (mutationTails.get(scope) === tail) mutationTails.delete(scope);
  }
}
