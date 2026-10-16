// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import { lineReferencePart } from '@/domain/cad/__tests__/cadSketchExternalReferenceFixtures';
import { circleRow, circleRowPart, rowSketch } from '@/domain/cad/__tests__/cadSketchLinearPatternFixtures';
import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { parseCadSketchSolveInput, parseCadSketchSolverReply } from './sketch-solver/cadSketchSolverProtocol';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSession } from './cadSession';

const require = createRequire(import.meta.url);
const solver = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
const set: CadEdit = { kind: 'set-sketch-relation', sketchId: 'sketch', relation: circleRow };
const prepare = async (document: CadDocument, edits: readonly CadEdit[], signal?: AbortSignal) => (await prepareCadEdits(document, edits, solver, signal)).document;

describe('real native circle-pattern preparation', () => {
  it('solves a pending added pattern and named pitch before Detach, in one atomic history entry', async () => {
    const patterned = applyCadEdits(circleRowPart(), [set]), source = parseCadDocument({ ...patterned, features: [] });
    const session = new CadSession(source), before = session.getSnapshot();
    const accepted = await session.editPrepared(before.version, document => prepare(document, [
      { kind: 'add-feature', feature: rowSketch(patterned) }, { kind: 'set-parameter', name: 'pitch', value: 16 },
      { kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'row' }
    ]));
    expect(rowSketch(accepted.document).graph.points.slice(1).map(point => point.position)).toEqual([[26, 10], [42, 10], [58, 10]]);
    expect(rowSketch(accepted.document).graph.relations).toEqual([]);
    session.undo(); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('certifies later linked geometry when a snapshot detaches one owner but retains another', async () => {
    const linked = lineReferencePart(true), layout = linked.features[0], plate = linked.features[1];
    if (layout.kind !== 'sketch' || !layout.graph || plate.kind !== 'sketch' || !plate.graph) throw new Error('Missing linked fixture.');
    const source = parseCadDocument({ ...linked, parameters: { ...linked.parameters, pitch: 15 }, features: [
      { ...layout, graph: { ...layout.graph,
        points: [...layout.graph.points, { id: 'seed-a-center', position: ['10', '40'] }, { id: 'seed-b-center', position: ['10', '60'] }],
        entities: [...layout.graph.entities, { id: 'seed-a', kind: 'circle', construction: false, centerPointId: 'seed-a-center', radius: '2' },
          { id: 'seed-b', kind: 'circle', construction: false, centerPointId: 'seed-b-center', radius: '2' }] } },
      { ...plate, graph: { ...plate.graph, points: [...plate.graph.points, { id: 'free-center', position: [100, 50] }],
        entities: [...plate.graph.entities, { id: 'free', kind: 'circle', construction: true, centerPointId: 'free-center', radius: 2 }] } }
    ] });
    const patterned = applyCadEdits(source, ['a', 'b'].map(id => ({ kind: 'set-sketch-relation', sketchId: 'layout', relation: {
      ...circleRow, id: `row-${id}`, idPrefix: `row-${id}`, count: 2, seed: { kind: 'circle', entityId: `seed-${id}`, centerPointId: `seed-${id}-center` }
    } })));
    const owned = patterned.features[0]; if (owned.kind !== 'sketch' || !owned.graph) throw new Error('Missing patterns.');
    const session = new CadSession(patterned), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'update-feature', feature: {
      ...owned, graph: { ...owned.graph!, relations: owned.graph!.relations.filter(relation => relation.id !== 'row-a') }
    } }], { solve: async input => {
      const result = await solver.solve(input); return result.kind !== 'solved' ? result : { ...result, graph: { ...result.graph,
        points: result.graph.points.map(point => point.id === 'free-center' ? { ...point, position: [101, 50] as const } : point) } };
    } })).document)).rejects.toMatchObject({ code: 'sketch-pattern-intent' });
    expect(session.getSnapshot()).toBe(before);
  });

  it('retains three freedoms and certifies explicit numeric seed radius and position snapshots without averaging the request', async () => {
    const source = circleRowPart(true), patterned = await prepareCadEdits(source, [set], solver);
    expect(patterned.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 3, conflictingIds: [], redundantIds: [], issues: [] });
    const sketch = rowSketch(patterned.document), radial = { ...sketch, graph: { ...sketch.graph,
      entities: sketch.graph.entities.map(entity => entity.id === 'seed' && entity.kind === 'circle' ? { ...entity, radius: 4 } : entity) } };
    const resized = await prepare(patterned.document, [{ kind: 'update-feature', feature: radial }]);
    expect(rowSketch(resized).graph.entities).toEqual(sketch.graph.entities.map(entity => ({ ...entity, radius: 4 })));
    const current = rowSketch(resized), moved = await prepare(resized, [{ kind: 'update-feature', feature: { ...current, graph: { ...current.graph,
      points: current.graph.points.map(point => point.id === 'center' ? { ...point, position: [12, 11] } : point) } } }]);
    expect(rowSketch(moved).graph.points.map(point => point.position)).toEqual([[12, 11], [27, 11], [42, 11], [57, 11]]);
    const dragged = await prepare(moved, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'center', translation: [1, 2] }]);
    rowSketch(dragged).graph.points.forEach((point, index) => { expect(Number(point.position[0])).toBeCloseTo(13 + 15 * index, 10); expect(Number(point.position[1])).toBeCloseTo(13, 10); });
    const translated = await prepare(moved, [{ kind: 'translate-sketch-geometry', sketchId: 'sketch', selections: [{ kind: 'entity', id: 'seed' }], translation: [3, -1] }]);
    expect(rowSketch(translated).graph.points.map(point => point.position)).toEqual([[15, 10], [30, 10], [45, 10], [60, 10]]);
    const session = new CadSession(translated), before = session.getSnapshot();
    await session.editPrepared(before.version, document => prepare(document, [set])); expect(session.getSnapshot()).toBe(before);
    expect(rowSketch(patterned.document).graph.entities[0]).toEqual(rowSketch(source).graph.entities[0]);
  });
  it('solves named spacing/seed size normally, flushes them before Flip/count and detaches exact latest numbers', async () => {
    const source = circleRowPart(), patterned = await prepare(source, [set]);
    const changed = await prepareCadEdits(patterned, [{ kind: 'set-parameter', name: 'pitch', value: 16 }, { kind: 'set-parameter', name: 'diameter', value: 8 }], solver);
    expect(changed.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], issues: [] });
    expect(rowSketch(changed.document).graph.points.slice(1).map(point => point.position)).toEqual([[26, 10], [42, 10], [58, 10]]);
    const flipped = await prepare(changed.document, [{ kind: 'set-parameter', name: 'pitch', value: 17 },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { ...circleRow, direction: '-y', count: 5 } }]);
    expect(rowSketch(flipped).graph.points.slice(1).map(point => point.position)).toEqual([[10, -7], [10, -24], [10, -41], [10, -58]]);
    expect(rowSketch(flipped).graph.entities.slice(1).every(entity => entity.kind === 'circle' && entity.radius === 4)).toBe(true);
    const latest = await prepare(flipped, [{ kind: 'set-parameter', name: 'pitch', value: 18 }]);
    const detached = await prepare(flipped, [{ kind: 'set-parameter', name: 'pitch', value: 18 }, { kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'row' }]);
    expect(rowSketch(detached).graph.points).toEqual(rowSketch(latest).graph.points);
    rowSketch(detached).graph.points.slice(1).forEach((point, index) => { expect(point.position[0]).toBe(10); expect(Number(point.position[1])).toBeCloseTo(10 - 18 * (index + 1), 10); });
    expect(rowSketch(detached).graph.entities[0]).toEqual(rowSketch(source).graph.entities[0]);
    expect(rowSketch(detached).graph.points[0]).toEqual(rowSketch(source).graph.points[0]);
    expect(rowSketch(detached).graph.relations).toEqual([]);
    expect(checkCadSketchGraph(rowSketch(detached).graph, detached.parameters)).toEqual([]);
  });
  it('rejects generated drags, forged worker descriptors/residuals and solver projection without accepting history', async () => {
    const document = await prepare(circleRowPart(), [set]), graph = rowSketch(document).graph;
    expect(() => parseCadSketchSolveInput({ graph, parameters: document.parameters, drag: { pointId: 'holes_i1_p0', position: [26, 10] } })).toThrow('pattern');
    const input = parseCadSketchSolveInput({ graph, parameters: document.parameters }), diagnostics = { status: 'success', degreesOfFreedom: 0,
      conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] };
    const forged = { ...graph, points: graph.points.map(point => point.id === 'holes_i1_p0' ? { ...point, position: [26, 10] } : point) };
    expect(() => parseCadSketchSolverReply({ id: 1, kind: 'result', result: { kind: 'solved', graph: forged, diagnostics } }, input)).toThrow('constraints');
    const session = new CadSession(document), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document,
      [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: { ...circleRow, direction: '+y' } }], { solve: async input => {
        const result = await solver.solve(input); return result.kind !== 'solved' ? result : { ...result, graph: { ...result.graph,
          points: result.graph.points.map(point => point.id === 'holes_i1_p0' ? { ...point, position: [10, 26] as const } : point) } };
      } })).document)).rejects.toMatchObject({ code: 'sketch-pattern-intent' });
    expect(session.getSnapshot()).toBe(before);
    await expect(session.editPrepared(before.version, document => prepare(document, [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: {
      id: 'conflict', kind: 'fixed-axis', pointId: 'center', axis: 'x', value: 11 } }]))).rejects.toThrow();
    expect(session.getSnapshot()).toBe(before);
    const controller = new AbortController(); let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const pending = session.editPrepared(before.version, async document => (await prepareCadEdits(document,
      [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: { ...circleRow, direction: '+y' } }], { solve: async input => {
        const result = await solver.solve(input); entered(); await gate; return result;
      } }, controller.signal)).document, controller.signal);
    await started; controller.abort(); release(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.getSnapshot()).toBe(before);
  });
});
