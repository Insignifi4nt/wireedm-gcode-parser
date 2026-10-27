import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphEntity, type CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveInput } from '../cadSketchSolverTypes';

/**
 * Version of the seeded sketch generator. Version 1's inputs are frozen in the PlaneGCS corpus by hash
 * with PlaneGCS's answers, so a change to what any seed generates is a new version, never an edit in place.
 */
export const CAD_SKETCH_FUZZ_VERSION = 1;
/** Version of the generator weighted toward simple equalities, frozen the same way by its own hash. */
export const CAD_SKETCH_EQUALITY_FUZZ_VERSION = 1;

/**
 * `mixed`: every construction step and dimension alike. `equalities`: horizontal, vertical,
 * coincident and equal-radius steps, rectangles, axis distances and fixed coordinates made more
 * likely, so chains of simple equalities meet each other and the nonlinear relations that read them.
 */
export type CadSketchFuzzMode = 'mixed' | 'equalities';

/** Relation kinds the generator builds; corners, patterns and references keep their own suites. */
export const cadSketchFuzzFamilies = ['horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'equal-length', 'midpoint',
  'point-on-line', 'symmetric', 'coincident', 'equal-radius', 'tangent-joint', 'distance', 'axis-distance', 'radial-size', 'line-angle',
  'fixed-point', 'fixed-axis'] as const;

export interface CadSketchFuzzCase {
  readonly seed: number;
  readonly mode: CadSketchFuzzMode;
  /** Every relation holds at these start values, measured from them. */
  readonly witness: CadSketchSolveInput;
  /** The witness with each free start value moved by up to 3% of the sketch scale. */
  readonly perturbed: CadSketchSolveInput;
  /** A free point dragged a tenth of the sketch scale from the witness. */
  readonly drag: CadSketchSolveInput;
  /**
   * The same drag of the witness without its fixed points, fixed axes and expression positions: every
   * relation left holds after any translation, so the target is reachable, at least by moving the
   * whole sketch with the point.
   */
  readonly reachable: CadSketchSolveInput;
  /** The witness with two relations that cannot both hold. */
  readonly contradiction: { readonly input: CadSketchSolveInput; readonly relationIds: readonly [string, string] };
}

type Random = () => number;
interface Vector { readonly x: number; readonly y: number }
interface Point { readonly id: string; readonly x: number; readonly y: number; readonly expression?: string }
interface Line { readonly kind: 'line'; readonly id: string; readonly a: Point; readonly b: Point }
interface Curve { readonly kind: 'circle' | 'arc'; readonly id: string; readonly center: Point; readonly radius: number;
  readonly start?: Point; readonly end?: Point; readonly direction?: 'cw' | 'ccw' }

/** Mulberry32: small, fast and identical everywhere, unlike `Math.random`. */
function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a: Vector, b: Vector, scale = 1): Vector => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });
const between = (a: Vector, b: Vector): Vector => ({ x: b.x - a.x, y: b.y - a.y });
const length = (v: Vector) => Math.hypot(v.x, v.y);
const unit = (v: Vector): Vector => { const size = length(v); return { x: v.x / size, y: v.y / size }; };
const turn = (v: Vector): Vector => ({ x: -v.y, y: v.x });
const polar = (angle: number): Vector => ({ x: Math.cos(angle), y: Math.sin(angle) });
const cross = (a: Vector, b: Vector) => a.x * b.y - a.y * b.x;
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y;

/**
 * Builds a sketch by construction: each point is placed once, from points already placed, so the
 * relations each step adds hold exactly; dimensions are measured afterwards from the same values.
 */
class Builder {
  readonly points: Point[] = [];
  readonly lines: Line[] = [];
  readonly curves: Curve[] = [];
  readonly entities: CadSketchGraphEntity[] = [];
  readonly relations: CadSketchGraphRelation[] = [];
  readonly parameters: Record<string, number> = {};
  /** Points with a coincident partner, so line and axis operands stay distinct identities. */
  readonly aliased = new Set<string>();
  readonly fixed = new Set<string>();
  readonly joints = new Set<string>();
  private serial = 0;

