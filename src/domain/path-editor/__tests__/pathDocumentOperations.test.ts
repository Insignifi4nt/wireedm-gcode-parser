import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { arcParameterAtAngle } from '@/domain/path-intel/segments';
import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import type { OperationProgramStop } from '@/domain/path-intel/types';

import {
  derivePlannedRapidRoutes,
  movePathOperation,
  previewClosedOperationStartNearPoint,
  reversePathOperation,
  mirrorPathDocument,
  rotatePathDocument,
  setClosedOperationStartAtSegmentEndpoint,
  setClosedOperationStartAtInferredPoint,
  setPathOperationClassification,
  setClosedOperationStartAtExistingPointNearPoint,
  setCircleOperationCenterPierceLeadIn,
  setPathOperationManualLeadIn,
  setPathOperationTransitions,
  setPathOperationThreadingTransition,
  setPathOperationProgramStops,
  setProjectThreadingDefault,
  setClosedOperationStartNearPoint,
  setPathOperationOrderStrategy,
  setGeometryLinkedInitialWirePosition,
  setManualInitialWirePosition,
  movePathSegmentCenterTo,
  translatePathDocument,
  translatePathElement,
  translatePathSegment
} from '../pathDocumentOperations';
import {
  inferPathPoint,
  reinferStoredPathPoint,
  type MagnetizedPathPoint
} from '../pathPointInference';
import * as pathDocumentOperations from '../pathDocumentOperations';

