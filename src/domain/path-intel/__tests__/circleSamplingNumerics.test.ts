import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { deriveSpanSegment } from '../machiningParticipation';
import { resolveProgramStopPoints } from '../programStops';
import { approximateSegmentRef, createArcSegment, createCircleSegment, pointOnArcAtParameter } from '../segments';

describe('exact circle source sampling', () => {
  it('retains the shallow source-arc sag when squaring its half-angle would underflow', () => {
    const arc = createArcSegment({
      id: 'shallow', source: { sourceEntityIndex: 0, sourceEntityType: 'arc', layer: 'CUT', exact: true },
      start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, center: { x: 0.5, y: 1e200 },
      radius: 1e200, sweepRadians: 1e-200, clockwise: false
    });
    const midpoint = pointOnArcAtParameter(arc, { segmentId: arc.id, reversed: false }, 0.5);
    expect(midpoint.x).toBe(0.5);
    expect(Math.abs(midpoint.y / (-1 / (8e200)) - 1)).toBeLessThan(1e-14);
  });

  it('retains the exact preferred start and quarter-turn endpoint of a partial circle', () => {
    const circle = createCircleSegment({
      id: 'circle', source: { sourceEntityIndex: 0, sourceEntityType: 'circle', layer: 'CUT', exact: true },
      center: { x: 0, y: 0 }, radius: 1e14, preferredStart: { x: 0, y: 1e14 }
    });
    const before = structuredClone(circle);
    const span = deriveSpanSegment(circle, {
      id: 'quarter', sourceSegmentId: circle.id,
      range: { start: 0, end: 0.25 }, participation: 'active-cut'
    });
    expect(span.start).toEqual(circle.preferredStart);
    expect(span.end).toEqual({ x: -1e14, y: 0 });
    expect(span.length).toBe(Math.PI * 1e14 / 2);
    expect(circle).toEqual(before);
  });

  it.each([false, true])('starts a circle approximation at the preferred start, reversed=%s', reversed => {
    const circle = createCircleSegment({
      id: 'circle', source: { sourceEntityIndex: 0, sourceEntityType: 'circle', layer: 'CUT', exact: true },
      center: { x: 3, y: 4 }, radius: 5, preferredStart: { x: 3, y: 9 }
    });
    const points = approximateSegmentRef(circle, { segmentId: circle.id, reversed }, Math.PI / 2);
    expect(points).toHaveLength(9);
    expect(points[0]).toEqual(circle.preferredStart);
    expect(points.at(-1)).toEqual(circle.preferredStart);
    expect(points[2]).toEqual({ x: reversed ? 8 : -2, y: 4 });
    expect(points[4]).toEqual({ x: 3, y: -1 });
  });

  it.each([false, true])('resolves a half-circle stop without an amplified sine residual, reversed=%s', reversed => {
    const document = createUpidFromDxfEntities([{
      type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1e14
    }]);
    const operation = document.plan.operations[0];
    operation.segmentRefs[0].reversed = reversed;
    operation.programStops = [{ id: 'half', enabled: true, reason: 'operator-check',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: document.segments[0].length / 2 } }];
    const before = structuredClone(document);
    const resolved = resolveProgramStopPoints(document, operation.id);
    expect(resolved).toMatchObject({ status: 'ready', stops: [{ point: { x: -1e14, y: 0 } }] });
    expect(document).toEqual(before);
  });
});
