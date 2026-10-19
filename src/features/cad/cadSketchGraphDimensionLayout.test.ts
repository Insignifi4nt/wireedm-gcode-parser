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

describe('declared angular dimension layout', () => {
  it.each(['ccw', 'cw'] as const)('draws the saved %s obtuse sector with tangent arrowheads and a degree-valued label', sense => {
    const sign = sense === 'ccw' ? 1 : -1;
    const graph = parseCadSketchGraph({ points: [{ id: 'v', position: [' 0 ', '0'] }, { id: 'a', position: [10, 0] },
      { id: 'b', position: [-5, sign * Math.sqrt(75)] }], entities: [
      { id: 'incoming', kind: 'line', construction: false, startPointId: 'a', endPointId: 'v' },
      { id: 'outgoing', kind: 'line', construction: true, startPointId: 'v', endPointId: 'b' }
    ], relations: [{ id: 'corner', kind: 'line-angle', rays: [{ lineId: 'incoming', towardPointId: 'a' },
      { lineId: 'outgoing', towardPointId: 'b' }], sense, value: ' cornerAngle ' }] });
    const before = JSON.stringify(graph), dimension = layoutCadSketchGraphDimensions(graph, { cornerAngle: 120 }, .1)[0];
    if (dimension?.kind !== 'angle') throw new Error('Angular annotation missing.');
    expect(dimension.valueDegrees).toBe(120); expect(dimension.relation).toBe(graph.relations[0]);
    expect(dimension.arc.clockwise).toBe(sense === 'cw'); expect(dimension.arc.center).toEqual([0, 0]);
    expect(dimension.arc.start[1]).toBeCloseTo(0, 12); expect(dimension.arc.end[0]).toBeCloseTo(-dimension.arc.radius / 2, 12);
    expect(dimension.label[0]).toBeGreaterThan(0); expect(dimension.label[1] * sign).toBeGreaterThan(0);
    for (const [index, arrow] of dimension.arrows.entries()) {
      const tip = index === 0 ? dimension.arc.start : dimension.arc.end;
      expect(arrow[0]).toEqual(tip);
      const radial = [tip[0], tip[1]], base = [(arrow[1][0] + arrow[2][0]) / 2 - tip[0], (arrow[1][1] + arrow[2][1]) / 2 - tip[1]];
      expect(radial[0] * base[0] + radial[1] * base[1]).toBeCloseTo(0, 12);
      expect((radial[0] * base[1] - radial[1] * base[0]) * sign * (index === 0 ? 1 : -1)).toBeGreaterThan(0);
    }
    expect(cadSketchGraphDimensionLabel(dimension.valueDegrees, 'angle').quantity).toBe('120°');
    expect(JSON.stringify(graph)).toBe(before);
  });
});
function linearDimensions(...args: Parameters<typeof layoutCadSketchGraphDimensions>) {
  return layoutCadSketchGraphDimensions(...args).map(layout => {
    if (layout.kind === 'angle') throw new Error('Expected a linear dimension.');
    return layout;
  });
}

