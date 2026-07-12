import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { pathPlanToGcodeBody } from '@/domain/path-intel/postGcode';
import { arcParameterAtAngle } from '@/domain/path-intel/segments';
import { composeUpidGCodeExport } from '@/domain/upid/upidDocument';

import {
  constructMagnetizedPoint,
  magnetizePointToPath,
  movePathOperation,
  previewClosedOperationStartNearPoint,
  reversePathOperation,
  mirrorPathDocument,
  rotatePathDocument,
  setClosedOperationStartAtSegmentEndpoint,
  setPathOperationClassification,
  setClosedOperationStartAtExistingPointNearPoint,
  setCircleOperationCenterPierceLeadIn,
  setClosedOperationStartNearPoint,
  setPathOperationOrderStrategy,
  movePathSegmentCenterTo,
  slideMagnetizedPointOnSegment,
  translatePathDocument,
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

  it('translates every contour in an imported document as one placement operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 10, 5),
      { type: 'circle', layer: 'CUT', center: { x: 30, y: 20 }, radius: 5 }
    ]);

    const translated = translatePathDocument(document, { x: -10, y: 4 });
    const body = pathPlanToGcodeBody(translated!.plan, translated!.segments);

    expect(translated?.pathElements.map((element) => element.bounds)).toEqual(expect.arrayContaining([
      { minX: -10, minY: 4, maxX: 0, maxY: 9 },
      { minX: 15, minY: 19, maxX: 25, maxY: 29 }
    ]));
    expect(translated?.plan.operations.map((operation) => operation.startPoint)).toEqual(expect.arrayContaining([
      { x: 0, y: 4 },
      { x: 25, y: 24 }
    ]));
    expect(body.split('\n')).toContain('G0 X25.000 Y24.000');
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
    const exportResult = composeUpidGCodeExport(translated!, {
      header: 'G90 G90.1 G17',
      footer: 'M30'
    });

    expect(translated?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'duplicate-segment'
    );
    expect(exportResult.canDownload).toBe(false);
    expect(exportResult.body).toBe('');
    expect(exportResult.blockingDiagnostics.map((diagnostic) => diagnostic.code)).toContain(
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
    expect(
      composeUpidGCodeExport(duplicated!, { header: 'G90 G90.1 G17', footer: 'M30' })
        .canDownload
    ).toBe(false);

    const restored = translatePathSegment(duplicated!, movedSegmentId, { x: 10, y: 0 });
    expect(restored?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'duplicate-segment'
    );
    expect(
      composeUpidGCodeExport(restored!, { header: 'G90 G90.1 G17', footer: 'M30' })
        .canDownload
    ).toBe(true);
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

      const result = constructMagnetizedPoint(
        active,
        { x: 1e8, y: -bulge / 2 },
        { x: 0.5, y: -bulge / 2 },
        'tangent'
      );

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

  it('rotates an imported document around a chosen origin before posting G-code', () => {
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
    expect(pathPlanToGcodeBody(rotated!.plan, rotated!.segments).split('\n').slice(0, 2)).toEqual([
      'G0 X0.000 Y0.000',
      'G1 X-10.000 Y0.000'
    ]);
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
    expect(pathPlanToGcodeBody(mirrored!.plan, mirrored!.segments).split('\n')).toEqual([
      'G0 X5.000 Y0.000',
      'G2 X0.000 Y-5.000 I-5.000 J0.000'
    ]);
  });

  it('rotates a circle preferred start point with the document', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 0 }, radius: 5 }
    ]);

    const rotated = rotatePathDocument(document, 180, { x: 0, y: 0 });
    const body = pathPlanToGcodeBody(rotated!.plan, rotated!.segments);

    expect(rotated?.segments[0]).toMatchObject({
      kind: 'circle',
      center: { x: -10, y: 0 },
      preferredStart: { x: -15, y: 0 }
    });
    expect(body.split('\n')).toEqual([
      'G0 X-15.000 Y0.000',
      'G3 X-5.000 Y0.000 I5.000 J0.000',
      'G3 X-15.000 Y0.000 I-5.000 J0.000'
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

  it('adds a cut lead-in from the circle center to the contour start', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];

    const edited = setCircleOperationCenterPierceLeadIn(document, operation.id);
    const body = pathPlanToGcodeBody(edited!.plan, edited!.segments);

    expect(edited?.plan.operations[0].overrides?.leadIn).toMatchObject({
      from: { x: 10, y: 20 },
      move: 'cut',
      to: { x: 15, y: 20 }
    });
    expect(edited?.plan.operations[0].metrics.cutLength).toBeCloseTo(2 * Math.PI * 5 + 5, 6);
    expect(body.split('\n')).toEqual([
      'G0 X10.000 Y20.000',
      'G1 X15.000 Y20.000',
      'G3 X5.000 Y20.000 I-5.000 J0.000',
      'G3 X15.000 Y20.000 I5.000 J0.000'
    ]);
  });

  it('keeps a circle center lead-in aligned when moving the operation', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];
    const edited = setCircleOperationCenterPierceLeadIn(document, operation.id);

    const moved = translatePathDocument(edited!, { x: 2, y: -3 });
    const body = pathPlanToGcodeBody(moved!.plan, moved!.segments);

    expect(moved?.plan.operations[0].overrides?.leadIn).toMatchObject({
      from: { x: 12, y: 17 },
      to: { x: 17, y: 17 }
    });
    expect(body.split('\n').slice(0, 2)).toEqual([
      'G0 X12.000 Y17.000',
      'G1 X17.000 Y17.000'
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