  constructor(readonly random: Random, readonly scale: number, readonly origin: Vector) {}

  range(low: number, high: number) { return low + (high - low) * this.random(); }
  chance(probability: number) { return this.random() < probability; }
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.random() * items.length)]; }
  id(prefix: string) { return `${prefix}${++this.serial}`; }

  /** A dimension value, sometimes as a named parameter. */
  value(measured: number): number | string {
    if (!this.chance(.15)) return measured;
    const name = this.id('d'); this.parameters[name] = measured; return name;
  }

  point(at: Vector, expression = false): Point {
    const id = this.id('p'), point: Point = expression ? { id, x: at.x, y: at.y, expression: `${id}x` } : { id, x: at.x, y: at.y };
    if (expression) this.parameters[point.expression!] = at.x;
    this.points.push(point);
    return point;
  }
  scatter(): Point {
    return this.point(add(this.origin, { x: this.range(-1, 1), y: this.range(-1, 1) }, this.scale), this.chance(.06));
  }
  /** An existing point or a new one; the existing one never has a coincident partner. */
  anchor(): Point {
    const free = this.points.filter(point => !this.aliased.has(point.id));
    return free.length && this.chance(.6) ? this.pick(free) : this.scatter();
  }
  line(a: Point, b: Point): Line {
    const line: Line = { kind: 'line', id: this.id('l'), a, b };
    this.lines.push(line); this.entities.push({ id: line.id, kind: 'line', construction: false, startPointId: a.id, endPointId: b.id });
    return line;
  }
  relate(relation: CadSketchGraphRelation) { this.relations.push(relation); }
  span() { return this.scale * this.range(.3, 1.2); }

  ray(from: Point, direction: Vector) { return this.line(from, this.point(add(from, unit(direction), this.span()))); }

  circle(center: Point, radius: number): Curve {
    const curve: Curve = { kind: 'circle', id: this.id('c'), center, radius };
    this.curves.push(curve); this.entities.push({ id: curve.id, kind: 'circle', construction: false, centerPointId: center.id, radius });
    return curve;
  }
  arc(center: Point, radius: number): Curve {
    const direction = this.pick(['cw', 'ccw'] as const), from = this.range(0, 2 * Math.PI), sweep = this.range(.5, 5.2);
    const start = this.point(add(center, polar(from), radius)), end = this.point(add(center, polar(from + (direction === 'ccw' ? sweep : -sweep)), radius));
    const curve: Curve = { kind: 'arc', id: this.id('a'), center, radius, start, end, direction };
    this.curves.push(curve);
    this.entities.push({ id: curve.id, kind: 'arc', construction: false, centerPointId: center.id, startPointId: start.id, endPointId: end.id, direction });
    return curve;
  }
}

