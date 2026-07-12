import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';

import { analyzeContours } from '../contours';
import { clusterSegmentEndpoints } from '../endpointClusters';
import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';
import { classifyPathSegmentIntersection } from '../intersections';
import { pathPlanToGcodeBody, postPathPlanToGcode } from '../postGcode';
import { sanitizePathSegments } from '../sanitizeSegments';
import {
  createArcSegment,
  createCircleSegment,
  createLineSegment,
  nextDown,
  nextUp,
  pointOnArcAtParameter,
  reversePathRefs,
  segmentMap,
  signedAreaOfSegmentRef,
  signedAreaOfPath
} from '../segments';
import { SpatialHash } from '../spatialIndex';

const DEFAULT_TOLERANCE = 0.01;

describe('path-intel DXF planning', () => {
  it('uses a validated explicit arc sweep without re-inferring it from endpoint angles', () => {
    const sweepRadians = 4e-16;
    const segment = createArcSegment({
      id: 'seg_explicit',
      source: {
        sourceEntityIndex: 0,
        sourceEntityType: 'lwpolyline',
        layer: 'CUT',
        exact: true
      },
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      center: { x: 0.5, y: 2.5e15 },
      radius: 2.5e15,
      clockwise: false,
      sweepRadians
    });

    expect(segment.sweepRadians).toBe(sweepRadians);
    expect(segment.length).toBeCloseTo(1, 12);
    expect(segment.bounds.minX).toBeLessThanOrEqual(0);
    expect(segment.bounds.maxX).toBeGreaterThanOrEqual(1);
  });

  it.each([
    { label: 'zero', sweepRadians: 0, clockwise: false },
    { label: 'non-finite', sweepRadians: Number.POSITIVE_INFINITY, clockwise: false },
    { label: 'over-full-turn', sweepRadians: 2 * Math.PI + 1e-12, clockwise: false },
    { label: 'counterclockwise-negative', sweepRadians: -0.25, clockwise: false },
    { label: 'clockwise-positive', sweepRadians: 0.25, clockwise: true }
  ])('rejects a $label explicit arc sweep', ({ sweepRadians, clockwise }) => {
    expect(() =>
      createArcSegment({
        id: 'seg_invalid_explicit',
        source: {
          sourceEntityIndex: 0,
          sourceEntityType: 'arc',
          layer: 'CUT',
          exact: true
        },
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        center: { x: 0, y: 0 },
        radius: 1,
        clockwise,
        sweepRadians
      })
    ).toThrow(RangeError);
  });

  it.each([
    { label: '1e20 chord / positive 1e-16 bulge', chordLength: 1e20, bulge: 1e-16 },
    { label: '1e20 chord / negative 1e-16 bulge', chordLength: 1e20, bulge: -1e-16 },
    { label: '5e15 chord / positive 1e-13 bulge', chordLength: 5e15, bulge: 1e-13 },
    { label: '5e15 chord / negative 1e-13 bulge', chordLength: 5e15, bulge: -1e-13 }
  ])(
    'computes cancellation-safe circular-segment area for $label',
    ({ chordLength, bulge }) => {
      const document = createPathPlanningDocumentFromDxfEntities([
        closedBulgePolyline(
          { x: 0, y: 0 },
          { x: chordLength, y: 0 },
          bulge
        )
      ]);
      const contour = document.contours[0];
      const expectedArea = (chordLength * chordLength * bulge) / 3;

      expect(contour?.closed).toBe(true);
      expect(contour?.signedArea).not.toBeNull();
      expect(
        Math.abs((contour!.signedArea! - expectedArea) / expectedArea)
      ).toBeLessThan(1e-12);
      expect(Math.sign(contour!.signedArea!)).toBe(Math.sign(bulge));
      expect(document.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
        'degenerate-contour'
      );

      const segmentsById = segmentMap(document.segments);
      const refs = document.chains[0].segmentRefs;
      const reversedArea = signedAreaOfPath(reversePathRefs(refs), segmentsById);
      expect(reversedArea).toBe(-contour!.signedArea!);
    }
  );

  it.each([
    { chordLength: 1e20, bulge: 1e-16, offset: 1e30 },
    { chordLength: 5e15, bulge: -1e-13, offset: -1e25 }
  ])(
    'retains tiny circular-segment area at a huge finite offset ($offset)',
    ({ chordLength, bulge, offset }) => {
      const start = { x: offset, y: -offset };
      const end = { x: offset + chordLength, y: -offset };
      const actualChord = end.x - start.x;
      const document = createPathPlanningDocumentFromDxfEntities([
        closedBulgePolyline(start, end, bulge)
      ]);
      const area = document.contours[0]?.signedArea;
      const expectedArea = (actualChord * actualChord * bulge) / 3;

      expect(area).not.toBeNull();
      expect(Math.abs((area! - expectedArea) / expectedArea)).toBeLessThan(1e-12);
      expect(document.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
        'degenerate-contour'
      );
    }
  );

  it('preserves exact circle area sign when path references are reversed', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 1e20, y: -1e20 }, radius: 3 }
    ]);
    const segmentsById = segmentMap(document.segments);
    const refs = document.chains[0].segmentRefs;

    expect(signedAreaOfPath(refs, segmentsById)).toBe(Math.PI * 9);
    expect(signedAreaOfPath(reversePathRefs(refs), segmentsById)).toBe(-Math.PI * 9);
  });

  it.each([
    {
      label: 'circle',
      entity: {
        type: 'circle',
        layer: 'CUT',
        center: { x: 0, y: 0 },
        radius: 1e200
      } satisfies DxfEntity
    },
    {
      label: 'closed huge-bulge polyline',
      entity: closedBulgePolyline(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        1e200
      )
    }
  ])('keeps $label geometry inspectable when contour area overflows', ({ entity }) => {
    const document = createPathPlanningDocumentFromDxfEntities([entity]);
    const contour = document.contours[0];
    const chain = document.chains[0];
    const diagnostic = document.diagnostics.find(
      (candidate) => candidate.code === 'non-finite-geometry'
    );

    expect(document.segments.every(pathSegmentNumbersAreFinite)).toBe(true);
    expect(contour).toMatchObject({
      closed: true,
      classification: 'ambiguous',
      signedArea: null,
      area: null,
      orientation: null,
      representativePoint: null
    });
    expect(diagnostic).toMatchObject({
      severity: 'error',
      code: 'non-finite-geometry',
      relatedChainIds: [chain.id],
      relatedSegmentIds: chain.segmentRefs.map((ref) => ref.segmentId),
      relatedContourIds: [contour.id]
    });
    expect(document.plan.operations).toHaveLength(1);
    expect(document.plan.operations[0].classification).toBe('ambiguous');
    expect(Object.values(document.plan.operations[0].metrics).every(Number.isFinite)).toBe(true);
  });

  it('keeps ordinary forward and reversed circle contour metrics finite', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 3 }
    ]);
    const chain = document.chains[0];
    const reversed = analyzeContours(
      [{ ...chain, segmentRefs: reversePathRefs(chain.segmentRefs) }],
      document.segments,
      document.options
    );

    expect(document.contours[0]).toMatchObject({
      signedArea: Math.PI * 9,
      area: Math.PI * 9,
      orientation: 'ccw'
    });
    expect(reversed.contours[0]).toMatchObject({
      signedArea: -Math.PI * 9,
      area: Math.PI * 9,
      orientation: 'cw'
    });
    expect(reversed.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'non-finite-geometry'
    );
  });

  it('retains a small multi-segment area residual with compensated summation', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2e16, y: 0 },
      { x: 0, y: 1 },
      { x: -2, y: 0 },
      { x: 0, y: -1 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 2e16, y: 0 },
      { x: 0, y: 0 }
    ];
    const segments = points.slice(0, -1).map((start, index) =>
      createLineSegment({
        id: `seg_compensated_${index}`,
        source: {
          sourceEntityIndex: index,
          sourceEntityType: 'line',
          layer: 'CUT',
          exact: true
        },
        start,
        end: points[index + 1]
      })
    );
    const refs = segments.map((segment) => ({ segmentId: segment.id, reversed: false }));
    const segmentsById = segmentMap(segments);
    const origin = points[0];
    const naiveArea = refs.reduce(
      (total, ref) => total + signedAreaOfSegmentRef(ref, segmentsById, origin),
      0
    );

    expect(naiveArea).toBe(0);
    expect(signedAreaOfPath(refs, segmentsById)).toBe(4);
  });

  it('does not snap a representably near-quadrant rotation at huge radius', () => {
    const quarterTurn = Math.PI / 2;
    const nearQuarterTurn = quarterTurn + 4 * Number.EPSILON;
    const radius = 1e30;
    const sweepRadians = 2 * nearQuarterTurn;
    const segment = createArcSegment({
      id: 'seg_near_quadrant',
      source: {
        sourceEntityIndex: 0,
        sourceEntityType: 'arc',
        layer: 'CUT',
        exact: true
      },
      start: { x: radius, y: 0 },
      end: {
        x: radius * Math.cos(sweepRadians),
        y: radius * Math.sin(sweepRadians)
      },
      center: { x: 0, y: 0 },
      radius,
      clockwise: false,
      sweepRadians
    });
    const midpoint = pointOnArcAtParameter(
      segment,
      { segmentId: segment.id, reversed: false },
      0.5
    );
    const expectedOffsetMagnitude =
      radius * Math.abs(Math.sin(nearQuarterTurn - quarterTurn));

    expect(nearQuarterTurn).not.toBe(quarterTurn);
    expect(midpoint.x).toBeLessThan(-expectedOffsetMagnitude / 2);
    expect(Math.abs(midpoint.x)).toBeGreaterThan(expectedOffsetMagnitude / 2);
  });

  it('steps to adjacent IEEE-754 values across zeros, subnormals, extremes, and infinities', () => {
    expect(nextUp(0)).toBe(Number.MIN_VALUE);
    expect(nextDown(0)).toBe(-Number.MIN_VALUE);
    expect(nextUp(-0)).toBe(Number.MIN_VALUE);
    expect(nextDown(-0)).toBe(-Number.MIN_VALUE);

    expect(nextUp(Number.MIN_VALUE)).toBe(2 * Number.MIN_VALUE);
    expect(Object.is(nextDown(Number.MIN_VALUE), 0)).toBe(true);
    expect(Object.is(nextUp(-Number.MIN_VALUE), -0)).toBe(true);
    expect(nextDown(-Number.MIN_VALUE)).toBe(-2 * Number.MIN_VALUE);

    expect(nextUp(Number.MAX_VALUE)).toBe(Number.POSITIVE_INFINITY);
    expect(nextDown(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
    expect(nextDown(Number.POSITIVE_INFINITY)).toBe(Number.MAX_VALUE);
    expect(nextUp(Number.NEGATIVE_INFINITY)).toBe(-Number.MAX_VALUE);
    expect(nextUp(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(nextDown(-Number.MAX_VALUE)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('keeps exact axis arc endpoint bounds exact and free of signed zero', () => {
    const segment = createArcSegment({
      id: 'seg_exact_axis_bounds',
      source: {
        sourceEntityIndex: 0,
        sourceEntityType: 'arc',
        layer: 'CUT',
        exact: true
      },
      start: { x: 1, y: 0 },
      end: { x: 0, y: 1 },
      center: { x: 0, y: 0 },
      radius: 1,
      clockwise: false,
      sweepRadians: Math.PI / 2
    });

    expect(segment.bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(Object.values(segment.bounds).some((value) => Object.is(value, -0))).toBe(false);
  });

  it('bounds a near-start interior cardinal without endpoint-tolerance underflow', () => {
    const radius = 1e30;
    const delta = 1e-14;
    const center = { x: -radius, y: 0 };
    const stablePoint = (angle: number) => ({
      x: radius * (-2 * Math.sin(angle / 2) ** 2),
      y: radius * Math.sin(angle)
    });
    const segment = createArcSegment({
      id: 'seg_near_start_cardinal_bounds',
      source: {
        sourceEntityIndex: 0,
        sourceEntityType: 'arc',
        layer: 'CUT',
        exact: true
      },
      start: stablePoint(-delta),
      end: stablePoint(-2 * delta),
      center,
      radius,
      clockwise: false,
      sweepRadians: 2 * Math.PI - delta
    });

    expect(segment.bounds.maxX).toBeGreaterThanOrEqual(0);
  });

  it('normalizes reflected signed zero in exact axis arc bounds', () => {
    const segment = createArcSegment({
      id: 'seg_reflected_exact_axis_bounds',
      source: {
        sourceEntityIndex: 0,
        sourceEntityType: 'arc',
        layer: 'CUT',
        exact: true
      },
      start: { x: -1, y: 0 },
      end: { x: -0, y: 1 },
      center: { x: -0, y: 0 },
      radius: 1,
      clockwise: true,
      sweepRadians: -Math.PI / 2
    });

    expect(segment.bounds).toEqual({ minX: -1, minY: 0, maxX: 0, maxY: 1 });
    expect(Object.values(segment.bounds).some((value) => Object.is(value, -0))).toBe(false);
  });

  it('turns shuffled rectangle lines into one closed contour and one continuous cut', () => {
    const document = createPathPlanningDocumentFromDxfEntities(shuffledRectangle(), {
      endpointTolerance: DEFAULT_TOLERANCE
    });
    const body = pathPlanToGcodeBody(document.plan, document.segments, {
      endpointTolerance: DEFAULT_TOLERANCE
    });

    expect(document.chains.filter((chain) => chain.closed)).toHaveLength(1);
    expect(document.contours).toHaveLength(1);
    expect(document.contours[0]).toMatchObject({
      closed: true,
      classification: 'exterior',
      orientation: 'ccw'
    });
    expect(document.plan.operations).toHaveLength(1);
    expect(countRapids(body)).toBe(1);
    expect(countCutMoves(body)).toBe(4);
    expect(body.split('\n').slice(1).some((line) => line.startsWith('G0 '))).toBe(false);
  });

  it('turns reversed shuffled rectangle lines into one continuous cut', () => {
    const document = createPathPlanningDocumentFromDxfEntities(reversedShuffledRectangle(), {
      endpointTolerance: DEFAULT_TOLERANCE
    });
    const body = pathPlanToGcodeBody(document.plan, document.segments, {
      endpointTolerance: DEFAULT_TOLERANCE
    });

    expect(document.chains.filter((chain) => chain.closed)).toHaveLength(1);
    expect(document.plan.operations).toHaveLength(1);
    expect(countRapids(body)).toBe(1);
    expect(countCutMoves(body)).toBe(4);
    expect(body.split('\n').slice(1).some((line) => line.startsWith('G0 '))).toBe(false);
  });

  it('cuts an inner rectangle hole before its containing exterior rectangle', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 20, 20), ...rectangleLines(5, 5, 10, 10)],
      { endpointTolerance: DEFAULT_TOLERANCE }
    );
    const body = pathPlanToGcodeBody(document.plan, document.segments, {
      endpointTolerance: DEFAULT_TOLERANCE
    });

    expect(document.contours.map((contour) => contour.classification).sort()).toEqual([
      'exterior',
      'hole'
    ]);
    expect(document.plan.operations.map((operation) => operation.classification)).toEqual([
      'hole',
      'exterior'
    ]);
    expect(body.split('\n')[0]).toBe('G0 X5.000 Y5.000');
    expect(countRapids(body)).toBe(2);
  });

  it('assigns stable contour labels that flow into planned operations', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 20, 20), ...rectangleLines(5, 5, 10, 10)],
      { endpointTolerance: DEFAULT_TOLERANCE }
    );

    expect(document.contours.map((contour) => contour.label)).toEqual(['Contour 1', 'Contour 2']);
    expect(document.plan.operations.map((operation) => operation.label)).toEqual([
      'Contour 2',
      'Contour 1'
    ]);
    expect(document.plan.operations.map((operation) => operation.displayName)).toEqual([
      'Hole 1',
      'Exterior 1'
    ]);
  });

  it('exposes nested contour path elements for UPID editor navigation', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 20, 20), ...rectangleLines(5, 5, 10, 10)],
      { endpointTolerance: DEFAULT_TOLERANCE }
    );

    expect(document.rootPathElementIds).toEqual(['contour_0001']);
    expect(document.pathElements).toHaveLength(2);
    expect(document.pathElements.map((element) => element.id)).toEqual(['contour_0001', 'contour_0002']);
    expect(document.pathElements[0]).toMatchObject({
      id: 'contour_0001',
      kind: 'contour',
      label: 'Contour 1',
      displayName: 'Exterior 1',
      classification: 'exterior',
      parentId: null,
      childIds: ['contour_0002'],
      operationId: 'op_0002',
      orderIndex: 1,
      direction: 'forward',
      closed: true
    });
    expect(document.pathElements[1]).toMatchObject({
      id: 'contour_0002',
      kind: 'contour',
      label: 'Contour 2',
      displayName: 'Hole 1',
      classification: 'hole',
      parentId: 'contour_0001',
      childIds: [],
      operationId: 'op_0001',
      orderIndex: 0,
      direction: 'forward',
      closed: true
    });
    expect(document.pathElements[0].segmentRefs).toHaveLength(4);
    expect(document.pathElements[0].points.map((point) => point.role)).toEqual([
      'start',
      'end',
      'representative'
    ]);
    expect(document.pathElements[0].provenance.sourceEntityIndices).toEqual([0, 1, 2, 3]);
    expect(document.pathElements[0].diagnosticIds).toEqual([]);
    expect(document.pathElements[0].overrides).toBeUndefined();
  });

  it('summarizes source provenance on contours and planned operations', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [
        closedPolylineEntity('OUTER', [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 }
        ]),
        closedPolylineEntity('INNER', [
          { x: 5, y: 5 },
          { x: 15, y: 5 },
          { x: 15, y: 15 },
          { x: 5, y: 15 }
        ])
      ],
      { endpointTolerance: DEFAULT_TOLERANCE }
    );

    expect(document.contours.map((contour) => contour.provenance)).toEqual([
      {
        exact: true,
        layers: ['OUTER'],
        sourceEntityIndices: [0],
        sourceEntityTypes: ['lwpolyline']
      },
      {
        exact: true,
        layers: ['INNER'],
        sourceEntityIndices: [1],
        sourceEntityTypes: ['lwpolyline']
      }
    ]);
    expect(document.plan.operations.map((operation) => operation.provenance)).toEqual([
      document.contours[1].provenance,
      document.contours[0].provenance
    ]);
  });

  it('summarizes DXF block and insert lineage on contours and path elements', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      rectangleLines(0, 0, 10, 5).map((entity) => ({
        ...entity,
        handle: 'BEEF',
        source: {
          blockName: 'PROFILE',
          insertChain: [
            {
              blockName: 'PROFILE',
              column: 0,
              row: 0,
              layer: 'CUT',
              transform: {
                insertion: { x: 100, y: 200 },
                rotationDegrees: 90,
                scaleX: 1,
                scaleY: 1
              }
            }
          ]
        }
      })),
      { endpointTolerance: DEFAULT_TOLERANCE }
    );

    expect(document.contours[0].provenance.dxf).toEqual({
      blockNames: ['PROFILE'],
      insertBlockNames: ['PROFILE'],
      insertedSegmentCount: 4
    });
    expect(document.contours[0].provenance.sourceEntityHandles).toEqual(['BEEF']);
    expect(document.segments[0].source.sourceEntityHandle).toBe('BEEF');
    expect(document.pathElements[0].provenance.dxf).toEqual(document.contours[0].provenance.dxf);
    expect(document.plan.operations[0].provenance.dxf).toEqual(document.contours[0].provenance.dxf);
  });

  it('uses rapids only between disconnected contours', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 5, 5), ...rectangleLines(20, 0, 25, 5)],
      { endpointTolerance: DEFAULT_TOLERANCE }
    );
    const body = pathPlanToGcodeBody(document.plan, document.segments, {
      endpointTolerance: DEFAULT_TOLERANCE
    });

    expect(document.plan.operations).toHaveLength(2);
    expect(countRapids(body)).toBe(2);
    expect(countCutMoves(body)).toBe(8);
    expect(document.plan.metrics.totalRapidLength).toBeGreaterThan(0);
  });

  it('can preserve source contour order for independent contours when requested', () => {
    const sourceOrdered = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(40, 0, 50, 5), ...rectangleLines(0, 0, 5, 5)],
      {
        endpointTolerance: DEFAULT_TOLERANCE,
        operationOrderStrategy: 'source-order'
      }
    );
    const nearestOrdered = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(40, 0, 50, 5), ...rectangleLines(0, 0, 5, 5)],
      { endpointTolerance: DEFAULT_TOLERANCE }
    );
    const explicitNearest = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(40, 0, 50, 5), ...rectangleLines(0, 0, 5, 5)],
      {
        endpointTolerance: DEFAULT_TOLERANCE,
        operationOrderStrategy: 'nearest'
      }
    );

    expect(sourceOrdered.plan.operations.map((operation) => operation.contourId)).toEqual([
      'contour_0001',
      'contour_0002'
    ]);
    expect(sourceOrdered.plan.operations[0].startPoint.x).toBe(40);
    expect(nearestOrdered.plan.operations.map((operation) => operation.contourId)).toEqual([
      'contour_0002',
      'contour_0001'
    ]);
    expect(explicitNearest.plan.operations.map((operation) => operation.contourId)).toEqual([
      'contour_0002',
      'contour_0001'
    ]);
  });

  it('preserves a LWPOLYLINE bulge arc as G2/G3 instead of flattening it to G1', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [
        {
          type: 'lwpolyline',
          layer: 'PROFILE',
          closed: false,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 0, bulge: 0.41421356237309503 },
            { x: 10, y: 10, bulge: 0 }
          ]
        }
      ],
      { endpointTolerance: DEFAULT_TOLERANCE }
    );
    const body = pathPlanToGcodeBody(document.plan, document.segments, {
      endpointTolerance: DEFAULT_TOLERANCE
    });

    expect(document.segments.map((segment) => segment.kind)).toEqual(['line', 'arc']);
    expect(body).toContain('G3 X10.000 Y10.000 I-5.000 J5.000');
    expect(body).not.toContain('G1 X10.000 Y10.000');
  });

  it('preserves a classic POLYLINE bulge arc as G2/G3 instead of flattening it to G1', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [
        {
          type: 'polyline',
          layer: 'PROFILE',
          closed: false,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 0, bulge: 0.41421356237309503 },
            { x: 10, y: 10, bulge: 0 }
          ]
        }
      ],
      { endpointTolerance: DEFAULT_TOLERANCE }
    );
    const body = pathPlanToGcodeBody(document.plan, document.segments, {
      endpointTolerance: DEFAULT_TOLERANCE
    });

    expect(document.segments.map((segment) => segment.kind)).toEqual(['line', 'arc']);
    expect(document.segments[1].source.sourceEntityType).toBe('polyline');
    expect(body).toContain('G3 X10.000 Y10.000 I-5.000 J5.000');
    expect(body).not.toContain('G1 X10.000 Y10.000');
  });

  it('joins one unique near endpoint pair under tolerance with an explicit repair diagnostic', () => {
    const document = createPathPlanningDocumentFromDxfEntities(gappedRectangle(0.004), {
      endpointTolerance: DEFAULT_TOLERANCE
    });
    const posted = postPathPlanToGcode(document.plan, document.segments, {
      endpointTolerance: DEFAULT_TOLERANCE
    });

    expect(document.chains.filter((chain) => chain.closed)).toHaveLength(1);
    expect(document.contours[0].classification).toBe('exterior');
    expect(document.diagnostics.some((diagnostic) => diagnostic.code === 'endpoint-cluster-snap')).toBe(true);
    expect(posted.diagnostics.some((diagnostic) => diagnostic.code === 'post-bridged-gap')).toBe(true);
    expect(countRapids(posted.body)).toBe(1);
  });

  it('treats micron endpoint jitter as coincident instead of diagnostic repair', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      line(10.000001, 0, 10, 5),
      line(10, 5.000001, 0, 5),
      line(0, 5, 0, 0.000001)
    ]);

    expect(document.chains).toHaveLength(1);
    expect(document.chains[0]).toMatchObject({
      closed: true,
      metrics: {
        gapLength: 0
      }
    });
    expect(document.endpointClusters.every((cluster) => cluster.method === 'exact')).toBe(true);
    expect(document.contours[0].classification).toBe('exterior');
    expect(document.diagnostics.some((diagnostic) => diagnostic.code === 'endpoint-cluster-snap')).toBe(false);
    expect(document.diagnostics.some((diagnostic) => diagnostic.code === 'closed-chain-gap')).toBe(false);
  });

  it('does not mark an arc contour as self-intersecting at a micron healed join', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: -8.48521, y: 9.178846 },
        radius: 12.5,
        startAngle: 308.331,
        endAngle: 317.14,
        clockwise: false,
        start: { x: -0.919253095454, y: -0.771344757898 },
        end: { x: 0.000000373547, y: 0.0000004889 }
      },
      line(0, 0, -0.341071, 1.417693),
      line(-0.341071, 1.417693, -0.919253095454, -0.771344757898)
    ]);

    expect(document.chains).toHaveLength(1);
    expect(document.chains[0].closed).toBe(true);
    expect(document.contours[0].classification).toBe('exterior');
    expect(document.diagnostics.some((diagnostic) => diagnostic.code === 'self-intersection')).toBe(false);
  });

  it('keeps near endpoints over tolerance open and ambiguous', () => {
    const document = createPathPlanningDocumentFromDxfEntities(gappedRectangle(0.02), {
      endpointTolerance: DEFAULT_TOLERANCE
    });

    expect(document.chains.filter((chain) => chain.closed)).toHaveLength(0);
    expect(document.chains.filter((chain) => !chain.closed)).toHaveLength(1);
    expect(document.contours).toHaveLength(1);
    expect(document.contours[0]).toMatchObject({
      closed: false,
      classification: 'open-chain'
    });
    expect(document.diagnostics.some((diagnostic) => diagnostic.code === 'open-chain')).toBe(true);
  });

  it('does not use transitive endpoint snapping to connect endpoints with over-tolerance extremes', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [
        line(0, 0, 10, 0),
        line(10.009, 0, 20, 0),
        line(10.018, 0, 30, 0)
      ],
      { endpointTolerance: DEFAULT_TOLERANCE }
    );

    expect(document.endpointClusters.every((cluster) => cluster.maxPairDistance <= DEFAULT_TOLERANCE)).toBe(true);
    expect(document.endpointClusters.some((cluster) => cluster.members.length === 3)).toBe(false);
    expect(document.diagnostics.some((diagnostic) => diagnostic.code === 'ambiguous-endpoint-cluster')).toBe(
      true
    );
  });

  it('does not snap the start and end endpoints of the same short open segment together', () => {
    const document = createPathPlanningDocumentFromDxfEntities([line(0, 0, 0.005, 0)], {
      endpointTolerance: DEFAULT_TOLERANCE
    });
    const body = pathPlanToGcodeBody(document.plan, document.segments, {
      endpointTolerance: DEFAULT_TOLERANCE
    });

    expect(document.endpointClusters).toHaveLength(2);
    expect(document.chains).toHaveLength(1);
    expect(document.chains[0]).toMatchObject({
      closed: false,
      kind: 'open-chain'
    });
    expect(document.contours[0].classification).toBe('open-chain');
    expect(body).toBe(['G0 X0.000 Y0.000', 'G1 X0.005 Y0.000'].join('\n'));
  });

  it('keeps every exact endpoint cluster within the configured complete-link diameter', () => {
    const epsilon = 1e-6;
    const samples = [
      createTestLineSegment('seg_middle', 0.9e-6, 0, 100, 10, 0),
      createTestLineSegment('seg_left', 0, 0, 110, 20, 1),
      createTestLineSegment('seg_right', 1.8e-6, 0, 120, 30, 2)
    ];

    const result = clusterSegmentEndpoints(samples, {
      coincidenceEpsilon: epsilon,
      endpointTolerance: epsilon
    });
    const exactClusters = result.clusters.filter((cluster) => cluster.method === 'exact');

    expect(exactClusters.every((cluster) => cluster.maxPairDistance <= epsilon)).toBe(true);
    expect(
      exactClusters.some((cluster) => {
        const ids = new Set(cluster.members.map((member) => member.segmentId));
        return ids.has('seg_left') && ids.has('seg_right');
      })
    ).toBe(false);
  });

  it('keeps exact-cluster centroids finite near the largest finite coordinates', () => {
    const center = 1e308;
    const delta = 2e293;
    const segments = [
      createTestLineSegment('seg_large_left', center - delta, 0, center, 0, 0),
      createTestLineSegment('seg_large_right', center, 0, center + delta, 0, 1)
    ];

    const result = clusterSegmentEndpoints(segments, {
      coincidenceEpsilon: 1e-6,
      endpointTolerance: 1e-6
    });

    expect(
      result.clusters.every(
        (cluster) => Number.isFinite(cluster.point.x) && Number.isFinite(cluster.point.y)
      )
    ).toBe(true);
    expect(
      result.clusters.find((cluster) => cluster.members.length === 2)?.point
    ).toEqual({ x: center, y: 0 });
  });

  it('queries point and bounds entries without expanding oversized bounds across every cell', () => {
    const index = new SpatialHash<string>({ cellSize: 1, maxCellsPerBounds: 4 });

    index.insertPoint({ x: 2, y: 2 }, 'point');
    index.insertBounds(
      { minX: -1_000_000, minY: -1_000_000, maxX: 1_000_000, maxY: 1_000_000 },
      'oversized'
    );

    expect(index.queryPoint({ x: 500_000, y: 500_000 })).toEqual(['oversized']);
    expect(index.queryBounds({ minX: 1, minY: 1, maxX: 3, maxY: 3 })).toEqual([
      'point',
      'oversized'
    ]);
    expect(
      index.queryBounds({
        minX: -2_000_000,
        minY: -2_000_000,
        maxX: 2_000_000,
        maxY: 2_000_000
      })
    ).toEqual(['point', 'oversized']);
  });

  it('removes duplicate rectangles before planning and preserves first-source cut length', () => {
    const rectangle = rectangleLines(0, 0, 10, 5);
    const document = createPathPlanningDocumentFromDxfEntities([...rectangle, ...rectangle], {
      endpointTolerance: DEFAULT_TOLERANCE
    });
    const duplicateDiagnostics = document.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'duplicate-segment'
    );

    expect(document.segments).toHaveLength(4);
    expect(document.segments.map((segment) => segment.source.sourceEntityIndex)).toEqual([0, 1, 2, 3]);
    expect(document.plan.metrics.totalCutLength).toBe(30);
    expect(duplicateDiagnostics).toHaveLength(4);
    expect(
      duplicateDiagnostics.every(
        (diagnostic) => diagnostic.severity === 'error' && diagnostic.relatedSegmentIds?.length === 2
      )
    ).toBe(true);
  });

  it('removes direction-independent reversed line duplicates', () => {
    const rectangle = rectangleLines(0, 0, 10, 5);
    const reversed = rectangle.map((entity) => {
      if (entity.type !== 'line') throw new Error('Expected line fixture.');
      return line(entity.end.x, entity.end.y, entity.start.x, entity.start.y);
    });
    const document = createPathPlanningDocumentFromDxfEntities([...rectangle, ...reversed]);

    expect(document.segments).toHaveLength(4);
    expect(document.diagnostics.filter((diagnostic) => diagnostic.code === 'duplicate-segment')).toHaveLength(4);
  });

  it('retains complete source and INSERT lineage for removed duplicates', () => {
    const duplicateFromInsert = (
      handle: string,
      blockName: string,
      insertionX: number,
      approximate = false
    ): DxfEntity => ({
      ...line(0, 0, 10, 0),
      handle,
      ...(approximate
        ? {
            approximation: {
              sourceEntityType: 'SPLINE',
              maxChordError: 0.001
            }
          }
        : {}),
      source: {
        blockName,
        insertChain: [
          {
            blockName,
            column: 0,
            row: 0,
            layer: 'CUT',
            transform: {
              insertion: { x: insertionX, y: 20 },
              localOffset: { x: 1, y: 2 },
              blockBasePoint: { x: 3, y: 4 },
              rotationDegrees: 90,
              scaleX: 2,
              scaleY: 2
            }
          }
        ]
      }
    });
    const document = createPathPlanningDocumentFromDxfEntities([
      duplicateFromInsert('A', 'PROFILE_A', 10),
      duplicateFromInsert('B', 'PROFILE_B', 30, true)
    ]);
    const diagnostic = document.diagnostics.find(
      (candidate) => candidate.code === 'duplicate-segment'
    );

    expect(document.segments).toHaveLength(1);
    expect(diagnostic?.details).toMatchObject({
      sources: [
        {
          segmentId: 'seg_0001',
          layer: 'CUT',
          source: {
            sourceEntityIndex: 0,
            sourceEntityHandle: 'A',
            sourceEntityType: 'line',
            layer: 'CUT',
            exact: true,
            dxf: {
              blockName: 'PROFILE_A',
              insertChain: [
                {
                  blockName: 'PROFILE_A',
                  transform: {
                    insertion: { x: 10, y: 20 },
                    localOffset: { x: 1, y: 2 },
                    blockBasePoint: { x: 3, y: 4 },
                    rotationDegrees: 90,
                    scaleX: 2,
                    scaleY: 2
                  }
                }
              ]
            }
          }
        },
        {
          segmentId: 'seg_0002',
          layer: 'CUT',
          source: {
            sourceEntityIndex: 1,
            sourceEntityHandle: 'B',
            sourceEntityType: 'SPLINE',
            layer: 'CUT',
            exact: false,
            approximation: {
              sourceEntityType: 'SPLINE',
              maxChordError: 0.001
            },
            dxf: {
              blockName: 'PROFILE_B',
              insertChain: [
                {
                  blockName: 'PROFILE_B',
                  transform: {
                    insertion: { x: 30, y: 20 }
                  }
                }
              ]
            }
          }
        }
      ]
    });
  });

  it('deduplicates reversed arcs and circles by swept locus while preserving first sources', () => {
    const arcForward = createTestArcSegment({
      id: 'arc_forward',
      sourceEntityIndex: 0,
      start: { x: 1, y: 0 },
      end: { x: 0, y: 1 },
      center: { x: 0, y: 0 },
      sweepRadians: Math.PI / 2
    });
    const arcReverse = createTestArcSegment({
      id: 'arc_reverse',
      sourceEntityIndex: 1,
      start: { x: 0, y: 1 },
      end: { x: 1, y: 0 },
      center: { x: 0, y: 0 },
      sweepRadians: -Math.PI / 2
    });
    const circleFirst = createCircleSegment({
      id: 'circle_first',
      source: testSegmentSource(2, 'circle'),
      center: { x: 10, y: 0 },
      radius: 2,
      preferredStart: { x: 12, y: 0 }
    });
    const circleDuplicate = createCircleSegment({
      id: 'circle_duplicate',
      source: testSegmentSource(3, 'circle'),
      center: { x: 10, y: 0 },
      radius: 2,
      preferredStart: { x: 10, y: 2 }
    });

    const result = sanitizePathSegments(
      [arcForward, arcReverse, circleFirst, circleDuplicate],
      { coincidenceEpsilon: 1e-6 }
    );

    expect(result.segments.map((segment) => segment.id)).toEqual(['arc_forward', 'circle_first']);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'duplicate-segment')).toHaveLength(2);
  });

  it('does not conflate distinct minor and major arcs with the same endpoints', () => {
    const minor = createTestArcSegment({
      id: 'arc_minor',
      sourceEntityIndex: 0,
      start: { x: 1, y: 0 },
      end: { x: 0, y: 1 },
      center: { x: 0, y: 0 },
      sweepRadians: Math.PI / 2
    });
    const major = createTestArcSegment({
      id: 'arc_major',
      sourceEntityIndex: 1,
      start: { x: 1, y: 0 },
      end: { x: 0, y: 1 },
      center: { x: 0, y: 0 },
      sweepRadians: -(3 * Math.PI) / 2
    });

    const result = sanitizePathSegments([minor, major], { coincidenceEpsilon: 1e-6 });

    expect(result.segments.map((segment) => segment.id)).toEqual(['arc_minor', 'arc_major']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('duplicate-segment');
  });

  it('rejects non-finite manually supplied segment geometry before topology construction', () => {
    const invalidLine = {
      ...createTestLineSegment('line_non_finite', 0, 0, 1, 0, 0),
      length: Number.POSITIVE_INFINITY
    };
    const validArc = createTestArcSegment({
      id: 'arc_non_finite',
      sourceEntityIndex: 1,
      start: { x: 1, y: 0 },
      end: { x: 0, y: 1 },
      center: { x: 0, y: 0 },
      sweepRadians: Math.PI / 2
    });
    const invalidArc = {
      ...validArc,
      center: { ...validArc.center, x: Number.NaN }
    };
    const validCircle = createCircleSegment({
      id: 'circle_non_finite',
      source: testSegmentSource(2, 'circle'),
      center: { x: 10, y: 0 },
      radius: 2
    });
    const invalidCircle = {
      ...validCircle,
      preferredStart: { ...validCircle.preferredStart, y: Number.NEGATIVE_INFINITY }
    };

    const result = sanitizePathSegments([invalidLine, invalidArc, invalidCircle]);

    expect(result.segments).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
    expect(
      result.diagnostics.every(
        (diagnostic) => diagnostic.code === 'non-finite-geometry' && diagnostic.severity === 'error'
      )
    ).toBe(true);
  });

  it.each([
    {
      label: 'arc center',
      entity: {
        ...arcEntity({ x: 0, y: 0 }, 1, 0, 90, false),
        center: { x: Number.NaN, y: 0 }
      } as DxfEntity
    },
    {
      label: 'arc sweep',
      entity: {
        ...arcEntity({ x: 0, y: 0 }, 1, 0, 90, false),
        sweepRadians: Number.POSITIVE_INFINITY
      } as DxfEntity
    },
    {
      label: 'circle radius',
      entity: {
        type: 'circle',
        layer: 'CUT',
        center: { x: 0, y: 0 },
        radius: Number.POSITIVE_INFINITY
      } satisfies DxfEntity
    }
  ])('rejects a non-finite DXF $label with the non-finite geometry error', ({ entity }) => {
    const document = createPathPlanningDocumentFromDxfEntities([entity]);

    expect(document.segments).toEqual([]);
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'non-finite-geometry', severity: 'error' })
    );
  });

  it('reports a T branch as a blocking topology error', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(-1, 0, 0, 0),
      line(0, 0, 1, 0),
      line(0, 0, 0, 1)
    ]);

    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'branching-topology', severity: 'error' })
    );
  });

  it.each([
    {
      label: 'line-line crossing',
      entities: [line(-2, 0, 2, 0), line(0, -2, 0, 2)]
    },
    {
      label: 'line-arc crossing',
      entities: [
        line(0, -2, 0, 2),
        arcEntity({ x: 0, y: 0 }, 1, 180, 0, true)
      ]
    },
    {
      label: 'arc-arc crossing',
      entities: [
        arcEntity({ x: -0.5, y: 0 }, 1, 0, 180, false),
        arcEntity({ x: 0.5, y: 0 }, 1, 0, 180, false)
      ]
    },
    {
      label: 'line-circle tangency',
      entities: [
        line(-2, 1, 2, 1),
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1 } satisfies DxfEntity
      ]
    },
    {
      label: 'non-adjacent endpoint touch',
      entities: [
        line(1, 0, 2, 0),
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1 } satisfies DxfEntity
      ]
    }
  ])('reports analytic $label as an intersecting-topology error', ({ entities }) => {
    const document = createPathPlanningDocumentFromDxfEntities(entities);
    const diagnostic = document.diagnostics.find(
      (candidate) => candidate.code === 'intersecting-topology'
    );

    expect(diagnostic).toMatchObject({
      severity: 'error',
      relatedSegmentIds: ['seg_0001', 'seg_0002']
    });
  });

  it('allows the sole shared endpoint of genuinely adjacent segments', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 1, 0),
      line(1, 0, 1, 1)
    ]);

    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'intersecting-topology'
    );
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'open-chain', severity: 'warning' })
    );
  });

  it('reports partial collinear line overlap without removing either executable segment', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      line(5, 0, 15, 0)
    ]);

    expect(document.segments).toHaveLength(2);
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'overlapping-segment',
        severity: 'error',
        relatedSegmentIds: ['seg_0001', 'seg_0002']
      })
    );
  });

  it('reports partial co-circular arc overlap without conflating the arcs', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      arcEntity({ x: 0, y: 0 }, 2, 0, 180, false),
      arcEntity({ x: 0, y: 0 }, 2, 90, 270, false)
    ]);

    expect(document.segments).toHaveLength(2);
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'overlapping-segment',
        severity: 'error',
        relatedSegmentIds: ['seg_0001', 'seg_0002']
      })
    );
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'duplicate-segment'
    );
  });

  it('detects a co-circular arc touch across the zero-angle seam', () => {
    const degrees = (value: number) => (value * Math.PI) / 180;
    const beforeZero = createTestArcSegment({
      id: 'arc_before_zero',
      sourceEntityIndex: 0,
      start: { x: Math.cos(degrees(350)), y: Math.sin(degrees(350)) },
      end: { x: 1, y: 0 },
      center: { x: 0, y: 0 },
      sweepRadians: degrees(10)
    });
    const afterZero = createTestArcSegment({
      id: 'arc_after_zero',
      sourceEntityIndex: 1,
      start: { x: 1, y: 0 },
      end: { x: Math.cos(degrees(10)), y: Math.sin(degrees(10)) },
      center: { x: 0, y: 0 },
      sweepRadians: degrees(10)
    });

    expect(classifyPathSegmentIntersection(beforeZero, afterZero, 1e-6)).toMatchObject({
      kind: 'points',
      points: [{ x: 1, y: 0 }]
    });
  });

  it('keeps circular intersection classification invariant under a large translation', () => {
    const intersectingCircles = (offset: number) => [
      createCircleSegment({
        id: `circle_left_${offset}`,
        source: testSegmentSource(0, 'circle'),
        center: { x: offset, y: 0 },
        radius: 100
      }),
      createCircleSegment({
        id: `circle_right_${offset}`,
        source: testSegmentSource(1, 'circle'),
        center: { x: offset + 2, y: 0 },
        radius: 100
      })
    ] as const;
    const [originLeft, originRight] = intersectingCircles(0);
    const [translatedLeft, translatedRight] = intersectingCircles(1e16);
    const originResult = classifyPathSegmentIntersection(originLeft, originRight, 1e-6);
    const translatedResult = classifyPathSegmentIntersection(
      translatedLeft,
      translatedRight,
      1e-6
    );

    expect(originResult.kind).toBe('points');
    expect(originResult.points).toHaveLength(2);
    expect(translatedResult.kind).toBe('points');
    expect(translatedResult.points).toHaveLength(2);
  });

  it('does not widen explicit arc sweeps when circular geometry is translated', () => {
    const supportIntersectionAngle = Math.acos(0.01);
    const sweepRadians = supportIntersectionAngle - 0.1;
    const classifyAt = (offset: number) => {
      const center = { x: offset, y: 0 };
      const arc = createTestArcSegment({
        id: `arc_sweep_${offset}`,
        sourceEntityIndex: 0,
        start: { x: offset + 100, y: 0 },
        end: {
          x: offset + 100 * Math.cos(sweepRadians),
          y: 100 * Math.sin(sweepRadians)
        },
        center,
        sweepRadians
      });
      const circle = createCircleSegment({
        id: `circle_sweep_${offset}`,
        source: testSegmentSource(1, 'circle'),
        center: { x: offset + 2, y: 0 },
        radius: 100
      });
      return classifyPathSegmentIntersection(arc, circle, 1e-6);
    };

    expect(classifyAt(0).kind).toBe('none');
    expect(classifyAt(1e16).kind).toBe('none');
  });

  it.each(['circle', 'arc'] as const)(
    'keeps a translated interior arc-%s intersection inside the explicit sweep',
    (rightKind) => {
      const theta = Math.acos(0.01);
      const sweepRadians = theta + 0.004;
      const classifyAt = (offset: number) => {
        const left = createTestArcSegment({
          id: `arc_local_left_${offset}`,
          sourceEntityIndex: 0,
          start: { x: offset + 100, y: 0 },
          end: {
            x: offset + 100 * Math.cos(sweepRadians),
            y: 100 * Math.sin(sweepRadians)
          },
          center: { x: offset, y: 0 },
          sweepRadians
        });
        const rightCenter = { x: offset + 2, y: 0 };
        const right =
          rightKind === 'circle'
            ? createCircleSegment({
                id: `circle_local_right_${offset}`,
                source: testSegmentSource(1, 'circle'),
                center: rightCenter,
                radius: 100
              })
            : createTestArcSegment({
                id: `arc_local_right_${offset}`,
                sourceEntityIndex: 1,
                start: { x: rightCenter.x - 100, y: 0 },
                end: {
                  x: rightCenter.x + 100 * Math.cos(Math.PI - sweepRadians),
                  y: 100 * Math.sin(Math.PI - sweepRadians)
                },
                center: rightCenter,
                sweepRadians: -sweepRadians
              });
        return classifyPathSegmentIntersection(left, right, 1e-6);
      };

      const originResult = classifyAt(0);
      const translatedResult = classifyAt(1e16);

      expect(originResult.kind).toBe('points');
      expect(originResult.points).toHaveLength(1);
      expect(translatedResult.kind).toBe('points');
      expect(translatedResult.points).toHaveLength(1);
    }
  );

  it('retains a finite line-line crossing near the largest finite coordinates', () => {
    const center = 1e308;
    const delta = 2e293;
    const horizontal = createTestLineSegment(
      'line_large_horizontal',
      center - delta,
      0,
      center + delta,
      0,
      0
    );
    const vertical = createTestLineSegment(
      'line_large_vertical',
      center,
      -delta,
      center,
      delta,
      1
    );

    const result = classifyPathSegmentIntersection(horizontal, vertical, 1e-6);

    expect(result.kind).toBe('points');
    expect(result.points).toEqual([{ x: center, y: 0 }]);
  });
});

