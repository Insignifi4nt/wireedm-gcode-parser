// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';
import { needsCadSketchPreparation, prepareCadEdits } from './cadEditPreparation';
import { CadSession } from './cadSession';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { translateCadSketchGraph } from '@/domain/cad/cadSketchTranslation';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadSketchCornerTreatment } from '@/domain/cad/cadSketchCornerTreatment';
import { createCadFreshSketchDrawing } from '@/domain/cad/cadFreshSketchGraph';

const require = createRequire(import.meta.url);
const solver = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
const source = () => parseCadDocument({ ...createCadDocument('Line', 'line'), schemaVersion: 2, parameters: { length: 20 }, features: [{
  id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [20, 0] }],
    entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
    relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'distance', kind: 'distance', pointIds: ['a', 'b'], value: ' length ' }]
  }
}] });
const moveSource = (fixedHeight = true) => parseCadDocument({ ...createCadDocument('Move', 'move'), schemaVersion: 2, parameters: { width: 20 }, features: [{
  id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: ['a', 'b', 'c', 'd', 'outside'].map((id, index) => ({ id, position: [[0, 0], [20, 0], [20, 10], [0, 10], [50, 30]][index] })),
    entities: [...['a', 'b', 'c', 'd'].map((id, index) => ({ id: `edge-${id}`, kind: 'line', construction: false, startPointId: id, endPointId: ['b', 'c', 'd', 'a'][index] })),
      { id: 'circle', kind: 'circle', construction: true, centerPointId: 'outside', radius: 4 }
    ], relations: [...['a', 'b', 'c', 'd'].map((id, index) => ({ id: `axis-${id}`, kind: index % 2 ? 'vertical' : 'horizontal', pointIds: [id, ['b', 'c', 'd', 'a'][index]] })),
      { id: 'width', kind: 'distance', pointIds: ['a', 'b'], value: ' width ' }, ...(fixedHeight ? [{ id: 'height', kind: 'distance', pointIds: ['b', 'c'], value: 10 }] : [])]
  }
}] });
function graphOf(document: CadDocument) {
  const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing fixture graph.'); return sketch.graph;
}
const move: CadEdit = { kind: 'translate-sketch-geometry', sketchId: 'sketch', selections: ['a', 'b', 'c', 'd'].map(id => ({ kind: 'entity', id: `edge-${id}` })), translation: [7, -3] };
const splitLine = { kind: 'split-sketch-entity', sketchId: 'sketch', split: { kind: 'line', entityId: 'ab', parameter: .25,
  splitPointId: 'cut', newEntityId: 'after', supportRelationId: 'support' } } satisfies CadEdit;

