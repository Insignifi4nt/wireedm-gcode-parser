// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { lineReferencePart } from '@/domain/cad/__tests__/cadSketchExternalReferenceFixtures';
import { CadSession } from './cadSession';
import { CadSketchEditDraft } from './cadSketchEditDraft';
import { prepareCadEdits } from './cadEditPreparation';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';

const require = createRequire(import.meta.url);
const solver = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
const prepare = async (document: CadDocument, edits: readonly CadEdit[], signal?: AbortSignal) => (await prepareCadEdits(document, edits, solver, signal)).document;
const reference = { id: 'measurement', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'line' } } as const;
const featureOf = (document: CadDocument, id: string) => {
  const feature = document.features.find(feature => feature.id === id);
  if (feature?.kind !== 'sketch' || !feature.graph) throw new Error('Missing fixture sketch.');
  return { ...feature, graph: feature.graph };
};
const source = () => parseCadDocument({ ...createCadDocument('Measurements', 'measurements'), schemaVersion: 2, parameters: { span: 20, diameter: 12 }, features: [{
  id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [20, 0] }, { id: 'center', position: ['50', '0'] }],
    entities: [{ id: 'line', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
      { id: 'bore', kind: 'circle', construction: false, centerPointId: 'center', radius: 3 }],
    relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: ' span ' }]
  }
}] });

