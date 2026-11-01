import { describe, expect, it } from 'vitest';
import { cadPathClosureTolerance } from '../cadAnalyticSegments';
import { parseCadSketchGraph, type CadSketchGraph } from '../cadSketchGraph';
import { isCadTopologyAdjacency, type CadTopologyAdjacency } from '../cadTopologyAdjacency';
import { CAD_PRECISION } from '../../precision/cadPrecision';
import { cadChainGraph, cadSelectionChain, type CadChainCurve } from '../selection/cadSelectionChain';
import { cadSketchSelectionChain } from '../selection/cadSketchSelectionChain';
import { cadBoxModeFor, cadBoxPolyline, cadBoxTakes, cadBoxTriangleTouches, cadScreenRect } from '../selection/cadSelectionBox';
import { cadSelectOtherApply, cadSelectOtherStep } from '../selection/cadSelectionCycle';
import { CAD_DEFAULT_SELECTION_FILTER, CAD_SELECTION_KINDS, cadSelectionAccepts, parseCadSelectionFilter, setCadSelectionKind } from '../selection/cadSelectionFilter';
import { cadTopologyEdgeChain, cadTopologyEdgeFaces, cadTopologyFaceLoop, cadTopologyTangentFaces } from '../selection/cadTopologySelection';

type Point = readonly [number, number];
const sketch = (points: Record<string, Point>, entities: readonly object[], relations: readonly object[] = []): CadSketchGraph =>
  parseCadSketchGraph({ points: Object.entries(points).map(([id, position]) => ({ id, position })), entities, relations });
const line = (id: string, startPointId: string, endPointId: string, construction = false) => ({ id, kind: 'line', construction, startPointId, endPointId });
const arc = (id: string, centerPointId: string, startPointId: string, endPointId: string, direction: 'cw' | 'ccw' = 'ccw') =>
  ({ id, kind: 'arc', construction: false, centerPointId, startPointId, endPointId, direction });
const contour = (graph: CadSketchGraph, seed: string) => cadSketchSelectionChain(graph, {}, seed, 'contour');
const tangent = (graph: CadSketchGraph, seed: string) => cadSketchSelectionChain(graph, {}, seed, 'tangent');
const sorted = (ids: readonly string[]) => [...ids].sort();

// A 20 by 10 slot: two straight sides joined by two half circles, every join tangent.
const slot = () => sketch({ a: [0, 0], b: [20, 0], c: [20, 10], d: [0, 10], right: [20, 5], left: [0, 5] },
  [line('bottom', 'a', 'b'), arc('east', 'right', 'b', 'c'), line('top', 'c', 'd'), arc('west', 'left', 'd', 'a')]);
const rectangle = (extra: readonly object[] = [], points: Record<string, Point> = {}, construction: readonly string[] = []) =>
  sketch({ a: [0, 0], b: [20, 0], c: [20, 10], d: [0, 10], ...points },
    [line('ab', 'a', 'b', construction.includes('ab')), line('bc', 'b', 'c', construction.includes('bc')), line('cd', 'c', 'd', construction.includes('cd')),
      line('da', 'd', 'a', construction.includes('da')), ...extra]);