describe('shared CAD edit preparation with the real sketch solver', () => {
  it('splits the preceding solved line and accepts one exact topology change before later explicit edits', async () => {
    const session = new CadSession(source()), before = session.getSnapshot();
    const accepted = await session.editPrepared(before.version, async document => (await prepareCadEdits(document, [
      { kind: 'set-parameter', name: 'length', value: 40 }, splitLine
    ], solver)).document);
    const graph = graphOf(accepted.document);
    expect(graph.points).toEqual([{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [40, 0] }, { id: 'cut', position: [10, 0] }]);
    expect(graph.entities).toEqual([
      { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'cut' },
      { id: 'after', kind: 'line', construction: false, startPointId: 'cut', endPointId: 'b' }
    ]);
    expect(graph.relations).toEqual([...graphOf(before.document).relations, { id: 'support', kind: 'parallel', lineIds: ['ab', 'after'] }]);
    const later: CadEdit = { kind: 'set-parameter', name: 'length', value: 60 };
    const combined = await prepareCadEdits(before.document, [{ kind: 'set-parameter', name: 'length', value: 40 }, splitLine, later], solver);
    expect(combined.document).toEqual((await prepareCadEdits(accepted.document, [later], solver)).document);
    session.undo(); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().canUndo).toBe(false);
    session.redo(); expect(session.getSnapshot().document).toBe(accepted.document);
  });

  it('keeps both exact native arc children on their original source supports and direction', async () => {
    for (const direction of ['cw', 'ccw'] as const) {
      const original = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Arc',
        suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
          points: [{ id: 'center', position: [0, 0] }, { id: 'start', position: [10, 0] }, { id: 'end', position: [0, 10] }, { id: 'outside', position: [' 23 ', '-7'] }],
          entities: [{ id: 'arc', kind: 'arc', construction: true, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction }], relations: []
        } }] });
      const result = await prepareCadEdits(original, [{ kind: 'split-sketch-entity', sketchId: 'sketch', split: { kind: 'arc', entityId: 'arc',
        parameter: .5, splitPointId: 'cut', newEntityId: 'after' } }], solver);
      const graph = graphOf(result.document);
      expect(graph.points.slice(0, 4)).toEqual(graphOf(original).points); expect(graph.relations).toEqual([]);
      expect(graph.entities).toEqual([
        { id: 'arc', kind: 'arc', construction: true, centerPointId: 'center', startPointId: 'start', endPointId: 'cut', direction },
        { id: 'after', kind: 'arc', construction: true, centerPointId: 'center', startPointId: 'cut', endPointId: 'end', direction }
      ]);
      const cut = graph.points.find(point => point.id === 'cut');
      expect(cut?.position[0]).toBeCloseTo(direction === 'cw' ? -Math.SQRT1_2 * 10 : Math.SQRT1_2 * 10, 12);
      expect(cut?.position[1]).toBeCloseTo(direction === 'cw' ? -Math.SQRT1_2 * 10 : Math.SQRT1_2 * 10, 12);
      if (direction === 'ccw') {
        const fixed = parseCadDocument({ ...original, features: original.features.map(feature => feature.kind === 'sketch' && feature.graph
          ? { ...feature, graph: { ...feature.graph, points: feature.graph.points.map(point => ({ ...point,
            position: point.position.map(value => typeof value === 'number' ? String(value) : value) })) } } : feature) });
        const session = new CadSession(fixed), before = session.getSnapshot();
        await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'split-sketch-entity', sketchId: 'sketch', split: {
          kind: 'arc', entityId: 'arc', parameter: .5, splitPointId: 'cut', newEntityId: 'after' } }], solver)).document))
          .rejects.toMatchObject({ code: 'sketch-redundant', diagnostics: { redundantIds: ['after'] } });
        expect(session.getSnapshot()).toBe(before);
      }
    }
  });

  it('rejects a solver-projected cut and a native conflicting split batch without accepting partial topology', async () => {
    const session = new CadSession(source()), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [splitLine], { solve: async input => {
      const result = await solver.solve(input); if (result.kind !== 'solved') return result;
      return { ...result, graph: { ...result.graph, points: result.graph.points.map(point => point.id === 'cut' ? { ...point, position: [6, 0] as const } : point) } };
    } })).document)).rejects.toMatchObject({ code: 'sketch-split-intent' });
    expect(session.getSnapshot()).toBe(before);
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [splitLine,
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'bad-span', kind: 'distance', pointIds: ['a', 'b'], value: 10 } }
    ], solver)).document)).rejects.toMatchObject({ code: 'sketch-conflicting' });
    expect(session.getSnapshot()).toBe(before);
  });

  it('propagates inferred fresh attachments, removes them without moving geometry and rejects an incompatible append atomically', async () => {
    const original = parseCadDocument({ ...createCadDocument('Attachments', 'attachments'), schemaVersion: 2, parameters: { anchorX: 10 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [],
      graph: { points: [{ id: 'anchor', position: [' anchorX ', ' 7 '] }], entities: [], relations: [] }
    }] });
    let n = 0;
    const circle = createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'coincident', point: [10, 7], sourcePointId: 'anchor', relationId: 'circle-link' }, radius: 3 },
      construction: false, createId: () => `circle-${++n}`, existingGraph: graphOf(original), parameters: original.parameters });
    if (circle.kind !== 'circle') throw new Error('Circle constructor result missing.');
    const rectangle = createCadFreshSketchDrawing({ drawing: { kind: 'rectangle', first: { kind: 'coincident', point: [10, 7], sourcePointId: 'anchor', relationId: 'rectangle-link' },
      opposite: { kind: 'position', point: [25, 19] } }, construction: true, createId: () => `rectangle-${++n}`, existingGraph: graphOf(original), parameters: original.parameters });
    if (rectangle.kind !== 'rectangle') throw new Error('Rectangle constructor result missing.');
    const session = new CadSession(original), initial = session.getSnapshot();
    const accept = (edits: readonly CadEdit[]) => session.editPrepared(session.getSnapshot().version, async source => (await prepareCadEdits(source, edits, solver)).document);
    const attached = await accept([circle.geometry, rectangle.geometry].map(geometry => ({ kind: 'append-sketch-entities', sketchId: 'sketch', geometry })));
    expect(graphOf(attached.document).points.find(point => point.id === 'anchor')).toEqual(graphOf(original).points[0]);
    expect(graphOf(attached.document).relations.filter(relation => relation.kind === 'coincident')).toEqual([
      { id: 'circle-link', kind: 'coincident', pointIds: [circle.centerPointId, 'anchor'] },
      { id: 'rectangle-link', kind: 'coincident', pointIds: [rectangle.pointIds.first, 'anchor'] }
    ]);
    session.undo(); expect(session.getSnapshot().document).toBe(initial.document);
    session.redo(); expect(session.getSnapshot().document).toBe(attached.document);
    const moved = await accept([{ kind: 'set-parameter', name: 'anchorX', value: 20 }]);
    for (const id of [circle.centerPointId, rectangle.pointIds.first]) {
      const point = graphOf(moved.document).points.find(point => point.id === id);
      expect(point?.position[0]).toBeCloseTo(20, 10); expect(point?.position[1]).toBeCloseTo(7, 10);
    }
    expect(graphOf(moved.document).points[0].position).toEqual([' anchorX ', ' 7 ']);
    const removed = await accept(['circle-link', 'rectangle-link'].map(relationId => ({ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId })));
    expect(graphOf(removed.document).points).toEqual(graphOf(moved.document).points);
    const detached = await accept([{ kind: 'set-parameter', name: 'anchorX', value: 30 }]);
    expect(graphOf(detached.document).points).toEqual(graphOf(removed.document).points);
    const before = session.getSnapshot();
    const impossible = createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'coincident', point: [30, 7], sourcePointId: 'anchor', relationId: 'conflict-link' }, radius: 2 },
      construction: true, createId: () => `conflict-${++n}`, existingGraph: graphOf(before.document), parameters: before.document.parameters });
    if (impossible.kind !== 'circle') throw new Error('Circle constructor result missing.');
    const failure: unknown = await accept([{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: impossible.geometry },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'incompatible-axis', kind: 'fixed-axis', pointId: impossible.centerPointId, axis: 'x', value: 40 } }
    ]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected structured rejection.');
    expect(failure.diagnostics.conflictingIds).toEqual(expect.arrayContaining(['conflict-link', 'incompatible-axis']));
    expect(session.getSnapshot()).toBe(before);
  });

  it('accepts one exact selected-set move and keeps zero motion from clearing global redo', async () => {
    const session = new CadSession(moveSource()), before = session.getSnapshot();
    const accepted = await session.editPrepared(before.version, async document => (await prepareCadEdits(document, [move], solver)).document);
    expect(graphOf(accepted.document).points.map(point => point.position)).toEqual([[7, -3], [27, -3], [27, 7], [7, 7], [50, 30]]);
    expect(graphOf(accepted.document).entities).toEqual(graphOf(before.document).entities);
    expect(graphOf(accepted.document).relations).toEqual(graphOf(before.document).relations);
    session.undo(); expect(session.getSnapshot().document).toBe(before.document);
    const redo = session.getSnapshot();
    await session.editPrepared(redo.version, async document => (await prepareCadEdits(document, [{ ...move, translation: [0, 0] }], solver)).document);
    expect(session.getSnapshot()).toBe(redo); expect(session.getSnapshot().canRedo).toBe(true);
  });

  it('moves shared top-edge endpoints exactly but rejects native projection through a fixed height atomically', async () => {
    const edgeMove: CadEdit = { ...move, selections: [{ kind: 'entity', id: 'edge-c' }], translation: [0, 5] };
    const free = await prepareCadEdits(moveSource(false), [edgeMove], solver);
    expect(graphOf(free.document).points.map(point => point.position)).toEqual([[0, 0], [20, 0], [20, 15], [0, 15], [50, 30]]);
    const session = new CadSession(moveSource()), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [edgeMove], solver)).document))
      .rejects.toMatchObject({ code: 'sketch-translation-intent' });
    expect(session.getSnapshot()).toBe(before);
  });

  it.each(['point', 'radius'] as const)('refuses otherwise valid solver drift in an outside %s', async changed => {
    await expect(prepareCadEdits(moveSource(), [move], { solve: async input => {
      const result = await solver.solve(input);
      if (result.kind !== 'solved') return result;
      return { ...result, graph: { ...result.graph,
        points: result.graph.points.map(point => changed === 'point' && point.id === 'outside' ? { ...point, position: [51, 30] as const } : point),
        entities: result.graph.entities.map(entity => changed === 'radius' && entity.kind === 'circle' ? { ...entity, radius: 5 } : entity)
      } };
    } })).rejects.toMatchObject({ code: 'sketch-translation-intent' });
  });

  it('bases a Move on preceding solved parameter edits and permits a later explicit dimension edit', async () => {
    const original = moveSource(), resize: CadEdit = { kind: 'set-parameter', name: 'width', value: 30 };
    const enlarged = await prepareCadEdits(original, [resize], solver);
    const moved = await prepareCadEdits(original, [resize, move], solver);
    expect(graphOf(moved.document)).toEqual(translateCadSketchGraph({ graph: graphOf(enlarged.document), parameters: enlarged.document.parameters,
      selections: move.selections, translation: move.translation }));
    const later: CadEdit = { kind: 'set-parameter', name: 'width', value: 40 };
    const combined = await prepareCadEdits(original, [resize, move, later], solver);
    expect(combined.document).toEqual((await prepareCadEdits(moved.document, [later], solver)).document);
  });

  it('retains distinct coincident aliases and requires their deliberate selection instead of moving an outside identity', async () => {
    const document = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Aliases', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [0, 0] }, { id: 'near', position: [0, 0] }], entities: [],
        relations: [{ id: 'joint', kind: 'coincident', pointIds: ['a', 'b'] }]
      }
    }] });
    await expect(prepareCadEdits(document, [{ ...move, selections: [{ kind: 'point', id: 'a' }], translation: [5, 0] }], solver))
      .rejects.toMatchObject({ code: 'sketch-translation-intent' });
    const result = await prepareCadEdits(document, [{ ...move, selections: [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }], translation: [5, 0] }], solver);
    expect(graphOf(result.document).points).toEqual([{ id: 'a', position: [5, 0] }, { id: 'b', position: [5, 0] }, { id: 'near', position: [0, 0] }]);
    expect(graphOf(result.document).relations).toEqual(graphOf(document).relations);
  });

  it.each(['fillet', 'chamfer'] as const)('accepts exact native translation of a complete %s and rejects a partial treatment', async kind => {
    const base = moveSource(false), original = graphOf(base); let n = 0;
    const treatment = createCadSketchCornerTreatment({ graph: original, parameters: base.parameters, pointId: 'a', createId: () => `corner-${++n}`,
      treatment: kind === 'fillet' ? { kind, radius: 2 } : { kind, setbacks: [2, 3] } });
    const feature = base.features[0]; if (feature.kind !== 'sketch') throw new Error('Missing sketch.');
    const document = parseCadDocument({ ...base, features: [{ ...feature, graph: treatment.graph }] });
    const selections = treatment.graph.entities.filter(entity => entity.kind !== 'circle').map(entity => ({ kind: 'entity' as const, id: entity.id }));
    const result = await prepareCadEdits(document, [{ ...move, selections, translation: [0, 5] }], solver);
    expect(graphOf(result.document)).toEqual(translateCadSketchGraph({ graph: treatment.graph, selections, translation: [0, 5], parameters: base.parameters }));
    expect(graphOf(result.document).points.find(point => point.id === 'a')?.position).toEqual([0, 5]);
    const session = new CadSession(document), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async source => (await prepareCadEdits(source, [{ ...move,
      selections: [{ kind: 'entity', id: treatment.entityId }], translation: [1, 1] }], solver)).document)).rejects.toThrow();
    expect(session.getSnapshot()).toBe(before);
  });

  it('prepares the first appended graph before accepting its initially unsolved relations', async () => {
    const document = parseCadDocument({ ...createCadDocument('First line', 'first-line'), features: [{ id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [] }] });
    const edits: readonly CadEdit[] = [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: {
      points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [10, 2] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
      relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }]
    } }];
    expect(needsCadSketchPreparation(document, edits)).toBe(true);
    const prepared = await prepareCadEdits(document, edits, solver);
    expect(prepared.document.schemaVersion).toBe(2); expect(document.schemaVersion).toBe(1);
    expect(prepared.document.features[0]).toMatchObject({ graph: { points: [{ position: ['0', '0'] }, { position: [10, 0] }] } });
  });

  it('solves a parameter change before acceptance, preserves expressions and commits exactly one undo step', async () => {
    const session = new CadSession(source()), before = session.getSnapshot();
    const accepted = await session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'length', value: 30 }], solver)).document);
    expect(accepted.document.features[0]).toMatchObject({ graph: {
      points: [{ position: ['0', '0'] }, { position: [30, 0] }], relations: [{ id: 'horizontal' }, { value: ' length ' }]
    } });
    session.undo(); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('solves ordered point drags against the preceding candidate and leaves fixed dimensions in control', async () => {
    const document = source();
    const result = await prepareCadEdits(document, [
      { kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'distance' },
      { kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 7] },
      { kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 0] }
    ], solver);
    expect(result.document.features[0]).toMatchObject({ graph: { points: [{ position: ['0', '0'] }, { position: [30, 0] }] } });
    const constrained = await prepareCadEdits(document, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 7] }], solver);
    expect(constrained.document).toEqual(document);
  });

  it('rejects a conflicting relation batch without changing accepted geometry, parameters or history', async () => {
    const session = new CadSession(source()), before = session.getSnapshot();
    const failure: unknown = await session.editPrepared(before.version, async document => (await prepareCadEdits(document, [
      { kind: 'rename-document', name: 'Unaccepted' },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'otherLength', kind: 'distance', pointIds: ['a', 'b'], value: 10 } }
    ], solver)).document).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected structured rejection.');
    expect(failure.code).toBe('sketch-conflicting');
    expect(failure.feedback.subjects).toContainEqual(expect.objectContaining({ source: { kind: 'relation', id: 'otherLength' }, label: 'Distance relation 3 · Point 1 and Point 2', pointIds: ['a', 'b'], category: 'conflicting' }));
    expect(failure.diagnostics.conflictingIds).toContain('otherLength');
    expect(failure.message).not.toContain('otherLength');
    expect(session.getSnapshot()).toBe(before);
  });

  it('captures the complete ordered edit intent before awaiting a solver response', async () => {
    let release: () => void = () => { throw new Error('No pending solve.'); };
    const gate = new Promise<void>(resolve => { release = resolve; });
    const rename = { kind: 'rename-document' as const, name: 'Captured' };
    const edits: CadEdit[] = [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 0] }, rename];
    const prepared = prepareCadEdits(source(), edits, { solve: async input => { await gate; return solver.solve(input); } });
    rename.name = 'Changed outside'; edits.push({ kind: 'rename-document', name: 'Inserted later' });
    release();
    expect((await prepared).document.name).toBe('Captured');
  });
});
