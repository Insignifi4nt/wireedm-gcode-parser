import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setPathOperationClassification } from '@/domain/path-editor/pathDocumentOperations';
import { classifyPositioningMaterial } from '../positioningMaterial';

describe('positioning material', () => {
  const document = createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 70.5 }
  ]);
  document.geometryBasis = 'finished-contour';

  it('finds the solid annulus between a cut hole and exterior approach', () => {
    expect(classifyPositioningMaterial(document, { x: 0, y: 0 }, { x: 0, y: 72.5 }))
      .toMatchObject({ status: 'crosses-finished-material', materialLengthMm: 65.5 });
  });

  it('does not assume the hole slug has left the stock', () => {
    expect(classifyPositioningMaterial(document, { x: 0, y: 0 }, { x: 0, y: 3 }))
      .toEqual({ status: 'unknown' });
  });

  it('uses reviewed contour roles and leaves inactive reference boundaries unclaimed', () => {
    const hole = document.plan.operations.find((operation) => operation.classification === 'hole');
    if (!hole) throw new Error('Expected hole');
    const overridden = setPathOperationClassification(document, hole.id, 'island');
    if (!overridden) throw new Error('Expected classification override');
    expect(classifyPositioningMaterial(overridden, { x: 0, y: 0 }, { x: 0, y: 3 }).status)
      .toBe('crosses-finished-material');

    const partial = structuredClone(document);
    partial.machiningParticipation = { spans: [{ id: 'inactive',
      sourceSegmentId: partial.segments.find((segment) => segment.kind === 'circle' && segment.radius === 70.5)!.id,
      range: { start: 0, end: 1 }, participation: 'inactive-reference' }] };
    expect(classifyPositioningMaterial(partial, { x: 6, y: 0 }, { x: 8, y: 0 }))
      .toEqual({ status: 'unknown' });
  });

  it('keeps outside travel unknown because finished geometry does not describe stock', () => {
    expect(classifyPositioningMaterial(document, { x: 72, y: 0 }, { x: 73, y: 0 }))
      .toEqual({ status: 'unknown' });
  });

  it('classifies a thin route inside an exact circle beyond the polygon chord', () => {
    const circle = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 100 }
    ]);
    const polygon = circle.contours[0].approximatePolygon;
    const angle = (Math.atan2(polygon[0].y, polygon[0].x) +
      Math.atan2(polygon[1].y, polygon[1].x)) / 2;
    const middle = { x: 99.9999 * Math.cos(angle), y: 99.9999 * Math.sin(angle) };
    const from = { x: middle.x - 0.001 * Math.sin(angle), y: middle.y + 0.001 * Math.cos(angle) };
    const to = { x: middle.x + 0.001 * Math.sin(angle), y: middle.y - 0.001 * Math.cos(angle) };
    const result = classifyPositioningMaterial(circle, from, to);
    expect(result.status).toBe('crosses-finished-material');
    if (result.status === 'crosses-finished-material') expect(result.materialLengthMm).toBeCloseTo(0.002, 9);
  });
});
