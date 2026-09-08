import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '../upidDocument';
import { validateUpidDocument } from '../validateUpidDocument';
import { setCircleOperationCenterPierceLeadIn } from '@/domain/path-editor/pathDocumentOperations';
import type { PathPlanningDocument } from '@/domain/path-intel/types';

function circleDocument() {
  const source = createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }]);
  return setCircleOperationCenterPierceLeadIn(source, source.plan.operations[0].id)!;
}

describe('UPID semantic boundary audit', () => {
  it.each(['line', 'circle', 'arc'] as const)('rejects a forged %s length cache', (kind) => {
    const document = createUpidFromDxfEntities(kind === 'line'
      ? [{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]
      : kind === 'circle'
        ? [{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }]
        : [{ type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1,
          startAngle: 0, endAngle: 90, clockwise: false, start: { x: 1, y: 0 }, end: { x: 0, y: 1 } }]);
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
    document.segments[0].length += 1e-12;
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
    document.segments[0].length *= 10;
    expect(validateUpidDocument(document).structurallyValid).toBe(false);
  });

  it.each(['deep', 'cyclic'] as const)('reports %s diagnostic details without throwing', (kind) => {
    const document = circleDocument();
    const details: Record<string, unknown> = {};
    if (kind === 'cyclic') details.next = details;
    else {
      let current = details;
      for (let index = 0; index < 10_000; index++) {
        const next: Record<string, unknown> = {};
        current.next = next;
        current = next;
      }
    }
    document.diagnostics.push({ id: 'nested-warning', code: 'dxf-import-warning', severity: 'warning', message: 'Notice', details });
    document.plan.diagnostics.push({ id: 'nested-warning', code: 'dxf-import-warning', severity: 'warning', message: 'Notice', details: { ...details } });
    expect(validateUpidDocument(document).structurallyValid).toBe(false);
  });

  it.each([
    ['null machining intent', (document: PathPlanningDocument) => Reflect.set(document.plan.operations[0], 'machiningIntent', null)],
    ['null oriented reference', (document: PathPlanningDocument) => Reflect.set(document.plan.operations[0], 'segmentRefs', [null])],
    ['invalid referenced circle point', (document: PathPlanningDocument) => Reflect.set(document.segments[0], 'preferredStart', null)],
    ['empty path element', (document: PathPlanningDocument) => Reflect.set(document.pathElements, '0', {})]
  ] as const)('returns a structural report for %s without throwing', (_name, mutate) => {
    const document = circleDocument();
    mutate(document);
    expect(validateUpidDocument(document).structurallyValid).toBe(false);
  });

  it.each(['self', 'foreign'] as const)('rejects persisted derived attribution to a %s operation', (target) => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ]);
    document.plan.operations[0].machiningIntent = { kind: 'partial-contour',
      sourceOperationId: document.plan.operations[target === 'self' ? 0 : 1].id, spanIds: ['invented'] };
    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(expect.objectContaining({
      code: 'upid-invalid-value', message: expect.stringContaining('Persist source geometry and machiningParticipation')
    }));
  });

  it('accepts matching diagnostic payloads regardless of object key insertion order', () => {
    const document = circleDocument();
    document.diagnostics.push({ id: 'source-warning', code: 'dxf-import-warning', severity: 'warning',
      message: 'Source notice', details: { sourceIndex: 1, layer: 'CUT' } });
    document.plan.diagnostics.push({ details: { layer: 'CUT', sourceIndex: 1 }, message: 'Source notice',
      severity: 'warning', code: 'dxf-import-warning', id: 'source-warning' });
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
  });

  it('rejects internally repeated unit metadata that assigns inch scale to DXF millimeters', () => {
    const document = circleDocument();
    const units = { source: 'dxf-insunits' as const, code: 4, label: 'inches', scaleToMillimeters: 25.4 };
    document.source.units = units;
    document.source.unitDeclaration = { status: 'recognized', units: { ...units } };
    document.source.coordinateScaleToMillimeters = 25.4;
    document.source.appliedUnits = { label: 'inches', scaleToMillimeters: 25.4, basis: 'dxf-declared', confirmed: true };
    expect(validateUpidDocument(document).structurallyValid).toBe(false);
  });

  it.each(['severity', 'message', 'details'] as const)('rejects a same-ID plan diagnostic with forged %s', (field) => {
    const document = circleDocument();
    const diagnostic = { id: 'source-warning', code: 'dxf-import-warning' as const, severity: 'warning' as const,
      message: 'Source was approximated', details: { sourceIndex: 1 } };
    document.diagnostics.push(diagnostic);
    const planDiagnostic = structuredClone(diagnostic);
    Reflect.set(planDiagnostic, field, field === 'severity' ? 'info' : field === 'message' ? 'Everything is exact' : { sourceIndex: Infinity });
    document.plan.diagnostics.push(planDiagnostic);
    expect(validateUpidDocument(document).structurallyValid).toBe(false);
  });

  it.each([
    ['wrong decision kind', { kind: 'automatic', orderIndex: 0 }],
    ['stale manual order', { kind: 'manual', orderIndex: 4 }]
  ])('rejects an order override with %s', (_name, order) => {
    const document = circleDocument();
    Reflect.set(document.plan.operations[0], 'overrides', { order });
    Reflect.set(document.pathElements[0], 'overrides', { order });
    expect(validateUpidDocument(document).structurallyValid).toBe(false);
  });
});
