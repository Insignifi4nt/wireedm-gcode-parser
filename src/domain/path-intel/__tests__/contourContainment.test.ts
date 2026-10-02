import { describe, expect, it } from 'vitest';
import { suggestCompensationIntent } from '@/domain/compensation/intent';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import type { DxfEntity } from '@/domain/dxf/types';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';

describe('exact contour containment', () => {
  it('keeps a thin concave exterior independent of a circle surrounding its centroid', () => {
    const document = createUpidFromDxfEntities([
      polygon([[0, 0], [10, 0], [10, 0.1], [0.1, 0.1], [0.1, 9.9], [10, 9.9], [10, 10], [0, 10]]),
      { type: 'circle', layer: 'CUT', center: { x: 3.37, y: 5 }, radius: 1.2 }
    ]);

    expect(validateUpidDocument(document).structurallyValid).toBe(true);
    expect(document.diagnostics).toEqual([]);
    expect(document.contours).toHaveLength(2);
    for (const contour of document.contours) {
      expect(contour).toMatchObject({ classification: 'exterior', containmentDepth: 0, parentId: null, childIds: [] });
    }
    const concave = document.plan.operations.find((operation) => operation.segmentRefs.length === 8)!;
    const compensationIntent = suggestCompensationIntent({ document, operation: concave });
    expect(compensationIntent).toMatchObject({ keptMaterial: 'inside' });
    expect(resolveControllerCompensation({ document, operation: { ...concave, compensationIntent } }))
      .toMatchObject({ status: 'ready', keptMaterial: 'inside', winding: 'ccw', wireSide: 'right' });
  });

  it('nests concave boundaries even when their centroids lie in the exterior opening', () => {
    const document = createUpidFromDxfEntities([
      polygon([[0, 0], [10, 0], [10, 1], [1, 1], [1, 9], [10, 9], [10, 10], [0, 10]]),
      polygon([[0.2, 0.2], [9.8, 0.2], [9.8, 0.4], [0.4, 0.4], [0.4, 9.6], [9.8, 9.6], [9.8, 9.8], [0.2, 9.8]]),
      { type: 'circle', layer: 'CUT', center: { x: 0.3, y: 5 }, radius: 0.04 },
      { type: 'circle', layer: 'CUT', center: { x: 5, y: 5 }, radius: 1 }
    ]);
    expect(document.diagnostics).toEqual([]);
    const [exterior, hole, island, separate] = [0, 1, 2, 3].map((sourceIndex) =>
      document.contours.find((contour) => contour.provenance.sourceEntityIndices.includes(sourceIndex))!);
    expect(exterior).toMatchObject({ classification: 'exterior', childIds: [hole.id] });
    expect(hole).toMatchObject({ classification: 'hole', parentId: exterior.id, containmentDepth: 1, childIds: [island.id] });
    expect(island).toMatchObject({ classification: 'island', parentId: hole.id, containmentDepth: 2 });
    expect(separate).toMatchObject({ classification: 'exterior', parentId: null });
    const order = document.plan.operations.map((operation) => operation.contourId);
    expect(order.indexOf(island.id)).toBeLessThan(order.indexOf(hole.id));
    expect(order.indexOf(hole.id)).toBeLessThan(order.indexOf(exterior.id));
  });

  it.each(['circle', 'arc'] as const)('contains a small hole beyond the display chord of an exact %s', (kind) => {
    const outer: DxfEntity[] = kind === 'circle'
      ? [{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10 }]
      : [
          { type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10,
            startAngle: 0, endAngle: 180, clockwise: false, start: { x: 10, y: 0 }, end: { x: -10, y: 0 } },
          { type: 'line', layer: 'CUT', start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }
        ];
    const angle = Math.PI / 36;
    const document = createUpidFromDxfEntities([
      ...outer,
      { type: 'circle', layer: 'CUT', center: { x: 9.98 * Math.cos(angle), y: 9.98 * Math.sin(angle) }, radius: 0.005 }
    ]);
    expect(document.diagnostics).toEqual([]);
    const exterior = document.contours.find((contour) => contour.provenance.sourceEntityIndices.includes(0))!;
    const hole = document.contours.find((contour) => contour.provenance.sourceEntityIndices.includes(outer.length))!;
    expect(exterior).toMatchObject({ classification: 'exterior', childIds: [hole.id] });
    expect(hole).toMatchObject({ classification: 'hole', parentId: exterior.id, containmentDepth: 1 });
  });
});

function polygon(points: number[][]): DxfEntity {
  return { type: 'lwpolyline', layer: 'CUT', closed: true, vertices: points.map(([x, y]) => ({ x, y, bulge: 0 })) };
}
