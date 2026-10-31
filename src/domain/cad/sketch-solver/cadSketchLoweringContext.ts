import { CadError } from '../cadError';
import { evaluateCadScalar } from '../cadExpression';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '../cadSketchGraph';
import type { CadSketchEdge } from '../sketch-relations/cadSketchRelationTypes';
import { cadSketchVirtualAxis, type CadSketchVirtualAxis } from '../sketch-relations/cadSketchVirtualElements';
import { cadSketchLineDirection } from '../cadSketchLineRelations';
import type { Point2 } from '../../path-intel/types';
import { cadSketchRelationDefinition } from '../sketch-relations/cadSketchRelationRegistry';
import type { CadSketchEquation, CadSketchEquationKind, CadSketchPointParameters, CadSketchSizeParameters, CadSketchSupportParameters } from './cadSketchEquationModel';

/** A point held at a size from a centre, as a point on an arc's or circle's full circle is: its x parameter, the centre's x, and the size. */
export interface CadSketchRadialHold { readonly point: number; readonly centre: number; readonly size: CadSketchSizeParameters }

/** What a relation's lowering reads from an operand. */
export type CadSketchLoweringCapability = 'point' | 'edge' | 'support' | 'centre' | 'size' | 'value';

/** An operand the lowering cannot read as a relation asked: no such operand, or one without that capability. */
export class CadSketchLoweringRefusal extends CadError {
  constructor(readonly operandId: string, readonly capability: CadSketchLoweringCapability) {
    super('unlowerable-sketch-operand', `Sketch operand "${operandId}" has no ${capability} the solver can use.`);
  }
}

/**
 * What a relation's `lower` reads and writes. It hides where each parameter sits: points are asked for by id and edges by what they
 * give (a support with a direction, a centre, a size), and an operand that cannot give it is refused. An edge is passed as the relation
 * resolved it, or looked up by id with `edge`. Driving values are read by their scalar key through the relation's definition,
 * evaluated in the sketch's parameters. Every equation emitted is the current relation's.
 */
export interface CadSketchLoweringContext {
  readonly graph: CadSketchGraph;
  /** A point's x and y parameters. */
  point(pointId: string): CadSketchPointParameters;
  /** The support from one point toward another. */
  through(fromPointId: string, towardPointId: string): CadSketchSupportParameters;
  /** The span between two points as a size. */
  span(fromPointId: string, toPointId: string): CadSketchSizeParameters;
  /** The edge with this id, for a relation that holds only the id. */
  edge(entityId: string): CadSketchEdge;
  /** The support an edge gives a direction along, from its start toward its end. */
  support(edge: CadSketchEdge): CadSketchSupportParameters;
  /** The point an edge is centred on. */
  centre(edge: CadSketchEdge): string;
  /** An edge's size: the span from its centre to where it starts, or its own parameter. */
  size(edge: CadSketchEdge): CadSketchSizeParameters;
  /** A relation's driving value under its scalar key, such as `value` or `position.0`, evaluated in the sketch's parameters. */
  value(relationId: string, key: string): number;
  /**
   * Refuses with `message` unless both points have start values, and with the line-pair error unless they are apart: equations that
   * read a direction need one to start from.
   */
  direct(fromPointId: string, towardPointId: string, message: string): void;
  /** One equation of the current relation. Each is its own constraint, unless emitted inside `together`. */
  emit(kind: CadSketchEquationKind, operands: readonly number[], value?: number): void;
  /** Runs `lower`, whose equations share one tag: one constraint of several equations. */
  together(lower: () => void): void;
  /** Along one axis (0 for X, 1 for Y), the second point's coordinate less the first's is `offset`. */
  offset(axis: 0 | 1, fromPointId: string, toPointId: string, offset?: number): void;
  /** Along one axis, the point's coordinate is `value`. */
  hold(pointId: string, axis: 0 | 1, value: number): void;
  /** The point lies on the infinite line through the support. */
  onSupport(pointId: string, support: CadSketchSupportParameters): void;
  /** The point lies on the full circle around the edge's centre at the edge's size. A failed solve retries such points from off the centre. */
  onCircle(pointId: string, edge: CadSketchEdge): void;
  /** Two sizes are equal. */
  equalSizes(first: CadSketchSizeParameters, second: CadSketchSizeParameters): void;
  /** A size is `value`. */
  sized(size: CadSketchSizeParameters, value: number): void;
}