/** Construction steps; each adds geometry and the relations it makes true, or does nothing. */
const steps: readonly ((sketch: Builder) => void)[] = [
  sketch => { sketch.ray(sketch.anchor(), polar(sketch.range(0, 2 * Math.PI))); },
  sketch => {
    const a = sketch.anchor(), b = sketch.point(add(a, { x: sketch.pick([-1, 1]) * sketch.span(), y: 0 }));
    sketch.line(a, b); sketch.relate({ id: sketch.id('r'), kind: 'horizontal', pointIds: [a.id, b.id] });
  },
  sketch => {
    const a = sketch.anchor(), b = sketch.point(add(a, { x: 0, y: sketch.pick([-1, 1]) * sketch.span() }));
    sketch.line(a, b); sketch.relate({ id: sketch.id('r'), kind: 'vertical', pointIds: [a.id, b.id] });
  },
  ...(['parallel', 'perpendicular'] as const).map(kind => (sketch: Builder) => {
    if (!sketch.lines.length) return;
    const guide = sketch.pick(sketch.lines), along = unit(between(guide.a, guide.b));
    const line = sketch.ray(sketch.anchor(), kind === 'parallel' ? add({ x: 0, y: 0 }, along, sketch.pick([-1, 1])) : add({ x: 0, y: 0 }, turn(along), sketch.pick([-1, 1])));
    sketch.relate({ id: sketch.id('r'), kind, lineIds: [guide.id, line.id] });
  }),
  sketch => {
    if (!sketch.lines.length) return;
    const guide = sketch.pick(sketch.lines), from = sketch.anchor();
    const line = sketch.line(from, sketch.point(add(from, polar(sketch.range(0, 2 * Math.PI)), length(between(guide.a, guide.b)))));
    sketch.relate({ id: sketch.id('r'), kind: 'equal-length', lineIds: [guide.id, line.id] });
  },
  sketch => {
    if (!sketch.lines.length) return;
    const guide = sketch.pick(sketch.lines), along = between(guide.a, guide.b);
    // Either continuing from an endpoint, or disjoint on the same support.
    const shared = sketch.chance(.4), first = shared ? guide.b : sketch.point(add(guide.a, along, sketch.pick([-1, 1]) * sketch.range(1.2, 1.8)));
    const reach = shared ? sketch.range(.3, 1) : sketch.range(.3, .8) * Math.sign(dot(between(guide.a, first), along) || 1);
    const line = sketch.line(first, sketch.point(add(first, along, reach)));
    sketch.relate({ id: sketch.id('r'), kind: 'collinear', lineIds: [guide.id, line.id] });
  },
  sketch => {
    if (!sketch.lines.length) return;
    const guide = sketch.pick(sketch.lines), middle = sketch.point({ x: (guide.a.x + guide.b.x) / 2, y: (guide.a.y + guide.b.y) / 2 });
    sketch.relate({ id: sketch.id('r'), kind: 'midpoint', pointId: middle.id, lineId: guide.id });
    if (sketch.chance(.5)) sketch.ray(middle, turn(between(guide.a, guide.b)));
  },
  sketch => {
    if (!sketch.lines.length) return;
    const guide = sketch.pick(sketch.lines), along = sketch.pick([sketch.range(-.6, -.1), sketch.range(.1, .4), sketch.range(.6, .9), sketch.range(1.1, 1.6)]);
    const on = sketch.point(add(guide.a, between(guide.a, guide.b), along));
    sketch.relate({ id: sketch.id('r'), kind: 'point-on-line', pointId: on.id, lineId: guide.id });
  },
  sketch => {
    const axes = sketch.lines.filter(line => !sketch.aliased.has(line.a.id) && !sketch.aliased.has(line.b.id));
    if (!axes.length) return;
    const axis = sketch.pick(axes), along = unit(between(axis.a, axis.b));
    const sources = sketch.points.filter(point => point !== axis.a && point !== axis.b && !sketch.aliased.has(point.id)
      && Math.abs(cross(along, between(axis.a, point))) > .05 * sketch.scale);
    if (!sources.length) return;
    const source = sketch.pick(sources), offset = between(axis.a, source), foot = add(axis.a, along, dot(offset, along));
    const image = sketch.point(add(foot, between(source, foot)));
    sketch.relate({ id: sketch.id('r'), kind: 'symmetric', pointIds: [source.id, image.id], lineId: axis.id });
  },
  sketch => {
    const sources = sketch.points.filter(point => !sketch.aliased.has(point.id) && !point.expression);
    if (!sources.length) return;
    const source = sketch.pick(sources), copy = sketch.point(source);
    sketch.aliased.add(source.id); sketch.aliased.add(copy.id);
    sketch.relate({ id: sketch.id('r'), kind: 'coincident', pointIds: [source.id, copy.id] });
    sketch.ray(copy, polar(sketch.range(0, 2 * Math.PI)));
  },
  sketch => { sketch.circle(sketch.anchor(), sketch.scale * sketch.range(.1, .8)); },
  sketch => { sketch.arc(sketch.anchor(), sketch.scale * sketch.range(.2, .8)); },
  sketch => {
    if (!sketch.curves.length) return;
    const source = sketch.pick(sketch.curves), center = sketch.anchor();
    const curve = sketch.chance(.5) ? sketch.circle(center, source.radius) : sketch.arc(center, source.radius);
    sketch.relate({ id: sketch.id('r'), kind: 'equal-radius', curveIds: [source.id, curve.id] });
  },
  sketch => {
    const arcs = sketch.curves.filter(curve => curve.kind === 'arc' && ![curve.start!, curve.end!].every(point => sketch.joints.has(point.id)));
    if (!arcs.length) return;
    const arc = sketch.pick(arcs), atStart = !sketch.joints.has(arc.start!.id) && (sketch.joints.has(arc.end!.id) || sketch.chance(.5));
    const joint = atStart ? arc.start! : arc.end!, radial = unit(between(arc.center, joint));
    // Leaving the arc's end smoothly: against the arc's travel at its start, along it at its end.
    const travel = (arc.direction === 'ccw' ? 1 : -1) * (atStart ? 1 : -1), tangent = add({ x: 0, y: 0 }, turn(radial), travel);
    const other = sketch.point(add(joint, tangent, -sketch.span()));
    const line = sketch.chance(.5) ? sketch.line(joint, other) : sketch.line(other, joint);
    sketch.joints.add(joint.id);
    const endpoints = [{ entityId: line.id, pointId: joint.id }, { entityId: arc.id, pointId: joint.id }] as const;
    sketch.relate({ id: sketch.id('r'), kind: 'tangent-joint', endpoints: sketch.chance(.5) ? endpoints : [endpoints[1], endpoints[0]] });
  }
];

