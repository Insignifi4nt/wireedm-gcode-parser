import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { deriveActiveMachiningOperations, setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { reversePathOperation, setClosedOperationStartNearPoint } from '../pathDocumentOperations';

describe('machining ranges through contour start splits', () => {
  it.each([false, true])('preserves excluded circle intervals across wrapped splits, reversed %s', (reversed) => {
    let source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ], { allowReverseClosedContours: false });
    const operationId = source.plan.operations[0].id;
    source = setMachiningSpanParticipation(source, {
      sourceSegmentId: source.segments[0].id, range: { start: 0.1, end: 0.3 }, participation: 'inactive-reference'
    })!;
    if (reversed) source = reversePathOperation(source, operationId)!;
    const before = deriveActiveMachiningOperations(source);
    const split = setClosedOperationStartNearPoint(source, operationId, { x: 0, y: 5 })!;
    const splitAgain = setClosedOperationStartNearPoint(split, operationId, { x: -5, y: 0 })!;
    for (const document of [split, splitAgain]) {
      const after = deriveActiveMachiningOperations(document);
      expect(validateUpidDocument(JSON.parse(JSON.stringify(document))).structurallyValid).toBe(true);
      expect(after.status).toBe('ready');
      expect(after.operations).toHaveLength(1);
      expect(after.operations[0].metrics.cutLength).toBeCloseTo(8 * Math.PI, 10);
      expect(after.operations[0].startPoint.x).toBeCloseTo(before.operations[0].startPoint.x, 10);
      expect(after.operations[0].startPoint.y).toBeCloseTo(before.operations[0].startPoint.y, 10);
      expect(after.operations[0].endPoint.x).toBeCloseTo(before.operations[0].endPoint.x, 10);
      expect(after.operations[0].endPoint.y).toBeCloseTo(before.operations[0].endPoint.y, 10);
    }
  });

  it.each([false, true])('preserves a line exclusion crossing the new start split, reversed %s', (reversed) => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
      { type: 'line', layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
    ], { allowReverseClosedContours: false });
    let excluded = setMachiningSpanParticipation(source, {
      sourceSegmentId: source.segments[0].id, range: { start: 0.2, end: 0.8 }, participation: 'inactive-reference'
    })!;
    if (reversed) excluded = reversePathOperation(excluded, source.plan.operations[0].id)!;
    const split = setClosedOperationStartNearPoint(excluded, source.plan.operations[0].id, { x: 5, y: 0 })!;
    const active = deriveActiveMachiningOperations(split);
    expect(validateUpidDocument(split).structurallyValid).toBe(true);
    expect(active.status).toBe('ready');
    expect(active.operations[0].metrics.cutLength).toBeCloseTo(34, 12);
    expect(active.operations[0].startPoint).toEqual({ x: reversed ? 2 : 8, y: 0 });
    expect(active.operations[0].endPoint).toEqual({ x: reversed ? 8 : 2, y: 0 });
  });
});
