// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import { applyCadEdits, type CadEdit } from '@/domain/cad/cadOperations';
import { lineReferencePart, lineUseReference, lineMidpoint, circleReferencePart, circleUseReference, circleFollowingRelations } from '@/domain/cad/__tests__/cadSketchExternalReferenceFixtures';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSession } from './cadSession';
import { CadSketchEditDraft } from './cadSketchEditDraft';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';
import { buildCadKernelModel } from './kernel/cadKernelModel';

const require = createRequire(import.meta.url);
const solver = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
const prepare = async (document: CadDocument, edits: readonly CadEdit[], signal?: AbortSignal) => (await prepareCadEdits(document, edits, solver, signal)).document;
const graphOf = (document: CadDocument, id = 'plate') => {
  const sketch = document.features.find(feature => feature.id === id); if (sketch?.kind !== 'sketch' || !sketch.graph) throw new Error('Reference graph missing.'); return sketch.graph;
};
const moveLayout = { kind: 'translate-sketch-geometry', sketchId: 'layout', selections: [{ kind: 'entity', id: 'line' }], translation: [0, 2] } as const;

describe('ordered native preparation of preceding-sketch references', () => {
  it('follows span and an exact source Move while the native raised plate retains the actual hole center and Z extent', async () => {
    const source = lineReferencePart(false, true), linked = await prepare(source, [lineUseReference, lineMidpoint]);
    const resized = await prepare(linked, [{ kind: 'set-parameter', name: 'span', value: 60 }]);
    expect(graphOf(resized).points.find(point => point.id === 'hole-center')?.position).toEqual([30, 10]);
    const moved = await prepare(resized, [moveLayout, { kind: 'set-parameter', name: 'sourceOffset', value: 2 }]);
    expect(graphOf(moved).points.find(point => point.id === 'hole-center')?.position).toEqual([30, 12]);
    expect(graphOf(moved).points.filter(point => point.id.startsWith('ref_')).map(point => point.position)).toEqual([[0, 12], [60, 12]]);
    expect(graphOf(moved, 'layout').points).toEqual([{ id: 'a', position: ['0.000', 12] }, { id: 'b', position: [' span ', 12] }]);
    expect(moved.features[1]).toMatchObject({ offset: ' targetOffset ' }); expect(moved.features[2]).toEqual(source.features[2]);
    expect(moved.parameterMetadata).toEqual(source.parameterMetadata);
    setOC(await initOpenCascade({ wasmBinary: await readFile(new URL('../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)), print: () => undefined, printErr: () => undefined }));
    const model = buildCadKernelModel(moved);
    try {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes[0].volume).toBeCloseTo(5 * (1600 - 9 * Math.PI), 6);
      expect(model.result.meshes[0].bounds).toEqual({ min: [0, 0, 5], max: [80, 20, 10] });
      const section = model.section({ bodyId: 'pad', plane: 'XY', offset: 7 });
      expect(section.contourCount).toBe(2);
      const arcs = section.entities.filter(entity => entity.type === 'arc'); expect(arcs.length).toBeGreaterThan(0);
      for (const arc of arcs) expect(arc).toMatchObject({ center: { x: 30, y: 12 }, radius: 3 });
    } finally { model.dispose(); }
    expect(graphOf(linked, 'layout')).toEqual(graphOf(source, 'layout'));
  });

  it('fixes numeric reference-circle values while ordinary bore relations follow and incompatible target drivers reject atomically', async () => {
    const document = circleReferencePart(), linked = await prepare(document, [circleUseReference, ...circleFollowingRelations]);
    const session = new CadSession(linked), before = session.getSnapshot();
    await session.editPrepared(before.version, document => prepare(document, [{ kind: 'set-parameter', name: 'sourceSize', value: 4 }]));
    const updated = session.getSnapshot(), graph = graphOf(updated.document, 'target');
    expect(graph.points.map(point => point.position)).toEqual([[12, 8], [12, 8]]);
    expect(graph.entities.filter(entity => entity.kind === 'circle').map(entity => entity.radius)).toEqual([4, 4]);
    expect(graphOf(updated.document, 'source')).toEqual(graphOf(document, 'source'));
    await expect(session.editPrepared(updated.version, document => prepare(document, [{ kind: 'set-sketch-relation', sketchId: 'target', relation: {
      id: 'incompatible-radius', kind: 'radial-size', entityId: 'bore', quantity: 'radius', value: 5 } }]))).rejects.toMatchObject({ code: 'sketch-conflicting',
      diagnostics: { status: 'failed', conflictingIds: expect.arrayContaining(['same-radius', 'incompatible-radius']), redundantIds: [], partiallyRedundantIds: [], issues: [] } });
    expect(session.getSnapshot()).toBe(updated); session.undo(); expect(session.getSnapshot().document).toBe(linked);
  });

  it('does not let dependent propagation hide edited-prefix or unrelated-suffix native drift', async () => {
    const linked = lineReferencePart(true), extra = { ...linked.features[1], id: 'unrelated', name: 'Unrelated', profiles: [], graph: {
      points: [{ id: 'free', position: [100, 100] }], entities: [{ id: 'circle', kind: 'circle', centerPointId: 'free', radius: 2, construction: true }], relations: [] } };
    const document = parseCadDocument({ ...linked, features: [...linked.features, extra] });
    for (const victim of ['layout', 'unrelated']) {
      const session = new CadSession(document), before = session.getSnapshot(), visited: string[] = [];
      await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [moveLayout], { solve: async input => {
        const id = input.graph.points.some(point => point.id === 'free') ? 'unrelated' : input.graph.relations.some(relation => relation.kind === 'external-reference') ? 'plate' : 'layout'; visited.push(id);
        const solved = await solver.solve(input); if (solved.kind !== 'solved' || id !== victim) return solved;
        return { ...solved, graph: { ...solved.graph, points: solved.graph.points.map(point => ({ ...point, position: [point.position[0], Number(point.position[1]) + 1] as const })) } };
      } })).document)).rejects.toMatchObject({ code: 'sketch-translation-intent' });
      expect(session.getSnapshot()).toBe(before); if (victim === 'layout') expect(visited).toEqual(['layout']);
    }
  });

  it('propagates only through actual transitive reference dependents', async () => {
    const linked = lineReferencePart(true), child = { ...linked.features[0], id: 'child', name: 'Child', offset: 8, graph: {
      points: [{ id: 'center', position: [20, 10] }], entities: [{ id: 'bore', kind: 'circle', centerPointId: 'center', radius: 1, construction: false }], relations: [] } };
    const base = parseCadDocument({ ...linked, features: [...linked.features, child] });
    const referenced = await prepare(base, [{ kind: 'use-sketch-entity', sketchId: 'child', sourceSketchId: 'plate', sourceEntityId: 'ref_e0', idPrefix: 'child' },
      { kind: 'set-sketch-relation', sketchId: 'child', relation: { id: 'midpoint', kind: 'midpoint', pointId: 'center', lineId: 'child_e0' } }]);
    const changed = await prepare(referenced, [moveLayout]);
    expect(graphOf(changed, 'plate').points.find(point => point.id === 'hole-center')?.position).toEqual([20, 12]);
    expect(graphOf(changed, 'child').points.find(point => point.id === 'center')?.position).toEqual([20, 12]);
    expect(graphOf(changed, 'child').relations).toEqual(graphOf(referenced, 'child').relations);
  });

  it('flushes latest reference values before deliberate detach and source deletion', async () => {
    const source = lineReferencePart(true), session = new CadSession(source), before = session.getSnapshot();
    await session.editPrepared(before.version, document => prepare(document, [{ kind: 'set-parameter', name: 'span', value: 60 },
      { kind: 'remove-sketch-relation', sketchId: 'plate', relationId: 'ref_reference' }, { kind: 'delete-feature', featureId: 'layout', cascade: false }]));
    const detached = session.getSnapshot().document;
    expect(detached.features.map(feature => feature.id)).toEqual(['plate']); expect(graphOf(detached).points.find(point => point.id === 'ref_p1')?.position).toEqual([60, 10]);
    const later = await prepare(detached, [{ kind: 'set-parameter', name: 'span', value: 80 }]); expect(later.features).toEqual(detached.features);
    session.undo(); expect(session.getSnapshot().document).toBe(source);
  });

  it('resolves a reference created by a pending generic relation edit before a later parameter change and detach', async () => {
    const linked = lineReferencePart(true), reference = graphOf(linked).relations.find(relation => relation.kind === 'external-reference');
    if (!reference) throw new Error('Reference owner missing.');
    const detached = applyCadEdits(linked, [{ kind: 'remove-sketch-relation', sketchId: 'plate', relationId: reference.id }]);
    const changed = await prepare(detached, [{ kind: 'set-sketch-relation', sketchId: 'plate', relation: reference },
      { kind: 'set-parameter', name: 'span', value: 60 }, { kind: 'remove-sketch-relation', sketchId: 'plate', relationId: reference.id }]);
    expect(graphOf(changed).points.find(point => point.id === 'ref_p1')?.position).toEqual([60, 10]);
    expect(graphOf(changed).points.find(point => point.id === 'hole-center')?.position).toEqual([30, 10]);
    expect(graphOf(changed).relations).toEqual(graphOf(detached).relations);
    expect(graphOf(changed, 'layout')).toEqual(graphOf(detached, 'layout'));
  });

  it('rejects forged solved reference numbers even when ordinary local equations still agree', async () => {
    const document = lineReferencePart(true), session = new CadSession(document), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'span', value: 60 }], { solve: async input => {
      const result = await solver.solve(input); if (result.kind !== 'solved' || !input.graph.relations.some(relation => relation.kind === 'external-reference')) return result;
      return { ...result, graph: { ...result.graph, points: result.graph.points.map(point => point.id.startsWith('ref_') || point.id === 'hole-center'
        ? { ...point, position: [Number(point.position[0]) + 1, point.position[1]] as const } : point) } };
    } })).document)).rejects.toMatchObject({ code: 'stale-sketch-reference' });
    expect(session.getSnapshot()).toBe(before);
  });

  it('abandons a canceled downstream solve without publishing the already solved source prefix', async () => {
    const session = new CadSession(lineReferencePart(true)), before = session.getSnapshot(), abort = new AbortController();
    let arrive: () => void = () => undefined, release: () => void = () => undefined;
    const arrived = new Promise<void>(resolve => { arrive = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const pending = session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'span', value: 60 }], {
      solve: async input => { if (input.graph.relations.some(relation => relation.kind === 'external-reference')) { arrive(); await gate; } return solver.solve(input); }
    }, abort.signal)).document, abort.signal);
    await arrived; abort.abort(); release(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.getSnapshot()).toBe(before);
  });

  it('keeps reference creation private to its target and propagates an earlier private source Finish in one global undo', async () => {
    const unlinked = lineReferencePart(), targetMain = new CadSession(unlinked), targetBase = targetMain.getSnapshot(), targetDraft = new CadSketchEditDraft(targetBase, 'plate');
    await targetDraft.editPrepared([lineUseReference, lineMidpoint], prepare); expect(targetMain.getSnapshot()).toBe(targetBase);
    expect(() => targetDraft.validateEdits([{ ...lineUseReference, sketchId: 'layout' }])).toThrow(); targetDraft.cancel();
    const source = lineReferencePart(true, true), main = new CadSession(source), base = main.getSnapshot(), draft = new CadSketchEditDraft(base, 'layout');
    await draft.editPrepared([moveLayout], prepare); expect(main.getSnapshot()).toBe(base);
    const finish = draft.finishEdits(base);
    await main.editPrepared(base.version, document => prepare(document, finish.edits), undefined, () => draft.assertCurrent(main.getSnapshot(), finish.localVersion));
    expect(graphOf(main.getSnapshot().document).points.find(point => point.id === 'hole-center')?.position).toEqual([20, 12]);
    main.undo(); expect(main.getSnapshot().document).toBe(source); expect(main.getSnapshot().canUndo).toBe(false);
  });
});
