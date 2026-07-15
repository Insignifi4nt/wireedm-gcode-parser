import { describe, expect, it } from 'vitest';

import { resolveInitialWirePosition } from '../initialWirePosition';
import type { PathPlanningDocument } from '../types';

describe('resolveInitialWirePosition', () => {
  it('returns a reviewed manual part-relative point', () => {
    expect(
      resolveInitialWirePosition(
        documentWithSetup({ kind: 'manual', point: { x: -17.5, y: 24.9 }, review: 'reviewed' })
      )
    ).toEqual({ status: 'ready', point: { x: -17.5, y: 24.9 }, source: 'manual' });
  });

  it('blocks a manual point that needs review', () => {
    expect(
      resolveInitialWirePosition(
        documentWithSetup({
          kind: 'manual',
          point: { x: 1, y: 2 },
          review: 'required',
          reviewReason: 'geometry-transformed'
        })
      )
    ).toEqual({ status: 'blocked', reason: 'review-required' });
  });

  it('resolves a geometry-linked circle center from current geometry', () => {
    const document = documentWithSetup({
      kind: 'geometry-linked',
      point: { x: 0, y: 0 },
      reference: { kind: 'circle-center', segmentId: 'circle-1' },
      review: 'reviewed'
    });
    document.segments = [
      {
        id: 'circle-1',
        kind: 'circle',
        center: { x: 17.5, y: 24.9 },
        radius: 8,
        preferredStart: { x: 25.5, y: 24.9 },
        start: { x: 25.5, y: 24.9 },
        end: { x: 25.5, y: 24.9 },
        length: Math.PI * 16,
        bounds: { minX: 9.5, minY: 16.9, maxX: 25.5, maxY: 32.9 },
        layer: null,
        source: { sourceEntityIndex: 0, sourceEntityType: 'circle', layer: null, exact: true }
      }
    ];

    expect(resolveInitialWirePosition(document)).toEqual({
      status: 'ready',
      point: { x: 17.5, y: 24.9 },
      source: 'geometry-linked'
    });
  });

  it('blocks a missing geometry reference', () => {
    expect(
      resolveInitialWirePosition(
        documentWithSetup({
          kind: 'geometry-linked',
          point: { x: 0, y: 0 },
          reference: { kind: 'circle-center', segmentId: 'missing' },
          review: 'reviewed'
        })
      )
    ).toEqual({ status: 'blocked', reason: 'missing-reference' });
  });
});

function documentWithSetup(
  initialWirePosition: NonNullable<PathPlanningDocument['setup']>['initialWirePosition']
): PathPlanningDocument {
  return {
    schemaVersion: 1,
    geometryBasis: 'finished-contour',
    setup: { initialWirePosition },
    source: { kind: 'dxf-entities', entityCount: 0 },
    options: {} as PathPlanningDocument['options'],
    segments: [],
    endpointClusters: [],
    chains: [],
    contours: [],
    pathElements: [],
    rootPathElementIds: [],
    plan: { operations: [], metrics: { operationCount: 0, totalCutLength: 0, totalRapidLength: 0 }, diagnostics: [] },
    diagnostics: []
  };
}