describe('sketch chains', () => {
  it('selects a closed contour in order and a tangent chain that follows only smooth joins', () => {
    expect(contour(slot(), 'bottom')).toEqual({ seedId: 'bottom', ids: ['bottom', 'east', 'top', 'west'], closed: true, branches: [] });
    expect(tangent(slot(), 'top')).toEqual({ seedId: 'top', ids: ['top', 'west', 'bottom', 'east'], closed: true, branches: [] });
    expect(contour(rectangle(), 'bc')).toMatchObject({ ids: ['bc', 'cd', 'da', 'ab'], closed: true });
    expect(tangent(rectangle(), 'bc')).toEqual({ seedId: 'bc', ids: ['bc'], closed: false, branches: [] });
  });
  it('stops at a branch on both sides and reports it, never choosing an arm', () => {
    const graph = rectangle([line('spur', 'a', 'e')], { e: [-5, -5] });
    expect(contour(graph, 'bc')).toEqual({ seedId: 'bc', ids: ['ab', 'bc', 'cd', 'da'], closed: false, branches: ['a'] });
    expect(contour(graph, 'spur')).toEqual({ seedId: 'spur', ids: ['spur'], closed: false, branches: ['a'] });
    // Two arcs leave the end of a line tangent to it, one curving each way: the tangent chain stops there too.
    const fork = sketch({ s: [-10, 0], p: [0, 0], up: [0, 5], down: [0, -5], u: [5, 5], w: [5, -5] },
      [line('lead', 's', 'p'), arc('left', 'up', 'p', 'u', 'ccw'), arc('right', 'down', 'p', 'w', 'cw')]);
    expect(tangent(fork, 'lead')).toEqual({ seedId: 'lead', ids: ['lead'], closed: false, branches: ['p'] });
    // Without the second arc the tangent chain runs on, and a non-tangent spur at the joint does not stop it.
    const smooth = sketch({ s: [-10, 0], p: [0, 0], up: [0, 5], u: [5, 5], q: [0, -8] }, [line('lead', 's', 'p'), arc('left', 'up', 'p', 'u'), line('spur', 'p', 'q')]);
    expect(tangent(smooth, 'lead')).toEqual({ seedId: 'lead', ids: ['lead', 'left'], closed: false, branches: [] });
    expect(contour(smooth, 'lead')).toMatchObject({ ids: ['lead'], branches: ['p'] });
  });
  it('treats one circle as a closed loop of its own', () => {
    const graph = sketch({ o: [3, 4], a: [0, 0], b: [10, 0] }, [{ id: 'ring', kind: 'circle', construction: false, centerPointId: 'o', radius: 2 }, line('ab', 'a', 'b')]);
    expect(contour(graph, 'ring')).toEqual({ seedId: 'ring', ids: ['ring'], closed: true, branches: [] });
    expect(tangent(graph, 'ring')).toEqual({ seedId: 'ring', ids: ['ring'], closed: true, branches: [] });
  });
  it('follows an arc tangent to lines and stops where a corner turns', () => {
    // A line, a quarter arc tangent to it, then a line leaving the arc at a corner.
    const graph = sketch({ a: [-10, 0], p: [0, 0], o: [0, 5], q: [5, 5], r: [20, 5] }, [line('in', 'a', 'p'), arc('bend', 'o', 'p', 'q'), line('out', 'q', 'r')]);
    expect(tangent(graph, 'in')).toEqual({ seedId: 'in', ids: ['in', 'bend'], closed: false, branches: [] });
    expect(tangent(graph, 'bend')).toMatchObject({ ids: ['in', 'bend'] });
    expect(contour(graph, 'bend')).toMatchObject({ ids: ['in', 'bend', 'out'], closed: false });
  });
  it('accepts a join turning within sketch tangency precision and rejects one just beyond it', () => {
    const radius = 5, points = (angle: number) => {
      const center: Point = [radius * Math.sin(angle), radius * Math.cos(angle)];
      return { a: [-10, 0] as Point, p: [0, 0] as Point, o: center, q: [center[0] + radius, center[1]] as Point };
    };
    const allowance = Math.max(CAD_PRECISION.angularAccuracyRad, Math.min(cadPathClosureTolerance([{ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 5 }]) / radius,
      CAD_PRECISION.angularRoundoffCapRad));
    const chain = (angle: number) => tangent(sketch(points(angle), [line('in', 'a', 'p'), arc('bend', 'o', 'p', 'q')]), 'in').ids;
    expect(chain(0)).toEqual(['in', 'bend']);
    expect(chain(allowance / 2)).toEqual(['in', 'bend']);
    expect(chain(allowance * 4)).toEqual(['in']);
    expect(chain(1e-6)).toEqual(['in']);
  });
  it('joins coincident ends, keeps construction out unless the seed is construction, and never chains the origin or an axis', () => {
    const joined = sketch({ a: [0, 0], b: [10, 0], b2: [10, 0], c: [10, 10] }, [line('first', 'a', 'b'), line('second', 'b2', 'c')],
      [{ id: 'join', kind: 'coincident', pointIds: ['b', 'b2'] }]);
    expect(contour(joined, 'first')).toMatchObject({ ids: ['first', 'second'], closed: false, branches: [] });
    const guided = rectangle([], {}, ['cd']);
    expect(contour(guided, 'ab')).toEqual({ seedId: 'ab', ids: ['da', 'ab', 'bc'], closed: false, branches: [] });
    expect(contour(guided, 'cd')).toEqual({ seedId: 'cd', ids: ['cd'], closed: false, branches: [] });
    // Edges meeting at a point on the origin chain through it; the origin and the axes are never members. Ends that merely lie on the
    // origin, each held there by its own fixed relation, share no identity and do not join.
    const atOrigin = sketch({ a: [-5, 0], o: [0, 0], b: [0, 5] }, [line('west', 'a', 'o'), line('north', 'o', 'b')], [{ id: 'pin', kind: 'fixed-point', pointId: 'o', position: [0, 0] }]);
    const result = contour(atOrigin, 'west');
    expect(result.ids).toEqual(['west', 'north']);
    expect(result.ids.some(id => id.startsWith('@'))).toBe(false);
    expect(contour(atOrigin, '@h').ids).toEqual([]); expect(contour(atOrigin, '@origin').ids).toEqual([]);
    const pinned = sketch({ a: [-5, 0], o1: [0, 0], o2: [0, 0], b: [0, 5] }, [line('west', 'a', 'o1'), line('north', 'o2', 'b')],
      [{ id: 'pin-1', kind: 'fixed-point', pointId: 'o1', position: [0, 0] }, { id: 'pin-2', kind: 'fixed-point', pointId: 'o2', position: [0, 0] }]);
    expect(contour(pinned, 'west').ids).toEqual(['west']);
  });
  it('walks a closed chain of 2,000 edges in under a frame', () => {
    const count = 2000, points: Record<string, Point> = {}, entities: object[] = [];
    for (let index = 0; index < count; index++) {
      const angle = 2 * Math.PI * index / count; points[`p${index}`] = [100 * Math.cos(angle), 100 * Math.sin(angle)];
      entities.push(line(`e${index}`, `p${index}`, `p${(index + 1) % count}`));
    }
    const graph = sketch(points, entities, []), parameters = Object.freeze({});
    let started = performance.now();
    const first = cadSketchSelectionChain(graph, parameters, 'e700', 'contour');
    const withIndex = performance.now() - started;
    started = performance.now();
    const again = cadSketchSelectionChain(graph, parameters, 'e1300', 'contour');
    const walk = performance.now() - started;
    expect(first).toMatchObject({ closed: true }); expect(first.ids).toHaveLength(count); expect(again.ids).toHaveLength(count);
    expect(sorted(again.ids)).toEqual(sorted(first.ids));
    expect(walk).toBeLessThan(16);
    expect(withIndex).toBeLessThan(100);
    if (process.env.CAD_SELECTION_TIMINGS) console.info(`2,000-edge contour: ${withIndex.toFixed(2)} ms with its index, ${walk.toFixed(2)} ms after`);
  });
});

