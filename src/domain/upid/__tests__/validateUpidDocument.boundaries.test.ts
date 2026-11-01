import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '../upidDocument';
import { validateUpidDocument } from '../validateUpidDocument';

/** A 10 mm line whose recorded length is off by `error`. */
function lineWithLengthError(error: number) {
  const document = createUpidFromDxfEntities([{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
  document.segments[0].length = 10 + error;
  return validateUpidDocument(document);
}

/** A circle of radius 5 at (10, 20) whose recorded contour minimum X is off by `error`. */
function circleWithContourBoundsError(error: number) {
  const document = createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }]);
  document.contours[0].bounds.minX = 5 - error;
  return validateUpidDocument(document);
}

describe('UPID recorded value floor', () => {
  it('accepts a recorded segment length 4e-10 mm off its geometry', () => {
    expect(lineWithLengthError(4e-10).structurallyValid).toBe(true);
  });

  it('rejects a recorded segment length 3e-9 mm off its geometry', () => {
    const report = lineWithLengthError(3e-9);

    expect(report.structurallyValid).toBe(false);
    expect(report.structuralDiagnostics).toContainEqual(expect.objectContaining({
      code: 'upid-invalid-value', message: expect.stringContaining('length disagrees with its geometry')
    }));
  });

  it('accepts recorded contour bounds 4e-10 mm off the source geometry', () => {
    expect(circleWithContourBoundsError(4e-10).structurallyValid).toBe(true);
  });

  it('rejects recorded contour bounds 3e-9 mm off the source geometry', () => {
    const report = circleWithContourBoundsError(3e-9);

    expect(report.structurallyValid).toBe(false);
    expect(report.structuralDiagnostics).toContainEqual(expect.objectContaining({
      code: 'upid-identity-mismatch', message: expect.stringContaining('bounds disagree with its owned source geometry')
    }));
  });
});
