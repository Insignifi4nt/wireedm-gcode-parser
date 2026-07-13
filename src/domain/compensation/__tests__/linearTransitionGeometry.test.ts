import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { reversePathOperation } from '@/domain/path-editor/pathDocumentOperations';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import {
  createArcSegment,
  createCircleSegment,
  createLineSegment,
  orientedSegmentStart,
  rotatePathRefs,
  segmentMap
} from '@/domain/path-intel/segments';
import type { PathOperation, PathPlanningDocument, Point2 } from '@/domain/path-intel/types';

import { generateLinearCompensationTransition } from '../linearTransitionGeometry';
import { orientedEndpointTangents } from '../pathTangents';

const source = {
  sourceEntityIndex: 0,
  sourceEntityType: 'test',
  layer: 'CUT',
  exact: true
};

describe('orientedEndpointTangents', () => {
  it('returns exact oriented line and arc endpoint tangents', () => {
    const line = createLineSegment({
      id: 'line', source, start: { x: 0, y: 0 }, end: { x: 4, y: 0 }
    });
    const arc = createArcSegment({
      id: 'arc',
      source,
      start: { x: 1, y: 0 },
      end: { x: 0, y: 1 },
      center: { x: 0, y: 0 },
      radius: 1,
      clockwise: false
    });

    expect(orientedEndpointTangents(line, { segmentId: line.id, reversed: true })).toEqual({
      start: { x: -1, y: 0 },
      end: { x: -1, y: 0 }
    });
    expect(orientedEndpointTangents(arc, { segmentId: arc.id, reversed: false })).toEqual({
      start: { x: 0, y: 1 },
      end: { x: -1, y: 0 }
    });
  });

  it('derives a transformed circle tangent from its real preferred start', () => {
    const circle = createCircleSegment({
      id: 'circle',
      source,
      center: { x: 0, y: 0 },
      radius: 5,
      preferredStart: { x: 0, y: 5 }
    });

    expect(orientedEndpointTangents(circle, { segmentId: circle.id, reversed: false })).toEqual({
      start: { x: -1, y: 0 },
      end: { x: -1, y: 0 }
    });
    expect(orientedEndpointTangents(circle, { segmentId: circle.id, reversed: true })).toEqual({
      start: { x: 1, y: 0 },
      end: { x: 1, y: 0 }
    });
  });
});

