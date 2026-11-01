import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { readUpidEndpointTopologyRows } from '../projectRail';

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return { type: 'line', layer: 'CUT', start: { x: startX, y: startY }, end: { x: endX, y: endY } };
}

/**
 * Two vertical open chains, at x = 0 and x = 1, each snapped across one gap: 1e-4 mm at x = 0 and
 * 1e-4 mm plus `extra` at x = 1. Returns the snapped rows' x positions in rail order.
 */
function snappedRowPositions(extra: number) {
  const document = createPathPlanningDocumentFromDxfEntities([
    line(0, -1, 0, 0), line(0, 1e-4, 0, 1),
    line(1, -1, 1, 0), line(1, 1e-4 + extra, 1, 1)
  ], { endpointTolerance: 0.001, coincidenceEpsilon: 1e-5 });
  return readUpidEndpointTopologyRows(document)
    .filter(row => row.kind === 'snapped-endpoint-cluster')
    .map(row => row.point.x);
}

describe('snapped endpoint gap order', () => {
  it('lists snapped gaps that differ by 4e-13 mm in cluster order', () => {
    expect(snappedRowPositions(4e-13)).toEqual([0, 1]);
  });

  it('lists the wider of two snapped gaps that differ by 3e-12 mm first', () => {
    expect(snappedRowPositions(3e-12)).toEqual([1, 0]);
  });
});
