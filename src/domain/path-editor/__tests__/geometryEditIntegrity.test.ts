import { describe, expect, it } from 'vitest';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { normalizeUpidPathElementSelection } from '@/domain/upid/projectRail';
import { deriveSpanSegment, setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { inferPathPoint } from '../pathPointInference';
import { mirrorPathDocument, reversePathOperation, rotatePathDocument, setClosedOperationStartAtInferredPoint, setClosedOperationStartNearPoint, translatePathDocument, translatePathSegment } from '../pathDocumentOperations';

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

  it('keeps a saved drawing with ambiguous endpoint joins structurally valid after an unrelated edit', () => {
    const line = (startX: number, endX: number, y: number) =>
      ({ type: 'line' as const, layer: 'CUT', start: { x: startX, y }, end: { x: endX, y } });
    const saved = JSON.parse(JSON.stringify(createPathPlanningDocumentFromDxfEntities(
      [line(0, 10, 0), line(10.009, 20, 0), line(10.018, 30, 0), line(0, 10, 5)],
      { endpointTolerance: 0.01 }
    )));
    expect(saved.diagnostics.some(({ code }: { code: string }) => code === 'ambiguous-endpoint-cluster')).toBe(true);

    const edited = translatePathSegment(saved, saved.segments.at(-1).id, { x: 0, y: 1 });

    expect(edited).not.toBeNull();
    expect(validateUpidDocument(edited!).structuralDiagnostics).toEqual([]);
  });

  it('records every intersection a split start creates on a self-crossing contour', () => {
    const bowtie = createPathPlanningDocumentFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 0, y: 10 } },
      { type: 'line', layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
    ]);

    const edited = setClosedOperationStartNearPoint(bowtie, bowtie.plan.operations[0].id, { x: 5, y: 5 });

    expect(edited).not.toBeNull();
    const diagnosticIds = new Set(edited!.diagnostics.map(({ id }) => id));
    expect(edited!.contours[0].diagnosticIds.filter((id) => !diagnosticIds.has(id))).toEqual([]);
    expect(edited!.diagnostics.filter(({ code }) => code === 'intersecting-topology')).toHaveLength(2);
    expect(validateUpidDocument(edited!).structuralDiagnostics).toEqual([]);
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

  it('reserves untouched portable span IDs when a manual circle start splits participation', () => {
    let document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ]);
    const [firstSource, secondSource] = document.segments;
    const firstPartial = setMachiningSpanParticipation(document, {
      sourceSegmentId: firstSource.id, range: { start: 0, end: 0.25 }, participation: 'inactive-reference'
    });
    if (!firstPartial) throw new Error('Invalid first participation fixture');
    const secondPartial = setMachiningSpanParticipation(firstPartial, {
      sourceSegmentId: secondSource.id, range: { start: 0, end: 0.25 }, participation: 'inactive-reference'
    });
    if (!secondPartial?.machiningParticipation) throw new Error('Invalid second participation fixture');
    document = secondPartial;
    const firstSpan = secondPartial.machiningParticipation.spans[0];
    const secondSpan = secondPartial.machiningParticipation.spans[1];
    const firstOperation = document.plan.operations.find((operation) =>
      operation.segmentRefs.some((ref) => ref.segmentId === firstSource.id));
    if (!firstOperation) throw new Error('Missing first circle operation');
    const ordinary = setClosedOperationStartNearPoint(document, firstOperation.id, { x: 0, y: 5 });
    const ordinarySpan = ordinary?.machiningParticipation?.spans.find((span) =>
      span.sourceSegmentId !== secondSource.id);
    if (!ordinarySpan) throw new Error('Missing split participation fixture');
    expect(ordinarySpan.id).toBe(`${firstSpan.id}__seg_edit_0002_1`);

    secondSpan.id = ordinarySpan.id;
    const before = structuredClone(document);
    expect(validateUpidDocument(document).structuralDiagnostics).toEqual([]);
    const result = setClosedOperationStartNearPoint(document, firstOperation.id, { x: 0, y: 5 });
    if (!result?.machiningParticipation) throw new Error('Manual start split failed');
    expect(validateUpidDocument(result).structuralDiagnostics).toEqual([]);
    expect(result.machiningParticipation.spans.find((span) => span.sourceSegmentId === secondSource.id)).toEqual(secondSpan);
    expect(result.machiningParticipation.spans.find((span) => span.sourceSegmentId !== secondSource.id))
      .toMatchObject({ id: `${ordinarySpan.id}__2`, range: ordinarySpan.range });
    expect(result).toEqual(setClosedOperationStartNearPoint(document, firstOperation.id, { x: 0, y: 5 }));
    expect(document).toEqual(before);
  });
});
