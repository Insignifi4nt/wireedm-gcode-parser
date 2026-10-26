// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from '../cadSession';
import { prepareCadEdits } from '../cadEditPreparation';
import { CadSketchPreparationError } from '../cadSketchConstraintFeedback';
import { createCadSketchTestSolver } from './__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();

function freePair(shared = false, reverse = false) {
  return parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] },
    ...(shared ? [] : [{ id: 'c', position: [20, 2] }]), { id: 'd', position: [30, 3] }], entities: [
    { id: 'left', kind: 'line', construction: true, startPointId: reverse ? 'b' : 'a', endPointId: reverse ? 'a' : 'b' },
    { id: 'right', kind: 'line', construction: false, startPointId: reverse ? 'd' : shared ? 'b' : 'c', endPointId: reverse ? shared ? 'b' : 'c' : 'd' }
  ], relations: [{ id: 'support', kind: 'collinear', lineIds: reverse ? ['right', 'left'] : ['left', 'right'] }] });
}

describe('real PlaneGCS collinear support', () => {
  it('constrains two disjoint free lines by exactly two freedoms without choosing a master or rewriting source identities', async () => {
    const graph = freePair(), before = JSON.stringify(graph);
    const baseline = await runtime.solve({ graph: parseCadSketchGraph({ ...graph, relations: [] }), parameters: {} });
    expect(baseline).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 8 } });
    const result = await runtime.solve({ graph, parameters: {} });
    expect(result).toMatchObject({ kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom: 6, conflictingIds: [], redundantIds: [], issues: [] } });
    if (result.kind !== 'solved') throw new Error(JSON.stringify(result));
    expect(checkCadSketchGraph(result.graph, {})).toEqual([]);
    expect(result.graph.relations).toEqual(graph.relations); expect(result.graph.entities).toEqual(graph.entities);
    expect(result.graph.points.map(point => point.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('keeps reversed disjoint support and compiles only one independent condition for an actual shared endpoint', async () => {
    for (const shared of [false, true]) {
      const graph = freePair(shared, true), before = JSON.stringify(graph);
      const result = await runtime.solve({ graph, parameters: {} });
      expect(result).toMatchObject({ kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom: shared ? 5 : 6, redundantIds: [], issues: [] } });
      if (result.kind !== 'solved') throw new Error(JSON.stringify(result));
      expect(checkCadSketchGraph(result.graph, {})).toEqual([]); expect(result.graph.relations).toEqual(graph.relations);
      expect(JSON.stringify(graph)).toBe(before);
    }
  });

  it('carries exact driver edits and constrained drag without saving temporary targets or fixing survivor lengths', async () => {
    const graph = parseCadSketchGraph({ ...freePair(), points: [{ id: 'a', position: [' 0 ', ' lift '] }, { id: 'b', position: ['10', ' lift '] },
      { id: 'c', position: ['20', 1] }, { id: 'd', position: ['30', 2] }] }), before = JSON.stringify(graph);
    const first = await runtime.solve({ graph, parameters: { lift: 3 } });
    if (first.kind !== 'solved') throw new Error(JSON.stringify(first));
    expect(first.diagnostics.degreesOfFreedom).toBe(0);
    expect(first.graph.points.map(point => point.position)).toEqual([[' 0 ', ' lift '], ['10', ' lift '], ['20', 3], ['30', 3]]);
    const next = await runtime.solve({ graph: first.graph, parameters: { lift: 7 } });
    if (next.kind !== 'solved') throw new Error(JSON.stringify(next));
    expect(next.graph.points.map(point => point.position)).toEqual([[' 0 ', ' lift '], ['10', ' lift '], ['20', 7], ['30', 7]]);
    expect(next.graph.relations).toEqual(graph.relations);
    const freeEnds = parseCadSketchGraph({ ...next.graph, points: next.graph.points.map(point => point.id === 'c' ? { ...point, position: [20, 7] }
      : point.id === 'd' ? { ...point, position: [30, 7] } : point) });
    const dragged = await runtime.solve({ graph: freeEnds, parameters: { lift: 7 }, drag: { pointId: 'd', position: [40, 12] } });
    if (dragged.kind !== 'solved') throw new Error(JSON.stringify(dragged));
    expect(dragged.graph.points.find(point => point.id === 'd')?.position).toEqual([40, 7]);
    expect(dragged.diagnostics.degreesOfFreedom).toBe(2);
    expect(dragged.graph.relations).toEqual(graph.relations); expect(checkCadSketchGraph(dragged.graph, { lift: 7 })).toEqual([]);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('keeps redundancy IDs source-owned and rejects a fixed parallel offset atomically', async () => {
    const graph = freePair(), solved = await runtime.solve({ graph, parameters: {} });
    if (solved.kind !== 'solved') throw new Error(JSON.stringify(solved));
    const duplicate = await runtime.solve({ graph: parseCadSketchGraph({ ...solved.graph, relations: [...solved.graph.relations,
      { id: 'duplicate', kind: 'collinear', lineIds: ['right', 'left'] }] }), parameters: {} });
    expect(duplicate).toMatchObject({ kind: 'rejected', reason: 'redundant' });
    // The native solver sets aside the relation that repeats, here the newly attempted one;
    // PlaneGCS set aside the earlier one. Neither is relabelled.
    expect(duplicate.diagnostics.redundantIds).toEqual(['duplicate']);
    expect([...duplicate.diagnostics.redundantIds, ...duplicate.diagnostics.partiallyRedundantIds]).not.toContain('$collinear-on:duplicate');
    const fixed = parseCadSketchGraph({ ...graph, points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['10', '0'] },
      { id: 'c', position: ['20', ' offset '] }, { id: 'd', position: ['30', ' offset '] }], relations: [] });
    const compatibleGraph = parseCadSketchGraph({ ...fixed, relations: graph.relations });
    const compatible = await runtime.solve({ graph: compatibleGraph, parameters: { offset: 0 } });
    expect(compatible).toMatchObject({ kind: 'solved', graph: compatibleGraph, diagnostics: { status: 'success', degreesOfFreedom: 0, redundantIds: [], issues: [] } });
    const document = parseCadDocument({ ...createCadDocument('Accepted supports', 'supports'), schemaVersion: 2, parameters: { offset: 2 },
      features: [{ id: 'sketch', kind: 'sketch', name: 'Supports', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: fixed }] });
    const session = new CadSession(document), accepted = session.getSnapshot();
    const failure: unknown = await session.editPrepared(accepted.version, async part => (await prepareCadEdits(part, [
      { kind: 'rename-document', name: 'Rejected' }, { kind: 'set-parameter', name: 'offset', value: 3 },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: graph.relations[0] }
    ], runtime)).document).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected structured rejected support intent.');
    // With nothing free, the native solver names the unmet relation itself.
    expect(failure.diagnostics).toMatchObject({ status: 'failed', degreesOfFreedom: null, conflictingIds: ['support'], redundantIds: [], issues: [] });
    expect(failure.feedback.subjects).toMatchObject([{ source: { kind: 'relation', id: 'support' }, label: 'Collinear relation 1 · Line 1 and Line 2',
      pointIds: ['a', 'b', 'c', 'd'], entityIds: ['left', 'right'], category: 'conflicting' }]);
    expect(session.getSnapshot()).toBe(accepted);
  });
});
