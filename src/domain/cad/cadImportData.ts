/**
 * The own data fields of a plain object, each read once, or `undefined` when it is not one or a
 * field is a symbol or an accessor. The field values are not checked.
 */
export function cadImportDataFields(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    // Inside the try: a revoked proxy throws here.
    if (Array.isArray(value)) return undefined;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const fields: Record<string, unknown> = Object.create(null);
    for (const name of Reflect.ownKeys(value)) {
      if (typeof name !== 'string') return undefined;
      const field = Object.getOwnPropertyDescriptor(value, name);
      if (!field?.enumerable || !('value' in field)) return undefined;
      fields[name] = field.value;
    }
    return fields;
  } catch {
    return undefined;
  }
}

/** Complete acyclic own JSON data, checked before a schema can read any accessor. */
export function isCadImportData(value: unknown): boolean {
  interface Frame { item: object; names: readonly PropertyKey[]; index: number; arrayLength: number | null }
  const ancestors = new WeakSet<object>();
  const frames: Frame[] = [];
  let current = value;
  try {
    while (true) {
      if (current !== null && typeof current === 'object') {
        if (ancestors.has(current)) return false;
        const array = Array.isArray(current), prototype: unknown = Object.getPrototypeOf(current);
        if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
        const names = Reflect.ownKeys(current);
        let arrayLength: number | null = null;
        if (array) {
          const length: unknown = Object.getOwnPropertyDescriptor(current, 'length')?.value;
          if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || names.length !== length + 1) return false;
          arrayLength = length;
        }
        ancestors.add(current);
        frames.push({ item: current, names, index: 0, arrayLength });
      } else if (typeof current === 'number' ? !Number.isFinite(current)
        : current !== null && typeof current !== 'string' && typeof current !== 'boolean') return false;
      let next = false;
      while (frames.length) {
        const frame = frames[frames.length - 1];
        if (frame.index === frame.names.length) { ancestors.delete(frame.item); frames.pop(); continue; }
        const name = frame.names[frame.index++];
        if (typeof name !== 'string') return false;
        if (frame.arrayLength !== null) {
          if (name === 'length') continue;
          const index = Number(name);
          if (!Number.isSafeInteger(index) || index < 0 || index >= frame.arrayLength || String(index) !== name) return false;
        }
        const field = Object.getOwnPropertyDescriptor(frame.item, name);
        if (!field?.enumerable || !('value' in field)) return false;
        current = field.value; next = true; break;
      }
      if (!next) return true;
    }
  } catch {
    return false;
  }
}

/**
 * A detached plain copy of complete acyclic own JSON data, each field read once through its
 * descriptor, or `undefined` when the value is not such data. Unlike `structuredClone`, it accepts
 * transparent proxies, as `isCadImportData` does. Meant for small envelopes; it recurses.
 */
export function cadImportDataCopy(value: unknown): unknown {
  const ancestors = new WeakSet<object>();
  const copy = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : undefined;
    if (typeof item !== 'object' || ancestors.has(item)) return undefined;
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype) return undefined;
        const names = Reflect.ownKeys(item), length: unknown = Object.getOwnPropertyDescriptor(item, 'length')?.value;
        if (typeof length !== 'number' || !Number.isSafeInteger(length) || names.length !== length + 1) return undefined;
        // The count alone would let an extra named key stand in for a missing index.
        if (names.some(name => name !== 'length' && (typeof name !== 'string' || String(Number(name)) !== name || !Number.isSafeInteger(Number(name)) || Number(name) < 0 || Number(name) >= length))) return undefined;
        const result: unknown[] = [];
        for (let index = 0; index < length; index++) {
          const field = Object.getOwnPropertyDescriptor(item, String(index));
          if (!field?.enumerable || !('value' in field)) return undefined;
          const entry = copy(field.value);
          if (entry === undefined) return undefined;
          result.push(entry);
        }
        return result;
      }
      const fields = cadImportDataFields(item);
      if (!fields) return undefined;
      const result: Record<string, unknown> = {};
      for (const [name, field] of Object.entries(fields)) {
        const entry = copy(field);
        if (entry === undefined) return undefined;
        // Defined, not assigned: assigning a `__proto__` field would call the inherited setter.
        Object.defineProperty(result, name, { value: entry, enumerable: true, writable: true, configurable: true });
      }
      return result;
    } catch {
      return undefined;
    } finally { ancestors.delete(item); }
  };
  return copy(value);
}
