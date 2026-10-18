import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
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
  it('closes only declared coincident endpoint identities while preserving exact source supports', () => {
    const raw = square();
    for (const gap of [0, 5e-13]) {
      const source = { ...raw, points: [...raw.points, { id: 'near', position: [0, gap] }],
        entities: raw.entities.map(entity => entity.id === 'ad' ? { ...entity, startPointId: 'near' } : entity),
        relations: [{ id: 'join', kind: 'coincident', pointIds: ['a', 'near'] }] };
      const graph = parseCadSketchGraph(source), before = JSON.stringify(graph);
      const compiled = compileCadSketchGraph(graph, { width: 20 });
      expect(compiled.cycles).toHaveLength(1);
      expect(compiled.openEntityIds).toEqual([]); expect(compiled.arrangementEntityIds).toEqual([]);
      expect(compiled.cycles[0].sourceRefs).toEqual([{ entityId: 'ab', reversed: false }, { entityId: 'cb', reversed: true },
        { entityId: 'cd', reversed: false }, { entityId: 'ad', reversed: true }]);
      expect(compiled.segments.find(segment => segment.id === 'ad')?.start).toEqual({ x: 0, y: gap });
      expect(JSON.stringify(graph)).toBe(before);
      const undeclared = compileCadSketchGraph(parseCadSketchGraph({ ...source, relations: [] }), { width: 20 });
      expect(undeclared.cycles).toEqual([]); expect(undeclared.openEntityIds).toHaveLength(4);
    }
  });
  it('keeps transitive orphan/construction aliases source-order independent without flipping original cycle witnesses', () => {
    const raw = square(), original = compileCadSketchGraph(parseCadSketchGraph(raw), { width: 20 });
    const graph = parseCadSketchGraph({ ...raw, points: [...raw.points, { id: 'near', position: [0, 5e-13] },
      { id: 'joint', position: [0, 2e-13] }, { id: '0alias', position: [' width ', 0] }],
      entities: [...raw.entities.map(entity => entity.id === 'ad' ? { ...entity, startPointId: 'near' } : entity),
        { id: 'guide', kind: 'circle', construction: true, centerPointId: 'joint', radius: 1 }],
      relations: [{ id: 'join-a', kind: 'coincident', pointIds: ['a', 'joint'] }, { id: 'join-near', kind: 'coincident', pointIds: ['joint', 'near'] },
        { id: 'alias-b', kind: 'coincident', pointIds: ['b', '0alias'] }] });
    const before = JSON.stringify(graph), result = compileCadSketchGraph(graph, { width: 20 });
    expect(result.cycles.filter(cycle => !cycle.construction)[0].sourceRefs).toEqual(original.cycles[0].sourceRefs);
    const reordered = compileCadSketchGraph(parseCadSketchGraph({ points: [...graph.points].reverse(), entities: [...graph.entities].reverse(), relations: [...graph.relations].reverse() }), { width: 20 });
    expect(reordered).toEqual(result); expect(JSON.stringify(graph)).toBe(before);
  });
  it('rejects accumulated coincidence drift even through unused points whose individual pair residuals pass', () => {
    const raw = square();
    const graph = parseCadSketchGraph({ ...raw, points: [...raw.points, { id: 'joint', position: [0, 8e-13] }, { id: 'near', position: [0, 1.6e-12] }],
      relations: [{ id: 'join-a', kind: 'coincident', pointIds: ['a', 'joint'] }, { id: 'join-near', kind: 'coincident', pointIds: ['joint', 'near'] }] });
    expect(checkCadSketchGraph(graph, { width: 20 })).toEqual([]);
    for (const relations of [graph.relations, [...graph.relations].reverse()]) {
      expect(() => compileCadSketchGraph(parseCadSketchGraph({ ...graph, relations }), { width: 20 })).toThrowError(expect.objectContaining({ code: 'sketch-graph-precision' }));
    }
  });
  it('retains branches, construction separation and unsupported crossings at declared joints', () => {
    const raw = square(), source = { ...raw, points: [...raw.points, { id: 'near', position: [0, 0] }, { id: 'tip', position: [-5, 0] }],
      entities: raw.entities.map(entity => entity.id === 'ad' ? { ...entity, startPointId: 'near' } : entity),
      relations: [{ id: 'join', kind: 'coincident', pointIds: ['a', 'near'] }] };
    const branch = compileCadSketchGraph(parseCadSketchGraph({ ...source, entities: [...source.entities,
      { id: 'tail', kind: 'line', construction: false, startPointId: 'near', endPointId: 'tip' }] }), { width: 20 });
    expect(branch.cycles).toEqual([]); expect(branch.branchedEntityIds).toEqual(['ab', 'ad', 'cb', 'cd', 'tail']);
    const mixed = compileCadSketchGraph(parseCadSketchGraph({ ...source, entities: source.entities.map(entity => ({ ...entity, construction: entity.id === 'ad' })) }), { width: 20 });
    expect(mixed.cycles).toEqual([]); expect(mixed.openEntityIds).toEqual(['ab', 'ad', 'cb', 'cd']);
    const crossing = compileCadSketchGraph(parseCadSketchGraph({ ...source, points: [
      { id: 'a', position: [0, 0] }, { id: 'b', position: [10, 10] }, { id: 'c', position: [0, 10] }, { id: 'd', position: [10, 0] }, { id: 'near', position: [0, 0] }
    ] }), { width: 20 });
    expect(crossing.cycles).toEqual([]); expect(crossing.arrangementEntityIds).toContain('ab');
    const collapsed = parseCadSketchGraph({ points: [{ id: 'a', position: [9e8, 0] }, { id: 'b', position: [9e8 + 5e-7, 0] }],
      entities: [{ id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [{ id: 'join', kind: 'coincident', pointIds: ['a', 'b'] }] });
    expect(checkCadSketchGraph(collapsed, {})).toEqual([]);
    expect(() => compileCadSketchGraph(collapsed, {})).toThrow('collapses to one declared joint');
  });
  it('joins distinct line/arc and arc/arc endpoints without attaching a coincident circle center to its rim', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 'a', position: [5, 0] }, { id: 'b', position: [0, 5] },
      { id: 'a2', position: [5, 0] }, { id: 'b2', position: [0, 5] }],
      entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'cw' },
        { id: 'chord', kind: 'line', construction: false, startPointId: 'b2', endPointId: 'a2' }],
      relations: [{ id: 'join-a', kind: 'coincident', pointIds: ['a', 'a2'] }, { id: 'join-b', kind: 'coincident', pointIds: ['b', 'b2'] }] });
    const compiled = compileCadSketchGraph(graph, {});
    expect(compiled.cycles).toHaveLength(1); expect(compiled.cycles[0].path[0]).toMatchObject({ kind: 'arc', radius: 5, sweep: -270 });
    const twoArcs = compileCadSketchGraph(parseCadSketchGraph({ ...graph, entities: graph.entities.map(entity => entity.kind === 'line'
      ? { id: entity.id, kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'b2', endPointId: 'a2', direction: 'cw' } : entity) }), {});
    expect(twoArcs.cycles).toHaveLength(1); expect(twoArcs.cycles[0].path.map(segment => segment.kind)).toEqual(['arc', 'arc']);
    const centerOnly = compileCadSketchGraph(parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 'start', position: [0, 0] }, { id: 'end', position: [1, 0] }],
      entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'o', radius: 5 },
        { id: 'line', kind: 'line', construction: false, startPointId: 'start', endPointId: 'end' }],
      relations: [{ id: 'center', kind: 'coincident', pointIds: ['o', 'start'] }] }), {});
    expect(centerOnly.cycles).toHaveLength(1); expect(centerOnly.openEntityIds).toEqual(['line']);
  });
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