/** Dimensions measured from the constructed values. */
const dimensions: readonly ((sketch: Builder) => void)[] = [
  sketch => {
    const a = sketch.pick(sketch.points), b = sketch.pick(sketch.points), distance = length(between(a, b));
    if (a !== b && distance > .05 * sketch.scale) sketch.relate({ id: sketch.id('r'), kind: 'distance', pointIds: [a.id, b.id], value: sketch.value(distance) });
  },
  sketch => {
    const a = sketch.pick(sketch.points), b = sketch.pick(sketch.points), axis = sketch.pick(['x', 'y'] as const);
    if (a !== b) sketch.relate({ id: sketch.id('r'), kind: 'axis-distance', pointIds: [a.id, b.id], axis, value: sketch.value(b[axis] - a[axis]) });
  },
  sketch => {
    if (!sketch.curves.length) return;
    const curve = sketch.pick(sketch.curves), quantity = sketch.pick(['radius', 'diameter'] as const);
    const radius = curve.kind === 'arc' ? length(between(curve.center, curve.start!)) : curve.radius;
    sketch.relate({ id: sketch.id('r'), kind: 'radial-size', entityId: curve.id, quantity, value: sketch.value(quantity === 'radius' ? radius : 2 * radius) });
  },
  sketch => {
    if (sketch.lines.length < 2) return;
    const first = sketch.pick(sketch.lines), second = sketch.pick(sketch.lines);
    if (first === second) return;
    const toward = (line: Line) => sketch.chance(.5) ? [line.a, line.b] as const : [line.b, line.a] as const;
    const [fromA, towardA] = toward(first), [fromB, towardB] = toward(second);
    const a = between(fromA, towardA), b = between(fromB, towardB), sweep = Math.atan2(cross(a, b), dot(a, b)), degrees = Math.abs(sweep) * 180 / Math.PI;
    if (degrees < 15 || degrees > 165) return;
    sketch.relate({ id: sketch.id('r'), kind: 'line-angle', rays: [{ lineId: first.id, towardPointId: towardA.id }, { lineId: second.id, towardPointId: towardB.id }],
      sense: sweep > 0 ? 'ccw' : 'cw', value: sketch.value(degrees) });
  },
  sketch => {
    const point = sketch.pick(sketch.points);
    if (sketch.fixed.has(point.id)) return;
    sketch.fixed.add(point.id);
    sketch.relate({ id: sketch.id('r'), kind: 'fixed-point', pointId: point.id, position: [point.x, point.y] });
  },
  sketch => {
    const point = sketch.pick(sketch.points), axis = sketch.pick(['x', 'y'] as const);
    sketch.relate({ id: sketch.id('r'), kind: 'fixed-axis', pointId: point.id, axis, value: sketch.value(point[axis]) });
  }
];

