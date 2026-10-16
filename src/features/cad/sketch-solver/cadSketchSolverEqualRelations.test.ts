// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchSolverRuntime } from './cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './cadSketchSolverModule';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import { CadSession } from '../cadSession';
import { prepareCadEdits } from '../cadEditPreparation';
import { CadSketchPreparationError } from '../cadSketchConstraintFeedback';
import { parseCadSketchSolverReply } from './cadSketchSolverProtocol';

const require = createRequire(import.meta.url);
const runtime = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));

describe('real PlaneGCS scalar-free size equality', () => {
  it('solves shared reversed line lengths without changing exact coordinate drivers or relation tuples', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'v', position: [' 0 ', '0'] }, { id: 'a', position: [' size ', '0'] }, { id: 'b', position: ['0', 6] }],
      entities: [{ id: 'reference', kind: 'line', construction: true, startPointId: 'a', endPointId: 'v' },
        { id: 'moving', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }],
      relations: [{ id: 'equal', kind: 'equal-length', lineIds: ['moving', 'reference'] }] }), before = JSON.stringify(graph);
    const result = await runtime.solve({ graph, parameters: { size: 10 } });
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.points.map(point => point.position)).toEqual([[' 0 ', '0'], [' size ', '0'], ['0', 10]]);
    expect(result.graph.relations).toEqual(graph.relations); expect(result.graph.entities).toEqual(graph.entities);
    expect(result.diagnostics.degreesOfFreedom).toBe(0); expect(checkCadSketchGraph(result.graph, { size: 10 })).toEqual([]);
    expect(() => parseCadSketchSolverReply({ id: 1, kind: 'result', result: { ...result, graph: { ...result.graph,
      relations: [{ id: 'equal', kind: 'equal-length', lineIds: ['reference', 'moving'] }] }
    } }, { graph, parameters: { size: 10 } })).toThrow('does not match');
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('leaves the common size free when neither numeric line length nor circle radius has a driver', async () => {
    const lines = parseCadSketchGraph({ points: [{ id: 'v', position: ['0', '0'] }, { id: 'a', position: [10, '0'] }, { id: 'b', position: ['0', 6] }], entities: [
      { id: 'a-line', kind: 'line', construction: true, startPointId: 'v', endPointId: 'a' }, { id: 'b-line', kind: 'line', construction: false, startPointId: 'b', endPointId: 'v' }
    ], relations: [{ id: 'same', kind: 'equal-length', lineIds: ['b-line', 'a-line'] }] });
    const circles = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['30', '0'] }], entities: [
      { id: 'c1', kind: 'circle', construction: true, centerPointId: 'a', radius: 10 }, { id: 'c2', kind: 'circle', construction: false, centerPointId: 'b', radius: 6 }
    ], relations: [{ id: 'same', kind: 'equal-radius', curveIds: ['c2', 'c1'] }] });
    for (const graph of [lines, circles]) {
      const original = JSON.stringify(graph), result = await runtime.solve({ graph, parameters: {} });
      expect(result.kind).toBe('solved');
      if (result.kind !== 'solved') throw new Error(result.message);
      expect(result.diagnostics.degreesOfFreedom).toBe(1); expect(checkCadSketchGraph(result.graph, {})).toEqual([]);
      expect(result.graph.relations).toEqual(graph.relations); expect(JSON.stringify(graph)).toBe(original);
    }
  });

  it.each(['circle', 'arc'] as const)('links a major arc to a %s driver without new radius/angle variables', async kind => {
    const reversed = kind === 'arc', size = kind === 'circle' ? 20 : 10;
    const graph = parseCadSketchGraph({ points: [{ id: 'c1', position: ['0', '0'] },
      ...(kind === 'arc' ? [{ id: 's1', position: [10, '0'] }, { id: 'e1', position: ['0', 10] }] : []),
      { id: 'c2', position: ['30', '0'] }, { id: 's2', position: [36, '0'] }, { id: 'e2', position: ['30', 6] }], entities: [
      kind === 'circle' ? { id: 'reference', kind: 'circle', construction: true, centerPointId: 'c1', radius: 10 }
        : { id: 'reference', kind: 'arc', construction: true, centerPointId: 'c1', startPointId: 's1', endPointId: 'e1', direction: 'ccw' },
      { id: 'moving', kind: 'arc', construction: false, centerPointId: 'c2', startPointId: reversed ? 'e2' : 's2', endPointId: reversed ? 's2' : 'e2', direction: reversed ? 'ccw' : 'cw' }
    ], relations: [{ id: 'size', kind: 'radial-size', entityId: 'reference', quantity: kind === 'circle' ? 'diameter' : 'radius', value: ' size ' },
      { id: 'equal', kind: 'equal-radius', curveIds: ['moving', 'reference'] }] }), original = JSON.stringify(graph);
    const result = await runtime.solve({ graph, parameters: { size } });
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(result.graph.points.find(point => point.id === 's2')?.position).toEqual([40, '0']);
    expect(result.graph.points.find(point => point.id === 'e2')?.position).toEqual(['30', 10]);
    expect(result.diagnostics.degreesOfFreedom).toBe(0); expect(result.graph.relations).toEqual(graph.relations); expect(result.graph.entities.map(entity => entity.id)).toEqual(graph.entities.map(entity => entity.id));
    const segment = compileCadSketchGraph(result.graph, { size }).segments.find(segment => segment.id === 'moving');
    expect(segment).toMatchObject({ kind: 'arc', sweepRadians: (reversed ? 1 : -1) * Math.PI * 1.5 });
    const edited = await runtime.solve({ graph: result.graph, parameters: { size: size * 1.4 } });
    expect(edited.kind).toBe('solved');
    if (edited.kind !== 'solved') throw new Error(edited.message);
    expect(edited.graph.points.find(point => point.id === 's2')?.position).toEqual([44, '0']);
    expect(edited.graph.points.find(point => point.id === 'e2')?.position).toEqual(['30', 14]);
    expect(checkCadSketchGraph(edited.graph, { size: size * 1.4 })).toEqual([]); expect(JSON.stringify(graph)).toBe(original);
  });

  it('preserves equal line lengths during a temporary constrained endpoint drag', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'v', position: ['0', '0'] }, { id: 'a', position: [' size ', '0'] }, { id: 'b', position: [6, 8] }], entities: [
      { id: 'a-line', kind: 'line', construction: true, startPointId: 'a', endPointId: 'v' }, { id: 'b-line', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }
    ], relations: [{ id: 'same', kind: 'equal-length', lineIds: ['b-line', 'a-line'] }] });
    const result = await runtime.solve({ graph, parameters: { size: 10 }, drag: { pointId: 'b', position: [0, 15] } });
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.message);
    const [x, y] = result.graph.points[2].position;
    if (typeof x !== 'number' || typeof y !== 'number') throw new Error('A numeric endpoint became a driver.');
    expect(Math.hypot(x, y)).toBe(10); expect(x).toBeCloseTo(0, 8); expect(y).toBe(10);
    expect(result.diagnostics.degreesOfFreedom).toBe(1);
    expect(result.graph.relations).toEqual(graph.relations); expect(result.graph.points[1].position).toEqual([' size ', '0']);
  });

  it('updates two numeric circles from one exact diameter parameter through shared preparation and preserves size during center motion', async () => {
    const document = parseCadDocument({ ...createCadDocument('Holes', 'holes'), schemaVersion: 2, parameters: { bore: 20 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Holes', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [30, 0] }], entities: [
          { id: 'c1', kind: 'circle', construction: true, centerPointId: 'a', radius: 10 }, { id: 'c2', kind: 'circle', construction: false, centerPointId: 'b', radius: 6 }
        ], relations: [{ id: 'size', kind: 'radial-size', entityId: 'c1', quantity: 'diameter', value: ' bore ' }]
      }
    }] }), session = new CadSession(document), before = session.getSnapshot();
    const accepted = await session.editPrepared(before.version, async source => (await prepareCadEdits(source, [
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'same', kind: 'equal-radius', curveIds: ['c2', 'c1'] } }
    ], runtime)).document);
    expect(accepted.document.features[0]).toMatchObject({ graph: { entities: [{ radius: 10 }, { radius: 10 }] } });
    const resized = await session.editPrepared(accepted.version, async source => (await prepareCadEdits(source, [{ kind: 'set-parameter', name: 'bore', value: 28 }], runtime)).document);
    expect(resized.document.features[0]).toMatchObject({ graph: { entities: [{ radius: 14 }, { radius: 14 }], relations: [{ value: ' bore ' }, { curveIds: ['c2', 'c1'] }] } });
    session.undo(); expect(session.getSnapshot().document).toBe(accepted.document); session.redo(); expect(session.getSnapshot().document).toBe(resized.document);
    const moved = await session.editPrepared(session.getSnapshot().version, async source => (await prepareCadEdits(source, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 7] }], runtime)).document);
    expect(moved.document.features[0]).toMatchObject({ graph: { points: [{ position: ['0', '0'] }, { position: [35, 7] }], entities: [{ radius: 14 }, { radius: 14 }] } });
    expect(document.features[0]).toMatchObject({ graph: { entities: [{ radius: 10 }, { radius: 6 }] } });
  });

  it('reports the pinned fixed-string circle limitation honestly and independently rejects unequal radii', async () => {
    for (const second of [10, 6]) {
      const graph = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['30', '0'] }], entities: [
        { id: 'c1', kind: 'circle', construction: true, centerPointId: 'a', radius: ' first ' }, { id: 'c2', kind: 'circle', construction: false, centerPointId: 'b', radius: ' second ' }
      ], relations: [{ id: 'same', kind: 'equal-radius', curveIds: ['c2', 'c1'] }] }), original = JSON.stringify(graph);
      const result = await runtime.solve({ graph, parameters: { first: 10, second } });
      expect(result.diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      if (second === 10) { expect(result.kind).toBe('solved'); if (result.kind === 'solved') expect(result.graph).toEqual(graph); }
      else expect(result).toMatchObject({ kind: 'rejected', reason: 'invalid-solution', diagnostics: { issues: [{ source: { kind: 'relation', id: 'same' }, code: 'relation-residual', residualMm: 4 }] } });
      expect(JSON.stringify(graph)).toBe(original);
    }
  });

  it('rejects an incompatible fixed-radius relation batch with typed candidate operands and unchanged session identity', async () => {
    const document = parseCadDocument({ ...createCadDocument('Drivers', 'drivers'), schemaVersion: 2, parameters: { first: 10, second: 6 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Drivers', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['30', '0'] }], entities: [
          { id: 'c1', kind: 'circle', construction: true, centerPointId: 'a', radius: ' first ' }, { id: 'c2', kind: 'circle', construction: false, centerPointId: 'b', radius: ' second ' }
        ], relations: []
      }
    }] }), session = new CadSession(document), before = session.getSnapshot();
    const failure: unknown = await session.editPrepared(before.version, async source => (await prepareCadEdits(source, [
      { kind: 'rename-document', name: 'Unaccepted' }, { kind: 'set-parameter', name: 'first', value: 14 },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'attempt', kind: 'equal-radius', curveIds: ['c2', 'c1'] } }
    ], runtime)).document).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected structured preparation error.');
    expect(failure.code).toBe('sketch-invalid-solution'); expect(failure.diagnostics.issues[0].residualMm).toBe(8);
    expect(failure.feedback.subjects).toContainEqual(expect.objectContaining({ source: { kind: 'relation', id: 'attempt' }, label: 'Equal radius relation 1 · Circle 2 and Circle 1', entityIds: ['c2', 'c1'] }));
    expect(session.getSnapshot()).toBe(before);
  });
});
