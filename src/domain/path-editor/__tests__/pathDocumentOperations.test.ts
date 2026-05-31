import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { pathPlanToGcodeBody } from '@/domain/path-intel/postGcode';

import {
  magnetizePointToPath,
  movePathOperation,
  reversePathOperation,
  setClosedOperationStartNearPoint
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
