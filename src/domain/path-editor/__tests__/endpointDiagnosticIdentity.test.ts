import { describe, expect, it } from 'vitest';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import type { PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { reversePathOperation, setClosedOperationStartNearPoint } from '../pathDocumentOperations';

function line(x: number, y: number, u: number, v: number) {
  return { type: 'line' as const, layer: 'CUT', start: { x, y }, end: { x: u, y: v } };
}

function square() {
  return createPathPlanningDocumentFromDxfEntities([
    line(0, 0, 10, 0), line(10, 0, 10, 10), line(10.002, 10.002, 0, 10), line(0, 10, 0, 0)
  ], { endpointTolerance: 0.01 });
}

function renameDiagnostic(document: PathPlanningDocument, code: PathDiagnostic['code'], id: string) {
  const diagnostic = document.diagnostics.find((candidate) => candidate.code === code)!;
  const previousId = diagnostic.id;
  diagnostic.id = id;
  for (const owner of [...document.chains, ...document.contours, ...document.pathElements]) {
    owner.diagnosticIds = owner.diagnosticIds.map((value) => value === previousId ? id : value);
  }
}

function expectValid(document: PathPlanningDocument) {
  expect(validateUpidDocument(document).structuralDiagnostics).toEqual([]);
  for (const diagnostic of document.diagnostics) {
    for (const id of diagnostic.relatedSegmentIds ?? []) expect(document.segments.some((segment) => segment.id === id)).toBe(true);
    for (const id of diagnostic.relatedClusterIds ?? []) expect(document.endpointClusters.some((cluster) => cluster.id === id)).toBe(true);
  }
}

describe('endpoint diagnostic identity', () => {
  it.each(['saved_gap_warning', 'diag_cluster_saved_gap', 'diag_contour_saved_gap', 'diag_intersection_saved_gap'])('refreshes chain diagnostics saved as %s', (id) => {
    const document = square();
    renameDiagnostic(document, 'closed-chain-gap', id);
    renameDiagnostic(document, 'endpoint-cluster-snap', 'saved_snap_warning');
    expectValid(document);
    const result = setClosedOperationStartNearPoint(document, document.plan.operations[0].id, { x: 5, y: 0 })!;
    expectValid(result);
    expect(result.diagnostics.filter(({ code }) => code === 'endpoint-cluster-snap')).toHaveLength(1);
    expect(result.diagnostics.find((diagnostic) => diagnostic.id === id)).toMatchObject({
      relatedSegmentIds: result.chains[0].segmentRefs.map(({ segmentId }) => segmentId),
      relatedClusterIds: [result.chains[0].startClusterId]
    });
  });

  it('preserves unrelated saved diagnostics regardless of their id prefix', () => {
    const document = square();
    const warnings = ['diag_cluster_source_warning', 'diag_contour_source_warning', 'diag_intersection_source_warning'].map((id): PathDiagnostic => ({
      id, code: 'dxf-import-warning', severity: 'warning', message: 'Saved source warning'
    }));
    document.diagnostics.push(...warnings);
    const result = reversePathOperation(document, document.plan.operations[0].id)!;
    expectValid(result);
    for (const warning of warnings) expect(result.diagnostics.find(({ id }) => id === warning.id)).toEqual(warning);
  });

  it('reserves saved endpoint diagnostic ids when contour analysis creates more diagnostics', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 10), line(10.002, 10, 10, 0), line(10, 0, 0, 10), line(0, 10, 0, 0)
    ], { endpointTolerance: 0.01 });
    renameDiagnostic(document, 'endpoint-cluster-snap', 'diag_intersection_0002');
    document.chains[0].diagnosticIds.push('diag_intersection_0002');
    expectValid(document);
    const result = setClosedOperationStartNearPoint(document, document.plan.operations[0].id, { x: 5, y: 5 })!;
    expectValid(result);
    expect(result.diagnostics.find(({ id }) => id === 'diag_intersection_0002')).toMatchObject({ code: 'endpoint-cluster-snap' });
    expect(result.diagnostics.filter(({ code }) => code === 'intersecting-topology')).toHaveLength(2);
  });

  it('preserves a branching diagnostic whose saved id looks like a clustering diagnostic', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0),
      line(0, 0, -10, 0), line(-10, 0, -10, -10), line(-10, -10, 0, -10), line(0, -10, 0, 0)
    ]);
    renameDiagnostic(document, 'branching-topology', 'diag_cluster_saved_branch');
    const result = reversePathOperation(document, document.plan.operations[0].id)!;
    expectValid(result);
    expect(result.diagnostics.find(({ id }) => id === 'diag_cluster_saved_branch')).toMatchObject({ code: 'branching-topology' });
  });

  it('rebuilds branching diagnostics when surviving endpoints disagree on the successor', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0),
      line(0.000005, 0, -10, 0), line(-10, 0, -10, -10), line(-10, -10, 0, -10), line(0, -10, 0.000005, 0)
    ], { endpointTolerance: 0.01 });
    const operation = document.plan.operations.find(({ segmentRefs }) => segmentRefs.some(({ segmentId }) => segmentId === 'seg_0001'))!;
    const reversed = reversePathOperation(document, operation.id)!;
    const previousBranch = reversed.diagnostics.find(({ code }) => code === 'branching-topology')!;
    for (const owner of [...reversed.chains, ...reversed.contours, ...reversed.pathElements]) owner.diagnosticIds.push(previousBranch.id);
    reversed.plan.diagnostics.push(structuredClone(previousBranch));
    expectValid(reversed);
    const result = setClosedOperationStartNearPoint(reversed, operation.id, { x: 0.000011, y: 0 })!;
    expectValid(result);
    expect(result.diagnostics.some(({ id }) => id === previousBranch.id)).toBe(false);
    expect(result.plan.diagnostics.some(({ id }) => id === previousBranch.id)).toBe(false);
    for (const owner of [...result.chains, ...result.contours, ...result.pathElements]) expect(owner.diagnosticIds).not.toContain(previousBranch.id);
    const junctions = result.endpointClusters.filter(({ members }) => members.length > 2);
    expect(junctions).toHaveLength(1);
    const branches = result.diagnostics.filter(({ code }) => code === 'branching-topology');
    expect(branches.length).toBeGreaterThan(0);
    for (const diagnostic of branches) {
      expect(diagnostic.relatedClusterIds).toEqual([junctions[0].id]);
      expect(diagnostic.message).toContain(`cluster ${junctions[0].id}`);
      expect(diagnostic.relatedSegmentIds?.every((id) => junctions[0].members.some(({ segmentId }) => segmentId === id))).toBe(true);
      if (diagnostic.details?.degree !== undefined) expect(diagnostic.details.degree).toBe(junctions[0].members.length);
      if (diagnostic.details?.chosenSegmentId !== undefined) expect(diagnostic.relatedSegmentIds).toContain(diagnostic.details.chosenSegmentId);
    }
  });

  it('refreshes a saved open-chain diagnostic and its plan copy through repeated reversals', () => {
    const document = createPathPlanningDocumentFromDxfEntities([line(0, 0, 10, 0), line(10, 0, 20, 0)]);
    renameDiagnostic(document, 'open-chain', 'saved_open_warning');
    const warning = document.diagnostics.find(({ id }) => id === 'saved_open_warning')!;
    document.plan.diagnostics.push(structuredClone(warning));
    const before = structuredClone(document);
    const result = reversePathOperation(document, document.plan.operations[0].id)!;
    expectValid(result);
    const refreshed = result.diagnostics.find(({ id }) => id === warning.id)!;
    expect(refreshed.relatedClusterIds).toEqual([result.chains[0].startClusterId, result.chains[0].endClusterId]);
    expect(result.plan.diagnostics).toEqual([refreshed]);
    const restored = reversePathOperation(result, result.plan.operations[0].id)!;
    expectValid(restored);
    expect(restored.diagnostics).toEqual(document.diagnostics);
    expect(document).toEqual(before);
  });

  it.each(['chain', 'contour', 'path element'] as const)('keeps a warning referenced by a %s on the same joint when an earlier warning is inserted', (owner) => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0.008, 0),
      line(30, 0, 40, 0), line(40, 0, 40, 10), line(40.002, 10.002, 30, 10), line(30, 10, 30, 0)
    ], { endpointTolerance: 0.01 });
    const warning = document.diagnostics.find(({ code, relatedSegmentIds }) => code === 'endpoint-cluster-snap' && relatedSegmentIds?.includes('seg_0006'))!;
    const chain = document.chains.find(({ segmentRefs }) => segmentRefs.some(({ segmentId }) => segmentId === 'seg_0006'))!;
    const contour = document.contours.find(({ chainId }) => chainId === chain.id)!;
    const element = document.pathElements.find(({ contourId }) => contourId === contour.id)!;
    const referenceOwner = owner === 'chain' ? chain : owner === 'contour' ? contour : element;
    referenceOwner.diagnosticIds.push(warning.id);
    document.plan.diagnostics.push(structuredClone(warning));
    expectValid(document);
    const first = document.plan.operations.find(({ segmentRefs }) => segmentRefs.some(({ segmentId }) => segmentId === 'seg_0001'))!;
    const result = setClosedOperationStartNearPoint(document, first.id, { x: 0.005, y: 0 })!;
    expectValid(result);
    const retained = result.diagnostics.find(({ id }) => id === warning.id)!;
    expect(retained.relatedSegmentIds).toEqual(warning.relatedSegmentIds);
    const resultOwners = owner === 'chain' ? result.chains : owner === 'contour' ? result.contours : result.pathElements;
    expect(resultOwners.find(({ id }) => id === referenceOwner.id)?.diagnosticIds).toContain(retained.id);
    expect(result.plan.diagnostics.find(({ id }) => id === warning.id)).toEqual(retained);
  });

  it('removes references to a resolved warning without reusing its id for another joint', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0.008, 0)
    ], { endpointTolerance: 0.01 });
    const warning = document.diagnostics.find(({ code }) => code === 'endpoint-cluster-snap')!;
    for (const owner of [...document.chains, ...document.contours, ...document.pathElements]) owner.diagnosticIds.push(warning.id);
    document.plan.diagnostics.push(structuredClone(warning));
    expectValid(document);
    const result = setClosedOperationStartNearPoint(document, document.plan.operations[0].id, { x: 0.005, y: 0 })!;
    expectValid(result);
    expect(result.diagnostics.some(({ id }) => id === warning.id)).toBe(false);
    expect(result.plan.diagnostics.some(({ id }) => id === warning.id)).toBe(false);
    for (const owner of [...result.chains, ...result.contours, ...result.pathElements]) expect(owner.diagnosticIds).not.toContain(warning.id);
  });
});
