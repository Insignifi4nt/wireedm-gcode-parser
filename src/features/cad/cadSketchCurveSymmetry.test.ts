// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { applyCadEdits, type CadEdit } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph, type CadSketchSymmetricCurvesRelation } from '@/domain/cad/cadSketchGraph';
import type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';
import { CadSketchSplitDependencyError, splitCadSketchEntity } from '@/domain/cad/cadSketchSplit';
import { CAD_SKETCH_MIRROR_COLLAPSE, cadSketchDrivenSizes, cadSketchMirrorPairings, cadSketchMirrorPairs, type CadSketchMirroredCurve } from '@/domain/cad/cadSketchSymmetryRelations';
import { CadSketchExtendDependencyError, prepareCadSketchExtend, prepareCadSketchTrim, trimCadSketchEntity } from '@/domain/cad/cadSketchTrimExtend';
import { cadSketchRelationOffers } from '@/domain/cad/sketch-relations/cadSketchRelationOffers';
import { cadSketchRelationKey, cadSketchRelationKindName, cadSketchRelationMeaning } from '@/domain/cad/sketch-relations/cadSketchRelationRegistry';
import { compileCadSketchEquations } from '@/domain/cad/sketch-solver/compileCadSketchEquations';
import { CAD_PRECISION } from '@/domain/precision/cadPrecision';
import { cadSketchConstraintChoices, cadSketchConstraintStep } from './cadSketchConstraintTool';
import { loadCadSketchTestNativeSolver } from './sketch-solver/__tests__/cadSketchTestSolver';
import { attemptCadSketchNativeSolve } from './sketch-solver/native/cadSketchNativeAttempt';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';
import { prepareCadEdits } from './cadEditPreparation';
import { cadSketchShrinkWarnings } from './cadSketchShrinkWarnings';
import { CAD_SKETCH_START_COMBINATIONS, cadSketchStartCombinations, cadSketchStartComponents } from './sketch-solver/native/cadSketchNativeStartSearch';

// Two lines, two arcs or two circles mirrored about a line or an axis, end to end: what a selection offers and the Constrain tool
// stores, how the ends pair, the equations the relation lowers to, where the native solver puts the geometry and the freedom it leaves,
// what is refused, and what already holds the same mirror.

// One test moves `mirrorCollapseRelative` to either side of a shrink the solver measures, since no sketch can place a start's shrink at
// the policy's own fraction; every other test, and that one outside its two solves, reads the policy's value.
const precision = vi.hoisted(() => ({ mirrorCollapseRelative: undefined as number | undefined }));
vi.mock('@/domain/precision/cadPrecision', async importOriginal => {
  const actual = await importOriginal<typeof import('@/domain/precision/cadPrecision')>();
  const roles = { ...actual.CAD_PRECISION };
  Object.defineProperty(roles, 'mirrorCollapseRelative', { enumerable: true, get: () => precision.mirrorCollapseRelative ?? actual.CAD_PRECISION.mirrorCollapseRelative });
  return { ...actual, CAD_PRECISION: Object.freeze(roles) };
});

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
 * relation gives with the mirror fixed. Arcs lower one equation more than the freedom they take: B's own equal radii follow from the
 * mirror, so one equation of the pair is always kept already.
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
    entities: [arc('A', 'c1', 's1', 'e1', 'ccw'), arc('B', 'c2', 's2', 'e2', 'ccw')], pairs: [['c1', 'c2'], ['s1', 'e2'], ['e1', 's2']], own: ['c1', 's1', 'e1'], equations: 6, freedom: 5 },
  'arcs running opposite ways': { kind: 'arc', points: { c1: [20, 10], s1: polar([20, 10], 5, 15), e1: polar([20, 10], 5, 105), c2: [-20, 10], s2: image(polar([20, 10], 5, 15)), e2: image(polar([20, 10], 5, 105)) },
    entities: [arc('A', 'c1', 's1', 'e1', 'ccw'), arc('B', 'c2', 's2', 'e2', 'cw')], pairs: [['c1', 'c2'], ['s1', 's2'], ['e1', 'e2']], own: ['c1', 's1', 'e1'], equations: 6, freedom: 5 },
  'arcs sharing an end': { kind: 'arc', points: { c1: [8, 6], s1: polar([8, 6], 10, 25), o: [0, 0], c2: [-8, 6], e2: image(polar([8, 6], 10, 25)) },
    entities: [arc('A', 'c1', 's1', 'o', 'ccw'), arc('B', 'c2', 'o', 'e2', 'ccw')], pairs: [['c1', 'c2'], ['s1', 'e2'], ['o', 'o']], own: ['c1', 's1', 'o'], equations: 5, freedom: 4 },
  'arcs sharing a center': { kind: 'arc', points: { z: [0, -5], s1: polar([0, -5], 10, 10), e1: polar([0, -5], 10, 70), s2: image(polar([0, -5], 10, 70)), e2: image(polar([0, -5], 10, 10)) },
    entities: [arc('A', 'z', 's1', 'e1', 'ccw'), arc('B', 'z', 's2', 'e2', 'ccw')], pairs: [['z', 'z'], ['s1', 'e2'], ['e1', 's2']], own: ['z', 's1', 'e1'], equations: 5, freedom: 4 },
  // A lens: the arcs share both ends, on the mirror.
  'arcs sharing both ends': { kind: 'arc', points: { c1: [-6, 2], s: [0, 12], e: [0, -8], c2: [6, 2] },
    entities: [arc('A', 'c1', 'e', 's', 'ccw'), arc('B', 'c2', 's', 'e', 'ccw')], pairs: [['c1', 'c2'], ['e', 'e'], ['s', 's']], own: ['c1', 'e', 's'], equations: 4, freedom: 3 },
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
/** Each relation that offers several starts, with how many, as the sketch compiles. */
const offered = (graph: CadSketchGraph) => compileCadSketchEquations({ graph, parameters: {} }).startChoices.map(({ relationId, costs }) => [relationId, costs.length]);
/**
 * Lines sharing an end that Fix holds, kept parallel and mirrored about a free construction line, which solve only from the mirror's
 * second start, with every id ending in `suffix` and every place moved `dx` along X. Solved, A stays, B folds out to (8, -12.5) and the
 * mirror lies square to A.
 */
const folding = (suffix = '', dx = 0) => {
  const id = (name: string) => name + suffix;
  return {
    points: Object.entries({ a1: [9.5, -5], a2: [11, 2.5], b1: [-.5, 17], b2: [-8.5, 14], m1: [1, -60], m2: [2, 60] }).map(([name, [x, y]]) => ({ id: id(name), position: [x + dx, y] })),
    entities: [line(id('A'), id('a1'), id('a2')), line(id('B'), id('b1'), id('b2')), { ...line(id('mirror'), id('m1'), id('m2')), construction: true }],
    relations: [{ id: id('p'), kind: 'parallel', lineIds: [id('A'), id('B')] }, { id: id('fix'), kind: 'fixed-point', pointId: id('a1'), position: [9.5 + dx, -5] },
      { id: id('shared'), kind: 'coincident', pointIds: [id('a1'), id('b1')] }, { id: id('mirrored'), kind: 'symmetric', curveIds: [id('A'), id('B')], lineId: id('mirror') }]
  };
};
/**
 * The two folding copies drawn elsewhere, with Parallel between their mirrors and no size dimensions, plus `extra`. Every start a solve
 * tries shrinks A2 and B2, 16.906 and 3.324 mm long, to 6.6e-6 mm.
 */
const shrinking = (extra: { readonly points?: readonly unknown[]; readonly entities?: readonly unknown[]; readonly relations?: readonly unknown[] } = {}) => parseCadSketchGraph({
  points: [...Object.entries({ a1: [9.5, -5], a2: [16.1, -4.5], b1: [-8.3, 26.7], b2: [-17.4, 12.3], m1: [-3.7, -65.3], m2: [10.6, 63.3],
    a12: [109.5, -5], a22: [102.1, 10.2], b12: [99.3, 18.5], b22: [100.5, 15.4], m12: [98.4, -52.8], m22: [106.4, 65.5] }).map(([id, position]) => ({ id, position })), ...extra.points ?? []],
  entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), { ...line('mirror', 'm1', 'm2'), construction: true },
    line('A2', 'a12', 'a22'), line('B2', 'b12', 'b22'), { ...line('mirror2', 'm12', 'm22'), construction: true }, ...extra.entities ?? []],
  relations: [{ id: 'p', kind: 'parallel', lineIds: ['A', 'B'] }, { id: 'fix', kind: 'fixed-point', pointId: 'a1', position: [9.5, -5] },
    { id: 'shared', kind: 'coincident', pointIds: ['a1', 'b1'] }, { id: 'mirrored', kind: 'symmetric', curveIds: ['A', 'B'], lineId: 'mirror' },
    { id: 'p2', kind: 'parallel', lineIds: ['A2', 'B2'] }, { id: 'fix2', kind: 'fixed-point', pointId: 'a12', position: [109.5, -5] },
    { id: 'shared2', kind: 'coincident', pointIds: ['a12', 'b12'] }, { id: 'mirrored2', kind: 'symmetric', curveIds: ['A2', 'B2'], lineId: 'mirror2' },
    { id: 'kept', kind: 'parallel', lineIds: ['mirror', 'mirror2'] }, ...extra.relations ?? []] });