// What each kind of edge gives the lowering. Only these tables name edge kinds; a relation's lowering asks for capabilities.
type Entity<K extends CadSketchEdge['kind']> = Extract<CadSketchEdge, { kind: K }>;
type Capability<R> = { readonly [K in CadSketchEdge['kind']]?: (lowering: CadSketchLowering, entity: Entity<K>) => R };
/** A line runs from its start toward its end, and an axis from the origin toward its sample end. */
const SUPPORTS: Capability<readonly [string, string]> = { line: (_, line) => [line.startPointId, line.endPointId], axis: (_, axis) => [axis.startPointId, axis.endPointId] };
const CENTRES: Capability<string> = { arc: (_, arc) => arc.centerPointId, circle: (_, circle) => circle.centerPointId };
/** An arc's size spans from its centre to its start; a circle holds its radius as a parameter. */
const SIZES: Capability<CadSketchSizeParameters> = {
  arc: (lowering, arc) => lowering.span(arc.centerPointId, arc.startPointId),
  circle: (lowering, circle) => {
    const index = lowering.radiusParameters.get(circle.id);
    if (index === undefined) throw new CadSketchLoweringRefusal(circle.id, 'size');
    return { kind: 'parameter', index };
  }
};
/** Equations an edge keeps by itself: an arc's ends stay one radius from its centre. */
const STRUCTURES: Capability<void> = {
  arc: (lowering, arc) => lowering.equalSizes(lowering.span(arc.centerPointId, arc.startPointId), lowering.span(arc.centerPointId, arc.endPointId))
};
/** The entry of a capability table for the entity's kind; each entry takes only its own kind's entities, which the lookup guarantees. */
const capability = <R>(table: Capability<R>, entity: CadSketchEdge) =>
  table[entity.kind] as ((lowering: CadSketchLowering, entity: CadSketchEdge) => R) | undefined;

// The origin and each axis's sample end are fixed, so they have no parameters of their own: they stand as negative sentinels, the
// origin's x and y at -1 and -2, the H axis's sample end at -3 and -4 and the V axis's at -5 and -6. An equation on them takes a
// simpler form where the table below has one, and otherwise their fixed values become parameters, made once, after every other.
const VIRTUAL_POINTS: ReadonlyMap<string, CadSketchPointParameters> = new Map([['@origin', [-1, -2]], ['@h', [-3, -4]], ['@v', [-5, -6]]]);
const VIRTUAL_VALUES = [0, 0, 1, 0, 0, 1] as const;
const fixedValue = (sentinel: number) => VIRTUAL_VALUES[-sentinel - 1];
type Specialized = readonly [CadSketchEquationKind, readonly number[], number];
/**
 * The axis whose support starts at `at`: the coordinate it holds at 0 for points on it (1 for Y on the H axis, 0 for X on the V axis),
 * and 1 when it runs from the origin or -1 when it runs toward it. Undefined for any other support.
 */
function axisSupport(operands: readonly number[], at: number): { readonly across: 0 | 1; readonly sense: 1 | -1 } | undefined {
  const [ax, ay, bx, by] = operands.slice(at, at + 4), from = ax === -1 && ay === -2, toward = bx === -1 && by === -2;
  const [sx, sy] = from ? [bx, by] : toward ? [ax, ay] : [0, 0];
  const across = sx === -3 && sy === -4 ? 1 : sx === -5 && sy === -6 ? 0 : undefined;
  return across === undefined ? undefined : { across, sense: from ? 1 : -1 };
}
const stored = (operands: readonly number[], from: number, to: number) => operands.slice(from, to).every(operand => operand >= 0);
/**
 * Equations on an axis or the origin in the form they take there. Each keeps what its general form holds: a point on the H axis is a Y
 * of 0, a line parallel to it keeps one Y, a mirror about the V axis is an X sum of 0 with one Y, and a signed distance from an axis is a
 * signed coordinate. Null keeps the general form, with the fixed values as parameters.
 */
const SPECIALIZATIONS: { readonly [K in CadSketchEquationKind]?: (operands: readonly number[], value: number) => Specialized | null } = {
  difference: ([a, b], value) => a < 0 && b >= 0 ? ['value', [b], fixedValue(a) + value] : b < 0 && a >= 0 ? ['value', [a], fixedValue(b) - value] : null,
  'point-on-line': (operands) => {
    const axis = axisSupport(operands, 2);
    return axis && stored(operands, 0, 2) ? ['value', [operands[axis.across]], 0] : null;
  },
  parallel: (operands) => alongAxis(operands, true),
  perpendicular: (operands) => alongAxis(operands, false),
  'symmetric-midpoint': (operands) => {
    const axis = axisSupport(operands, 4);
    return axis && stored(operands, 0, 4) ? ['midpoint', [operands[axis.across], operands[2 + axis.across], axis.across === 0 ? -1 : -2], 0] : null;
  },
  'symmetric-perpendicular': (operands) => {
    const axis = axisSupport(operands, 4), along = axis?.across === 1 ? 0 : 1;
    return axis && stored(operands, 0, 4) ? ['difference', [operands[along], operands[2 + along]], 0] : null;
  },
  // Positive to the left of the support: +Y of the H axis and -X of the V axis, as each runs from the origin.
  'point-line-distance': (operands, value) => {
    const axis = axisSupport(operands, 2);
    return axis && stored(operands, 0, 2) ? ['value', [operands[axis.across]], (axis.across === 1 ? 1 : -1) * axis.sense * value] : null;
  }
};
/** A stored line parallel to an axis keeps the coordinate the axis holds across it, and one square to it the other. */
function alongAxis(operands: readonly number[], parallel: boolean): Specialized | null {
  const first = axisSupport(operands, 0), second = axisSupport(operands, 4);
  const [axis, line] = first && !second && stored(operands, 4, 8) ? [first, 4] : second && !first && stored(operands, 0, 4) ? [second, 0] : [undefined, 0];
  if (!axis) return null;
  const keep = parallel ? axis.across : 1 - axis.across;
  return ['difference', [operands[line + keep], operands[line + 2 + keep]], 0];
}

