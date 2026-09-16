import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
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

  it('keeps outside travel unknown because finished geometry does not describe stock', () => {
    expect(classifyPositioningMaterial(document, { x: 72, y: 0 }, { x: 73, y: 0 }))
      .toEqual({ status: 'unknown' });
  });
});