function shuffledRectangle(): DxfEntity[] {
  const [bottom, right, top, left] = rectangleLines(0, 0, 10, 5);
  return [right, top, bottom, left];
}

function reversedShuffledRectangle(): DxfEntity[] {
  return [
    line(10, 5, 10, 0),
    line(0, 5, 10, 5),
    line(10, 0, 0, 0),
    line(0, 0, 0, 5)
  ];
}

function gappedRectangle(gap: number): DxfEntity[] {
  return [
    line(0, 0, 10, 0),
    line(10 + gap, 0, 10, 5),
    line(10, 5, 0, 5),
    line(0, 5, 0, 0)
  ];
}

function rectangleLines(minX: number, minY: number, maxX: number, maxY: number): DxfEntity[] {
  return [
    line(minX, minY, maxX, minY),
    line(maxX, minY, maxX, maxY),
    line(maxX, maxY, minX, maxY),
    line(minX, maxY, minX, minY)
  ];
}

function closedPolylineEntity(layer: string, vertices: Array<{ x: number; y: number }>): DxfEntity {
  return {
    type: 'lwpolyline',
    layer,
    closed: true,
    vertices: vertices.map((vertex) => ({ ...vertex, bulge: 0 }))
  };
}

function closedBulgePolyline(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bulge: number
): DxfEntity {
  return {
    type: 'lwpolyline',
    layer: 'CUT',
    closed: true,
    vertices: [
      { ...start, bulge },
      { ...end, bulge: 0 }
    ]
  };
}

