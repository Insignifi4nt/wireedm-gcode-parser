/**
 * Recursively freeze plain CAD data in place and return it.
 * `skipFrozen` stops at already frozen subtrees, for results that borrow accepted
 * deeply frozen snapshots; leave it off when a frozen container may hold mutable children.
 */
export function deepFreezeCadData<T>(value: T, options: { readonly skipFrozen?: boolean } = {}): T {
  if (value === null || typeof value !== 'object' || options.skipFrozen && Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeCadData(child, options);
  return Object.freeze(value);
}
