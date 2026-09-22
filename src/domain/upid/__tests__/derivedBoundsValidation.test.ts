import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '../upidDocument';
import { validateUpidDocument } from '../validateUpidDocument';

function circle() {
  return createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }]);
}

describe('UPID derived geometry bounds', () => {
  it.each(['contour', 'path-element', 'both'] as const)('rejects stale %s bounds without changing source geometry', (target) => {
    const document = circle();
    const incorrect = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
    if (target !== 'path-element') document.contours[0].bounds = { ...incorrect };
    if (target !== 'contour') document.pathElements[0].bounds = { ...incorrect };
    const before = structuredClone(document);
    const report = validateUpidDocument(document);
    expect(report.structurallyValid).toBe(false);
    expect(report.structuralDiagnostics).toContainEqual(expect.objectContaining({
      code: 'upid-identity-mismatch', message: expect.stringContaining('bounds disagree')
    }));
    expect(document).toEqual(before);
  });

  it('permits floating-point noise in derived bounds', () => {
    const document = circle();
    document.contours[0].bounds.minX += 1e-12;
    document.pathElements[0].bounds.maxY -= 1e-12;
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
  });

  it('keeps arc extrema even when neither endpoint reaches them', () => {
    const document = createUpidFromDxfEntities([{ type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5,
      start: { x: 5, y: 0 }, end: { x: -5, y: 0 }, startAngle: 0, endAngle: 180,
      clockwise: false, sweepRadians: Math.PI }]);
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
    document.contours[0].bounds = { minX: -5, minY: 0, maxX: 5, maxY: 0 };
    document.pathElements[0].bounds = { ...document.contours[0].bounds };
    expect(validateUpidDocument(document).structurallyValid).toBe(false);
  });
});
