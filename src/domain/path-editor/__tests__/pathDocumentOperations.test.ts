import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { pathPlanToGcodeBody } from '@/domain/path-intel/postGcode';

import {
  constructMagnetizedPoint,
  magnetizePointToPath,
  movePathOperation,
  reversePathOperation,
  setClosedOperationStartNearPoint,
  slideMagnetizedPointOnSegment
} from '../pathDocumentOperations';

describe('pathDocumentOperations', () => {
  it('reorders planned operations without editing raw G-code text', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 5, 5), ...rectangleLines(20, 0, 25, 5)]
    );
    const [first, second] = document.plan.operations;

    const moved = movePathOperation(document, second.id, -1);

    expect(moved?.plan.operations.map((operation) => operation.contourId)).toEqual([
      second.contourId,
      first.contourId
    ]);
    expect(pathPlanToGcodeBody(moved!.plan, moved!.segments).split('\n')[0]).toBe('G0 X20.000 Y0.000');
  });

  it('reverses a closed operation while keeping one continuous cut', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];

    const reversed = reversePathOperation(document, operation.id);
    const body = pathPlanToGcodeBody(reversed!.plan, reversed!.segments);

    expect(reversed?.plan.operations[0].direction).toBe('reverse');
    expect(body.split('\n')).toEqual([
      'G0 X0.000 Y0.000',
      'G1 X0.000 Y5.000',
      'G1 X10.000 Y5.000',
      'G1 X10.000 Y0.000',
      'G1 X0.000 Y0.000'
    ]);
  });

  it('sets a closed operation start at a clicked point by splitting the containing line segment', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];

    const edited = setClosedOperationStartNearPoint(document, operation.id, { x: 5, y: 0 });
    const body = pathPlanToGcodeBody(edited!.plan, edited!.segments);

    expect(edited?.plan.operations[0].startPoint).toEqual({ x: 5, y: 0 });
    expect(edited?.plan.operations[0].segmentRefs).toHaveLength(5);
    expect(body.split('\n')).toEqual([
      'G0 X5.000 Y0.000',
      'G1 X10.000 Y0.000',
      'G1 X10.000 Y5.000',
      'G1 X0.000 Y5.000',
      'G1 X0.000 Y0.000',
      'G1 X5.000 Y0.000'
    ]);
  });

  it('sets a closed operation start at a clicked point by splitting the containing arc segment', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 0, -5),
      line(0, -5, 10, -5),
      line(10, -5, 10, 0),
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 5, y: 0 },
        radius: 5,
        startAngle: 0,
        endAngle: 180,
        clockwise: false,
        start: { x: 10, y: 0 },
        end: { x: 0, y: 0 }
      }
    ]);

    const edited = setClosedOperationStartNearPoint(document, document.plan.operations[0].id, {
      x: 5,
      y: 5
    });
    const body = pathPlanToGcodeBody(edited!.plan, edited!.segments);

    expect(edited?.plan.operations[0].startPoint.x).toBeCloseTo(5, 6);
    expect(edited?.plan.operations[0].startPoint.y).toBeCloseTo(5, 6);
    expect(edited?.plan.operations[0].segmentRefs).toHaveLength(5);
    expect(body.split('\n')[0]).toBe('G0 X5.000 Y5.000');
    expect(body).toContain('G3 X0.000 Y0.000 I0.000 J-5.000');
  });

  it('sets a circle start at the clicked point instead of the opposite split point', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];

    const edited = setClosedOperationStartNearPoint(document, operation.id, { x: 0, y: 5 });
    const body = pathPlanToGcodeBody(edited!.plan, edited!.segments);

    expect(edited?.plan.operations[0].startPoint.x).toBeCloseTo(0, 6);
    expect(edited?.plan.operations[0].startPoint.y).toBeCloseTo(5, 6);
    expect(body.split('\n')[0]).toBe('G0 X0.000 Y5.000');
  });

  it('magnetizes a point to the nearest contour feature with tangent metadata', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));

    const result = magnetizePointToPath(document, { x: 5, y: 3 }, 'perpendicular');

    expect(result).toMatchObject({
      mode: 'perpendicular',
      point: { x: 5, y: 5 },
      tangent: { x: -1, y: 0 }
    });
  });

  it('constructs a real tangent point on circular geometry from a source point', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);

    const result = constructMagnetizedPoint(
      document,
      { x: 10, y: 0 },
      { x: 0, y: 5 },
      'tangent'
    );

    expect(result?.relation).toBe('tangent');
    expect(result?.point.x).toBeCloseTo(2.5, 6);
    expect(result?.point.y).toBeCloseTo(4.330127, 6);
    expect(result?.mode).toBe('tangent');
  });

  it('slides a constrained point only along its stored segment', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 10, 5),
      ...rectangleLines(20, 0, 30, 5)
    ]);
    const construction = constructMagnetizedPoint(
      document,
      { x: 5, y: 2 },
      { x: 5, y: 5 },
      'perpendicular'
    );
    expect(construction).not.toBeNull();

    const slid = slideMagnetizedPointOnSegment(
      document,
      {
        mode: construction!.mode,
        operationId: construction!.operationId,
        relation: construction!.relation,
        segmentId: construction!.segmentId,
        sourcePoint: construction!.sourcePoint
      },
      { x: 25, y: 5 }
    );

    expect(slid?.operationId).toBe(construction?.operationId);
    expect(slid?.segmentId).toBe(construction?.segmentId);
    expect(slid?.point.x).toBe(10);
    expect(slid?.point.y).toBe(5);
  });

  it('slides tangent fallback points as nearest snaps instead of freezing them', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const fallback = constructMagnetizedPoint(document, { x: 5, y: 5 }, { x: 5, y: 5 }, 'tangent');
    expect(fallback?.relation).toBe('nearest-fallback');

    const slid = slideMagnetizedPointOnSegment(
      document,
      {
        mode: fallback!.mode,
        operationId: fallback!.operationId,
        relation: fallback!.relation,
        segmentId: fallback!.segmentId,
        sourcePoint: fallback!.sourcePoint
      },
      { x: 8, y: 5 }
    );

    expect(slid?.relation).toBe('nearest-fallback');
    expect(slid?.point).toEqual({ x: 8, y: 5 });
  });

  it('creates tangent fallback points near the clicked contour hint', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));

    const fallback = constructMagnetizedPoint(document, { x: 5, y: 2 }, { x: 8, y: 5 }, 'tangent');

    expect(fallback?.relation).toBe('nearest-fallback');
    expect(fallback?.point).toEqual({ x: 8, y: 5 });
  });

  it('keeps old snapped points draggable after a path edit splits their stored segment', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const construction = constructMagnetizedPoint(document, { x: 5, y: 2 }, { x: 5, y: 5 }, 'perpendicular');
    const edited = setClosedOperationStartNearPoint(document, document.plan.operations[0].id, {
      x: 7,
      y: 5
    });

    const slid = slideMagnetizedPointOnSegment(
      edited!,
      {
        mode: construction!.mode,
        operationId: construction!.operationId,
        relation: construction!.relation,
        segmentId: construction!.segmentId,
        sourcePoint: construction!.sourcePoint
      },
      { x: 8, y: 5 }
    );

    expect(slid?.point).toEqual({ x: 8, y: 5 });
    expect(slid?.segmentId).not.toBe(construction?.segmentId);
  });

  it('refreshes contour orientation metadata after reversing an operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));

    const reversed = reversePathOperation(document, document.plan.operations[0].id);

    expect(reversed?.contours[0].orientation).toBe('cw');
    expect(reversed?.contours[0].signedArea).toBeLessThan(0);
  });
});

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
