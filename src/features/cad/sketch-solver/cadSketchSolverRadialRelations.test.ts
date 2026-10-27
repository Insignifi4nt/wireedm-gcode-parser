// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cadSketchSolvedValues, checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveRecord } from './cadSketchNativeRuntime';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from '../cadSession';
import { prepareCadEdits } from '../cadEditPreparation';
import { CadSketchPreparationError } from '../cadSketchConstraintFeedback';
import { cadSketchSolverWireResult, parseCadSketchSolverReply } from './cadSketchSolverProtocol';
import { createCadSketchTestSolver } from './__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();

describe('explicit radial dimensions', () => {
  it('solves a displayed diameter into free numeric circle radius while retaining its exact driver text', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'center', position: [' 0 ', '0'] }],
      entities: [{ id: 'circle', kind: 'circle', construction: true, centerPointId: 'center', radius: 6 }],
      relations: [{ id: 'size', kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value: ' bore ' }] });
    const before = JSON.stringify(graph), result = await runtime.solve({ graph, parameters: { bore: 20 } });
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.entities[0]).toMatchObject({ radius: 10, construction: true });
    expect(result.graph.relations).toEqual(graph.relations); expect(result.graph.points).toEqual(graph.points);
    expect(result.diagnostics.degreesOfFreedom).toBe(0); expect(checkCadSketchGraph(result.graph, { bore: 20 })).toEqual([]);
    // Only solved values cross the worker boundary, so a reply cannot rewrite drivers or relations.
    const wire = { id: 1, kind: 'result', result: cadSketchSolverWireResult(result) };
    expect(parseCadSketchSolverReply(wire, { graph, parameters: { bore: 20 } })).toEqual({ id: 1, kind: 'result', result });
    expect(() => parseCadSketchSolverReply({ ...wire, result: { ...wire.result, values: [...cadSketchSolvedValues(result.graph), 10] } }, { graph, parameters: { bore: 20 } })).toThrow('does not match');
    expect(JSON.stringify(graph)).toBe(before);
  });

  it.each(['radius', 'diameter'] as const)('sizes both endpoints of a major arc from exact displayed %s intent', async quantity => {
    const reversed = quantity === 'diameter', size = quantity === 'diameter' ? 20 : 10;
    const graph = parseCadSketchGraph({ points: [{ id: 'center', position: ['30', '0'] }, { id: 'start', position: [36, '0'] }, { id: 'end', position: ['30', 6] }],
      entities: [{ id: 'arc', kind: 'arc', construction: true, centerPointId: 'center', startPointId: reversed ? 'end' : 'start', endPointId: reversed ? 'start' : 'end', direction: reversed ? 'ccw' : 'cw' }],
      relations: [{ id: 'size', kind: 'radial-size', entityId: 'arc', quantity, value: ' size ' }] }), before = JSON.stringify(graph);
    const result = await runtime.solve({ graph, parameters: { size } });
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.points.map(point => point.position)).toEqual([['30', '0'], [40, '0'], ['30', 10]]);
    expect(result.graph.entities).toEqual(graph.entities); expect(result.graph.relations).toEqual(graph.relations);
    expect(compileCadSketchGraph(result.graph, { size }).segments[0]).toMatchObject({ kind: 'arc', sweepRadians: (reversed ? 1 : -1) * 3 * Math.PI / 2 });
    const next = await runtime.solve({ graph: result.graph, parameters: { size: size * 1.4 } });
    expect(next.kind).toBe('solved');
    if (next.kind !== 'solved') throw new Error(next.message);
    expect(next.graph.points.map(point => point.position)).toEqual([['30', '0'], [44, '0'], ['30', 14]]);
    expect(checkCadSketchGraph(next.graph, { size: size * 1.4 })).toEqual([]);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it.each(['radius', 'diameter'] as const)('adds, edits and removes a %s through shared preparation with one undo per accepted batch', async quantity => {
    const size = quantity === 'diameter' ? 20 : 10;
    const document = parseCadDocument({ ...createCadDocument('Circle', 'circle'), schemaVersion: 2, parameters: { size }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Circle', suppressed: false, plane: 'XY', offset: 0, profiles: [],
      graph: { points: [{ id: 'center', position: [' 0 ', '0'] }], entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'center', radius: 6 }], relations: [] }
    }] }), session = new CadSession(document), before = session.getSnapshot();
    const prepared = await session.editPrepared(before.version, async source => (await prepareCadEdits(source, [
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'dimension', kind: 'radial-size', entityId: 'circle', quantity, value: ' size ' } }
    ], runtime)).document);
    expect(prepared.document.features[0]).toMatchObject({ graph: { entities: [{ radius: 10 }], relations: [{ id: 'dimension', quantity, value: ' size ' }] } });
    session.undo(); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().canUndo).toBe(false);
    session.redo(); expect(session.getSnapshot().document).toBe(prepared.document);
    const changed = await session.editPrepared(session.getSnapshot().version, async source => (await prepareCadEdits(source, [{ kind: 'set-parameter', name: 'size', value: size * 1.4 }], runtime)).document);
    expect(changed.document.features[0]).toMatchObject({ graph: { entities: [{ radius: 14 }], relations: [{ id: 'dimension', value: ' size ' }] } });
    const removed = await session.editPrepared(changed.version, async source => (await prepareCadEdits(source, [{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'dimension' }], runtime)).document);
    const feature = removed.document.features[0];
    if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Missing graph.');
    expect(feature.graph.entities[0]).toMatchObject({ radius: 14 }); expect(feature.graph.relations).toEqual([]);
    expect((await runtime.solve({ graph: feature.graph, parameters: removed.document.parameters })).diagnostics.degreesOfFreedom).toBe(1);
    expect(document.features[0]).toMatchObject({ graph: { entities: [{ radius: 6 }], relations: [] } });
  });

  it('rejects second ownership of an exact circle-radius string before native work, without inventing native diagnosis', async () => {
    for (const target of [10, 6]) {
      const graph: CadSketchGraph = { points: [{ id: 'center', position: ['0', '0'] }],
        entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'center', radius: ' existing ' }],
        relations: [{ id: 'size', kind: 'radial-size', entityId: 'circle', quantity: 'radius', value: target }] }, before = JSON.stringify(graph);
      const result = await runtime.solve({ graph, parameters: { existing: 6 } });
      expect(result).toMatchObject({ kind: 'rejected', reason: 'invalid-input', diagnostics: { status: null, conflictingIds: [], redundantIds: [] } });
      expect(JSON.stringify(graph)).toBe(before);
    }
  });

  it('keeps circle size during center dragging and arc size during remaining angular endpoint dragging', async () => {
    const circle = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }],
      entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'center', radius: 6 }],
      relations: [{ id: 'size', kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value: 20 }] });
    const moved = await runtime.solve({ graph: circle, parameters: {}, drag: { pointId: 'center', position: [35, 7] } });
    expect(moved.kind).toBe('solved');
    if (moved.kind !== 'solved') throw new Error(moved.message);
    expect(moved.graph.points[0].position).toEqual([35, 7]); expect(moved.graph.entities[0]).toMatchObject({ radius: 10 });
    expect(moved.graph.relations).toEqual(circle.relations); expect(moved.diagnostics.degreesOfFreedom).toBe(2);
    const arc = parseCadSketchGraph({ points: [{ id: 'center', position: ['30', '0'] }, { id: 'start', position: [40, 0] }, { id: 'end', position: ['30', 10] }],
      entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' }],
      relations: [{ id: 'size', kind: 'radial-size', entityId: 'arc', quantity: 'radius', value: 10 }] });
    const rotated = await runtime.solve({ graph: arc, parameters: {}, drag: { pointId: 'start', position: [38, 6] } });
    expect(rotated.kind).toBe('solved');
    if (rotated.kind !== 'solved') throw new Error(rotated.message);
    expect(rotated.graph.points[1].position).toEqual([38, 6]); expect(rotated.graph.entities).toEqual(arc.entities);
    expect(rotated.diagnostics.degreesOfFreedom).toBe(1); expect(rotated.graph.relations).toEqual(arc.relations);
    expect(checkCadSketchGraph(rotated.graph, {})).toEqual([]);
    const segment = compileCadSketchGraph(rotated.graph, {}).segments[0];
    expect(segment.kind).toBe('arc');
    if (segment.kind !== 'arc') throw new Error('Missing analytic arc.');
    expect(segment.sweepRadians).toBeLessThan(-Math.PI);
  });

  it('accepts supported tiny and maximum circle sizes without origin-dependent scalar relaxation', async () => {
    for (const radius of [2e-7, 1e6]) {
      const graph = parseCadSketchGraph({ points: [{ id: 'center', position: ['900000000', '900000000'] }],
        entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'center', radius: 6 }],
        relations: [{ id: 'size', kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value: radius * 2 }] });
      const result = await runtime.solve({ graph, parameters: {} });
      expect(result.kind).toBe('solved');
      if (result.kind !== 'solved') throw new Error(result.message);
      expect(checkCadSketchGraph(result.graph, {})).toEqual([]);
    }
  });

  it('rejects an invalid physical target when compiling, before the native solve', async () => {
    const records: CadSketchSolveRecord[] = [], guarded = createCadSketchTestSolver({ onSolve: record => records.push(record) });
    const graph = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }],
      entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'center', radius: 6 }],
      relations: [{ id: 'size', kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value: 2e-7 }] });
    expect(await guarded.solve({ graph, parameters: {} })).toMatchObject({ kind: 'rejected', reason: 'invalid-input' });
    expect(records).toEqual([expect.objectContaining({ native: 'compile' })]);
  });

  it('accepts an explicit source-driver release followed by radial sizing as one normal ordered batch', async () => {
    const document = parseCadDocument({ ...createCadDocument('Circle', 'release'), schemaVersion: 2, parameters: { original: 6 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Circle', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'center', position: ['0', '0'] }], entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'center', radius: ' original ' }], relations: []
      }
    }] }), feature = document.features[0], session = new CadSession(document), before = session.getSnapshot();
    if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Missing graph fixture.');
    const originalGraph = feature.graph;
    const accepted = await session.editPrepared(before.version, async source => (await prepareCadEdits(source, [
      { kind: 'update-feature', feature: { ...feature, graph: { ...originalGraph, entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'center', radius: 6 }] } } },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'size', kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value: 20 } }
    ], runtime)).document);
    expect(accepted.document.features[0]).toMatchObject({ graph: { entities: [{ radius: 10 }], relations: [{ id: 'size', quantity: 'diameter', value: 20 }] } });
    session.undo(); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().canUndo).toBe(false);
    expect(document.features[0]).toMatchObject({ graph: { entities: [{ radius: ' original ' }], relations: [] } });
  });

  it.each([[20, 'conflicting'], [12, 'redundant']] as const)('rejects a second displayed diameter %s as %s with accepted state unchanged', async (value, reason) => {
    const document = parseCadDocument({ ...createCadDocument('Circle', 'conflict'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Circle', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'center', position: ['0', '0'] }], entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'center', radius: 6 }],
        relations: [{ id: 'originalSize', kind: 'radial-size', entityId: 'circle', quantity: 'radius', value: 6 }]
      }
    }] }), session = new CadSession(document), before = session.getSnapshot();
    const failure: unknown = await session.editPrepared(before.version, async source => (await prepareCadEdits(source, [
      { kind: 'rename-document', name: 'Unaccepted' },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'otherSize', kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value } }
    ], runtime)).document).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected structured preparation rejection.');
    expect(failure.code).toBe(`sketch-${reason}`);
    expect(failure.feedback.subjects).toContainEqual(expect.objectContaining({ source: { kind: 'relation', id: 'otherSize' }, label: 'Diameter relation 2 · Circle 1' }));
    expect(session.getSnapshot()).toBe(before);
  });
});