/**
 * The lowering of one sketch: the context each relation lowers through, and the equations, tags and radial holds it collects. The
 * compiler emits an arc's own equation and a drag's targets through it too, under their own sources.
 */
export class CadSketchLowering implements CadSketchLoweringContext {
  readonly equations: CadSketchEquation[] = [];
  readonly radialHolds: CadSketchRadialHold[] = [];
  private tags = 0;
  private sharedTag: number | undefined;
  private relation: CadSketchGraphRelation | undefined;
  private sourceId = '';
  private entities: Map<string, CadSketchGraphEntity> | undefined;
  private relations: Map<string, CadSketchGraphRelation> | undefined;
  /** The fixed values the origin and the axes became, in the order they were made; they follow the `parameterCount` parameters before them. */
  readonly fixedValues: number[] = [];
  private readonly made = new Map<number, number>();

  /** `numericPoints` gives the origin and the axes' sample ends too, as `CadSketchPositions` does. */
  constructor(readonly graph: CadSketchGraph, private readonly parameters: Readonly<Record<string, number>>,
    private readonly pointParameters: ReadonlyMap<string, number>, readonly radiusParameters: ReadonlyMap<string, number>,
    private readonly numericPoints: ReadonlyMap<string, Point2>, private readonly parameterCount: number) {}

  /**
   * Lowers one relation through its definition, whole or not at all: a relation whose lowering throws, a refusal or any other error,
   * leaves none of its equations, radial holds or tags behind.
   */
  lower(relation: CadSketchGraphRelation) {
    this.relation = relation; this.sourceId = relation.id;
    const equations = this.equations.length, radialHolds = this.radialHolds.length, tags = this.tags, made = this.fixedValues.length;
    try { cadSketchRelationDefinition(relation).lower(relation, this); }
    catch (error) { this.restore(equations, radialHolds, tags, made); throw error; }
  }
  /** The equations an edge keeps by itself, under its own id, whole or not at all. */
  structure(entity: CadSketchGraphEntity) {
    const structure = capability(STRUCTURES, entity);
    if (!structure) return;
    this.relation = undefined; this.sourceId = entity.id;
    const equations = this.equations.length, radialHolds = this.radialHolds.length, tags = this.tags, made = this.fixedValues.length;
    try { structure(this, entity); }
    catch (error) { this.restore(equations, radialHolds, tags, made); throw error; }
  }
  /** Drops what was emitted since the counts were taken, and gives back the tags it took. */
  private restore(equations: number, radialHolds: number, tags: number, made: number) {
    this.equations.length = equations; this.radialHolds.length = radialHolds; this.tags = tags; this.sharedTag = undefined;
    if (this.fixedValues.length === made) return;
    this.fixedValues.length = made;
    for (const [sentinel, index] of this.made) if (index >= this.parameterCount + made) this.made.delete(sentinel);
  }
  /** A drag target: a value on one coordinate of the dragged point, solved but left out of diagnosis. */
  target(pointId: string, axis: 0 | 1, value: number) {
    this.relation = undefined; this.sourceId = pointId;
    this.equations.push({ kind: 'value', operands: [this.point(pointId)[axis]], value, sourceId: pointId, tag: this.tags++, temporary: true });
  }

