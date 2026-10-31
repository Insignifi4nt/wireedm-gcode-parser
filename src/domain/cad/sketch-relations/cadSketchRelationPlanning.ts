import type { CadScalar } from '../cadDocument';
import { evaluateCadScalar } from '../cadExpression';
import { isAcceptedCadSketchGraph, type CadSketchGraph, type CadSketchGraphEntity, type CadSketchGraphPoint, type CadSketchGraphRelation } from '../cadSketchGraph';
import { resolveCadSketchPointIdentities } from '../cadSketchGraphJoints';
import { cadSketchEntityPointIds } from '../cadSketchGraphReferences';
import { resolveCadSketchMidpointOperands } from '../cadSketchMidpointRelations';
import { resolveCadSketchPointOnCurveOperands } from '../cadSketchPointOnCurveRelations';
import { resolveCadSketchPointOnLineOperands } from '../cadSketchPointOnLineRelations';
import { resolveCadSketchSymmetryOperands } from '../cadSketchSymmetryRelations';
import { resolveCadSketchTangentJoint } from '../cadSketchTangentRelations';
import { cadSketchRelationsLike } from './cadSketchRelationRegistry';
import type { CadSketchRelationIntent, CadSketchRelationPlan, CadSketchRelationPlanner } from './cadSketchRelationTypes';

// The Constrain tool's planning of value-free relations, which the relation offers share: the identical-relation lookup, Coincident
// identities, held coordinates, and what the value-free relations already imply. The tool keeps its prompts and its origin and axis
// cases, which read the same holds and traces.

type Entity = CadSketchGraphEntity;
type Axis = 'x' | 'y';
const NO_PARAMETERS: Readonly<Record<string, number>> = Object.freeze({});

/**
 * Whether a coordinate is zero whatever the parameters are: 0, or an expression of numbers alone such as `"0"` or `"2 - 2"`.
 * A value that follows a parameter is a dimension that only happens to be zero now, so it never counts.
 */
export function cadSketchZeroScalar(value: CadScalar | undefined): boolean {
  if (value === undefined) return false;
  try { return evaluateCadScalar(value, NO_PARAMETERS) === 0; } catch { return false; }
}

/** What value-free relations keep in a sketch: coordinates at 0, pairs sharing a coordinate and line directions. */
export type CadSketchTrace = {
  readonly zero: (pointId: string, axis: Axis) => boolean;
  /** Kept equal to a linked reference coordinate now at 0, which its source can move, and held at 0 by nothing else. */
  readonly linked: (pointId: string, axis: Axis) => boolean;
  readonly equal: (pair: readonly [string, string], axis: Axis) => boolean;
  readonly direction: (lineId: string) => 'horizontal' | 'vertical' | null;
};
/**
 * How a point already holds the coordinate a plane reference sets to zero. `held` says something holds it there: a relation
 * listed in `ids`, or a coordinate expression that is always zero. `away` says what holds it elsewhere, or `source` that only a
 * linked reference holds it there now, which its source sketch can move. Only fixed coordinates are `removable`: removing a
 * fixed point would release more than this coordinate, and an expression is edited, not removed.
 */
export type CadSketchCoordinateHold = { readonly held: boolean; readonly ids: readonly string[]; readonly removable: boolean; readonly away: 'dimension' | 'fixed' | 'linked' | 'source' | 'expression' | null };

/** The shared planner with the holds and traces the Constrain tool's origin and axis cases read too. */
export interface CadSketchRelationPlanning extends CadSketchRelationPlanner {
  /** The points joined to this one by Coincident, itself included. */
  joint(pointId: string): ReadonlySet<string>;
  /** Whether two stored point ids name the pair's two places, in either order. */
  sameJoints(ids: readonly string[], pair: readonly [string, string]): boolean;
  /** What the value-free relations imply, worked out once for each graph. */
  traced(): CadSketchTrace;
  /** How the point's own relations, expressions and linked references hold this coordinate at 0. */
  holding(pointId: string, axis: Axis): CadSketchCoordinateHold;
  /** As `holding`, counting a coordinate held at 0 only through other relations as held, with no single relation to remove. */
  holdingTraced(pointId: string, axis: Axis): CadSketchCoordinateHold;
}

