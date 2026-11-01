import { getOC } from 'replicad';

interface NativeObject { isDeleted(): boolean }
type NativeClass = new (...input: unknown[]) => NativeObject;

export interface CadKernelNativeObjectWatch {
  /** Live constructions of each watched class, without the given objects, such as a returned value. */
  outstanding(...kept: readonly object[]): Record<string, number>;
  /** Constructions of every watched class so far. */
  made(): number;
  restore(): void;
}

/**
 * Records every object of the named OpenCascade classes that kernel or Replicad code constructs
 * through `getOC()` until restored. An object is outstanding until its owner deletes it, and the
 * watch holds it, so garbage collection cannot release it in the owner's place.
 */
export function watchCadKernelNativeObjects(names: readonly string[]): CadKernelNativeObjectWatch {
  const registry = getOC() as unknown as Record<string, NativeClass>;
  let live: { readonly name: string; readonly value: NativeObject }[] = [], made = 0;
  const originals = names.map(name => {
    const original = registry[name];
    registry[name] = new Proxy(original, { construct(target, input) { const value = new target(...input); live.push({ name, value }); made++; return value; } });
    return [name, original] as const;
  });
  return {
    outstanding(...kept) {
      live = live.filter(item => !item.value.isDeleted());
      const counts: Record<string, number> = {};
      for (const item of live) if (!kept.includes(item.value)) counts[item.name] = (counts[item.name] ?? 0) + 1;
      return counts;
    },
    made: () => made,
    restore: () => { for (const [name, original] of originals) registry[name] = original; live = []; }
  };
}
