// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchCornerTreatment } from '@/domain/cad/cadSketchCornerTreatment';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { prepareCadEdits } from '../cadEditPreparation';
import { CadSession } from '../cadSession';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { createCadSketchTestSolver } from './__tests__/cadSketchTestSolver';

const solver = createCadSketchTestSolver();
function fixture(kind: 'fillet' | 'chamfer', fixed = true) {
  const graph = parseCadSketchGraph({ points: [{ id: 'v', position: fixed ? ['0', '0'] : [0, 0] }, { id: 'a', position: fixed ? ['20', '0'] : [20, 0] }, { id: 'b', position: fixed ? ['0', '16'] : [0, 16] }],
    entities: [{ id: 'a-line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'v' },
      { id: 'b-line', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' },
      { id: 'close', kind: 'line', construction: false, startPointId: 'b', endPointId: 'a' }], relations: [] });
  let next = 0;
  return createCadSketchCornerTreatment({ graph, parameters: { size: 2 }, pointId: 'v',
    treatment: kind === 'fillet' ? { kind, radius: ' size ' } : { kind, setbacks: [' size ', 'size + 1'] }, createId: () => `corner_${++next}` });
}
describe('corner constraints', () => {
  it.each(['fillet', 'chamfer'] as const)('solves changed %s drivers before whole-part acceptance as one undo step', async kind => {
    const corner = fixture(kind), document = parseCadDocument({ ...createCadDocument('Corner', 'corner'), schemaVersion: 2, parameters: { size: 2 }, features: [{
      id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: corner.graph
    }] }), session = new CadSession(document), before = session.getSnapshot();
    const accepted = await session.editPrepared(before.version, async source => (await prepareCadEdits(source, [{ kind: 'set-parameter', name: 'size', value: 3 }], solver)).document);
    const sketch = accepted.document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected graph.');
    expect(checkCadSketchGraph(sketch.graph, { size: 3 })).toEqual([]);
    expect(sketch.graph.points.slice(0, 3)).toEqual(corner.graph.points.slice(0, 3));
    expect(sketch.graph.relations).toEqual(corner.graph.relations);
    const analysis = await solver.solve({ graph: sketch.graph, parameters: { size: 3 } });
    expect(analysis).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0 } });
    session.undo(); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().canUndo).toBe(false);
  });

  it.each(['fillet', 'chamfer'] as const)('preserves six free source coordinates for an unconstrained %s corner', async kind => {
    const corner = fixture(kind, false), before = JSON.stringify(corner.graph);
    const result = await solver.solve({ graph: corner.graph, parameters: { size: 2 } });
    expect(result).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 6, conflictingIds: [], redundantIds: [] } });
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(checkCadSketchGraph(result.graph, { size: 2 })).toEqual([]);
    expect(result.graph.relations).toEqual(corner.graph.relations);
    expect(JSON.stringify(corner.graph)).toBe(before);
  });

  it('solves a free chamfer edit natively that PlaneGCS reports solved but the graph checks reject', async () => {
    const corner = fixture('chamfer', false), before = JSON.stringify(corner.graph);
    const result = await solver.solve({ graph: corner.graph, parameters: { size: 3 } });
    expect(result).toMatchObject({ kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom: 6, conflictingIds: [], redundantIds: [], issues: [] } });
    if (result.kind === 'solved') expect(checkCadSketchGraph(result.graph, { size: 3 })).toEqual([]);
    // The graph checks still guard PlaneGCS's success.
    const planeGcs = await createCadSketchTestSolver({ mode: 'planegcs' }).solve({ graph: corner.graph, parameters: { size: 3 } });
    expect(planeGcs).toMatchObject({ kind: 'rejected', reason: 'invalid-solution', diagnostics: { status: 'success', degreesOfFreedom: 6, conflictingIds: [], redundantIds: [] } });
    expect(planeGcs.diagnostics.issues).toContainEqual(expect.objectContaining({ source: { kind: 'relation', id: corner.relationId }, code: 'relation-residual' }));
    expect(JSON.stringify(corner.graph)).toBe(before);
  });

  it.each(['fillet', 'chamfer'] as const)('rejects an oversized fixed %s driver edit without a version or history change', async kind => {
    const corner = fixture(kind), document = parseCadDocument({ ...createCadDocument('Corner', 'corner'), schemaVersion: 2, parameters: { size: 2 }, features: [{
      id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: corner.graph
    }] }), session = new CadSession(document), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async source => (await prepareCadEdits(source, [{ kind: 'set-parameter', name: 'size', value: 30 }], solver)).document)).rejects.toThrow();
    expect(session.getSnapshot()).toBe(before);
    const recovered = await solver.solve({ graph: corner.graph, parameters: { size: 2 } });
    expect(recovered).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0 } });
  });

  it('maps native corner conflicts and redundancy to persisted relation identities', async () => {
    const corner = fixture('fillet'), relation = corner.graph.relations[0];
    if (relation.kind !== 'fillet-corner') throw new Error('Expected fillet.');
    const arc = corner.graph.entities.find(entity => entity.id === relation.arcId); if (arc?.kind !== 'arc') throw new Error('Expected arc.');
    for (const distance of [2, 3]) {
      const graph = parseCadSketchGraph({ ...corner.graph, relations: [...corner.graph.relations, { id: 'duplicate-radius', kind: 'distance', pointIds: [arc.centerPointId, arc.startPointId], value: distance }] });
      const result = await solver.solve({ graph, parameters: { size: 2 } });
      expect(result).toMatchObject({ kind: 'rejected', reason: distance === 2 ? 'redundant' : 'conflicting' });
      const ids = [...result.diagnostics.conflictingIds, ...result.diagnostics.redundantIds, ...result.diagnostics.partiallyRedundantIds];
      expect(ids).toContain('duplicate-radius');
      expect(ids.some(id => id.startsWith('$'))).toBe(false);
    }
    const graph = parseCadSketchGraph({ ...corner.graph, relations: [{ id: 'duplicate-radius', kind: 'distance', pointIds: [arc.centerPointId, arc.startPointId], value: 2 }, ...corner.graph.relations] });
    const result = await solver.solve({ graph, parameters: { size: 2 } });
    expect(result).toMatchObject({ kind: 'rejected', reason: 'redundant' });
    expect([...result.diagnostics.redundantIds, ...result.diagnostics.partiallyRedundantIds]).toContain(relation.id);
  });

  it('solves preceding batch dimensions before the shared named-identity corner command reads supports', async () => {
    const document = parseCadDocument({ ...createCadDocument('Corner', 'corner'), schemaVersion: 2, parameters: { length: 20 }, features: [{
      id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'v', position: ['0', '0'] }, { id: 'a', position: [20, '0'] }, { id: 'b', position: ['0', '16'] }],
        entities: [{ id: 'a-line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'v' }, { id: 'b-line', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }, { id: 'close', kind: 'line', construction: false, startPointId: 'b', endPointId: 'a' }],
        relations: [{ id: 'length', kind: 'distance', pointIds: ['v', 'a'], value: ' length ' }]
      }
    }] });
    const session = new CadSession(document), before = session.getSnapshot();
    const accepted = await session.editPrepared(before.version, async source => (await prepareCadEdits(source, [
      { kind: 'set-parameter', name: 'length', value: 30 },
      { kind: 'create-sketch-corner', sketchId: 'sketch', pointId: 'v', treatment: { kind: 'fillet', radius: ' 2 ', trimPointIds: ['p', 'q'], centerPointId: 'c', entityId: 'arc', relationId: 'corner' } }
    ], solver)).document);
    const sketch = accepted.document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected graph.');
    expect(sketch.graph.points.find(point => point.id === 'a')?.position).toEqual([30, '0']);
    expect(checkCadSketchGraph(sketch.graph, accepted.document.parameters)).toEqual([]);
    expect(measureCadSketch(accepted.document, 'sketch').materialAreaMm2).toBeCloseTo(236 + Math.PI, 11);
    session.undo(); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().canUndo).toBe(false);
  });
});
