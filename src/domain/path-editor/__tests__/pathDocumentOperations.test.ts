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
  setClosedOperationStartAtSegmentEndpoint,
  setPathOperationClassification,
  setClosedOperationStartAtExistingPointNearPoint,
  setClosedOperationStartNearPoint,
  setPathOperationOrderStrategy,
  movePathSegmentCenterTo,
  slideMagnetizedPointOnSegment,
  translatePathElement,
  translatePathSegment
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

  it('replans operation order from a UPID strategy preference', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(40, 0, 50, 5), ...rectangleLines(0, 0, 5, 5)]
    );

    expect(document.plan.operations.map((operation) => operation.contourId)).toEqual([
      'contour_0002',
      'contour_0001'
    ]);

    const sourceOrdered = setPathOperationOrderStrategy(document, 'source-order');

    expect(sourceOrdered?.options.operationOrderStrategy).toBe('source-order');
    expect(sourceOrdered?.plan.operations.map((operation) => operation.contourId)).toEqual([
      'contour_0001',
      'contour_0002'
    ]);
    expect(sourceOrdered?.plan.operations[0]).toMatchObject({
      orderIndex: 0,
      startPoint: { x: 40, y: 0 }
    });
    expect(sourceOrdered?.pathElements.find((element) => element.contourId === 'contour_0001')).toMatchObject({
      orderIndex: 0
    });
    expect(sourceOrdered?.plan.operations.some((operation) => operation.overrides?.order)).toBe(false);
  });

  it('reapplies the current strategy to clear manual order overrides', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 30, 20), ...rectangleLines(5, 5, 25, 15), ...rectangleLines(10, 7, 15, 12)]
    );
    expect(document.plan.operations.map((operation) => operation.classification)).toEqual([
      'island',
      'hole',
      'exterior'
    ]);

    const manuallyMoved = movePathOperation(document, document.plan.operations[0].id, 1);
    expect(manuallyMoved?.plan.operations.map((operation) => operation.classification)).toEqual([
      'hole',
      'island',
      'exterior'
    ]);
    expect(manuallyMoved?.plan.operations.some((operation) => operation.overrides?.order)).toBe(true);

    const replanned = setPathOperationOrderStrategy(
      manuallyMoved!,
      manuallyMoved!.options.operationOrderStrategy
    );

    expect(replanned?.plan.operations.map((operation) => operation.classification)).toEqual([
      'island',
      'hole',
      'exterior'
    ]);
    expect(replanned?.plan.operations.some((operation) => operation.overrides?.order)).toBe(false);
    expect(replanned?.options.operationOrderStrategy).toBe('inside-out-nearest');
  });

  it('keeps non-order manual decisions when applying an automatic strategy preference', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(40, 0, 50, 5), ...rectangleLines(0, 0, 5, 5)]
    );
    const farOperation = document.plan.operations.find((operation) => operation.contourId === 'contour_0001');
    expect(farOperation).not.toBeUndefined();

    const reversed = reversePathOperation(document, farOperation!.id);
    const classified = setPathOperationClassification(reversed!, farOperation!.id, 'hole');
    const manuallyOrdered = movePathOperation(classified!, farOperation!.id, -1);
    expect(manuallyOrdered?.plan.operations[0].overrides?.order).toEqual({
      kind: 'manual',
      orderIndex: 0
    });

    const sourceOrdered = setPathOperationOrderStrategy(manuallyOrdered!, 'source-order');
    const editedOperation = sourceOrdered?.plan.operations[0];

    expect(editedOperation).toMatchObject({
      classification: 'hole',
      contourId: 'contour_0001',
      direction: 'reverse',
      id: farOperation!.id,
      orderIndex: 0
    });
    expect(editedOperation?.overrides?.order).toBeUndefined();
    expect(editedOperation?.overrides?.classification).toEqual({
      classification: 'hole',
      kind: 'manual'
    });
    expect(editedOperation?.overrides?.direction).toEqual({
      direction: 'reverse',
      kind: 'manual'
    });
    expect(sourceOrdered?.pathElements.find((element) => element.contourId === 'contour_0001')).toMatchObject({
      classification: 'hole',
      direction: 'reverse',
      displayName: 'Hole 1',
      operationId: farOperation!.id,
      orderIndex: 0
    });
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

  it('records how a manual start point was chosen', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];
    const sourceSegmentId = operation.segmentRefs[0].segmentId;

    const splitStarted = setClosedOperationStartNearPoint(document, operation.id, { x: 5, y: 0 });
    const splitOverride = splitStarted?.plan.operations[0].overrides?.start;

    expect(splitOverride).toMatchObject({
      kind: 'manual',
      point: { x: 5, y: 0 },
      relation: 'new-split-point',
      sourceSegmentId,
      sourceSegmentIndex: 0
    });
    expect(splitOverride?.pointRole).toBeUndefined();
    expect(splitOverride?.createdSegmentIds).toHaveLength(2);

    const existingStarted = setClosedOperationStartAtExistingPointNearPoint(
      document,
      operation.id,
      { x: 9, y: 0.35 }
    );

    expect(existingStarted?.plan.operations[0].overrides?.start).toMatchObject({
      kind: 'manual',
      point: { x: 10, y: 0 },
      relation: 'existing-point',
      sourceSegmentId,
      sourceSegmentIndex: 0,
      pointRole: 'end',
      createdSegmentIds: []
    });
  });

  it('sets a closed operation start from the exact selected segment endpoint', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];
    const targetSegmentId = operation.segmentRefs[1].segmentId;

    const edited = setClosedOperationStartAtSegmentEndpoint(
      document,
      operation.id,
      targetSegmentId,
      'start'
    );

    expect(edited?.plan.operations[0].startPoint).toEqual({ x: 10, y: 0 });
    expect(edited?.plan.operations[0].segmentRefs[0].segmentId).toBe(targetSegmentId);
    expect(edited?.plan.operations[0].overrides?.start).toEqual({
      kind: 'manual',
      point: { x: 10, y: 0 },
      relation: 'existing-point',
      sourceSegmentId: targetSegmentId,
      sourceSegmentIndex: 1,
      pointRole: 'start',
      createdSegmentIds: []
    });
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

  it('translates a selected UPID contour while keeping topology and planning state live', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const pathElement = document.pathElements[0];
    const operation = document.plan.operations[0];

    const translated = translatePathElement(document, pathElement.id, { x: 7, y: -2 });

    expect(translated?.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [{ x: 7, y: -2 }, { x: 17, y: -2 }],
      [{ x: 17, y: -2 }, { x: 17, y: 3 }],
      [{ x: 17, y: 3 }, { x: 7, y: 3 }],
      [{ x: 7, y: 3 }, { x: 7, y: -2 }]
    ]);
    expect(translated?.plan.operations[0]).toMatchObject({
      id: operation.id,
      startPoint: { x: 7, y: -2 },
      endPoint: { x: 7, y: -2 },
      metrics: {
        cutLength: 30,
        segmentCount: 4
      }
    });
    expect(translated?.pathElements[0]).toMatchObject({
      id: pathElement.id,
      operationId: operation.id,
      bounds: { minX: 7, minY: -2, maxX: 17, maxY: 3 }
    });
    expect(translated?.chains[0].metrics.gapLength).toBe(0);
    expect(document.segments[0].start).toEqual({ x: 0, y: 0 });
  });

  it('translates an arc segment by moving its endpoints and center as one geometry', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 0, y: 0 },
        radius: 5,
        startAngle: 0,
        endAngle: 90,
        clockwise: false,
        start: { x: 5, y: 0 },
        end: { x: 0, y: 5 }
      }
    ]);
    const segmentId = document.segments[0].id;

    const translated = translatePathSegment(document, segmentId, { x: 2, y: 3 });
    const translatedSegment = translated?.segments[0];

    expect(translatedSegment).toMatchObject({
      kind: 'arc',
      start: { x: 7, y: 3 },
      end: { x: 2, y: 8 },
      center: { x: 2, y: 3 },
      radius: 5,
      clockwise: false
    });
    expect(translatedSegment?.length).toBeCloseTo(document.segments[0].length, 6);
    expect(document.segments[0]).toMatchObject({
      start: { x: 5, y: 0 },
      end: { x: 0, y: 5 }
    });
  });

  it('moves an arc segment center to an exact target coordinate', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 0, y: 0 },
        radius: 5,
        startAngle: 0,
        endAngle: 90,
        clockwise: false,
        start: { x: 5, y: 0 },
        end: { x: 0, y: 5 }
      }
    ]);
    const segmentId = document.segments[0].id;

    const moved = movePathSegmentCenterTo(document, segmentId, { x: 12, y: -8 });
    const movedSegment = moved?.segments[0];

    expect(movedSegment).toMatchObject({
      kind: 'arc',
      center: { x: 12, y: -8 },
      start: { x: 17, y: -8 },
      end: { x: 12, y: -3 },
      radius: 5
    });
    expect(movedSegment?.length).toBeCloseTo(document.segments[0].length, 6);
  });

  it('posts a translated circle contour with shifted endpoints and stable center offsets', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];

    const translated = translatePathElement(document, document.pathElements[0].id, { x: -7, y: 3 });
    const body = pathPlanToGcodeBody(translated!.plan, translated!.segments);

    expect(translated?.plan.operations[0]).toMatchObject({
      id: operation.id,
      startPoint: { x: 8, y: 23 },
      endPoint: { x: 8, y: 23 }
    });
    expect(body.split('\n')).toEqual([
      'G0 X8.000 Y23.000',
      'G3 X-2.000 Y23.000 I-5.000 J0.000',
      'G3 X8.000 Y23.000 I5.000 J0.000'
    ]);
  });

  it('keeps a manually selected circle start stable after translating the contour', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];
    const started = setClosedOperationStartNearPoint(document, operation.id, { x: 10, y: 25 });

    const translated = translatePathElement(started!, started!.pathElements[0].id, { x: -7, y: 3 });
    const body = pathPlanToGcodeBody(translated!.plan, translated!.segments);

    expect(translated?.plan.operations[0].startPoint.x).toBeCloseTo(3, 6);
    expect(translated?.plan.operations[0].startPoint.y).toBeCloseTo(28, 6);
    expect(body.split('\n')).toEqual([
      'G0 X3.000 Y28.000',
      'G3 X3.000 Y18.000 I0.000 J-5.000',
      'G3 X3.000 Y28.000 I0.000 J5.000'
    ]);
  });

  it('does not move a line segment center because lines have no circle center', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));

    expect(movePathSegmentCenterTo(document, document.segments[0].id, { x: 20, y: 20 })).toBeNull();
  });

  it('records a manual contour role correction on the operation and contour', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];

    const edited = setPathOperationClassification(document, operation.id, 'hole');

    expect(edited?.plan.operations[0].classification).toBe('hole');
    expect(edited?.plan.operations[0].displayName).toBe('Hole 1');
    expect(edited?.plan.operations[0].overrides?.classification).toEqual({
      classification: 'hole',
      kind: 'manual'
    });
    expect(edited?.contours[0].classification).toBe('hole');
    expect(edited?.pathElements[0]).toMatchObject({
      classification: 'hole',
      displayName: 'Hole 1',
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
      pathElementId: document.pathElements[0].id,
      point: { x: 10, y: 0 },
      relation: 'existing-point'
    });
    expect(split).toMatchObject({
      operationId: operation.id,
      pathElementId: document.pathElements[0].id,
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

  it('records structured edit provenance on segments created by a manual start split', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];
    const replacedSegmentId = operation.segmentRefs[0].segmentId;

    const edited = setClosedOperationStartNearPoint(document, operation.id, { x: 5, y: 0 });
    const createdSegmentIds = edited?.plan.operations[0].overrides?.start?.createdSegmentIds ?? [];

    expect(createdSegmentIds).toHaveLength(2);
    for (const segmentId of createdSegmentIds) {
      expect(edited?.segments.find((segment) => segment.id === segmentId)?.source.edit).toEqual({
        kind: 'manual-start-split',
        operationId: operation.id,
        parentSegmentId: replacedSegmentId,
        point: { x: 5, y: 0 }
      });
    }
  });

  it('rolls segment edit provenance up to the refreshed UPID path element', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];
    const replacedSegmentId = operation.segmentRefs[0].segmentId;

    const edited = setClosedOperationStartNearPoint(document, operation.id, { x: 5, y: 0 });
    const createdSegmentIds = edited?.plan.operations[0].overrides?.start?.createdSegmentIds ?? [];

    expect(edited?.pathElements[0].provenance.edit).toEqual({
      derivedSegmentIds: createdSegmentIds,
      events: [
        {
          derivedSegmentIds: createdSegmentIds,
          kind: 'manual-start-split',
          operationId: operation.id,
          parentSegmentId: replacedSegmentId,
          point: { x: 5, y: 0 }
        }
      ],
      parentSegmentIds: [replacedSegmentId]
    });
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

  it('projects a circle center start pick to a valid circumference start point', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];

    const edited = setClosedOperationStartNearPoint(document, operation.id, { x: 10, y: 20 });
    const body = pathPlanToGcodeBody(edited!.plan, edited!.segments);

    expect(edited?.plan.operations[0].startPoint).toEqual({ x: 15, y: 20 });
    expect(body.split('\n')).toEqual([
      'G0 X15.000 Y20.000',
      'G3 X5.000 Y20.000 I-5.000 J0.000',
      'G3 X15.000 Y20.000 I5.000 J0.000'
    ]);
  });

  it('magnetizes a point to the nearest contour feature with tangent metadata', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));

    const result = magnetizePointToPath(document, { x: 5, y: 3 }, 'perpendicular');

    expect(result).toMatchObject({
      mode: 'perpendicular',
      pathElementId: document.pathElements[0].id,
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
    expect(result?.pathElementId).toBe(document.pathElements[0].id);
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
        pathElementId: construction!.pathElementId,
        relation: construction!.relation,
        segmentId: construction!.segmentId,
        sourcePoint: construction!.sourcePoint
      },
      { x: 25, y: 5 }
    );

    expect(slid?.operationId).toBe(construction?.operationId);
    expect(slid?.pathElementId).toBe(construction?.pathElementId);
    expect(slid?.segmentId).toBe(construction?.segmentId);
    expect(slid?.point.x).toBe(10);
    expect(slid?.point.y).toBe(5);
  });

  it('slides construction snaps by stored UPID path element identity when operation ids drift', () => {
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
        operationId: 'stale-operation-id',
        pathElementId: construction!.pathElementId,
        relation: construction!.relation,
        segmentId: construction!.segmentId,
        sourcePoint: construction!.sourcePoint
      },
      { x: 25, y: 5 }
    );

    expect(slid?.operationId).toBe(construction?.operationId);
    expect(slid?.pathElementId).toBe(construction?.pathElementId);
    expect(slid?.segmentId).toBe(construction?.segmentId);
    expect(slid?.point).toEqual({ x: 10, y: 5 });
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
        pathElementId: fallback!.pathElementId,
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
        pathElementId: construction!.pathElementId,
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
