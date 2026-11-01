// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph, type CadSketchSymmetricCurvesRelation } from '@/domain/cad/cadSketchGraph';
import type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';
import { CadSketchSplitDependencyError, splitCadSketchEntity } from '@/domain/cad/cadSketchSplit';
import { cadSketchMirrorPairings, cadSketchMirrorPairs, type CadSketchMirroredCurve } from '@/domain/cad/cadSketchSymmetryRelations';
import { prepareCadSketchTrim, trimCadSketchEntity } from '@/domain/cad/cadSketchTrimExtend';
import { cadSketchRelationOffers } from '@/domain/cad/sketch-relations/cadSketchRelationOffers';
import { cadSketchRelationKey, cadSketchRelationKindName, cadSketchRelationMeaning } from '@/domain/cad/sketch-relations/cadSketchRelationRegistry';
import { compileCadSketchEquations } from '@/domain/cad/sketch-solver/compileCadSketchEquations';
import { cadSketchConstraintChoices, cadSketchConstraintStep } from './cadSketchConstraintTool';
import { loadCadSketchTestNativeSolver } from './sketch-solver/__tests__/cadSketchTestSolver';
import { attemptCadSketchNativeSolve } from './sketch-solver/native/cadSketchNativeAttempt';

// Two lines, two arcs or two circles mirrored about a line or an axis, end to end: what a selection offers and the Constrain tool
// stores, how the ends pair, the equations the relation lowers to, where the native solver puts the geometry and the freedom it leaves,
// what is refused, and what already holds the same mirror.

type Place = readonly [number, number];
/** About the V axis, a fixed construction or ordinary line, or the H axis: each scene is drawn about x = 0 and turned onto its mirror. */
type Mirror = '@v' | '@h' | 'construction' | 'line';
const MIRRORS: readonly Mirror[] = ['@v', '@h', 'construction', 'line'];
const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
/** A place drawn about x = 0, turned onto the mirror: a quarter turn onto H, or 30° and shifted onto the line m1–m2. Turns keep arc directions. */
const placed = (mirror: Mirror, [x, y]: Place): Place => mirror === '@v' ? [x, y] : mirror === '@h' ? [-y, x] : [7 + x * COS - y * SIN, -3 + x * SIN + y * COS];
const lineOf = (mirror: Mirror) => mirror === '@v' || mirror === '@h' ? mirror : 'mirror';

const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line', construction: false, startPointId, endPointId }) as const;
const arc = (id: string, centerPointId: string, startPointId: string, endPointId: string, direction: 'ccw' | 'cw') =>
  ({ id, kind: 'arc', construction: false, centerPointId, startPointId, endPointId, direction }) as const;
const circle = (id: string, centerPointId: string) => ({ id, kind: 'circle', construction: false, centerPointId, radius: 4 }) as const;
/** The point `radius` from `centre` at `degrees`, and its mirror image about x = 0. */
const polar = ([x, y]: Place, radius: number, degrees: number): Place => [x + radius * Math.cos(degrees * Math.PI / 180), y + radius * Math.sin(degrees * Math.PI / 180)];
const image = ([x, y]: Place): Place => [-x, y];

/**
 * Curve A and its mirror B about x = 0, the point pairs the mirror maps, A's points a hold may fix, and the equations and freedom the
 * relation gives with the mirror fixed.
 */
