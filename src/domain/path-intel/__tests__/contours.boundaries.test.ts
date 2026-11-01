import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return { type: 'line', layer: 'CUT', start: { x: startX, y: startY }, end: { x: endX, y: endY } };
}

/**
 * A sliver with vertices (0, 0), (2, 0), (1, h) and (0.5, h). Twice its area is 2.5 h. Its vertex
 * average is (0.875, h / 2) and its area centroid is (0.9, 0.4 h), so the label point shows which one
 * contour analysis used. The coincidence is tiny so the thin sliver keeps all four corners.
 */
function sliverLabelPoint(height: number) {
  const document = createPathPlanningDocumentFromDxfEntities(
    [line(0, 0, 2, 0), line(2, 0, 1, height), line(1, height, 0.5, height), line(0.5, height, 0, 0)],
    { endpointTolerance: 0, coincidenceEpsilon: 1e-14 }
  );
  expect(document.contours).toHaveLength(1);
  expect(document.contours[0].closed).toBe(true);
  return document.contours[0].representativePoint!;
}

describe('degenerate contour area for the label point', () => {
  it('places the label at the vertex average when twice the area is 4e-10 square mm', () => {
    const point = sliverLabelPoint(1.6e-10);

    expect(point.x).toBeCloseTo(0.875, 12);
    expect(point.y / 1.6e-10).toBeCloseTo(0.5, 9);
  });

  it('places the label at the area centroid when twice the area is 3e-9 square mm', () => {
    const point = sliverLabelPoint(1.2e-9);

    expect(point.x).toBeCloseTo(0.9, 12);
    expect(point.y / 1.2e-9).toBeCloseTo(0.4, 9);
  });
});