describe('saved reference dimension preparation', () => {
  it('flushes preceding geometry, finishes exact private metadata and converts the same ID through ordinary driving preparation', async () => {
    const session = new CadSession(source()), initial = session.getSnapshot();
    const changed = await session.editPrepared(initial.version, document => prepare(document, [{ kind: 'set-parameter', name: 'span', value: 40 },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: reference }]));
    expect(featureOf(changed.document, 'sketch').graph.points[1].position).toEqual([40, 0]);
    expect(featureOf(changed.document, 'sketch').graph.relations.at(-1)).toEqual(reference);
    session.undo(); expect(session.getSnapshot().document).toBe(initial.document); session.redo();
    const accepted = session.getSnapshot(), draft = new CadSketchEditDraft(accepted, 'sketch');
    const radial = { id: 'bore-measurement', kind: 'reference-dimension', measurement: { kind: 'radial-size', entityId: 'bore', quantity: 'diameter' } } as const;
    await draft.editPrepared([{ kind: 'set-parameter', name: 'span', value: 50 }, { kind: 'set-sketch-relation', sketchId: 'sketch', relation: radial }], prepare);
    const finish = draft.finishEdits(accepted);
    expect(finish.edits).toMatchObject([{ kind: 'set-parameter', name: 'span', value: 50 }, { kind: 'update-feature' }]);
    const finished = await session.editPrepared(accepted.version, document => prepare(document, finish.edits));
    expect(featureOf(finished.document, 'sketch').graph).toEqual(featureOf(draft.getSnapshot().document, 'sketch').graph);
    expect(featureOf(finished.document, 'sketch').graph.points[1].position).toEqual([50, 0]);
    expect(featureOf(finished.document, 'sketch').graph.entities).toEqual(featureOf(accepted.document, 'sketch').graph.entities);
    const converted = await session.editPrepared(finished.version, document => prepare(document, [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: {
      id: radial.id, kind: 'radial-size', entityId: 'bore', quantity: 'diameter', value: ' diameter ' } }]));
    expect(featureOf(converted.document, 'sketch').graph.entities[1]).toMatchObject({ radius: 6 });
    expect(featureOf(converted.document, 'sketch').graph.relations.at(-1)).toMatchObject({ id: radial.id, kind: 'radial-size', value: ' diameter ' });
    session.undo(); expect(session.getSnapshot().document).toBe(finished.document);
    const before = session.getSnapshot();
    await expect(session.editPrepared(before.version, document => prepare(document, [
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: radial.id, kind: 'radial-size', entityId: 'bore', quantity: 'diameter', value: 12 } },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'other-radius', kind: 'radial-size', entityId: 'bore', quantity: 'radius', value: 4 } }
    ]))).rejects.toThrow();
    expect(session.getSnapshot()).toBe(before);
  });

  it('converts a linked-endpoint measurement by moving only its independent free point without detaching the link', async () => {
    const linked = lineReferencePart(true), plate = featureOf(linked, 'plate');
    const source = parseCadDocument({ ...linked, features: [linked.features[0], { ...plate, graph: { ...plate.graph,
      points: [...plate.graph.points, { id: 'free-point', position: [50, 10] }] } }] });
    const reference = { id: 'linked-distance', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['ref_p1', 'free-point'] } } as const;
    const measured = await prepare(source, [{ kind: 'set-sketch-relation', sketchId: 'plate', relation: reference }]);
    const converted = await prepare(measured, [{ kind: 'set-sketch-relation', sketchId: 'plate', relation: {
      id: reference.id, kind: 'distance', pointIds: reference.measurement.pointIds, value: 20 } }]);
    const graph = featureOf(converted, 'plate').graph, endpoint = graph.points.find(point => point.id === 'ref_p1');
    const free = graph.points.find(point => point.id === 'free-point');
    if (!endpoint || !free) throw new Error('Missing distance operands.');
    expect(Math.hypot(Number(free.position[0]) - Number(endpoint.position[0]), Number(free.position[1]) - Number(endpoint.position[1]))).toBeCloseTo(20, 10);
    expect(free.position).not.toEqual([50, 10]);
    expect(converted.features[0]).toEqual(source.features[0]);
    expect(graph.points.filter(point => point.id !== 'free-point')).toEqual(plate.graph.points);
    expect(graph.entities).toEqual(plate.graph.entities);
    expect(graph.relations.filter(relation => relation.id !== reference.id)).toEqual(plate.graph.relations);
    expect(graph.relations.at(-1)).toEqual({ id: reference.id, kind: 'distance', pointIds: ['ref_p1', 'free-point'], value: 20 });
  });

  it.each(['set', 'append', 'finish', 'remove'] as const)('rejects passive %s solver motion in later linked sketches without history', async mode => {
    const linked = lineReferencePart(true), plate = featureOf(linked, 'plate');
    const document = parseCadDocument({ ...linked, features: [linked.features[0], { ...plate, graph: { ...plate.graph,
      points: [...plate.graph.points, { id: 'free-center', position: [100, 50] }],
      entities: [...plate.graph.entities, { id: 'free-circle', kind: 'circle', construction: true, centerPointId: 'free-center', radius: 2 }] } }] });
    const base = mode === 'remove' ? await prepare(document, [{ kind: 'set-sketch-relation', sketchId: 'layout', relation: reference }]) : document;
    const layout = featureOf(base, 'layout');
    const edit: CadEdit = mode === 'set' ? { kind: 'set-sketch-relation', sketchId: 'layout', relation: reference }
      : mode === 'append' ? { kind: 'append-sketch-entities', sketchId: 'layout', geometry: { points: [], entities: [], relations: [reference] } }
      : mode === 'remove' ? { kind: 'remove-sketch-relation', sketchId: 'layout', relationId: reference.id }
      : { kind: 'update-feature', feature: { ...layout, graph: { ...layout.graph, relations: [...layout.graph.relations, reference] } } };
    const session = new CadSession(base), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [edit], { solve: async input => {
      const result = await solver.solve(input);
      return result.kind !== 'solved' ? result : { ...result, graph: { ...result.graph, points: result.graph.points.map(point => point.id === 'free-center'
        ? { ...point, position: [101, 50] as const } : point) } };
    } })).document)).rejects.toMatchObject({ code: 'sketch-reference-dimension-intent' });
    expect(session.getSnapshot()).toBe(before);
  });

  it('still solves a real geometry append containing passive and driving relations', async () => {
    const document = source(), prepared = await prepare(document, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: {
      points: [{ id: 'free', position: [3, 4] }], entities: [], relations: [
        { id: 'free-measurement', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['a', 'free'] } },
        { id: 'free-distance', kind: 'distance', pointIds: ['a', 'free'], value: 10 }
      ]
    } }]);
    const graph = featureOf(prepared, 'sketch').graph, free = graph.points.at(-1);
    if (!free) throw new Error('Missing appended point.');
    expect(Math.hypot(Number(free.position[0]), Number(free.position[1]))).toBeCloseTo(10, 10);
    expect(free.position).not.toEqual([3, 4]);
    expect(graph.points.slice(0, -1)).toEqual(featureOf(document, 'sketch').graph.points);
    expect(graph.relations.at(-2)).toMatchObject({ id: 'free-measurement', kind: 'reference-dimension' });
  });

  it('keeps deferred annotation work subject to cancellation and accepted version guards', async () => {
    for (const cancel of [false, true]) {
      const session = new CadSession(source()), before = session.getSnapshot(), owner = new AbortController();
      let release!: () => void, started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
      const pending = session.editPrepared(before.version, async document => (await prepareCadEdits(document,
        [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: reference }], { solve: async input => { started(); await gate; return solver.solve(input); } }, owner.signal)).document, owner.signal);
      await entered;
      if (cancel) owner.abort(); else session.edit([{ kind: 'rename-document', name: 'New accepted title' }]);
      const current = session.getSnapshot(); release();
      await expect(pending).rejects.toMatchObject(cancel ? { name: 'AbortError' } : { code: 'STALE_STATE' });
      expect(session.getSnapshot()).toBe(current);
    }
  });
});
