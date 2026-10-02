import { describe, expect, it } from 'vitest';
import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';
import { planOperations } from '../planOperations';
import { pathStartPoint, reversePathRefs, segmentMap } from '../segments';
import type { Point2 } from '../types';

describe('closed chain arrangements', () => {
  it.each([
    { startPoint: { x: 0, y: 0 }, expectedStart: { x: -1, y: -1 } },
    { startPoint: { x: 10, y: 0 }, expectedStart: { x: 1, y: -1 } },
    { startPoint: { x: 0, y: 10 }, expectedStart: { x: -1, y: 1 } }
  ])('retains forward traversal and coordinate tie breaks from $startPoint', ({ startPoint, expectedStart }) => {
    const document = square(startPoint);
    const operation = document.plan.operations[0];
    expect(operation.startPoint).toEqual(expectedStart);
    expect(operation.endPoint).toEqual(expectedStart);
    expect(operation.direction).toBe('forward');
    const sourceRefs = document.chains[0].segmentRefs;
    const startIndex = sourceRefs.findIndex((ref) => ref.segmentId === operation.segmentRefs[0].segmentId);
    expect(operation.segmentRefs).toEqual([...sourceRefs.slice(startIndex), ...sourceRefs.slice(0, startIndex)]);
  });

  it('can select reverse traversal when its snapped closing endpoint is nearer', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { type: 'line', layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0.0005 } }
    ], { startPoint: { x: 0, y: 0.0005 }, allowReverseClosedContours: true });
    expect(document.chains[0].closed).toBe(true);
    const reversed = reversePathRefs(document.chains[0].segmentRefs);
    const expectedStart = pathStartPoint(reversed, segmentMap(document.segments));
    expect(document.plan.operations[0]).toMatchObject({ direction: 'reverse', startPoint: expectedStart, segmentRefs: reversed });
    const forward = planOperations({ ...document, options: { ...document.options, allowReverseClosedContours: false } });
    expect(forward.operations[0].direction).toBe('forward');
  });

  it('reads a large closed chain a bounded number of times while ranking its starts', () => {
    const count = 1_200;
    const document = createPathPlanningDocumentFromDxfEntities([{
      type: 'lwpolyline', layer: 'CUT', closed: true,
      vertices: Array.from({ length: count }, (_, index) => ({
        x: 50 * Math.cos(index * 2 * Math.PI / count),
        y: 50 * Math.sin(index * 2 * Math.PI / count), bulge: 0
      }))
    }]);
    const expected = document.plan;
    let referenceReads = 0;
    document.chains[0].segmentRefs = new Proxy(document.chains[0].segmentRefs, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) referenceReads += 1;
        return Reflect.get(target, property, receiver);
      }
    });
    expect(planOperations(document)).toEqual(expected);
    expect(referenceReads).toBeLessThan(count * 12);
  });

  it('retains source ordering while optimizing the start of each operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 100, y: 0 }, radius: 1 },
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1 }
    ], { operationOrderStrategy: 'source-order' });
    expect(document.plan.operations.map((operation) => operation.provenance.sourceEntityIndices)).toEqual([[0], [1]]);
  });
});

function square(startPoint: Point2) {
  return createPathPlanningDocumentFromDxfEntities([{
    type: 'lwpolyline', layer: 'CUT', closed: true,
    vertices: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x, y, bulge: 0 }))
  }], { startPoint });
}
