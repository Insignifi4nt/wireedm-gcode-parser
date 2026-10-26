// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tangentJoint, tangentPart, tangentSketch } from '@/domain/cad/__tests__/cadSketchTangentFixtures';
import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSession } from './cadSession';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
const set = { kind: 'set-sketch-relation', sketchId: 'sketch', relation: tangentJoint } as const;
describe('prepared line–arc tangent joint', () => {
  it('removes exactly one free degree without changing topology, tuple or any source scalar', async () => {
    const source = tangentPart('free'), graph = tangentSketch(source).graph;
    expect((await runtime.solve({ graph, parameters: source.parameters })).diagnostics.degreesOfFreedom).toBe(7);
    const result = await prepareCadEdits(source, [set], runtime), solved = tangentSketch(result.document).graph;
    expect(result.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 6, conflictingIds: [], redundantIds: [], issues: [] });
    expect(solved.entities).toEqual(graph.entities); expect(solved.relations).toEqual([tangentJoint]);
    expect(checkCadSketchGraph(solved, source.parameters)).toEqual([]);
    expect(tangentSketch(source).graph).toBe(graph);
    const moved = await prepareCadEdits(result.document, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'j', translation: [1, 2] }], runtime);
    expect(checkCadSketchGraph(tangentSketch(moved.document).graph, source.parameters)).toEqual([]);
    expect(tangentSketch(moved.document).graph.relations).toEqual([tangentJoint]);
  });
  it('retains exact fixed line and radius expression while ordinary R5→8 preparation satisfies arc structure and tangency', async () => {
    const source = tangentPart(), initial = await prepareCadEdits(source, [set], runtime);
    const changed = await prepareCadEdits(initial.document, [{ kind: 'set-parameter', name: 'bendRadius', value: 8 }], runtime), graph = tangentSketch(changed.document).graph;
    expect(changed.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    expect(graph.points.slice(0, 2)).toEqual(tangentSketch(source).graph.points.slice(0, 2));
    expect(graph.points[3].position[1]).toBe(' bendRadius ');
    expect(graph.relations).toEqual([...tangentSketch(source).graph.relations, tangentJoint]);
    expect(Number(graph.points[2].position[0])).toBeCloseTo(0, 12); expect(Number(graph.points[2].position[1])).toBeCloseTo(8, 12);
    expect(Number(graph.points[3].position[0])).toBeCloseTo(8, 12);
    expect(checkCadSketchGraph(graph, changed.document.parameters)).toEqual([]);
  });
  it.each(['cusp', 'wrong'] as const)('rejects fixed %s geometry and retains the complete session', async mode => {
    const session = new CadSession(tangentPart(mode)), before = session.getSnapshot(); let failure: unknown;
    try { await session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'retained', value: 99 }, set], runtime)).document); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected structured rejection.');
    // With nothing free, the native solver names an unmet tangency itself; a met tangency at a cusp is left to the graph checks.
    expect(failure.diagnostics).toMatchObject(mode === 'wrong' ? { status: 'failed', degreesOfFreedom: null, conflictingIds: ['tangent'], redundantIds: [], issues: [] }
      : { status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [],
        issues: [expect.objectContaining({ source: { kind: 'relation', id: 'tangent' }, code: 'relation-residual' })] });
    expect(session.getSnapshot()).toBe(before);
  });
  it('keeps a linked line fixed numeric while its distinct coincident arc endpoint and radius follow', async () => {
    const fixture = tangentSketch(tangentPart()), source = parseCadDocument({ ...createCadDocument('Linked tangent'), schemaVersion: 2, parameters: { bendRadius: 5 }, features: [
      { ...fixture, id: 'layout', graph: { points: fixture.graph.points.slice(0, 2), entities: [fixture.graph.entities[0]], relations: [] } },
      { ...fixture, id: 'target', offset: 5, graph: { points: [{ id: 'j', position: [0, 0] }, ...fixture.graph.points.slice(2)],
        entities: [fixture.graph.entities[1]], relations: fixture.graph.relations } }
    ] });
    const linked = applyCadEdits(source, [{ kind: 'use-sketch-entity', sketchId: 'target', sourceSketchId: 'layout', sourceEntityId: 'line', idPrefix: 'used' }]);
    const relation = { ...tangentJoint, endpoints: [{ entityId: 'used_e0', pointId: 'used_p1' }, tangentJoint.endpoints[1]] } as const;
    const initial = await prepareCadEdits(linked, [
      { kind: 'set-sketch-relation', sketchId: 'target', relation: { id: 'join', kind: 'coincident', pointIds: ['j', 'used_p1'] } },
      { kind: 'set-sketch-relation', sketchId: 'target', relation }
    ], runtime);
    const result = await prepareCadEdits(initial.document, [{ kind: 'set-parameter', name: 'bendRadius', value: 8 }], runtime);
    const target = result.document.features[1]; if (target.kind !== 'sketch' || !target.graph) throw new Error('Missing linked target.');
    expect(result.sketchDiagnostics.at(-1)?.diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    expect(target.graph.points.filter(point => point.id.startsWith('used_')).map(point => point.position)).toEqual([[-10, 0], [0, 0]]);
    expect(target.graph.relations).toContainEqual(relation);
    expect(target.graph.relations).toContainEqual(expect.objectContaining({ id: 'used_reference', kind: 'external-reference' }));
    expect(result.document.features[0]).toEqual(source.features[0]);
    expect(checkCadSketchGraph(target.graph, result.document.parameters)).toEqual([]);
  });
});