describe('generateLinearCompensationTransition', () => {
  it('generates tangent lead-in and lead-out for a smooth closed contour', () => {
    const document = circleDocument();
    const operation = closedOperation(document);

    const result = generateLinearCompensationTransition({
      document,
      operation,
      leadLengthMm: 2,
      expectedMaximumOffsetMm: 0.25,
      coordinatePrecision: 3,
      workArea: { widthMm: null, lengthMm: null }
    });

    expect(result).toMatchObject({
      status: 'ready',
      startPoint: operation.startPoint,
      leadIn: { end: operation.startPoint },
      leadOut: { start: operation.startPoint },
      selectedCandidateIndex: 0,
      reason: 'automatic-safe-start'
    });
    if (result.status !== 'ready') throw new Error('Expected a ready transition.');
    expect(distance(result.leadIn.start, result.leadIn.end)).toBeCloseTo(2);
    expect(distance(result.leadOut.start, result.leadOut.end)).toBeCloseTo(2);
  });

  it('reverses transition tangents without mutating either input document', () => {
    const forward = circleDocument();
    const operationId = closedOperation(forward).id;
    const reversed = reversePathOperation(forward, operationId)!;
    const forwardBefore = structuredClone(forward);
    const reversedBefore = structuredClone(reversed);

    const before = transition(forward, closedOperation(forward));
    const after = transition(reversed, closedOperation(reversed));

    expect(forward).toEqual(forwardBefore);
    expect(reversed).toEqual(reversedBefore);
    expect(before).toMatchObject({ status: 'ready' });
    expect(after).toMatchObject({ status: 'ready' });
    if (before.status !== 'ready' || after.status !== 'ready') {
      throw new Error('Expected reversal-safe transitions.');
    }
    expect(after.leadIn.start).toEqual(before.leadOut.end);
    expect(after.leadOut.end).toEqual(before.leadIn.start);
  });

  it('blocks a sharp manual start instead of relocating it', () => {
    const document = rectangleDocument();
    const operation = closedOperation(document);
    operation.overrides = {
      start: {
        kind: 'manual',
        point: { ...operation.startPoint },
        relation: 'existing-point',
        sourceSegmentId: operation.segmentRefs[0].segmentId,
        sourceSegmentIndex: 0,
        pointRole: 'start',
        createdSegmentIds: []
      }
    };

    expect(transition(document, operation)).toEqual({
      status: 'blocked',
      reason: 'sharp-manual-start'
    });
  });

  it('chooses the first deterministic smooth endpoint for an automatic start', () => {
    const document = smoothCandidateDocument();
    const operation = closedOperation(document);
    rotateOperationToSharpStart(document, operation);

    const first = transition(document, operation);
    const second = transition(document, operation);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: 'ready',
      reason: 'automatic-safe-start'
    });
    if (first.status !== 'ready') throw new Error('Expected an alternate ready transition.');
    expect(first.selectedCandidateIndex).toBeGreaterThan(0);
  });

  it('blocks exact collisions with another contour', () => {
    const document = circleDocument([
      lineEntity({ x: 4, y: -1 }, { x: 6, y: -1 })
    ]);

    expect(transition(document, closedOperation(document))).toEqual({
      status: 'blocked',
      reason: 'collision'
    });
  });

  it('blocks a tangent lead that re-enters a non-incident segment of its own contour', () => {
    const document = selfCollisionDocument();
    const operation = closedOperation(document);
    rotateOperationToPoint(document, operation, { x: 0, y: 5 });

    expect(generateLinearCompensationTransition({
      document,
      operation,
      leadLengthMm: 10,
      expectedMaximumOffsetMm: 0.25,
      coordinatePrecision: 3,
      workArea: { widthMm: null, lengthMm: null }
    })).toEqual({ status: 'blocked', reason: 'collision' });
  });

  it('blocks overlapping leads and non-incident contacts at the intended start point', () => {
    const overlap = splitRectangleDocument();
    const overlapOperation = closedOperation(overlap);
    rotateOperationToPoint(overlap, overlapOperation, { x: 5, y: 0 });
    const externalContact = circleDocument([
      lineEntity({ x: 5, y: 0 }, { x: 7, y: 0 })
    ]);

    expect(transition(overlap, overlapOperation)).toEqual({
      status: 'blocked', reason: 'collision'
    });
    expect(transition(externalContact, closedOperation(externalContact))).toEqual({
      status: 'blocked', reason: 'collision'
    });
  });

  it('blocks a maximum-offset envelope collision without a centerline intersection', () => {
    const document = circleDocument([
      lineEntity({ x: 5.2, y: -2 }, { x: 5.2, y: -0.5 })
    ]);

    expect(transition(document, closedOperation(document))).toEqual({
      status: 'blocked',
      reason: 'collision'
    });
  });

  it('blocks work-area overflow using geometry, transitions, and offset envelope extents', () => {
    const document = circleDocument();
    const operation = closedOperation(document);

    expect(generateLinearCompensationTransition({
      document,
      operation,
      leadLengthMm: 2,
      expectedMaximumOffsetMm: 0.5,
      coordinatePrecision: 3,
      workArea: { widthMm: 10, lengthMm: 10 }
    })).toEqual({ status: 'blocked', reason: 'outside-work-area' });
  });

  it('blocks transition moves that collapse at configured coordinate precision', () => {
    const document = circleDocument();
    const operation = closedOperation(document);

    expect(generateLinearCompensationTransition({
      document,
      operation,
      leadLengthMm: 0.0004,
      expectedMaximumOffsetMm: 0.0001,
      coordinatePrecision: 3,
      workArea: { widthMm: null, lengthMm: null }
    })).toEqual({ status: 'blocked', reason: 'precision-collapse' });
  });

  it('requires a finite positive collision envelope', () => {
    const document = circleDocument();
    const operation = closedOperation(document);

    expect(generateLinearCompensationTransition({
      document,
      operation,
      leadLengthMm: 2,
      expectedMaximumOffsetMm: null,
      coordinatePrecision: 3,
      workArea: { widthMm: null, lengthMm: null }
    })).toEqual({ status: 'blocked', reason: 'missing-envelope' });
  });
});

