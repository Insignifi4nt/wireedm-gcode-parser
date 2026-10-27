// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveRecord } from './cadSketchNativeFirstRuntime';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from '../cadSession';
import { prepareCadEdits } from '../cadEditPreparation';
import { CadSketchPreparationError } from '../cadSketchConstraintFeedback';
import { createCadSketchTestSolver } from './__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
function pair(kind: 'parallel' | 'perpendicular', shared = false, reverse = false) {
  const start = shared ? 'a' : 'c';
  return parseCadSketchGraph({ points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: ['10', '0'] },
    ...(shared ? [] : [{ id: 'c', position: ['2', '5'] }]), { id: 'd', position: shared ? [8, 15] : [10, 20] }], entities: [
    { id: 'reference', kind: 'line', construction: true, startPointId: reverse ? 'b' : 'a', endPointId: reverse ? 'a' : 'b' },
    { id: 'moving', kind: 'line', construction: false, startPointId: reverse ? 'd' : start, endPointId: reverse ? start : 'd' }
  ], relations: [{ id: 'length', kind: 'distance', pointIds: [start, 'd'], value: ' span ' },
    { id: 'direction', kind, lineIds: ['reference', 'moving'] }] });
}
function rotatedPair(kind: 'parallel' | 'perpendicular', sizeA: number, sizeB: number, origin: number) {
  const angle = Math.PI / 6, at = (base: readonly [number, number], length: number, angle: number) => [base[0] + length * Math.cos(angle), base[1] + length * Math.sin(angle)];
  const a: readonly [number, number] = [origin, origin], c: readonly [number, number] = [origin + sizeA / 5, origin + sizeB / 3];
  return parseCadSketchGraph({ points: [{ id: 'a', position: a.map(String) }, { id: 'b', position: at(a, sizeA, angle).map(String) },
    { id: 'c', position: c.map(String) }, { id: 'd', position: at(c, sizeB * .85, angle + (kind === 'parallel' ? 0 : Math.PI / 2) + .1) }],
    entities: [{ id: 'reference', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
      { id: 'moving', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
    relations: [{ id: 'length', kind: 'distance', pointIds: ['c', 'd'], value: ' span ' }, { id: 'direction', kind, lineIds: ['reference', 'moving'] }] });
}

describe('line pair relations', () => {
  it.each(['parallel', 'perpendicular'] as const)('solves %s lines with exact drivers and one independent angular degree of freedom', async kind => {
    const graph = pair(kind, kind === 'perpendicular', kind === 'parallel'), original = JSON.stringify(graph);
    const baseline = await runtime.solve({ graph: parseCadSketchGraph({ ...graph, relations: graph.relations.slice(0, 1) }), parameters: { span: 17 } });
    expect(baseline.kind).toBe('solved'); expect(baseline.diagnostics.degreesOfFreedom).toBe(1);
    const solved = await runtime.solve({ graph, parameters: { span: 17 } });
    expect(solved.kind).toBe('solved');
    if (solved.kind !== 'solved') throw new Error(solved.message);
    expect(solved.diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 0, issues: [] });
    expect(checkCadSketchGraph(solved.graph, { span: 17 })).toEqual([]);
    expect(solved.graph.points[0].position).toEqual([' 0 ', '0']);
    expect(solved.graph.relations).toEqual(graph.relations);
    const next = await runtime.solve({ graph: solved.graph, parameters: { span: 24 } });
    expect(next.kind).toBe('solved');
    if (next.kind !== 'solved') throw new Error(next.message);
    const endpoint = next.graph.points.find(point => point.id === 'd');
    expect(endpoint?.position).toEqual(kind === 'parallel' ? [26, 5] : [0, 24]);
    expect(next.graph.entities).toEqual(graph.entities);
    expect(JSON.stringify(graph)).toBe(original);
  });

  it.each(['parallel', 'perpendicular'] as const)('accepts independently valid %s solves for rotated tiny, large and translated lines', async kind => {
    for (const [sizeA, sizeB, origin] of [[1e-5, 2e-5, 0], [1e6, 2e6, 0], [10, 16, 1e6]]) {
      const graph = rotatedPair(kind, sizeA, sizeB, origin), before = JSON.stringify(graph);
      const result = await runtime.solve({ graph, parameters: { span: sizeB } });
      expect(result.kind).toBe('solved');
      if (result.kind !== 'solved') throw new Error(`${kind} ${sizeA}/${sizeB}@${origin}: ${JSON.stringify(result)}`);
      expect(checkCadSketchGraph(result.graph, { span: sizeB })).toEqual([]);
      expect(result.diagnostics.degreesOfFreedom).toBe(0);
      expect(result.graph.points.slice(0, 3)).toEqual(graph.points.slice(0, 3));
      expect(JSON.stringify(graph)).toBe(before);
    }
  });

  it.each(['parallel', 'perpendicular'] as const)('keeps uncertain disparate and far-origin tiny %s attempts rejected', async kind => {
    for (const [sizeA, sizeB, origin] of [[1e6, 1e-6, 0], [1e-6, 2e-6, 1e9 - 10]]) {
      const graph = rotatedPair(kind, sizeA, sizeB, origin), before = JSON.stringify(graph);
      const result = await runtime.solve({ graph, parameters: { span: sizeB } });
      // Native stalls on one and converges outside the graph checks' angular tolerance on the other.
      expect(result.kind).toBe('rejected');
      if (result.kind === 'rejected') expect(['failed', 'invalid-solution']).toContain(result.reason);
      expect(JSON.stringify(graph)).toBe(before);
    }
  });

  it.each(['parallel', 'perpendicular'] as const)('drags a free %s endpoint along its remaining line freedom without saving temporary targets', async kind => {
    const original = pair(kind, kind === 'perpendicular'), graph = parseCadSketchGraph({ ...original,
      relations: original.relations.filter(relation => relation.id !== 'length') });
    const result = await runtime.solve({ graph, parameters: {}, drag: { pointId: 'd', position: kind === 'parallel' ? [26, 13] : [7, 24] } });
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.points.find(point => point.id === 'd')?.position).toEqual(kind === 'parallel' ? [26, 5] : [0, 24]);
    expect(result.diagnostics.degreesOfFreedom).toBe(1);
    expect(result.graph.relations).toEqual(graph.relations);
    expect(checkCadSketchGraph(result.graph, {})).toEqual([]);
  });

  it.each(['parallel', 'perpendicular'] as const)('rejects opposite or duplicate %s relations with source IDs and no accepted document mutation', async kind => {
    const solved = await runtime.solve({ graph: pair(kind, kind === 'perpendicular'), parameters: { span: 17 } });
    if (solved.kind !== 'solved') throw new Error(solved.message);
    const duplicate = await runtime.solve({ graph: parseCadSketchGraph({ ...solved.graph, relations: [...solved.graph.relations,
      { id: 'duplicate', kind, lineIds: ['moving', 'reference'] }] }), parameters: { span: 17 } });
    expect(duplicate).toMatchObject({ kind: 'rejected', reason: 'redundant' });
    expect(duplicate.diagnostics.redundantIds).toContain('duplicate');
    const document = parseCadDocument({ ...createCadDocument('Accepted', 'part'), schemaVersion: 2, parameters: { span: 17 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Lines', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: solved.graph
    }] }), session = new CadSession(document), accepted = session.getSnapshot();
    const failure: unknown = await session.editPrepared(accepted.version, async source => (await prepareCadEdits(source, [
      { kind: 'rename-document', name: 'Unaccepted' }, { kind: 'set-parameter', name: 'span', value: 25 },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'opposite', kind: kind === 'parallel' ? 'perpendicular' : 'parallel', lineIds: ['reference', 'moving'] } }
    ], runtime)).document).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected a structured rejected edit.');
    expect(failure.code).toBe('sketch-conflicting'); expect(failure.diagnostics.conflictingIds).toContain('opposite');
    expect(failure.feedback.subjects).toContainEqual(expect.objectContaining({ source: { kind: 'relation', id: 'opposite' }, entityIds: ['reference', 'moving'] }));
    expect(session.getSnapshot()).toBe(accepted);
  });

  it('rejects zero native direction lengths when compiling, before the native solve', async () => {
    const records: CadSketchSolveRecord[] = [], guarded = createCadSketchTestSolver({ onSolve: record => records.push(record) });
    const original = pair('parallel'), graph = parseCadSketchGraph({ ...original,
      points: original.points.map(point => point.id === 'b' ? { ...point, position: [' 0 ', '0'] } : point) });
    const result = await guarded.solve({ graph, parameters: { span: 17 } });
    expect(result).toMatchObject({ kind: 'rejected', reason: 'invalid-input' }); expect(records).toEqual([expect.objectContaining({ native: 'compile' })]);
  });
});