const isLine = (entity: Entity | undefined): entity is Extract<Entity, { kind: 'line' }> => entity?.kind === 'line';
const isCurve = (entity: Entity | undefined): entity is Extract<Entity, { kind: 'arc' | 'circle' }> => entity?.kind === 'arc' || entity?.kind === 'circle';
const samePoints = (ids: readonly string[], pair: readonly [string, string]) => ids.length === 2 && ids.includes(pair[0]) && ids.includes(pair[1]);
const sameIds = (relation: CadSketchGraphRelation, pair: readonly [string, string]) => 'lineIds' in relation ? samePoints(relation.lineIds, pair)
  : 'curveIds' in relation ? samePoints(relation.curveIds, pair) : 'pointIds' in relation && samePoints(relation.pointIds, pair);
// A level pair shares Y and an upright pair X.
const keeps = { horizontal: 'y', vertical: 'x' } as const;

const available = (relations: readonly CadSketchRelationIntent[]): CadSketchRelationPlan => ({ state: 'available', relations });
const blocked = (reason: string): CadSketchRelationPlan => ({ state: 'blocked', reason });
/** Applied when relations hold it, with how; refused with that reason when nothing the graph stores does. */
const held = (reason: string, ids?: readonly string[]): CadSketchRelationPlan => ids?.length ? { state: 'applied', relationIds: ids, reason } : blocked(reason);
/** The message of a failed check as the domain gives it, or `fallback` when it carries none. */
const precise = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '').trim() || fallback;

// A sketch graph is never changed in place, so every plan, step and choice over the same graph shares one trace.
const tracedSketches = new WeakMap<CadSketchGraph, CadSketchTrace>();
const planners = new WeakMap<CadSketchGraph, CadSketchRelationPlanning>();