describe('the chain walker', () => {
  const curve = (id: string, start: string, end: string, tangents: CadChainCurve['tangents'] = [[1, 0], [1, 0]]): CadChainCurve => ({ id, vertices: [start, end], tangents });
  it('walks curves stored in either direction and reports an unknown seed as an empty chain', () => {
    const graph = cadChainGraph([curve('a', 'v0', 'v1'), curve('b', 'v2', 'v1', [[-1, 0], [-1, 0]]), curve('c', 'v2', 'v3')]);
    expect(cadSelectionChain(graph, 'b', { mode: 'contour' })).toMatchObject({ ids: ['c', 'b', 'a'] });
    expect(cadSelectionChain(graph, 'a', { mode: 'tangent', smooth: ({ arriving, leaving }) => arriving[0] === leaving[0] && arriving[1] === leaving[1] }))
      .toMatchObject({ ids: ['a', 'b', 'c'], closed: false });
    expect(cadSelectionChain(graph, 'missing', { mode: 'contour' })).toEqual({ seedId: 'missing', ids: [], closed: false, branches: [] });
    expect(() => cadSelectionChain(graph, 'a', { mode: 'tangent' })).toThrow('smoothness');
    expect(() => cadChainGraph([curve('a', 'v0', 'v1'), curve('a', 'v1', 'v2')])).toThrow('twice');
  });
  it('stops where a path meets a loop, on both sides of the loop', () => {
    // A path entering a loop at a vertex where the path itself is the only other curve the mode allows: a lollipop.
    const graph = cadChainGraph([curve('stick', 's', 'j'), curve('loop1', 'j', 'k'), curve('loop2', 'k', 'j', [[-1, 0], [-1, 0]])]);
    const result = cadSelectionChain(graph, 'loop1', { mode: 'contour' });
    expect(result.branches).toEqual(['j']); expect(sorted(result.ids)).toEqual(['loop1', 'loop2']);
  });
});

