import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { findLeadIntersections, findPositioningIntersections } from '../leadIntersections';

describe('lead intersections', () => {
  const document = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 0, y: 10 } },
    { type: 'circle', layer: 'CUT', center: { x: 5, y: 5 }, radius: 2 }
  ]);
  const inspect = (from: { x: number; y: number }, to = { x: 0, y: 0 }) =>
    findLeadIntersections(from, to, to, document.segments, 1e-5);

  it('permits the intended attachment shared by adjacent segments', () => {
    expect(inspect({ x: -2, y: -2 })).toEqual([]);
  });

  it('detects overlap even when it ends at the intended attachment', () => {
    expect(inspect({ x: 5, y: 0 })).toEqual([{ segmentId: document.segments[0].id, kind: 'overlap' }]);
  });

  it('detects a circular boundary crossed before reaching the attachment', () => {
    expect(inspect({ x: 10, y: 10 })).toEqual([{ segmentId: document.segments[2].id, kind: 'crossing' }]);
  });

  it('detects contact at the free endpoint but does not report zero-length leads', () => {
    expect(inspect({ x: 0, y: 5 }, { x: -5, y: 5 })).toEqual([{ segmentId: document.segments[1].id, kind: 'crossing' }]);
    expect(inspect({ x: 0, y: 0 })).toEqual([]);
  });

  it('excludes both positioning attachments while retaining a crossed circular source', () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 0, y: 5 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 5 } },
      { type: 'circle', layer: 'CUT', center: { x: 5, y: 0 }, radius: 1 }
    ]);
    expect(findPositioningIntersections({ x: 0, y: 0 }, { x: 10, y: 0 }, source.segments, 1e-5))
      .toEqual([{ segmentId: source.segments[2].id, kind: 'crossing' }]);
  });
});
