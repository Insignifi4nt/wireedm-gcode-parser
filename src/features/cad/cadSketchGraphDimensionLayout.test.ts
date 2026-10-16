// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { layoutCadSketchGraphDimensions } from './cadSketchGraphDimensionLayout';

function rectangle() {
  return parseCadSketchGraph({ points: [
    { id: 'a', position: [0, 0] }, { id: 'b', position: ['width', 0] },
    { id: 'c', position: ['width', 10] }, { id: 'd', position: [0, 10] }
  ], entities: [], relations: [
    { id: 'bottom', kind: 'distance', pointIds: ['a', 'b'], value: ' width ' },
    { id: 'top', kind: 'distance', pointIds: ['d', 'c'], value: 'width' },
    { id: 'left', kind: 'distance', pointIds: ['a', 'd'], value: 10 },
    { id: 'right', kind: 'distance', pointIds: ['b', 'c'], value: 10 }
  ] });
}
describe('explicit graph distance layout', () => {
  it('places bottom, top and vertical dimensions twenty screen pixels outward from graph bounds', () => {
    const graph = rectangle(), before = JSON.stringify(graph);
    const layouts = layoutCadSketchGraphDimensions(graph, { width: 20 }, .1);
    expect(layouts.map(layout => layout.line)).toEqual([
      [[0, -2], [20, -2]], [[0, 12], [20, 12]], [[-2, 0], [-2, 10]], [[22, 0], [22, 10]]
    ]);
    expect(layouts[0].extensions).toEqual([[[0, expect.closeTo(-.3, 12)], [0, -2.2]], [[20, expect.closeTo(-.3, 12)], [20, -2.2]]]);
    for (const layout of layouts) for (const endpoint of [0, 1]) {
      const tip = layout.arrows[endpoint][0], guide = layout.extensions[endpoint];
      expect(tip).toEqual(layout.line[endpoint]);
      expect((tip[0] - guide[0][0]) * (guide[1][1] - guide[0][1]) - (tip[1] - guide[0][1]) * (guide[1][0] - guide[0][0])).toBeCloseTo(0, 12);
    }
    expect(layouts[0].valueMm).toBe(20); expect(layouts[0].relation.value).toBe(' width ');
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('uses a stable bottom/right midpoint tie while retaining reversed source endpoint orientation', () => {
    for (const end of [[10, 0], [0, 10]]) {
      const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: end }], entities: [],
        relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 10 }] });
      const first = layoutCadSketchGraphDimensions(graph, {}, .1)[0];
      const reversed = layoutCadSketchGraphDimensions(parseCadSketchGraph({ ...graph,
        relations: [{ id: 'length', kind: 'distance', pointIds: ['b', 'a'], value: 10 }] }), {}, .1)[0];
      expect(reversed.line).toEqual([...first.line].reverse()); expect(reversed.label).toEqual(first.label);
      expect(reversed.arrows).toEqual([...first.arrows].reverse());
      expect(first.label).toEqual(end[0] ? [5, -2] : [2, 5]);
    }
  });

  it('keeps oblique arrow tips on their guides with bases inside the measured span', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [3, 4] }], entities: [],
      relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 5 }] });
    const layout = layoutCadSketchGraphDimensions(graph, {}, .1)[0];
    expect(layout.line).toEqual([[expect.closeTo(1.6, 12), expect.closeTo(-1.2, 12)], [expect.closeTo(4.6, 12), expect.closeTo(2.8, 12)]]);
    expect(layout.label).toEqual([expect.closeTo(3.1, 12), expect.closeTo(.8, 12)]);
    expect(layout.arrows.map(arrow => arrow[0])).toEqual(layout.line);
    const [start, end] = layout.line;
    for (const arrow of layout.arrows) for (const base of arrow.slice(1)) {
      const projection = ((base[0] - start[0]) * (end[0] - start[0]) + (base[1] - start[1]) * (end[1] - start[1])) / 25;
      expect(projection).toBeGreaterThan(0); expect(projection).toBeLessThan(1);
    }
  });

  it('retains tiny nonzero distances and excludes zero/degenerate relations and implicit free coordinates', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [1e-9, 2e-9] }, { id: 'b', position: [2e-9, 2e-9] }, { id: 'same', position: [1e-9, 2e-9] }], entities: [], relations: [
      { id: 'small', kind: 'distance', pointIds: ['a', 'b'], value: 'size' },
      { id: 'zero', kind: 'distance', pointIds: ['a', 'b'], value: 0 },
      { id: 'degenerate', kind: 'distance', pointIds: ['a', 'same'], value: 1 },
      { id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }
    ] });
    const result = layoutCadSketchGraphDimensions(graph, { size: 1e-9 }, 1e-10);
    expect(result).toHaveLength(1); expect(result[0].relation.id).toBe('small'); expect(result[0].valueMm).toBe(1e-9);
    expect(result[0].label[0]).toBeCloseTo(1.5e-9, 22); expect(result[0].label[1]).toBeCloseTo(0, 22);
    expect(layoutCadSketchGraphDimensions(parseCadSketchGraph({ ...graph, relations: [] }), {}, 1)).toEqual([]);
    expect(layoutCadSketchGraphDimensions(graph, { size: 1e-9 }, 0)).toEqual([]);
  });

  it('uses the actual major-arc bounds for the outward side at a far origin', () => {
    const graph = parseCadSketchGraph({ points: [
      { id: 'a', position: [99999998, 100000012] }, { id: 'b', position: [100000002, 100000012] },
      { id: 'center', position: [100000000, 100000010] }, { id: 'start', position: [100000010, 100000010] }, { id: 'end', position: [100000000, 100000020] }
    ], entities: [{ id: 'major-arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' }],
    relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 4 }] });
    const result = layoutCadSketchGraphDimensions(graph, {}, .1)[0];
    // The major sweep reaches y=100000000. Point-only bounds would choose the wrong side.
    expect(result.line).toEqual([[99999998, 100000014], [100000002, 100000014]]);
    expect(result.label).toEqual([100000000, 100000014]);
  });
});
