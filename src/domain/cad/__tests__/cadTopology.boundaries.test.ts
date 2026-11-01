import { describe, expect, it } from 'vitest';

import { CadError } from '../cadError';
import { parseCadEdgeQuery, resolveCadEdgeQuery, type CadEdgeQuery } from '../cadTopology';

const parallelTo = (direction: readonly [number, number, number]): CadEdgeQuery => ({
  kind: 'edges', expectedCount: 1, predicates: [{ kind: 'parallel', direction }]
});

function errorCode(action: () => unknown): string | null {
  try { action(); return null; } catch (error) { return error instanceof CadError ? error.code : 'unexpected'; }
}

describe('kernel direction tolerance for topology selector directions', () => {
  it('accepts a direction whose length is within the tolerance of one and resolves it to a unit vector', () => {
    const query = parseCadEdgeQuery(parallelTo([0.99999999996, 0, 0]));
    const [predicate] = resolveCadEdgeQuery(query, {}).predicates;
    if (predicate.kind !== 'parallel') throw new Error('Expected a parallel predicate');
    expect(predicate.direction[0]).toBe(1);
    expect(predicate.direction.slice(1)).toEqual([0, 0]);
  });

  it('rejects a direction whose length is beyond the tolerance from one', () => {
    expect(errorCode(() => parseCadEdgeQuery(parallelTo([0.9999999997, 0, 0])))).toBe('invalid-direction');
  });
});