interface Scene {
  readonly kind: 'line' | 'arc' | 'circle';
  readonly points: Readonly<Record<string, Place>>;
  readonly entities: readonly ReturnType<typeof line | typeof arc | typeof circle>[];
  readonly pairs: readonly (readonly [string, string])[];
  readonly own: readonly string[];
  readonly equations: number;
  readonly freedom: number;
}
const SCENES: Readonly<Record<string, Scene>> = {
  lines: { kind: 'line', points: { a1: [10, 5], a2: [25, 20], b1: [-10, 5], b2: [-25, 20] }, entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2')],
    pairs: [['a1', 'b1'], ['a2', 'b2']], own: ['a1', 'a2'], equations: 4, freedom: 4 },
  // B runs the other way, so its start mirrors A's end.
  'lines running opposite ways': { kind: 'line', points: { a1: [10, 5], a2: [25, 20], b1: [-10, 5], b2: [-25, 20] }, entities: [line('A', 'a1', 'a2'), line('B', 'b2', 'b1')],
    pairs: [['a1', 'b1'], ['a2', 'b2']], own: ['a1', 'a2'], equations: 4, freedom: 4 },
  // A V whose shared end lies on the mirror.
  'lines sharing an end': { kind: 'line', points: { v: [0, 30], a2: [18, 10], b2: [-18, 10] }, entities: [line('A', 'v', 'a2'), line('B', 'v', 'b2')],
    pairs: [['v', 'v'], ['a2', 'b2']], own: ['v', 'a2'], equations: 3, freedom: 3 },
  // A mirror turns an arc's sweep, so B running the same way starts at the mirror of A's end. Arc ends sit off their centres' level and
  // plumb, so no radius starts along a coordinate and the definition analysis is certain about every point.
  arcs: { kind: 'arc', points: { c1: [20, 10], s1: polar([20, 10], 5, 15), e1: polar([20, 10], 5, 105), c2: [-20, 10], s2: image(polar([20, 10], 5, 105)), e2: image(polar([20, 10], 5, 15)) },
    entities: [arc('A', 'c1', 's1', 'e1', 'ccw'), arc('B', 'c2', 's2', 'e2', 'ccw')], pairs: [['c1', 'c2'], ['s1', 'e2'], ['e1', 's2']], own: ['c1', 's1', 'e1'], equations: 5, freedom: 5 },
  'arcs running opposite ways': { kind: 'arc', points: { c1: [20, 10], s1: polar([20, 10], 5, 15), e1: polar([20, 10], 5, 105), c2: [-20, 10], s2: image(polar([20, 10], 5, 15)), e2: image(polar([20, 10], 5, 105)) },
    entities: [arc('A', 'c1', 's1', 'e1', 'ccw'), arc('B', 'c2', 's2', 'e2', 'cw')], pairs: [['c1', 'c2'], ['s1', 's2'], ['e1', 'e2']], own: ['c1', 's1', 'e1'], equations: 5, freedom: 5 },
  'arcs sharing an end': { kind: 'arc', points: { c1: [8, 6], s1: polar([8, 6], 10, 25), o: [0, 0], c2: [-8, 6], e2: image(polar([8, 6], 10, 25)) },
    entities: [arc('A', 'c1', 's1', 'o', 'ccw'), arc('B', 'c2', 'o', 'e2', 'ccw')], pairs: [['c1', 'c2'], ['s1', 'e2'], ['o', 'o']], own: ['c1', 's1', 'o'], equations: 4, freedom: 4 },
  'arcs sharing a center': { kind: 'arc', points: { z: [0, -5], s1: polar([0, -5], 10, 10), e1: polar([0, -5], 10, 70), s2: image(polar([0, -5], 10, 70)), e2: image(polar([0, -5], 10, 10)) },
    entities: [arc('A', 'z', 's1', 'e1', 'ccw'), arc('B', 'z', 's2', 'e2', 'ccw')], pairs: [['z', 'z'], ['s1', 'e2'], ['e1', 's2']], own: ['z', 's1', 'e1'], equations: 4, freedom: 4 },
  // A lens: the arcs share both ends, on the mirror.
  'arcs sharing both ends': { kind: 'arc', points: { c1: [-6, 2], s: [0, 12], e: [0, -8], c2: [6, 2] },
    entities: [arc('A', 'c1', 'e', 's', 'ccw'), arc('B', 'c2', 's', 'e', 'ccw')], pairs: [['c1', 'c2'], ['e', 'e'], ['s', 's']], own: ['c1', 'e', 's'], equations: 3, freedom: 3 },
  circles: { kind: 'circle', points: { k1: [15, 8], k2: [-15, 8] }, entities: [circle('A', 'k1'), circle('B', 'k2')], pairs: [['k1', 'k2']], own: ['k1'], equations: 3, freedom: 3 }
};