function pathSegmentNumbersAreFinite(
  segment: ReturnType<typeof createPathPlanningDocumentFromDxfEntities>['segments'][number]
) {
  const values = [
    segment.start.x,
    segment.start.y,
    segment.end.x,
    segment.end.y,
    segment.length,
    segment.bounds.minX,
    segment.bounds.minY,
    segment.bounds.maxX,
    segment.bounds.maxY
  ];
  if (segment.kind === 'arc' || segment.kind === 'circle') {
    values.push(segment.center.x, segment.center.y, segment.radius);
  }
  if (segment.kind === 'arc') values.push(segment.sweepRadians);
  return values.every(Number.isFinite);
}

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return {
    type: 'line',
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}

function arcEntity(
  center: { x: number; y: number },
  radius: number,
  startAngle: number,
  endAngle: number,
  clockwise: boolean
): DxfEntity {
  const pointAtDegrees = (angle: number) => {
    const radians = (angle * Math.PI) / 180;
    return {
      x: center.x + radius * Math.cos(radians),
      y: center.y + radius * Math.sin(radians)
    };
  };

  return {
    type: 'arc',
    layer: 'CUT',
    center,
    radius,
    startAngle,
    endAngle,
    clockwise,
    start: pointAtDegrees(startAngle),
    end: pointAtDegrees(endAngle)
  };
}

function testSegmentSource(
  sourceEntityIndex: number,
  sourceEntityType: 'line' | 'arc' | 'circle'
) {
  return {
    sourceEntityIndex,
    sourceEntityType,
    layer: 'CUT',
    exact: true
  } as const;
}

function createTestLineSegment(
  id: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  sourceEntityIndex: number
) {
  return createLineSegment({
    id,
    source: testSegmentSource(sourceEntityIndex, 'line'),
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  });
}

function createTestArcSegment(input: {
  id: string;
  sourceEntityIndex: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  center: { x: number; y: number };
  sweepRadians: number;
}) {
  return createArcSegment({
    ...input,
    source: testSegmentSource(input.sourceEntityIndex, 'arc'),
    radius: Math.hypot(input.start.x - input.center.x, input.start.y - input.center.y),
    clockwise: input.sweepRadians < 0
  });
}

function countRapids(body: string) {
  return body.split('\n').filter((line) => line.startsWith('G0 ')).length;
}

function countCutMoves(body: string) {
  return body.split('\n').filter((line) => /^G[123] /.test(line)).length;
}