describe('signed graph axis dimension layout', () => {
  it.each(['x', 'y'] as const)('separates nested %s dimension lines in screen space without changing their operands or geometry attachments', axis => {
    const horizontal=axis==='x', graph=parseCadSketchGraph({ points:[{id:'a',position:[0,0]},{id:'b',position:[50,0]},{id:'c',position:[50,25]},{id:'d',position:[0,25]},{id:'hole',position:[25,12.5]}], entities:[],relations:[
      {id:'overall',kind:'distance',pointIds:horizontal?['a','b']:['d','a'],value:horizontal?50:25},
      {id:'bore',kind:'axis-distance',pointIds:['a','hole'],axis,value:horizontal?25:12.5}
    ]}), exact=JSON.stringify(graph);
    for(const scale of [.1,1]) {
      const layouts=linearDimensions(graph,{},scale), overall=layouts[0], bore=layouts[1], perpendicular=horizontal?1:0;
      const gap=Math.abs(overall.label[perpendicular]-bore.label[perpendicular])/scale;
      const outerBox=cadSketchGraphDimensionLabel(overall.valueMm,overall.kind), innerBox=cadSketchGraphDimensionLabel(bore.valueMm,bore.kind);
      // ISO text runs along both lines, so each strip is its line plus the lifted text height.
      expect(gap).toBeGreaterThanOrEqual((outerBox.height+innerBox.height)/2+2+8-1e-9);
      expect(overall.label[perpendicular]).toBeLessThan(bore.label[perpendicular]);
      expect(overall.relation).toBe(graph.relations[0]); expect(bore.relation).toBe(graph.relations[1]);
      for(const layout of layouts) {
        expect(layout.arrows.map(arrow=>arrow[0])).toEqual(layout.line);
        for(let index=0;index<2;index++)expect(layout.extensions[index][1][perpendicular]-layout.line[index][perpendicular]).toBeCloseTo(-2*scale,12);
      }
      const reversed=linearDimensions({...graph,relations:[...graph.relations].reverse()},{},scale);
      expect(reversed.map(l=>[l.relation.id,l.line,l.label]).reverse()).toEqual(layouts.map(l=>[l.relation.id,l.line,l.label]));
    }
    expect(JSON.stringify(graph)).toBe(exact);
  });

  it.each(['x', 'y'] as const)('projects %s guides orthogonally outward without changing side or source identity when operands reverse', axis => {
    for (const outside of [[100, 100], [-100, -100]]) {
      const graph = parseCadSketchGraph({ points: [{ id: 'from', position: [30, 20] }, { id: 'to', position: [0, 40] },
        { id: 'extent', position: outside }], entities: [],
        relations: [{ id: 'offset', kind: 'axis-distance', pointIds: ['from', 'to'], axis, value: ' signed ' }] });
      const before = JSON.stringify(graph), signed = axis === 'x' ? -30 : 20;
      const layout = linearDimensions(graph, { signed }, .1)[0];
      expect(layout?.kind).toBe(axis === 'x' ? 'distance-x' : 'distance-y');
      const positiveSide = outside[0] < 0;
      // Text sits above the line; when that side faces the part the line moves out a further eight pixels.
      expect(layout.line).toEqual(axis === 'x' ? [[30, positiveSide ? 42 : 17.2], [0, positiveSide ? 42 : 17.2]]
        : [[positiveSide ? 32.8 : -2, 20], [positiveSide ? 32.8 : -2, 40]]);
      expect(layout.extensions).toEqual(axis === 'x'
        ? [[[30, expect.closeTo(positiveSide ? 20.3 : 19.7, 12)], [30, expect.closeTo(positiveSide ? 42.2 : 17, 12)]],
          [[0, expect.closeTo(positiveSide ? 40.3 : 39.7, 12)], [0, expect.closeTo(positiveSide ? 42.2 : 17, 12)]]]
        : [[[expect.closeTo(positiveSide ? 30.3 : 29.7, 12), 20], [expect.closeTo(positiveSide ? 33 : -2.2, 12), 20]],
          [[expect.closeTo(positiveSide ? .3 : -.3, 12), 40], [expect.closeTo(positiveSide ? 33 : -2.2, 12), 40]]]);
      expect(layout.valueMm).toBe(signed); expect(layout.relation).toBe(graph.relations[0]);
      expect(layout.arrows.map(arrow => arrow[0])).toEqual(layout.line);
      for (const [index, extension] of layout.extensions.entries()) {
        expect(extension[0][axis === 'x' ? 0 : 1]).toBe(extension[1][axis === 'x' ? 0 : 1]);
        expect(layout.line[index][axis === 'x' ? 0 : 1]).toBe(extension[0][axis === 'x' ? 0 : 1]);
      }
      for (const arrow of layout.arrows) for (const base of arrow.slice(1)) {
        expect(base[axis === 'x' ? 0 : 1]).toBeGreaterThan(axis === 'x' ? 0 : 20);
        expect(base[axis === 'x' ? 0 : 1]).toBeLessThan(axis === 'x' ? 30 : 40);
      }
      const reversed = linearDimensions(parseCadSketchGraph({ ...graph,
        relations: [{ id: 'offset', kind: 'axis-distance', pointIds: ['to', 'from'], axis, value: ' -signed ' }] }), { signed }, .1)[0];
      expect(reversed.line).toEqual([...layout.line].reverse()); expect(reversed.label).toEqual(layout.label);
      expect(reversed.arrows).toEqual([...layout.arrows].reverse()); expect(reversed.valueMm).toBe(-signed);
      expect(JSON.stringify(graph)).toBe(before);
    }
  });
  it.each(['x', 'y'] as const)('keeps a zero %s driver editable with finite guides and no zero-span arrows while retaining tiny nonzero source values', axis => {
    const graph = parseCadSketchGraph({ points: [{ id: 'from', position: [0, 0] },
      { id: 'to', position: axis === 'x' ? [0, 10] : [10, 0] }], entities: [],
      relations: [{ id: 'zero', kind: 'axis-distance', pointIds: ['from', 'to'], axis, value: ' zero ' }] });
    const layout = linearDimensions(graph, { zero: 0 }, .1)[0];
    expect(layout).toBeDefined(); expect(layout.relation).toBe(graph.relations[0]); expect(layout.valueMm).toBe(0);
    expect(layout.label).toEqual(axis === 'x' ? [0, expect.closeTo(-1.7, 12)] : [expect.closeTo(11.7, 12), 0]);
    expect(layout.line[0]).toEqual(layout.line[1]); expect(layout.extensions).toHaveLength(2); expect(layout.arrows).toEqual([]);
    expect([...layout.label, ...layout.line.flat(), ...layout.extensions.flat(2)].every(Number.isFinite)).toBe(true);
    const tiny = linearDimensions(parseCadSketchGraph({ ...graph,
      points: [graph.points[0], { id: 'to', position: axis === 'x' ? [1e-9, 10] : [10, 1e-9] }],
      relations: [{ id: 'tiny', kind: 'axis-distance', pointIds: ['from', 'to'], axis, value: ' small ' }] }), { small: 1e-9 }, .1)[0];
    expect(tiny.valueMm).toBe(1e-9); expect(tiny.arrows).toHaveLength(2);
    expect(cadSketchGraphDimensionLabel(tiny.valueMm, tiny.kind).quantity).not.toBe('0 mm');
  });
});