interface Options {
  /** Places that replace the scene's, before the turn onto the mirror. */
  readonly moved?: Readonly<Record<string, Place>>;
  /** Points fixed by their coordinates' expressions, or held where they are by Fix. */
  readonly held?: Readonly<Record<string, 'expression' | 'fix'>>;
  readonly radii?: Readonly<Record<string, number | string>>;
  readonly relations?: readonly unknown[];
}
/** The scene about the mirror, the line m1–m2 fixed by its expressions where the mirror is a line. */
function rawScene(scene: Scene, mirror: Mirror, options: Options = {}) {
  const position = (id: string) => placed(mirror, options.moved?.[id] ?? scene.points[id]);
  const axis = mirror === 'construction' || mirror === 'line';
  return {
    points: [...Object.keys(scene.points).map(id => ({ id, position: options.held?.[id] === 'expression' ? position(id).map(String) : position(id) })),
      ...axis ? [{ id: 'm1', position: placed(mirror, [0, -60]).map(String) }, { id: 'm2', position: placed(mirror, [0, 60]).map(String) }] : []],
    entities: [...scene.entities.map(entity => entity.kind === 'circle' && options.radii?.[entity.id] !== undefined ? { ...entity, radius: options.radii[entity.id] } : entity),
      ...axis ? [{ ...line('mirror', 'm1', 'm2'), construction: mirror === 'construction' }] : []],
    relations: [...Object.entries(options.held ?? {}).flatMap(([id, how]) => how === 'fix' ? [{ id: `fix-${id}`, kind: 'fixed-point', pointId: id, position: position(id) }] : []),
      ...options.relations ?? []]
  };
}
const graphOf = (scene: Scene, mirror: Mirror, options?: Options) => parseCadSketchGraph(rawScene(scene, mirror, options));
const mirrored = (mirror: Mirror, id = 'mirrored'): CadSketchSymmetricCurvesRelation => ({ id, kind: 'symmetric', curveIds: ['A', 'B'], lineId: lineOf(mirror) });
const P = (id: string): CadSketchGraphSelection => ({ kind: 'point', id }), E = (id: string): CadSketchGraphSelection => ({ kind: 'entity', id });
const pick = (graph: CadSketchGraph) => (id: string) => graph.points.some(point => point.id === id) ? P(id) : E(id);
const offer = (graph: CadSketchGraph, ids: readonly string[], kind = 'symmetric') => cadSketchRelationOffers(graph, ids.map(pick(graph))).find(item => item.kind === kind);
const step = (graph: CadSketchGraph, tool: 'symmetric' | 'equal', ids: readonly string[]) => cadSketchConstraintStep(graph, tool, ids.map(pick(graph)), () => 'new');
const choice = (graph: CadSketchGraph, ids: readonly string[], tool = 'symmetric') => cadSketchConstraintChoices(graph, ids.map(pick(graph)), () => 'new').find(item => item.tool === tool);
const failure = (run: () => unknown) => { try { run(); } catch (error) { return error instanceof Error ? error.message : String(error); } throw new Error('Expected a failure.'); };
const positions = (graph: CadSketchGraph) => new Map(graph.points.map(point => [point.id, { x: Number(point.position[0]), y: Number(point.position[1]) }]));
const permutations = <T>(items: readonly T[]): T[][] => items.length < 2 ? [[...items]] : items.flatMap((item, index) => permutations(items.filter((_, at) => at !== index)).map(rest => [item, ...rest]));

