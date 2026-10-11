import { describe, expect, it } from 'vitest';
import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import {
  setClosedOperationStartNearPoint,
  setPathOperationClassification
} from '@/domain/path-editor/pathDocumentOperations';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { createUpidFromDxfEntities } from '../upidDocument';
import { parsePortableUpid } from '../portableUpidProject';
import { validateUpidDocument } from '../validateUpidDocument';

function nestedDocument() {
  return createUpidFromDxfEntities([2, 5, 10].map((radius) => ({
    type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius
  })));
}

function required(document: PathPlanningDocument | null): PathPlanningDocument {
  if (!document) throw new Error('Could not construct reviewed nested contour fixture.');
  return document;
}

function continuousIslandDocument() {
  let document = nestedDocument();
  document.geometryBasis = 'finished-contour';
  document = required(setClosedOperationStartNearPoint(document, document.plan.operations[0].id, { x: -2, y: 0 }));
  for (const operation of document.plan.operations) {
    document = required(setManualCompensationIntent(document, operation.id, 'centerline'));
  }
  document.setup = {
    initialWirePosition: { kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
  };
  document.plan.operations[1].threadingTransition = {
    mode: 'continuous', wireSeparation: 'already-separated', source: 'operation-override'
  };
  return document;
}

describe('UPID containment depth integrity', () => {
  it.each([1, 2, 3] as const)('round trips generated v%s depths that count all near-area source containers', (schemaVersion) => {
    const document = createUpidFromDxfEntities([0.00004, 0.000034, 0.000028, 0.000012].map((area) => ({
      type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: Math.sqrt(area / Math.PI)
    })));
    document.schemaVersion = schemaVersion;
    expect(document.diagnostics).toEqual([]);
    expect(document.contours.map((contour) => contour.containmentDepth)).toEqual([0, 0, 1, 3]);
    const before = structuredClone(document);
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
    const parsed = parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion, document }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(JSON.stringify(parsed.document)).toEqual(JSON.stringify(document));
    expect(document).toEqual(before);
  });

  it.each(['root', 'child', 'path-element'] as const)(
    'rejects a forged %s depth without changing the document', (kind) => {
      const document = nestedDocument();
      expect(validateUpidDocument(document).structurallyValid).toBe(true);
      const contour = document.contours.find((candidate) => kind === 'root'
        ? candidate.parentId === null
        : candidate.classification === 'hole');
      if (!contour) throw new Error('Expected nested contour.');
      const element = document.pathElements.find((candidate) => candidate.contourId === contour.id);
      if (!element) throw new Error('Expected paired path element.');
      if (kind !== 'path-element') contour.containmentDepth = 100;
      if (kind === 'path-element') element.containmentDepth = 100;
      const before = structuredClone(document);
      const report = validateUpidDocument(document);
      expect(report.structurallyValid).toBe(false);
      expect(report.structuralDiagnostics).toContainEqual(expect.objectContaining({
        code: 'upid-identity-mismatch', message: expect.stringContaining('containment depth')
      }));
      expect(document).toEqual(before);
      expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: 1, document })))
        .toMatchObject({ ok: false, error: { code: 'PORTABLE_UPID_DOCUMENT_INVALID' } });
    }
  );

  it.each([1, 2, 3] as const)('preserves valid v%s nesting with a manual contour role', (schemaVersion) => {
    let document = nestedDocument();
    const hole = document.plan.operations.find((operation) => operation.classification === 'hole');
    if (!hole) throw new Error('Expected hole operation.');
    document = required(setPathOperationClassification(document, hole.id, 'island'));
    document.schemaVersion = schemaVersion;
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
    expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion, document })))
      .toMatchObject({ ok: true });
  });

  it('blocks continuous travel through a nested island even when the hole depth is forged', () => {
    const document = continuousIslandDocument();
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false, diagnostics: [expect.objectContaining({
        code: 'EXECUTION_PLAN_THREADING_INVALID', message: expect.stringContaining('4.000 mm')
      })]
    });
    const hole = document.contours.find((contour) => contour.classification === 'hole');
    if (!hole) throw new Error('Expected hole contour.');
    hole.containmentDepth = 100;
    const before = structuredClone(document);
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false, diagnostics: [expect.objectContaining({ code: 'EXECUTION_PLAN_INVALID_UPID' })]
    });
    expect(document).toEqual(before);
  });

  it('checks source nesting when coupled contour trees, depths and areas are forged consistently', () => {
    const document = continuousIslandDocument();
    const island = document.contours.find((contour) => contour.classification === 'island');
    const hole = document.contours.find((contour) => contour.classification === 'hole');
    const exterior = document.contours.find((contour) => contour.classification === 'exterior');
    if (!island || !hole || !exterior) throw new Error('Expected nested island, hole and exterior.');
    island.parentId = exterior.id;
    island.containmentDepth = 1;
    island.childIds = [hole.id];
    island.area = 10_000;
    hole.parentId = island.id;
    hole.containmentDepth = 2;
    hole.childIds = [];
    hole.area = 1;
    exterior.childIds = [island.id];
    for (const contour of document.contours) {
      const element = document.pathElements.find((candidate) => candidate.contourId === contour.id);
      if (!element) throw new Error('Expected paired path element.');
      element.parentId = contour.parentId;
      element.childIds = [...contour.childIds];
      element.containmentDepth = contour.containmentDepth;
    }
    const before = structuredClone(document);
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false, diagnostics: [expect.objectContaining({
        code: 'EXECUTION_PLAN_THREADING_INVALID', message: expect.stringContaining('4.000 mm')
      })]
    });
    expect(document).toEqual(before);
  });

  it('blocks continuous island travel when paired depth caches agree on a forged value', () => {
    const document = continuousIslandDocument();
    const hole = document.contours.find((contour) => contour.classification === 'hole');
    const element = document.pathElements.find((candidate) => candidate.contourId === hole?.id);
    if (!hole || !element) throw new Error('Expected paired hole contour.');
    hole.containmentDepth = 100;
    element.containmentDepth = 100;
    const before = structuredClone(document);
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false, diagnostics: [expect.objectContaining({
        code: 'EXECUTION_PLAN_THREADING_INVALID', message: expect.stringContaining('4.000 mm')
      })]
    });
    expect(document).toEqual(before);
  });

  it.each(['active', 'inactive', 'partial'] as const)(
    'blocks continuous island travel with a %s near-area source ancestor', (participation) => {
    let document = createUpidFromDxfEntities([0.000034, 0.00004, 0.000028].map((area) => ({
      type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: Math.sqrt(area / Math.PI)
    })));
    const medium = document.plan.operations.find((operation) => operation.contourId === document.contours[0].id);
    const inner = document.plan.operations.find((operation) => operation.contourId === document.contours[2].id);
    if (!medium || !inner) throw new Error('Expected nested near-area contours.');
    document = required(setPathOperationClassification(document, medium.id, 'hole'));
    document = required(setPathOperationClassification(document, inner.id, 'island'));
    const radius = Math.sqrt(0.000028 / Math.PI);
    document = required(setClosedOperationStartNearPoint(document, inner.id, { x: -radius, y: 0 }));
    for (const operation of document.plan.operations) {
      document = required(setManualCompensationIntent(document, operation.id, 'centerline'));
    }
    document.setup = {
      initialWirePosition: { kind: 'manual', point: { x: -radius, y: 0 }, review: 'reviewed' },
      threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
    };
    document.plan.operations[1].threadingTransition = {
      mode: 'continuous', wireSeparation: 'already-separated', source: 'operation-override'
    };
    if (participation !== 'active') {
      const outerChain = document.chains.find((chain) => chain.id === document.contours[1].chainId);
      if (!outerChain) throw new Error('Expected outer source boundary.');
      document = required(setMachiningSpanParticipation(document, {
        sourceSegmentId: outerChain.segmentRefs[0].segmentId,
        range: { start: 0, end: participation === 'inactive' ? 1 : 0.5 },
        participation: 'inactive-reference'
      }));
    }
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false, diagnostics: [expect.objectContaining({
        code: 'EXECUTION_PLAN_THREADING_INVALID', message: expect.stringContaining('0.006 mm')
      })]
    });
  });

  it.each(['missing', 'null'] as const)('reports a %s split-segment source before inspecting manual-start provenance', (kind) => {
    const original = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 2 }
    ]);
    const document = required(setClosedOperationStartNearPoint(original, original.plan.operations[0].id, { x: -2, y: 0 }));
    if (kind === 'missing') Reflect.deleteProperty(document.segments[0], 'source');
    else Reflect.set(document.segments[0], 'source', null);
    const before = structuredClone(document);
    expect(() => validateUpidDocument(document)).not.toThrow();
    expect(validateUpidDocument(document).structurallyValid).toBe(false);
    expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: 1, document })))
      .toMatchObject({ ok: false, error: { code: kind === 'missing'
        ? 'PORTABLE_UPID_DOCUMENT_INVALID' : 'PORTABLE_UPID_SCHEMA_INVALID' } });
    expect(document).toEqual(before);
  });

  it.each(['chain', 'operation', 'path-element'] as const)(
    'returns diagnostics for a sparse %s traversal instead of throwing', (kind) => {
      const document = nestedDocument();
      const refs = kind === 'chain' ? document.chains[0].segmentRefs
        : kind === 'operation' ? document.plan.operations[0].segmentRefs
          : document.pathElements[0].segmentRefs;
      Reflect.deleteProperty(refs, '0');
      expect(() => validateUpidDocument(document)).not.toThrow();
      expect(validateUpidDocument(document).structurallyValid).toBe(false);
      expect(Object.hasOwn(refs, '0')).toBe(false);
    }
  );
});
