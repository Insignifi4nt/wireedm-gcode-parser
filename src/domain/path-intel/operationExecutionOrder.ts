import type { PathOperation } from './types';

/**
 * Returns the authoritative, non-mutating execution view for a path plan.
 * Imported documents may preserve source-array order independently of orderIndex.
 */
export function orderedPathOperations<T extends Pick<PathOperation, 'id' | 'orderIndex'>>(
  operations: readonly T[]
): T[] {
  return [...operations].sort(
    (left, right) =>
      left.orderIndex - right.orderIndex ||
      left.id.localeCompare(right.id)
  );
}
