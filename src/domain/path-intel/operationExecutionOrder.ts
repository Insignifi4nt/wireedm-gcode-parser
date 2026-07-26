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
      compareCodeUnits(left.id, right.id)
  );
}

function compareCodeUnits(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
