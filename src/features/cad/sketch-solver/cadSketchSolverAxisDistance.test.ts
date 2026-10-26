// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { prepareCadEdits } from '../cadEditPreparation';
import { CadSession } from '../cadSession';
import { CadSketchPreparationError } from '../cadSketchConstraintFeedback';
import { createCadSketchTestSolver } from './__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
const offsets = [
  { id: 'dx', kind: 'axis-distance', pointIds: ['a', 'b'], axis: 'x', value: ' dx ' },
  { id: 'dy', kind: 'axis-distance', pointIds: ['a', 'b'], axis: 'y', value: ' dy ' }
];
const parameters = { dx: 30, dy: 20, anchor: 10, radius: 2 };
function anchored() {
  return parseCadSketchGraph({ points: [{ id: 'a', position: [' anchor ', ' 7 '] }, { id: 'b', position: [40, 27] }],
    entities: [{ id: 'bore', kind: 'circle', construction: false, centerPointId: 'b', radius: ' radius ' }], relations: offsets });
}
function document(graph: CadSketchGraph) {
  return parseCadDocument({ ...createCadDocument('Relative bore', 'axis-dimensions'), schemaVersion: 2, parameters,
    features: [{ id: 'sketch', kind: 'sketch', name: 'Bore', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph }] });
}
function sketchGraph(part: ReturnType<typeof document>) {
  const sketch = part.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing graph fixture.');
  return sketch.graph;
}

describe('real PlaneGCS signed axis distances', () => {
  it('constrains relative coordinates without anchoring either free point and carries their remaining translation', async () => {
    const free = parseCadSketchGraph({ points: [{ id: 'a', position: [5, 7] }, { id: 'b', position: [35, 27] }], entities: [], relations: [] });
    const baseline = await runtime.solve({ graph: free, parameters });
    expect(baseline).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 4 } });
    const horizontal = await runtime.solve({ graph: parseCadSketchGraph({ ...free, relations: offsets.slice(0, 1) }), parameters });
    expect(horizontal).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 3 } });
    const graph = parseCadSketchGraph({ ...free, relations: offsets }), before = JSON.stringify(graph);
    const pair = await runtime.solve({ graph, parameters });
    expect(pair).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 2, issues: [] } });
    const moved = await runtime.solve({ graph, parameters, drag: { pointId: 'a', position: [10, 20] } });
    if (moved.kind !== 'solved') throw new Error(JSON.stringify(moved));
    expect(moved.graph.points[0].position).toEqual([10, 20]);
    expect(moved.graph.points[1].position).toEqual([40, 40]);
    expect(moved.graph.relations).toEqual(graph.relations);
    const fixed = await runtime.solve({ graph: parseCadSketchGraph({ ...moved.graph, relations: [...moved.graph.relations,
      { id: 'anchor', kind: 'fixed-point', pointId: 'a', position: [5, 7] }] }), parameters });
    expect(fixed).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0, issues: [] } });
    if (fixed.kind !== 'solved') throw new Error(JSON.stringify(fixed));
    expect(fixed.graph.points.map(point => point.position)).toEqual([[5, 7], [35, 27]]);
    const released = await runtime.solve({ graph: parseCadSketchGraph({ ...fixed.graph, relations: fixed.graph.relations.filter(relation => relation.id !== 'anchor') }), parameters });
    expect(released).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 2 } });
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('prepares parameter edits including negative and zero offsets while preserving exact strings, history and portable source', async () => {
    const source = document(parseCadSketchGraph({ ...anchored(), relations: [] })), session = new CadSession(source), original = session.getSnapshot();
    await session.editPrepared(original.version, async part => (await prepareCadEdits(part,
      anchored().relations.map(relation => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation })), runtime)).document);
    for (const dx of [35, -30, 0]) {
      await session.editPrepared(session.getSnapshot().version, async part => (await prepareCadEdits(part,
        [{ kind: 'set-parameter', name: 'dx', value: dx }], runtime)).document);
      const graph = sketchGraph(session.getSnapshot().document);
      expect(graph.points.map(point => point.position)).toEqual([[' anchor ', ' 7 '], [10 + dx, 27]]);
      expect(graph.entities).toEqual(anchored().entities); expect(graph.relations).toEqual(anchored().relations);
      expect(checkCadSketchGraph(graph, session.getSnapshot().document.parameters)).toEqual([]);
    }
    const accepted = session.getSnapshot();
    session.undo(); expect(sketchGraph(session.getSnapshot().document).points[1].position).toEqual([-20, 27]);
    session.redo(); expect(session.getSnapshot().document).toEqual(accepted.document);
    expect(parseCadDocument(JSON.parse(JSON.stringify(accepted.document)))).toEqual(accepted.document);
    expect(original.document).toEqual(source);
    expect(original.document.parameters.dx).toBe(30);
  });

  it('solves reversed signed operands and diagnoses duplicate and incompatible drivers without committing a rejected batch', async () => {
    const reversed = parseCadSketchGraph({ ...anchored(), relations: [
      { id: 'dx', kind: 'axis-distance', pointIds: ['b', 'a'], axis: 'x', value: ' -dx ' }, offsets[1]
    ] });
    const solved = await runtime.solve({ graph: reversed, parameters });
    expect(solved).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0 } });
    if (solved.kind !== 'solved') throw new Error(JSON.stringify(solved));
    expect(solved.graph.relations).toEqual(reversed.relations);
    const duplicate = await runtime.solve({ graph: parseCadSketchGraph({ ...solved.graph, relations: [...solved.graph.relations,
      { id: 'duplicate', kind: 'axis-distance', pointIds: ['a', 'b'], axis: 'x', value: ' dx ' }] }), parameters });
    expect(duplicate).toMatchObject({ kind: 'rejected', reason: 'redundant', diagnostics: { redundantIds: ['duplicate'] } });
    const session = new CadSession(document(solved.graph)), accepted = session.getSnapshot();
    const failure: unknown = await session.editPrepared(accepted.version, async part => (await prepareCadEdits(part, [
      { kind: 'rename-document', name: 'Rejected' }, { kind: 'set-parameter', name: 'radius', value: 3 },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'conflict', kind: 'axis-distance', pointIds: ['a', 'b'], axis: 'x', value: 31 } }
    ], runtime)).document).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected structured constraint rejection.');
    expect(failure.diagnostics.conflictingIds).toContain('conflict');
    expect(failure.feedback.subjects).toContainEqual(expect.objectContaining({ source: { kind: 'relation', id: 'conflict' },
      label: 'Horizontal distance relation 3 · Point 1 → Point 2', pointIds: ['a', 'b'], entityIds: [] }));
    expect(session.getSnapshot()).toBe(accepted);
  });

  it('keeps fully driven compatible intent and names a wrong fixed-coordinate difference as conflicting', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: ['30', '20'] }], entities: [], relations: offsets });
    const before = JSON.stringify(graph), compatible = await runtime.solve({ graph, parameters });
    expect(compatible).toMatchObject({ kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom: 0, redundantIds: [], issues: [] } });
    if (compatible.kind !== 'solved') throw new Error(JSON.stringify(compatible));
    expect(compatible.graph).toEqual(graph);
    const wrong = await runtime.solve({ graph, parameters: { ...parameters, dx: 31 } });
    // With nothing free, the native solver names the unmet relation itself.
    expect(wrong).toMatchObject({ kind: 'rejected', reason: 'conflicting', diagnostics: { status: 'failed', degreesOfFreedom: null, conflictingIds: ['dx'], issues: [] } });
    expect(JSON.stringify(graph)).toBe(before);
  });
});
