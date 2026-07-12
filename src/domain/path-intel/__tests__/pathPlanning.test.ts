import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';

import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';
import { pathPlanToGcodeBody, postPathPlanToGcode } from '../postGcode';
import {
  createArcSegment,
  createLineSegment,
  pointOnArcAtParameter,
  reversePathRefs,
  segmentMap,
  signedAreaOfSegmentRef,
  signedAreaOfPath
} from '../segments';

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

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return {
    type: 'line',
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}

function countRapids(body: string) {
  return body.split('\n').filter((line) => line.startsWith('G0 ')).length;
}

function countCutMoves(body: string) {
  return body.split('\n').filter((line) => /^G[123] /.test(line)).length;
}