/**
 * The top of a 4 by 2 plate whose corners are rounded: four straight rim edges and four quarter-circle rim edges, all tangent, with a
 * smooth vertical edge down from each rim vertex where a flat side meets a rounded one, and the top face bounded by the rim.
 */
function plateTop(options: { extraTangent?: boolean; spur?: boolean; turn?: number } = {}): CadTopologyAdjacency {
  const edges: string[] = [], edgeVertices: number[] = [], edgeTangents: number[] = [], edgeFaces: number[] = [], edgeSmooth: boolean[] = [];
  // Rim directions at each of the eight rim vertices, running counter-clockwise; each rim edge is tangent to the next at their shared vertex.
  const directions = [[1, 0], [1, 0], [0, 1], [0, 1], [-1, 0], [-1, 0], [0, -1], [0, -1]];
  const faces = ['top', ...Array.from({ length: 8 }, (_, index) => `side-${index}`)];
  const faceLoops: number[][][] = faces.map(() => [[]]);
  const add = (key: string, start: number, end: number, a: readonly number[], b: readonly number[], sides: [number, number], smooth: boolean) => {
    const index = edges.length; edges.push(key); edgeVertices.push(start, end); edgeTangents.push(...a, ...b); edgeFaces.push(...sides); edgeSmooth.push(smooth);
    for (const face of new Set(sides)) if (face >= 0) faceLoops[face][0].push(index);
    return index;
  };
  for (let index = 0; index < 8; index++) {
    const start = directions[index], end = directions[(index + 1) % 8];
    // Straight edges keep one direction; the rounded edges turn a quarter between their ends.
    const startTangent = index % 2 === 0 ? [start[0], start[1], 0] : [directions[index][0], directions[index][1], 0];
    const endTangent = index % 2 === 0 ? [start[0], start[1], 0] : [end[0], end[1], 0];
    add(`rim-${index}`, index, (index + 1) % 8, startTangent, endTangent, [0, 1 + index], false);
  }
  for (let index = 0; index < 8; index++) add(`down-${index}`, index, 8 + index, [0, 0, -1], [0, 0, -1], [1 + (index + 7) % 8, 1 + index], true);
  if (options.extraTangent) add('fork', 1, 16, [1, 0, 0], [1, 0, 0], [-1, -1], false);
  // A sharp edge leaving rim vertex 1 at a right angle, upwards.
  if (options.spur) add('spur', 1, 16, [0, 0, 1], [0, 0, 1], [-1, -1], false);
  if (options.turn) {
    // Turn the start of rim 2, which follows rim 1, by `turn` radians about the vertical.
    const at = edges.indexOf('rim-2') * 6, [x, y] = [edgeTangents[at], edgeTangents[at + 1]], turn = options.turn;
    edgeTangents[at] = x * Math.cos(turn) - y * Math.sin(turn); edgeTangents[at + 1] = x * Math.sin(turn) + y * Math.cos(turn);
  }
  return { bodyId: 'plate', buildId: 'build-1', edges, edgeVertices, edgeTangents, edgeFaces, edgeSmooth, faces, faceLoops };
}

