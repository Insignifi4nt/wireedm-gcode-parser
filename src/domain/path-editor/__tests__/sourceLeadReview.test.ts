import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { findLeadIntersections } from '@/domain/path-intel/leadIntersections';
import { setClosedOperationStartNearPoint, setPathOperationManualLeadIn, translatePathSegment } from '../pathDocumentOperations';

describe('source geometry lead review', () => {
  it('invalidates a stationary lead when another contour moves across it', () => {
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: -7.5, y: 10 }, radius: 1 }
    ]);
    const first = source.plan.operations.find((operation) => operation.segmentRefs.some((ref) => ref.segmentId === source.segments[0].id))!;
    const started = setClosedOperationStartNearPoint(source, first.id, { x: -5, y: 0 })!;
    const configured = setPathOperationManualLeadIn(started, first.id, { x: -10, y: 0 })!;
    const moved = translatePathSegment(configured, source.segments[1].id, { x: 0, y: -10 })!;
    const entry = moved.plan.operations.find((operation) => operation.id === first.id)?.transitions?.entry;
    expect(entry).toMatchObject({ from: { x: -10, y: 0 },
      to: configured.plan.operations.find((operation) => operation.id === first.id)!.startPoint, review: 'required' });
    expect(findLeadIntersections({ x: -10, y: 0 }, { x: -5, y: 0 }, { x: -5, y: 0 }, moved.segments, 1e-5))
      .toContainEqual({ segmentId: source.segments[1].id, kind: 'crossing' });
    expect(configured.plan.operations.find((operation) => operation.id === first.id)?.transitions?.entry)
      .toMatchObject({ review: 'reviewed' });
  });
});
