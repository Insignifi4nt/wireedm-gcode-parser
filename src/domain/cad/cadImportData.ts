/** Bounded own JSON data, checked before a schema can read any accessor. */
export function isCadImportData(value: unknown): boolean {
  let remaining = 200_000;
  function visit(item: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 24) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item !== 'object') return false;
    const array = Array.isArray(item); const prototype: unknown = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype || item.length > remaining : prototype !== Object.prototype && prototype !== null) return false;
    const fields = Object.getOwnPropertyDescriptors(item); const names = Reflect.ownKeys(fields);
    if (names.length > remaining || array && names.length !== item.length + 1) return false;
    for (const name of names) {
      if (typeof name !== 'string') return false;
      if (array && name === 'length') continue;
      const field = fields[name];
      if (!field.enumerable || !('value' in field) || !visit(field.value, depth + 1)) return false;
    }
    return true;
  }
  try { return visit(value, 0); } catch { return false; }
}
