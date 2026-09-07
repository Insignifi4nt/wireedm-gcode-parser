import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { translatePathDocument } from '@/domain/path-editor/pathDocumentOperations';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { assertPortableUpidV1Shape } from '@/domain/upid/portableUpidV1Shape';
import { setManualCompensationIntent } from '@/domain/compensation/intent';

import {
  deriveActiveMachiningOperations,
  deriveSourceMachiningOperations,
  setPartialContourEntryReview,
  setPartialContourExitReview,
  setPartialContourCompensationSide,
  setMachiningSpanParticipation
} from '../machiningParticipation';

describe('machining participation', () => {
  it('includes retargeted leads in partial cutting totals and positions between actual transition endpoints', () => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
    ]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: -5, y: 0 }, review: 'reviewed' } };
    const [first, second] = document.plan.operations;
    first.transitions = {
      entry: { strategy: 'manual-straight', move: 'cut', from: { x: -2, y: 0 }, to: first.startPoint, review: 'reviewed' },
      exit: { strategy: 'manual-straight', move: 'cut', from: first.endPoint, to: { x: 12, y: 0 }, review: 'reviewed' }
    };
    second.transitions = {
      entry: { strategy: 'manual-straight', move: 'cut', from: { x: 18, y: 0 }, to: second.startPoint, review: 'reviewed' }
    };
    const partial = setMachiningSpanParticipation(document, {
      sourceSegmentId: first.segmentRefs[0].segmentId, range: { start: 0.6, end: 1 }, participation: 'inactive-reference'
    })!;
    const derived = deriveActiveMachiningOperations(partial);
    expect(derived.operations[0].metrics).toMatchObject({ cutLength: 14, rapidInLength: 3 });
    expect(derived.operations[1].metrics.rapidInLength).toBe(6);
    expect(document.plan.operations[0].endPoint).toEqual({ x: 10, y: 0 });
  });

  it('reviews one partial contour while another has unresolved disconnected cuts', () => {
    let document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
    ]);
    const [first, second] = document.plan.operations;
    first.transitions = {
      entry: { strategy: 'none', review: 'reviewed' },
      exit: { strategy: 'manual-straight', move: 'cut', from: first.endPoint, to: { x: 12, y: 0 }, review: 'reviewed' }
    };
    document = setMachiningSpanParticipation(document, {
      sourceSegmentId: first.segmentRefs[0].segmentId, range: { start: 0.6, end: 1 }, participation: 'inactive-reference'
    })!;
    document = setMachiningSpanParticipation(document, {
      sourceSegmentId: second.segmentRefs[0].segmentId, range: { start: 0.4, end: 0.6 }, participation: 'inactive-reference'
    })!;
    expect(deriveActiveMachiningOperations(document).status).toBe('blocked');
    document = setPartialContourEntryReview(document, first.id, true)!;
    document = setPartialContourExitReview(document, first.id, true)!;
    expect(deriveSourceMachiningOperations(document, first.id)?.operations[0].transitions).toMatchObject({
      entry: { review: 'reviewed' }, exit: { review: 'reviewed' }
    });
    expect(deriveActiveMachiningOperations(document).status).toBe('blocked');
  });

  it('confirms and persists a partial exit, revokes it, and invalidates changed geometry', () => {
    let source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    source.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    source = setManualCompensationIntent(source, source.plan.operations[0].id, 'centerline')!;
    const operation = source.plan.operations[0];
    operation.transitions = { exit: { strategy: 'manual-straight', move: 'cut',
      from: operation.endPoint, to: { x: 12, y: 0 }, review: 'reviewed' } };
    const partial = setMachiningSpanParticipation(source, {
      sourceSegmentId: operation.segmentRefs[0].segmentId, range: { start: 0.6, end: 1 }, participation: 'inactive-reference'
    })!;
    expect(compileWireEdmExecutionPlan(partial)).toMatchObject({ ok: false });
    const reviewed = setPartialContourExitReview(partial, operation.id, true)!;
    assertPortableUpidV1Shape(reviewed);
    const reopened = JSON.parse(JSON.stringify(reviewed)) as typeof reviewed;
    const result = compileWireEdmExecutionPlan(reopened);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.plan.events.filter((event) => event.kind === 'motion').at(-1)).toMatchObject({
      role: 'exit', start: { x: 6, y: 0 }, end: { x: 12, y: 0 }
    });
    const revoked = setPartialContourExitReview(reviewed, operation.id, false)!;
    expect(deriveActiveMachiningOperations(revoked).operations[0].transitions?.exit).toMatchObject({ review: 'required' });
    const translated = translatePathDocument(reviewed, { x: 2, y: 3 })!;
    expect(deriveActiveMachiningOperations(translated).operations[0].transitions?.exit).toMatchObject({ review: 'required' });
    const changed = setMachiningSpanParticipation(reviewed, {
      sourceSegmentId: operation.segmentRefs[0].segmentId, range: { start: 0, end: 0.2 }, participation: 'inactive-reference'
    })!;
    expect(changed.machiningParticipation?.partialContourExitReviews).toEqual([]);
    expect(partial.machiningParticipation?.partialContourExitReviews ?? []).toEqual([]);
  });

  it('derives imported operations and rapid metrics in authoritative execution order', () => {
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 3 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 3 }
    ]);
    const [first, second] = source.plan.operations;
    source.plan.operations = [second, first];

    const derived = deriveActiveMachiningOperations(source);

    expect(derived.status).toBe('ready');
    expect(derived.operations.map((operation) => operation.id)).toEqual([
      first.id,
      second.id
    ]);
    expect(source.plan.operations.map((operation) => operation.id)).toEqual([
      second.id,
      first.id
    ]);
  });

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

  it.each(['manual-straight', 'none'] as const)('persists explicit review of a %s partial entry and invalidates it when spans change', (strategy) => {
    const source = rectangleDocument();
    const operation = source.plan.operations[0];
    operation.transitions = {
      entry: strategy === 'none' ? { strategy: 'none', review: 'reviewed' } : {
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
