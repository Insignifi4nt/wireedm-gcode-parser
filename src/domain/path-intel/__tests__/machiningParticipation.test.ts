import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { translatePathDocument } from '@/domain/path-editor/pathDocumentOperations';

import {
  deriveActiveMachiningOperations,
  setPartialContourEntryReview,
  setPartialContourCompensationSide,
  setMachiningSpanParticipation
} from '../machiningParticipation';

describe('machining participation', () => {
  it('disables and re-enables a whole source segment without deleting geometry', () => {
    const source = rectangleDocument();
    const sourceIds = source.segments.map((segment) => segment.id);
    const disabled = setMachiningSpanParticipation(source, {
      sourceSegmentId: sourceIds[0],
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    const derived = deriveActiveMachiningOperations(disabled);
    const reenabled = setMachiningSpanParticipation(disabled, {
      sourceSegmentId: sourceIds[0],
      range: { start: 0, end: 1 },
      participation: 'active-cut'
    })!;

    expect(disabled.segments.map((segment) => segment.id)).toEqual(sourceIds);
    expect(derived.status).toBe('ready');
    expect(derived.operations).toHaveLength(1);
    expect(derived.operations[0]).toMatchObject({
      closed: false,
      classification: 'exterior',
      machiningIntent: {
        kind: 'partial-contour',
        sourceOperationId: source.plan.operations[0].id
      },
      metrics: { segmentCount: 3 }
    });
    expect(reenabled.machiningParticipation?.spans).toEqual([]);
    expect(deriveActiveMachiningOperations(reenabled).operations[0].id)
      .toBe(source.plan.operations[0].id);
  });

  it('derives stable source-preserving sub-span geometry and joins active ranges across closure', () => {
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10 }
    ]);
    const segmentId = source.segments[0].id;
    const edited = setMachiningSpanParticipation(source, {
      sourceSegmentId: segmentId,
      range: { start: 0.25, end: 0.75 },
      participation: 'inactive-reference'
    })!;
    const first = deriveActiveMachiningOperations(edited);
    const second = deriveActiveMachiningOperations(structuredClone(edited));

    expect(first.status).toBe('ready');
    expect(first.operations).toHaveLength(1);
    expect(first.operations[0].segmentRefs).toHaveLength(2);
    expect(first.operations[0].startPoint.x).toBeCloseTo(0, 9);
    expect(first.operations[0].startPoint.y).toBeCloseTo(-10, 9);
    expect(first.operations[0].endPoint.x).toBeCloseTo(0, 9);
    expect(first.operations[0].endPoint.y).toBeCloseTo(10, 9);
    expect(first.operations[0].segmentRefs).toEqual(second.operations[0].segmentRefs);
    expect(first.segments.filter((segment) => segment.id.startsWith('mach_span_')))
      .toSatisfy((segments: typeof first.segments) =>
        segments.length === 2 && segments.every((segment) =>
          segment.source.sourceEntityIndex === source.segments[0].source.sourceEntityIndex
        )
      );
    expect(source.segments[0].kind).toBe('circle');
  });

  it('rejects overlapping participation decisions atomically', () => {
    const source = rectangleDocument();
    const segmentId = source.segments[0].id;
    const first = setMachiningSpanParticipation(source, {
      sourceSegmentId: segmentId,
      range: { start: 0.1, end: 0.6 },
      participation: 'inactive-reference'
    })!;

    expect(setMachiningSpanParticipation(first, {
      sourceSegmentId: segmentId,
      range: { start: 0.5, end: 0.8 },
      participation: 'inactive-reference'
    })).toBeNull();
  });

  it('treats an explicit active-cut range as redundant instead of opening a closed contour', () => {
    const source = rectangleDocument();
    source.machiningParticipation = {
      spans: [{
        id: 'legacy_active_range',
        sourceSegmentId: source.segments[0].id,
        range: { start: 0.2, end: 0.8 },
        participation: 'active-cut'
      }]
    };

    const derived = deriveActiveMachiningOperations(source);

    expect(derived.status).toBe('ready');
    expect(derived.operations).toHaveLength(1);
    expect(derived.operations[0]).toMatchObject({
      id: source.plan.operations[0].id,
      closed: true
    });
    expect(derived.operations[0]).not.toHaveProperty('machiningIntent');
  });

  it('applies an explicit manual controller side only to derived partial operations', () => {
    const source = rectangleDocument();
    const sourceOperation = source.plan.operations[0];
    const configured = setPartialContourCompensationSide(
      source,
      sourceOperation.id,
      'right'
    )!;
    const edited = setMachiningSpanParticipation(configured, {
      sourceSegmentId: source.segments[0].id,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    const derived = deriveActiveMachiningOperations(edited);

    expect(sourceOperation.compensationIntent).toBeUndefined();
    expect(derived.status).toBe('ready');
    expect(derived.operations[0].compensationIntent).toEqual({
      mode: 'controller',
      wireSide: 'right',
      source: 'manual'
    });
    expect(setPartialContourCompensationSide(configured, sourceOperation.id, null)
      ?.machiningParticipation?.partialContourCompensation).toEqual([]);
  });

  it('blocks multiple active groups until each derived operation can own explicit transitions', () => {
    const source = rectangleDocument();
    let edited = setMachiningSpanParticipation(source, {
      sourceSegmentId: source.plan.operations[0].segmentRefs[1].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    edited = setMachiningSpanParticipation(edited, {
      sourceSegmentId: source.plan.operations[0].segmentRefs[3].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;

    expect(deriveActiveMachiningOperations(edited)).toMatchObject({
      status: 'blocked',
      reason: 'multiple-active-groups-require-explicit-semantics',
      operations: []
    });
  });

  it('persists explicit review of a derived partial entry and invalidates it when spans change', () => {
    const source = rectangleDocument();
    const operation = source.plan.operations[0];
    operation.transitions = {
      entry: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: -2, y: -2 },
        to: operation.startPoint,
        review: 'reviewed'
      }
    };
    let edited = setMachiningSpanParticipation(source, {
      sourceSegmentId: operation.segmentRefs[0].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;

    expect(deriveActiveMachiningOperations(edited).operations[0].transitions?.entry)
      .toMatchObject({ review: 'required' });

    edited = setPartialContourEntryReview(edited, operation.id, true)!;
    expect(deriveActiveMachiningOperations(edited).operations[0].transitions?.entry)
      .toMatchObject({ review: 'reviewed' });

    edited = setMachiningSpanParticipation(edited, {
      sourceSegmentId: operation.segmentRefs[1].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    expect(edited.machiningParticipation?.partialContourEntryReviews).toEqual([]);
  });

  it('invalidates a reviewed partial entry when transformed geometry changes its fingerprint', () => {
    const source = rectangleDocument();
    const operation = source.plan.operations[0];
    operation.transitions = {
      entry: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: -2, y: -2 },
        to: operation.startPoint,
        review: 'reviewed'
      }
    };
    let edited = setMachiningSpanParticipation(source, {
      sourceSegmentId: operation.segmentRefs[0].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    edited = setPartialContourEntryReview(edited, operation.id, true)!;
    expect(deriveActiveMachiningOperations(edited).operations[0].transitions?.entry)
      .toMatchObject({ review: 'reviewed' });

    const translated = translatePathDocument(edited, { x: 5, y: 3 })!;

    expect(deriveActiveMachiningOperations(translated).operations[0].transitions?.entry)
      .toMatchObject({ review: 'required' });
  });
});

function rectangleDocument() {
  return createUpidFromDxfEntities([
    line(0, 0, 10, 0),
    line(10, 0, 10, 5),
    line(10, 5, 0, 5),
    line(0, 5, 0, 0)
  ]);
}

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
