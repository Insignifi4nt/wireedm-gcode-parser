import { CadError } from '../cadError';
import { evaluateCadScalar } from '../cadExpression';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '../cadSketchGraph';
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
  edge(entityId: string): CadSketchGraphEntity;
  /** The support an edge gives a direction along, from its start toward its end. */
  support(edge: CadSketchGraphEntity): CadSketchSupportParameters;
  /** The point an edge is centred on. */
  centre(edge: CadSketchGraphEntity): string;
  /** An edge's size: the span from its centre to where it starts, or its own parameter. */
  size(edge: CadSketchGraphEntity): CadSketchSizeParameters;
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
  onCircle(pointId: string, edge: CadSketchGraphEntity): void;
  /** Two sizes are equal. */
  equalSizes(first: CadSketchSizeParameters, second: CadSketchSizeParameters): void;
  /** A size is `value`. */
  sized(size: CadSketchSizeParameters, value: number): void;
}

// What each kind of edge gives the lowering. Only these tables name edge kinds; a relation's lowering asks for capabilities.
type Entity<K extends CadSketchGraphEntity['kind']> = Extract<CadSketchGraphEntity, { kind: K }>;
type Capability<R> = { readonly [K in CadSketchGraphEntity['kind']]?: (lowering: CadSketchLowering, entity: Entity<K>) => R };
const SUPPORTS: Capability<readonly [string, string]> = { line: (_, line) => [line.startPointId, line.endPointId] };
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
const capability = <R>(table: Capability<R>, entity: CadSketchGraphEntity) =>
  table[entity.kind] as ((lowering: CadSketchLowering, entity: CadSketchGraphEntity) => R) | undefined;

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

  constructor(readonly graph: CadSketchGraph, private readonly parameters: Readonly<Record<string, number>>,
    private readonly pointParameters: ReadonlyMap<string, number>, readonly radiusParameters: ReadonlyMap<string, number>,
    private readonly numericPoints: ReadonlyMap<string, Point2>) {}

  /** Lowers one relation through its definition. */
  lower(relation: CadSketchGraphRelation) {
    this.relation = relation; this.sourceId = relation.id;
    cadSketchRelationDefinition(relation).lower(relation, this);
  }
  /** The equations an edge keeps by itself, under its own id. */
  structure(entity: CadSketchGraphEntity) {
    const structure = capability(STRUCTURES, entity);
    if (!structure) return;
    this.relation = undefined; this.sourceId = entity.id;
    structure(this, entity);
  }
  /** A drag target: a value on one coordinate of the dragged point, solved but left out of diagnosis. */
  target(pointId: string, axis: 0 | 1, value: number) {
    this.relation = undefined; this.sourceId = pointId;
    this.equations.push({ kind: 'value', operands: [this.point(pointId)[axis]], value, sourceId: pointId, tag: this.tags++, temporary: true });
  }

  point(pointId: string): CadSketchPointParameters {
    const x = this.pointParameters.get(pointId);
    if (x === undefined) throw new CadSketchLoweringRefusal(pointId, 'point');
    return [x, x + 1];
  }
  through(fromPointId: string, towardPointId: string): CadSketchSupportParameters {
    return [...this.point(fromPointId), ...this.point(towardPointId)];
  }
  span(fromPointId: string, toPointId: string): CadSketchSizeParameters {
    return { kind: 'span', span: this.through(fromPointId, toPointId) };
  }
  edge(entityId: string): CadSketchGraphEntity {
    if (!this.entities) {
      this.entities = new Map();
      for (const entity of this.graph.entities) if (!this.entities.has(entity.id)) this.entities.set(entity.id, entity);
    }
    const entity = this.entities.get(entityId);
    if (!entity) throw new CadSketchLoweringRefusal(entityId, 'edge');
    return entity;
  }
  support(edge: CadSketchGraphEntity): CadSketchSupportParameters {
    const ends = capability(SUPPORTS, edge)?.(this, edge);
    if (!ends) throw new CadSketchLoweringRefusal(edge.id, 'support');
    return this.through(ends[0], ends[1]);
  }
  centre(edge: CadSketchGraphEntity): string {
    const centre = capability(CENTRES, edge)?.(this, edge);
    if (centre === undefined) throw new CadSketchLoweringRefusal(edge.id, 'centre');
    return centre;
  }
  size(edge: CadSketchGraphEntity): CadSketchSizeParameters {
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
    this.equations.push({ kind, operands, value, sourceId: this.sourceId, tag: this.sharedTag ?? this.tags++ });
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
  onCircle(pointId: string, edge: CadSketchGraphEntity) {
    const centre = this.centre(edge), size = this.size(edge);
    this.equalSizes(this.span(centre, pointId), size);
    this.radialHolds.push({ point: this.point(pointId)[0], centre: this.point(centre)[0], size });
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