/** Expects the sketch `folding(suffix, dx)` draws solved: A where it was, B folded out beyond the shared end and the mirror square to A. */
const expectFolded = (graph: CadSketchGraph, suffix = '', dx = 0) => {
  const at = positions(graph), [m1, m2] = [at.get(`m1${suffix}`)!, at.get(`m2${suffix}`)!];
  for (const [id, [x, y]] of [['a1', [9.5, -5]], ['a2', [11, 2.5]], ['b1', [9.5, -5]], ['b2', [8, -12.5]]] as const)
    expect(Math.hypot(at.get(id + suffix)!.x - x - dx, at.get(id + suffix)!.y - y), id + suffix).toBeLessThan(1e-7);
  expect(Math.abs((m2.x - m1.x) * 1.5 + (m2.y - m1.y) * 7.5) / Math.hypot(m2.x - m1.x, m2.y - m1.y), `mirror${suffix}`).toBeLessThan(1e-7);
};

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
    expect(cadSketchMirrorPairings(arcs(SCENES.arcs), identity)).toEqual([[{ pointIds: ['c1', 'c2'], self: false },
      { pointIds: ['e1', 's2'], self: false }, { pointIds: ['s1', 'e2'], self: false }]]);
    expect(cadSketchMirrorPairings(arcs(SCENES['arcs running opposite ways']), identity)).toEqual([[{ pointIds: ['c1', 'c2'], self: false },
      { pointIds: ['e1', 'e2'], self: false }, { pointIds: ['s1', 's2'], self: false }]]);
    // An end on the mirror pairs with itself and comes first.
    expect(cadSketchMirrorPairings(arcs(SCENES['arcs sharing an end']), identity)[0].map(pair => [pair.pointIds.join(' '), pair.self]))
      .toEqual([['c1 c2', false], ['o o', true], ['s1 e2', false]]);
    // Lines apart can pair either way until the geometry says which.
    expect(cadSketchMirrorPairings(arcs(SCENES.lines), identity).map(pairing => pairing.map(pair => pair.pointIds.join(' ')))).toEqual([['a1 b1', 'a2 b2'], ['a1 b2', 'a2 b1']]);
    // Lines that pair almost as near either way keep start with start unless crossing is nearer by more than the tie. B straddles the
    // middle of A's image about V, its ends t above and below it, so crossing is nearer by 8t of 2(1 + t)² in summed squared gaps.
    const tie = (t: number) => cadSketchMirrorPairs(arcs(SCENES.lines), { startPointId: '@origin', endPointId: '@v' }, identity,
      new Map([['a1', { x: 1, y: 0 }], ['a2', { x: 1, y: 2 }], ['b1', { x: -1, y: 1 + t }], ['b2', { x: -1, y: 1 - t }]])).map(pair => pair.pointIds.join(' '));
    expect([tie(0), tie(2e-10), tie(3e-10), tie(.25)]).toEqual([['a1 b1', 'a2 b2'], ['a1 b1', 'a2 b2'], ['a1 b2', 'a2 b1'], ['a1 b2', 'a2 b1']]);
  });

  it('lower each mirror whole, every equation a constraint of its own that yields and follows every other relation, a circle\'s radius among them', () => {
    for (const [name, scene] of Object.entries(SCENES)) for (const mirror of MIRRORS) {
      // An Equal stored after the mirror still lowers before it.
      const equal = scene.kind === 'line' ? { id: 'same', kind: 'equal-length', lineIds: ['A', 'B'] } : { id: 'same', kind: 'equal-radius', curveIds: ['A', 'B'] };
      const graph = graphOf(scene, mirror, { relations: [mirrored(mirror), equal] }), model = compileCadSketchEquations({ graph, parameters: {} });
      const own = model.equations.filter(equation => equation.sourceId === 'mirrored'), where = `${name} about ${mirror}`;
      expect(own, where).toHaveLength(scene.equations);
      expect(new Set(own.map(equation => equation.tag)).size, where).toBe(scene.equations);
      expect(own.every(equation => equation.yields), where).toBe(true);
      expect(model.equations.slice(-scene.equations), where).toEqual(own);
      expect(model.equations.some(equation => equation.sourceId !== 'mirrored' && equation.yields), where).toBe(false);
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
    // with B's first point held 0.5 mm along the mirror from its image; lines also square to the mirror, one or both, and circles' and
    // arcs' radii fixed alike on A, on B or on both, alone or beside Equal. Square to an axis is stored as Horizontal or Vertical. The mirror lines are fixed by
    // expressions, so they add no freedom of their own, and the answers agree in everything but the positions. A conflict planted farther
    // off is met at a stall, whose blame the solver documents as a suspicion: 1 mm away, the lens with its centre held collapses its ends
    // and is certified about the turned mirrors but left failed about V. Across the mirror, a turned mirror's rows let the solver name
    // another conflict witness, as valid, than about an axis.
    type Extra = 'none' | 'equal' | 'away' | 'square' | 'squares';
    type Sized = 'none' | 'A' | 'B' | 'both';
    const solver = await loadCadSketchTestNativeSolver();
    const solve = (scene: Scene, mirror: Mirror, held: Readonly<Record<string, 'expression' | 'fix'>>, extra: Extra, sized: Sized) => {
      const first = scene.pairs.find(pair => pair[0] !== pair[1])!, equal = scene.kind === 'line' ? { id: 'same', kind: 'equal-length', lineIds: ['A', 'B'] } : { id: 'same', kind: 'equal-radius', curveIds: ['A', 'B'] };
      const away = { id: 'away', kind: 'fixed-point', pointId: first[1], position: placed(mirror, [scene.points[first[1]][0], scene.points[first[1]][1] + .5]) };
      const square = (id: string) => {
        const ends = scene.entities.find(entity => entity.id === id) as ReturnType<typeof line>;
        return mirror === '@v' || mirror === '@h' ? { id: `square-${id}`, kind: mirror === '@v' ? 'horizontal' : 'vertical', pointIds: [ends.startPointId, ends.endPointId] }
          : { id: `square-${id}`, kind: 'perpendicular', lineIds: [id, 'mirror'] };
      };
      const sizedIds = sized === 'none' ? [] : sized === 'both' ? ['A', 'B'] : [sized];
      const radii = scene.kind === 'circle' ? Object.fromEntries(sizedIds.map(id => [id, '4'])) : {};
      // An arc's radius as drawn, so the radii fixed agree.
      const own = scene.entities[0] as ReturnType<typeof arc>, radius = () => Math.hypot(...[0, 1].map(axis => scene.points[own.startPointId][axis] - scene.points[own.centerPointId][axis]) as [number, number]);
      const sizes = scene.kind === 'arc' ? sizedIds.map(id => ({ id: `size-${id}`, kind: 'radial-size', entityId: id, quantity: 'radius', value: radius() })) : [];
      const extras = { none: [], equal: [equal], away: [away], square: [square('A')], squares: [square('A'), square('B')] }[extra];
      const graph = graphOf(scene, mirror, { held, radii, relations: [mirrored(mirror), ...extras, ...sizes] });
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
        const extras: readonly Extra[] = scene.kind === 'line' ? ['none', 'equal', 'away', 'square', 'squares'] : ['none', 'equal', 'away'];
        for (const extra of extras) for (const sized of scene.kind === 'line' || extra === 'away' ? ['none'] as const : ['none', 'A', 'B', 'both'] as const) {
          const answer = solve(scene, '@v', held, extra, sized);
          for (const mirror of MIRRORS.slice(1)) expect(solve(scene, mirror, held, extra, sized), JSON.stringify({ name, mirror, held, extra, sized })).toEqual(answer);
          seen.add(answer.kind); configurations++;
        }
      }
    }
    expect(configurations).toBe(3 * 9 * 5 + 5 * 27 * 9 + 3 * 9);
    // A failed solve is the lens whose ends collapse at the stall.
    expect(seen).toEqual(new Set(['solved', 'redundant', 'conflicting', 'failed']));
  });

  it('mirror two lines kept horizontal or vertical about H, V, a free construction line or a fixed oblique line, refusing directions no mirror keeps by name', async () => {
    // Every mix of nothing, Horizontal and Vertical on A and on B, about the axes, a free construction line drawn near V, and a line
    // fixed at 120°, V turned 30°. A mirror about a fixed line sends a direction θ to twice the line's less θ, so the lines' directions
    // agree with it or the mirror would collapse them; a free line turns to agree with any two, starting from the direction that moves
    // the sketch least. The mirror keeps what Horizontal or Vertical on one line adds to the other, so it takes exactly the freedom they leave
    // and none is redundant. Then, with the relations removed, the lines stay where they are, still mirrored, with the mirror's own freedom.
    const solver = await loadCadSketchTestNativeSolver();
    type Held = 'none' | 'horizontal' | 'vertical';
    type Mirrored = '@v' | '@h' | 'free' | 'oblique';
    const HELD: readonly Held[] = ['none', 'horizontal', 'vertical'], ANGLE: Readonly<Record<Mirrored, number | undefined>> = { '@v': 90, '@h': 0, free: undefined, oblique: 120 };
    const SUBJECT: Readonly<Record<Mirrored, string>> = { '@v': 'the V axis', '@h': 'the H axis', free: 'this line', oblique: 'this line' };
    const build = (mirror: Mirrored, onA: Held, onB: Held, drawn: readonly [Place, Place] = [[.5, -60], [-.5, 60]]) => {
      const turn = (p: Place): Place => mirror === '@h' ? [-p[1], p[0]] : mirror === 'oblique' ? placed('line', p) : p;
      const axis = mirror === 'free' ? [{ id: 'm1', position: drawn[0] }, { id: 'm2', position: drawn[1] }]
        : mirror === 'oblique' ? [{ id: 'm1', position: placed('line', [0, -60]).map(String) }, { id: 'm2', position: placed('line', [0, 60]).map(String) }] : [];
      const hold = (id: string, pointIds: readonly [string, string], how: Held) => how === 'none' ? [] : [{ id, kind: how, pointIds }];
      return {
        points: [...Object.entries(SCENES.lines.points).map(([id, p]) => ({ id, position: turn(p) })), ...axis],
        entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), ...axis.length ? [{ ...line('mirror', 'm1', 'm2'), construction: mirror === 'free' }] : []],
        relations: [...hold('onA', ['a1', 'a2'], onA), ...hold('onB', ['b1', 'b2'], onB)]
      };
    };
    const reflects = (graph: CadSketchGraph, mirror: Mirrored) => {
      const at = positions(graph), [m1, m2] = mirror === '@v' || mirror === '@h' ? [{ x: 0, y: 0 }, mirror === '@v' ? { x: 0, y: 1 } : { x: 1, y: 0 }] : [at.get('m1')!, at.get('m2')!];
      return [['a1', 'b1'], ['a2', 'b2']].every(([p, q]) => {
        const { x, y } = at.get(p)!, dx = m2.x - m1.x, dy = m2.y - m1.y, along = ((x - m1.x) * dx + (y - m1.y) * dy) / (dx * dx + dy * dy), target = at.get(q)!;
        return Math.hypot(2 * (m1.x + along * dx) - x - target.x, 2 * (m1.y + along * dy) - y - target.y) < 1e-7;
      });
    };
    const angle = (how: Held) => how === 'horizontal' ? 0 : 90, name = (how: Held) => how === 'horizontal' ? 'Horizontal' : 'Vertical';
    let applied = 0, refused = 0;
    for (const mirror of ['@v', '@h', 'free', 'oblique'] as const) for (const onA of HELD) for (const onB of HELD) {
      const where = `${onA} A, ${onB} B about ${mirror}`, raw = build(mirror, onA, onB), graph = parseCadSketchGraph(raw);
      const lineId = mirror === '@v' || mirror === '@h' ? mirror : 'mirror', relation = { kind: 'symmetric', curveIds: ['A', 'B'], lineId };
      const known = ANGLE[mirror], kept = (onA === 'none' ? 0 : 1) + (onB === 'none' ? 0 : 1);
      const agrees = known === undefined || onA === 'none' || onB === 'none' || ((2 * known - angle(onA) - angle(onB)) % 180 + 180) % 180 === 0;
      const solve = (relations: readonly unknown[]) => attemptCadSketchNativeSolve({ graph: parseCadSketchGraph({ ...raw, relations }), parameters: {}, analyseDefinition: true }, solver).result;
      if (!agrees) {
        const names = [...new Set([onA, onB].map(name))].join(' and ');
        const reason = `The ${names} relations keep these lines in directions that cannot mirror about ${SUBJECT[mirror]}. Remove one of them first.`;
        expect(offer(graph, ['A', 'B', lineId]), where).toMatchObject({ state: 'blocked', reason, relations: [] });
        expect(step(graph, 'symmetric', ['A', 'B', lineId]), where).toEqual({ status: 'invalid', reason });
        // Stored anyway, the mirror never solves.
        expect(solve([...raw.relations, mirrored(mirror === 'free' ? 'construction' : mirror === 'oblique' ? 'line' : mirror)]).kind, where).not.toBe('solved');
        refused++; continue;
      }
      expect(offer(graph, ['A', 'B', lineId]), where).toMatchObject({ state: 'available', relations: [relation] });
      const freedom = mirror === 'free' ? 8 - kept : 4 - Math.min(kept, 1), result = solve([...raw.relations, { id: 'mirrored', ...relation }]);
      if (result.kind !== 'solved') throw new Error(`${where}: ${result.message}`);
      expect(result.diagnostics, where).toMatchObject({ degreesOfFreedom: freedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      expect(reflects(result.graph, mirror), where).toBe(true);
      expect(checkCadSketchGraph(result.graph, {}), where).toEqual([]);
      const released = attemptCadSketchNativeSolve({ graph: { ...result.graph, relations: result.graph.relations.filter(stored => stored.id === 'mirrored') }, parameters: {}, analyseDefinition: true }, solver).result;
      if (released.kind !== 'solved') throw new Error(`${where} released: ${released.message}`);
      expect(released.diagnostics.degreesOfFreedom, where).toBe(mirror === 'free' ? 8 : 4);
      expect(reflects(released.graph, mirror), where).toBe(true);
      expect([...positions(released.graph)].every(([id, { x, y }]) => Math.hypot(x - positions(result.graph).get(id)!.x, y - positions(result.graph).get(id)!.y) < 1e-9), where).toBe(true);
      applied++;
    }
    expect([applied, refused]).toEqual([4 * 9 - 8, 8]);
  });

  it('turn a free mirror to the direction its lines leave it that moves the sketch least, counter-clockwise on a tie, and mirror from there', async () => {
    // The review's sketch, already valid: A level from (10, 5) to (25, 5), B upright from (-10, 5) to (-10, 20), and a free construction
    // line drawn near V, and the same with A upright and B level. One line level and the other upright mirror only about a line at 45°
    // or 135° through the mirror's middle, with B's ends paired either way: each start puts B on A's image and the mirror's ends on the
    // line, and the one that moves them least, summed squared, is taken however the mirror leans. Lines kept perpendicular, or parallel,
    // by a relation leave the mirror two directions about A's, a quarter turn apart. Where two starts move the sketch alike, as A level
    // above B upright about V does at 45° with B's ends straight and at 135° crossed, the mirror turns counter-clockwise. Each mirror
    // holds four of the free lines' freedoms, A stays where it is and the mirror turns about its middle.
    const solver = await loadCadSketchTestNativeSolver();
    const sketch = (points: Readonly<Record<string, Place>>, drawn: readonly [Place, Place], relations: readonly unknown[]) => ({
      points: [...Object.entries({ ...points, m1: drawn[0], m2: drawn[1] }).map(([id, position]) => ({ id, position }))],
      entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), { ...line('mirror', 'm1', 'm2'), construction: true }], relations });
    const level = { a1: [10, 5], a2: [25, 5], b1: [-10, 5], b2: [-10, 20] } as const, upright = { a1: [10, 5], a2: [10, 20], b1: [-10, 5], b2: [-25, 5] } as const;
    const above = { a1: [-5, 20], a2: [5, 20], b1: [0, -5], b2: [0, 5] } as const;
    const square = (id: string, kind: string, pointIds: readonly [string, string]) => ({ id, kind, pointIds });
    const levelUpright = [square('h', 'horizontal', ['a1', 'a2']), square('v', 'vertical', ['b1', 'b2'])], uprightLevel = [square('v', 'vertical', ['a1', 'a2']), square('h', 'horizontal', ['b1', 'b2'])];
    const [left, right, plumb] = [[[.5, -60], [-.5, 60]], [[-.5, -60], [.5, 60]], [[0, -60], [0, 60]]] as const;
    type Case = readonly [string, Readonly<Record<string, Place>>, readonly [Place, Place], readonly unknown[], number, number, Place, Place];
    const cases: readonly Case[] = [
      ['A level, B upright, drawn left of V', level, left, levelUpright, 45, 6, [5, 10], [5, 25]],
      ['A level, B upright, drawn right of V', level, right, levelUpright, 45, 6, [5, 10], [5, 25]],
      ['A upright, B level, drawn left of V', upright, left, uprightLevel, 135, 6, [-5, -10], [-20, -10]],
      ['A upright, B level, drawn on V', upright, plumb, uprightLevel, 135, 6, [-5, -10], [-20, -10]],
      ['A perpendicular to B', level, left, [{ id: 'p', kind: 'perpendicular', lineIds: ['A', 'B'] }], 45, 7, [5, 10], [5, 25]],
      ['A parallel to B at 45°', { a1: [10, 5], a2: [25, 20], b1: [-10, -5], b2: [-25, -20] }, left, [{ id: 'p', kind: 'parallel', lineIds: ['A', 'B'] }], 135, 7, [-5, -10], [-20, -25]],
      ['A level above B upright, drawn on V', above, plumb, levelUpright, 135, 6, [-20, -5], [-20, 5]]
    ];
    for (const [where, points, drawn, relations, direction, freedom, b1, b2] of cases) {
      const raw = sketch(points, drawn, relations), graph = parseCadSketchGraph(raw);
      expect(offer(graph, ['A', 'B', 'mirror']), where).toMatchObject({ state: 'available', relations: [{ kind: 'symmetric', curveIds: ['A', 'B'], lineId: 'mirror' }] });
      const { result } = attemptCadSketchNativeSolve({ graph: parseCadSketchGraph({ ...raw, relations: [...relations, mirrored('construction')] }), parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`${where}: ${result.message}`);
      expect(result.diagnostics, where).toMatchObject({ degreesOfFreedom: freedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      const at = positions(result.graph), [m1, m2] = [at.get('m1')!, at.get('m2')!];
      expect(((Math.atan2(m2.y - m1.y, m2.x - m1.x) * 180 / Math.PI) % 180 + 180) % 180, where).toBeCloseTo(direction, 9);
      expect(Math.hypot((m1.x + m2.x) / 2 - (drawn[0][0] + drawn[1][0]) / 2, (m1.y + m2.y) / 2 - (drawn[0][1] + drawn[1][1]) / 2), where).toBeLessThan(1e-9);
      for (const [id, place] of [['a1', points.a1], ['a2', points.a2], ['b1', b1], ['b2', b2]] as const)
        expect(Math.hypot(at.get(id)!.x - place[0], at.get(id)!.y - place[1]), `${where}: ${id}`).toBeLessThan(1e-7);
      expect(checkCadSketchGraph(result.graph, {}), where).toEqual([]);
    }
  });

  it('turn a free mirror a quarter turn counter-clockwise where both ways tie, however little noise tilts it', async () => {
    // Level A from (0, 1) to (2, 1) and level B from (0, 1) to (-2, 1) mirror only about a plumb line through their shared end, a quarter
    // turn either way from a free construction line drawn level from (-2, 0) to (2, 0). Tilted 1e-14 rad either way, within the angular
    // accuracy, it still turns counter-clockwise from the level drawing's starts: A and B stay, and the mirror turns about its middle to
    // run up from (0, -2) to (0, 2).
    const solver = await loadCadSketchTestNativeSolver();
    for (const tilt of [-1e-14, 0, 1e-14]) {
      const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
      const graph = parseCadSketchGraph({
        points: Object.entries({ a1: [0, 1], a2: [2, 1], b1: [0, 1], b2: [-2, 1], m1: [-2 * c, -2 * s], m2: [2 * c, 2 * s] }).map(([id, position]) => ({ id, position })),
        entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), { ...line('mirror', 'm1', 'm2'), construction: true }],
        relations: [{ id: 'ha', kind: 'horizontal', pointIds: ['a1', 'a2'] }, { id: 'hb', kind: 'horizontal', pointIds: ['b1', 'b2'] }, mirrored('construction')] });
      const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`tilted ${tilt}: ${result.message}`);
      expect(result.diagnostics, `tilted ${tilt}`).toMatchObject({ degreesOfFreedom: 6, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      const at = positions(result.graph);
      for (const [id, [x, y]] of [['a1', [0, 1]], ['a2', [2, 1]], ['b1', [0, 1]], ['b2', [-2, 1]], ['m1', [0, -2]], ['m2', [0, 2]]] as const)
        expect(Math.hypot(at.get(id)!.x - x, at.get(id)!.y - y), `tilted ${tilt}: ${id}`).toBeLessThan(1e-7);
    }
  });

  it('start and solve two mirrors that would both start one curve alike, whatever order the sketch stores its points, edges and relations in', async () => {
    // Level A and oblique C each mirror onto upright B about one free line drawn on V, so both would start B. The mirror whose id sorts
    // last starts it whatever the order, so every stored order compiles the same starts, point by point, and solves to one answer.
    const solver = await loadCadSketchTestNativeSolver();
    const points = Object.entries({ a1: [10, 5], a2: [25, 5], b1: [5, 10], b2: [5, 25], c1: [30, 7], c2: [12, 15], m1: [0, -60], m2: [0, 60] }).map(([id, position]) => ({ id, position }));
    const entities = [line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), line('C', 'c1', 'c2'), line('mirror', 'm1', 'm2')];
    const relations = [{ id: 'ab', kind: 'symmetric', curveIds: ['A', 'B'], lineId: 'mirror' }, { id: 'cb', kind: 'symmetric', curveIds: ['C', 'B'], lineId: 'mirror' }];
    const started = (graph: CadSketchGraph) => {
      const { values, pointParameters } = compileCadSketchEquations({ graph, parameters: {} });
      return Object.fromEntries([...pointParameters].map(([id, index]) => [id, [values[index], values[index + 1]]]).sort(([first], [second]) => first < second ? -1 : 1));
    };
    let first: { readonly starts: ReturnType<typeof started>; readonly at: ReturnType<typeof positions> } | undefined;
    for (const order of permutations(relations)) for (const reversed of [false, true]) {
      const where = `${order.map(relation => relation.id).join(', ')}${reversed ? ', points and edges reversed' : ''}`;
      const graph = parseCadSketchGraph({ points: reversed ? [...points].reverse() : points, entities: reversed ? [...entities].reverse() : entities, relations: order });
      const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`${where}: ${result.message}`);
      expect(result.diagnostics, where).toMatchObject({ degreesOfFreedom: 8, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      expect(checkCadSketchGraph(result.graph, {}), where).toEqual([]);
      const starts = started(graph), at = positions(result.graph);
      first ??= { starts, at };
      expect(starts, where).toEqual(first.starts);
      for (const [id, place] of first.at) expect(Math.hypot(at.get(id)!.x - place.x, at.get(id)!.y - place.y), `${where}: ${id}`).toBeLessThan(1e-9);
    }
  });

  it('keep the pairs relations already mirror about the line, fit the mirror to held ends, and turn it about an end held through Coincident', async () => {
    // The review's three sketches, about a free construction line drawn near V. A point Symmetric already mirrors a1 onto b1, so the
    // curves' mirror keeps that pairing; one mirroring a1 onto b2 instead, stored anyway as a file may, turns B over to keep it; and
    // with A level above B upright, which alone turns the mirror counter-clockwise to 135° with B's ends crossed, a point Symmetric of
    // a1 and b1 keeps them straight at 45°. The pairing the point Symmetric holds is never changed: only its two directions are starts,
    // and the first solves. All four ends held, by Fix or by their expressions, leave the mirror only their perpendicular bisector,
    // y = x, along which it still slides and stretches. A mirror whose start a Coincident holds at (0.5, -60) turns about that start,
    // and A, which nothing holds, stays where it is.
    const native = await loadCadSketchTestNativeSolver();
    let solves = 0;
    const solver = { ...native, solve: (...args: Parameters<typeof native.solve>) => { solves++; return native.solve(...args); } };
    const at = (graph: CadSketchGraph, id: string) => positions(graph).get(id)!;
    const sketch = (points: Readonly<Record<string, Place | readonly [string, string]>>, relations: readonly unknown[]) => parseCadSketchGraph({
      points: Object.entries(points).map(([id, position]) => ({ id, position })),
      entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), { ...line('mirror', 'm1', 'm2'), construction: true }], relations: [...relations, mirrored('construction')] });
    const levelUpright = [{ id: 'h', kind: 'horizontal', pointIds: ['a1', 'a2'] }, { id: 'v', kind: 'vertical', pointIds: ['b1', 'b2'] }];
    const pair = (pointIds: readonly [string, string]) => ({ id: 's', kind: 'symmetric', pointIds, lineId: 'mirror' });
    const apart = { a1: [10, 5], a2: [25, 5], b1: [-10, 5], b2: [-10, 20] } as const, above = { a1: [-5, 20], a2: [5, 20], b1: [0, -5], b2: [0, 5] } as const;
    const plumb = { m1: [0, -60], m2: [0, 60] } as const;
    const solved = (graph: CadSketchGraph, where: string, freedom: number, starts?: number) => {
      if (starts !== undefined) expect(offered(graph), where).toEqual([['mirrored', starts]]);
      solves = 0;
      const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`${where}: ${result.message}`);
      if (starts !== undefined) expect(solves, where).toBe(1);
      expect(result.diagnostics, where).toMatchObject({ degreesOfFreedom: freedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      expect(checkCadSketchGraph(result.graph, {}), where).toEqual([]);
      const [m1, m2] = [at(result.graph, 'm1'), at(result.graph, 'm2')];
      expect(((Math.atan2(m2.y - m1.y, m2.x - m1.x) * 180 / Math.PI) % 180 + 180) % 180, where).toBeCloseTo(45, 9);
      return result.graph;
    };
    const near = (graph: CadSketchGraph, places: Readonly<Record<string, Place>>, where: string) => {
      for (const [id, [x, y]] of Object.entries(places)) expect(Math.hypot(at(graph, id).x - x, at(graph, id).y - y), `${where}: ${id}`).toBeLessThan(1e-7);
    };
    near(solved(sketch({ ...apart, ...plumb }, [...levelUpright, pair(['a1', 'b1'])]), 'a1 onto b1', 6, 2), { ...apart, b1: [5, 10], b2: [5, 25] }, 'a1 onto b1');
    near(solved(sketch({ ...apart, ...plumb }, [...levelUpright, pair(['a1', 'b2'])]), 'a1 onto b2', 6, 2), { ...apart, b1: [5, 25], b2: [5, 10] }, 'a1 onto b2');
    near(solved(sketch({ ...above, ...plumb }, [...levelUpright, pair(['a1', 'b1'])]), 'above, a1 onto b1', 6, 2), { ...above, b1: [20, -5], b2: [20, 5] }, 'above, a1 onto b1');

    const ends = { a1: [10, 5], a2: [25, 5], b1: [5, 10], b2: [5, 25] } as const;
    for (const how of ['fix', 'expression'] as const) {
      const points = how === 'fix' ? ends : Object.fromEntries(Object.entries(ends).map(([id, place]) => [id, place.map(String) as unknown as readonly [string, string]]));
      const holds = how === 'fix' ? Object.entries(ends).map(([id, position]) => ({ id: `fix-${id}`, kind: 'fixed-point', pointId: id, position })) : [];
      const graph = solved(sketch({ ...points, ...plumb }, holds), `four ends held by ${how}`, 2);
      near(graph, ends, `four ends held by ${how}`);
      for (const id of ['m1', 'm2']) expect(Math.abs(at(graph, id).x - at(graph, id).y), `four ends held by ${how}: ${id} on y = x`).toBeLessThan(1e-7);
    }

    const pinned = solved(sketch({ ...apart, m1: [.5, -60], m2: [-.5, 60], pin: ['0.5', '-60'] }, [...levelUpright, { id: 'c', kind: 'coincident', pointIds: ['m1', 'pin'] }]), 'a start held through Coincident', 4);
    near(pinned, { a1: apart.a1, a2: apart.a2, m1: [.5, -60], pin: [.5, -60], b1: [65.5, -50.5], b2: [65.5, -35.5] }, 'a start held through Coincident');
  });

  it('solve from the next start where the least moved one can meet the mirror only by collapsing the curves', async () => {
    // Lines sharing an end that Fix holds, kept parallel, mirror about a line through that end, along them or square to them. Along
    // them moves the sketch least, laying B over A, but the solve meets that only by collapsing both, so the next start, square to
    // them, solves with B folded out beyond the shared end: two native solves.
    const native = await loadCadSketchTestNativeSolver();
    let solves = 0;
    const solver = { ...native, solve: (...args: Parameters<typeof native.solve>) => { solves++; return native.solve(...args); } };
    const graph = parseCadSketchGraph(folding());
    expect(offered(graph)).toEqual([['mirrored', 2]]);
    const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(solves).toBe(2);
    expect(result.diagnostics).toMatchObject({ degreesOfFreedom: 4, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
    expectFolded(result.graph);
    expect(checkCadSketchGraph(result.graph, {})).toEqual([]);
  });

  it('keep each mirror\'s start that solved while the next start of another is tried, and search mirrors whose parameters connect together', async () => {
    // Two copies of the folding sketch 100 mm apart each solve only from their mirror's second start. Apart, each copy is a component of
    // its own: the first solve fails in both, the second keeps the first copy's second start, and the third adds the second copy's, so
    // three native solves, the sum of their starts and not the product. Retrying one mirror never resets the other's. Parallel between
    // the two mirrors joins the copies into one component, whose combinations are tried least moved first: both first starts, then one
    // second start and the other, then both, which solves on the fourth solve with each copy as it solves alone. Stored after the copies,
    // Parallel changes the order the solver receives equations, and one of the mixed combinations then meets every relation by shrinking
    // A to about 2.6e-6 mm: that shrink ranks the combination below one that keeps A and leaves the component failing, so the search
    // still reaches both second starts.
    const native = await loadCadSketchTestNativeSolver();
    let solves = 0;
    const solver = { ...native, solve: (...args: Parameters<typeof native.solve>) => { solves++; return native.solve(...args); } };
    const [first, second] = [folding(), folding('2', 100)];
    const apart = { points: [...first.points, ...second.points], entities: [...first.entities, ...second.entities], relations: [...first.relations, ...second.relations] };
    const cases = [
      ['apart', apart, [['mirrored'], ['mirrored2']], 3, 8],
      ['with parallel mirrors', { ...apart, relations: [{ id: 'kept', kind: 'parallel', lineIds: ['mirror', 'mirror2'] }, ...apart.relations] }, [['mirrored', 'mirrored2']], 4, 7],
      ['with parallel mirrors stored after the copies', { ...apart, relations: [...apart.relations, { id: 'kept', kind: 'parallel', lineIds: ['mirror', 'mirror2'] }] }, [['mirrored', 'mirrored2']], 4, 7]
    ] as const;
    for (const [where, raw, grouped, count, freedom] of cases) {
      const graph = parseCadSketchGraph(raw);
      expect(offered(graph), where).toEqual([['mirrored', 2], ['mirrored2', 2]]);
      expect(cadSketchStartComponents(compileCadSketchEquations({ graph, parameters: {} })).map(({ choices }) => choices.map(choice => choice.relationId)), where).toEqual(grouped);
      solves = 0;
      const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`${where}: ${result.message}`);
      expect(solves, where).toBe(count);
      expect(result.diagnostics, where).toMatchObject({ degreesOfFreedom: freedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      expectFolded(result.graph);
      expectFolded(result.graph, '2', 100);
      expect(checkCadSketchGraph(result.graph, {}), where).toEqual([]);
    }
  });

  it('pass over a start that shrinks a mirrored curve below the fraction for one that keeps it, and take the start just above the fraction', async () => {
    // The two failing copies with Parallel between their mirrors stored after them reach, before both second starts, a combination
    // that meets every relation with A only micrometres long. Measured with nothing ranked, that shrink is a ratio far below
    // `mirrorCollapseRelative`. With the fraction moved just above the ratio, the search passes that combination over and solves from
    // both second starts; just below it, the combination is the first answer found and is kept, micro line and all. A fraction above 1
    // ranks every start down alike: the copies then keep the first answer found, and a sketch whose first start solves, A level and B
    // upright about a free line drawn near V, tries each other start before keeping its first.
    const native = await loadCadSketchTestNativeSolver();
    let solves = 0;
    const solver = { ...native, solve: (...args: Parameters<typeof native.solve>) => { solves++; return native.solve(...args); } };
    const [first, second] = [folding(), folding('2', 100)];
    const graph = parseCadSketchGraph({ points: [...first.points, ...second.points], entities: [...first.entities, ...second.entities],
      relations: [...first.relations, ...second.relations, { id: 'kept', kind: 'parallel', lineIds: ['mirror', 'mirror2'] }] });
    const length = (of: CadSketchGraph, id: string) => {
      const at = positions(of), entity = of.entities.find(item => item.id === id) as ReturnType<typeof line>;
      return Math.hypot(at.get(entity.endPointId)!.x - at.get(entity.startPointId)!.x, at.get(entity.endPointId)!.y - at.get(entity.startPointId)!.y);
    };
    const solveWith = (fraction: number, sketch = graph) => {
      precision.mirrorCollapseRelative = fraction;
      try {
        solves = 0;
        const { result } = attemptCadSketchNativeSolve({ graph: sketch, parameters: {}, analyseDefinition: true }, solver);
        if (result.kind !== 'solved') throw new Error(`fraction ${fraction}: ${result.message}`);
        expect(checkCadSketchGraph(result.graph, {}), `fraction ${fraction}`).toEqual([]);
        return result.graph;
      } finally { precision.mirrorCollapseRelative = undefined; }
    };
    const unranked = solveWith(0), unrankedSolves = solves;
    const ratio = Math.min(...['A', 'B', 'A2', 'B2'].map(id => length(unranked, id) / length(graph, id)));
    // A and B, 7.6 and 8.5 mm long, both end about 2.6e-6 mm long, 29 and 32 times below the fraction.
    expect(CAD_PRECISION.mirrorCollapseRelative / ratio).toBeGreaterThan(25);
    expect(length(unranked, 'A')).toBeLessThan(1e-5);
    const passedOver = solveWith(ratio * 1.01);
    expect(solves).toBe(4);
    expectFolded(passedOver);
    expectFolded(passedOver, '2', 100);
    const kept = solveWith(ratio * .99);
    expect(solves).toBe(unrankedSolves);
    expect(positions(kept)).toEqual(positions(unranked));
    expect(positions(solveWith(2))).toEqual(positions(unranked));
    const turned = parseCadSketchGraph({ points: Object.entries({ a1: [10, 5], a2: [25, 5], b1: [-10, 5], b2: [-10, 20], m1: [.5, -60], m2: [-.5, 60] }).map(([id, position]) => ({ id, position })),
      entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), { ...line('mirror', 'm1', 'm2'), construction: true }],
      relations: [{ id: 'h', kind: 'horizontal', pointIds: ['a1', 'a2'] }, { id: 'v', kind: 'vertical', pointIds: ['b1', 'b2'] }, mirrored('construction')] });
    const starts = Number(offered(turned)[0][1]), firstSolved = solveWith(0, turned);
    expect(solves).toBe(1);
    expect(starts).toBeGreaterThan(1);
    expect(positions(solveWith(2, turned))).toEqual(positions(firstSolved));
    expect(solves).toBe(starts);
  });

  it('pass over a start that shrinks a mirror\'s lines for one that keeps them while a dimension shrinks another mirror\'s circles from every start', async () => {
    // The two failing copies with Parallel between their mirrors stored after them, as above, and circles C and D apart about V, C held
    // by Fix and its radius dimensioned from 10 to 1e-5 mm. Every solve shrinks the circles, so even the first answer that meets every
    // relation, A and B micrometres long, is not certain; the search passes it over for both second starts, whose answer shrinks only
    // the circles, and keeps that rather than the first shrunk answer it met. The dimension asks for the circles' shrink: no warning.
    const native = await loadCadSketchTestNativeSolver();
    let solves = 0;
    const solver = { ...native, solve: (...args: Parameters<typeof native.solve>) => { solves++; return native.solve(...args); } };
    const [first, second] = [folding(), folding('2', 100)];
    const graph = parseCadSketchGraph({ points: [...first.points, ...second.points, { id: 'c1', position: [-40, 30] }, { id: 'c2', position: [40, 30] }],
      entities: [...first.entities, ...second.entities, { ...circle('C', 'c1'), radius: 10 }, { ...circle('D', 'c2'), radius: 10 }],
      relations: [...first.relations, ...second.relations, { id: 'kept', kind: 'parallel', lineIds: ['mirror', 'mirror2'] },
        { id: 'cfix', kind: 'fixed-point', pointId: 'c1', position: [-40, 30] }, { id: 'size', kind: 'radial-size', entityId: 'C', quantity: 'radius', value: 1e-5 },
        { id: 'circle-mirror', kind: 'symmetric', curveIds: ['C', 'D'], lineId: '@v' }] });
    const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(solves).toBe(4);
    expect(result.diagnostics).toMatchObject({ degreesOfFreedom: 7, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
    expect(cadSketchShrinkWarnings(graph, result.graph, {})).toEqual([]);
    expect(checkCadSketchGraph(result.graph, {})).toEqual([]);
    expectFolded(result.graph);
    expectFolded(result.graph, '2', 100);
    expect(result.graph.entities.flatMap(entity => entity.kind === 'circle' ? [Number(entity.radius)] : [])).toEqual([1e-5, 1e-5]);
  });

  it('shrink mirrored lines by a dimension far below the fraction directly or in steps to the same geometry, where no start keeps them', async () => {
    // A from (10,5) to (1010,5) mirrored about V, its start held by Fix and kept level, and its length dimensioned from 1000 to
    // 0.0099 mm, 1e-5 of 990: every start shrinks A alike, so the solve keeps it, with no freedom left, as it does going through 1 mm.
    const solver = await loadCadSketchTestNativeSolver();
    const sketch = (from: CadSketchGraph | undefined, value: number) => parseCadSketchGraph(from
      ? { ...from, relations: from.relations.map(relation => relation.id === 'length' ? { ...relation, value } : relation) }
      : { points: Object.entries({ a1: [10, 5], a2: [1010, 5], b1: [-10, 5], b2: [-1010, 5] }).map(([id, position]) => ({ id, position })), entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2')],
        relations: [{ id: 'fix', kind: 'fixed-point', pointId: 'a1', position: [10, 5] }, { id: 'h', kind: 'horizontal', pointIds: ['a1', 'a2'] },
          { id: 'length', kind: 'distance', pointIds: ['a1', 'a2'], value: 1000 }, mirrored('@v')] });
    const solved = (graph: CadSketchGraph, label: string) => {
      const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`${label}: ${result.message}`);
      expect(result.diagnostics, label).toMatchObject({ degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      // The dimension asks for the shrink, so nothing warns of it.
      expect(cadSketchShrinkWarnings(graph, result.graph, {}), label).toEqual([]);
      expect(checkCadSketchGraph(result.graph, {}), label).toEqual([]);
      return result.graph;
    };
    const start = sketch(undefined, 1000), direct = solved(sketch(start, .0099), 'directly');
    const stepped = solved(sketch(solved(sketch(start, 1), 'to 1 mm'), .0099), 'in steps');
    expect(.0099).toBeLessThan(CAD_PRECISION.mirrorCollapseRelative * 1000);
    expect(positions(direct).get('a2')!.x - positions(direct).get('a1')!.x).toBeCloseTo(.0099, 12);
    expect(positions(direct).get('b2')!.x).toBeCloseTo(-10.0099, 12);
    expect(positions(stepped)).toEqual(positions(direct));
    // A construction line on A's ends shares its length, and a dimension to a point Coincident with A's end sets it alike: no warning.
    const length = (relation: (typeof start.relations)[number]) => relation.id === 'length' ? { ...relation, value: .0099 } : relation;
    const along = solved(parseCadSketchGraph({ ...start, entities: [...start.entities, { ...line('along', 'a1', 'a2'), construction: true }], relations: start.relations.map(length) }), 'beside a construction line');
    expect(positions(along)).toEqual(positions(direct));
    const aliased = solved(parseCadSketchGraph({ ...start, points: [...start.points, { id: 'z', position: [1010, 5] }],
      relations: [...start.relations.map(relation => relation.id === 'length' ? { ...length(relation), pointIds: ['a1', 'z'] } : relation), { id: 'alias', kind: 'coincident', pointIds: ['z', 'a2'] }] }), 'to an alias');
    expect(positions(aliased).get('a2')).toEqual(positions(direct).get('a2'));
  });

  it('keep a start that met everything but a shrink a dimension asks for while the next mirror\'s start is tried, directly or in steps alike', async () => {
    // Two failing copies of the folding sketch apart, the first with circles C and D mirrored about V, C's centre on A's held end and its
    // radius dimensioned from 10 to 1e-5 mm, a millionth. Every start of the first copy shrinks C alike, so its second start, which folds
    // its lines, is kept with that shrink while the second copy's second start is tried: three solves, the sum of the starts. Going
    // through radius 1 mm first reaches the same geometry.
    const native = await loadCadSketchTestNativeSolver();
    let solves = 0;
    const solver = { ...native, solve: (...args: Parameters<typeof native.solve>) => { solves++; return native.solve(...args); } };
    const [first, second] = [folding(), folding('2', 100)];
    const sized = (radius: number, from = parseCadSketchGraph({ points: [...first.points, { id: 'c1', position: [9.5, -5] }, { id: 'c2', position: [-9.5, -5] }, ...second.points],
      entities: [...first.entities, { ...circle('C', 'c1'), radius: 10 }, { ...circle('D', 'c2'), radius: 10 }, ...second.entities],
      relations: [...first.relations, { id: 'join-circle', kind: 'coincident', pointIds: ['a1', 'c1'] }, { id: 'size', kind: 'radial-size', entityId: 'C', quantity: 'radius', value: 1 },
        { id: 'circle-mirror', kind: 'symmetric', curveIds: ['C', 'D'], lineId: '@v' }, ...second.relations] })) =>
      parseCadSketchGraph({ ...from, relations: from.relations.map(relation => relation.id === 'size' ? { ...relation, value: radius } : relation) });
    const solved = (graph: CadSketchGraph, label: string) => {
      solves = 0;
      const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`${label}: ${result.message}`);
      expect(result.diagnostics, label).toMatchObject({ degreesOfFreedom: 8, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      // C's dimension sets both radii, D's through the Symmetric, so nothing warns of the shrink.
      expect(cadSketchShrinkWarnings(graph, result.graph, {}), label).toEqual([]);
      expect(checkCadSketchGraph(result.graph, {}), label).toEqual([]);
      expectFolded(result.graph);
      expectFolded(result.graph, '2', 100);
      return result.graph;
    };
    const start = sized(1e-5);
    expect(offered(start)).toEqual([['mirrored', 2], ['mirrored2', 2]]);
    expect(1e-5).toBeLessThan(CAD_PRECISION.mirrorCollapseRelative * 10);
    const direct = solved(start, 'directly');
    expect(solves).toBe(3);
    const radii = (graph: CadSketchGraph) => graph.entities.flatMap(entity => entity.kind === 'circle' ? [Number(entity.radius)] : []);
    expect(radii(direct)).toEqual([1e-5, 1e-5]);
    expect(positions(direct).get('c2')).toEqual({ x: -9.5, y: -5 });
    const stepped = solved(sized(1e-5, solved(sized(1), 'to 1 mm')), 'in steps');
    expect(positions(stepped)).toEqual(positions(direct));
    expect(radii(stepped)).toEqual(radii(direct));
  });

  it('keep a dimension that shrinks mirrored curves just under or just over the fraction where no other start does better', async () => {
    // Lines and circles already mirrored about V, A's start or centre held by Fix, and A's length or radius set by a dimension to just
    // over and just under `mirrorCollapseRelative` of its size before the solve. A mirror about an axis offers no other start, so both
    // solves keep the size the dimension asks for, and pass the graph checks.
    const solver = await loadCadSketchTestNativeSolver();
    const scenes = [
      { name: 'lines', size: 15, points: { a1: [10, 5], a2: [25, 5], b1: [-10, 5], b2: [-25, 5] }, entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2')],
        relations: (value: number) => [{ id: 'fix', kind: 'fixed-point', pointId: 'a1', position: [10, 5] }, { id: 'h', kind: 'horizontal', pointIds: ['a1', 'a2'] },
          { id: 'length', kind: 'distance', pointIds: ['a1', 'a2'], value }],
        sized: (at: ReturnType<typeof positions>) => Math.hypot(at.get('a2')!.x - at.get('a1')!.x, at.get('a2')!.y - at.get('a1')!.y) },
      { name: 'circles', size: 4, points: { k1: [15, 8], k2: [-15, 8] }, entities: [circle('A', 'k1'), circle('B', 'k2')],
        relations: (value: number) => [{ id: 'fix', kind: 'fixed-point', pointId: 'k1', position: [15, 8] }, { id: 'radius', kind: 'radial-size', entityId: 'A', quantity: 'radius', value }],
        sized: (_: ReturnType<typeof positions>, graph: CadSketchGraph) => Number((graph.entities.find(entity => entity.id === 'B') as { readonly radius: number }).radius) }
    ] as const;
    for (const { name, size, points, entities, relations, sized } of scenes) for (const [where, fraction] of [['just over', 1.01], ['just under', .99]] as const) {
      const value = size * CAD_PRECISION.mirrorCollapseRelative * fraction, label = `${name} ${where} the fraction`;
      const graph = parseCadSketchGraph({ points: Object.entries(points).map(([id, position]) => ({ id, position })), entities, relations: [...relations(value), mirrored('@v')] });
      expect(offered(graph), label).toEqual([]);
      const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`${label}: ${result.message}`);
      expect(sized(positions(result.graph), result.graph), label).toBeCloseTo(value, 12);
      expect(cadSketchShrinkWarnings(graph, result.graph, {}), label).toEqual([]);
      expect(checkCadSketchGraph(result.graph, {}), label).toEqual([]);
    }
  });

  it('warn, naming each curve with its size before and after, where a committed solve keeps mirrored curves shrunk that nothing sizes', async () => {
    // The reviewer's sketch (see `shrinking`): every start the solve tries shrinks A2 and B2, so it keeps the first such answer, and a
    // committed edit warns. A Y distance between A2's ends sets only a projection: with one of 1e-5 mm the solve still shrinks both lines,
    // to 2.1e-5 mm, though going through 5e-6 mm first leaves A2 7.4 mm long, so nothing forces the shrink and it is warned of alike.
    const native = await loadCadSketchTestNativeSolver();
    let solves = 0;
    const solver = { ...native, solve: (...args: Parameters<typeof native.solve>) => { solves++; return native.solve(...args); } };
    const graph = shrinking();
    const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(solves).toBe(4);
    expect(result.diagnostics).toMatchObject({ degreesOfFreedom: 7, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
    const message = 'Symmetric shrank Line 2 from 16.906 mm to 0.000007 mm and Line 4 from 3.324 mm to 0.000007 mm. Check the mirror and its relations.';
    const warnings = cadSketchShrinkWarnings(graph, result.graph, {});
    expect(warnings).toEqual([{ code: 'mirror-shrank', relationId: 'mirrored2', message, curves: [
      { entityId: 'A2', beforeMm: expect.closeTo(16.906, 3), afterMm: expect.closeTo(6.575e-6, 9) },
      { entityId: 'B2', beforeMm: expect.closeTo(3.324, 3), afterMm: expect.closeTo(6.575e-6, 9) }] }]);
    const projected = shrinking({ relations: [{ id: 'rise', kind: 'axis-distance', axis: 'y', pointIds: ['a12', 'a22'], value: 1e-5 }] });
    const rise = attemptCadSketchNativeSolve({ graph: projected, parameters: {}, analyseDefinition: true }, solver).result;
    if (rise.kind !== 'solved') throw new Error(rise.message);
    expect(cadSketchShrinkWarnings(projected, rise.graph, {})).toEqual([{ code: 'mirror-shrank', relationId: 'mirrored2', curves: [
      { entityId: 'A2', beforeMm: expect.closeTo(16.906, 3), afterMm: expect.closeTo(2.0662e-5, 9) }, { entityId: 'B2', beforeMm: expect.closeTo(3.324, 3), afterMm: expect.closeTo(2.0662e-5, 9) }],
      message: 'Symmetric shrank Line 2 from 16.906 mm to 0.00002 mm and Line 4 from 3.324 mm to 0.00002 mm. Check the mirror and its relations.' }]);
    // A committed batch that solves the sketch lists the warning with it; a preview, which asks for none, lists nothing.
    const document = parseCadDocument({ ...createCadDocument('Folds', 'folds'), schemaVersion: 2 });
    const added: readonly CadEdit[] = [{ kind: 'add-feature', feature: { id: 'folds', kind: 'sketch', name: 'Folds', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph } }];
    expect((await prepareCadEdits(document, added, createCadSketchTestSolver(), undefined, { warnings: true })).sketchWarnings).toEqual([{ ...warnings[0], sketchId: 'folds', sketchName: 'Folds' }]);
    expect((await prepareCadEdits(document, added, createCadSketchTestSolver())).sketchWarnings).toEqual([]);
    // A committed drag puts its point where it is dragged, so it asks for the shrink that follows: A's end dragged to within 1e-4 mm of
    // its held start shrinks A and its mirror far below the fraction, and nothing warns.
    const lines = graphOf(SCENES.lines, '@v', { held: { a1: 'fix' }, relations: [mirrored('@v')] });
    const drawn = parseCadDocument({ ...document, features: [{ id: 'mirror', kind: 'sketch', name: 'Mirror', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: lines }] });
    const dragged = await prepareCadEdits(drawn, [{ kind: 'move-sketch-point', sketchId: 'mirror', pointId: 'a2', translation: [-15 + 1e-4, -15] }], createCadSketchTestSolver(), undefined, { warnings: true });
    const sketch = dragged.document.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected the dragged sketch.');
    expect(Math.hypot(...[0, 1].map(axis => Number(sketch.graph!.points.find(point => point.id === 'b2')!.position[axis]) - [-10.0001, 5][axis]))).toBeLessThan(1e-9);
    expect(cadSketchShrinkWarnings(lines, sketch.graph, {}).map(warning => warning.relationId)).toEqual(['mirrored']);
    expect(dragged.sketchWarnings).toEqual([]);
  });

  it('warn of mirrored arcs a distance between their ends shrinks, as it sets only the chord, but not of arcs a radius leg sizes', async () => {
    // Quarter arcs of radius 1000 mirrored about V, A's radius legs kept Horizontal and Vertical. A chord of 0.0099 mm between A's ends
    // shrinks both radii to 0.0099/√2 mm, far below the fraction, yet sizes neither arc, so a committed solve warns; the same radius
    // dimensioned from A's centre to its start sets it, and nothing warns.
    const solver = await loadCadSketchTestNativeSolver();
    const quarters = (sizing: Record<string, unknown>) => parseCadSketchGraph({
      points: [{ id: 'c1', position: [1500, 0] }, { id: 's1', position: [2500, 0] }, { id: 'e1', position: [1500, 1000] },
        { id: 'c2', position: [-1500, 0] }, { id: 's2', position: [-1500, 1000] }, { id: 'e2', position: [-2500, 0] }],
      entities: [arc('A', 'c1', 's1', 'e1', 'ccw'), arc('B', 'c2', 's2', 'e2', 'ccw')],
      relations: [{ id: 'leg', kind: 'horizontal', pointIds: ['c1', 's1'] }, { id: 'rise', kind: 'vertical', pointIds: ['c1', 'e1'] }, sizing, mirrored('@v')] });
    const radii = (graph: CadSketchGraph) => ['A', 'B'].map(id => {
      const curve = graph.entities.find(entity => entity.id === id)!, at = positions(graph);
      if (curve.kind !== 'arc') throw new Error('Expected an arc.');
      return Math.hypot(at.get(curve.startPointId)!.x - at.get(curve.centerPointId)!.x, at.get(curve.startPointId)!.y - at.get(curve.centerPointId)!.y);
    });
    const radius = 0.0099 / Math.SQRT2;
    const chorded = quarters({ id: 'chord', kind: 'distance', pointIds: ['s1', 'e1'], value: 0.0099 });
    const chord = attemptCadSketchNativeSolve({ graph: chorded, parameters: {}, analyseDefinition: true }, solver).result;
    if (chord.kind !== 'solved') throw new Error(chord.message);
    expect(checkCadSketchGraph(chord.graph, {})).toEqual([]);
    for (const size of radii(chord.graph)) expect(Math.abs(size - radius)).toBeLessThan(1e-9);
    expect(cadSketchShrinkWarnings(chorded, chord.graph, {})).toEqual([{ code: 'mirror-shrank', relationId: 'mirrored', curves: [
      { entityId: 'A', beforeMm: expect.closeTo(1000, 9), afterMm: expect.closeTo(radius, 9) }, { entityId: 'B', beforeMm: expect.closeTo(1000, 9), afterMm: expect.closeTo(radius, 9) }],
      message: 'Symmetric shrank the radius of Arc 1 from 1000.000 mm to 0.007 mm and the radius of Arc 2 from 1000.000 mm to 0.007 mm. Check the mirror and its relations.' }]);
    const legged = quarters({ id: 'reach', kind: 'distance', pointIds: ['c1', 's1'], value: radius });
    const leg = attemptCadSketchNativeSolve({ graph: legged, parameters: {}, analyseDefinition: true }, solver).result;
    if (leg.kind !== 'solved') throw new Error(leg.message);
    for (const size of radii(leg.graph)) expect(Math.abs(size - radius)).toBeLessThan(1e-9);
    expect(cadSketchShrinkWarnings(legged, leg.graph, {})).toEqual([]);
  });

  it('keep the start search\'s answer over a later retry that shrinks the same curves, as it keeps the first shrunk answer', async () => {
    // The reviewer's sketch (see `shrinking`) beside a circle of radius 1 held at the origin, with a point held on it starting 4e-13 mm
    // above its centre. Every start shrinks A2 and B2 alike; the first solve and the start search move the point straight up to (0, 1),
    // and the retries from one radius out along X, along Y and diagonally then solve too. Keeping the last shrunk answer instead of the
    // first would leave the point diagonal.
    const native = await loadCadSketchTestNativeSolver();
    let solves = 0;
    const solver = { ...native, solve: (...args: Parameters<typeof native.solve>) => { solves++; return native.solve(...args); } };
    const graph = shrinking({ points: [{ id: 'k', position: [0, 0] }, { id: 'q', position: [0, 4e-13] }], entities: [{ ...circle('K', 'k'), radius: 1 }],
      relations: [{ id: 'held', kind: 'fixed-point', pointId: 'k', position: [0, 0] }, { id: 'unit', kind: 'radial-size', entityId: 'K', quantity: 'radius', value: 1 },
        { id: 'on', kind: 'point-on-curve', pointId: 'q', curveId: 'K' }] });
    const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver);
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(solves).toBe(7);
    expect(result.diagnostics).toMatchObject({ degreesOfFreedom: 8, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
    expect(checkCadSketchGraph(result.graph, {})).toEqual([]);
    const q = positions(result.graph).get('q')!;
    expect(Math.hypot(q.x, q.y - 1)).toBeLessThan(1e-12);
    expect(cadSketchShrinkWarnings(graph, result.graph, {}).map(warning => warning.relationId)).toEqual(['mirrored2']);
  });

  it('find the edges whose size a dimension or an expression sets, and the edges Equal or a curve Symmetric sizes alike', () => {
    // Driven: a line by its own ends' distance, or by both their X and Y offsets, set by X and Y distances or Horizontal with an X
    // distance; a construction line on a dimensioned line's ends; a line whose end is Coincident with a point a distance dimensions; an arc
    // by its centre's distance from an end; a circle by a radius dimension or an expression; and what Equal or a Symmetric joins to those.
    // Free: a line whose ends only an X distance sets, a line whose ends a distance spans only through another point, and a mirrored pair
    // nothing sizes.
    const point = (id: string, x: number, y: number) => ({ id, position: [x, y] });
    const graph = parseCadSketchGraph({ points: [point('a', 0, 0), point('b', 10, 0), point('c', 0, 10), point('d', 10, 12), point('e', 20, 0), point('f', 30, 0),
      point('o', 50, 0), point('s', 55, 0), point('t', 50, 5), point('k', 70, 0), point('q', 90, 0), point('g', 0, 40), point('h', 10, 40), point('i', 0, 50), point('j', 10, 50),
      point('u', 0, 60), point('v', 10, 60), point('w', 20, 60), point('x', 0, -20), point('y', 10, -20), point('l1', 0, 70), point('l2', 10, 70), point('n1', 0, 80), point('n2', 10, 90),
      point('r1', 20, -40), point('r2', 30, -40), point('z', 30, -40)],
    entities: [line('measured', 'a', 'b'), line('stepped', 'c', 'd'), line('equal', 'e', 'f'), { id: 'bend', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 's', endPointId: 't', direction: 'ccw' },
      { ...circle('expressed', 'k'), radius: 'r' }, circle('sized', 'q'), line('left', 'g', 'h'), line('right', 'i', 'j'), line('spanned', 'u', 'v'), line('mirroredMeasured', 'x', 'y'),
      line('level', 'l1', 'l2'), line('projected', 'n1', 'n2'), { ...line('alongside', 'a', 'b'), construction: true }, line('aliased', 'r1', 'r2')],
    relations: [{ id: 'length', kind: 'distance', pointIds: ['b', 'a'], value: 10 }, { id: 'across', kind: 'axis-distance', axis: 'x', pointIds: ['c', 'd'], value: 10 },
      { id: 'same', kind: 'equal-length', lineIds: ['measured', 'equal'] }, { id: 'reach', kind: 'distance', pointIds: ['o', 't'], value: 5 },
      { id: 'radius', kind: 'radial-size', entityId: 'sized', quantity: 'diameter', value: 8 }, { id: 'through', kind: 'distance', pointIds: ['u', 'w'], value: 20 },
      { id: 'free-mirror', kind: 'symmetric', curveIds: ['left', 'right'], lineId: '@h' }, { id: 'sized-mirror', kind: 'symmetric', curveIds: ['measured', 'mirroredMeasured'], lineId: '@h' },
      { id: 'flat', kind: 'horizontal', pointIds: ['l1', 'l2'] }, { id: 'run', kind: 'axis-distance', axis: 'x', pointIds: ['l2', 'l1'], value: 10 },
      { id: 'dx', kind: 'axis-distance', axis: 'x', pointIds: ['n1', 'n2'], value: 10 }, { id: 'dy', kind: 'axis-distance', axis: 'y', pointIds: ['n2', 'n1'], value: 10 },
      { id: 'alias', kind: 'coincident', pointIds: ['z', 'r2'] }, { id: 'aliasLength', kind: 'distance', pointIds: ['r1', 'z'], value: 10 }] });
    expect([...cadSketchDrivenSizes(graph)].sort()).toEqual(['aliased', 'alongside', 'bend', 'equal', 'expressed', 'level', 'measured', 'mirroredMeasured', 'projected', 'sized']);
  });

  it('try a component\'s start combinations least moved first, ties by the first relation\'s order, up to the cap', () => {
    const component = (...costs: readonly (readonly number[])[]) => ({ choices: costs.map((list, at) => ({ relationId: `r${at}`, costs: list })) });
    const order = (combinations: readonly Readonly<Record<string, number>>[]) => combinations.map(combination => Object.values(combination).join(''));
    expect(order(cadSketchStartCombinations(component([0, 1, 5], [0, 2]), CAD_SKETCH_START_COMBINATIONS))).toEqual(['00', '10', '01', '11', '20', '21']);
    // Equal sums, and sums within the tie tolerance of each other, go to the combination that keeps the earlier relation's start.
    expect(order(cadSketchStartCombinations(component([3, 4], [3, 4 * (1 + 1e-12)]), CAD_SKETCH_START_COMBINATIONS))).toEqual(['00', '01', '10', '11']);
    const capped = cadSketchStartCombinations(component([0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]), CAD_SKETCH_START_COMBINATIONS);
    expect(capped).toHaveLength(CAD_SKETCH_START_COMBINATIONS);
    expect(order(capped).slice(0, 4)).toEqual(['000', '001', '010', '100']);
    expect(new Set(order(capped)).size).toBe(CAD_SKETCH_START_COMBINATIONS);
  });

  it('mirror about a free line from held points without moving them, or refuse naming what holds them, alike for Fix, expressions, Coincident and fixed distances', async () => {
    // Lines already mirrored about y = x and lines apart with B upright left of V, each alone and kept level and upright, arcs mirrored
    // about y = x and circles apart, about a free construction line drawn on V, with each set of their points and the mirror's start held
    // four ways: by Fix, by their expressions, by Coincident with an expression-fixed point, and by fixed X and Y distances. Each solves
    // with nothing held moved, or is refused naming the relations that hold it, and the four holds give one answer. Both ends of a line
    // held make Horizontal or Vertical redundant; held points that leave the mirror no line conflict with it, naming the holds, which
    // expressions are not, and the relations keeping the lines' directions where those decide it.
    const solver = await loadCadSketchTestNativeSolver();
    type Hold = 'fix' | 'expression' | 'coincident' | 'distances';
    const HOLDS: readonly Hold[] = ['fix', 'expression', 'coincident', 'distances'];
    const swap = ([x, y]: Place): Place => [y, x], [c1, s1, e1] = [[20, 10], polar([20, 10], 5, 15), polar([20, 10], 5, 105)] as const;
    const levelUpright = [{ id: 'h', kind: 'horizontal', pointIds: ['a1', 'a2'] }, { id: 'v', kind: 'vertical', pointIds: ['b1', 'b2'] }];
    const lineSets = [[], ['a1'], ['b1'], ['a1', 'a2'], ['a1', 'b1'], ['a1', 'b2'], ['a1', 'a2', 'b1', 'b2'], ['m1'], ['m1', 'a1'], ['m1', 'a1', 'b1']];
    const lines = [line('A', 'a1', 'a2'), line('B', 'b1', 'b2')], mirroredLines = { a1: [10, 5], a2: [25, 5], b1: [5, 10], b2: [5, 25] } as const;
    const apartLines = { a1: [10, 5], a2: [25, 5], b1: [-10, 5], b2: [-10, 20] } as const;
    const scenes: readonly { name: string; points: Readonly<Record<string, Place>>; entities: readonly unknown[]; relations: readonly unknown[]; sets: readonly (readonly string[])[] }[] = [
      { name: 'lines mirrored about y = x', points: mirroredLines, entities: lines, relations: [], sets: lineSets },
      { name: 'lines mirrored about y = x, level and upright', points: mirroredLines, entities: lines, relations: levelUpright, sets: lineSets },
      { name: 'lines apart', points: apartLines, entities: lines, relations: [], sets: lineSets },
      { name: 'lines apart, level and upright', points: apartLines, entities: lines, relations: levelUpright, sets: lineSets },
      { name: 'arcs mirrored about y = x', points: { c1, s1, e1, c2: swap(c1), s2: swap(e1), e2: swap(s1) }, entities: [arc('A', 'c1', 's1', 'e1', 'ccw'), arc('B', 'c2', 's2', 'e2', 'ccw')],
        relations: [], sets: [[], ['c1'], ['c1', 'c2'], ['s1', 'e2'], ['c1', 's1'], ['m1'], ['m1', 'c1'], ['m1', 'c1', 'c2']] },
      { name: 'circles apart', points: { k1: [15, 8], k2: [-10, -12] }, entities: [circle('A', 'k1'), circle('B', 'k2')], relations: [], sets: [[], ['k1'], ['k1', 'k2'], ['m1'], ['m1', 'k1'], ['m1', 'k1', 'k2']] }
    ];
    const refused: Record<string, string> = {};
    let configurations = 0;
    for (const { name, points: drawn, entities, relations: kept, sets } of scenes) for (const held of sets) {
      const where = `${name} holding ${held.length ? held.join(' ') : 'nothing'}`, answers = new Set<string>();
      for (const how of HOLDS) {
        const points: { id: string; position: readonly (number | string)[] }[] = [], holds: { id: string }[] = [];
        for (const [id, place] of Object.entries({ ...drawn, m1: [0, -60], m2: [0, 60] } as Record<string, Place>)) {
          const hold = held.includes(id);
          points.push({ id, position: hold && how === 'expression' ? place.map(String) : place });
          if (!hold) continue;
          if (how === 'fix') holds.push({ id: `fix-${id}`, kind: 'fixed-point', pointId: id, position: place } as { id: string });
          if (how === 'coincident') { points.push({ id: `pin-${id}`, position: place.map(String) }); holds.push({ id: `on-${id}`, kind: 'coincident', pointIds: [id, `pin-${id}`] } as { id: string }); }
          if (how === 'distances') holds.push(...(['x', 'y'] as const).map((axis, index) => ({ id: `${axis}-${id}`, kind: 'fixed-axis', pointId: id, axis, value: place[index] })));
        }
        const graph = parseCadSketchGraph({ points, entities: [...entities, { ...line('mirror', 'm1', 'm2'), construction: true }], relations: [...holds, ...kept, mirrored('construction')] });
        const { result } = attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, solver), holdIds = holds.map(hold => hold.id);
        if (result.kind === 'solved') {
          const before = positions(graph), after = positions(result.graph);
          const moved = [...before].filter(([id, { x, y }]) => (held.includes(id) || id.startsWith('pin-')) && Math.hypot(after.get(id)!.x - x, after.get(id)!.y - y) > 1e-9).map(([id]) => id);
          expect(moved, `${where} by ${how}`).toEqual([]);
          expect(checkCadSketchGraph(result.graph, {}), `${where} by ${how}`).toEqual([]);
          answers.add(`solved with ${result.diagnostics.degreesOfFreedom} free`);
        } else {
          const { conflictingIds, redundantIds, partiallyRedundantIds } = result.diagnostics, named = conflictingIds.filter(id => !holdIds.includes(id));
          expect(conflictingIds.filter(id => holdIds.includes(id)), `${where} by ${how}`).toEqual(result.reason === 'conflicting' ? holdIds : []);
          expect(named.length + redundantIds.length + partiallyRedundantIds.length, `${where} by ${how}`).toBeGreaterThan(0);
          answers.add([result.reason, named.length ? `conflicting ${named.join(' ')}` : '', redundantIds.length ? `redundant ${redundantIds.join(' ')}` : '',
            partiallyRedundantIds.length ? `partly redundant ${partiallyRedundantIds.join(' ')}` : ''].filter(Boolean).join(', '));
        }
        configurations++;
      }
      expect([...answers], where).toHaveLength(1);
      const [answer] = answers;
      if (!answer.startsWith('solved')) refused[where] = answer;
    }
    expect(configurations).toBe((4 * 10 + 8 + 6) * 4);
    expect(refused).toEqual({
      'lines mirrored about y = x, level and upright holding a1 a2': 'redundant, redundant h',
      'lines mirrored about y = x, level and upright holding a1 a2 b1 b2': 'redundant, redundant h v',
      'lines mirrored about y = x, level and upright holding m1 a1 b1': 'conflicting, conflicting mirrored',
      'lines apart holding a1 a2 b1 b2': 'conflicting, conflicting mirrored',
      'lines apart, level and upright holding a1 a2': 'redundant, redundant h',
      'lines apart, level and upright holding a1 a2 b1 b2': 'conflicting, conflicting mirrored, redundant h v',
      'lines apart, level and upright holding m1 a1 b1': 'conflicting, conflicting h v mirrored',
      'arcs mirrored about y = x holding m1 c1 c2': 'conflicting, conflicting mirrored',
      'circles apart holding m1 k1 k2': 'conflicting, conflicting mirrored'
    });
  });

  it('search for a start only where a mirror is not met already, and never retry a drag from another start', async () => {
    // The level and upright lines mirrored about a free line at 45°: compiled again, or with A's end or the mirror's dragged, the mirror
    // already holds, so it offers no starts and moves nothing before the solve; and a drag of the sketch before it was mirrored makes
    // one native solve whatever it answers, as the further starts are for storing a relation.
    const native = await loadCadSketchTestNativeSolver();
    let solves = 0;
    const solver = { ...native, solve: (...args: Parameters<typeof native.solve>) => { solves++; return native.solve(...args); } };
    const stored = parseCadSketchGraph({
      points: Object.entries({ a1: [10, 5], a2: [25, 5], b1: [-10, 5], b2: [-10, 20], m1: [.5, -60], m2: [-.5, 60] }).map(([id, position]) => ({ id, position })),
      entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), { ...line('mirror', 'm1', 'm2'), construction: true }],
      relations: [{ id: 'h', kind: 'horizontal', pointIds: ['a1', 'a2'] }, { id: 'v', kind: 'vertical', pointIds: ['b1', 'b2'] }, mirrored('construction')] });
    expect(offered(stored)).toEqual([['mirrored', 4]]);
    const first = attemptCadSketchNativeSolve({ graph: stored, parameters: {}, analyseDefinition: true }, solver).result;
    if (first.kind !== 'solved') throw new Error(first.message);
    const at = positions(first.graph);
    for (const drag of [undefined, { pointId: 'a2', position: [30, 5] as const }, { pointId: 'm2', position: [50, 45] as const }]) {
      const where = drag ? `dragging ${drag.pointId}` : 'compiled again', model = compileCadSketchEquations({ graph: first.graph, parameters: {}, drag });
      expect(model.startChoices, where).toEqual([]);
      for (const [id, index] of model.pointParameters) if (at.has(id)) expect([model.values[index], model.values[index + 1]], `${where}: ${id}`).toEqual([at.get(id)!.x, at.get(id)!.y]);
      solves = 0;
      expect(attemptCadSketchNativeSolve({ graph: first.graph, parameters: {}, drag }, solver).result.kind, where).toBe('solved');
      expect(solves, where).toBe(1);
    }
    solves = 0;
    attemptCadSketchNativeSolve({ graph: stored, parameters: {}, drag: { pointId: 'a2', position: [30, 5] } }, solver);
    expect(solves).toBe(1);
  });

  it('refuse a mirror that could only be met by collapsing the curves, with the reason, and never store the collapse', async () => {
    // A level and B upright, about a construction line whose ends Fixed x keeps on V: a mirror the curves can meet only at zero length.
    // The planner refuses it; stored anyway, as a file or an edit may, the solve is refused with the reason rather than collapsing them.
    const solver = await loadCadSketchTestNativeSolver();
    const raw = { points: [{ id: 'a1', position: [10, 5] }, { id: 'a2', position: [25, 5] }, { id: 'b1', position: [-10, 5] }, { id: 'b2', position: [-10, 20] }, { id: 'm1', position: [0, -60] }, { id: 'm2', position: [0, 60] }],
      entities: [line('A', 'a1', 'a2'), line('B', 'b1', 'b2'), { ...line('mirror', 'm1', 'm2'), construction: true }],
      relations: [{ id: 'h', kind: 'horizontal', pointIds: ['a1', 'a2'] }, { id: 'v', kind: 'vertical', pointIds: ['b1', 'b2'] },
        { id: 'x1', kind: 'fixed-axis', pointId: 'm1', axis: 'x', value: 0 }, { id: 'x2', kind: 'fixed-axis', pointId: 'm2', axis: 'x', value: 0 }] };
    expect(offer(parseCadSketchGraph(raw), ['A', 'B', 'mirror'])).toMatchObject({ state: 'blocked', reason: 'The Horizontal and Vertical relations keep these lines in directions that cannot mirror about this line. Remove one of them first.' });
    const { result } = attemptCadSketchNativeSolve({ graph: parseCadSketchGraph({ ...raw, relations: [...raw.relations, mirrored('construction')] }), parameters: {}, analyseDefinition: true }, solver);
    expect(result).toMatchObject({ kind: 'rejected', reason: 'failed', message: CAD_SKETCH_MIRROR_COLLAPSE });
    expect(result.kind === 'rejected' && result.diagnostics.issues?.map(issue => [issue.source.id, issue.code])).toEqual([['A', 'degenerate-entity'], ['B', 'degenerate-entity']]);
  });

  it('mirror two lines beside Parallel, Perpendicular or Collinear, Equal, a point mirror or a hold on an axis, refusing only what cannot mirror', async () => {
    // Each case lists what A and B keep, the mirror, and the freedom the mirror leaves, or why it is refused. A refused mirror is a
    // construction line, which is the mirror whichever way the lines are picked; among three ordinary lines, another may mirror the rest.
    const solver = await loadCadSketchTestNativeSolver();
    const relation = (id: string, kind: string, lineIds: readonly [string, string]) => ({ id, kind, lineIds });
    const zero = (id: string, pointId: string, axis: 'x' | 'y') => ({ id, kind: 'fixed-axis', pointId, axis, value: 0 });
    const free = { points: [{ id: 'm1', position: [.5, -60] }, { id: 'm2', position: [-.5, 60] }], entities: [{ ...line('mirror', 'm1', 'm2'), construction: true }] };
    type Case = { readonly scene: Scene; readonly mirror: Mirror | 'free'; readonly relations: readonly unknown[]; readonly moved?: Options['moved']; readonly freedom?: number; readonly reason?: string };
    // Lines parallel or collinear across V turn level or upright; drawn at 45° they would start where neither is nearer, a stationary point.
    const shallow = { a2: [25, 9], b2: [-25, 9] } as const;
    const cases: Readonly<Record<string, Case>> = {
      'A parallel to a fixed line': { scene: SCENES.lines, mirror: 'line', relations: [relation('p', 'parallel', ['A', 'mirror'])], freedom: 3 },
      'both perpendicular to a fixed line': { scene: SCENES.lines, mirror: 'line', relations: [relation('p', 'perpendicular', ['A', 'mirror']), relation('q', 'perpendicular', ['mirror', 'B'])], freedom: 3 },
      'both parallel to a free line': { scene: SCENES.lines, mirror: 'free', relations: [relation('p', 'parallel', ['A', 'mirror']), relation('q', 'parallel', ['B', 'mirror'])], freedom: 7 },
      'the lines parallel, about V': { scene: SCENES.lines, mirror: '@v', relations: [relation('p', 'parallel', ['A', 'B'])], moved: shallow, freedom: 3 },
      'the lines collinear, about V': { scene: SCENES.lines, mirror: '@v', relations: [relation('c', 'collinear', ['A', 'B'])], moved: shallow, freedom: 3 },
      'equal lines about V': { scene: SCENES.lines, mirror: '@v', relations: [{ id: 'e', kind: 'equal-length', lineIds: ['A', 'B'] }], freedom: 4 },
      'a point mirror about H': { scene: SCENES.lines, mirror: '@h', relations: [{ id: 's', kind: 'symmetric', pointIds: ['a2', 'b2'], lineId: '@h' }], freedom: 4 },
      'A on the H axis, about V': { scene: SCENES.lines, mirror: '@v', relations: [zero('y1', 'a1', 'y'), zero('y2', 'a2', 'y')], freedom: 2 },
      'both on the H axis, about V': { scene: SCENES.lines, mirror: '@v', relations: [zero('y1', 'a1', 'y'), zero('y2', 'a2', 'y'), zero('y3', 'b1', 'y'), zero('y4', 'b2', 'y')], freedom: 2 },
      'a shared end held on V': { scene: SCENES['lines sharing an end'], mirror: '@v', relations: [zero('x', 'v', 'x')], freedom: 3 },
      'a shared end on a line': { scene: SCENES['lines sharing an end'], mirror: 'line', relations: [{ id: 'on', kind: 'point-on-line', pointId: 'v', lineId: 'mirror' }], freedom: 3 },
      'A parallel and B perpendicular to a fixed construction line': { scene: SCENES.lines, mirror: 'construction', relations: [relation('p', 'parallel', ['A', 'mirror']), relation('q', 'perpendicular', ['B', 'mirror'])],
        reason: 'The Parallel and Perpendicular relations keep these lines in directions that cannot mirror about this line. Remove one of them first.' },
      'A parallel and B perpendicular to a free line': { scene: SCENES.lines, mirror: 'free', relations: [relation('p', 'parallel', ['A', 'mirror']), relation('q', 'perpendicular', ['B', 'mirror'])],
        reason: 'The Parallel and Perpendicular relations keep these lines in directions that cannot mirror about this line. Remove one of them first.' },
      'A fixed level and B horizontal, about a fixed construction line': { scene: SCENES.lines, mirror: 'construction', relations: [{ id: 'f1', kind: 'fixed-point', pointId: 'a1', position: [0, 0] },
        { id: 'f2', kind: 'fixed-point', pointId: 'a2', position: [9, 0] }, { id: 'h', kind: 'horizontal', pointIds: ['b1', 'b2'] }],
        reason: 'The Horizontal relation keeps these lines in directions that cannot mirror about this line. Remove it first.' },
      'A horizontal through B parallel to it, about a fixed construction line': { scene: SCENES.lines, mirror: 'construction', relations: [{ id: 'h', kind: 'horizontal', pointIds: ['a1', 'a2'] }, relation('p', 'parallel', ['B', 'A'])],
        reason: 'The Horizontal and Parallel relations keep these lines in directions that cannot mirror about this line. Remove one of them first.' }
    };
    for (const [where, { scene, mirror, relations, moved, freedom, reason }] of Object.entries(cases)) {
      const raw = rawScene(scene, mirror === 'free' ? '@v' : mirror, { relations, moved });
      const sketch = mirror === 'free' ? { ...raw, points: [...raw.points, ...free.points], entities: [...raw.entities, ...free.entities] } : raw;
      const lineId = mirror === 'free' ? 'mirror' : lineOf(mirror), graph = parseCadSketchGraph(sketch), stored = { id: 'mirrored', kind: 'symmetric', curveIds: ['A', 'B'], lineId };
      const { result } = attemptCadSketchNativeSolve({ graph: parseCadSketchGraph({ ...sketch, relations: [...sketch.relations, stored] }), parameters: {}, analyseDefinition: true }, solver);
      if (reason) {
        expect(offer(graph, ['A', 'B', lineId]), where).toMatchObject({ state: 'blocked', reason });
        expect(result.kind, where).not.toBe('solved');
        continue;
      }
      expect(offer(graph, ['A', 'B', lineId]), where).toMatchObject({ state: 'available', relations: [{ kind: 'symmetric', curveIds: ['A', 'B'], lineId }] });
      if (result.kind !== 'solved') throw new Error(`${where}: ${result.message}`);
      expect(result.diagnostics, where).toMatchObject({ degreesOfFreedom: freedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      expect(checkCadSketchGraph(result.graph, {}), where).toEqual([]);
    }
  });

  it('mirror circles and arcs whose radii are fixed alike on either or both, and refuse fixed radii that differ', async () => {
    // A circle's radius fixed by an expression or a radius of numbers alone, or an arc's by a radius, on A, on B or on both. The mirror
    // keeps what one fixed radius gives the other, so a radius fixed on both takes nothing more; radii fixed apart conflict and are
    // refused before they are stored.
    const solver = await loadCadSketchTestNativeSolver();
    const size = (id: string, entityId: string, value: number | string, quantity: 'radius' | 'diameter' = 'radius') => ({ id, kind: 'radial-size', entityId, quantity, value });
    type Case = { readonly scene: Scene; readonly radii?: Readonly<Record<string, number | string>>; readonly relations?: readonly unknown[]; readonly freedom?: number };
    const cases: Readonly<Record<string, Case>> = {
      'circle A by expression': { scene: SCENES.circles, radii: { A: '4' }, freedom: 2 },
      'circle B by expression': { scene: SCENES.circles, radii: { B: '4' }, freedom: 2 },
      'both circles by expression': { scene: SCENES.circles, radii: { A: '4', B: '2 * 2' }, freedom: 2 },
      'circle A by expression and B by diameter': { scene: SCENES.circles, radii: { A: '4' }, relations: [size('d', 'B', 8, 'diameter')], freedom: 2 },
      'both circles by radius': { scene: SCENES.circles, relations: [size('r1', 'A', 4), size('r2', 'B', '4')], freedom: 2 },
      'arc A by radius': { scene: SCENES.arcs, relations: [size('r1', 'A', 5)], freedom: 4 },
      'arc B by radius': { scene: SCENES.arcs, relations: [size('r2', 'B', 5)], freedom: 4 },
      'both arcs by radius': { scene: SCENES.arcs, relations: [size('r1', 'A', 5), size('r2', 'B', 5)], freedom: 4 },
      'both arcs fixed at two points': { scene: SCENES.arcs, relations: ['c1', 's1', 'c2', 's2'].map(id => ({ id: `fix-${id}`, kind: 'fixed-point', pointId: id, position: placed('construction', SCENES.arcs.points[id]) })), freedom: 0 },
      'circles by expression apart': { scene: SCENES.circles, radii: { A: '4', B: '5' } },
      'circles by expression and radius apart': { scene: SCENES.circles, radii: { A: '4' }, relations: [size('r2', 'B', 5)] },
      'arcs by radius apart': { scene: SCENES.arcs, relations: [size('r1', 'A', 5), size('r2', 'B', 6)] },
      'arcs fixed and by radius apart': { scene: SCENES.arcs, relations: [size('r2', 'B', 6), ...['c1', 's1'].map(id => ({ id: `fix-${id}`, kind: 'fixed-point', pointId: id, position: placed('construction', SCENES.arcs.points[id]) }))] }
    };
    for (const [where, { scene, radii, relations, freedom }] of Object.entries(cases)) {
      const raw = rawScene(scene, 'construction', { radii, relations }), graph = parseCadSketchGraph(raw);
      const { result } = attemptCadSketchNativeSolve({ graph: parseCadSketchGraph({ ...raw, relations: [...raw.relations, mirrored('construction')] }), parameters: {}, analyseDefinition: true }, solver);
      if (freedom === undefined) {
        expect(offer(graph, ['A', 'B', 'mirror']), where).toMatchObject({ state: 'blocked', reason: `These ${scene.kind}s have fixed radii that differ, so they cannot mirror each other.` });
        // Stored anyway, the mirror never solves: the solver blames it, or stalls where the radii pull the arcs apart.
        expect(result.kind, where).toBe('rejected');
        if (scene.kind === 'circle') expect(result.diagnostics.conflictingIds, where).toContain('mirrored');
        continue;
      }
      expect(offer(graph, ['A', 'B', 'mirror']), where).toMatchObject({ state: 'available', relations: [{ kind: 'symmetric', curveIds: ['A', 'B'], lineId: 'mirror' }] });
      if (result.kind !== 'solved') throw new Error(`${where}: ${result.message}`);
      expect(result.diagnostics, where).toMatchObject({ degreesOfFreedom: freedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
      expect(checkCadSketchGraph(result.graph, {}), where).toEqual([]);
    }
  });

  it('mirror arcs onto the true image from any start, moving the second onto the first, and never solve onto another branch', async () => {
    // The review's arcs about V: A from (25, 10) to (20, 15) about (20, 10), B from (-20, 15) to (-15, 10) about (-20, 10), both
    // counterclockwise. B starts on the image of A's end, so it ends on A's side of its own centre, where one equation of each end pair
    // used to let it stay. The mirror moves B onto A's image and leaves A where it is.
    const solver = await loadCadSketchTestNativeSolver();
    const A = { c1: [20, 10], s1: [25, 10], e1: [20, 15] } as const;
    const arcs = (b: { readonly centre: Place; readonly start: Place; readonly end: Place; readonly direction: 'ccw' | 'cw' }): Scene => ({
      kind: 'arc', points: { ...A, c2: b.centre, s2: b.start, e2: b.end }, entities: [arc('A', 'c1', 's1', 'e1', 'ccw'), arc('B', 'c2', 's2', 'e2', b.direction)],
      pairs: b.direction === 'ccw' ? [['c1', 'c2'], ['s1', 'e2'], ['e1', 's2']] : [['c1', 'c2'], ['s1', 's2'], ['e1', 'e2']], own: ['c1', 's1', 'e1'], equations: 6, freedom: 5 });
    const run = (scene: Scene, mirror: Mirror, options: Options) => {
      const graph = graphOf(scene, mirror, { ...options, relations: [mirrored(mirror), ...options.relations ?? []] });
      return { graph, result: attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: false }, solver).result };
    };
    const repro = arcs({ centre: [-20, 10], start: [-20, 15], end: [-15, 10], direction: 'ccw' }), { result } = run(repro, '@v', {});
    if (result.kind !== 'solved') throw new Error(result.message);
    expect(Object.fromEntries([...positions(result.graph)].map(([id, { x, y }]) => [id, [+x.toFixed(9), +y.toFixed(9)]])))
      .toEqual({ c1: [20, 10], s1: [25, 10], e1: [20, 15], c2: [-20, 10], s2: [-20, 15], e2: [-25, 10] });
    // B's centre and start fixed elsewhere and A free: A's centre and end move onto their images, its start stays on its circle and B's
    // end follows it.
    const held = run(repro, '@v', { held: { c2: 'expression', s2: 'expression' }, moved: { c2: [-22, 11], s2: [-22, 16], e2: [-27, 11] } });
    if (held.result.kind !== 'solved') throw new Error(held.result.message);
    const moved = positions(held.result.graph), at = (id: string) => [+moved.get(id)!.x.toFixed(9), +moved.get(id)!.y.toFixed(9)];
    expect([at('c1'), at('e1'), at('e2')]).toEqual([[22, 11], [22, 16], [-at('s1')[0], at('s1')[1]]]);
    expect(Math.hypot(at('s1')[0] - 22, at('s1')[1] - 11)).toBeCloseTo(5, 9);

    // Around it: B's centre, radius, ends and direction swept, A free or its centre and start fixed by expressions or held by Fix, alone or
    // resized by a radius on A or B, about V and a fixed line at 120°. A solve lands on the true mirror or fails; A held stays, and a
    // radius A held cannot take fails.
    const counts = { solved: 0, failed: 0 };
    for (const mirror of ['@v', 'line'] as const) for (const centre of [[-20, 10], [-16, 13]] as const) for (const radius of [3, 6]) for (const start of [0, 100, 190, 280])
      for (const sweep of [60, 200]) for (const direction of ['ccw', 'cw'] as const) for (const hold of ['free', 'expression', 'fix'] as const) for (const resize of ['none', 'A', 'B'] as const) {
        const scene = arcs({ centre, start: polar(centre, radius, start), end: polar(centre, radius, direction === 'ccw' ? start + sweep : start - sweep), direction });
        const options: Options = { held: hold === 'free' ? {} : { c1: hold, s1: hold }, relations: resize === 'none' ? [] : [{ id: 'size', kind: 'radial-size', entityId: resize, quantity: 'radius', value: 7 }] };
        const where = JSON.stringify({ mirror, centre, radius, start, sweep, direction, hold, resize }), { graph, result } = run(scene, mirror, options);
        const reachable = hold === 'free' || resize === 'none';
        if (result.kind !== 'solved') {
          expect(reachable, `${where}: ${result.message}`).toBe(false);
          counts.failed++; continue;
        }
        expect(reachable, where).toBe(true);
        const at = positions(result.graph), [m1, m2] = mirror === '@v' ? [{ x: 0, y: 0 }, { x: 0, y: 1 }] : [at.get('m1')!, at.get('m2')!];
        for (const [p, q] of scene.pairs) {
          const { x, y } = at.get(p)!, dx = m2.x - m1.x, dy = m2.y - m1.y, along = ((x - m1.x) * dx + (y - m1.y) * dy) / (dx * dx + dy * dy), target = at.get(q)!;
          expect(Math.hypot(2 * (m1.x + along * dx) - x - target.x, 2 * (m1.y + along * dy) - y - target.y), `${where}: ${p} onto ${q}`).toBeLessThan(1e-7);
        }
        if (resize === 'none') for (const id of scene.own) expect(Math.hypot(at.get(id)!.x - positions(graph).get(id)!.x, at.get(id)!.y - positions(graph).get(id)!.y), `${where}: ${id} stays`).toBeLessThan(1e-9);
        expect(checkCadSketchGraph(result.graph, {}), where).toEqual([]);
        counts.solved++;
      }
    expect(counts).toEqual({ solved: 2 * 2 * 2 * 4 * 2 * 2 * 5, failed: 2 * 2 * 2 * 4 * 2 * 2 * 4 });
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
    const whole = graphOf(SCENES.circles, 'construction', { relations: [pair('c', ['k1', 'k2']), { id: 'same', kind: 'equal-radius', curveIds: ['B', 'A'] }] });
    expect(offer(whole, ['B', 'A', 'mirror'])).toMatchObject({ state: 'applied', relationIds: ['c', 'same'] });
  });

  it('add the curves\' Symmetric where other relations keep part of the mirror, which it yields to, and solve to the whole mirror with the freedom left', async () => {
    // Half a line mirror, a circle's radius or centres, part of an arc mirror, an Equal the mirror keeps too, a shared end already on
    // the mirror, and point mirrors beside an Equal: each is completed by the curves' Symmetric, which solves without redundancy.
    const solver = await loadCadSketchTestNativeSolver();
    const pair = (id: string, pointIds: readonly [string, string]) => ({ id, kind: 'symmetric', pointIds, lineId: 'mirror' });
    const equalLength = { id: 'same', kind: 'equal-length', lineIds: ['A', 'B'] }, equalRadius = { id: 'same', kind: 'equal-radius', curveIds: ['A', 'B'] };
    const cases: readonly (readonly [string, Scene, readonly unknown[]])[] = [
      ['half a line mirror', SCENES.lines, [pair('p1', ['a1', 'b1'])]],
      ['half a line mirror running the other way', SCENES['lines running opposite ways'], [pair('p2', ['a2', 'b2'])]],
      ['equal lines', SCENES.lines, [equalLength]],
      ['half a line mirror and equal lines', SCENES.lines, [pair('p1', ['a1', 'b1']), equalLength]],
      ['a shared end on the mirror', SCENES['lines sharing an end'], [{ id: 'on', kind: 'point-on-line', pointId: 'v', lineId: 'mirror' }]],
      ['equal circles', SCENES.circles, [equalRadius]],
      ['mirrored centres', SCENES.circles, [pair('c', ['k1', 'k2'])]],
      ['mirrored arc centres', SCENES.arcs, [pair('c', ['c1', 'c2'])]],
      ['mirrored arc ends and equal arcs', SCENES.arcs, [pair('e', ['e1', 's2']), equalRadius]],
      ['equal arcs', SCENES['arcs sharing an end'], [equalRadius]],
      ['a shared arc end on the mirror', SCENES['arcs sharing an end'], [{ id: 'on', kind: 'point-on-line', pointId: 'o', lineId: 'mirror' }]]
    ];
    for (const [name, scene, relations] of cases) {
      const graph = graphOf(scene, 'construction', { relations }), order = ['A', 'B', 'mirror'];
      const relation = { kind: 'symmetric', curveIds: ['A', 'B'], lineId: 'mirror' };
      expect(offer(graph, order), name).toMatchObject({ state: 'available', relations: [relation] });
      expect(step(graph, 'symmetric', order), name).toEqual({ status: 'ready', relations: [{ id: 'new', ...relation }] });
      const { result } = attemptCadSketchNativeSolve({ graph: graphOf(scene, 'construction', { relations: [...relations, mirrored('construction')] }), parameters: {}, analyseDefinition: true }, solver);
      if (result.kind !== 'solved') throw new Error(`${name}: ${result.message}`);
      expect(result.diagnostics, name).toMatchObject({ degreesOfFreedom: scene.freedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] });
    }
    // An Equal between curves that mirror stays refused, as the mirror keeps it.
    expect(offer(graphOf(SCENES.lines, 'construction', { relations: [mirrored('construction')] }), ['A', 'B'], 'equal-length')).toMatchObject({ state: 'blocked' });
    // Point mirrors that pair two lines' ends the other way round from where they lie are refused, as a new mirror pairs them by place.
    const crossed = graphOf(SCENES.lines, '@v', { relations: [{ id: 'x', kind: 'symmetric', pointIds: ['a1', 'b2'], lineId: '@v' }] });
    expect(offer(crossed, ['A', 'B', '@v'])).toMatchObject({ state: 'blocked', reason: 'Symmetric already pairs these lines’ ends the other way round from where they lie. Remove it first.' });
  });

  it('refuse a curve mirror that other relations keep whole as redundant, naming it, though it yields where they keep only part', async () => {
    // The review's four circles of radius 4 at (±10, ±5): A and B mirror about V, B and C about H, C and D about V, so D and A mirror
    // about H already. The planner offers it, as only the solver sees the chain, and the solver refuses it as redundant, as any relation
    // adding nothing is, leaving the sketch as it was.
    const solver = await loadCadSketchTestNativeSolver();
    const ring = (id: string, centerPointId: string, radius: number | string = 4) => ({ ...circle(id, centerPointId), radius });
    const curves = (id: string, curveIds: readonly [string, string], lineId: string) => ({ id, kind: 'symmetric', curveIds, lineId });
    const four = { points: [{ id: 'ka', position: [10, 5] }, { id: 'kb', position: [-10, 5] }, { id: 'kc', position: [-10, -5] }, { id: 'kd', position: [10, -5] }],
      entities: [ring('A', 'ka'), ring('B', 'kb'), ring('C', 'kc'), ring('D', 'kd')],
      relations: [curves('ab', ['A', 'B'], '@v'), curves('bc', ['B', 'C'], '@h'), curves('cd', ['C', 'D'], '@v')] };
    const solve = (raw: { readonly relations: readonly unknown[] }, relation: unknown) => attemptCadSketchNativeSolve({ graph: parseCadSketchGraph({ ...raw, relations: [...raw.relations, relation] }), parameters: {}, analyseDefinition: true }, solver).result;
    expect(offer(parseCadSketchGraph(four), ['D', 'A', '@h'])).toMatchObject({ state: 'available', relations: [{ kind: 'symmetric', curveIds: ['D', 'A'], lineId: '@h' }] });
    expect(solve(four, curves('da', ['D', 'A'], '@h'))).toMatchObject({ kind: 'rejected', reason: 'redundant',
      diagnostics: { degreesOfFreedom: 3, conflictingIds: [], redundantIds: ['da'], partiallyRedundantIds: [] } });
    // The open chain, three of the four, still adds the last mirror's freedom.
    expect(solve({ ...four, relations: four.relations.slice(0, 2) }, curves('cd', ['C', 'D'], '@v'))).toMatchObject({ kind: 'solved',
      diagnostics: { degreesOfFreedom: 3, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] } });

    // Mirrored centres and both radii fixed to 4 keep the whole mirror, which the planner finds already applied, naming the point
    // mirror; stored anyway, the solver refuses the curves' Symmetric as redundant. With one radius fixed, it still adds the other.
    const centres = { points: [{ id: 'k1', position: [15, 8] }, { id: 'k2', position: [-15, 8] }], entities: [ring('A', 'k1', '4'), ring('B', 'k2', '4')],
      relations: [{ id: 'c', kind: 'symmetric', pointIds: ['k1', 'k2'], lineId: '@v' }] };
    const graph = parseCadSketchGraph(centres);
    expect(offer(graph, ['A', 'B', '@v'])).toMatchObject({ state: 'applied', relations: [], relationIds: ['c'] });
    expect(step(graph, 'symmetric', ['A', 'B', '@v'])).toEqual({ status: 'invalid', reason: 'These circles already mirror each other.', applied: ['c'] });
    expect(solve(centres, mirrored('@v'))).toMatchObject({ kind: 'rejected', reason: 'redundant',
      diagnostics: { degreesOfFreedom: 2, conflictingIds: [], redundantIds: ['mirrored'], partiallyRedundantIds: [] } });
    const one = { ...centres, entities: [ring('A', 'k1', '4'), ring('B', 'k2')] };
    expect(offer(parseCadSketchGraph(one), ['A', 'B', '@v'])).toMatchObject({ state: 'available' });
    expect(solve(one, mirrored('@v'))).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 2, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] } });
  });

  it('leave with a trim of either mirrored curve, and refuse a split or an extension while it names the curve', () => {
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
    for (const [graph, entityId] of [[lines, 'A'], [graphOf(SCENES.arcs, '@v', cutter), 'B']] as const) for (const end of ['start', 'end'] as const)
      expect(() => prepareCadSketchExtend({ graph, parameters: {}, entityId, end }), `${entityId} ${end}`).toThrow(CadSketchExtendDependencyError);
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
