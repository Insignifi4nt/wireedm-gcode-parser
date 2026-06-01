import { describe, expect, it } from 'vitest';

import type { ContourClassification, PathContour } from '../types';
import { buildContourDisplayNames } from '../pathNaming';

describe('pathNaming', () => {
  it('builds stable role-counted display names for contours', () => {
    const contours = [
      contour('contour_0001', 'exterior'),
      contour('contour_0002', 'hole'),
      contour('contour_0003', 'hole'),
      contour('contour_0004', 'island'),
      contour('contour_0005', 'open-chain'),
      contour('contour_0006', 'ambiguous')
    ];

    expect(Object.fromEntries(buildContourDisplayNames(contours))).toEqual({
      contour_0001: 'Exterior 1',
      contour_0002: 'Hole 1',
      contour_0003: 'Hole 2',
      contour_0004: 'Island 1',
      contour_0005: 'Open Chain 1',
      contour_0006: 'Ambiguous 1'
    });
  });
});

function contour(id: string, classification: ContourClassification): PathContour {
  return {
    id,
    label: id,
    provenance: {
      exact: true,
      layers: [],
      sourceEntityIndices: [],
      sourceEntityTypes: []
    },
    chainId: `chain_${id}`,
    closed: classification !== 'open-chain',
    classification,
    signedArea: null,
    area: null,
    orientation: null,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    containmentDepth: 0,
    parentId: null,
    childIds: [],
    representativePoint: null,
    approximatePolygon: [],
    confidence: 1,
    diagnosticIds: []
  };
}