describe('solid chains', () => {
  it('follows a rounded rim all the way round and keeps smooth edges out of a corner chain', () => {
    const adjacency = plateTop();
    expect(isCadTopologyAdjacency(adjacency)).toBe(true);
    expect(cadTopologyEdgeChain(adjacency, 'rim-3')).toEqual({ seedId: 'rim-3', ids: ['rim-3', 'rim-4', 'rim-5', 'rim-6', 'rim-7', 'rim-0', 'rim-1', 'rim-2'], closed: true, branches: [] });
    expect(cadTopologyEdgeChain(adjacency, 'down-2')).toEqual({ seedId: 'down-2', ids: ['down-2'], closed: false, branches: [] });
  });
  it('stops where two tangent edges continue and at a join turned beyond the native angle, but passes a sharp spur', () => {
    expect(cadTopologyEdgeChain(plateTop({ extraTangent: true }), 'rim-4')).toMatchObject({ closed: false, branches: ['v1'] });
    // A sharp edge leaving at a corner is not a second continuation: the rim stays one closed chain and nothing is reported.
    expect(cadTopologyEdgeChain(plateTop({ spur: true }), 'rim-4')).toMatchObject({ closed: true, branches: [] });
    expect(cadTopologyEdgeChain(plateTop({ spur: true }), 'spur')).toEqual({ seedId: 'spur', ids: ['spur'], closed: false, branches: [] });
    expect(cadTopologyEdgeChain(plateTop({ turn: CAD_PRECISION.kernelTangentChainRad * 0.995 }), 'rim-4')).toMatchObject({ closed: true });
    const turned = cadTopologyEdgeChain(plateTop({ turn: CAD_PRECISION.kernelTangentChainRad * 1.005 }), 'rim-4');
    expect(turned).toMatchObject({ closed: false, branches: [] });
    expect(turned.ids[0]).toBe('rim-2'); expect(turned.ids.at(-1)).toBe('rim-1');
  });
  it('reads face loops, the faces of an edge and the faces joined without a crease', () => {
    const adjacency = plateTop();
    expect(cadTopologyFaceLoop(adjacency, 'top', 'rim-5')).toEqual(Array.from({ length: 8 }, (_, index) => `rim-${index}`));
    expect(cadTopologyFaceLoop(adjacency, 'side-0', 'rim-5')).toBeNull();
    expect(cadTopologyEdgeFaces(adjacency, 'down-0')).toEqual(['side-7', 'side-0']);
    expect(sorted(cadTopologyTangentFaces(adjacency, 'side-3'))).toEqual(sorted(adjacency.faces.slice(1)));
    expect(cadTopologyTangentFaces(adjacency, 'top')).toEqual(['top']);
    expect(cadTopologyTangentFaces(adjacency, 'missing')).toEqual([]);
  });
  it('accepts only adjacency whose arrays, indices and tangents are well formed', () => {
    const valid = plateTop();
    expect(isCadTopologyAdjacency(valid)).toBe(true);
    for (const broken of [
      { ...valid, edgeVertices: valid.edgeVertices.slice(1) }, { ...valid, edgeFaces: valid.edgeFaces.map(face => face === 3 ? 99 : face) },
      { ...valid, edgeTangents: valid.edgeTangents.map((value, index) => index === 0 ? 2 : value) }, { ...valid, edges: [...valid.edges.slice(1), valid.edges[1]] },
      { ...valid, faceLoops: [[[0, 999]], ...valid.faceLoops.slice(1)] }, { ...valid, extra: true }, { ...valid, edgeSmooth: valid.edgeSmooth.map(() => 1) },
    ]) expect(isCadTopologyAdjacency(broken)).toBe(false);
  });
});

