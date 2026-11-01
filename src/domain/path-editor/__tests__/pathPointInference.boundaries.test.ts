import { describe, expect, it } from 'vitest';

import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import type { Point2 } from '@/domain/path-intel/types';
import { inferPathPoint, type MagnetizeMode } from '../pathPointInference';

/** The relation inferred on a unit circle at the origin from `sourcePoint`. */
function unitCircleRelation(mode: MagnetizeMode, sourcePoint: Point2) {
  const document = createPathPlanningDocumentFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1 }
  ]);
  return inferPathPoint(document, { mode, hintPoint: { x: 1, y: 0.5 }, sourcePoint })?.relation;
}

describe('path source point inside an arc radius', () => {
  it('falls back to the nearest point for a tangent from 4e-10 mm outside the radius', () => {
    expect(unitCircleRelation('tangent', { x: 1.0000000004, y: 0 })).toBe('nearest-fallback');
  });

  it('finds a tangent from 3e-9 mm outside the radius', () => {
    expect(unitCircleRelation('tangent', { x: 1.000000003, y: 0 })).toBe('tangent');
  });
});

describe('zero-length radial for a perpendicular foot', () => {
  it('falls back to the nearest point from a source 4e-13 mm from the centre', () => {
    expect(unitCircleRelation('perpendicular', { x: 4e-13, y: 0 })).toBe('nearest-fallback');
  });

  it('drops a perpendicular from a source 3e-12 mm from the centre', () => {
    expect(unitCircleRelation('perpendicular', { x: 3e-12, y: 0 })).toBe('perpendicular');
  });
});
