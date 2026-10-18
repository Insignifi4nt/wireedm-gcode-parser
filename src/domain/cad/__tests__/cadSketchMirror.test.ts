import { describe, expect, it } from 'vitest';
import type { CadSketchFeature } from '../cadDocument';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { prepareCadSketchMirror } from '../cadSketchMirror';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';

function bore(): CadSketchFeature {
  return { id: 'sketch', name: 'Plate bore', kind: 'sketch', plane: 'XY', offset: ' 0 ', suppressed: false, profiles: [], graph: parseCadSketchGraph({
    points: [{ id: 'center', position: [' boreX ', '15.000'] }, { id: 'axis-a', position: ['30.000', ' 0 '] }, { id: 'axis-b', position: [30, 30] }],
    entities: [{ id: 'bore', kind: 'circle', centerPointId: 'center', radius: ' diameter / 2 ', construction: false },
      { id: 'axis', kind: 'line', startPointId: 'axis-a', endPointId: 'axis-b', construction: true }], relations: [] }) };
}
function mixed(): CadSketchFeature {
  return { ...bore(), graph: parseCadSketchGraph({ points: [
    { id: 'a', position: [10, 0] }, { id: 'a-close', position: [10, 0] }, { id: 'b', position: [0, 10] },
    { id: 'bore-center', position: ['6.000', ' 6 '] }, { id: 'o', position: ['0.000', ' 0 '] }, { id: 'outside-alias', position: [10, 0] },
    { id: 'axis-a', position: ['30.000', '0.000'] }, { id: 'axis-b', position: ['30.000', '15.000'] }], entities: [
    { id: 'arc', kind: 'arc', centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: false },
    { id: 'bore', kind: 'circle', centerPointId: 'bore-center', radius: ' boreRadius ', construction: true },
    { id: 'chord', kind: 'line', startPointId: 'b', endPointId: 'a-close', construction: false },
    { id: 'axis', kind: 'line', startPointId: 'axis-a', endPointId: 'axis-b', construction: true }], relations: [
    { id: 'joint-0', kind: 'coincident', pointIds: ['a', 'outside-alias'] },
    { id: 'joint-1', kind: 'coincident', pointIds: ['outside-alias', 'a-close'] },
    { id: 'point-driver', kind: 'fixed-axis', pointId: 'a', axis: 'x', value: ' 10 ' }] }) };
}