describe('explicit graph distance layout', () => {
  it('separates translated nested oblique dimensions using their actual parallel lines', () => {
    const graph=parseCadSketchGraph({points:[{id:'a',position:[1e8,1e8]},{id:'b',position:[1e8+30,1e8+40]},{id:'c',position:[1e8+15,1e8+20]}],entities:[],relations:[
      {id:'overall',kind:'distance',pointIds:['a','b'],value:50},{id:'short',kind:'distance',pointIds:['a','c'],value:25}
    ]});
    const [overall,short]=linearDimensions(graph,{},.1), gap=((overall.line[0][0]-short.line[0][0])*.8-(overall.line[0][1]-short.line[0][1])*.6)/.1;
    expect(gap).toBeGreaterThanOrEqual(18+2+8-1e-6);
    expect(overall.extensions[0][0]).toEqual(short.extensions[0][0]);
    expect(overall.arrows.map(arrow=>arrow[0])).toEqual(overall.line);
  });

  it('leaves separated projected spans and nonparallel annotations at their original geometric offsets', () => {
    const graph=parseCadSketchGraph({points:[{id:'a',position:[0,0]},{id:'b',position:[10,0]},{id:'c',position:[100,0]},{id:'d',position:[110,0]},{id:'e',position:[20,20]}],entities:[],relations:[
      {id:'near',kind:'distance',pointIds:['a','b'],value:10},{id:'far',kind:'distance',pointIds:['c','d'],value:10},{id:'oblique',kind:'distance',pointIds:['b','e'],value:Math.sqrt(500)}
    ]});
    const together=linearDimensions(graph,{},.1);
    graph.relations.forEach((relation,index)=>expect(together[index]).toEqual(linearDimensions({...graph,relations:[relation]},{},.1)[0]));
  });

  it('places bottom, top and vertical dimensions twenty screen pixels outward, or twenty-eight when their text faces the part', () => {
    const graph = rectangle(), before = JSON.stringify(graph);
    const layouts = linearDimensions(graph, { width: 20 }, .1);
    expect(layouts.map(layout => layout.line)).toEqual([
      [[0, expect.closeTo(-2.8, 12)], [20, expect.closeTo(-2.8, 12)]], [[0, 12], [20, 12]], [[-2, 0], [-2, 10]], [[expect.closeTo(22.8, 12), 0], [expect.closeTo(22.8, 12), 10]]
    ]);
    expect(layouts[0].extensions).toEqual([[[0, expect.closeTo(-.3, 12)], [0, expect.closeTo(-3, 12)]], [[20, expect.closeTo(-.3, 12)], [20, expect.closeTo(-3, 12)]]]);
    // ISO 129: text is parallel to its line, readable from the bottom or right, and never crosses the line.
    expect(layouts.map(layout => layout.labelAngle)).toEqual([0, 0, Math.PI / 2, Math.PI / 2]);
    for (const layout of layouts) {
      const { height } = cadSketchGraphDimensionLabel(layout.valueMm, layout.kind), vertical = layout.labelAngle !== 0;
      const fromLine = (layout.label[vertical ? 0 : 1] - layout.line[0][vertical ? 0 : 1]) / .1;
      expect(Math.abs(fromLine)).toBeCloseTo(height / 2 + 2, 12);
      expect(Math.sign(fromLine)).toBe(vertical ? -1 : 1);
    }
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
      const first = linearDimensions(graph, {}, .1)[0];
      const reversed = linearDimensions(parseCadSketchGraph({ ...graph,
        relations: [{ id: 'length', kind: 'distance', pointIds: ['b', 'a'], value: 10 }] }), {}, .1)[0];
      expect(reversed.line).toEqual([...first.line].reverse()); expect(reversed.label).toEqual(first.label);
      expect(reversed.arrows).toEqual([...first.arrows].reverse());
      expect(first.label).toEqual(end[0] ? [5, expect.closeTo(-1.7, 12)] : [expect.closeTo(1.7, 12), 5]);
    }
  });

  it('keeps oblique arrow tips on their guides with bases inside the measured span', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [3, 4] }], entities: [],
      relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 5 }] });
    const layout = linearDimensions(graph, {}, .1)[0];
    expect(layout.line).toEqual([[expect.closeTo(2.24, 12), expect.closeTo(-1.68, 12)], [expect.closeTo(5.24, 12), expect.closeTo(2.32, 12)]]);
    expect(layout.label).toEqual([expect.closeTo(2.86, 12), expect.closeTo(.98, 12)]);
    expect(layout.labelAngle).toBeCloseTo(Math.atan2(4, 3), 12);
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
    const result = linearDimensions(graph, { size: 1e-9 }, 1e-10);
    expect(result).toHaveLength(1); expect(result[0].relation.id).toBe('small'); expect(result[0].valueMm).toBe(1e-9);
    expect(result[0].label[0]).toBeCloseTo(1.5e-9, 22); expect(result[0].label[1]).toBeCloseTo(3e-10, 22);
    expect(linearDimensions(parseCadSketchGraph({ ...graph, relations: [] }), {}, 1)).toEqual([]);
    expect(linearDimensions(graph, { size: 1e-9 }, 0)).toEqual([]);
  });

  it('uses the actual major-arc bounds for the outward side at a far origin', () => {
    const graph = parseCadSketchGraph({ points: [
      { id: 'a', position: [99999998, 100000012] }, { id: 'b', position: [100000002, 100000012] },
      { id: 'center', position: [100000000, 100000010] }, { id: 'start', position: [100000010, 100000010] }, { id: 'end', position: [100000000, 100000020] }
    ], entities: [{ id: 'major-arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' }],
    relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 4 }] });
    const result = linearDimensions(graph, {}, .1)[0];
    // The major sweep reaches y=100000000. Point-only bounds would choose the wrong side.
    expect(result.line).toEqual([[99999998, 100000014], [100000002, 100000014]]);
    expect(result.label).toEqual([100000000, expect.closeTo(100000015.1, 6)]);
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
  it('attaches explicit circle and signed major-arc dimensions to their actual curve supports', () => {
    const source = parseCadSketchGraph({ points: [{ id: 'origin', position: [0, 0] }, { id: 'center', position: [10, 20] },
      { id: 'start', position: [5, 0] }, { id: 'end', position: [0, 5] }], entities: [
      { id: 'circle', kind: 'circle', centerPointId: 'center', radius: 5, construction: false },
      { id: 'arc', kind: 'arc', centerPointId: 'origin', startPointId: 'start', endPointId: 'end', direction: 'cw', construction: false }
    ], relations: [{ id: 'diameter', kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value: ' size * 2 ' },
      { id: 'radius', kind: 'radial-size', entityId: 'arc', quantity: 'radius', value: ' size ' }] });
    const layouts = linearDimensions(source, { size: 5 }, .1);
    expect(layouts).toMatchObject([{ kind: 'diameter', valueMm: 10 }, { kind: 'radius', valueMm: 5 }]);
    expect(layouts[0].arrows[0][0]).toEqual([expect.closeTo(13.535533905932738, 12), expect.closeTo(23.535533905932738, 12)]);
    expect(layouts[1].arrows[0][0]).toEqual([expect.closeTo(-3.5355339059327373, 12), expect.closeTo(-3.5355339059327378, 12)]);
    expect(layouts.map(layout => layout.relation)).toEqual(source.relations);
    const reversed = parseCadSketchGraph({ ...source, entities: source.entities.map(entity => entity.kind === 'arc'
      ? { ...entity, startPointId: 'end', endPointId: 'start', direction: 'ccw' } : entity) });
    const second = linearDimensions(reversed, { size: 5 }, .1)[1];
    expect(second.arrows[0][0][0]).toBeCloseTo(layouts[1].arrows[0][0][0], 12);
    expect(second.arrows[0][0][1]).toBeCloseTo(layouts[1].arrows[0][0][1], 12);
  });

  it('attaches a radial leader to the actual fillet arc and retains the exact radius driver', () => {
    const { graph } = createCadSketchCornerTreatment({ graph: corner().graph, parameters: { diameter: 4 }, pointId: 'vertex',
      treatment: { kind: 'fillet', radius: ' diameter / 2 ' }, createId: ids() }), before = JSON.stringify(graph);
    const layouts = linearDimensions(graph, { diameter: 4 }, .1);
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
    const first = linearDimensions(graph, {}, .1)[0], second = linearDimensions(reversed, {}, .1)[0];
    const expected = rotate([2 - Math.SQRT2, 2 - Math.SQRT2]);
    expect(first.arrows[0][0]).toEqual([expect.closeTo(expected[0], 12), expect.closeTo(expected[1], 12)]);
    for (const axis of [0, 1]) { expect(second.arrows[0][0][axis]).toBeCloseTo(first.arrows[0][0][axis], 12); expect(second.label[axis]).toBeCloseTo(first.label[axis], 12); }
  });

  it.each([3 * Math.PI / 4, 3 * Math.PI / 4 + .015, 0])('keeps the radius arrow outside the actual label rectangle at support rotation %s', angle => {
    const { graph } = createCadSketchCornerTreatment({ graph: corner(angle).graph, parameters: {}, pointId: 'vertex',
      treatment: { kind: 'fillet', radius: 3 }, createId: ids() });
    const scale = .1, layout = linearDimensions(graph, {}, scale)[0], tip = layout.arrows[0][0];
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
    const layouts = linearDimensions(graph, { first: 2, second: 3 }, .1);
    expect(layouts).toHaveLength(2);
    expect(layouts).toMatchObject([{ kind: 'setback', side: 0, lineId: 'line-a', valueMm: 2, line: [[0, expect.closeTo(-2.8, 12)], [2, expect.closeTo(-2.8, 12)]], label: [1, expect.closeTo(-1.7, 12)] },
      { kind: 'setback', side: 1, lineId: 'line-b', valueMm: 3, line: [[-2, 0], [-2, 3]], label: [expect.closeTo(-3.1, 12), 1.5] }]);
    for (const layout of layouts) { expect(layout.relation).toBe(graph.relations[0]); expect(layout.arrows.map(arrow => arrow[0])).toEqual(layout.line); }
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('retains chamfer side/driver identity when rotated source lines and the chamfer are reversed', () => {
    const { graph: source, rotate } = corner(Math.PI / 3);
    const { graph } = createCadSketchCornerTreatment({ graph: source, parameters: { a: 2, b: 3 }, pointId: 'vertex', treatment: { kind: 'chamfer', setbacks: [' a ', ' b '] }, createId: ids() });
    const reversed = parseCadSketchGraph({ ...graph, entities: [...graph.entities].reverse().map(entity => entity.kind === 'line'
      ? { ...entity, startPointId: entity.endPointId, endPointId: entity.startPointId } : entity) });
    const layouts = linearDimensions(reversed, { a: 2, b: 3 }, .1);
    // Rotating the corner flips the second line's reading direction, so its text and line move to the other side.
    for (const [side, expectedLabel] of [[0, rotate([1, -1.7])], [1, rotate([-1.7, 1.5])]] as const) {
      const layout = layouts[side]; expect(layout.kind).toBe('setback');
      if (layout.kind !== 'setback') throw new Error('Expected setback');
      expect(layout.side).toBe(side); expect(layout.lineId).toBe(side === 0 ? 'line-a' : 'line-b');
      expect(layout.valueMm).toBe(side === 0 ? 2 : 3);
      expect(layout.label).toEqual([expect.closeTo(expectedLabel[0], 12), expect.closeTo(expectedLabel[1], 12)]);
    }
    expect(layouts[0].relation).toMatchObject({ values: [' a ', ' b '] });
  });
});


