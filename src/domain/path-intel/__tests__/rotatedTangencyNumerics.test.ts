import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { mirrorPathDocument, rotatePathDocument, translatePathDocument } from '@/domain/path-editor/pathDocumentOperations';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';

import { classifyPathSegmentIntersection, findPathSegmentIntersectionDiagnostics } from '../intersections';
import type { PathPlanningDocument, Point2 } from '../types';

const tangentEntities: DxfEntity[] = [
  { type: 'line', layer: 'CUT', start: { x: 20, y: 2 }, end: { x: 20, y: 10 } },
  {
    type: 'arc', layer: 'CUT', center: { x: 18, y: 10 }, radius: 2,
    start: { x: 20, y: 10 }, end: { x: 18, y: 12 }, startAngle: 0, endAngle: 90,
    sweepRadians: Math.PI / 2, clockwise: false
  }
];

function rigidTransform(point: Point2): Point2 {
  const angle = 37 * Math.PI / 180;
  return { x: point.x * Math.cos(angle) - point.y * Math.sin(angle) + 31.125,
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle) - 17.75 };
}

function intersectionDiagnostics(document: PathPlanningDocument) {
  return findPathSegmentIntersectionDiagnostics(document.segments, document.chains, document.options);
}

describe('rotated adjacent tangent joins', () => {
  it('retains a single endpoint contact after rotating and translating a line and quarter arc', () => {
    const source = createUpidFromDxfEntities(tangentEntities, { allowReverseOpenChains: false });
    const rotated = rotatePathDocument(source, 37, { x: 0, y: 0 });
    if (!rotated) throw new Error('Expected a rotated document');
    const transformed = translatePathDocument(rotated, { x: 31.125, y: -17.75 });
    if (!transformed) throw new Error('Expected a translated document');
    const relation = classifyPathSegmentIntersection(transformed.segments[0], transformed.segments[1], 1e-5);
    expect(relation.kind).toBe('points');
    expect(relation.points).toHaveLength(1);
    expect(relation.points[0].x).toBeCloseTo(transformed.segments[0].end.x, 10);
    expect(relation.points[0].y).toBeCloseTo(transformed.segments[0].end.y, 10);
    expect(validateUpidDocument(transformed).diagnostics.filter(diagnostic => diagnostic.code === 'intersecting-topology'))
      .toEqual([]);
  });

  it('preserves an already exact tangent join when reflecting full-precision coordinates', () => {
    const source = createUpidFromDxfEntities(tangentEntities.map(entity => entity.type === 'line'
      ? { ...entity, start: rigidTransform(entity.start), end: rigidTransform(entity.end) }
      : entity.type === 'arc' ? { ...entity, start: rigidTransform(entity.start), end: rigidTransform(entity.end),
        center: rigidTransform(entity.center), startAngle: 37, endAngle: 127 } : entity));
    expect(intersectionDiagnostics(source)).toEqual([]);
    const original = structuredClone(source);
    const mirrored = mirrorPathDocument(source, 'x', { x: 0, y: 0 });
    if (!mirrored) throw new Error('Expected a reflected document');
    expect(classifyPathSegmentIntersection(mirrored.segments[0], mirrored.segments[1], 1e-5).points).toHaveLength(1);
    expect(intersectionDiagnostics(mirrored)).toEqual([]);
    expect(mirrored.segments[0].end).toEqual({ x: source.segments[0].end.x, y: -source.segments[0].end.y });
    expect(source).toEqual(original);
  });

  it.each([0.01, 1, 37])('retains an arc-end contact at the start of a line rotated %s degrees', angleDegrees => {
    const source = createUpidFromDxfEntities([
      tangentEntities[0],
      { type: 'arc', layer: 'CUT', center: { x: 18, y: 2 }, radius: 2,
        start: { x: 18, y: 0 }, end: { x: 20, y: 2 }, startAngle: -90, endAngle: 0,
        sweepRadians: Math.PI / 2, clockwise: false }
    ]);
    const rotated = rotatePathDocument(source, angleDegrees, { x: 0, y: 0 });
    if (!rotated) throw new Error('Expected a rotated document');
    const transformed = translatePathDocument(rotated, { x: 31.125, y: -17.75 });
    if (!transformed) throw new Error('Expected a translated document');
    const relation = classifyPathSegmentIntersection(transformed.segments[0], transformed.segments[1], 1e-5);
    expect(relation.points).toHaveLength(1);
    expect(relation.points[0]).toEqual(transformed.segments[0].start);
    expect(intersectionDiagnostics(transformed)).toEqual([]);
  });

  it.each([Math.PI / 2, 1e-6])('retains a second crossing near a shared endpoint on a %s-radian arc', sweepRadians => {
    // The line leaves (1, 0) with a small inward slope and crosses again about 2e-7 mm later.
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 1, y: 0 }, end: { x: 1 - 1e-10, y: 1e-3 } },
      { type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1,
        start: { x: 1, y: 0 }, end: { x: Math.cos(sweepRadians), y: Math.sin(sweepRadians) },
        startAngle: 0, endAngle: sweepRadians * 180 / Math.PI, sweepRadians, clockwise: false }
    ], { endpointTolerance: 1e-8, coincidenceEpsilon: Math.min(1e-5, sweepRadians / 10) });
    const relation = classifyPathSegmentIntersection(source.segments[0], source.segments[1], 1e-5);
    expect(relation.points).toHaveLength(2);
    expect(relation.points.some(point => point.y > 1e-7 && point.y < 3e-7)).toBe(true);
    expect(intersectionDiagnostics(source)).toHaveLength(1);
  });

  it('treats a kernel section tangent split by a few coordinate ulps as one junction', () => {
    // Exact OCCT section output for a rounded plate corner: the arc tangent at the
    // shared endpoint leans 4.7e-15 radians, so its second root sits 3e-14 mm away.
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 60, y: 3 }, end: { x: 60, y: 37 } },
      { type: 'arc', layer: 'CUT', center: { x: 57.00000000000001, y: 37.000000000000014 }, radius: 2.9999999999999893,
        start: { x: 57, y: 40 }, end: { x: 60, y: 37 }, startAngle: 1.570796326794899, endAngle: -4.6629367034256575e-15,
        sweepRadians: -1.5707963267949037, clockwise: true }
    ] as DxfEntity[], { endpointTolerance: 1e-7, coincidenceEpsilon: 1e-9 });
    expect(classifyPathSegmentIntersection(source.segments[0], source.segments[1], 1e-9).points).toHaveLength(1);
    expect(intersectionDiagnostics(source)).toEqual([]);
  });

  it('retains two nonadjacent near-tangent crossings within the endpoint coincidence tolerance', () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 1 - 5e-13, y: -1e-3 }, end: { x: 1 - 5e-13, y: 1e-3 } },
      { type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1,
        start: { x: 0, y: -1 }, end: { x: 0, y: 1 }, startAngle: -90, endAngle: 90,
        sweepRadians: Math.PI, clockwise: false }
    ], { coincidenceEpsilon: 1e-5 });
    expect(classifyPathSegmentIntersection(source.segments[0], source.segments[1], 1e-5).points).toHaveLength(2);
    expect(intersectionDiagnostics(source)).toHaveLength(1);
  });

  it('retains a distinct second crossing just above local angular roundoff on a tiny arc', () => {
    const sweepRadians = 1e-12;
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 1, y: 0 }, end: { x: 1 - 1e-13, y: 1 } },
      { type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1,
        start: { x: 1, y: 0 }, end: { x: Math.cos(sweepRadians), y: Math.sin(sweepRadians) },
        startAngle: 0, endAngle: sweepRadians * 180 / Math.PI, sweepRadians, clockwise: false }
    ], { endpointTolerance: 1e-14, coincidenceEpsilon: 1e-14 });
    const relation = classifyPathSegmentIntersection(source.segments[0], source.segments[1], 1e-14);
    expect(relation.points).toHaveLength(2);
    expect(relation.points.some(point => point.y > 1.9e-13 && point.y < 2.1e-13)).toBe(true);
    expect(intersectionDiagnostics(source)).toHaveLength(1);
  });

  it('retains a real ten-millimeter crossing with a small parameter on a large exact-radius arc', () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 3e14, y: 4e14 }, end: { x: -1e14 - 3, y: 7e14 - 4 } },
      { type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5e14,
        start: { x: 3e14, y: 4e14 }, end: { x: -4e14, y: 3e14 },
        startAngle: Math.atan2(4, 3) * 180 / Math.PI, endAngle: Math.atan2(3, -4) * 180 / Math.PI,
        sweepRadians: Math.PI / 2, clockwise: false }
    ]);
    const relation = classifyPathSegmentIntersection(source.segments[0], source.segments[1], 1e-5);
    expect(relation.points).toHaveLength(2);
    expect(relation.points.some(point => Math.hypot(point.x - 3e14, point.y - 4e14) > 9
      && Math.hypot(point.x - 3e14, point.y - 4e14) < 11)).toBe(true);
    expect(intersectionDiagnostics(source)).toHaveLength(1);
  });

  it('keeps nearby roots distinct when their tiny-arc parameters differ even if line parameters are within roundoff', () => {
    const sweepRadians = 1e-12;
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 1, y: 0 }, end: { x: 1 - 1e-16, y: 1 } },
      { type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1,
        start: { x: 1, y: 0 }, end: { x: 1, y: Math.sin(sweepRadians) },
        startAngle: 0, endAngle: sweepRadians * 180 / Math.PI, sweepRadians, clockwise: false }
    ], { endpointTolerance: 1e-18, coincidenceEpsilon: 1e-18 });
    const relation = classifyPathSegmentIntersection(source.segments[0], source.segments[1], 1e-18);
    expect(relation.points).toHaveLength(2);
    expect(relation.points.some(point => point.y > 2e-16 && point.y < 3e-16)).toBe(true);
    expect(intersectionDiagnostics(source)).toHaveLength(1);
  });

  it('retains positive-length overlap after a rigid rotation', () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 1, y: 0 }, end: { x: 3, y: 0 } }
    ]);
    const rotated = rotatePathDocument(source, 37, { x: 0, y: 0 });
    if (!rotated) throw new Error('Expected a rotated document');
    expect(classifyPathSegmentIntersection(rotated.segments[0], rotated.segments[1], 1e-5).kind).toBe('overlap');
    expect(validateUpidDocument(rotated).blockingDiagnostics).toContainEqual(expect.objectContaining({ code: 'overlapping-segment' }));
  });

  it('keeps an exact tangent contact reportable when the segments have no allowed adjacent junction', () => {
    const source = createUpidFromDxfEntities(tangentEntities);
    const rotated = rotatePathDocument(source, 37, { x: 0, y: 0 });
    if (!rotated) throw new Error('Expected a rotated document');
    expect(findPathSegmentIntersectionDiagnostics(rotated.segments, [], rotated.options)).toHaveLength(1);
  });

  it('keeps crossings encoded in previously rounded coordinates instead of repairing the stored geometry', () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 45.894080154642, y: -4.116428516864 },
        end: { x: 41.079559969425, y: 2.272655563514 } },
      { type: 'arc', layer: 'CUT', center: { x: 39.482288949331, y: 1.069025517210001 }, radius: 2,
        start: { x: 41.079559969425, y: 2.272655563514 }, end: { x: 38.278658903027, y: 2.6662965373039995 },
        startAngle: 37, endAngle: 127, sweepRadians: Math.PI / 2, clockwise: false }
    ]);
    const original = structuredClone(source);
    expect(classifyPathSegmentIntersection(source.segments[0], source.segments[1], 1e-5).points).toHaveLength(2);
    expect(intersectionDiagnostics(source)).toHaveLength(1);
    expect(source).toEqual(original);
  });

  it.each([
    { angle: 0, start: { x: 0.123456789012345, y: 4e-13 } },
    { angle: 360, start: { x: 0.123456789012345, y: 4e-13 } },
    { angle: -720, start: { x: 0.123456789012345, y: 4e-13 } },
    { angle: 90, start: { x: -4e-13, y: 0.123456789012345 } },
    { angle: 180, start: { x: -0.123456789012345, y: -4e-13 } },
    { angle: 270, start: { x: 4e-13, y: -0.123456789012345 } }
  ])('preserves fine source coordinates at an exact $angle-degree rotation', ({ angle, start }) => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0.123456789012345, y: 4e-13 },
        end: { x: 2.345678901234567, y: 1.012345678912345 } }
    ], {}, { coordinateScaleToMillimeters: 1, appliedUnits: {
      label: 'millimeters', scaleToMillimeters: 1, basis: 'user-confirmed', confirmed: true
    } });
    const original = structuredClone(source);
    const rotated = rotatePathDocument(source, angle, { x: 0, y: 0 });
    expect(rotated?.segments[0].start).toEqual(start);
    expect(rotated?.source).toEqual(source.source);
    expect(source).toEqual(original);
  });

  it('preserves a finite whole-turn identity even when subtracting the origin would overflow', () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 1e308, y: 0 }, end: { x: 1e308, y: 1 } }
    ]);
    const rotated = rotatePathDocument(source, 360, { x: -1e308, y: 0 });
    expect(rotated?.segments).toEqual(source.segments);
  });

  it('rejects a non-finite rotation origin even for a whole-turn identity', () => {
    const source = createUpidFromDxfEntities(tangentEntities);
    const original = structuredClone(source);
    expect(rotatePathDocument(source, 360, { x: NaN, y: 0 })).toBeNull();
    expect(rotatePathDocument(source, 0, { x: 0, y: Infinity })).toBeNull();
    expect(source).toEqual(original);
  });

  it('keeps source geometry unchanged when a caller edits a returned tangent contact', () => {
    const source = createUpidFromDxfEntities(tangentEntities);
    const original = structuredClone(source);
    const relation = classifyPathSegmentIntersection(source.segments[0], source.segments[1], 1e-5);
    expect(relation.points).toHaveLength(1);
    relation.points[0].x = 1234;
    relation.points[0].y = -5678;
    expect(source).toEqual(original);
  });

  it.each([0, 37])('preserves both shared endpoints of a line chord and quarter arc after rotating %s degrees', angleDegrees => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 1, y: 0 }, end: { x: 0, y: 1 } },
      { type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1,
        start: { x: 1, y: 0 }, end: { x: 0, y: 1 }, startAngle: 0, endAngle: 90,
        sweepRadians: Math.PI / 2, clockwise: false }
    ]);
    const original = structuredClone(source);
    const rotated = rotatePathDocument(source, angleDegrees, { x: 0, y: 0 });
    if (!rotated) throw new Error('Expected a rotated document');
    const relation = classifyPathSegmentIntersection(rotated.segments[0], rotated.segments[1], 1e-5);
    expect(relation.points).toHaveLength(2);
    for (const endpoint of [rotated.segments[0].start, rotated.segments[0].end]) {
      expect(relation.points.some(point => Math.hypot(point.x - endpoint.x, point.y - endpoint.y) < 1e-12)).toBe(true);
    }
    expect(intersectionDiagnostics(rotated)).toEqual([]);
    expect(source).toEqual(original);
  });
});
