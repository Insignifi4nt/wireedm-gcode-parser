import { describe, expect, it } from 'vitest';
import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';
import { planOperations } from '../planOperations';
import { distance, pathStartPoint, reversePathRefs, segmentMap } from '../segments';
import type { PathOperation, PathPlanningDocument, Point2 } from '../types';

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

  it.each(['nearest', 'inside-out-nearest'] as const)('always %s-ranks the eligible contour with the shortest rapid', (operationOrderStrategy) => {
    // Mixed sizes, nesting and a sheet outline exercise the spatial start lookup.
    const entities = [{ type: 'lwpolyline' as const, layer: 'CUT', closed: true, vertices: rectangle(-30, -30, 520, 520) }];
    for (let index = 0; index < 180; index++) {
      const x = (index * 137) % 460, y = Math.floor((index * 61) % 470);
      const size = 2 + (index % 7) * 2.5;
      entities.push({ type: 'lwpolyline', layer: 'CUT', closed: true, vertices: rectangle(x, y, size, size * 0.8) });
      if (index % 3 === 0) entities.push({ type: 'lwpolyline', layer: 'CUT', closed: true, vertices: rectangle(x + 0.5, y + 0.5, size / 3, size / 4) });
    }
    const document = createPathPlanningDocumentFromDxfEntities(entities, { operationOrderStrategy, startPoint: { x: 250, y: -80 } });

    expect(document.plan.diagnostics).toEqual([]);
    expect(document.plan.operations).toHaveLength(document.contours.length);
    const cut = new Set<string>();
    let position = document.options.startPoint;
    for (const operation of document.plan.operations) {
      const eligible = document.contours.filter((contour) => !cut.has(contour.id) && contour.childIds.every((id) => cut.has(id)));
      expect(eligible.map((contour) => contour.id)).toContain(operation.contourId);
      const shortest = Math.min(...eligible.map((contour) => nearestStart(document, contour.chainId, position)));
      expect(operation.metrics.rapidInLength).toBeLessThanOrEqual(shortest + document.options.coincidenceEpsilon);
      cut.add(operation.contourId);
      position = operation.endPoint;
    }
  });

  it('orders near-tied rapids that differ end to end by more than the epsilon deterministically', () => {
    // Pairwise within the epsilon, end to end beyond it. 0.0.704 changed this order.
    const epsilon = 1e-6;
    const starts = [{ x: 10, y: 0 }, { x: 0, y: 10 + 0.75 * epsilon }, { x: -10 - 1.5 * epsilon, y: 0 }];
    const entities = starts.map(({ x, y }) => ({ type: 'circle' as const, layer: 'CUT', center: { x: x - 0.1, y }, radius: 0.1 }));
    const plan = () => createPathPlanningDocumentFromDxfEntities(entities, { coincidenceEpsilon: epsilon, operationOrderStrategy: 'nearest' })
      .plan.operations.map((operation) => operation.provenance.sourceEntityIndices[0]);

    expect(plan()).toEqual([1, 0, 2]);
    expect(plan()).toEqual(plan());
  });

  it('starts a contour at the first of near-tied vertices by a fixed scan', () => {
    // The same near tie between candidate starts of one contour; 0.0.703 started at (10, 0).
    const epsilon = 1e-6;
    const vertices = [{ x: 10, y: 0 }, { x: -10 - 1.5 * epsilon, y: 0 }, { x: 0, y: 10 + 0.75 * epsilon }];
    const document = createPathPlanningDocumentFromDxfEntities(
      [{ type: 'lwpolyline', layer: 'CUT', closed: true, vertices: vertices.map((point) => ({ ...point, bulge: 0 })) }],
      { coincidenceEpsilon: epsilon, operationOrderStrategy: 'nearest', allowReverseClosedContours: false }
    );

    expect(document.plan.operations[0]?.startPoint).toEqual(vertices[2]);
  });

  it('chooses start and direction among near-tied vertices by a fixed scan', () => {
    // 0.0.703 started forward at (-10 - 1.5 epsilon, 0).
    const epsilon = 1e-6;
    const vertices = [{ x: 10, y: 0 }, { x: 0, y: 10 + 0.75 * epsilon }, { x: -10 - 1.5 * epsilon, y: 0 }, { x: 0, y: -10 - 2.25 * epsilon }];
    const document = createPathPlanningDocumentFromDxfEntities(
      [{ type: 'lwpolyline', layer: 'CUT', closed: true, vertices: vertices.map((point) => ({ ...point, bulge: 0 })) }],
      { coincidenceEpsilon: epsilon, operationOrderStrategy: 'nearest', allowReverseClosedContours: true }
    );

    expect(document.plan.operations[0]).toMatchObject({ startPoint: vertices[1], direction: 'reverse' });
  });

  it('orders open chains whose starts tie by coordinates within the epsilon by a fixed scan', () => {
    // Equal rapids; the start coordinates differ pairwise within the epsilon. 0.0.703 cut [0, 1, 2].
    const epsilon = 1e-6;
    const starts = [0, 2, 1].map((step) => {
      const x = 8 + step * 0.75 * epsilon;
      return { x, y: Math.sqrt(100 - x * x) };
    });
    const entities = starts.map((start) => ({ type: 'line' as const, layer: 'CUT', start, end: { x: 2 * start.x, y: 2 * start.y } }));
    const document = createPathPlanningDocumentFromDxfEntities(entities, {
      coincidenceEpsilon: epsilon, endpointTolerance: 0, operationOrderStrategy: 'nearest', allowReverseOpenChains: false
    });

    expect(document.plan.operations.map((operation) => operation.provenance.sourceEntityIndices[0])).toEqual([2, 0, 1]);
  });

  it('falls back to the nearest remaining contour when prerequisites form a cycle', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 0 }, radius: 1 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 1 },
      { type: 'circle', layer: 'CUT', center: { x: 30, y: 0 }, radius: 1 }
    ], { operationOrderStrategy: 'nearest' });
    const [first, second, third] = document.contours;
    const contours = [{ ...first, childIds: [second.id] }, { ...second, childIds: [first.id] }, { ...third, childIds: [first.id] }];
    const plan = planOperations({ ...document, contours });

    expect(plan.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.relatedContourIds])).toEqual([
      ['route-dependency-cycle', contours.map((contour) => contour.id)]
    ]);
    expect(plan.operations.map(contourIndexIn(contours))).toEqual([0, 1, 2]);
  });
});

function rectangle(x: number, y: number, width: number, height: number) {
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(([vx, vy]) => ({ x: vx, y: vy, bulge: 0 }));
}

function nearestStart(document: PathPlanningDocument, chainId: string, position: Point2) {
  const segmentsById = segmentMap(document.segments);
  const chain = document.chains.find((candidate) => candidate.id === chainId)!;
  return Math.min(...chain.segmentRefs.flatMap(({ segmentId }) => {
    const segment = segmentsById.get(segmentId)!;
    const starts = segment.kind === 'circle' ? [segment.preferredStart] : [segment.start, segment.end];
    return starts.map((start) => distance(position, start));
  }));
}

function contourIndexIn(contours: Array<{ id: string }>) {
  return (operation: PathOperation) => contours.findIndex((contour) => contour.id === operation.contourId);
}

function square(startPoint: Point2) {
  return createPathPlanningDocumentFromDxfEntities([{
    type: 'lwpolyline', layer: 'CUT', closed: true,
    vertices: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x, y, bulge: 0 }))
  }], { startPoint });
}
