import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';

import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';
import { pathPlanToGcodeBody, postPathPlanToGcode } from '../postGcode';

const DEFAULT_TOLERANCE = 0.01;

describe('path-intel DXF planning', () => {
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
