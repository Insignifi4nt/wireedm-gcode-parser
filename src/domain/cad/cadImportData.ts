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
