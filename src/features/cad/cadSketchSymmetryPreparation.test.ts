// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { symmetricRelation, symmetryPart, symmetrySketch } from '@/domain/cad/__tests__/cadSketchSymmetryFixtures';
import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from './cadSession';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { prepareCadEdits } from './cadEditPreparation';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';

const require = createRequire(import.meta.url);
const runtime = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
const set = { kind: 'set-sketch-relation', sketchId: 'sketch', relation: symmetricRelation } as const;
describe('pinned native point-pair symmetry', () => {
  it('adds two conditions without anchoring a free pair or equating circle sizes', async () => {
    const source = symmetryPart({ free: true }), baseline = await runtime.solve({ graph: symmetrySketch(source).graph, parameters: source.parameters });
    const prepared = await prepareCadEdits(source, [set], runtime);
    expect(baseline.diagnostics.degreesOfFreedom).toBe(4); expect(prepared.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 2, conflictingIds: [], redundantIds: [], issues: [] });
    expect(symmetrySketch(prepared.document).graph.entities).toEqual(symmetrySketch(source).graph.entities);
    expect(checkCadSketchGraph(symmetrySketch(prepared.document).graph, prepared.document.parameters)).toEqual([]);
    const beforeMove=symmetrySketch(prepared.document).graph.points.find(point=>point.id==='left')!.position;
    const moved=await prepareCadEdits(prepared.document,[{kind:'move-sketch-point',sketchId:'sketch',pointId:'left',translation:[2,3]}],runtime),graph=symmetrySketch(moved.document).graph;
    const left=graph.points.find(point=>point.id==='left')!,right=graph.points.find(point=>point.id==='right')!;
    expect(Number(left.position[0])).toBeCloseTo(Number(beforeMove[0])+2,10);expect(Number(left.position[1])).toBeCloseTo(Number(beforeMove[1])+3,10);
    expect(Number(left.position[0])+Number(right.position[0])).toBeCloseTo(70,10);expect(Number(right.position[1])).toBeCloseTo(Number(left.position[1]),10);
    expect(graph.entities).toEqual(symmetrySketch(source).graph.entities);expect(graph.points.slice(0,2)).toEqual(symmetrySketch(source).graph.points.slice(0,2));expect(checkCadSketchGraph(graph,moved.document.parameters)).toEqual([]);

  });
  it('follows exact source parameters, oblique support and reversed endpoint order with unchanged relation/source strings', async () => {
    const source = symmetryPart(), session = new CadSession(source), before = session.getSnapshot();
    const initial = await session.editPrepared(before.version, async document => (await prepareCadEdits(document, [set], runtime)).document);
    expect(symmetrySketch(initial.document).graph.points[3].position).toEqual([55, 10]);
    const changed = await session.editPrepared(initial.version, async document => (await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'leftX', value: 20 }], runtime)).document);
    expect(symmetrySketch(changed.document).graph.points[3].position).toEqual([50, 10]);
    expect(symmetrySketch(changed.document).graph.points.slice(0, 3)).toEqual(symmetrySketch(source).graph.points.slice(0, 3));
    expect(symmetrySketch(changed.document).graph.relations).toEqual([symmetricRelation]);
    session.undo(); expect(session.getSnapshot().document).toBe(initial.document);
    for (const options of [{ oblique: true }, { reversed: true }]) {
      const document = symmetryPart(options), result = await prepareCadEdits(document, [set], runtime), point = symmetrySketch(result.document).graph.points[3];
      expect(result.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], issues: [] });
      expect(Number(point.position[0])).toBeCloseTo(options.oblique ? 10 : 55, 12); expect(Number(point.position[1])).toBeCloseTo(options.oblique ? 15 : 10, 12);
      expect(symmetrySketch(result.document).graph.entities).toEqual(symmetrySketch(document).graph.entities);
    }
  });
  it('independently rejects incompatible fully fixed points after actual native Success without fabricating native IDs or history', async () => {
    const session = new CadSession(symmetryPart({ incompatible: true })), before = session.getSnapshot();
    let failure: unknown;
    try { await session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'retained', value: 99 }, set], runtime)).document); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected structured rejection.');
    expect(failure.diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], issues: [expect.objectContaining({ source: { kind: 'relation', id: 'symmetry' }, code: 'relation-residual' })] });
    expect(session.getSnapshot()).toBe(before);
  });
  it('allows a linked readonly axis and one linked paired point to drive the independent point without detaching', async () => {
    const source = parseCadDocument({ ...createCadDocument('Referenced symmetry'), schemaVersion: 2, parameters: { leftX: 15 }, features: [
      { id: 'layout', name: 'Layout', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: ['35.000', '0'] }, { id: 'b', position: ['35.000', '20'] }, { id: 'left', position: [' leftX ', '10.000'] }],
        entities: [{ id: 'axis', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
          { id: 'left-bore', kind: 'circle', construction: true, centerPointId: 'left', radius: '3.000' }], relations: [] } },
      { id: 'target', name: 'Raised bore', kind: 'sketch', suppressed: false, plane: 'XY', offset: 5, profiles: [], graph: {
        points: [{ id: 'right', position: [49, 11] }], entities: [{ id: 'right-bore', kind: 'circle', construction: false, centerPointId: 'right', radius: '4.00' }], relations: [] } }
    ] });
    const linked = applyCadEdits(source, [{ kind: 'use-sketch-entity', sketchId: 'target', sourceSketchId: 'layout', sourceEntityId: 'axis', idPrefix: 'axis' },
      { kind: 'use-sketch-entity', sketchId: 'target', sourceSketchId: 'layout', sourceEntityId: 'left-bore', idPrefix: 'anchor' }]);
    const initial = await prepareCadEdits(linked, [{ kind: 'set-sketch-relation', sketchId: 'target', relation: {
      ...symmetricRelation, pointIds: ['anchor_c0', 'right'], lineId: 'axis_e0' } }], runtime);
    const changed = await prepareCadEdits(initial.document, [{ kind: 'set-parameter', name: 'leftX', value: 20 }], runtime);
    const target = changed.document.features[1]; if (target.kind !== 'sketch' || !target.graph) throw new Error('Missing target.');
    expect(target.graph.points.find(point => point.id === 'right')?.position).toEqual([50, 10]);
    expect(target.graph.points.find(point => point.id === 'anchor_c0')?.position).toEqual([20, 10]);
    expect(target.graph.points.filter(point => point.id.startsWith('axis_')).map(point => point.position)).toEqual([[35, 0], [35, 20]]);
    expect(changed.document.features[0]).toEqual(source.features[0]);
    expect(target.graph.relations.filter(relation => relation.kind === 'external-reference')).toEqual(
      initial.document.features[1].kind === 'sketch' ? initial.document.features[1].graph?.relations.filter(relation => relation.kind === 'external-reference') : []);
    expect(changed.sketchDiagnostics[1].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], issues: [] });
  });
});