/** A rectangle by its corners: two horizontal and two vertical sides, as most profiles start. */
function rectangle(sketch: Builder) {
  const a = sketch.anchor(), across = { x: sketch.pick([-1, 1]) * sketch.span(), y: sketch.pick([-1, 1]) * sketch.span() };
  const b = sketch.point(add(a, { x: across.x, y: 0 })), c = sketch.point(add(a, across)), d = sketch.point(add(a, { x: 0, y: across.y }));
  sketch.line(a, b); sketch.line(b, c); sketch.line(c, d); sketch.line(d, a);
  sketch.relate({ id: sketch.id('r'), kind: 'horizontal', pointIds: [a.id, b.id] }); sketch.relate({ id: sketch.id('r'), kind: 'vertical', pointIds: [b.id, c.id] });
  sketch.relate({ id: sketch.id('r'), kind: 'horizontal', pointIds: [c.id, d.id] }); sketch.relate({ id: sketch.id('r'), kind: 'vertical', pointIds: [d.id, a.id] });
}

// The `equalities` generator draws from every step and dimension, with these made more likely.
const [, horizontal, vertical, , , , , , , , coincident, circle, , equalRadius] = steps;
const equalitySteps = [...steps, horizontal, horizontal, vertical, vertical, coincident, coincident, circle, equalRadius, equalRadius, rectangle, rectangle, rectangle];
const [, axisDistance, , , fixedPoint, fixedAxis] = dimensions;
const equalityDimensions = [...dimensions, axisDistance, axisDistance, axisDistance, fixedAxis, fixedAxis, fixedPoint];

function graphOf(sketch: Builder, position: (point: Point) => readonly [number | string, number | string], radius: (curve: Curve) => number,
  relations: readonly CadSketchGraphRelation[] = sketch.relations): CadSketchGraph {
  return parseCadSketchGraph({
    points: sketch.points.map(point => ({ id: point.id, position: position(point) })),
    entities: sketch.entities.map(entity => entity.kind === 'circle' ? { ...entity, radius: radius(sketch.curves.find(curve => curve.id === entity.id)!) } : entity),
    relations
  });
}

/** The witness, its perturbed start, a drag and an injected contradiction for one seed. */
export function createCadSketchFuzzCase(seed: number, mode: CadSketchFuzzMode = 'mixed'): CadSketchFuzzCase {
  const equalities = mode === 'equalities';
  // Each generator seeds its own sequence, so the same seed builds unrelated sketches in each.
  const random = seeded(Math.imul(seed, 2654435761) ^ (equalities ? 0x45510000 + CAD_SKETCH_EQUALITY_FUZZ_VERSION : CAD_SKETCH_FUZZ_VERSION));
  const scale = [1, 10, 100][Math.floor(random() * 3)];
  const far = random() < .12, origin = far ? { x: (random() - .5) * 400 * scale, y: (random() - .5) * 400 * scale } : { x: 0, y: 0 };
  const sketch = new Builder(random, scale, origin);
  sketch.scatter();
  for (let count = 3 + Math.floor(sketch.range(0, 6)) + (equalities ? 2 : 0); count > 0; count--) sketch.pick(equalities ? equalitySteps : steps)(sketch);
  if (!sketch.lines.length) steps[0](sketch);
  for (let count = Math.floor(sketch.range(0, 5)); count > 0; count--) sketch.pick(equalities ? equalityDimensions : dimensions)(sketch);
  if (sketch.chance(.75)) dimensions[4](sketch);
  if (sketch.relations.length && sketch.chance(.2)) sketch.relate({ ...sketch.pick(sketch.relations), id: sketch.id('r') });

  const exact = (point: Point) => [point.expression ?? point.x, point.y] as const;
  const witness = { graph: graphOf(sketch, exact, curve => curve.radius), parameters: { ...sketch.parameters } };
  const nudge = (magnitude: number) => (value: number) => value + magnitude * sketch.scale * sketch.range(-1, 1);
  const shift = nudge(.03);
  const perturbed = { graph: graphOf(sketch, point => [point.expression ?? shift(point.x), shift(point.y)], curve => curve.radius * (1 + .03 * sketch.range(-1, 1))),
    parameters: witness.parameters };
  const movable = sketch.points.filter(point => !point.expression && !sketch.fixed.has(point.id)), dragged = movable.length ? sketch.pick(movable) : sketch.points[0];
  const toward = add(dragged, polar(sketch.range(0, 2 * Math.PI)), .1 * sketch.scale);
  const drag = { ...witness, drag: { pointId: dragged.id, position: [toward.x, toward.y] as const } };
  const contradiction = contradict(sketch, witness);
  const translatable = sketch.relations.filter(relation => relation.kind !== 'fixed-point' && relation.kind !== 'fixed-axis');
  const reachable = { graph: graphOf(sketch, point => [point.x, point.y], curve => curve.radius, translatable), parameters: witness.parameters, drag: drag.drag };
  return { seed, mode, witness, perturbed, drag, reachable, contradiction };
}

