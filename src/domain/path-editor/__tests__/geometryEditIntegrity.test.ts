import { describe, expect, it } from 'vitest';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { normalizeUpidPathElementSelection } from '@/domain/upid/projectRail';
import { deriveSpanSegment, setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { inferPathPoint } from '../pathPointInference';
import { mirrorPathDocument, reversePathOperation, rotatePathDocument, setClosedOperationStartAtInferredPoint, translatePathDocument, translatePathSegment } from '../pathDocumentOperations';

function rectangle() {
  return createPathPlanningDocumentFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
  ]);
}

describe('geometry edit identity integrity', () => {
  it('does not restore a reversed contour onto a new disconnected chain', () => {
    const original = rectangle();
    const reversed = reversePathOperation(original, original.plan.operations[0].id);
    if (!reversed) throw new Error('Invalid fixture');
    const before = structuredClone(reversed);
    const result = translatePathSegment(reversed, original.segments[0].id, { x: 50, y: 0 });
    expect(result).toBeNull();
    expect(reversed).toEqual(before);
  });

  it('allows unreviewed topology edits while preserving a different authored contour and its stable identities', () => {
    const first = rectangle();
    const document = createPathPlanningDocumentFromDxfEntities(first.segments.flatMap((segment) => [
      { type: 'line' as const, layer: 'CUT', start: segment.start, end: segment.end },
      { type: 'line' as const, layer: 'CUT', start: { x: segment.start.x + 30, y: segment.start.y }, end: { x: segment.end.x + 30, y: segment.end.y } }
    ]));
    const secondSegmentIds = new Set(document.segments.filter((segment) => segment.start.x >= 30 && segment.end.x >= 30).map((segment) => segment.id));
    const secondOperation = document.plan.operations.find((operation) => operation.segmentRefs.every((ref) => secondSegmentIds.has(ref.segmentId)));
    if (!secondOperation) throw new Error('Missing second contour');
    const reviewed = reversePathOperation(document, secondOperation.id);
    if (!reviewed) throw new Error('Invalid fixture');
    const before = structuredClone(reviewed);
    const originalElement = reviewed.pathElements.find((element) => element.operationId === secondOperation.id);
    const result = translatePathSegment(reviewed, document.segments[0].id, { x: -50, y: 0 });
    if (!result) throw new Error('Unreviewed topology edit was refused');
    const retained = result.plan.operations.find((operation) => operation.id === secondOperation.id);
    expect(retained).toMatchObject({ contourId: secondOperation.contourId, chainId: secondOperation.chainId,
      segmentRefs: reviewed.plan.operations.find((operation) => operation.id === secondOperation.id)?.segmentRefs });
    expect(result.pathElements.find((element) => element.operationId === secondOperation.id)?.id).toBe(originalElement?.id);
    const refs = result.plan.operations.flatMap((operation) => operation.segmentRefs.map((ref) => ref.segmentId));
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toHaveLength(document.segments.length);
    expect(new Set(result.plan.operations.map((operation) => operation.id)).size).toBe(result.plan.operations.length);
    expect(validateUpidDocument(result).structuralDiagnostics).toEqual([]);
    const retired = document.plan.operations.find((operation) => operation.id !== secondOperation.id);
    const owner = result.plan.operations.find((operation) => operation.segmentRefs.some((ref) => ref.segmentId === document.segments[0].id));
    if (!retired || !owner) throw new Error('Missing edited ownership');
    expect(normalizeUpidPathElementSelection(result, retired.id, {
      operationId: retired.id, segmentId: document.segments[0].id
    })).toMatchObject({ operationId: owner.id, segmentId: document.segments[0].id });
    expect(reviewed).toEqual(before);
  });

  it('allows an unreviewed join with fresh identity and one ownership per source edge', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
    ]);
    const result = translatePathSegment(document, document.segments[1].id, { x: -10, y: 0 });
    expect(result?.plan.operations).toHaveLength(1);
    expect(result?.plan.operations[0].segmentRefs).toHaveLength(2);
    expect(document.plan.operations.map((operation) => operation.id)).not.toContain(result?.plan.operations[0].id);
    if (result) expect(validateUpidDocument(result).structuralDiagnostics).toEqual([]);
  });

  it('rejects non-finite transform input without changing the source document', () => {
    const document = rectangle(), before = structuredClone(document);
    expect(translatePathSegment(document, document.segments[0].id, { x: Infinity, y: 0 })).toBeNull();
    expect(rotatePathDocument(document, NaN, { x: 0, y: 0 })).toBeNull();
    expect(document).toEqual(before);
  });

  it('reflects the physical excluded range of a circle while preserving its source and span IDs', () => {
    const document = createPathPlanningDocumentFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }]);
    const source = document.segments[0];
    const partial = setMachiningSpanParticipation(document, { sourceSegmentId: source.id, range: { start: 0, end: 0.25 }, participation: 'inactive-reference' });
    if (!partial) throw new Error('Invalid fixture');
    const before = structuredClone(partial);
    const mirrored = mirrorPathDocument(partial, 'x', { x: 0, y: 0 });
    const span = mirrored?.machiningParticipation?.spans.find((candidate) => candidate.participation === 'inactive-reference');
    expect(span).toMatchObject({ id: partial.machiningParticipation?.spans[0].id, sourceSegmentId: source.id, range: { start: 0.75, end: 1 } });
    if (!mirrored || !span) throw new Error('Mirror failed');
    const excluded = deriveSpanSegment(mirrored.segments[0], span);
    expect(excluded.start.y).toBeCloseTo(-5, 10);
    expect(excluded.end.x).toBeCloseTo(5, 10);
    expect(excluded.end.y).toBeCloseTo(0, 10);
    expect(mirrorPathDocument(mirrored, 'x', { x: 0, y: 0 })?.machiningParticipation?.spans).toEqual(partial.machiningParticipation?.spans);
    expect(partial).toEqual(before);
  });

  it('rejects stale inferred starts rather than bending the source edge to an old point', () => {
    const document = rectangle();
    const inferred = inferPathPoint(document, { hintPoint: { x: 5, y: 0 }, mode: 'nearest', operationId: document.plan.operations[0].id });
    const moved = translatePathDocument(document, { x: 0, y: 20 });
    if (!inferred || !moved) throw new Error('Invalid fixture');
    expect(setClosedOperationStartAtInferredPoint(moved, inferred)).toBeNull();
    expect(setClosedOperationStartAtInferredPoint(document, { ...inferred, t: 0.9 })).toBeNull();
    expect(setClosedOperationStartAtInferredPoint(document, inferred)).not.toBeNull();
  });
});
