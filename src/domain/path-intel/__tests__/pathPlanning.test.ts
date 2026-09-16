import { describe, expect, it } from 'vitest';

import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';
import {
  createArcSegment,
  reversePathRefs,
  segmentMap,
  signedAreaOfPath
} from '../segments';

describe('controller-neutral path planning', () => {
  it('starts imported geometry as a finished contour', () => {
    const document = createPathPlanningDocumentFromDxfEntities([line(0, 0, 10, 0)]);
    expect(document.geometryBasis).toBe('finished-contour');
  });

  it('turns shuffled rectangle lines into one closed operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(10, 5, 0, 5),
      line(0, 0, 10, 0),
      line(0, 5, 0, 0),
      line(10, 0, 10, 5)
    ]);

    expect(document.chains).toHaveLength(1);
    expect(document.chains[0].closed).toBe(true);
    expect(document.plan.operations).toHaveLength(1);
    expect(document.plan.operations[0].segmentRefs).toHaveLength(4);
    expect(document.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
  });

  it('keeps disconnected contours as distinct execution operations', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      ...rectangle(20, 0, 25, 5),
      ...rectangle(0, 0, 5, 5)
    ]);

    expect(document.plan.operations).toHaveLength(2);
    expect(document.plan.operations.map(({ orderIndex }) => orderIndex)).toEqual([0, 1]);
    expect(new Set(document.plan.operations.map(({ contourId }) => contourId)).size).toBe(2);
  });

  it('uses a validated explicit arc sweep without inferring it from endpoint angles', () => {
    const sweepRadians = 4e-16;
    const segment = createArcSegment({
      id: 'seg_explicit',
      source: {
        sourceEntityIndex: 0,
        sourceEntityType: 'lwpolyline',
        layer: 'CUT',
        exact: true
      },
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      center: { x: 0.5, y: 2.5e15 },
      radius: 2.5e15,
      clockwise: false,
      sweepRadians
    });

    expect(segment.sweepRadians).toBe(sweepRadians);
    expect(segment.length).toBeCloseTo(1, 12);
  });

  it.each([
    { sweepRadians: 0, clockwise: false },
    { sweepRadians: Number.POSITIVE_INFINITY, clockwise: false },
    { sweepRadians: 2 * Math.PI + 1e-12, clockwise: false },
    { sweepRadians: -0.25, clockwise: false },
    { sweepRadians: 0.25, clockwise: true }
  ])('rejects an invalid explicit arc sweep', ({ sweepRadians, clockwise }) => {
    expect(() => createArcSegment({
      id: 'seg_invalid',
      source: {
        sourceEntityIndex: 0,
        sourceEntityType: 'arc',
        layer: 'CUT',
        exact: true
      },
      start: { x: 1, y: 0 },
      end: { x: 0, y: 1 },
      center: { x: 0, y: 0 },
      radius: 1,
      clockwise,
      sweepRadians
    })).toThrow(RangeError);
  });

  it('preserves exact circle area sign when traversal is reversed', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 1e12, y: -1e12 }, radius: 3 }
    ]);
    const refs = document.chains[0].segmentRefs;
    const segments = segmentMap(document.segments);

    expect(signedAreaOfPath(refs, segments)).toBe(Math.PI * 9);
    expect(signedAreaOfPath(reversePathRefs(refs), segments)).toBe(-Math.PI * 9);
  });

  it('keeps finite source geometry inspectable when derived contour area overflows', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1e200 }
    ]);

    expect(document.segments.every((segment) => Number.isFinite(segment.length))).toBe(true);
    expect(document.contours[0]).toMatchObject({
      closed: true,
      classification: 'ambiguous',
      signedArea: null,
      area: null
    });
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'non-finite-geometry', severity: 'error' })
    );
  });
});

function rectangle(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    line(minX, minY, maxX, minY),
    line(maxX, minY, maxX, maxY),
    line(maxX, maxY, minX, maxY),
    line(minX, maxY, minX, minY)
  ];
}

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
