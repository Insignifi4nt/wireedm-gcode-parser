import { getOC } from 'replicad';

interface NativeObject { isDeleted(): boolean }
type NativeClass = (new (...input: unknown[]) => NativeObject) & { prototype: Record<string, unknown> } & Record<string, unknown>;
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
const isNativeClass = (value: unknown): value is NativeClass =>
  typeof value === 'function' && typeof (value as { prototype?: Partial<NativeObject> }).prototype?.isDeleted === 'function';
/** Function properties that are not methods: a function's own and embind's ClassHandle members. */
const notMethods = new Set(['length', 'name', 'prototype', 'arguments', 'caller', 'argCount', 'constructor', 'delete', 'isDeleted', 'deleteLater', 'isAliasOf', 'clone']);

/** Embind dispatches overloads through properties of the method, such as overloadTable, which its replacement needs too. */
function copyDispatch(original: NativeMethod, replacement: NativeMethod) {
  for (const property of Object.getOwnPropertyNames(original)) {
    if (!['length', 'name', 'prototype', 'arguments', 'caller'].includes(property)) replacement[property] = original[property];
  }
}

interface Patch { readonly owner: Record<string, unknown>; readonly key: string; readonly label: string }

/**
 * Wraps each patched method so that every native object it returns is recorded under its label, and proxies each named
 * class so that every object it constructs is recorded under the class name. An object is outstanding until its owner
 * deletes it, and the watch holds it, so garbage collection cannot release it in the owner's place.
 */
function install(classes: readonly string[], patches: readonly Patch[]): CadKernelNativeObjectWatch {
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
    for (const { owner, key, label } of patches) {
      const original = owner[key] as NativeMethod;
      const wrapper = function (this: unknown, ...input: unknown[]) { const value = original.apply(this, input); record(label, value); return value; } as NativeMethod;
      copyDispatch(original, wrapper);
      owner[key] = wrapper; methods.push({ owner, key, original });
    }
    for (const name of classes) {
      const original = registry[name];
      if (!isNativeClass(original)) throw new Error(`Unknown native class ${name}`);
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

/**
 * Records every object of the named OpenCascade classes that kernel or Replicad code constructs through `getOC()`, and
 * every native object the named methods return, until restored. Methods are named `Class.Method`, such as
 * `gp_Vec.Normalized`; the watch patches the prototype that defines the method, so `BRepAdaptor_Curve.Value` watches
 * `Value` on every curve adaptor. Embind returns a new heap copy for a plain class returned by value or by reference,
 * and the caller must delete it.
 */
export function watchCadKernelNativeObjects(names: readonly string[], returns: readonly string[] = []): CadKernelNativeObjectWatch {
  const registry = getOC() as unknown as Record<string, NativeClass>;
  const patches: Patch[] = [];
  for (const label of returns) {
    const [className, key, ...rest] = label.split('.');
    const type = className ? registry[className] : undefined;
    if (!isNativeClass(type) || !key || rest.length) throw new Error(`Unknown native method ${label}`);
    let owner: Record<string, unknown> | null = type.prototype;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, key)) owner = Object.getPrototypeOf(owner) as Record<string, unknown> | null;
    if (!owner || typeof owner[key] !== 'function') throw new Error(`Unknown native method ${label}`);
    if (patches.some(item => item.owner === owner && item.key === key)) throw new Error(`${label} is already watched through another class`);
    patches.push({ owner, key, label });
  }
  return install(names, patches);
}

/**
 * Records every native object the OpenCascade module hands to kernel or Replicad code until restored: each object any
 * class constructs, labelled with the class, and each object any instance method or static function returns, labelled
 * `Class.Method` with the class that defines it. The list is read from the module, so a new adapter's constructions and
 * queries are watched without being named. Handle results, such as the curve a curve maker's Value or GeomLib.To3d
 * returns, are objects of the class they point to; embind releases them when they are collected, but they are counted,
 * like every other object, until their owner deletes them.
 */
export function watchEveryCadKernelNativeObject(): CadKernelNativeObjectWatch {
  const registry = getOC() as unknown as Record<string, unknown>;
  const classes: string[] = [], patches: Patch[] = [], seen = new Set<object>();
  for (const name of Object.keys(registry)) {
    const type = registry[name];
    if (!isNativeClass(type) || seen.has(type)) continue;
    seen.add(type); classes.push(name);
    for (const owner of [type, type.prototype] as Record<string, unknown>[]) {
      for (const key of Object.getOwnPropertyNames(owner)) {
        if (notMethods.has(key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (descriptor && typeof descriptor.value === 'function' && descriptor.writable) patches.push({ owner, key, label: `${name}.${key}` });
      }
    }
  }
  return install(classes, patches);
}

export interface CadKernelMakerRefusal {
  /** Whether a maker has been refused yet. */
  refused(): boolean;
  restore(): void;
}

/**
 * Makes OpenCascade refuse one curve, as a maker given coincident or collinear points does: the call-th object of the
 * named maker class whose IsDone or Value is asked reports that it is not done, and its Value is null. Whether
 * OpenCascade itself refuses nearly collinear points depends on what ran before in the module, so tests refuse a curve
 * this way. Install it after a watch and restore it before the watch.
 */
export function refuseCadKernelMaker(name: 'GC_MakeSegment2d' | 'GC_MakeArcOfCircle2d', call: number): CadKernelMakerRefusal {
  const type = (getOC() as unknown as Record<string, unknown>)[name];
  if (!isNativeClass(type)) throw new Error(`Unknown native class ${name}`);
  const prototype = type.prototype, keys = ['IsDone', 'Value'] as const;
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(prototype, key)] as const);
  const order = new WeakMap<object, number>();
  let asked = 0, refused = false;
  const refuses = (maker: object) => {
    if (!order.has(maker)) order.set(maker, ++asked);
    const refuse = order.get(maker) === call;
    refused ||= refuse;
    return refuse;
  };
  for (const key of keys) {
    const original = prototype[key] as NativeMethod;
    if (typeof original !== 'function') throw new Error(`${name} has no ${key}`);
    const replacement = function (this: object, ...input: unknown[]) { return refuses(this) ? (key === 'IsDone' ? false : null) : original.apply(this, input); } as NativeMethod;
    copyDispatch(original, replacement);
    Object.defineProperty(prototype, key, { configurable: true, writable: true, value: replacement });
  }
  return {
    refused: () => refused,
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(prototype, key, descriptor);
        else delete prototype[key];
      }
    }
  };
}

/**
 * Makes the call-th call of a native method, named `Class.Method` and patched on the prototype that defines it, throw
 * error instead of running. Install it after a watch and restore it before the watch.
 */
export function failCadKernelMethod(label: string, call: number, error: Error): { failed(): boolean; restore(): void } {
  const [className, key, ...rest] = label.split('.');
  const type = className ? (getOC() as unknown as Record<string, unknown>)[className] : undefined;
  if (!isNativeClass(type) || !key || rest.length) throw new Error(`Unknown native method ${label}`);
  let owner: Record<string, unknown> | null = type.prototype;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, key)) owner = Object.getPrototypeOf(owner) as Record<string, unknown> | null;
  if (!owner || typeof owner[key] !== 'function') throw new Error(`Unknown native method ${label}`);
  const target = owner, original = target[key] as NativeMethod;
  let calls = 0;
  const replacement = function (this: unknown, ...input: unknown[]) { if (++calls === call) throw error; return original.apply(this, input); } as NativeMethod;
  copyDispatch(original, replacement);
  target[key] = replacement;
  return { failed: () => calls >= call, restore() { target[key] = original; } };
}
