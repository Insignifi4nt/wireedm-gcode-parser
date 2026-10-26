// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from '../cadSession';
import { prepareCadEdits } from '../cadEditPreparation';
import { CadSketchPreparationError } from '../cadSketchConstraintFeedback';
import { createCadSketchTestSolver } from './__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
function corner(degrees: number, sense: 'cw' | 'ccw' = 'ccw') {
  return parseCadSketchGraph({ points: [{ id: 'v', position: [' 0 ', '0'] }, { id: 'a', position: ['10', '0'] },
    { id: 'b', position: degrees > 90 ? [-3, 12] : [9, sense === 'cw' ? -14 : 14] }], entities: [
    { id: 'reference', kind: 'line', construction: true, startPointId: 'a', endPointId: 'v' },
    { id: 'moving', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }], relations: [
    { id: 'length', kind: 'distance', pointIds: ['v', 'b'], value: 10 },
    { id: 'angle', kind: 'line-angle', rays: [{ lineId: 'reference', towardPointId: 'a' }, { lineId: 'moving', towardPointId: 'b' }], sense, value: degrees }
  ] });
}

describe('real PlaneGCS explicit line angles', () => {
  it.each([[30, 'ccw'], [120, 'ccw'], [30, 'cw']] as const)('solves the visible %s-degree %s ray sector with exact source drivers', async (degrees, sense) => {
    const graph = corner(degrees, sense), before = JSON.stringify(graph), solved = await runtime.solve({ graph, parameters: {} });
    expect(solved.kind).toBe('solved'); if (solved.kind !== 'solved') throw new Error(JSON.stringify(solved));
    expect(checkCadSketchGraph(solved.graph, {})).toEqual([]);
    expect(solved.diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 0 });
    expect(solved.graph.points.slice(0, 2)).toEqual(graph.points.slice(0, 2));
    expect(solved.graph.relations).toEqual(graph.relations); expect(JSON.stringify(graph)).toBe(before);
  });

  it('updates an exact degree expression through preparation and rejects an incompatible complete session batch atomically', async () => {
    const original = corner(30), graph = parseCadSketchGraph({ ...original,
      relations: original.relations.map(relation => relation.kind === 'line-angle' ? { ...relation, value: ' taper + 5 ' } : relation) });
    const solved = await runtime.solve({ graph, parameters: { taper: 25 } });
    expect(solved.kind).toBe('solved'); if (solved.kind !== 'solved') throw new Error(JSON.stringify(solved));
    const document = parseCadDocument({ ...createCadDocument('Angle', 'angle'), schemaVersion: 2, parameters: { taper: 25 }, features: [{
      id: 'sketch', name: 'Corner', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: solved.graph }] });
    const session = new CadSession(document), first = session.getSnapshot();
    await session.editPrepared(first.version, async source => (await prepareCadEdits(source, [{ kind: 'set-parameter', name: 'taper', value: 55 }], runtime)).document);
    const accepted = session.getSnapshot(), sketch = accepted.document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected graph.');
    expect(sketch.graph.relations).toEqual(graph.relations); expect(checkCadSketchGraph(sketch.graph, { taper: 55 })).toEqual([]);
    expect(sketch.graph.points.find(point => point.id === 'b')?.position[0]).toBeCloseTo(5, 10);
    const failure: unknown = await session.editPrepared(accepted.version, async source => (await prepareCadEdits(source, [
      { kind: 'rename-document', name: 'Unaccepted' }, { kind: 'set-parameter', name: 'taper', value: 65 },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'opposite', kind: 'perpendicular', lineIds: ['reference', 'moving'] } }
    ], runtime)).document).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CadSketchPreparationError); expect(session.getSnapshot()).toBe(accepted);
  });

  it('removes exactly one freedom from two free disjoint lines without fixing either source line', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] },
      { id: 'c', position: [20, 15] }, { id: 'd', position: [27, 22] }], entities: [
      { id: 'first', kind: 'line', construction: false, startPointId: 'b', endPointId: 'a' },
      { id: 'second', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' }], relations: [
      { id: 'length-a', kind: 'distance', pointIds: ['a', 'b'], value: 10 }, { id: 'length-b', kind: 'distance', pointIds: ['c', 'd'], value: 10 },
      { id: 'angle', kind: 'line-angle', rays: [{ lineId: 'first', towardPointId: 'b' }, { lineId: 'second', towardPointId: 'd' }], sense: 'ccw', value: 60 }] });
    const baseline = await runtime.solve({ graph: parseCadSketchGraph({ ...graph, relations: graph.relations.slice(0, 2) }), parameters: {} });
    const solved = await runtime.solve({ graph, parameters: {} });
    expect(baseline).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 6 } });
    expect(solved).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 5 } });
    if (solved.kind !== 'solved') throw new Error(JSON.stringify(solved));
    expect(checkCadSketchGraph(solved.graph, {})).toEqual([]); expect(solved.graph.relations).toEqual(graph.relations);
  });

  it('keeps an angle while a free endpoint moves, without persisting temporary targets', async () => {
    const source = corner(30), graph = parseCadSketchGraph({ ...source, relations: source.relations.filter(relation => relation.id !== 'length') });
    const result = await runtime.solve({ graph, parameters: {}, drag: { pointId: 'b', position: [10 * Math.sqrt(3), 10] } });
    expect(result.kind).toBe('solved'); if (result.kind !== 'solved') throw new Error(JSON.stringify(result));
    expect(result.graph.points.find(point => point.id === 'b')?.position[0]).toBeCloseTo(10 * Math.sqrt(3), 9);
    expect(result.graph.points.find(point => point.id === 'b')?.position[1]).toBeCloseTo(10, 9);
    expect(result.graph.relations).toEqual(graph.relations); expect(checkCadSketchGraph(result.graph, {})).toEqual([]);
  });

  it('names an all-string fixed wrong sector as conflicting', async () => {
    const source = corner(30), graph = parseCadSketchGraph({ ...source, points: source.points.map(point => point.id === 'b' ? { ...point, position: ['0', '10'] } : point),
      relations: source.relations.filter(relation => relation.id !== 'length') }), before = JSON.stringify(graph);
    const result = await runtime.solve({ graph, parameters: {} });
    // With nothing free, the native solver names the unmet relation itself.
    expect(result).toMatchObject({ kind: 'rejected', reason: 'conflicting', diagnostics: { ...{ status: 'failed', degreesOfFreedom: null, conflictingIds: ['angle'], issues: [] }, redundantIds: [] } });
    if (result.kind !== 'rejected') throw new Error('Expected rejection.');
    const error = new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Corner', graph, rejection: result });
    expect(error.feedback.subjects[0]).toMatchObject({ label: 'Angle relation 1 · Line 2 and Line 1',
      pointIds: ['a', 'v', 'b'], entityIds: ['reference', 'moving'], category: 'conflicting' });
    expect(JSON.stringify(graph)).toBe(before);
  });
});
