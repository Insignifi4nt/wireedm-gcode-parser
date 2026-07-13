import { describe, expect, it } from 'vitest';

import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import {
  reversePathRefs,
  rotatePathRefs,
  segmentMap,
  signedAreaOfPath
} from '@/domain/path-intel/segments';
import type { PathPlanningDocument } from '@/domain/path-intel/types';

import { resolveControllerCompensation } from '../resolveControllerCompensation';

describe('resolveControllerCompensation', () => {
  it.each([
    ['inside', 'ccw', 'right', 'G42'],
    ['inside', 'cw', 'left', 'G41'],
    ['outside', 'ccw', 'left', 'G41'],
    ['outside', 'cw', 'right', 'G42']
  ] as const)('maps keep-%s %s to %s/%s', (keptMaterial, winding, wireSide, code) => {
    const document = rectangleDocument();
    orient(document, winding);
    document.plan.operations[0].compensationIntent = {
      mode: 'controller',
      keptMaterial,
      source: 'manual'
    };

    expect(resolve(document)).toMatchObject({
      status: 'ready',
      winding,
      keptMaterial,
      wireSide,
      code
    });
  });

  it('reversal flips code while start rotation preserves it and kept material', () => {
    const original = rectangleDocument();
    original.plan.operations[0].compensationIntent = {
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'manual'
    };
    const reversed = structuredClone(original);
    reversed.plan.operations[0].segmentRefs = reversePathRefs(reversed.plan.operations[0].segmentRefs);
    const rotated = structuredClone(original);
    rotated.plan.operations[0].segmentRefs = rotatePathRefs(rotated.plan.operations[0].segmentRefs, 2);

    const originalResult = ready(resolve(original));
    const reversedResult = ready(resolve(reversed));
    const rotatedResult = ready(resolve(rotated));

    expect(reversedResult.code).not.toBe(originalResult.code);
    expect(rotatedResult.code).toBe(originalResult.code);
    expect(reversedResult.keptMaterial).toBe(originalResult.keptMaterial);
    expect(rotatedResult.signedArea).toBeCloseTo(originalResult.signedArea, 12);
  });

  it.each([
    ['lines', rectangleDocument, 50],
    ['arc', arcDocument, Math.PI * 25],
    ['circle', circleDocument, Math.PI * 25],
    ['mixed line and arc', mixedDocument, Math.PI * 12.5]
  ] as const)('derives exact CCW area from final %s segment refs', (_label, createDocument, expectedArea) => {
    const document = createDocument();
    document.plan.operations[0].compensationIntent = {
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'manual'
    };
    orient(document, 'ccw');

    expect(resolve(document)).toMatchObject({ status: 'ready', winding: 'ccw' });
    expect(ready(resolve(document)).signedArea).toBeCloseTo(expectedArea, 12);
  });

  it('ignores stale persisted contour orientation and signed area', () => {
    const document = rectangleDocument();
    document.plan.operations[0].compensationIntent = {
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'manual'
    };
    orient(document, 'cw');
    document.contours[0].orientation = 'ccw';
    document.contours[0].signedArea = 50;

    expect(resolve(document)).toMatchObject({ status: 'ready', winding: 'cw', code: 'G41' });
  });

  it.each([
    ['wire-centre', 'wire-centre'],
    ['missing-intent', 'missing-intent'],
    ['open-path', 'open-path'],
    ['missing-segment', 'missing-segment'],
    ['degenerate', 'degenerate'],
    ['ineligible-topology', 'ineligible-topology']
  ] as const)('blocks %s inputs with a typed reason', (scenario, reason) => {
    const document = rectangleDocument();
    document.plan.operations[0].compensationIntent = {
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'manual'
    };

    if (scenario === 'wire-centre') document.geometryBasis = 'wire-centre';
    if (scenario === 'missing-intent') delete document.plan.operations[0].compensationIntent;
    if (scenario === 'open-path') document.plan.operations[0].closed = false;
    if (scenario === 'missing-segment') document.plan.operations[0].segmentRefs[0].segmentId = 'missing';
    if (scenario === 'degenerate') {
      document.segments = document.segments.map((segment) => ({
        ...segment,
        start: { x: segment.start.x, y: 0 },
        end: { x: segment.end.x, y: 0 }
      }));
    }
    if (scenario === 'ineligible-topology') {
      const diagnostic = {
        id: 'diag_test_topology',
        severity: 'warning' as const,
        code: 'intersecting-topology' as const,
        message: 'Intersection blocks compensation.',
        relatedContourIds: [document.plan.operations[0].contourId]
      };
      document.diagnostics.push(diagnostic);
      document.contours[0].diagnosticIds.push(diagnostic.id);
    }

    expect(resolve(document)).toEqual({ status: 'blocked', reason });
  });

  it('blocks non-finite signed area as degenerate', () => {
    const document = circleDocument();
    document.plan.operations[0].compensationIntent = {
      mode: 'controller',
      keptMaterial: 'outside',
      source: 'manual'
    };
    const circle = document.segments[0];
    if (circle.kind !== 'circle') throw new Error('Expected circle fixture.');
    circle.radius = Number.MAX_VALUE;

    expect(resolve(document)).toEqual({ status: 'blocked', reason: 'degenerate' });
  });

  it('treats explicit centerline intent as missing controller intent', () => {
    const document = rectangleDocument();
    document.plan.operations[0].compensationIntent = { mode: 'centerline', source: 'manual' };

    expect(resolve(document)).toEqual({ status: 'blocked', reason: 'missing-intent' });
  });

  it.each([
    ['permuted line refs', () => {
      const document = rectangleDocument();
      const refs = document.plan.operations[0].segmentRefs;
      document.plan.operations[0].segmentRefs = [refs[0], refs[2], refs[1], refs[3]];
      return document;
    }],
    ['disconnected line', () => {
      const document = rectangleDocument();
      const segment = document.segments[1];
      segment.start = { x: segment.start.x + 2, y: segment.start.y + 1 };
      segment.end = { x: segment.end.x + 2, y: segment.end.y + 1 };
      return document;
    }],
    ['gapped arc', () => {
      const document = arcDocument();
      document.segments[1].start = { x: -4.5, y: 0 };
      return document;
    }]
  ] as const)('blocks nonzero-area final geometry with %s despite cached closed flags', (_label, create) => {
    const document = create();
    document.plan.operations[0].compensationIntent = {
      mode: 'controller', keptMaterial: 'inside', source: 'manual'
    };
    const area = signedAreaOfPath(
      document.plan.operations[0].segmentRefs,
      segmentMap(document.segments)
    );

    expect(area).not.toBe(0);
    expect(Number.isFinite(area)).toBe(true);
    expect(document.plan.operations[0].closed).toBe(true);
    expect(document.chains[0].closed).toBe(true);
    expect(resolve(document)).toEqual({ status: 'blocked', reason: 'ineligible-topology' });
  });

  it('accepts endpoint differences within the configured planner coincidence tolerance', () => {
    const document = rectangleDocument();
    document.options.coincidenceEpsilon = 0.00001;
    document.segments[1].start = { x: 10.000005, y: 0 };
    document.plan.operations[0].compensationIntent = {
      mode: 'controller', keptMaterial: 'inside', source: 'manual'
    };

    expect(resolve(document)).toMatchObject({ status: 'ready' });
  });
});

