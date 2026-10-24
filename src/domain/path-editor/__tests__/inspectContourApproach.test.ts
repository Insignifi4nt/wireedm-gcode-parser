import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { inspectContourApproach } from '../inspectContourApproach';

describe('exact contour approach inspection', () => {
  const doc = createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 70 },
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 20 }
  ]);
  const outer = doc.plan.operations.find(operation => operation.classification === 'exterior')!;
  const inner = doc.plan.operations.find(operation => operation.classification === 'hole')!;
  it('returns the exact nearest reachable straight attachment when the geometric nearest is clear', () => {
    const before = structuredClone(doc);
    expect(inspectContourApproach(doc, { operationId: outer.id, from: { x: 75, y: 0 } }))
      .toMatchObject({ status: 'clear', nearest: { point: { x: 70, y: 0 } }, lengthMm: 5, nearestReachablePoint: { x: 70, y: 0 }, checkedSegmentCount: 2, intersections: [] });
    expect(doc).toEqual(before);
  });
  it('reports another contour crossed before attachment and does not claim no alternate route exists', () => {
    expect(inspectContourApproach(doc, { operationId: inner.id, from: { x: 75, y: 0 } }))
      .toMatchObject({ status: 'blocked', nearest: { point: { x: 20, y: 0 } }, nearestReachablePoint: null, searchedAlternatives: false,
        intersections: [{ segmentId: doc.segments[0].id, kind: 'crossing' }] });
  });
  it('checks a hinted attachment, zero-length approaches and missing operations explicitly', () => {
    expect(inspectContourApproach(doc, { operationId: outer.id, from: { x: 75, y: 0 }, hintPoint: { x: -70, y: 0 } }))
      .toMatchObject({ status: 'blocked', nearestReachablePoint: null, searchedAlternatives: false });
    expect(inspectContourApproach(doc, { operationId: outer.id, from: { x: 70, y: 0 } })).toMatchObject({ status: 'zero-length', nearestReachablePoint: null });
    expect(inspectContourApproach(doc, { operationId: 'missing', from: { x: 75, y: 0 } })).toBeNull();
    expect(inspectContourApproach(doc, { operationId: outer.id, from: { x: NaN, y: 0 } })).toBeNull();
  });
  it('checks all 4,363 segments without tessellating or transferring geometry', () => {
    const count = 4_363;
    const polygon = createUpidFromDxfEntities(Array.from({ length: count }, (_, index) => ({ type: 'line', layer: 'CUT',
      start: { x: 70 * Math.cos(index / count * 2 * Math.PI), y: 70 * Math.sin(index / count * 2 * Math.PI) },
      end: { x: 70 * Math.cos((index + 1) % count / count * 2 * Math.PI), y: 70 * Math.sin((index + 1) % count / count * 2 * Math.PI) } })));
    expect(inspectContourApproach(polygon, { operationId: polygon.plan.operations[0].id, from: { x: 75, y: 0 } }))
      .toMatchObject({ status: 'clear', lengthMm: 5, checkedSegmentCount: count, intersections: [] });
  });
});