/** The shared planner over one graph, kept with each accepted graph, which cannot change. */
export function cadSketchRelationPlanner(graph: CadSketchGraph): CadSketchRelationPlanning {
  const kept = planners.get(graph);
  if (kept) return kept;
  const points = new Map<string, CadSketchGraphPoint>(graph.points.map(point => [point.id, point]));
  const entities = new Map<string, Entity>(graph.entities.map(entity => [entity.id, entity]));
  const entity = (id: string) => entities.get(id);
  const exists = (match: (relation: CadSketchGraphRelation) => boolean) => graph.relations.some(match);
  const matching = (match: (relation: CadSketchGraphRelation) => boolean) => graph.relations.filter(match).map(relation => relation.id);
  /** The relation, unless an identical one is stored or its check fails. */
  const checked = (relation: CadSketchRelationIntent, check?: () => unknown): CadSketchRelationPlan => {
    const existing = cadSketchRelationsLike(graph, relation);
    if (existing.length) return { state: 'applied', relationIds: existing };
    try { check?.(); } catch (cause) { return blocked(precise(cause, 'These picks cannot take this constraint.')); }
    return available([relation]);
  };
  // A point shares its position with every point joined to it, so a relation on any of them holds it too.
  let identityOf: ((pointId: string) => string) | undefined;
  const identity = (pointId: string) => (identityOf ??= resolveCadSketchPointIdentities(graph))(pointId);
  const sameJoints = (ids: readonly string[], pair: readonly [string, string]) => {
    if (ids.length !== 2) return false;
    const [a, b, p, q] = [ids[0], ids[1], pair[0], pair[1]].map(identity);
    return a === p && b === q || a === q && b === p;
  };
  const joint = (pointId: string) => {
    const root = identity(pointId);
    return new Set(graph.points.filter(point => identity(point.id) === root).map(point => point.id));
  };
  const holding = (pointId: string, axis: Axis): CadSketchCoordinateHold => {
    const index = axis === 'x' ? 0 : 1, joined = joint(pointId), ids: string[] = [];
    let removable = true, expression = false, linked = false;
    // A coordinate written as an expression is fixed by it: always zero holds the point on the reference, anything else elsewhere.
    for (const point of graph.points) {
      const value = joined.has(point.id) ? point.position[index] : undefined;
      if (typeof value !== 'string') continue;
      if (!cadSketchZeroScalar(value)) return { held: false, ids: [], removable: false, away: 'expression' };
      expression = true; removable = false;
    }
    for (const relation of graph.relations) {
      let values: readonly (CadScalar | undefined)[], kind: NonNullable<CadSketchCoordinateHold['away']>;
      if (relation.kind === 'fixed-axis' && relation.axis === axis && joined.has(relation.pointId)) { values = [relation.value]; kind = 'dimension'; }
      else if (relation.kind === 'fixed-point' && joined.has(relation.pointId)) { values = [relation.position[index]]; kind = 'fixed'; }
      else if (relation.kind === 'external-reference') {
        const owner = entity(relation.entityId), linked = owner ? cadSketchEntityPointIds(owner).filter(id => joined.has(id)) : [];
        if (!linked.length) continue;
        values = linked.map(id => points.get(id)?.position[index]); kind = 'linked';
      } else continue;
      if (!values.every(cadSketchZeroScalar)) return { held: false, ids: [], removable: false, away: kind };
      // A linked reference at 0 is only a snapshot of its source, which a parameter of that sketch can move.
      if (kind === 'linked') { linked = true; continue; }
      ids.push(relation.id); removable &&= kind === 'dimension';
    }
    if (!expression && !ids.length && linked) return { held: false, ids: [], removable: false, away: 'source' };
    return { held: expression || ids.length > 0, ids, removable, away: null };
  };
  // What value-free relations imply whatever the dimensions are. Coordinates kept equal through Coincident, Horizontal,
  // Vertical, a level or upright line, a point on or at the middle of one, lines collinear with one or a mirror pair share a
  // class, and a class with a coordinate held at 0 holds all of it there. Directions pass through Parallel, Perpendicular and
  // Collinear. Dimensions, angles and other values never count: a later edit could move the geometry off the axis, so a fix
  // they only happen to repeat at the current solution is still added, and preparation rejects it as redundant. A linked
  // reference is a snapshot of its source, so its coordinates at 0 hold nothing and give no line a direction; a coordinate kept
  // equal to one is only marked, so the step can ask for the reference to be detached.
  const traced = (): CadSketchTrace => {
    const cached = tracedSketches.get(graph);
    if (cached) return cached;
    // One union-find over the X and Y of every joint, with the origin's X and Y as the last two nodes.
    const slots = new Map<string, number>(), joints = new Map<string, number>();
    for (const point of graph.points) {
      const root = identity(point.id), slot = joints.get(root) ?? joints.size;
      joints.set(root, slot); slots.set(point.id, slot);
    }
    const parent = Int32Array.from({ length: joints.size * 2 + 2 }, (_, index) => index);
    const find = (node: number) => {
      let root = node;
      while (parent[root] !== root) root = parent[root];
      for (let at = node; parent[at] !== root;) { const up = parent[at]; parent[at] = root; at = up; }
      return root;
    };
    const node = (pointId: string, axis: Axis) => { const slot = slots.get(pointId); return slot === undefined ? -1 : slot * 2 + (axis === 'x' ? 0 : 1); };
    const origin = (axis: Axis) => joints.size * 2 + (axis === 'x' ? 0 : 1);
    const same = (a: number, b: number) => a >= 0 && b >= 0 && find(a) === find(b);
    const zero = (pointId: string, axis: Axis) => same(node(pointId, axis), origin(axis));
    const equal = (pair: readonly [string, string], axis: Axis) => same(node(pair[0], axis), node(pair[1], axis));
    let changed = false;
    const join = (a: number, b: number) => { if (a < 0 || b < 0) return; const [p, q] = [find(a), find(b)]; if (p !== q) { parent[p] = q; changed = true; } };
    const link = (a: string, b: string, axis: Axis) => join(node(a, axis), node(b, axis));
    // The holds `holding` reads, in one pass: a coordinate expression or a fixed coordinate or point at 0.
    const seed = (pointId: string, axis: Axis, value: CadScalar | undefined) => { if (cadSketchZeroScalar(value)) join(node(pointId, axis), origin(axis)); };
    const snapshots: number[] = [];
    for (const point of graph.points) for (const [index, axis] of (['x', 'y'] as const).entries()) if (typeof point.position[index] === 'string') seed(point.id, axis, point.position[index]);
    const lines = graph.entities.filter(isLine), byId = new Map(lines.map(line => [line.id, line]));
    const direction = new Map<string, 'horizontal' | 'vertical'>(), neighbours = new Map<string, { readonly lineId: string; readonly turned: boolean }[]>();
    const dependent: Extract<CadSketchGraphRelation, { kind: 'collinear' | 'point-on-line' | 'midpoint' | 'symmetric' }>[] = [];
    for (const relation of graph.relations) {
      if (relation.kind === 'fixed-axis') seed(relation.pointId, relation.axis, relation.value);
      else if (relation.kind === 'fixed-point') { seed(relation.pointId, 'x', relation.position[0]); seed(relation.pointId, 'y', relation.position[1]); }
      else if (relation.kind === 'external-reference') {
        const owner = entity(relation.entityId);
        for (const id of owner ? cadSketchEntityPointIds(owner) : []) for (const [index, axis] of (['x', 'y'] as const).entries()) {
          if (cadSketchZeroScalar(points.get(id)?.position[index])) snapshots.push(node(id, axis));
        }
      } else if (relation.kind === 'horizontal' || relation.kind === 'vertical') link(relation.pointIds[0], relation.pointIds[1], keeps[relation.kind]);
      if (relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear') {
        const [a, b] = relation.lineIds, turned = relation.kind === 'perpendicular';
        if (!byId.has(a) || !byId.has(b)) continue;
        neighbours.set(a, [...neighbours.get(a) ?? [], { lineId: b, turned }]); neighbours.set(b, [...neighbours.get(b) ?? [], { lineId: a, turned }]);
      }
      if (relation.kind === 'collinear' || relation.kind === 'point-on-line' || relation.kind === 'midpoint' || relation.kind === 'symmetric') dependent.push(relation);
    }
    // A direction spreads through Parallel, Perpendicular and Collinear at once, so a long chain costs one pass.
    const orient = (start: string, kind: 'horizontal' | 'vertical') => {
      if (direction.has(start)) return;
      direction.set(start, kind); changed = true;
      const queue: [string, 'horizontal' | 'vertical'][] = [[start, kind]];
      for (let index = 0; index < queue.length; index++) {
        const [lineId, known] = queue[index];
        for (const next of neighbours.get(lineId) ?? []) {
          if (direction.has(next.lineId)) continue;
          const along = next.turned ? known === 'horizontal' ? 'vertical' : 'horizontal' : known;
          direction.set(next.lineId, along); queue.push([next.lineId, along]);
        }
      }
    };
    // Directions and shared coordinates feed each other, so repeat until neither grows; a sketch usually settles in two passes.
    do {
      changed = false;
      // A line with both ends at one Y is level, unless its ends also share X and it has no direction at all.
      for (const line of lines) {
        const pair = [line.startPointId, line.endPointId] as const, kind = direction.get(line.id);
        if (!kind && equal(pair, 'y') !== equal(pair, 'x')) orient(line.id, equal(pair, 'y') ? 'horizontal' : 'vertical');
      }
      for (const line of lines) { const kind = direction.get(line.id); if (kind) link(line.startPointId, line.endPointId, keeps[kind]); }
      for (const relation of dependent) {
        if (relation.kind === 'collinear') {
          // Collinear lines share one support, so a level pair keeps one Y and an upright pair one X.
          const [from, to] = relation.lineIds.map(id => byId.get(id)), kind = direction.get(relation.lineIds[0]);
          if (from && to && kind) for (const id of [to.startPointId, to.endPointId]) link(from.startPointId, id, keeps[kind]);
          continue;
        }
        const line = byId.get(relation.lineId), kind = direction.get(relation.lineId);
        if (!line || !kind) continue;
        if (relation.kind !== 'symmetric') { link(line.startPointId, relation.pointId, keeps[kind]); continue; }
        // A mirror keeps the coordinate along it, and keeps the other at 0 on both sides when it lies on that axis.
        const across = keeps[kind], [p, q] = relation.pointIds;
        link(p, q, across === 'y' ? 'x' : 'y');
        if (zero(line.startPointId, across) && (zero(p, across) || zero(q, across))) link(p, q, across);
      }
    } while (changed);
    const marked = new Set(snapshots.filter(at => at >= 0).map(find));
    // A point on, or at the middle of, a line whose two ends a linked reference keeps at 0 follows that snapshot too.
    // Each such point waits on its line's end classes and is checked again only when one of them is newly marked, so
    // the order of the relations never matters and each is visited at most twice.
    const waiting = new Map<number, (readonly [number, number, number])[]>();
    for (const relation of dependent) {
      if (relation.kind !== 'point-on-line' && relation.kind !== 'midpoint') continue;
      const line = byId.get(relation.lineId);
      if (line) for (const axis of ['x', 'y'] as const) {
        const nodes = [line.startPointId, line.endPointId, relation.pointId].map(id => node(id, axis));
        if (nodes.some(at => at < 0)) continue;
        const roots = [find(nodes[0]), find(nodes[1]), find(nodes[2])] as const;
        for (const root of new Set([roots[0], roots[1]])) { const list = waiting.get(root); if (list) list.push(roots); else waiting.set(root, [roots]); }
      }
    }
    for (const queue = [...marked]; queue.length;) {
      for (const [start, end, point] of waiting.get(queue.pop()!) ?? []) {
        if (marked.has(point) || !marked.has(start) || !marked.has(end)) continue;
        marked.add(point); queue.push(point);
      }
    }
    const linked = (pointId: string, axis: Axis) => { const at = node(pointId, axis); return at >= 0 && !zero(pointId, axis) && marked.has(find(at)); };
    const result: CadSketchTrace = { zero, linked, equal, direction: lineId => direction.get(lineId) ?? null };
    tracedSketches.set(graph, result);
    return result;
  };
  // A coordinate held at 0 only through other relations counts as held; there is no single relation to offer for removal.
  const holdingTraced = (pointId: string, axis: Axis): CadSketchCoordinateHold => {
    const hold = holding(pointId, axis), { zero, linked } = traced();
    if (hold.held || hold.away && hold.away !== 'source') return hold;
    return zero(pointId, axis) ? { held: true, ids: [], removable: false, away: null } : linked(pointId, axis) ? { held: false, ids: [], removable: false, away: 'source' } : hold;
  };

  const planner: CadSketchRelationPlanning = {
    graph, point: id => points.get(id), entity, identity, joint, sameJoints, traced, holding, holdingTraced,
    // Other relations can already keep a pair level or upright, through a chain of them or both points on one axis.
    align: (kind, pair) => {
      const other = kind === 'horizontal' ? 'vertical' : 'horizontal', { equal } = traced();
      if (identity(pair[0]) === identity(pair[1])) return blocked('These points are already joined.');
      if (exists(relation => relation.kind === other && sameJoints(relation.pointIds, pair))) return blocked(`This is already ${other}.`);
      if (equal(pair, keeps[other])) return blocked(`This is already ${other} through other relations.`);
      const existing = matching(relation => relation.kind === kind && sameJoints(relation.pointIds, pair));
      if (existing.length) return { state: 'applied', relationIds: existing };
      return equal(pair, keeps[kind]) ? blocked(`This is already ${kind} through other relations.`) : checked({ kind, pointIds: pair });
    },
    coincide: pair => identity(pair[0]) === identity(pair[1]) ? held('These points are already joined.', cadSketchRelationsLike(graph, { kind: 'coincident', pointIds: pair }))
      : checked({ kind: 'coincident', pointIds: [pair[0], pair[1]] }),
    // Two curves on one centre point name no relation: a Coincident joining that point to another one does not make them concentric,
    // and removing it would delete an unrelated relation. The whole key is matched, so a centre given twice matches nothing stored.
    concentric: (first, second) => {
      const centers = [first.centerPointId, second.centerPointId] as const;
      return identity(centers[0]) === identity(centers[1]) ? held('These already share a center.', cadSketchRelationsLike(graph, { kind: 'coincident', pointIds: centers }))
        : checked({ kind: 'coincident', pointIds: [centers[0], centers[1]] });
    },
    // Lines that keep another of these relations, or an angle, cannot take this one as well.
    orient: (kind, pair) => {
      const blocker = graph.relations.find(relation => (relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear') && relation.kind !== kind && sameIds(relation, pair)
        || relation.kind === 'line-angle' && samePoints(relation.rays.map(ray => ray.lineId), pair));
      return blocker ? blocked(`These lines already have ${blocker.kind === 'line-angle' ? 'an angle' : `a ${blocker.kind} relation`}. Remove it first.`) : checked({ kind, lineIds: pair });
    },
    place: relation => checked(relation, () => relation.kind === 'point-on-line' ? resolveCadSketchPointOnLineOperands(graph, relation)
      : relation.kind === 'midpoint' ? resolveCadSketchMidpointOperands(graph, relation) : resolveCadSketchPointOnCurveOperands(graph, relation)),
    tangent: (a, b) => {
      if (!(isLine(a) && b.kind === 'arc' || a.kind === 'arc' && isLine(b))) return blocked('Choose a line and an arc.');
      const joints = [a.startPointId, a.endPointId].flatMap(first => [b.startPointId, b.endPointId].filter(second => identity(first) === identity(second))
        .map(second => [{ entityId: a.id, pointId: first }, { entityId: b.id, pointId: second }] as const));
      if (joints.length !== 1) return blocked(joints.length ? 'Choose a line and arc with one shared endpoint.' : 'Join these endpoints with Coincident before adding Tangent.');
      const endpoints = joints[0];
      return checked({ kind: 'tangent-joint', endpoints }, () => resolveCadSketchTangentJoint(graph, { endpoints }));
    },
    equal: (a, b) => isLine(a) && isLine(b) ? checked({ kind: 'equal-length', lineIds: [a.id, b.id] })
      : isCurve(a) && isCurve(b) ? checked({ kind: 'equal-radius', curveIds: [a.id, b.id] }) : blocked('Choose two lines, or two arcs or circles.'),
    // A point with its own circle, or two circles on one centre, are one point given twice: the check refuses it, and no Symmetric of
    // that point with another one is named as holding it.
    mirror: (targets, line) => {
      const [first, second] = targets.map(pick => pick.kind === 'point' ? pick.id : (entity(pick.id) as Extract<Entity, { kind: 'circle' }>).centerPointId);
      const operands = { pointIds: [first, second] as const, lineId: line.id };
      return checked({ kind: 'symmetric', ...operands }, () => resolveCadSketchSymmetryOperands(graph, operands));
    },
    fix: pointId => {
      const point = points.get(pointId);
      if (!point) return blocked('This point is no longer in the sketch.');
      const joined = joint(point.id);
      const fixed = matching(relation => relation.kind === 'fixed-point' && joined.has(relation.pointId));
      if (fixed.length) return held('This point is already fixed.', fixed);
      const holds = (axis: Axis) => exists(relation => relation.kind === 'fixed-axis' && relation.axis === axis && joined.has(relation.pointId));
      const [x, y] = point.position;
      // Fix holds the point where it is, as one fixed point. A coordinate written as an expression already follows it, and one
      // already held by a coordinate relation keeps it, so only the other numeric coordinate is held, as a distance from its axis.
      if (typeof x === 'number' && typeof y === 'number' && !holds('x') && !holds('y')) return available([{ kind: 'fixed-point', pointId: point.id, position: [x, y] }]);
      const relations = (['x', 'y'] as const).flatMap((axis, index) => {
        const value = point.position[index];
        return typeof value === 'number' && !holds(axis) ? [{ kind: 'fixed-axis' as const, pointId: point.id, axis, value }] : [];
      });
      // A point saved with both coordinates held one by one is fixed already, as a fixed point is.
      const pair = holds('x') && holds('y') ? matching(relation => relation.kind === 'fixed-axis' && joined.has(relation.pointId)) : undefined;
      return relations.length ? available(relations) : held('This point is already fixed or follows expressions.', pair);
    }
  };
  if (isAcceptedCadSketchGraph(graph)) planners.set(graph, Object.freeze(planner));
  return planner;
}

/** Every order of the picks, the picks' own first, as the Constrain tool's choices and the offers try them. */
export function cadSketchPickOrders<T>(items: readonly T[]): readonly (readonly T[])[] {
  return items.length < 2 ? [items] : items.flatMap((item, index) => cadSketchPickOrders([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
}
