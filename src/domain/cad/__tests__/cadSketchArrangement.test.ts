import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { deriveCadSketchArrangement } from '../cadSketchArrangement';
import { prepareCadSketchTrim } from '../cadSketchTrimExtend';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import { classifyPathSegmentIntersection } from '@/domain/path-intel/intersections';

const rectangle = (divider: number | string = 5) => ({
  points: [
    { id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] },
    { id: 'c', position: [10, 10] }, { id: 'd', position: [0, 10] },
    { id: 'low', position: [divider, -2] }, { id: 'high', position: [divider, 12] }
  ],
  entities: [
    { id: 'bottom', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
    { id: 'right', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
    { id: 'top', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
    { id: 'left', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' },
    { id: 'divider', kind: 'line', construction: false, startPointId: 'low', endPointId: 'high' }
  ], relations: []
});

describe('analytic sketch arrangement', () => {
  it('rejects a distinct near-end crossing instead of welding it to a declared endpoint', () => {
    const result = deriveCadSketchArrangement(parseCadSketchGraph({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [-1, 1] },
        { id: 'near-low', position: [6e-14, -0.1] }, { id: 'near-high', position: [6e-14, 0.1] }],
      entities: [{ id: 'bottom', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
        { id: 'joint-edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'c' },
        { id: 'near-divider', kind: 'line', construction: false, startPointId: 'near-low', endPointId: 'near-high' }], relations: []
    }), {});
    expect(result.cells).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'precision' }));
  });

  it('does not discard a second circular root merely because it is close to the declared joint', () => {
    const origin = 1e6, radius = 0.00001, delta = 1e-9;
    const graph = parseCadSketchGraph({ points: [
      { id: 'joint', position: [origin, origin] },
      { id: 'upper-center', position: [origin, origin + radius] },
      { id: 'upper-end', position: [origin + radius, origin + radius] },
      { id: 'lower-center', position: [origin + delta, origin - radius] },
      { id: 'lower-end', position: [origin + delta + radius, origin - radius] }
    ], entities: [
      { id: 'upper', kind: 'arc', construction: false, centerPointId: 'upper-center', startPointId: 'joint', endPointId: 'upper-end', direction: 'ccw' },
      { id: 'lower', kind: 'arc', construction: false, centerPointId: 'lower-center', startPointId: 'joint', endPointId: 'lower-end', direction: 'cw' }
    ], relations: [] });
    const supports = compileCadSketchGraph(graph, {}).segments;
    expect(classifyPathSegmentIntersection(supports[0], supports[1], 0).points).toHaveLength(2);
    const result = deriveCadSketchArrangement(graph, {});
    expect(result.cells).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'precision' }));
  });

  it('extracts two bounded cells from an intersecting divider and removes its open tails', () => {
    const graph = parseCadSketchGraph(rectangle()), before = JSON.stringify(graph);
    const result = deriveCadSketchArrangement(graph, {});
    expect(result.issues).toEqual([]);
    expect(result.cells.map(cell => cell.area).sort((a, b) => a - b)).toEqual([50, 50]);
    const dividerRefs = result.cells.flatMap(cell => cell.outer.sourceRefs.filter(ref => ref.entityId === 'divider'));
    expect(dividerRefs).toHaveLength(2);
    expect(dividerRefs[0].from).toBe(dividerRefs[1].to);
    expect(dividerRefs[0].to).toBe(dividerRefs[1].from);
    expect(Math.min(dividerRefs[0].from, dividerRefs[0].to)).toBeCloseTo(1 / 7, 14);
    expect(Math.max(dividerRefs[0].from, dividerRefs[0].to)).toBeCloseTo(6 / 7, 14);
    expect(result.cells.every(cell => cell.holes.length === 0 && cell.outer.path.length === 4)).toBe(true);
    expect(Object.isFrozen(result.cells[0].outer.sourceRefs[0])).toBe(true);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('keeps selected sides through divider dimensions and source reorder, but invalidates a source split', () => {
    const raw = rectangle('width'), graph = parseCadSketchGraph(raw);
    const first = deriveCadSketchArrangement(graph, { width: 5 });
    const moved = deriveCadSketchArrangement(graph, { width: 3 });
    expect(moved.issues).toEqual([]);
    const left = first.cells.find(cell => cell.outer.sourceRefs.some(ref => ref.entityId === 'left'));
    const movedLeft = moved.cells.find(cell => cell.key === left?.key);
    expect(left).toBeDefined(); expect(movedLeft?.area).toBe(30);
    expect(movedLeft?.geometryKey).not.toBe(left?.geometryKey);
    const reordered = deriveCadSketchArrangement(parseCadSketchGraph({ ...raw, points: [...raw.points].reverse(), entities: [...raw.entities].reverse() }), { width: 3 });
    expect(reordered).toEqual(moved);
    const split = deriveCadSketchArrangement(parseCadSketchGraph({ ...raw,
      points: [...raw.points, { id: 'middle', position: ['width', 5] }],
      entities: [...raw.entities.filter(entity => entity.id !== 'divider'),
        { id: 'divider-low', kind: 'line', construction: false, startPointId: 'low', endPointId: 'middle' },
        { id: 'divider-high', kind: 'line', construction: false, startPointId: 'middle', endPointId: 'high' }]
    }), { width: 3 });
    expect(split.issues).toEqual([]); expect(split.cells.map(cell => cell.area).sort((a, b) => a - b)).toEqual([30, 70]);
    expect(split.cells.some(cell => first.cells.some(previous => previous.key === cell.key))).toBe(false);
    expect(graph.points.find(point => point.id === 'low')?.position[0]).toBe('width');
  });

  it('derives the exact three circle cells, retaining analytic arc subranges and branch identity', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: ['separation', 0] }], entities: [
      { id: 'circle-a', kind: 'circle', construction: false, centerPointId: 'a', radius: 5 },
      { id: 'circle-b', kind: 'circle', construction: false, centerPointId: 'b', radius: 5 }
    ], relations: [] });
    const result = deriveCadSketchArrangement(graph, { separation: 6 });
    expect(result.issues).toEqual([]); expect(result.cells).toHaveLength(3);
    const areas = result.cells.map(cell => cell.area).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(22.36476090008061, 10);
    expect(areas[1]).toBeCloseTo(56.17505543966422, 10); expect(areas[2]).toBeCloseTo(56.17505543966422, 10);
    expect(result.cells.every(cell => cell.outer.path.every(segment => segment.kind === 'arc') && cell.holes.length === 0)).toBe(true);
    expect(result.cells.flatMap(cell => cell.outer.sourceRefs).some(ref => ref.from > 1 || ref.to > 1)).toBe(true);
    const moved = deriveCadSketchArrangement(graph, { separation: 7 });
    expect(moved.issues).toEqual([]);
    expect(moved.cells.map(cell => cell.key)).toEqual(result.cells.map(cell => cell.key));
    expect(moved.cells.map(cell => cell.geometryKey)).not.toEqual(result.cells.map(cell => cell.geometryKey));
  });

  it('assigns nested holes to the immediately containing cell and excludes construction geometry', () => {
    const result = deriveCadSketchArrangement(parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }], entities: [
      ...[10, 6, 2].map(radius => ({ id: `circle-${radius}`, kind: 'circle', construction: false, centerPointId: 'center', radius })),
      { id: 'reference', kind: 'circle', construction: true, centerPointId: 'center', radius: 8 }
    ], relations: [] }), {});
    expect(result.issues).toEqual([]); expect(result.cells).toHaveLength(3);
    const cells = [...result.cells].sort((a, b) => a.area - b.area);
    expect(cells[0].area).toBeCloseTo(12.566370614359172, 11);
    expect(cells[1].area).toBeCloseTo(100.53096491487338, 11);
    expect(cells[2].area).toBeCloseTo(201.06192982974676, 11);
    expect(cells.map(cell => cell.holes.length)).toEqual([0, 1, 1]);
    expect(cells[1].holes[0].sourceRefs[0].entityId).toBe('circle-2');
    expect(cells[2].holes[0].sourceRefs[0].entityId).toBe('circle-6');
    expect(cells[2].holes[0].signedArea).toBeLessThan(0);
    expect(result.cells.flatMap(cell => [cell.outer, ...cell.holes]).flatMap(boundary => boundary.sourceRefs).some(ref => ref.entityId === 'reference')).toBe(false);
  });

  it('nodes an authored clockwise arc against a divider without changing its source traversal', () => {
    const graph = parseCadSketchGraph({ points: [
      { id: 'center', position: [0, 0] }, { id: 'start', position: [-5, 0] }, { id: 'end', position: [5, 0] },
      { id: 'low', position: [0, -2] }, { id: 'high', position: [0, 7] }
    ], entities: [
      { id: 'upper-arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' },
      { id: 'base', kind: 'line', construction: false, startPointId: 'end', endPointId: 'start' },
      { id: 'divider', kind: 'line', construction: false, startPointId: 'low', endPointId: 'high' }
    ], relations: [] });
    const result = deriveCadSketchArrangement(graph, {});
    expect(result.issues).toEqual([]); expect(result.cells).toHaveLength(2);
    for (const cell of result.cells) expect(cell.area).toBeCloseTo(19.634954084936208, 11);
    const arcs = result.cells.flatMap(cell => cell.outer.sourceRefs.filter(ref => ref.entityId === 'upper-arc'));
    expect(arcs).toHaveLength(2); expect(arcs.every(ref => ref.from > ref.to)).toBe(true);
    expect(result.cells.flatMap(cell => cell.outer.path).filter(segment => segment.kind === 'arc').every(segment => segment.sweep === 90)).toBe(true);
    expect(graph.entities[0]).toMatchObject({ kind: 'arc', direction: 'cw', startPointId: 'start', endPointId: 'end' });
  });

  it('clips circular intersections to endpoint arc sweeps and derives the true overlap cell', () => {
    const graph = parseCadSketchGraph({ points: [
      { id: 'center', position: [0, 0] }, { id: 'start', position: [5, 0] }, { id: 'end', position: [-5, 0] },
      { id: 'other-center', position: [3, 0] }
    ], entities: [
      { id: 'upper-arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'ccw' },
      { id: 'base', kind: 'line', construction: false, startPointId: 'end', endPointId: 'start' },
      { id: 'circle', kind: 'circle', construction: false, centerPointId: 'other-center', radius: 4 }
    ], relations: [] });
    const result = deriveCadSketchArrangement(graph, {});
    expect(result.issues).toEqual([]); expect(result.cells).toHaveLength(3);
    // The two full-circle lens halves are symmetric across the baseline.
    const overlapArea = (25 * Math.acos(0.6) + 8 * Math.PI - 12) / 2;
    const areas = result.cells.map(cell => cell.area).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(overlapArea, 10);
    expect(areas[1]).toBeCloseTo(12.5 * Math.PI - overlapArea, 10);
    expect(areas[2]).toBeCloseTo(16 * Math.PI - overlapArea, 10);
  });

  it('treats a rounded tangent contact identically at every sketch position, rotation and radius in cells and trims', () => {
    // Float rounding leaves the line a hair inside, outside or exactly on the circle; none may change the topology.
    for (const offset of [0, 1000, 12345.678, 98765.4321]) for (const degrees of [0, 17, 30, 61]) for (const radius of [5, 0.37]) {
      const t = degrees * Math.PI / 180, c = [offset + 3.21, offset - 1.7], normal = [-Math.sin(t), Math.cos(t)], along = [Math.cos(t), Math.sin(t)];
      const at = (s: number, n: number) => [c[0] + n * normal[0] + s * along[0], c[1] + n * normal[1] + s * along[1]];
      const graph = parseCadSketchGraph({ points: [{ id: 'c', position: c }, { id: 'p', position: at(-4 * radius, radius) },
        { id: 'q', position: at(4 * radius, radius) }, { id: 'r', position: at(4 * radius, -2 * radius) }], entities: [
        { id: 'disk', kind: 'circle', construction: false, centerPointId: 'c', radius },
        { id: 'pq', kind: 'line', construction: false, startPointId: 'p', endPointId: 'q' },
        { id: 'qr', kind: 'line', construction: false, startPointId: 'q', endPointId: 'r' },
        { id: 'rp', kind: 'line', construction: false, startPointId: 'r', endPointId: 'p' }], relations: [] });
      const result = deriveCadSketchArrangement(graph, {});
      expect(result.cells, `${offset} ${degrees}° r${radius}`).toEqual([]);
      expect(result.issues.some(issue => issue.code === 'ambiguous-tangency')).toBe(true);
      expect(() => prepareCadSketchTrim({ graph, parameters: {}, entityId: 'pq', parameter: 0.1 }))
        .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
    }
  });

  it('reports tangent contacts and overlapping source ownership without fabricating cells', () => {
    for (const separation of [10, 2]) {
      const result = deriveCadSketchArrangement(parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [separation, 0] }], entities: [
        { id: 'one', kind: 'circle', construction: false, centerPointId: 'a', radius: 5 },
        { id: 'two', kind: 'circle', construction: false, centerPointId: 'b', radius: separation === 10 ? 5 : 3 }
      ], relations: [] }), {});
      expect(result.cells).toEqual([]); expect(result.issues.some(issue => issue.code === 'ambiguous-tangency')).toBe(true);
    }
    const overlap = deriveCadSketchArrangement(parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }], entities: [
      { id: 'one', kind: 'circle', construction: false, centerPointId: 'a', radius: 5 },
      { id: 'two', kind: 'circle', construction: false, centerPointId: 'a', radius: 5 }
    ], relations: [] }), {});
    expect(overlap.cells).toEqual([]); expect(overlap.issues).toMatchObject([{ code: 'overlap', entityIds: ['one', 'two'] }]);
    const raw = rectangle();
    const lines = deriveCadSketchArrangement(parseCadSketchGraph({ ...raw, entities: [...raw.entities,
      { id: 'duplicate-bottom', kind: 'line', construction: false, startPointId: 'b', endPointId: 'a' }]
    }), {});
    expect(lines.cells).toEqual([]); expect(lines.issues.some(issue => issue.code === 'overlap')).toBe(true);
  });

  it('accepts an unambiguous smooth two-arc joint but leaves an actual boundary gap open', () => {
    const smooth = deriveCadSketchArrangement(parseCadSketchGraph({ points: [
      { id: 'center', position: [0, 0] }, { id: 'a', position: [5, 0] }, { id: 'b', position: [-5, 0] }
    ], entities: [
      { id: 'upper', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'a', endPointId: 'b', direction: 'ccw' },
      { id: 'lower', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'b', endPointId: 'a', direction: 'ccw' }
    ], relations: [] }), {});
    expect(smooth.issues).toEqual([]); expect(smooth.cells).toHaveLength(1);
    expect(smooth.cells[0].area).toBeCloseTo(78.53981633974483, 11);
    const raw = rectangle();
    const gap = deriveCadSketchArrangement(parseCadSketchGraph({ ...raw, points: [...raw.points, { id: 'near', position: [0, 1e-8] }],
      entities: raw.entities.filter(entity => entity.id !== 'divider').map(entity => entity.id === 'left' ? { ...entity, endPointId: 'near' } : entity)
    }), {});
    expect(gap).toMatchObject({ cells: [], issues: [] });
  });

  it('rejects undeclared multiway crossings rather than inventing analytic event equivalence', () => {
    const raw = rectangle();
    const result = deriveCadSketchArrangement(parseCadSketchGraph({ ...raw,
      points: [...raw.points, { id: 'west', position: [-2, 5] }, { id: 'east', position: [12, 5] }],
      entities: [...raw.entities,
        { id: 'horizontal', kind: 'line', construction: false, startPointId: 'west', endPointId: 'east' },
        { id: 'diagonal', kind: 'line', construction: false, startPointId: 'a', endPointId: 'c' }]
    }), {});
    expect(result.cells).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'precision' }));
  });

  it('rejects one hundred concurrent open lines without modifying source identities', () => {
    const points = [], entities = [];
    for (let index = 0; index < 100; index++) {
      const angle = (index + 0.2) * Math.PI / 100;
      points.push({ id: `a${index}`, position: [100 * Math.cos(angle), 100 * Math.sin(angle)] }, { id: `b${index}`, position: [-100 * Math.cos(angle), -100 * Math.sin(angle)] });
      entities.push({ id: `line${index}`, kind: 'line', startPointId: `a${index}`, endPointId: `b${index}`, construction: false });
    }
    const graph = parseCadSketchGraph({ points, entities, relations: [] }), before = JSON.stringify(graph);
    const result = deriveCadSketchArrangement(graph, {});
    expect(result.cells).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'precision' }));
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('invalidates region keys when crossing order changes instead of silently retargeting a side', () => {
    const raw = rectangle('first');
    const graph = parseCadSketchGraph({ ...raw, points: [...raw.points,
      { id: 'low-two', position: ['second', -2] }, { id: 'high-two', position: ['second', 12] }],
    entities: [...raw.entities, { id: 'divider-two', kind: 'line', construction: false, startPointId: 'low-two', endPointId: 'high-two' }] });
    const before = deriveCadSketchArrangement(graph, { first: 3, second: 7 });
    const moved = deriveCadSketchArrangement(graph, { first: 4, second: 8 });
    expect(before.issues).toEqual([]); expect(before.cells).toHaveLength(3);
    expect(moved.cells.map(cell => cell.key)).toEqual(before.cells.map(cell => cell.key));
    const crossed = deriveCadSketchArrangement(graph, { first: 8, second: 2 });
    expect(crossed.issues).toEqual([]); expect(crossed.cells).toHaveLength(3);
    expect(crossed.cells.some(cell => before.cells.some(previous => previous.key === cell.key))).toBe(false);
  });

  it('retains an exact isolated circle even when its far-origin radius is below world-coordinate roundoff', () => {
    const result = deriveCadSketchArrangement(parseCadSketchGraph({ points: [{ id: 'center', position: [1e9, -1e9] }], entities: [
      { id: 'tiny-circle', kind: 'circle', construction: false, centerPointId: 'center', radius: 2e-7 }
    ], relations: [] }), {});
    expect(result.issues).toEqual([]); expect(result.cells).toHaveLength(1);
    expect(result.cells[0].area).toBeCloseTo(1.2566370614359172e-13, 25);
    expect(result.cells[0].outer.path).toEqual([{ kind: 'arc', center: [1e9, -1e9], radius: 2e-7, startAngle: 0, sweep: 360 }]);
  });

  it('reports an unresolved far-origin sliver rather than snapping its divider onto the boundary', () => {
    const raw = rectangle(1e-7);
    const graph = parseCadSketchGraph({ ...raw, points: raw.points.map(point => ({ ...point,
      position: point.position.map(value => Number(value) + 1e8) })) });
    const result = deriveCadSketchArrangement(graph, {});
    expect(result.cells).toEqual([]);
    expect(result.issues.some(issue => issue.code === 'precision')).toBe(true);
  });

  it('prunes a long open polyline without depending on JavaScript recursion depth', () => {
    const result = deriveCadSketchArrangement(parseCadSketchGraph({
      points: Array.from({ length: 5001 }, (_, index) => ({ id: `p${index}`, position: [index, 0] })),
      entities: Array.from({ length: 5000 }, (_, index) => ({ id: `line${index}`, kind: 'line', construction: false, startPointId: `p${index}`, endPointId: `p${index + 1}` })),
      relations: []
    }), {});
    expect(result).toMatchObject({ cells: [], issues: [] });
  });

  it('keeps circle branch topology stable when intersections pass the zero-angle seam', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: ['x', 'y'] }], entities: [
      { id: 'one', kind: 'circle', construction: false, centerPointId: 'a', radius: 5 },
      { id: 'two', kind: 'circle', construction: false, centerPointId: 'b', radius: 5 }
    ], relations: [] });
    const first = deriveCadSketchArrangement(graph, { x: 6, y: 0 });
    for (const degrees of [52, 54, 180, 270, 359]) {
      const angle = degrees * Math.PI / 180;
      const moved = deriveCadSketchArrangement(graph, { x: 6 * Math.cos(angle), y: 6 * Math.sin(angle) });
      expect(moved.issues).toEqual([]);
      expect(moved.cells.map(cell => cell.key)).toEqual(first.cells.map(cell => cell.key));
      expect(moved.cells.map(cell => cell.area).sort((a, b) => a - b)).toEqual(expect.arrayContaining([
        expect.closeTo(22.36476090008061, 10), expect.closeTo(56.17505543966422, 10)
      ]));
    }
  });

  it('removes a bridge between nested boundaries without opening their annular cell', () => {
    const result = deriveCadSketchArrangement(parseCadSketchGraph({ points: [
      { id: 'center', position: [0, 0] }, { id: 'inner-point', position: [2, 0] }, { id: 'outer-point', position: [10, 0] }
    ], entities: [
      { id: 'inner', kind: 'circle', construction: false, centerPointId: 'center', radius: 2 },
      { id: 'outer', kind: 'circle', construction: false, centerPointId: 'center', radius: 10 },
      { id: 'bridge', kind: 'line', construction: false, startPointId: 'inner-point', endPointId: 'outer-point' }
    ], relations: [] }), {});
    expect(result.issues).toEqual([]); expect(result.cells).toHaveLength(2);
    const annulus = result.cells.find(cell => cell.holes.length === 1);
    expect(annulus?.area).toBeCloseTo(301.59289474462014, 10);
    expect(annulus?.holes[0].sourceRefs[0].entityId).toBe('inner');
    expect(result.cells.flatMap(cell => [cell.outer, ...cell.holes]).flatMap(boundary => boundary.sourceRefs).some(ref => ref.entityId === 'bridge')).toBe(false);
  });

  it('extracts both bounded triangles from a self-crossing authored loop', () => {
    const result = deriveCadSketchArrangement(parseCadSketchGraph({ points: [
      { id: 'a', position: [0, 0] }, { id: 'b', position: [10, 10] }, { id: 'c', position: [0, 10] }, { id: 'd', position: [10, 0] }
    ], entities: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']].map(([startPointId, endPointId], index) => ({
      id: `edge${index}`, kind: 'line', construction: false, startPointId, endPointId
    })), relations: [] }), {});
    expect(result.issues).toEqual([]);
    expect(result.cells.map(cell => cell.area)).toEqual([25, 25]);
    expect(result.cells.every(cell => cell.outer.path.length === 3)).toBe(true);
  });

  it('reports a self-touching hole boundary rather than publishing an ambiguous material cell', () => {
    const coordinates = [[0, 0], [2, 0], [2, 2], [0, 2], [-2, 0], [-2, -2], [0, -2]];
    const result = deriveCadSketchArrangement(parseCadSketchGraph({ points: [
      ...coordinates.map((position, index) => ({ id: `p${index}`, position })), { id: 'center', position: [0, 0] }
    ], entities: [
      ...[[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5], [5, 6], [6, 0]].map(([a, b], index) => ({ id: `edge${index}`, kind: 'line', construction: false, startPointId: `p${a}`, endPointId: `p${b}` })),
      { id: 'outer', kind: 'circle', construction: false, centerPointId: 'center', radius: 10 }
    ], relations: [] }), {});
    expect(result.cells).toEqual([]);
    expect(result.issues.some(issue => issue.code === 'non-simple-boundary')).toBe(true);
  });

  it('uses accepted coincident intent only for transient joints and preserves an equally small undeclared gap', () => {
    const raw = rectangle(), source = { ...raw, points: [...raw.points, { id: 'near', position: [0, 5e-13] }],
      entities: raw.entities.filter(entity => entity.id !== 'divider').map(entity => entity.id === 'left' ? { ...entity, endPointId: 'near' } : entity),
      relations: [{ id: 'close-intent', kind: 'coincident', pointIds: ['a', 'near'] }] };
    const graph = parseCadSketchGraph(source), before = JSON.stringify(graph);
    const result = deriveCadSketchArrangement(graph, {});
    expect(result.issues).toEqual([]); expect(result.cells).toHaveLength(1); expect(result.cells[0].area).toBe(100);
    expect(result.cells[0].outer.sourceRefs.flatMap(ref => ref.fromEvents).filter(event => event.kind === 'point').map(event => event.pointId)).toContain('near');
    expect(JSON.stringify(graph)).toBe(before); expect(graph.points.find(point => point.id === 'near')?.position[1]).toBe(5e-13);
    const exact = deriveCadSketchArrangement(parseCadSketchGraph({ ...source,
      points: source.points.map(point => point.id === 'near' ? { ...point, position: [0, 0] } : point) }), {});
    expect(exact.cells[0].key).toBe(result.cells[0].key);
    const undeclared = deriveCadSketchArrangement(parseCadSketchGraph({ ...source, relations: [] }), {});
    expect(undeclared).toMatchObject({ cells: [], issues: [] });
    const invalid = parseCadSketchGraph({ ...source,
      points: source.points.map(point => point.id === 'near' ? { ...point, position: [0, 2e-12] } : point) });
    expect(() => deriveCadSketchArrangement(invalid, {})).toThrow('close-intent');
  });

  it('retains a declared coincidence chain through orphan and construction-only points without changing source supports', () => {
    const raw = rectangle();
    for (const construction of [false, true]) {
      const graph = parseCadSketchGraph({ ...raw,
        points: [...raw.points, { id: 'near', position: [0, 5e-13] }, { id: 'joint', position: [0, 2e-13] }],
        entities: [...raw.entities.filter(entity => entity.id !== 'divider').map(entity => entity.id === 'left' ? { ...entity, endPointId: 'near' } : entity),
          ...(construction ? [{ id: 'guide', kind: 'circle', construction: true, centerPointId: 'joint', radius: 1 }] : [])],
        relations: [{ id: 'join-a', kind: 'coincident', pointIds: ['a', 'joint'] }, { id: 'join-near', kind: 'coincident', pointIds: ['joint', 'near'] }]
      }), before = JSON.stringify(graph);
      const result = deriveCadSketchArrangement(graph, {});
      expect(result.issues).toEqual([]); expect(result.cells.map(cell => cell.area)).toEqual([100]);
      expect(result.cells[0].outer.sourceRefs.flatMap(ref => ref.fromEvents)).toContainEqual({ kind: 'point', pointId: 'joint' });
      const reordered = deriveCadSketchArrangement(parseCadSketchGraph({ points: [...graph.points].reverse(), entities: [...graph.entities].reverse(), relations: [...graph.relations].reverse() }), {});
      expect(reordered).toEqual(result);
      expect(JSON.stringify(graph)).toBe(before);
    }
  });

  it('withholds cells when transitive coincidence residuals accumulate beyond one joint precision', () => {
    const raw = rectangle(), relations = [{ id: 'join-a', kind: 'coincident', pointIds: ['a', 'joint'] }, { id: 'join-near', kind: 'coincident', pointIds: ['joint', 'near'] }];
    for (const ordered of [relations, [...relations].reverse()]) {
      const graph = parseCadSketchGraph({ ...raw,
        points: [...raw.points, { id: 'near', position: [0, 1.6e-12] }, { id: 'joint', position: [0, 8e-13] }],
        entities: raw.entities.filter(entity => entity.id !== 'divider').map(entity => entity.id === 'left' ? { ...entity, endPointId: 'near' } : entity), relations: ordered
      });
      expect(() => deriveCadSketchArrangement(graph, {})).toThrowError(expect.objectContaining({ code: 'sketch-graph-precision' }));
    }
  });
});