function transition(document: PathPlanningDocument, operation: PathOperation) {
  return generateLinearCompensationTransition({
    document,
    operation,
    leadLengthMm: 2,
    expectedMaximumOffsetMm: 0.25,
    coordinatePrecision: 3,
    workArea: { widthMm: null, lengthMm: null }
  });
}

function circleDocument(extra: DxfEntity[] = []) {
  return createPathPlanningDocumentFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
    ...extra
  ]);
}

function rectangleDocument() {
  return createPathPlanningDocumentFromDxfEntities(rectanglePoints([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }
  ]));
}

function smoothCandidateDocument() {
  return createPathPlanningDocumentFromDxfEntities([
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
    },
    {
      type: 'arc',
      layer: 'CUT',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 90,
      endAngle: 180,
      clockwise: false,
      start: { x: 0, y: 5 },
      end: { x: -5, y: 0 }
    },
    lineEntity({ x: -5, y: 0 }, { x: 5, y: 0 })
  ]);
}

function splitRectangleDocument() {
  return createPathPlanningDocumentFromDxfEntities(rectanglePoints([
    { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 },
    { x: 10, y: 10 }, { x: 0, y: 10 }
  ]));
}

function selfCollisionDocument() {
  return createPathPlanningDocumentFromDxfEntities([
    {
      type: 'arc', layer: 'CUT', center: { x: 0, y: 4 }, radius: 1,
      startAngle: 90, endAngle: 0, clockwise: true,
      start: { x: 0, y: 5 }, end: { x: 1, y: 4 }
    },
    lineEntity({ x: 1, y: 4 }, { x: 1, y: 0 }),
    lineEntity({ x: 1, y: 0 }, { x: 5, y: 0 }),
    lineEntity({ x: 5, y: 0 }, { x: 5, y: 6 }),
    lineEntity({ x: 5, y: 6 }, { x: -1, y: 6 }),
    {
      type: 'arc', layer: 'CUT', center: { x: 0, y: 6 }, radius: 1,
      startAngle: 180, endAngle: 270, clockwise: false,
      start: { x: -1, y: 6 }, end: { x: 0, y: 5 }
    }
  ]);
}

function rectanglePoints(points: Point2[]): DxfEntity[] {
  return points.map((point, index) => lineEntity(point, points[(index + 1) % points.length]));
}

function lineEntity(start: Point2, end: Point2): DxfEntity {
  return { type: 'line', layer: 'CUT', start, end };
}

function closedOperation(document: PathPlanningDocument) {
  const operation = document.plan.operations.find((candidate) => candidate.closed);
  if (!operation) throw new Error('Expected a closed operation fixture.');
  return operation;
}

function rotateOperationToSharpStart(document: PathPlanningDocument, operation: PathOperation) {
  const segmentsById = segmentMap(document.segments);
  const refs = operation.segmentRefs;
  const sharpIndex = refs.findIndex((ref, index) => {
    const previousRef = refs[(index + refs.length - 1) % refs.length];
    const previous = orientedEndpointTangents(segmentsById.get(previousRef.segmentId)!, previousRef);
    const current = orientedEndpointTangents(segmentsById.get(ref.segmentId)!, ref);
    return previous && current && Math.abs(previous.end.x * current.start.y - previous.end.y * current.start.x) > 0.5;
  });
  if (sharpIndex < 0) throw new Error('Expected a sharp fixture endpoint.');
  operation.segmentRefs = rotatePathRefs(refs, sharpIndex);
  operation.startPoint = orientedSegmentStart(
    segmentsById.get(operation.segmentRefs[0].segmentId)!,
    operation.segmentRefs[0]
  );
  operation.endPoint = { ...operation.startPoint };
}

function rotateOperationToPoint(
  document: PathPlanningDocument,
  operation: PathOperation,
  point: Point2
) {
  const segmentsById = segmentMap(document.segments);
  const index = operation.segmentRefs.findIndex((ref) => {
    const start = orientedSegmentStart(segmentsById.get(ref.segmentId)!, ref);
    return distance(start, point) < 1e-9;
  });
  if (index < 0) throw new Error('Expected fixture start point.');
  operation.segmentRefs = rotatePathRefs(operation.segmentRefs, index);
  operation.startPoint = { ...point };
  operation.endPoint = { ...point };
}

function distance(left: Point2, right: Point2) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}