  point(pointId: string): CadSketchPointParameters {
    const x = this.pointParameters.get(pointId);
    if (x === undefined) { const fixed = VIRTUAL_POINTS.get(pointId); if (fixed) return fixed; throw new CadSketchLoweringRefusal(pointId, 'point'); }
    return [x, x + 1];
  }
  through(fromPointId: string, towardPointId: string): CadSketchSupportParameters {
    return [...this.point(fromPointId), ...this.point(towardPointId)];
  }
  span(fromPointId: string, toPointId: string): CadSketchSizeParameters {
    return { kind: 'span', span: this.through(fromPointId, toPointId) };
  }
  edge(entityId: string): CadSketchEdge {
    const axis: CadSketchVirtualAxis | undefined = cadSketchVirtualAxis(entityId);
    if (axis) return axis;
    if (!this.entities) {
      this.entities = new Map();
      for (const entity of this.graph.entities) if (!this.entities.has(entity.id)) this.entities.set(entity.id, entity);
    }
    const entity = this.entities.get(entityId);
    if (!entity) throw new CadSketchLoweringRefusal(entityId, 'edge');
    return entity;
  }
  support(edge: CadSketchEdge): CadSketchSupportParameters {
    const ends = capability(SUPPORTS, edge)?.(this, edge);
    if (!ends) throw new CadSketchLoweringRefusal(edge.id, 'support');
    return this.through(ends[0], ends[1]);
  }
  centre(edge: CadSketchEdge): string {
    const centre = capability(CENTRES, edge)?.(this, edge);
    if (centre === undefined) throw new CadSketchLoweringRefusal(edge.id, 'centre');
    return centre;
  }
  size(edge: CadSketchEdge): CadSketchSizeParameters {
    const size = capability(SIZES, edge);
    if (!size) throw new CadSketchLoweringRefusal(edge.id, 'size');
    return size(this, edge);
  }
  value(relationId: string, key: string): number {
    let relation = this.relation?.id === relationId ? this.relation : undefined;
    if (!relation) {
      this.relations ??= new Map(this.graph.relations.map(item => [item.id, item]));
      relation = this.relations.get(relationId);
    }
    const scalars = relation && cadSketchRelationDefinition(relation).scalars, index = scalars ? scalars.keys.indexOf(key) : -1;
    if (!relation || !scalars || index < 0) throw new CadSketchLoweringRefusal(`${relationId}.${key}`, 'value');
    return evaluateCadScalar(scalars.read(relation as never)[index], this.parameters);
  }
  direct(fromPointId: string, towardPointId: string, message: string) {
    if (!cadSketchLineDirection({ startPointId: fromPointId, endPointId: towardPointId } as Entity<'line'>, this.numericPoints)) throw new Error(message);
  }

  emit(kind: CadSketchEquationKind, operands: readonly number[], value = 0) {
    if (operands.some(operand => operand < 0)) {
      const specialized = SPECIALIZATIONS[kind]?.(operands, value);
      if (specialized) [kind, operands, value] = specialized;
      operands = operands.map(operand => operand < 0 ? this.fixed(operand) : operand);
    }
    this.equations.push({ kind, operands, value, sourceId: this.sourceId, tag: this.sharedTag ?? this.tags++ });
  }
  /** The parameter a fixed value of the origin or an axis became, made the first time an equation keeps it. */
  private fixed(sentinel: number): number {
    let index = this.made.get(sentinel);
    if (index === undefined) { index = this.parameterCount + this.fixedValues.length; this.fixedValues.push(fixedValue(sentinel)); this.made.set(sentinel, index); }
    return index;
  }
  together(lower: () => void) {
    this.sharedTag = this.tags++;
    try { lower(); } finally { this.sharedTag = undefined; }
  }

  offset(axis: 0 | 1, fromPointId: string, toPointId: string, offset = 0) {
    this.emit('difference', [this.point(fromPointId)[axis], this.point(toPointId)[axis]], offset);
  }
  hold(pointId: string, axis: 0 | 1, value: number) {
    this.emit('value', [this.point(pointId)[axis]], value);
  }
  onSupport(pointId: string, support: CadSketchSupportParameters) {
    this.emit('point-on-line', [...this.point(pointId), ...support]);
  }
  onCircle(pointId: string, edge: CadSketchEdge) {
    const centre = this.centre(edge), size = this.size(edge);
    this.equalSizes(this.span(centre, pointId), size);
    // The origin never moves, so a failed solve has nothing to retry from off the centre.
    if (!VIRTUAL_POINTS.has(pointId)) this.radialHolds.push({ point: this.point(pointId)[0], centre: this.point(centre)[0], size });
  }
  /** Two spans give an equal-length equation, a span and a parameter a distance to it, and two parameters a difference. */
  equalSizes(first: CadSketchSizeParameters, second: CadSketchSizeParameters) {
    if (first.kind === 'parameter' && second.kind === 'parameter') this.emit('difference', [first.index, second.index]);
    else if (first.kind === 'span' && second.kind === 'span') this.emit('equal-length', [...first.span, ...second.span]);
    else if (first.kind === 'span' && second.kind === 'parameter') this.emit('distance-to-parameter', [...first.span, second.index]);
    else if (first.kind === 'parameter' && second.kind === 'span') this.emit('distance-to-parameter', [...second.span, first.index]);
  }
  sized(size: CadSketchSizeParameters, value: number) {
    if (size.kind === 'span') this.emit('distance', size.span, value);
    else this.emit('value', [size.index], value);
  }
}
