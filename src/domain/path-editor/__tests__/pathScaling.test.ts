import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { scalePathDocument, setPathOperationManualLeadIn, setManualInitialWirePosition, setClosedOperationStartNearPoint } from '../pathDocumentOperations';
import { pathGeometryBounds, previewPathScale } from '../pathScaling';

function drawing() {
  return createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 5, y: 3 }, radius: 10 },
    { type: 'circle', layer: 'CUT', center: { x: 5, y: 3 }, radius: 2 },
    { type: 'arc', layer: 'CUT', center: { x: 40, y: 3 }, radius: 3, startAngle: 0, endAngle: 90,
      start: { x: 43, y: 3 }, end: { x: 40, y: 6 }, clockwise: false }
  ]);
}

describe('uniform CAM scaling', () => {
  it('scales analytic curves, nesting and identities around an explicit origin without mutating originals', () => {
    const original = drawing(), before = structuredClone(original);
    const next = scalePathDocument(original, 2, { x: 5, y: 3 });
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.segments.map(segment => segment.id)).toEqual(original.segments.map(segment => segment.id));
    expect(next.segments.filter(segment => segment.kind !== 'line').map(segment => segment.radius)).toEqual([20, 4, 6]);
    expect(next.contours.map(({ id, parentId, containmentDepth }) => ({ id, parentId, containmentDepth })))
      .toEqual(original.contours.map(({ id, parentId, containmentDepth }) => ({ id, parentId, containmentDepth })));
    expect(validateUpidDocument(next).structuralDiagnostics).toEqual([]);
    expect(original).toEqual(before);
  });
  it('fits the longest side exactly and reports resulting bounds', () => {
    const doc = drawing();
    const preview = previewPathScale(doc, { kind: 'longest-side', lengthMm: 140 }, { x: 2, y: -4 });
    expect(preview).not.toBeNull();
    if (!preview) return;
    const next = scalePathDocument(doc, preview.factor, preview.origin);
    expect(next).not.toBeNull();
    if (next) expect(pathGeometryBounds(next)).toEqual(preview.bounds);
    expect(Math.max(preview.widthMm, preview.heightMm)).toBeCloseTo(140, 10);
  });
  it('retains fixed manual wire, transforms split starts and lead coordinates, and requires review', () => {
    const doc = createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10 }]);
    const id = doc.plan.operations[0].id;
    const start = setClosedOperationStartNearPoint(doc, id, { x: 0, y: 10 });
    const lead = start && setPathOperationManualLeadIn(start, id, { x: 0, y: 15 });
    const wire = lead && setManualInitialWirePosition(lead, { x: 0, y: 15 });
    expect(wire).not.toBeNull();
    if (!wire) return;
    const next = scalePathDocument(wire, 2, { x: 0, y: 0 });
    expect(next?.setup?.initialWirePosition).toMatchObject({ point: { x: 0, y: 15 }, review: 'required' });
    expect(next?.plan.operations[0].transitions?.entry).toMatchObject({ from: { x: 0, y: 30 }, review: 'required' });
    expect(next?.plan.operations[0].startPoint.y).toBeCloseTo(20);
    expect(next && validateUpidDocument(next).structuralDiagnostics).toEqual([]);
  });
  it('rejects nonpositive/nonfinite factors, range overflow and tolerance-induced joins atomically', () => {
    const doc = drawing(), before = structuredClone(doc);
    for (const factor of [0, -1, NaN, Infinity, 1e30]) expect(scalePathDocument(doc, factor, { x: 0, y: 0 })).toBeNull();
    const near = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 10.1, y: 0 }, end: { x: 20, y: 0 } }
    ]);
    expect(scalePathDocument(near, 0.001, { x: 0, y: 0 })).toBeNull();
    expect(doc).toEqual(before);
  });
  it('keeps stop millimeters and rejects shrinkage that would put a remaining-cut stop outside the contour', () => {
    const doc = drawing();
    doc.plan.operations[0].programStops = [{ id: 'retention', enabled: true, reason: 'part-retention',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 5 } }];
    expect(scalePathDocument(doc, 2, { x: 0, y: 0 })?.plan.operations[0].programStops).toEqual(doc.plan.operations[0].programStops);
    expect(scalePathDocument(doc, 0.01, { x: 0, y: 0 })).toBeNull();
  });
});
