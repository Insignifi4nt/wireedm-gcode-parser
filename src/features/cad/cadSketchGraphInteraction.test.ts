import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchGraphPointTranslation, prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';

const source: CadSketchGraph = parseCadSketchGraph({ points: [
  { id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }, { id: 'd', position: [0, 10] }
], entities: [
  { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
  { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
  { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
  { id: 'da', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' }
], relations: [] });

describe('stable sketch point and entity interaction', () => {
  it('prioritizes the point over its closed boundary and retains all overlap candidates independent of source order', () => {
    const prepare = (graph: CadSketchGraph) => prepareCadSketchGraphInteraction(graph, {});
    const normal = prepare(source), reversed = prepare({ ...source, points: [...source.points].reverse(), entities: [...source.entities].reverse() });
    expect(normal.pick([20, 0], .1)).toEqual([{ kind: 'point', id: 'b' }, { kind: 'entity', id: 'ab' }, { kind: 'entity', id: 'bc' }]);
    expect(reversed.pick([20, 0], .1)).toEqual(normal.pick([20, 0], .1));
    expect(normal.pick([20.59, -0.59], .1)).not.toContainEqual({ kind: 'point', id: 'b' });
    expect(normal.pick([10, .59], .1)).toEqual([{ kind: 'entity', id: 'ab' }]);
    expect(normal.pick([10, .61], .1)).toEqual([]);
    expect(normal.pick([10, 5], .1)).toEqual([]);
  });

  it('hits exact circular and signed major arc supports without their complementary extensions', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }, { id: 'start', position: [10, 0] }, { id: 'end', position: [0, 10] }, { id: 'other', position: [30, 0] }],
      entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' },
        { id: 'circle', kind: 'circle', construction: true, centerPointId: 'other', radius: 5 }], relations: [] });
    const prepared = prepareCadSketchGraphInteraction(graph, {});
    expect(prepared.pick([-10.05, 0], .01)).toEqual([{ kind: 'entity', id: 'arc' }]);
    expect(prepared.pick([Math.sqrt(50), Math.sqrt(50)], .01)).toEqual([]);
    expect(prepared.pick([30, 5.05], .01)).toEqual([{ kind: 'entity', id: 'circle' }]);
    expect(prepared.pick([0, 0], .01)[0]).toEqual({ kind: 'point', id: 'center' });
  });

  it('preserves exact per-axis expression and explicit fixed drivers when moving an otherwise free point', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'mixed', position: [' offset ', 7] }, { id: 'fixed', position: [4, 5] }, { id: 'axis', position: [8, 9] }], entities: [],
      relations: [{ id: 'fix', kind: 'fixed-point', pointId: 'fixed', position: [4, 5] }, { id: 'x', kind: 'fixed-axis', pointId: 'axis', axis: 'x', value: 8 }] });
    const prepared = prepareCadSketchGraphInteraction(graph, { offset: 3 });
    expect(prepared.points.map(point => [point.id, point.freeAxes])).toEqual([['mixed', [false, true]], ['fixed', [false, false]], ['axis', [false, true]]]);
    expect(cadSketchGraphPointTranslation(prepared.points[0], [20, 12])).toEqual([0, 5]);
    expect(cadSketchGraphPointTranslation(prepared.points[1], [20, 12])).toEqual([0, 0]);
    expect(cadSketchGraphPointTranslation(prepared.points[2], [20, 12])).toEqual([0, 3]);
    expect(graph.points[0].position).toEqual([' offset ', 7]);
  });
});
