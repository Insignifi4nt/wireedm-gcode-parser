import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import { cadAnalyticSegments } from '../cadAnalyticSegments';
import { signedAreaOfPath } from '@/domain/path-intel/segments';

const square = () => ({
  points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: ['width', 0] }, { id: 'c', position: ['width', 10] }, { id: 'd', position: [0, 10] }],
  entities: [
    { id: 'ab', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
    { id: 'cb', kind: 'line', startPointId: 'c', endPointId: 'b', construction: false },
    { id: 'cd', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
    { id: 'ad', kind: 'line', startPointId: 'a', endPointId: 'd', construction: false }
  ], relations: []
});

describe('identity-connected sketch graph geometry', () => {
  it('compiles stable oriented analytic cycles independent of source array order and leaves expressions intact', () => {
    const raw = square(), graph = parseCadSketchGraph(raw), compiled = compileCadSketchGraph(graph, { width: 20 });
    expect(compiled.cycles).toHaveLength(1);
    expect(compiled.cycles[0].sourceRefs).toEqual([
      { entityId: 'ab', reversed: false }, { entityId: 'cb', reversed: true },
      { entityId: 'cd', reversed: false }, { entityId: 'ad', reversed: true }
    ]);
    const path = cadAnalyticSegments(compiled.cycles[0].path);
    expect(signedAreaOfPath(path.refs, path.byId)).toBe(200);
    const reordered = compileCadSketchGraph(parseCadSketchGraph({ ...raw, points: [...raw.points].reverse(), entities: [...raw.entities].reverse() }), { width: 20 });
    expect(reordered.cycles).toEqual(compiled.cycles);
    expect(graph.points[1].position).toEqual(['width', 0]);
    expect(compiled.segments.map(segment => segment.id).sort()).toEqual(['ab', 'ad', 'cb', 'cd']);
  });

  it('retains open and branched components without healing coincident or near-coincident identities into cells', () => {
    const raw = square(); raw.entities.pop();
    const open = compileCadSketchGraph(parseCadSketchGraph(raw), { width: 20 });
    expect(open.cycles).toEqual([]); expect(open.openEntityIds).toEqual(['ab', 'cb', 'cd']);
    const branch = compileCadSketchGraph(parseCadSketchGraph({ ...square(), points: [...square().points, { id: 'tip', position: [-5, 0] }],
      entities: [...square().entities, { id: 'tail', kind: 'line', startPointId: 'a', endPointId: 'tip', construction: false }] }), { width: 20 });
    expect(branch.cycles).toEqual([]); expect(branch.branchedEntityIds).toEqual(['ab', 'ad', 'cb', 'cd', 'tail']);
    const almost = compileCadSketchGraph(parseCadSketchGraph({ ...square(), points: [...square().points, { id: 'near', position: [0, 1e-8] }],
      entities: square().entities.map(item => item.id === 'ad' ? { ...item, startPointId: 'near' } : item) }), { width: 20 });
    expect(almost.cycles).toEqual([]); expect(almost.openEntityIds).toHaveLength(4);
    const mixed = square(); mixed.entities[0].construction = true;
    expect(compileCadSketchGraph(parseCadSketchGraph(mixed), { width: 20 })).toMatchObject({ cycles: [], openEntityIds: ['ab', 'ad', 'cb', 'cd'] });
  });

  it('keeps arc traversal and circle/construction boundaries analytic and rejects unsatisfied graph geometry', () => {
    const graph = parseCadSketchGraph({
      points: [{ id: 'o', position: [0, 0] }, { id: 'a', position: [5, 0] }, { id: 'b', position: [0, 5] }, { id: 'remote', position: [20, 0] }],
      entities: [
        { id: 'arc', kind: 'arc', centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'cw', construction: false },
        { id: 'chord', kind: 'line', startPointId: 'b', endPointId: 'a', construction: false },
        { id: 'reference', kind: 'circle', centerPointId: 'remote', radius: 'radius', construction: true }
      ], relations: []
    });
    const compiled = compileCadSketchGraph(graph, { radius: 2 });
    expect(compiled.cycles).toHaveLength(2);
    expect(compiled.cycles[0].path[0]).toMatchObject({ kind: 'arc', sweep: -270 });
    const reversed = compileCadSketchGraph(parseCadSketchGraph({ ...graph, entities: graph.entities.map(item => item.kind === 'arc'
      ? { ...item, startPointId: 'b', endPointId: 'a', direction: 'ccw' } : item) }), { radius: 2 });
    expect(reversed.cycles[0].sourceRefs[0]).toEqual({ entityId: 'arc', reversed: true });
    expect(reversed.cycles[0].path[0]).toMatchObject({ kind: 'arc', sweep: -270 });
    expect(compiled.cycles[1]).toMatchObject({ construction: true, sourceRefs: [{ entityId: 'reference', reversed: false }], path: [{ kind: 'arc', radius: 2, sweep: 360 }] });
    expect(() => compileCadSketchGraph(graph, { radius: -2 })).toThrow();
  });

  it('withholds self-crossing and overlapping cycle candidates rather than inventing arrangement cells', () => {
    const bow = compileCadSketchGraph(parseCadSketchGraph({ points: [
      { id: 'a', position: [0, 0] }, { id: 'b', position: [10, 10] }, { id: 'c', position: [0, 10] }, { id: 'd', position: [10, 0] }
    ], entities: square().entities, relations: [] }), {});
    expect(bow.cycles).toEqual([]); expect(bow.arrangementEntityIds).toContain('ab');
    const duplicate = compileCadSketchGraph(parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }], entities: [
      { id: 'one', kind: 'circle', centerPointId: 'a', radius: 5, construction: false },
      { id: 'two', kind: 'circle', centerPointId: 'a', radius: 5, construction: false }
    ], relations: [] }), {});
    expect(duplicate.cycles).toEqual([]); expect(duplicate.arrangementEntityIds).toEqual(['one', 'two']);
  });
});