describe('window and crossing boxes', () => {
  const rect = cadScreenRect({ x: 10, y: 10 }, { x: 50, y: 40 });
  it('takes the mode from the drag direction and applies it', () => {
    expect(cadBoxModeFor({ x: 10, y: 10 }, { x: 50, y: 0 })).toBe('window');
    expect(cadBoxModeFor({ x: 10, y: 10 }, { x: 10, y: 40 })).toBe('window');
    expect(cadBoxModeFor({ x: 50, y: 10 }, { x: 10, y: 40 })).toBe('crossing');
    expect(cadBoxTakes('window', { inside: false, touches: true })).toBe(false);
    expect(cadBoxTakes('crossing', { inside: false, touches: true })).toBe(true);
    expect(cadBoxTakes('window', { inside: true, touches: true })).toBe(true);
  });
  it('tests polylines and triangles against the box', () => {
    expect(cadBoxPolyline(rect, [{ x: 20, y: 20 }, { x: 30, y: 30 }])).toEqual({ inside: true, touches: true });
    expect(cadBoxPolyline(rect, [{ x: 0, y: 25 }, { x: 60, y: 25 }])).toEqual({ inside: false, touches: true });
    expect(cadBoxPolyline(rect, [{ x: 0, y: 0 }, { x: 0, y: 60 }])).toEqual({ inside: false, touches: false });
    expect(cadBoxPolyline(rect, [{ x: 20, y: 20 }, null])).toEqual({ inside: false, touches: true });
    expect(cadBoxPolyline(rect, [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }], true)).toEqual({ inside: false, touches: true });
    expect(cadBoxTriangleTouches(rect, { x: -100, y: -100 }, { x: 200, y: -100 }, { x: 0, y: 200 })).toBe(true);
    expect(cadBoxTriangleTouches(rect, { x: 60, y: 0 }, { x: 90, y: 0 }, { x: 60, y: 30 })).toBe(false);
    expect(cadBoxTriangleTouches(rect, { x: 0, y: 25 }, { x: 60, y: 25 }, { x: 30, y: 100 })).toBe(true);
  });
});

describe('select other', () => {
  const same = (a: string, b: string) => a === b;
  it('visits every candidate in order, wraps round and goes back', () => {
    const candidates = ['point', 'edge-a', 'edge-b'];
    let selection: string[] = ['edge-a'];
    const visited: string[] = [];
    for (let press = 0; press < 4; press++) {
      const step = cadSelectOtherStep(candidates, selection, same)!;
      selection = cadSelectOtherApply(selection, step, same); visited.push(step.candidate);
    }
    expect(visited).toEqual(['edge-b', 'point', 'edge-a', 'edge-b']);
    expect(cadSelectOtherStep(candidates, ['point'], same, -1)).toEqual({ candidate: 'edge-b', index: 2, replaces: 'point' });
    expect(cadSelectOtherStep(candidates, [], same)).toEqual({ candidate: 'point', index: 0, replaces: null });
    expect(cadSelectOtherStep(candidates, ['elsewhere'], same, -1)).toEqual({ candidate: 'edge-b', index: 2, replaces: null });
    expect(cadSelectOtherStep([], ['point'], same)).toBeNull();
  });
  it('replaces the most recently selected candidate and keeps the rest of the selection', () => {
    const step = cadSelectOtherStep(['a', 'b', 'c'], ['x', 'a', 'y', 'b'], same)!;
    expect(step).toEqual({ candidate: 'c', index: 2, replaces: 'b' });
    expect(cadSelectOtherApply(['x', 'a', 'y', 'b'], step, same)).toEqual(['x', 'a', 'y', 'c']);
    expect(cadSelectOtherApply(['a', 'b'], { candidate: 'a', index: 0, replaces: 'b' }, same)).toEqual(['a']);
    expect(cadSelectOtherApply(['x'], { candidate: 'a', index: 0, replaces: null }, same)).toEqual(['a']);
  });
});

describe('the selection filter', () => {
  it('starts with every kind selectable, sketch marks included, and keeps the kinds turned off', () => {
    for (const kind of CAD_SELECTION_KINDS) expect(cadSelectionAccepts(CAD_DEFAULT_SELECTION_FILTER, kind)).toBe(true);
    const marksOff = setCadSelectionKind(setCadSelectionKind(CAD_DEFAULT_SELECTION_FILTER, 'dimension', false), 'relation', false);
    expect(marksOff.excluded).toEqual(['relation', 'dimension']);
    expect(parseCadSelectionFilter(JSON.parse(JSON.stringify(marksOff)))).toEqual(marksOff);
    expect(parseCadSelectionFilter({ excluded: ['relation', 'future-kind'] })).toEqual({ excluded: ['relation'] });
  });
});
