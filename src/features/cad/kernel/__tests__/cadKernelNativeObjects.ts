import { getOC } from 'replicad';

interface NativeObject { isDeleted(): boolean }
type Owner = Record<PropertyKey, unknown>;
type NativeClass = (new (...input: unknown[]) => NativeObject) & { prototype: Owner } & Owner;
type NativeMethod = ((this: unknown, ...input: unknown[]) => unknown) & Record<string, unknown>;
/** The OpenCascade module, or a module shaped like it: its classes and functions by name. */
export type CadKernelNativeModule = Record<string, unknown>;

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
/** Properties that are not methods: a function's own and a prototype's constructor. */
const notMethods = new Set<PropertyKey>(['length', 'name', 'prototype', 'arguments', 'caller', 'constructor']);

/** Embind dispatches overloads through properties of the method, such as overloadTable, which its replacement needs too. */
function copyDispatch(original: NativeMethod, replacement: NativeMethod) {
  for (const property of Object.getOwnPropertyNames(original)) {
    if (!['length', 'name', 'prototype', 'arguments', 'caller'].includes(property)) replacement[property] = original[property];
  }
}

interface Patch { readonly owner: Owner; readonly key: PropertyKey; readonly label: string }

/**
 * Wraps each patched method or property getter so that every native object it returns, other than the object it was
 * called on, is recorded under its label, and proxies each named class so that every object it constructs is recorded
 * under the class name. An object is outstanding until its owner deletes it, and the watch holds it, so garbage
 * collection cannot release it in the owner's place.
 */
function install(module: CadKernelNativeModule, classes: readonly string[], patches: readonly Patch[]): CadKernelNativeObjectWatch {
  const registry = module as Record<string, NativeClass>;
  let live: { readonly name: string; readonly value: NativeObject }[] = [], made = 0;
  // deleteLater returns the object it schedules, which is not a new one.
  const record = (name: string, value: unknown, receiver: unknown) => { if (isNative(value) && value !== receiver) { live.push({ name, value }); made++; } };
  const properties: { owner: Owner; key: PropertyKey; descriptor: PropertyDescriptor }[] = [];
  const constructors: (readonly [string, NativeClass])[] = [];
  const restore = () => {
    for (const [name, original] of constructors) registry[name] = original;
    for (const { owner, key, descriptor } of properties.splice(0).reverse()) Object.defineProperty(owner, key, descriptor);
    live = [];
  };
  const wrap = (original: NativeMethod, label: string) => {
    const wrapper = function (this: unknown, ...input: unknown[]) { const value = original.apply(this, input); record(label, value, this); return value; } as NativeMethod;
    copyDispatch(original, wrapper);
    return wrapper;
  };
  try {
    for (const { owner, key, label } of patches) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (!descriptor) throw new Error(`Unknown native method ${label}`);
      Object.defineProperty(owner, key, descriptor.get
        ? { ...descriptor, get: wrap(descriptor.get as NativeMethod, label) }
        : { ...descriptor, value: wrap(descriptor.value as NativeMethod, label) });
      properties.push({ owner, key, descriptor });
    }
    for (const name of classes) {
      const original = registry[name];
      if (!isNativeClass(original)) throw new Error(`Unknown native class ${name}`);
      registry[name] = new Proxy(original, { construct(target, input) { const value = new target(...input); record(name, value, undefined); return value; } });
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
  const module = getOC() as unknown as CadKernelNativeModule, registry = module as Record<string, NativeClass>;
  const patches: Patch[] = [];
  for (const label of returns) {
    const [className, key, ...rest] = label.split('.');
    const type = className ? registry[className] : undefined;
    if (!isNativeClass(type) || !key || rest.length) throw new Error(`Unknown native method ${label}`);
    let owner: Owner | null = type.prototype;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, key)) owner = Object.getPrototypeOf(owner) as Owner | null;
    if (!owner || typeof owner[key] !== 'function') throw new Error(`Unknown native method ${label}`);
    if (patches.some(item => item.owner === owner && item.key === key)) throw new Error(`${label} is already watched through another class`);
    patches.push({ owner, key, label });
  }
  return install(module, names, patches);
}

/** Every method and property getter an owner defines itself, labelled `prefix.key`. */
function ownMethods(owner: Owner, prefix: string): Patch[] {
  const patches: Patch[] = [];
  for (const key of Reflect.ownKeys(owner)) {
    if (notMethods.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const callable = descriptor && ((typeof descriptor.value === 'function' && descriptor.writable) || typeof descriptor.get === 'function');
    if (callable) patches.push({ owner, key, label: `${prefix}.${typeof key === 'symbol' ? `[${key.description}]` : key}` });
  }
  return patches;
}

/**
 * Records every native object the OpenCascade module hands to kernel or Replicad code until restored. The watched list is
 * read from the module, so a new adapter's constructions and queries are watched without being named, and nothing is
 * exempt:
 * - each object any class constructs, labelled with the class;
 * - each object any instance method, static function or property getter returns, labelled `Class.Method` with the class
 *   that defines it;
 * - the same for every prototype a class inherits that no class of the module owns, such as embind's shared base,
 *   labelled `ClassHandle`, whose `clone` returns a new handle that keeps the object alive until it too is deleted;
 * - each object a function of the module itself returns, labelled with its name.
 *
 * A result that is the object the method was called on, such as `deleteLater`'s, is not a new object. Handle results,
 * such as the curve a curve maker's Value or GeomLib.To3d returns, are objects of the class they point to; embind
 * releases them when they are collected, but they are counted, like every other object, until their owner deletes them.
 * A module shaped like OpenCascade's can be given instead, to test the watch itself.
 */
export function watchEveryCadKernelNativeObject(module = getOC() as unknown as CadKernelNativeModule): CadKernelNativeObjectWatch {
  const classes: string[] = [], patches: Patch[] = [], types: NativeClass[] = [], owned = new Set<object>();
  for (const name of Object.keys(module)) {
    const type = module[name];
    if (typeof type === 'function' && !isNativeClass(type)) {
      if (Object.getOwnPropertyDescriptor(module, name)?.writable) patches.push({ owner: module, key: name, label: name });
      continue;
    }
    if (!isNativeClass(type) || owned.has(type.prototype)) continue;
    owned.add(type.prototype); classes.push(name); types.push(type);
    patches.push(...ownMethods(type, name), ...ownMethods(type.prototype, name));
  }
  for (const type of types) {
    for (let owner = Object.getPrototypeOf(type.prototype) as Owner | null; owner && owner !== Object.prototype; owner = Object.getPrototypeOf(owner) as Owner | null) {
      if (owned.has(owner)) continue;
      owned.add(owner);
      const root = Object.getPrototypeOf(owner) === Object.prototype;
      patches.push(...ownMethods(owner, root ? 'ClassHandle' : String((owner.constructor as { name?: unknown } | undefined)?.name ?? 'unnamed')));
    }
  }
  return install(module, classes, patches);
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