/** Adds a relation that cannot hold together with one already there, or a pair that cannot. */
function contradict(sketch: Builder, witness: CadSketchSolveInput): CadSketchFuzzCase['contradiction'] {
  const relations = [...sketch.relations], kinds = ['axis'] as string[];
  const of = <K extends CadSketchGraphRelation['kind']>(kind: K) => relations.filter((relation): relation is CadSketchGraphRelation & { kind: K } => relation.kind === kind);
  const numeric = (value: number | string) => typeof value === 'number' ? value : witness.parameters[value];
  if (of('distance').length) kinds.push('distance');
  if (of('radial-size').length) kinds.push('radial');
  if (of('horizontal').length) kinds.push('horizontal');
  if (of('line-angle').length) kinds.push('angle');
  const kind = sketch.pick(kinds), id = sketch.id('r'), gap = sketch.scale * sketch.range(.2, .6);
  let relationIds: readonly [string, string];
  if (kind === 'distance') {
    const source = sketch.pick(of('distance'));
    relations.push({ ...source, id, value: numeric(source.value) * sketch.range(1.2, 1.6) + .1 * sketch.scale }); relationIds = [source.id, id];
  } else if (kind === 'radial') {
    const source = sketch.pick(of('radial-size'));
    relations.push({ ...source, id, value: numeric(source.value) * sketch.range(1.2, 1.6) }); relationIds = [source.id, id];
  } else if (kind === 'horizontal') {
    const source = sketch.pick(of('horizontal'));
    relations.push({ id, kind: 'axis-distance', pointIds: source.pointIds, axis: 'y', value: gap }); relationIds = [source.id, id];
  } else if (kind === 'angle') {
    const source = sketch.pick(of('line-angle')), degrees = numeric(source.value);
    relations.push({ ...source, id, value: degrees > 90 ? degrees - 20 : degrees + 20 }); relationIds = [source.id, id];
  } else {
    const point = sketch.pick(sketch.points), axis = sketch.pick(['x', 'y'] as const), other = sketch.id('r');
    relations.push({ id, kind: 'fixed-axis', pointId: point.id, axis, value: point[axis] },
      { id: other, kind: 'fixed-axis', pointId: point.id, axis, value: point[axis] + sketch.pick([-1, 1]) * gap });
    relationIds = [id, other];
  }
  return { input: { ...witness, graph: graphOf(sketch, point => [point.expression ?? point.x, point.y], curve => curve.radius, relations) }, relationIds };
}

/**
 * Drops relations one at a time, never those in `keep`, while `fails` still holds, until no single
 * relation can go; the smallest failing input found, to keep as a fixture.
 */
export async function minimizeCadSketchInput(input: CadSketchSolveInput, fails: (input: CadSketchSolveInput) => Promise<boolean>,
  keep: ReadonlySet<string> = new Set()): Promise<CadSketchSolveInput> {
  let current = input;
  for (let dropped = true; dropped;) {
    dropped = false;
    for (const relation of current.graph.relations) {
      if (keep.has(relation.id)) continue;
      const candidate = { ...current, graph: parseCadSketchGraph({ ...current.graph, relations: current.graph.relations.filter(other => other !== relation) }) };
      if (await fails(candidate)) { current = candidate; dropped = true; break; }
    }
  }
  return current;
}
