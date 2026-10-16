// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchCornerTreatment } from '@/domain/cad/cadSketchCornerTreatment';
import { cadSketchGraphDimensionLabel, layoutCadSketchGraphDimensions } from './cadSketchGraphDimensionLayout';

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
    expect(layouts[0].valueMm).toBe(20); expect(layouts[0].relation).toMatchObject({ value: ' width ' });
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

function corner(angle = 0) {
  const rotate = ([x, y]: readonly [number, number]): readonly [number, number] => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
  return { rotate, graph: parseCadSketchGraph({ points: [{ id: 'vertex', position: [0, 0] }, { id: 'a', position: rotate([20, 0]) }, { id: 'b', position: rotate([0, 20]) }],
    entities: [{ id: 'line-a', kind: 'line', construction: false, startPointId: 'vertex', endPointId: 'a' },
      { id: 'line-b', kind: 'line', construction: false, startPointId: 'b', endPointId: 'vertex' }], relations: [] }) };
}
function ids() { let next = 0; return () => `corner-${++next}`; }

describe('native graph corner dimension layout', () => {
  it('attaches a radial leader to the actual fillet arc and retains the exact radius driver', () => {
    const { graph } = createCadSketchCornerTreatment({ graph: corner().graph, parameters: { diameter: 4 }, pointId: 'vertex',
      treatment: { kind: 'fillet', radius: ' diameter / 2 ' }, createId: ids() }), before = JSON.stringify(graph);
    const layouts = layoutCadSketchGraphDimensions(graph, { diameter: 4 }, .1);
    expect(layouts).toHaveLength(1); const layout = layouts[0];
    expect(layout.kind).toBe('radius'); expect(layout.relation).toBe(graph.relations[0]); expect(layout.valueMm).toBe(2);
    expect(layout.line[0]).toEqual([expect.closeTo(2, 12), expect.closeTo(2, 12)]);
    expect(layout.arrows).toHaveLength(1); const tip = layout.arrows[0][0];
    expect(tip).toEqual([expect.closeTo(2 - Math.SQRT2, 12), expect.closeTo(2 - Math.SQRT2, 12)]);
    expect(Math.hypot(tip[0] - 2, tip[1] - 2)).toBeCloseTo(2, 12);
    expect((layout.label[0] - tip[0]) * (tip[1] - 2) - (layout.label[1] - tip[1]) * (tip[0] - 2)).toBeCloseTo(0, 12);
    expect((layout.label[0] - tip[0]) * (tip[0] - 2) + (layout.label[1] - tip[1]) * (tip[1] - 2)).toBeGreaterThan(0);
    expect(layout.extensions).toEqual([]); expect(JSON.stringify(graph)).toBe(before);
  });

  it('keeps radial attachment and leader geometry stable under rotated supports and reversed arc traversal', () => {
    const { graph: source, rotate } = corner(Math.PI / 6);
    const { graph } = createCadSketchCornerTreatment({ graph: source, parameters: {}, pointId: 'vertex', treatment: { kind: 'fillet', radius: 2 }, createId: ids() });
    const reversed = parseCadSketchGraph({ ...graph, points: [...graph.points].reverse(), entities: [...graph.entities].reverse().map(entity => entity.kind === 'arc'
      ? { ...entity, startPointId: entity.endPointId, endPointId: entity.startPointId, direction: entity.direction === 'cw' ? 'ccw' : 'cw' } : entity) });
    const first = layoutCadSketchGraphDimensions(graph, {}, .1)[0], second = layoutCadSketchGraphDimensions(reversed, {}, .1)[0];
    const expected = rotate([2 - Math.SQRT2, 2 - Math.SQRT2]);
    expect(first.arrows[0][0]).toEqual([expect.closeTo(expected[0], 12), expect.closeTo(expected[1], 12)]);
    for (const axis of [0, 1]) { expect(second.arrows[0][0][axis]).toBeCloseTo(first.arrows[0][0][axis], 12); expect(second.label[axis]).toBeCloseTo(first.label[axis], 12); }
  });

  it.each([3 * Math.PI / 4, 3 * Math.PI / 4 + .015, 0])('keeps the radius arrow outside the actual label rectangle at support rotation %s', angle => {
    const { graph } = createCadSketchCornerTreatment({ graph: corner(angle).graph, parameters: {}, pointId: 'vertex',
      treatment: { kind: 'fillet', radius: 3 }, createId: ids() });
    const scale = .1, layout = layoutCadSketchGraphDimensions(graph, {}, scale)[0], tip = layout.arrows[0][0];
    const { width, height } = cadSketchGraphDimensionLabel(layout.valueMm, layout.kind);
    const labelDelta = [(layout.label[0] - tip[0]) / scale, (layout.label[1] - tip[1]) / scale];
    expect(Math.abs(labelDelta[0]) < width / 2 && Math.abs(labelDelta[1]) < height / 2).toBe(false);
    const radius = Math.hypot(tip[0] - layout.line[0][0], tip[1] - layout.line[0][1]);
    const ux = (tip[0] - layout.line[0][0]) / radius, uy = (tip[1] - layout.line[0][1]) / radius;
    const projectedHalfBox = Math.abs(ux) * width / 2 + Math.abs(uy) * height / 2;
    expect(Math.hypot(...labelDelta)).toBeCloseTo(projectedHalfBox + 8, 11);
  });

  it('dimensions each chamfer setback against the retained vertex and its own canonical source line', () => {
    const { graph } = createCadSketchCornerTreatment({ graph: corner().graph, parameters: { first: 2, second: 3 }, pointId: 'vertex',
      treatment: { kind: 'chamfer', setbacks: [' first ', 'second'] }, createId: ids() }), before = JSON.stringify(graph);
    const layouts = layoutCadSketchGraphDimensions(graph, { first: 2, second: 3 }, .1);
    expect(layouts).toHaveLength(2);
    expect(layouts).toMatchObject([{ kind: 'setback', side: 0, lineId: 'line-a', valueMm: 2, line: [[0, -2], [2, -2]], label: [1, -2] },
      { kind: 'setback', side: 1, lineId: 'line-b', valueMm: 3, line: [[-2, 0], [-2, 3]], label: [-2, 1.5] }]);
    for (const layout of layouts) { expect(layout.relation).toBe(graph.relations[0]); expect(layout.arrows.map(arrow => arrow[0])).toEqual(layout.line); }
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('retains chamfer side/driver identity when rotated source lines and the chamfer are reversed', () => {
    const { graph: source, rotate } = corner(Math.PI / 3);
    const { graph } = createCadSketchCornerTreatment({ graph: source, parameters: { a: 2, b: 3 }, pointId: 'vertex', treatment: { kind: 'chamfer', setbacks: [' a ', ' b '] }, createId: ids() });
    const reversed = parseCadSketchGraph({ ...graph, entities: [...graph.entities].reverse().map(entity => entity.kind === 'line'
      ? { ...entity, startPointId: entity.endPointId, endPointId: entity.startPointId } : entity) });
    const layouts = layoutCadSketchGraphDimensions(reversed, { a: 2, b: 3 }, .1);
    for (const [side, expectedLabel] of [[0, rotate([1, -2])], [1, rotate([-2, 1.5])]] as const) {
      const layout = layouts[side]; expect(layout.kind).toBe('setback');
      if (layout.kind !== 'setback') throw new Error('Expected setback');
      expect(layout.side).toBe(side); expect(layout.lineId).toBe(side === 0 ? 'line-a' : 'line-b');
      expect(layout.valueMm).toBe(side === 0 ? 2 : 3);
      expect(layout.label).toEqual([expect.closeTo(expectedLabel[0], 12), expect.closeTo(expectedLabel[1], 12)]);
    }
    expect(layouts[0].relation).toMatchObject({ values: [' a ', ' b '] });
  });
});