function resolve(document: PathPlanningDocument) {
  return resolveControllerCompensation({ document, operation: document.plan.operations[0] });
}

function ready(result: ReturnType<typeof resolveControllerCompensation>) {
  if (result.status !== 'ready') throw new Error(`Expected ready result, received ${result.reason}.`);
  return result;
}

function orient(document: PathPlanningDocument, winding: 'cw' | 'ccw') {
  const result = resolveWithTemporaryIntent(document);
  const currentlyCcw = result.signedArea > 0;
  if ((winding === 'ccw') !== currentlyCcw) {
    document.plan.operations[0].segmentRefs = reversePathRefs(document.plan.operations[0].segmentRefs);
  }
}

function resolveWithTemporaryIntent(document: PathPlanningDocument) {
  const intent = document.plan.operations[0].compensationIntent;
  document.plan.operations[0].compensationIntent = {
    mode: 'controller', keptMaterial: 'inside', source: 'manual'
  };
  const result = ready(resolve(document));
  document.plan.operations[0].compensationIntent = intent;
  return result;
}

function rectangleDocument() {
  return finishedDocument([
    line(0, 0, 10, 0),
    line(10, 0, 10, 5),
    line(10, 5, 0, 5),
    line(0, 5, 0, 0)
  ]);
}

function arcDocument() {
  return finishedDocument([
    arc(5, 0, -5, 0, 0, 0, 5, false, Math.PI),
    arc(-5, 0, 5, 0, 0, 0, 5, false, Math.PI)
  ]);
}

function circleDocument() {
  return finishedDocument([{
    type: 'circle' as const,
    layer: 'CUT',
    center: { x: 0, y: 0 },
    radius: 5
  }]);
}

function mixedDocument() {
  return finishedDocument([
    line(-5, 0, 5, 0),
    arc(5, 0, -5, 0, 0, 0, 5, false, Math.PI)
  ]);
}

function finishedDocument(entities: Parameters<typeof createPathPlanningDocumentFromDxfEntities>[0]) {
  const document = createPathPlanningDocumentFromDxfEntities(entities, {
    allowReverseClosedContours: false,
    startPoint: { x: 0, y: 0 }
  });
  document.geometryBasis = 'finished-contour';
  return document;
}

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}

function arc(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  centerX: number,
  centerY: number,
  radius: number,
  clockwise: boolean,
  sweepRadians: number
) {
  return {
    type: 'arc' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
    center: { x: centerX, y: centerY },
    radius,
    startAngle: Math.atan2(startY - centerY, startX - centerX),
    endAngle: Math.atan2(endY - centerY, endX - centerX),
    clockwise,
    sweepRadians: clockwise ? -Math.abs(sweepRadians) : Math.abs(sweepRadians)
  };
}