describe('pathDocumentOperations', () => {
  it('requires review of changed open-path lead connections after reversal', () => {
    const original = createPathPlanningDocumentFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const operation = original.plan.operations[0];
    const configured = setPathOperationTransitions(original, operation.id, {
      entry: { strategy: 'manual-straight', move: 'cut', from: { x: -2, y: 0 }, to: operation.startPoint, review: 'reviewed' },
      exit: { strategy: 'manual-straight', move: 'cut', from: operation.endPoint, to: { x: 12, y: 0 }, review: 'reviewed' }
    })!;
    const reversed = reversePathOperation(configured, operation.id)!;
    expect(reversed.plan.operations[0].transitions).toMatchObject({
      entry: { from: { x: -2, y: 0 }, to: operation.endPoint, review: 'required' },
      exit: { from: operation.startPoint, to: { x: 12, y: 0 }, review: 'required' }
    });
    expect(configured.plan.operations[0].transitions?.entry).toMatchObject({ review: 'reviewed' });
  });

  it('keeps reviewed leads when closed-path reversal preserves their endpoints', () => {
    const original = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 10));
    const operation = original.plan.operations[0];
    const configured = setPathOperationTransitions(original, operation.id, {
      entry: { strategy: 'manual-straight', move: 'cut', from: { x: -2, y: 0 }, to: operation.startPoint, review: 'reviewed' },
      exit: { strategy: 'manual-straight', move: 'cut', from: operation.endPoint, to: { x: -3, y: 0 }, review: 'reviewed' }
    })!;
    expect(reversePathOperation(configured, operation.id)?.plan.operations[0].transitions)
      .toEqual(configured.plan.operations[0].transitions);
  });

  it('rejects remaining-cut stops at or beyond the active cut length, excluding leads', () => {
    let document = createPathPlanningDocumentFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const operation = document.plan.operations[0];
    document = setPathOperationManualLeadIn(document, operation.id, { x: -20, y: 0 })!;
    document = setMachiningSpanParticipation(document, {
      sourceSegmentId: operation.segmentRefs[0].segmentId,
      range: { start: 0.5, end: 1 }, participation: 'inactive-reference'
    })!;
    for (const remainingCutLengthMm of [0, 5, 8, Number.NaN]) {
      expect(setPathOperationProgramStops(document, operation.id, [{
        id: 'stop-1', enabled: true, reason: 'manual',
        placement: { kind: 'before-operation-end', remainingCutLengthMm }
      }])).toBeNull();
    }
    expect(setPathOperationProgramStops(document, operation.id, [{
      id: 'stop-1', enabled: true, reason: 'manual',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 4 }
    }])).not.toBeNull();
  });

  it('rejects enabled duplicate placements while allowing incremental repair of stored invalid stops', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 10));
    const operation = document.plan.operations[0];
    const first: OperationProgramStop = { id: 'stop-1', enabled: true, reason: 'manual', placement: { kind: 'after-contour' } };
    const second = { ...first, id: 'stop-2' };
    expect(setPathOperationProgramStops(document, operation.id, [first, second])).toBeNull();
    expect(setPathOperationProgramStops(document, operation.id, [first, { ...second, enabled: false }])).not.toBeNull();
    const invalid: OperationProgramStop = { id: 'stop-3', enabled: true, reason: 'manual', placement: { kind: 'before-operation-end', remainingCutLengthMm: 100 } };
    operation.programStops = [first, second, invalid];
    const repaired = setPathOperationProgramStops(document, operation.id, [first, { ...second, enabled: false }, invalid]);
    expect(repaired?.plan.operations[0].programStops).toEqual([first, { ...second, enabled: false }, invalid]);
    expect(setPathOperationProgramStops(repaired!, operation.id, [first, { ...second, enabled: false }])).not.toBeNull();
  });

  it('stores reviewed manual initial wire coordinates and marks them stale after placement', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const configured = setManualInitialWirePosition(document, { x: 10, y: 20 });

    expect(configured?.setup?.initialWirePosition).toEqual({
      kind: 'manual',
      point: { x: 10, y: 20 },
      review: 'reviewed'
    });

    const translated = translatePathDocument(configured!, { x: 5, y: -2 });
    expect(translated?.setup?.initialWirePosition).toEqual({
      kind: 'manual',
      point: { x: 10, y: 20 },
      review: 'required',
      reviewReason: 'geometry-transformed'
    });
  });

  it('keeps a geometry-linked initial wire point attached to a transformed circle center', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const circleId = document.segments[0].id;
    const configured = setGeometryLinkedInitialWirePosition(document, circleId);
    const translated = translatePathDocument(configured!, { x: 5, y: -2 });

    expect(translated?.setup?.initialWirePosition).toEqual({
      kind: 'geometry-linked',
      point: { x: 15, y: 18 },
      reference: { kind: 'circle-center', segmentId: circleId },
      review: 'reviewed'
    });
  });

  it('starts planned travel from the reviewed initial wire position', () => {
    let document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    document = setCircleOperationCenterPierceLeadIn(document, document.plan.operations[0].id)!;
    document = setManualInitialWirePosition(document, { x: 10, y: 20 })!;

    expect(derivePlannedRapidRoutes(document)[0]).toMatchObject({
      startPoint: { x: 10, y: 20 },
      endPoint: { x: 10, y: 20 },
      length: 0
    });
  });

  it('routes between a configured exit and the next configured entry', () => {
    let document = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 5, 5),
      ...rectangleLines(20, 0, 25, 5)
    ]);
    const [first, second] = document.plan.operations;
    document = setPathOperationTransitions(document, first.id, {
      exit: {
        strategy: 'manual-straight',
        move: 'cut',
        from: first.endPoint,
        to: { x: 7, y: 5 },
        review: 'reviewed'
      }
    })!;
    document = setPathOperationTransitions(document, second.id, {
      entry: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: 18, y: 0 },
        to: second.startPoint,
        review: 'reviewed'
      }
    })!;

    expect(derivePlannedRapidRoutes(document)[1]).toMatchObject({
      startPoint: { x: 7, y: 5 },
      endPoint: { x: 18, y: 0 }
    });
    expect(document.plan.operations[1].transitions?.entry).toMatchObject({
      from: { x: 18, y: 0 },
      to: second.startPoint
    });
    expect(Object.keys(document.plan.operations[1].overrides ?? {})).not.toContain('leadIn');
  });

  it('derives rapid routes in orderIndex order for an unsorted imported plan', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 3 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 3 }
    ]);
    const [first, second] = document.plan.operations;
    document.plan.operations = [second, first];

    const routes = derivePlannedRapidRoutes(document);

    expect(routes.map((route) => route.operationId)).toEqual([first.id, second.id]);
    expect(document.plan.operations.map((operation) => operation.id)).toEqual([
      second.id,
      first.id
    ]);
  });

  it('preserves per-operation threading intent through geometry transforms and replanning', () => {
    let document = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 5, 5),
      ...rectangleLines(20, 0, 25, 5)
    ]);
    const contourId = document.plan.operations[1].contourId;
    document.plan.operations[1].threadingTransition = {
      mode: 'manual',
      wireSeparation: 'manual-before-positioning',
      source: 'operation-override'
    };

    document = translatePathDocument(document, { x: 2, y: 3 })!;
    document = setPathOperationOrderStrategy(document, 'source-order')!;

    expect(document.plan.operations.find((operation) => operation.contourId === contourId))
      .toMatchObject({
        threadingTransition: {
          mode: 'manual',
          wireSeparation: 'manual-before-positioning',
          source: 'operation-override'
        }
      });
  });

  it('sets project-default and per-operation threading policies through typed APIs', () => {
    const source = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 5, 5),
      ...rectangleLines(20, 0, 25, 5)
    ]);
    const withDefault = setProjectThreadingDefault(source, {
      mode: 'manual',
      wireSeparation: 'already-separated'
    });
    const operationId = withDefault!.plan.operations[1].id;
    const withOverride = setPathOperationThreadingTransition(withDefault!, operationId, {
      mode: 'automatic',
      wireSeparation: 'automatic-before-positioning'
    });
    const restoredDefault = setPathOperationThreadingTransition(
      withOverride!,
      operationId,
      null
    );

    expect(withDefault?.setup?.threadingDefault).toEqual({
      mode: 'manual',
      wireSeparation: 'already-separated'
    });
    expect(withOverride?.plan.operations[1].threadingTransition).toEqual({
      mode: 'automatic',
      wireSeparation: 'automatic-before-positioning',
      source: 'operation-override'
    });
    expect(restoredDefault?.plan.operations[1].threadingTransition).toBeUndefined();
  });

  it('sets typed program stops and preserves them through replanning', () => {
    let document = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 5, 5),
      ...rectangleLines(20, 0, 25, 5)
    ]);
    const operationId = document.plan.operations[1].id;
    document = setPathOperationProgramStops(document, operationId, [{
      id: 'retain-part',
      enabled: true,
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 },
      reason: 'part-retention'
    }])!;
    document = setPathOperationOrderStrategy(document, 'source-order')!;

    expect(document.plan.operations.find((operation) => operation.id === operationId)?.programStops)
      .toEqual([{
        id: 'retain-part',
        enabled: true,
        placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 },
        reason: 'part-retention'
      }]);
  });

  it('derives canonical rapid routes without exposing endpoint mutators', () => {
    type PlannedRapid = {
      endPoint: { x: number; y: number };
      operationId: string;
      startPoint: { x: number; y: number };
    };
    const deriveRoutes = Reflect.get(
      pathDocumentOperations,
      'derivePlannedRapidRoutes'
    ) as ((document: ReturnType<typeof createPathPlanningDocumentFromDxfEntities>) => PlannedRapid[]) | undefined;

    expect(deriveRoutes).toBeTypeOf('function');
    expect(Reflect.has(pathDocumentOperations, 'setPlannedRapidSourcePoint')).toBe(false);
    expect(Reflect.has(pathDocumentOperations, 'setPlannedRapidDestinationPoint')).toBe(false);

    let document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 30, y: 20 }, radius: 5 }
    ]);
    for (const operation of document.plan.operations) {
      document = setCircleOperationCenterPierceLeadIn(document, operation.id)!;
    }
    document = setManualInitialWirePosition(document, { x: 1, y: 2 })!;

    expect(deriveRoutes?.(document).map((route) => [route.startPoint, route.endPoint])).toEqual([
      [{ x: 1, y: 2 }, { x: 10, y: 20 }],
      [{ x: 15, y: 20 }, { x: 30, y: 20 }]
    ]);
  });

  it('adds an explicit manual lead to a planned operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      rectangleLines(0, 0, 20, 10)
    );
    const operation = document.plan.operations[0];

    const withLead = setPathOperationManualLeadIn(document, operation.id, { x: -5, y: 0 });

    expect(withLead?.plan.operations[0].transitions?.entry).toMatchObject({
      from: { x: -5, y: 0 },
      to: operation.startPoint
    });
    expect(Object.keys(withLead?.plan.operations[0].overrides ?? {})).not.toContain('leadIn');
  });

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

  it('translates every contour in an imported document as one placement operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 10, 5),
      { type: 'circle', layer: 'CUT', center: { x: 30, y: 20 }, radius: 5 }
    ]);

    const translated = translatePathDocument(document, { x: -10, y: 4 });
    expect(translated?.pathElements.map((element) => element.bounds)).toEqual(expect.arrayContaining([
      { minX: -10, minY: 4, maxX: 0, maxY: 9 },
      { minX: 15, minY: 19, maxX: 25, maxY: 29 }
    ]));
    expect(translated?.plan.operations.map((operation) => operation.startPoint)).toEqual(expect.arrayContaining([
      { x: 0, y: 4 },
      { x: 25, y: 24 }
    ]));
    expect(document.pathElements.map((element) => element.bounds)).toEqual(expect.arrayContaining([
      { minX: 0, minY: 0, maxX: 10, maxY: 5 },
      { minX: 25, minY: 15, maxX: 35, maxY: 25 }
    ]));
  });

  it('keeps lossy import diagnostics blocking after translating sanitized geometry', () => {
    const duplicate = {
      type: 'line' as const,
      layer: 'CUT',
      start: { x: 0, y: 0 },
      end: { x: 5, y: 0 }
    };
    const document = createPathPlanningDocumentFromDxfEntities([duplicate, duplicate]);

    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toContain('duplicate-segment');

    const translated = translatePathDocument(document, { x: 10, y: 20 });
    expect(translated?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'duplicate-segment'
    );
  });

  it('recomputes duplicate diagnostics introduced and then resolved by geometry edits', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 15, y: 0 } }
    ]);
    const movedSegmentId = document.segments[1].id;

    const duplicated = translatePathSegment(document, movedSegmentId, { x: -10, y: 0 });
    expect(duplicated?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'duplicate-segment'
    );

    const restored = translatePathSegment(duplicated!, movedSegmentId, { x: 10, y: 0 });
    expect(restored?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'duplicate-segment'
    );
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

  it.each([1e-16, 1e-15])(
    'preserves a bulge %s tiny arc sweep through translation, rotation, and reflection',
    (bulge) => {
      const document = createPathPlanningDocumentFromDxfEntities([tinyBulgePolyline(bulge, false)]);
      const source = firstArc(document);
      const translated = firstArc(translatePathDocument(document, { x: 7, y: -3 }));
      const rotated = firstArc(rotatePathDocument(document, 37, { x: 0, y: 0 }));
      const mirrored = firstArc(mirrorPathDocument(document, 'x', { x: 0, y: 0 }));

      expect(source.sweepRadians).toBe(4 * Math.atan(bulge));
      expect(translated.sweepRadians).toBe(source.sweepRadians);
      expect(rotated.sweepRadians).toBe(source.sweepRadians);
      expect(mirrored.sweepRadians).toBe(-source.sweepRadians);
      expect(translated.clockwise).toBe(false);
      expect(rotated.clockwise).toBe(false);
      expect(mirrored.clockwise).toBe(true);
      expect(translated.length).toBeCloseTo(1, 12);
      expect(rotated.length).toBeCloseTo(1, 12);
      expect(mirrored.length).toBeCloseTo(1, 12);
    }
  );

  it.each([1e-16, 1e-15])(
    'parameterizes equivalent cardinal tangent angles at the midpoint of a bulge %s tiny arc',
    (bulge) => {
      const document = createPathPlanningDocumentFromDxfEntities([tinyBulgePolyline(bulge, false)]);
      const segment = firstArc(document);
      const forward = { segmentId: segment.id, reversed: false };
      const reversed = { segmentId: segment.id, reversed: true };

      for (const angle of [-Math.PI / 2, (3 * Math.PI) / 2]) {
        expect(arcParameterAtAngle(segment, forward, angle)).toBeCloseTo(0.5, 12);
        expect(arcParameterAtAngle(segment, reversed, angle)).toBeCloseTo(0.5, 12);
      }
    }
  );

  it.each([
    { bulge: 1e-16, reverse: false },
    { bulge: 1e-15, reverse: false },
    { bulge: 1e-16, reverse: true },
    { bulge: 1e-15, reverse: true }
  ])(
    'constructs the midpoint tangent on a tiny bulge $bulge arc (reverse=$reverse)',
    ({ bulge, reverse }) => {
      const document = createPathPlanningDocumentFromDxfEntities([tinyBulgePolyline(bulge, false)]);
      const operation = document.plan.operations[0];
      const active = reverse ? reversePathOperation(document, operation.id)! : document;

      const result = inferPathPoint(active, {
        mode: 'tangent',
        sourcePoint: { x: 1e8, y: -bulge / 2 },
        hintPoint: { x: 0.5, y: -bulge / 2 }
      });

      expect(result?.relation).toBe('tangent');
      expect(result?.t).toBeCloseTo(0.5, 12);
      expect(result?.point.x).toBeCloseTo(0.5, 12);
      expect(result?.point.y).toBeCloseTo(-bulge / 2, 28);
    }
  );

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

  it('translates a circle contour with shifted endpoints and a stable center', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];

    const translated = translatePathElement(document, document.pathElements[0].id, { x: -7, y: 3 });
    expect(translated?.plan.operations[0]).toMatchObject({
      id: operation.id,
      startPoint: { x: 8, y: 23 },
      endPoint: { x: 8, y: 23 }
    });
    expect(translated?.segments[0]).toMatchObject({ center: { x: 3, y: 23 } });
  });

  it('rotates an imported document around a chosen origin', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));

    const rotated = rotatePathDocument(document, 180, { x: 0, y: 0 });
    const firstSegment = rotated?.segments[0];

    expect(firstSegment).toMatchObject({
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: -10, y: 0 }
    });
    expect(rotated?.contours[0].bounds).toEqual({
      minX: -10,
      minY: -5,
      maxX: 0,
      maxY: 0
    });
  });

  it('mirrors imported arcs across an axis and flips their cutting direction', () => {
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

    const mirrored = mirrorPathDocument(document, 'x', { x: 0, y: 0 });

    expect(mirrored?.segments[0]).toMatchObject({
      kind: 'arc',
      start: { x: 5, y: 0 },
      end: { x: 0, y: -5 },
      center: { x: 0, y: 0 },
      clockwise: true
    });
  });

  it('rotates a circle preferred start point with the document', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 0 }, radius: 5 }
    ]);

    const rotated = rotatePathDocument(document, 180, { x: 0, y: 0 });
    expect(rotated?.segments[0]).toMatchObject({
      kind: 'circle',
      center: { x: -10, y: 0 },
      preferredStart: { x: -15, y: 0 }
    });
  });

  it('keeps a manually selected circle start stable after translating the contour', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];
    const started = setClosedOperationStartNearPoint(document, operation.id, { x: 10, y: 25 });

    const translated = translatePathElement(started!, started!.pathElements[0].id, { x: -7, y: 3 });
    expect(translated?.plan.operations[0].startPoint.x).toBeCloseTo(3, 6);
    expect(translated?.plan.operations[0].startPoint.y).toBeCloseTo(28, 6);
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
    expect(reversed?.plan.operations[0].direction).toBe('reverse');
    expect(reversed?.plan.operations[0].segmentRefs).toHaveLength(4);
  });

  it('sets a closed operation start at a clicked point by splitting the containing line segment', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];

    const edited = setClosedOperationStartNearPoint(document, operation.id, { x: 5, y: 0 });
    expect(edited?.plan.operations[0].startPoint).toEqual({ x: 5, y: 0 });
    expect(edited?.plan.operations[0].segmentRefs).toHaveLength(5);
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
    expect(edited?.plan.operations[0].startPoint.x).toBeCloseTo(5, 6);
    expect(edited?.plan.operations[0].startPoint.y).toBeCloseTo(5, 6);
    expect(edited?.plan.operations[0].segmentRefs).toHaveLength(5);
  });

  it.each([
    { bulge: 1e-16, reverse: false },
    { bulge: 1e-15, reverse: false },
    { bulge: 1e-16, reverse: true }
  ])(
    'splits a tiny bulge $bulge arc at its stored midpoint parameter (reverse=$reverse)',
    ({ bulge, reverse }) => {
      const document = createPathPlanningDocumentFromDxfEntities([tinyBulgePolyline(bulge, true)]);
      const sourceArc = firstArc(document);
      const initialOperation = document.plan.operations[0];
      const active = reverse ? reversePathOperation(document, initialOperation.id)! : document;
      const operation = active.plan.operations[0];
      const sourceRef = operation.segmentRefs.find((ref) => ref.segmentId === sourceArc.id);
      expect(sourceRef).not.toBeUndefined();
      const orientedSourceSweep = sourceRef!.reversed
        ? -sourceArc.sweepRadians
        : sourceArc.sweepRadians;

      const edited = setClosedOperationStartNearPoint(active, operation.id, {
        x: 0.5,
        y: -bulge / 2
      });
      const createdIds = edited?.plan.operations[0].overrides?.start?.createdSegmentIds ?? [];
      const splitArcs = createdIds.map((id) => edited?.segments.find((segment) => segment.id === id));

      expect(createdIds).toHaveLength(2);
      expect(splitArcs.every((segment) => segment?.kind === 'arc')).toBe(true);
      const [first, second] = splitArcs;
      if (first?.kind !== 'arc' || second?.kind !== 'arc') return;

      expect(Math.sign(first.sweepRadians)).toBe(Math.sign(orientedSourceSweep));
      expect(Math.sign(second.sweepRadians)).toBe(Math.sign(orientedSourceSweep));
      expect(first.sweepRadians + second.sweepRadians).toBe(orientedSourceSweep);
      expect(first.length + second.length).toBeCloseTo(sourceArc.length, 12);
      expect(Math.abs(first.sweepRadians)).toBeLessThan(1e-12);
      expect(Math.abs(second.sweepRadians)).toBeLessThan(1e-12);
      expect(first.clockwise).toBe(orientedSourceSweep < 0);
      expect(second.clockwise).toBe(orientedSourceSweep < 0);
      expect(edited?.plan.operations[0].startPoint.x).toBeCloseTo(0.5, 12);
      expect(edited?.plan.operations[0].startPoint.y).toBeCloseTo(-bulge / 2, 28);
    }
  );

  it('sets a circle start at the clicked point instead of the opposite split point', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];

    const edited = setClosedOperationStartNearPoint(document, operation.id, { x: 0, y: 5 });
    expect(edited?.plan.operations[0].startPoint.x).toBeCloseTo(0, 6);
    expect(edited?.plan.operations[0].startPoint.y).toBeCloseTo(5, 6);
  });

  it('projects a circle center start pick to a valid circumference start point', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];

    const edited = setClosedOperationStartNearPoint(document, operation.id, { x: 10, y: 20 });
    expect(edited?.plan.operations[0].startPoint).toEqual({ x: 15, y: 20 });
  });

  it('adds a cut lead-in from the circle center to the contour start', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];

    const edited = setCircleOperationCenterPierceLeadIn(document, operation.id);
    expect(edited?.plan.operations[0].transitions?.entry).toMatchObject({
      from: { x: 10, y: 20 },
      move: 'cut',
      to: { x: 15, y: 20 }
    });
    expect(Object.keys(edited?.plan.operations[0].overrides ?? {})).not.toContain('leadIn');
    expect(edited?.plan.operations[0].metrics.cutLength).toBeCloseTo(2 * Math.PI * 5 + 5, 6);
  });

  it('replaces lead geometry and reviewed no-entry intent through one canonical transition', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operationId = document.plan.operations[0].id;
    const withLead = setPathOperationManualLeadIn(
      document,
      operationId,
      { x: 10, y: 20 }
    )!;
    const withoutLead = setPathOperationTransitions(withLead, operationId, {
      entry: { strategy: 'none', review: 'reviewed' },
      exit: { strategy: 'none', review: 'reviewed' }
    })!;
    const restoredLead = setPathOperationManualLeadIn(
      withoutLead,
      operationId,
      { x: 11, y: 20 }
    )!;

    expect(Object.keys(withoutLead.plan.operations[0].overrides ?? {})).not.toContain('leadIn');
    expect(withoutLead.plan.operations[0].transitions?.entry).toEqual({
      strategy: 'none',
      review: 'reviewed'
    });
    expect(restoredLead.plan.operations[0].transitions?.entry).toMatchObject({
      strategy: 'manual-straight',
      from: { x: 11, y: 20 },
      review: 'reviewed'
    });
  });

  it('keeps a circle center lead-in aligned when moving the operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];
    const edited = setCircleOperationCenterPierceLeadIn(document, operation.id);

    const moved = translatePathDocument(edited!, { x: 2, y: -3 });
    expect(moved?.plan.operations[0].transitions?.entry).toMatchObject({
      from: { x: 12, y: 17 },
      to: { x: 17, y: 17 }
    });
    expect(Object.keys(moved?.plan.operations[0].overrides ?? {})).not.toContain('leadIn');
  });

  it('magnetizes a point to the nearest contour feature with tangent metadata', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));

    const result = inferPathPoint(document, {
      mode: 'perpendicular',
      sourcePoint: { x: 5, y: 3 },
      hintPoint: { x: 5, y: 3 }
    });

    expect(result).toMatchObject({
      mode: 'perpendicular',
      pathElementId: document.pathElements[0].id,
      point: { x: 5, y: 5 },
      tangent: { x: -1, y: 0 }
    });
  });

  it('commits the exact inferred midpoint identity as a closed-operation start', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      rectangleLines(0, 0, 10, 5)
    );
    const operationId = document.plan.operations[0].id;
    const inferred = inferPathPoint(document, {
      mode: 'midpoint',
      operationId,
      hintPoint: { x: 6, y: 5 }
    });

    const edited = setClosedOperationStartAtInferredPoint(document, inferred!);

    expect(edited?.plan.operations[0].startPoint).toEqual(inferred?.point);
    expect(edited?.plan.operations[0].overrides?.start).toMatchObject({
      point: inferred?.point,
      relation: 'new-split-point',
      sourceSegmentId: inferred?.segmentId,
      sourceSegmentIndex: inferred?.segmentIndex
    });
  });

  it('constructs a real tangent point on circular geometry from a source point', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);

    const result = inferPathPoint(document, {
      mode: 'tangent',
      sourcePoint: { x: 10, y: 0 },
      hintPoint: { x: 0, y: 5 }
    });

    expect(result?.relation).toBe('tangent');
    expect(result?.point.x).toBeCloseTo(2.5, 6);
    expect(result?.point.y).toBeCloseTo(4.330127, 6);
    expect(result?.mode).toBe('tangent');
    expect(result?.pathElementId).toBe(document.pathElements[0].id);
  });

  it('slides a perpendicular construction as an explicit nearest fallback on its stored segment', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 10, 5),
      ...rectangleLines(20, 0, 30, 5)
    ]);
    const construction = inferPathPoint(document, {
      mode: 'perpendicular',
      sourcePoint: { x: 5, y: 2 },
      hintPoint: { x: 5, y: 5 }
    }) as MagnetizedPathPoint | null;
    expect(construction).not.toBeNull();

    const slid = reinferStoredPathPoint(
      document,
      {
        mode: construction!.mode,
        operationId: construction!.operationId,
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
    expect(slid?.relation).toBe('nearest-fallback');
  });

  it('slides tangent fallback points as nearest snaps instead of freezing them', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const fallback = inferPathPoint(document, {
      mode: 'tangent',
      sourcePoint: { x: 5, y: 5 },
      hintPoint: { x: 5, y: 5 }
    }) as MagnetizedPathPoint | null;
    expect(fallback?.relation).toBe('nearest-fallback');

    const slid = reinferStoredPathPoint(
      document,
      {
        mode: fallback!.mode,
        operationId: fallback!.operationId,
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

    const fallback = inferPathPoint(document, {
      mode: 'tangent',
      sourcePoint: { x: 5, y: 2 },
      hintPoint: { x: 8, y: 5 }
    });

    expect(fallback?.relation).toBe('nearest-fallback');
    expect(fallback?.point).toEqual({ x: 8, y: 5 });
  });

  it('refreshes contour orientation metadata after reversing an operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));

    const reversed = reversePathOperation(document, document.plan.operations[0].id);

    expect(reversed?.contours[0].orientation).toBe('cw');
    expect(reversed?.contours[0].signedArea).toBeLessThan(0);
  });

  it('preserves manual kept-material intent through classification, reversal, and start rotation', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    document.geometryBasis = 'finished-contour';
    const operationId = document.plan.operations[0].id;
    const manual = setManualCompensationIntent(document, operationId, 'outside');
    const changed = setPathOperationClassification(manual!, operationId, 'exterior');
    const reversed = reversePathOperation(changed!, operationId);
    const rotated = setClosedOperationStartAtSegmentEndpoint(
      reversed!,
      operationId,
      reversed!.plan.operations[0].segmentRefs[1].segmentId,
      'start'
    );

    expect(rotated?.plan.operations[0].compensationIntent).toEqual({
      mode: 'controller',
      keptMaterial: 'outside',
      source: 'manual'
    });
  });

  it('refreshes automatic semantic intent after a classification edit', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    document.geometryBasis = 'finished-contour';
    document.plan.operations[0].compensationIntent = {
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'automatic'
    };

    const hole = setPathOperationClassification(document, document.plan.operations[0].id, 'hole');

    expect(hole?.plan.operations[0].compensationIntent).toEqual({
      mode: 'controller',
      keptMaterial: 'outside',
      source: 'automatic'
    });
    const ambiguous = setPathOperationClassification(
      hole!,
      document.plan.operations[0].id,
      'ambiguous'
    );

    expect(ambiguous?.plan.operations[0].compensationIntent).toBeUndefined();
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

function tinyBulgePolyline(bulge: number, closed: boolean): DxfEntity {
  return {
    type: 'lwpolyline',
    layer: 'CUT',
    closed,
    vertices: [
      { x: 0, y: 0, bulge },
      { x: 1, y: 0, bulge: 0 }
    ]
  };
}

function firstArc(
  document: ReturnType<typeof createPathPlanningDocumentFromDxfEntities> | null | undefined
) {
  const segment = document?.segments.find((candidate) => candidate.kind === 'arc');
  expect(segment?.kind).toBe('arc');
  if (!segment || segment.kind !== 'arc') throw new Error('Expected an arc segment.');
  return segment;
}