describe('lines, arcs and circles mirrored about a line or an axis', () => {
  it('offer and store two lines, two arcs or two circles as one Symmetric, in any pick order, about an axis, a construction line or a line', () => {
    for (const [name, scene] of Object.entries(SCENES)) for (const mirror of MIRRORS) {
      const graph = graphOf(scene, mirror), axis = lineOf(mirror);
      // Among three ordinary lines the last is the mirror; an axis, a construction line or the one line among arcs or circles is the mirror wherever it is picked.
      const orders = mirror === 'line' && scene.kind === 'line' ? [['A', 'B', axis], ['B', 'A', axis]] : permutations(['A', 'B', axis]);
      for (const order of orders) {
        const where = `${name} about ${mirror}, picked ${order.join(' ')}`, curves = order.filter(id => id !== axis);
        const relations = [{ kind: 'symmetric', curveIds: curves, lineId: axis }];
        expect(offer(graph, order), where).toEqual({ kind: 'symmetric', state: 'available', operands: [[...curves.map(E), E(axis)]], relations, relationIds: [] });
        expect(step(graph, 'symmetric', order), where).toEqual({ status: 'ready', relations: [{ id: 'new', ...relations[0] }] });
      }
    }
  });

  it('pick the mirror among three lines: the one construction line, or else the last line', () => {
    const graph = graphOf(SCENES.lines, 'construction');
    expect(step(graph, 'symmetric', ['mirror', 'A', 'B'])).toMatchObject({ status: 'ready', relations: [{ curveIds: ['A', 'B'], lineId: 'mirror' }] });
    const plain = graphOf(SCENES.lines, 'line');
    expect(step(plain, 'symmetric', ['mirror', 'A', 'B'])).toMatchObject({ status: 'ready', relations: [{ curveIds: ['mirror', 'A'], lineId: 'B' }] });
    expect(offer(plain, ['mirror', 'A', 'B'])).toMatchObject({ relations: [{ curveIds: ['mirror', 'A'], lineId: 'B' }] });
  });

  it('prompt for what completes a mirror, offering only picks that can', () => {
    const graph = graphOf(SCENES.lines, '@v'), first = step(graph, 'symmetric', ['A']);
    expect(first).toMatchObject({ status: 'more', prompt: 'Choose the second line, an axis, or a point, arc or circle to mirror about this line' });
    expect(step(graph, 'symmetric', ['A', 'B'])).toMatchObject({ status: 'more', prompt: 'Choose the line or axis to mirror about' });
    expect(step(graph, 'symmetric', ['@v'])).toMatchObject({ status: 'more', prompt: 'Choose two points, lines, arcs or circles to mirror about this axis' });
  });

  it('pair the ends of two lines by where they are before an edit, whichever way each runs, and an arc\'s ends by the arcs\' directions', () => {
    const identity = (id: string) => id;
    for (const [name, scene] of Object.entries(SCENES)) for (const mirror of MIRRORS) {
      const graph = graphOf(scene, mirror), [a, b] = ['A', 'B'].map(id => graph.entities.find(entity => entity.id === id) as CadSketchMirroredCurve);
      const axis = mirror === '@v' || mirror === '@h' ? { startPointId: '@origin', endPointId: mirror } : { startPointId: 'm1', endPointId: 'm2' };
      const ids = (pairs: readonly { readonly pointIds: readonly [string, string] }[]) => pairs.map(pair => [...pair.pointIds]);
      const pairs = cadSketchMirrorPairs([a, b], axis, identity, positions(graph));
      expect(new Set(ids(pairs).map(pair => pair.join(' '))), `${name} about ${mirror}`).toEqual(new Set(scene.pairs.map(pair => pair.join(' '))));
      // Read the other way round, the curves pair the same points.
      expect(new Set(ids(cadSketchMirrorPairs([b, a], axis, identity, positions(graph))).map(([p, q]) => `${q} ${p}`)), `${name} reversed`).toEqual(new Set(scene.pairs.map(pair => pair.join(' '))));
    }
    // Arcs pair by direction alone, so their pairing needs no geometry; the end pair after the first is the one their centres imply.
    const arcs = (scene: Scene) => scene.entities as readonly CadSketchMirroredCurve[] as readonly [CadSketchMirroredCurve, CadSketchMirroredCurve];
    expect(cadSketchMirrorPairings(arcs(SCENES.arcs), identity)).toEqual([[{ pointIds: ['c1', 'c2'], self: false, dependent: false },
      { pointIds: ['e1', 's2'], self: false, dependent: false }, { pointIds: ['s1', 'e2'], self: false, dependent: true }]]);
    expect(cadSketchMirrorPairings(arcs(SCENES['arcs running opposite ways']), identity)).toEqual([[{ pointIds: ['c1', 'c2'], self: false, dependent: false },
      { pointIds: ['e1', 'e2'], self: false, dependent: false }, { pointIds: ['s1', 's2'], self: false, dependent: true }]]);
    // An end on the mirror comes first, so the dependent pair is never the one that keeps the shared end on it.
    expect(cadSketchMirrorPairings(arcs(SCENES['arcs sharing an end']), identity)[0].map(pair => [pair.pointIds.join(' '), pair.self, pair.dependent]))
      .toEqual([['c1 c2', false, false], ['o o', true, false], ['s1 e2', false, true]]);
    // Lines apart can pair either way until the geometry says which.
    expect(cadSketchMirrorPairings(arcs(SCENES.lines), identity).map(pairing => pairing.map(pair => pair.pointIds.join(' ')))).toEqual([['a1 b1', 'a2 b2'], ['a1 b2', 'a2 b1']]);
  });

  it('lower each mirror as one constraint, one equation for each freedom it holds, a circle\'s radius among them', () => {
    for (const [name, scene] of Object.entries(SCENES)) for (const mirror of MIRRORS) {
      const graph = graphOf(scene, mirror, { relations: [mirrored(mirror)] }), model = compileCadSketchEquations({ graph, parameters: {} });
      const own = model.equations.filter(equation => equation.sourceId === 'mirrored'), where = `${name} about ${mirror}`;
      expect(own, where).toHaveLength(scene.equations);
      expect(new Set(own.map(equation => equation.tag)).size, where).toBe(1);
      const radii = [...model.radiusParameters.values()];
      expect(own.some(equation => equation.operands.length === 2 && radii.includes(equation.operands[0]) && radii.includes(equation.operands[1])), where).toBe(scene.kind === 'circle');
    }
  });

  it('solve to the mirror image and leave the freedom the relation does not hold', async () => {
    const solver = await loadCadSketchTestNativeSolver();
    for (const [name, scene] of Object.entries(SCENES)) for (const mirror of MIRRORS) {
      // B starts off its mirror image, and a circle B with another radius.
      const others = Object.keys(scene.points).filter(id => !scene.own.includes(id));
      const moved = Object.fromEntries(others.map(id => [id, [scene.points[id][0] + 1.5, scene.points[id][1] - 0.75] as const]));
      const graph = graphOf(scene, mirror, { moved, radii: { B: 5 }, relations: [mirrored(mirror)] }), where = `${name} about ${mirror}`;
      const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`${where}: ${result.message}`);
      expect(result.diagnostics, where).toMatchObject({ status: 'success', degreesOfFreedom: scene.freedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      const at = positions(result.graph), [m1, m2] = mirror === '@v' || mirror === '@h' ? [{ x: 0, y: 0 }, mirror === '@v' ? { x: 0, y: 1 } : { x: 1, y: 0 }] : [at.get('m1')!, at.get('m2')!];
      const reflect = ({ x, y }: { x: number; y: number }) => {
        const dx = m2.x - m1.x, dy = m2.y - m1.y, along = ((x - m1.x) * dx + (y - m1.y) * dy) / (dx * dx + dy * dy);
        return { x: 2 * (m1.x + along * dx) - x, y: 2 * (m1.y + along * dy) - y };
      };
      for (const [p, q] of scene.pairs) {
        const image = reflect(at.get(p)!), target = at.get(q)!;
        expect(Math.hypot(image.x - target.x, image.y - target.y), `${where}: ${p} onto ${q}`).toBeLessThan(1e-7);
      }
      if (scene.kind === 'circle') {
        const [a, b] = ['A', 'B'].map(id => Number((result.graph.entities.find(entity => entity.id === id) as { radius: number }).radius));
        expect(a, where).toBeCloseTo(b, 9);
      }
      expect(checkCadSketchGraph(result.graph, {}), where).toEqual([]);
    }
  });

  it('give a mirror about H, V, a construction line or a line one answer: freedom, redundancy and conflicts, whichever points are fixed or held', async () => {
    // Every scene, with each of A's points free, fixed by expressions or held by Fix, alone, beside an Equal the mirror already keeps, or
    // with B's first point held 1 mm along the mirror from its image, and a circle's radius free or fixed. The mirror lines are fixed by
    // expressions, so they add no freedom of their own, and the answers agree in everything but the positions. A conflict planted farther
    // off is met at a stall, whose blame the solver documents as a suspicion: 3 mm away, 5 of these conflicts are certified about one
    // mirror and left failed about another, about V and H too. Across the mirror, a turned mirror's rows let the solver name another
    // conflict witness, as valid, than about an axis.
    const solver = await loadCadSketchTestNativeSolver();
    const solve = (scene: Scene, mirror: Mirror, held: Readonly<Record<string, 'expression' | 'fix'>>, extra: 'none' | 'equal' | 'away', radius: boolean) => {
      const first = scene.pairs.find(pair => pair[0] !== pair[1])!, equal = scene.kind === 'line' ? { id: 'same', kind: 'equal-length', lineIds: ['A', 'B'] } : { id: 'same', kind: 'equal-radius', curveIds: ['A', 'B'] };
      const away = { id: 'away', kind: 'fixed-point', pointId: first[1], position: placed(mirror, [scene.points[first[1]][0], scene.points[first[1]][1] + 1]) };
      const graph = graphOf(scene, mirror, { held, radii: radius ? { A: '4' } : {}, relations: [mirrored(mirror), ...extra === 'equal' ? [equal] : extra === 'away' ? [away] : []] });
      const { result, reason } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
      // The mirror line and its ends are defined by their expressions, where an axis is not listed.
      const definition = result.diagnostics.definition && Object.fromEntries(Object.entries(result.diagnostics.definition)
        .map(([key, value]) => [key, Array.isArray(value) ? value.filter(id => !['mirror', 'm1', 'm2'].includes(id)) : value]));
      return { reason, ...result.kind === 'solved' ? { kind: result.kind } : { kind: result.reason, message: result.message }, diagnostics: { ...result.diagnostics, definition } };
    };
    const seen = new Set<string>();
    let configurations = 0;
    for (const [name, scene] of Object.entries(SCENES)) {
      for (let code = 0; code < 3 ** scene.own.length; code++) {
        const held = Object.fromEntries(scene.own.flatMap((id, index) => {
          const how = Math.floor(code / 3 ** index) % 3;
          return how === 0 ? [] : [[id, how === 1 ? 'expression' : 'fix'] as const];
        }));
        for (const extra of ['none', 'equal', 'away'] as const) for (const radius of scene.kind === 'circle' ? [false, true] : [false]) {
          const answer = solve(scene, '@v', held, extra, radius);
          for (const mirror of MIRRORS.slice(1)) expect(solve(scene, mirror, held, extra, radius), JSON.stringify({ name, mirror, held, extra, radius })).toEqual(answer);
          seen.add(answer.kind); configurations++;
        }
      }
    }
    expect(configurations).toBe(3 * 27 + 5 * 81 + 18);
    expect(seen).toEqual(new Set(['solved', 'redundant', 'conflicting']));
  });

  it('refuse two kinds, an axis among the mirrored curves, and pairs a mirror cannot map, with the reason', () => {
    const lines = rawScene(SCENES.lines, 'construction'), arcs = rawScene(SCENES.arcs, 'construction'), circles = rawScene(SCENES.circles, 'construction');
    const mixed = { points: [...lines.points, ...arcs.points.filter(point => !point.id.startsWith('m')), { id: 'k', position: [0, 40] }],
      entities: [...lines.entities, { ...arcs.entities[0], id: 'arc' }, circle('ring', 'k')], relations: [] };
    const refusal = (raw: object, relation: object) => failure(() => parseCadSketchGraph({ ...raw, relations: [...(raw as { relations: unknown[] }).relations, { id: 'x', kind: 'symmetric', ...relation }] }));
    const kinds = 'Choose two points, two lines, two arcs or two circles to mirror.';
    for (const curveIds of [['A', 'arc'], ['A', 'ring'], ['arc', 'ring']]) {
      expect(refusal(mixed, { curveIds, lineId: 'mirror' }), curveIds.join(' ')).toBe(kinds);
      const graph = parseCadSketchGraph(mixed);
      expect(offer(graph, [...curveIds, 'mirror']), curveIds.join(' ')).toMatchObject({ state: 'blocked', reason: kinds, relations: [], relationIds: [] });
      expect(step(graph, 'symmetric', [...curveIds, 'mirror']), curveIds.join(' ')).toEqual({ status: 'invalid', reason: kinds });
    }
    // A point with a line or an arc is two kinds too; a point with a circle mirrors the circle's centre.
    const graph = parseCadSketchGraph(mixed);
    expect(offer(graph, ['k', 'A', 'mirror'])).toMatchObject({ state: 'blocked', reason: kinds });
    expect(offer(graph, ['a1', 'arc', 'mirror'])).toMatchObject({ state: 'blocked', reason: kinds });
    expect(offer(graph, ['a1', 'ring', 'mirror'])).toMatchObject({ state: 'available', relations: [{ kind: 'symmetric', pointIds: ['a1', 'k'], lineId: 'mirror' }] });
    expect(refusal(lines, { curveIds: ['A', 'A'], lineId: 'mirror' })).toBe('Symmetry needs two distinct curves and a separate line to mirror about.');
    expect(refusal(lines, { curveIds: ['A', 'B'], lineId: 'A' })).toBe('Symmetry needs two distinct curves and a separate line to mirror about.');
    expect(refusal(mixed, { curveIds: ['A', 'B'], lineId: 'arc' })).toBe('Symmetry needs an existing straight axis line.');
    expect(refusal(lines, { curveIds: ['A', '@h'], lineId: 'mirror' })).toMatch(/axis/i);
    // Two circles on one centre, two lines on the same two ends, and arcs on the same three points.
    expect(refusal({ ...circles, entities: [circle('A', 'k1'), circle('B', 'k1'), circles.entities[2]] }, { curveIds: ['A', 'B'], lineId: 'mirror' }))
      .toBe('These circles share a center, so they cannot mirror each other.');
    expect(refusal({ ...lines, entities: [line('A', 'a1', 'a2'), line('B', 'a2', 'a1'), lines.entities[2]] }, { curveIds: ['A', 'B'], lineId: 'mirror' }))
      .toBe('These lines share both ends, so they cannot mirror each other.');
    expect(refusal({ ...arcs, entities: [arc('A', 'c1', 's1', 'e1', 'ccw'), arc('B', 'c1', 's1', 'e1', 'cw'), arcs.entities[2]] }, { curveIds: ['A', 'B'], lineId: 'mirror' }))
      .toBe('These arcs share their center and both ends, so they cannot mirror each other.');
    // Arcs running one way pair each start with the other's end, so a start they share would have to mirror onto an end.
    expect(refusal({ ...arcs, entities: [arc('A', 'c1', 's1', 'e1', 'ccw'), arc('B', 'c2', 's1', 'e2', 'ccw'), arcs.entities[2]] }, { curveIds: ['A', 'B'], lineId: 'mirror' }))
      .toBe('These arcs share a point that the mirror cannot map onto itself. Mirrored arcs run in opposite senses.');
    // An end of the mirror line stays where it is, so a curve may reach it only where both curves share it.
    expect(refusal({ ...lines, entities: [line('A', 'm1', 'a2'), line('B', 'b1', 'b2'), lines.entities[2]] }, { curveIds: ['A', 'B'], lineId: 'mirror' }))
      .toBe('A point at an end of the axis line can only mirror onto itself, so both curves need to share it.');
  });

  it('refuse Equal between a line and an arc or circle, naming what each has', () => {
    const lines = rawScene(SCENES.lines, 'construction'), arcs = rawScene(SCENES.arcs, 'construction');
    const graph = parseCadSketchGraph({ ...lines, points: [...lines.points, ...arcs.points.filter(point => !point.id.startsWith('m')), { id: 'k', position: [0, 40] }],
      entities: [...lines.entities, { ...arcs.entities[0], id: 'arc' }, circle('ring', 'k')] });
    for (const [ids, curve] of [[['A', 'arc'], 'an arc'], [['ring', 'B'], 'a circle']] as const) {
      const reason = `A line has a length and ${curve} a radius, so Equal cannot relate them.`;
      expect(offer(graph, ids, 'equal-length'), ids.join(' ')).toMatchObject({ state: 'blocked', reason, relations: [] });
      expect(offer(graph, ids, 'equal-radius'), ids.join(' ')).toBeUndefined();
      expect(step(graph, 'equal', ids), ids.join(' ')).toEqual({ status: 'invalid', reason });
    }
    // Arcs and circles take one radius in any mix.
    expect(offer(graph, ['arc', 'ring'], 'equal-radius')).toMatchObject({ state: 'available', relations: [{ kind: 'equal-radius', curveIds: ['arc', 'ring'] }] });
  });

  it('store one relation for each mirror, and find the relations that already hold it', () => {
    const relation = mirrored('construction', 's'), stored = graphOf(SCENES.lines, 'construction', { relations: [relation] });
    // Either curve order is one relation, applied whichever way it is picked, and Remove names it.
    expect(cadSketchRelationKey({ ...relation, curveIds: ['B', 'A'] })).toBe(cadSketchRelationKey(relation));
    expect(cadSketchRelationKey({ ...relation, lineId: 'other' })).not.toBe(cadSketchRelationKey(relation));
    for (const order of [['B', 'A', 'mirror'], ['mirror', 'A', 'B']]) {
      expect(offer(stored, order), order.join(' ')).toMatchObject({ state: 'applied', relationIds: ['s'] });
      expect(step(stored, 'symmetric', order), order.join(' ')).toEqual({ status: 'invalid', reason: 'Symmetric is already applied here.', applied: ['s'] });
    }
    // Its points and sizes are held already.
    expect(offer(stored, ['a1', 'b1', 'mirror'])).toMatchObject({ state: 'blocked', reason: 'These points belong to curves that already mirror each other about this line.' });
    expect(offer(stored, ['A', 'B'], 'equal-length')).toMatchObject({ state: 'blocked', reason: 'These lines mirror each other, so they are equal already.' });
    const circles = graphOf(SCENES.circles, 'construction', { relations: [mirrored('construction', 's')] });
    expect(offer(circles, ['A', 'B'], 'equal-radius')).toMatchObject({ state: 'blocked', reason: 'These circles mirror each other, so they are equal already.' });

    // Two point mirrors already hold two lines: the mirror is applied, naming both, and Remove removes both.
    const pair = (id: string, pointIds: readonly [string, string]) => ({ id, kind: 'symmetric', pointIds, lineId: 'mirror' });
    const both = graphOf(SCENES.lines, 'construction', { relations: [pair('p2', ['b2', 'a2']), pair('p1', ['a1', 'b1'])] });
    expect(offer(both, ['A', 'B', 'mirror'])).toMatchObject({ state: 'applied', relationIds: ['p2', 'p1'] });
    expect(choice(both, ['A', 'B', 'mirror'])).toEqual({ tool: 'symmetric', state: 'applied', relationIds: ['p2', 'p1'] });
    // One of them holds half the mirror: the other completes it.
    const half = graphOf(SCENES.lines, 'construction', { relations: [pair('p1', ['a1', 'b1'])] });
    expect(offer(half, ['A', 'B', 'mirror'])).toMatchObject({ state: 'available', relations: [{ kind: 'symmetric', pointIds: ['a2', 'b2'], lineId: 'mirror' }] });
    // A circle's radius held by Equal: the mirror adds its centres.
    const sized = graphOf(SCENES.circles, 'construction', { relations: [{ id: 'same', kind: 'equal-radius', curveIds: ['A', 'B'] }] });
    expect(offer(sized, ['A', 'B', 'mirror'])).toMatchObject({ state: 'available', relations: [{ kind: 'symmetric', pointIds: ['k1', 'k2'], lineId: 'mirror' }] });
    const centred = graphOf(SCENES.circles, 'construction', { relations: [pair('c', ['k1', 'k2'])] });
    expect(offer(centred, ['A', 'B', 'mirror'])).toMatchObject({ state: 'available', relations: [{ kind: 'equal-radius', curveIds: ['A', 'B'] }] });
    const whole = graphOf(SCENES.circles, 'construction', { relations: [pair('c', ['k1', 'k2']), { id: 'same', kind: 'equal-radius', curveIds: ['B', 'A'] }] });
    expect(offer(whole, ['B', 'A', 'mirror'])).toMatchObject({ state: 'applied', relationIds: ['c', 'same'] });
    // An arc's mirror is one relation, so part of it held another way is refused, and so is an Equal the mirror would repeat.
    const arcs = graphOf(SCENES.arcs, 'construction', { relations: [pair('c', ['c1', 'c2'])] });
    expect(offer(arcs, ['A', 'B', 'mirror'])).toMatchObject({ state: 'blocked', reason: 'Other relations already mirror part of these arcs. Remove them first.' });
    const equal = graphOf(SCENES.lines, 'construction', { relations: [{ id: 'same', kind: 'equal-length', lineIds: ['A', 'B'] }] });
    expect(offer(equal, ['A', 'B', 'mirror'])).toMatchObject({ state: 'blocked', reason: expect.stringMatching(/Remove Equal first\.$/) });
  });

  it('leave with a trim of either mirrored curve, and refuse a split while it names the curve', () => {
    // A cutter at x = 15 crosses line A a third of the way along and circle A through its centre.
    const cutter = { relations: [mirrored('@v')] }, withCutter = (scene: Scene) => {
      const raw = rawScene(scene, '@v', cutter);
      return parseCadSketchGraph({ ...raw, points: [...raw.points, { id: 'u1', position: [15, -10] }, { id: 'u2', position: [15, 30] }],
        entities: [...raw.entities, line('U', 'u1', 'u2')] });
    };
    const lines = withCutter(SCENES.lines), end = prepareCadSketchTrim({ graph: lines, parameters: {}, entityId: 'A', parameter: .8 });
    expect(end.target).toMatchObject({ kind: 'end', removedRelationIds: ['mirrored'] });
    if (end.target.kind !== 'end') throw new Error('Expected an end trim.');
    expect(trimCadSketchEntity({ graph: lines, parameters: {}, trim: { ...end.target, cutPointId: 'cut' } }).graph.relations).toEqual([]);
    const circles = withCutter(SCENES.circles), cap = prepareCadSketchTrim({ graph: circles, parameters: {}, entityId: 'B', parameter: .1 });
    // Only A crosses the cutter, so a trim of B finds nothing to cut at; A's trim makes it an arc, which the circle mirror cannot hold.
    expect(cap.target.kind).toBe('delete');
    const ring = prepareCadSketchTrim({ graph: circles, parameters: {}, entityId: 'A', parameter: .1 });
    expect(ring.target).toMatchObject({ kind: 'circle', removedRelationIds: ['mirrored'] });
    if (ring.target.kind !== 'circle') throw new Error('Expected a circle trim.');
    expect(trimCadSketchEntity({ graph: circles, parameters: {}, trim: { ...ring.target, cutPointIds: ['k', 'l'] } }).graph.relations).toEqual([]);
    expect(() => splitCadSketchEntity({ graph: lines, parameters: {}, split: { kind: 'line', entityId: 'A', parameter: .5, splitPointId: 'cut',
      newEntityId: 'piece', supportRelationId: 'support' } })).toThrow(CadSketchSplitDependencyError);
  });

  it('name and describe a curve mirror apart from a point mirror, and take it from an agent edit', () => {
    const relation = mirrored('construction', 's'), points = { id: 'p', kind: 'symmetric', pointIds: ['a1', 'b1'], lineId: 'mirror' } as const;
    expect([cadSketchRelationKindName(relation), cadSketchRelationKindName(points)]).toEqual(['Symmetric curves', 'Symmetric points']);
    expect(cadSketchRelationMeaning(relation)).toMatch(/^Keeps two lines, two arcs or two circles reflected/);
    expect(cadSketchRelationMeaning(points)).toMatch(/^Keeps two point positions reflected/);
    const document = parseCadDocument({ ...createCadDocument('Mirrors', 'mirrors'), schemaVersion: 2, features: [{
      id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: rawScene(SCENES.arcs, '@v') }] });
    const edited = applyCadEdits(document, [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: mirrored('@v', 's') }]);
    const sketch = edited.features[0];
    expect(sketch.kind === 'sketch' && sketch.graph?.relations).toEqual([mirrored('@v', 's')]);
  });
});
