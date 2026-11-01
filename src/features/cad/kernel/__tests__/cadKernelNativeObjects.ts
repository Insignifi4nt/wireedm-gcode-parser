import { getOC } from 'replicad';

interface NativeObject { isDeleted(): boolean }
type NativeClass = (new (...input: unknown[]) => NativeObject) & { prototype: Record<string, unknown> };
type NativeMethod = ((this: unknown, ...input: unknown[]) => unknown) & Record<string, unknown>;

export interface CadKernelNativeObjectWatch {
  /** Live objects of each watched constructor or method, without the given objects, such as a returned value. */
  outstanding(...kept: readonly object[]): Record<string, number>;
  /** Objects of every watched constructor and method so far. */
  made(): number;
  restore(): void;
}

const isNative = (value: unknown): value is NativeObject =>
  typeof value === 'object' && value !== null && typeof (value as Partial<NativeObject>).isDeleted === 'function';
const isHandle = (value: NativeObject) => ((value as { constructor?: { name?: string } }).constructor?.name ?? '').startsWith('Handle_');

/**
 * Records every object of the named OpenCascade classes that kernel or Replicad code constructs
 * through `getOC()`, and every native object the named methods return, until restored. Methods are
 * named `Class.Method`, such as `gp_Vec.Normalized`; the watch patches the prototype that defines
 * the method, so `BRepAdaptor_Curve.Value` watches `Value` on every curve adaptor. Embind returns
 * a new heap copy for a plain class returned by value or by reference, and the caller must delete
 * it. An object is outstanding until its owner deletes it, and the watch holds it, so garbage
 * collection cannot release it in the owner's place. Handle_ results are not plain objects and are
 * not watched: embind releases them itself.
 */
export function watchCadKernelNativeObjects(names: readonly string[], returns: readonly string[] = []): CadKernelNativeObjectWatch {
  const registry = getOC() as unknown as Record<string, NativeClass>;
  let live: { readonly name: string; readonly value: NativeObject }[] = [], made = 0;
  const record = (name: string, value: unknown) => { if (isNative(value)) { live.push({ name, value }); made++; } };
  const methods: { owner: Record<string, unknown>; key: string; original: NativeMethod }[] = [];
  const constructors: (readonly [string, NativeClass])[] = [];
  const restore = () => {
    for (const [name, original] of constructors) registry[name] = original;
    for (const { owner, key, original } of methods) owner[key] = original;
    live = [];
  };
  try {
    for (const label of returns) {
      const [className, key, ...rest] = label.split('.');
      const type = className ? registry[className] : undefined;
      if (!type || !key || rest.length) throw new Error(`Unknown native method ${label}`);
      let owner: Record<string, unknown> | null = type.prototype;
      while (owner && !Object.prototype.hasOwnProperty.call(owner, key)) owner = Object.getPrototypeOf(owner) as Record<string, unknown> | null;
      if (!owner || typeof owner[key] !== 'function') throw new Error(`Unknown native method ${label}`);
      if (methods.some(item => item.owner === owner && item.key === key)) throw new Error(`${label} is already watched through another class`);
      const original = owner[key] as NativeMethod;
      const wrapper = function (this: unknown, ...input: unknown[]) {
        const value = original.apply(this, input); if (isNative(value) && !isHandle(value)) record(label, value); return value;
      } as NativeMethod;
      // Embind dispatches overloads through properties of the method, such as overloadTable.
      for (const property of Object.getOwnPropertyNames(original)) {
        if (!['length', 'name', 'prototype', 'arguments', 'caller'].includes(property)) wrapper[property] = original[property];
      }
      owner[key] = wrapper; methods.push({ owner, key, original });
    }
    for (const name of names) {
      const original = registry[name];
      if (!original) throw new Error(`Unknown native class ${name}`);
      registry[name] = new Proxy(original, { construct(target, input) { const value = new target(...input); record(name, value); return value; } });
      constructors.push([name, original]);
    }
  } catch (error) { restore(); throw error; }
  return {
    outstanding(...kept) {
      live = live.filter(item => !item.value.isDeleted());
      const counts: Record<string, number> = {};
      for (const item of live) if (!kept.includes(item.value)) counts[item.name] = (counts[item.name] ?? 0) + 1;
      return counts;
    },
    made: () => made,
    restore
  };
}