describe('detached exact graph Mirror copy', () => {
  it('copies a driven bore across the infinite graph axis with new numeric identities and exact unchanged originals', () => {
    const sketch = bore(), before = JSON.stringify(sketch), graph = sketch.graph;
    if (!graph) throw new Error('Expected graph.');
    const result = prepareCadSketchMirror({ sketch, parameters: { boreX: 15, diameter: 6 }, entityIds: ['bore'], axisLineId: 'axis', idPrefix: 'copy' });
    expect(result.sourceEntityIds).toEqual(['bore']); expect(result.resultEntityIds).toEqual(['copy_e0']);
    expect(result.sketch.graph?.points).toEqual([...graph.points, { id: 'copy_p0', position: [45, 15] }]);
    expect(result.sketch.graph?.entities).toEqual([...graph.entities,
      { id: 'copy_e0', kind: 'circle', centerPointId: 'copy_p0', radius: 3, construction: false }]);
    expect(result.sketch.graph?.relations).toEqual([]); expect(result.sketch.plane).toBe(sketch.plane); expect(result.sketch.offset).toBe(sketch.offset);
    expect(JSON.stringify(sketch)).toBe(before); expect(Object.isFrozen(sketch)).toBe(false);
    expect(Object.isFrozen(result.sketch.graph?.points.at(-1)?.position)).toBe(true);
  });

  it('preserves shared supports and validated transitive Coincident closure without copying outside aliases or drivers', () => {
    const sketch = mixed(), graph = sketch.graph;
    if (!graph) throw new Error('Expected mixed graph.');
    const request = { entityIds: ['chord', 'bore', 'arc'], axisLineId: 'axis', idPrefix: 'copy' }, parameters = { boreRadius: 1 };
    const before = JSON.stringify(sketch), result = prepareCadSketchMirror({ sketch, parameters, ...request }), copy = result.sketch.graph;
    if (!copy) throw new Error('Expected copied graph.');
    expect(copy.points.slice(graph.points.length)).toEqual([
      { id: 'copy_p0', position: [50, 0] }, { id: 'copy_p1', position: [50, 0] }, { id: 'copy_p2', position: [60, 10] },
      { id: 'copy_p3', position: [54, 6] }, { id: 'copy_p4', position: [60, 0] }]);
    expect(copy.entities.slice(graph.entities.length)).toEqual([
      { id: 'copy_e0', kind: 'arc', centerPointId: 'copy_p4', startPointId: 'copy_p0', endPointId: 'copy_p2', direction: 'cw', construction: false },
      { id: 'copy_e1', kind: 'circle', centerPointId: 'copy_p3', radius: 1, construction: true },
      { id: 'copy_e2', kind: 'line', startPointId: 'copy_p2', endPointId: 'copy_p1', construction: false }]);
    expect(copy.relations).toEqual([...graph.relations, { id: 'copy_j0', kind: 'coincident', pointIds: ['copy_p0', 'copy_p1'] }]);
    const geometry = compileCadSketchGraph(copy, parameters);
    expect(geometry.cycles.filter(cycle => cycle.sourceRefs.some(ref => ref.entityId.startsWith('copy_')))).toHaveLength(2);
    const reordered = { ...sketch, graph: parseCadSketchGraph({ points: [...graph.points].reverse(), entities: graph.entities.map(entity => entity.id === 'axis' && entity.kind === 'line'
      ? { ...entity, startPointId: entity.endPointId, endPointId: entity.startPointId } : entity).reverse(), relations: [...graph.relations].reverse() }) };
    const again = prepareCadSketchMirror({ sketch: reordered, parameters, ...request, entityIds: [...request.entityIds].reverse() }).sketch.graph;
    expect(again?.points.slice(graph.points.length)).toEqual(copy.points.slice(graph.points.length));
    expect(again?.entities.slice(graph.entities.length)).toEqual(copy.entities.slice(graph.entities.length));
    expect(again?.relations.slice(graph.relations.length)).toEqual(copy.relations.slice(graph.relations.length));
    const invalidJoints = { ...sketch, graph: parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'a-close'
      ? { ...point, position: [10 + 1.5e-12, 0] } : point.id === 'outside-alias' ? { ...point, position: [10 + .75e-12, 0] } : point) }) };
    expect(() => prepareCadSketchMirror({ sketch: invalidJoints, parameters, ...request }))
      .toThrowError(expect.objectContaining({ code: 'sketch-graph-precision' }));
    expect(JSON.stringify(sketch)).toBe(before);
  });

  it('rejects duplicate overlap with every old owner and within the copy, while allowing real transverse or tangent contacts without joining', () => {
    const sketch = bore(), graph = sketch.graph;
    if (!graph) throw new Error('Expected graph.');
    const parameters = { boreX: 15, diameter: 6 }, request = { entityIds: ['bore'], axisLineId: 'axis', idPrefix: 'copy' };
    const hidden = { ...sketch, graph: parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'hidden-center', position: [45, 15] }],
      entities: [...graph.entities, { id: 'hidden', kind: 'circle', centerPointId: 'hidden-center', radius: 3, construction: true }] }) };
    const legacy = { ...sketch, profiles: [{ id: 'legacy', name: 'Legacy circle', construction: true,
      geometry: { kind: 'circle' as const, x: ' 45 ', y: 15, radius: ' 3 ' } }] };
    for (const source of [hidden, legacy]) expect(() => prepareCadSketchMirror({ sketch: source, parameters, ...request }))
      .toThrowError(expect.objectContaining({ code: 'overlapping-sketch-mirror' }));
    const duplicates = { ...sketch, graph: parseCadSketchGraph({ points: [
      { id: 'a', position: [1, 1] }, { id: 'b', position: [2, 1] }, { id: 'c', position: [0, 0] }, { id: 'd', position: [1, 0] }], entities: [
      { id: 'first', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'second', kind: 'line', startPointId: 'b', endPointId: 'a', construction: true },
      { id: 'axis', kind: 'line', startPointId: 'c', endPointId: 'd', construction: true }], relations: [] }) };
    expect(() => prepareCadSketchMirror({ sketch: duplicates, parameters: {}, ...request, entityIds: ['first', 'second'] }))
      .toThrowError(expect.objectContaining({ code: 'overlapping-sketch-mirror' }));
    for (const x of [48, 51]) {
      const contact = { ...hidden, graph: parseCadSketchGraph({ ...hidden.graph, points: hidden.graph.points.map(point => point.id === 'hidden-center' ? { ...point, position: [x, 15] } : point) }) };
      const result = prepareCadSketchMirror({ sketch: contact, parameters, ...request });
      expect(result.sketch.graph?.relations).toEqual([]); expect(result.resultEntityIds).toEqual(['copy_e0']);
    }
  });

  it('reflects literal horizontal and oblique supports, flips a CW major arc and reuses a shared copied center', () => {
    const horizontal = { ...bore(), graph: parseCadSketchGraph({ points: [
      { id: 'a', position: [2, 1] }, { id: 'b', position: [5, 5] }, { id: 'x', position: [-20, -10] }, { id: 'y', position: [0, -10] }], entities: [
      { id: 'edge', kind: 'line', startPointId: 'a', endPointId: 'b', construction: true },
      { id: 'axis', kind: 'line', startPointId: 'x', endPointId: 'y', construction: false }], relations: [] }) };
    const line = prepareCadSketchMirror({ sketch: horizontal, parameters: {}, entityIds: ['edge'], axisLineId: 'axis', idPrefix: 'copy' }).sketch.graph;
    expect(line?.points.slice(-2)).toEqual([{ id: 'copy_p0', position: [2, -21] }, { id: 'copy_p1', position: [5, -25] }]);
    const oblique = { ...bore(), graph: parseCadSketchGraph({ points: [
      { id: 'a', position: [20, 0] }, { id: 'b', position: [10, 10] }, { id: 'o', position: [10, 0] },
      { id: 'x', position: [0, 10] }, { id: 'y', position: [10, 20] }], entities: [
      { id: 'curve', kind: 'arc', centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'cw', construction: false },
      { id: 'ring', kind: 'circle', centerPointId: 'o', radius: 2, construction: true },
      { id: 'axis', kind: 'line', startPointId: 'x', endPointId: 'y', construction: true }], relations: [] }) };
    const result = prepareCadSketchMirror({ sketch: oblique, parameters: {}, entityIds: ['ring', 'curve'], axisLineId: 'axis', idPrefix: 'copy' });
    const points = result.sketch.graph?.points.slice(-3);
    for (const [index, expected] of [[-10, 30], [0, 20], [-10, 20]].entries()) {
      expect(points?.[index].position[0]).toBeCloseTo(expected[0], 12); expect(points?.[index].position[1]).toBeCloseTo(expected[1], 12);
    }
    const copied = result.sketch.graph?.entities.slice(-2);
    expect(copied).toMatchObject([{ kind: 'arc', centerPointId: 'copy_p2', direction: 'ccw' }, { kind: 'circle', centerPointId: 'copy_p2', radius: 2 }]);
    if (!result.sketch.graph) throw new Error('Expected result.');
    const arc = compileCadSketchGraph(result.sketch.graph, {}).segments.find(segment => segment.id === 'copy_e0');
    if (arc?.kind !== 'arc') throw new Error('Expected reflected arc.');
    expect(arc.sweepRadians).toBeCloseTo(1.5 * Math.PI, 14); expect(arc.radius).toBeCloseTo(10, 12);
  });

  it('rejects a range-legal reflection that distorts a small local edge instead of accepting world-scale roundoff as shape accuracy', () => {
    const sketch = { ...bore(), graph: parseCadSketchGraph({ points: [
      { id: 'p', position: [1e8, 1e8 + 1] }, { id: 'q', position: [1e8 + .001, 1e8 + 1] },
      { id: 'x', position: [0, 0] }, { id: 'y', position: [1, 1] }], entities: [
      { id: 'edge', kind: 'line', startPointId: 'p', endPointId: 'q', construction: false },
      { id: 'axis', kind: 'line', startPointId: 'x', endPointId: 'y', construction: true }], relations: [] }) };
    const before = JSON.stringify(sketch);
    expect(() => prepareCadSketchMirror({ sketch, parameters: {}, entityIds: ['edge'], axisLineId: 'axis', idPrefix: 'copy' }))
      .toThrowError(expect.objectContaining({ code: 'sketch-mirror-precision' }));
    expect(JSON.stringify(sketch)).toBe(before);
  });

  it('keeps each declared alias coordinate and never creates a joint for undeclared equal-position IDs', () => {
    const sketch = mixed(), graph = sketch.graph;
    if (!graph) throw new Error('Expected graph.');
    const parameters = { boreRadius: 1 }, request = { entityIds: ['arc', 'chord'], axisLineId: 'axis', idPrefix: 'copy' };
    const near = { ...sketch, graph: parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'a-close' ? { ...point, position: [10 + 1e-13, 0] } : point) }) };
    const result = prepareCadSketchMirror({ sketch: near, parameters, ...request }).sketch.graph;
    expect(result?.points.slice(-4).map(point => point.position)).toEqual([[50, 0], [60 - (10 + 1e-13), 0], [60, 10], [60, 0]]);
    expect(result?.relations.at(-1)).toEqual({ id: 'copy_j0', kind: 'coincident', pointIds: ['copy_p0', 'copy_p1'] });
    const separate = { ...sketch, graph: parseCadSketchGraph({ ...graph, relations: graph.relations.filter(relation => relation.kind !== 'coincident') }) };
    const unjoined = prepareCadSketchMirror({ sketch: separate, parameters, ...request }).sketch.graph;
    if (!unjoined) throw new Error('Expected unjoined result.');
    expect(unjoined.relations).toEqual(separate.graph.relations);
    expect(unjoined.points.slice(-4).map(point => point.id)).toEqual(['copy_p0', 'copy_p1', 'copy_p2', 'copy_p3']);
    expect(compileCadSketchGraph(unjoined, parameters).cycles.filter(cycle => cycle.sourceRefs.some(ref => ref.entityId.startsWith('copy_')))).toEqual([]);
  });

  it('validates exact source/axis IDs, bounded requests and both graph/profile namespaces without reserving or mutating records', () => {
    const sketch = bore(), graph = sketch.graph;
    if (!graph) throw new Error('Expected graph.');
    const parameters = { boreX: 15, diameter: 6 }, request = { entityIds: ['bore'], axisLineId: 'axis', idPrefix: 'copy' }, before = JSON.stringify(sketch);
    for (const patch of [{ entityIds: [] }, { entityIds: ['bore', 'bore'] }, { idPrefix: 'x'.repeat(65) }])
      expect(() => prepareCadSketchMirror({ sketch, parameters, ...request, ...patch })).toThrowError(expect.objectContaining({ code: 'invalid-sketch-mirror' }));
    expect(() => prepareCadSketchMirror({ sketch, parameters, ...request, entityIds: ['center'] }))
      .toThrowError(expect.objectContaining({ code: 'missing-sketch-entity' }));
    for (const axisLineId of ['bore', 'gone']) expect(() => prepareCadSketchMirror({ sketch, parameters, ...request, axisLineId }))
      .toThrowError(expect.objectContaining({ code: 'invalid-sketch-mirror-axis' }));
    expect(() => prepareCadSketchMirror({ sketch, parameters, ...request, entityIds: ['bore', 'axis'] }))
      .toThrowError(expect.objectContaining({ code: 'invalid-sketch-mirror-axis' }));
    const graphCollision = { ...sketch, graph: parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'copy_p0', position: [-100, 0] }] }) };
    const profileCollision = { ...sketch, profiles: [{ id: 'copy_e0', name: 'Old profile', construction: true, geometry: { kind: 'circle' as const, x: -100, y: -100, radius: 1 } }] };
    for (const source of [graphCollision, profileCollision]) expect(() => prepareCadSketchMirror({ sketch: source, parameters, ...request }))
      .toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    const far = { ...sketch, graph: parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id.startsWith('axis-') ? { ...point, position: [1e9, point.position[1]] } : point) }) };
    expect(() => prepareCadSketchMirror({ sketch: far, parameters, ...request })).toThrowError(expect.objectContaining({ code: 'sketch-mirror-precision' }));
    expect(JSON.stringify(sketch)).toBe(before);
  });
});
