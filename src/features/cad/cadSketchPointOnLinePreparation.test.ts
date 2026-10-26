// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pointOnLineRelation, pointOnLinePart, pointOnLineSketch } from '@/domain/cad/__tests__/cadSketchPointOnLineFixtures';
import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSession } from './cadSession';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
const set = { kind: 'set-sketch-relation', sketchId: 'sketch', relation: pointOnLineRelation } as const;
describe('prepared point-on-line incidence', () => {
  it('retains one sliding freedom and follows soft drags and guide parameters without changing source drivers', async () => {
    const source = pointOnLinePart(), graph = pointOnLineSketch(source).graph;
    const baseline = await runtime.solve({ graph, parameters: source.parameters }); expect(baseline.diagnostics.degreesOfFreedom).toBe(2);
    const initial = await prepareCadEdits(source, [set], runtime); expect(initial.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 1, issues: [] });
    const point = pointOnLineSketch(initial.document).graph.points[2];
    const dragged = await prepareCadEdits(initial.document, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'p',
      translation: [30 - Number(point.position[0]), 18 - Number(point.position[1])] }], runtime);
    const moved = pointOnLineSketch(dragged.document).graph;
    expect(Number(moved.points[2].position[0])).toBeCloseTo(31.2, 10); expect(Number(moved.points[2].position[1])).toBeCloseTo(15.6, 10);
    const changed = await prepareCadEdits(dragged.document, [{ kind: 'set-parameter', name: 'height', value: 10 }], runtime);
    expect(changed.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 1, conflictingIds: [], redundantIds: [], issues: [] });
    expect(checkCadSketchGraph(pointOnLineSketch(changed.document).graph, changed.document.parameters)).toEqual([]);
    expect(pointOnLineSketch(changed.document).graph.points.slice(0, 2)).toEqual(graph.points.slice(0, 2));
    expect(pointOnLineSketch(changed.document).graph.entities).toEqual(graph.entities);
    expect(pointOnLineSketch(changed.document).graph.relations).toEqual([pointOnLineRelation]);
  });
  it('rejects wrong fixed incidence atomically, naming the unmet relation', async () => {
    const session = new CadSession(pointOnLinePart(true)), before = session.getSnapshot(); let failure: unknown;
    try { await session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'retained', value: 99 }, set], runtime)).document); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected structured failure.');
    // With nothing free, the native solver names the unmet relation itself.
    expect(failure.diagnostics).toMatchObject({ status: 'failed', degreesOfFreedom: null, conflictingIds: ['on-guide'], redundantIds: [], issues: [] });
    expect(session.getSnapshot()).toBe(before);
  });
  it('uses a linked readonly guide without detaching or replacing its numeric authority', async () => {
    const source = parseCadDocument({ ...createCadDocument('Linked sliding bore'), schemaVersion: 2, parameters: { height: 20 }, features: [
      { ...pointOnLineSketch(pointOnLinePart()), id: 'layout', graph: { points: pointOnLineSketch(pointOnLinePart()).graph.points.slice(0, 2),
        entities: [pointOnLineSketch(pointOnLinePart()).graph.entities[0]], relations: [] } },
      { id: 'target', kind: 'sketch', name: 'Bore', suppressed: false, plane: 'XY', offset: 5, profiles: [], graph: {
        points: [{ id: 'p', position: [10, 9] }], entities: [{ id: 'bore', kind: 'circle', construction: false, centerPointId: 'p', radius: '3.000' }], relations: [] } }
    ] });
    const linked = applyCadEdits(source, [{ kind: 'use-sketch-entity', sketchId: 'target', sourceSketchId: 'layout', sourceEntityId: 'guide', idPrefix: 'used' }]);
    const initial = await prepareCadEdits(linked, [{ kind: 'set-sketch-relation', sketchId: 'target', relation: { ...pointOnLineRelation, lineId: 'used_e0' } }], runtime);
    const changed = await prepareCadEdits(initial.document, [{ kind: 'set-parameter', name: 'height', value: 10 }], runtime);
    const target = changed.document.features[1]; if (target.kind !== 'sketch' || !target.graph) throw new Error('Missing linked target.');
    expect(target.graph.points.filter(point => point.id.startsWith('used_')).map(point => point.position)).toEqual([[0, 0], [40, 10]]);
    expect(target.graph.relations).toMatchObject([{ kind: 'external-reference', id: 'used_reference' }, { ...pointOnLineRelation, lineId: 'used_e0' }]);
    expect(changed.document.features[0]).toEqual(source.features[0]);
    expect(checkCadSketchGraph(target.graph, changed.document.parameters)).toEqual([]);
  });
});