describe('saved reference annotation geometry', () => {
  it('uses current support measurements, actual reference records and truthful zero-distance arrows', () => {
    const graph=parseCadSketchGraph({points:[{id:'a',position:[0,0]},{id:'b',position:['span',10]},{id:'o',position:[40,0]},{id:'same',position:[0,0]}],
      entities:[{id:'line',kind:'line',startPointId:'a',endPointId:'b',construction:false},{id:'circle',kind:'circle',centerPointId:'o',radius:'bore / 2',construction:false}],
      relations:[{id:'length',kind:'reference-dimension',measurement:{kind:'line-length',entityId:'line'}},
        {id:'diameter',kind:'reference-dimension',measurement:{kind:'radial-size',entityId:'circle',quantity:'diameter'}},
        {id:'zero',kind:'reference-dimension',measurement:{kind:'point-distance',pointIds:['a','same']}}]});
    const exact=JSON.stringify(graph), layouts=linearDimensions(graph,{span:10,bore:6},.1);
    expect(layouts.map(d=>[d.kind,d.valueMm,d.relation])).toEqual([['distance',Math.sqrt(200),graph.relations[0]],['diameter',6,graph.relations[1]],['distance',0,graph.relations[2]]]);
    expect(layouts[2].arrows).toEqual([]);
    expect(linearDimensions(graph,{span:20,bore:8},.1).map(d=>d.valueMm)).toEqual([Math.sqrt(500),8,0]);
    expect(JSON.stringify(graph)).toBe(exact);
  });
});
