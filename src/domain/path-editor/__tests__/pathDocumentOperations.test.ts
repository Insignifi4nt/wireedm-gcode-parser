import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { pathPlanToGcodeBody } from '@/domain/path-intel/postGcode';

import {
  constructMagnetizedPoint,
  magnetizePointToPath,
  movePathOperation,
  previewClosedOperationStartNearPoint,
  reversePathOperation,
  setPathOperationClassification,
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

  it('records manual UPID decisions when users reorder, reverse, or choose a start', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 5, 5), ...rectangleLines(20, 0, 25, 5)]
    );
    const [first, second] = document.plan.operations;

    const moved = movePathOperation(document, second.id, -1);
    expect(moved?.plan.operations[0].overrides?.order).toEqual({
      kind: 'manual',
      orderIndex: 0
    });
    expect(moved?.plan.operations[1].overrides?.order).toEqual({
      kind: 'manual',
      orderIndex: 1
    });

    const reversed = reversePathOperation(moved!, first.id);
    expect(reversed?.plan.operations[1].overrides?.direction).toEqual({
      direction: 'reverse',
      kind: 'manual'
    });

    const started = setClosedOperationStartNearPoint(reversed!, first.id, { x: 2.5, y: 0 });
    expect(started?.plan.operations[1].overrides?.start?.kind).toBe('manual');
    expect(started?.plan.operations[1].overrides?.start?.point).toEqual({ x: 2.5, y: 0 });
    expect(started?.plan.operations[1].overrides?.start?.createdSegmentIds).toHaveLength(2);
  });

  it('refreshes UPID path elements after manual path edits', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 5, 5), ...rectangleLines(20, 0, 25, 5)]
    );
    const [first, second] = document.plan.operations;

    const moved = movePathOperation(document, second.id, -1);
    const movedFirstElement = moved?.pathElements.find((element) => element.contourId === second.contourId);
    expect(movedFirstElement).toMatchObject({
      operationId: second.id,
      orderIndex: 0,
      overrides: {
        order: {
          kind: 'manual',
          orderIndex: 0
        }
      }
    });

    const reversed = reversePathOperation(moved!, first.id);
    const reversedElement = reversed?.pathElements.find((element) => element.contourId === first.contourId);
    expect(reversedElement).toMatchObject({
      direction: 'reverse',
      overrides: {
        direction: {
          kind: 'manual',
          direction: 'reverse'
        }
      }
    });

    const started = setClosedOperationStartNearPoint(reversed!, first.id, { x: 2.5, y: 0 });
    const startedElement = started?.pathElements.find((element) => element.contourId === first.contourId);
    expect(startedElement?.points.find((point) => point.role === 'start')?.point).toEqual({ x: 2.5, y: 0 });
    expect(startedElement?.segmentRefs).toHaveLength(5);
  });

  it('records a manual contour role correction on the operation and contour', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];

    const edited = setPathOperationClassification(document, operation.id, 'hole');

    expect(edited?.plan.operations[0].classification).toBe('hole');
    expect(edited?.plan.operations[0].overrides?.classification).toEqual({
      classification: 'hole',
      kind: 'manual'
    });
    expect(edited?.contours[0].classification).toBe('hole');
    expect(edited?.pathElements[0]).toMatchObject({
      classification: 'hole',
      overrides: {
        classification: {
          classification: 'hole',
          kind: 'manual'
        }
      }
    });
  });

  it('previews existing start points until split points are allowed', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];

    const existing = previewClosedOperationStartNearPoint(document, operation.id, { x: 9, y: 0.35 }, false);
    const split = previewClosedOperationStartNearPoint(document, operation.id, { x: 9, y: 0.35 }, true);

    expect(existing).toMatchObject({
      operationId: operation.id,
      point: { x: 10, y: 0 },
      relation: 'existing-point'
    });
    expect(split).toMatchObject({
      operationId: operation.id,
      point: { x: 9, y: 0 },
      relation: 'new-split-point',
      segmentId: operation.segmentRefs[0].segmentId,
      segmentIndex: 0
    });
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

  it('refreshes active UPID topology after splitting a segment for a new start point', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];
    const replacedSegmentId = operation.segmentRefs[0].segmentId;

    const edited = setClosedOperationStartNearPoint(document, operation.id, { x: 5, y: 0 });
    const editedOperation = edited?.plan.operations[0];
    const createdSegmentIds = editedOperation?.overrides?.start?.createdSegmentIds ?? [];
    const clusterMembers = edited?.endpointClusters.flatMap((cluster) => cluster.members) ?? [];
    const splitCluster = edited?.endpointClusters.find(
      (cluster) => cluster.point.x === 5 && cluster.point.y === 0
    );
    const editedChain = edited?.chains.find((chain) => chain.id === editedOperation?.chainId);

    expect(createdSegmentIds).toHaveLength(2);
    expect(edited?.segments.map((segment) => segment.id)).not.toContain(replacedSegmentId);
    expect(editedOperation?.segmentRefs.map((ref) => ref.segmentId)).toContain(createdSegmentIds[0]);
    expect(editedOperation?.segmentRefs.map((ref) => ref.segmentId)).toContain(createdSegmentIds[1]);
    expect(clusterMembers.map((member) => member.segmentId)).not.toContain(replacedSegmentId);
    expect(splitCluster?.members.map((member) => member.segmentId).sort()).toEqual(
      createdSegmentIds.slice().sort()
    );
    expect(editedChain?.startClusterId).toBe(splitCluster?.id);
    expect(editedChain?.endClusterId).toBe(splitCluster?.id);
    expect(editedChain?.metrics.gapLength).toBe(0);
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
