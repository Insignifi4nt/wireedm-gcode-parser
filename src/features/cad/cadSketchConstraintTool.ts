import { userFacingMessage } from '@/lib/userMessage';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { resolveCadSketchPointIdentities } from '@/domain/cad/cadSketchGraphJoints';
import { resolveCadSketchMidpointOperands } from '@/domain/cad/cadSketchMidpointRelations';
import { resolveCadSketchPointOnLineOperands } from '@/domain/cad/cadSketchPointOnLineRelations';
import { resolveCadSketchPointOnCurveOperands } from '@/domain/cad/cadSketchPointOnCurveRelations';
import { resolveCadSketchSymmetryOperands } from '@/domain/cad/cadSketchSymmetryRelations';
import { resolveCadSketchTangentJoint } from '@/domain/cad/cadSketchTangentRelations';
import { cadSketchEntityPointIds } from '@/domain/cad/cadSketchGraphReferences';
import type { CadScalar } from '@/domain/cad/cadDocument';
import { cadSketchZeroScalar, type CadSketchDatum, type CadSketchGraphSelection } from './cadSketchGraphSelection';

/** Positional constraints offered as tools: each one says what to pick next and adds its relation once the picks are complete. */
export const CAD_SKETCH_CONSTRAINT_TOOLS = ['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'tangent', 'equal', 'midpoint', 'concentric', 'symmetric', 'fix'] as const;
export type CadSketchConstraintTool = typeof CAD_SKETCH_CONSTRAINT_TOOLS[number];
export const cadSketchConstraintToolLabels: Readonly<Record<CadSketchConstraintTool, string>> = {
  coincident: 'Coincident', horizontal: 'Horizontal', vertical: 'Vertical', parallel: 'Parallel', perpendicular: 'Perpendicular', tangent: 'Tangent',
  equal: 'Equal', midpoint: 'Midpoint', concentric: 'Concentric', symmetric: 'Symmetric', fix: 'Fix'
};
export const cadSketchConstraintToolHelp: Readonly<Record<CadSketchConstraintTool, string>> = {
  coincident: 'Two points share one position. A point and a line, arc, circle or axis keep the point on it; a point and the origin pin it there. A line and an axis keep the line on the axis, and an arc or circle and an axis keep its center on the axis.',
  horizontal: 'A line, or two points, stay level. A point and the origin stay level with it.', vertical: 'A line, or two points, stay upright. A point and the origin stay above or below it.',
  parallel: 'Two lines, or a line and an axis, keep the same direction.', perpendicular: 'Two lines, or a line and an axis, meet at a right angle.',
  tangent: 'A line and an arc that share an endpoint join smoothly.', equal: 'Two lines keep the same length, or two arcs or circles the same radius.',
  midpoint: 'A point stays at the middle of a line.', concentric: 'Two arcs or circles share one center, or an arc or circle is centered at the origin.',
  symmetric: 'Two points or circle centers mirror each other about a line.', fix: 'A point keeps its current position.'
};

/** A constraint operand: sketch geometry, or one of the plane's own references. */
export type CadSketchConstraintPick = CadSketchGraphSelection | { readonly kind: 'datum'; readonly id: CadSketchDatum };

export type CadSketchConstraintStep =
  | { readonly status: 'more'; readonly prompt: string; readonly entityIds: readonly string[]; readonly pointIds: readonly string[]; readonly datums: readonly CadSketchDatum[] }
  | { readonly status: 'ready'; readonly relations: readonly CadSketchGraphRelation[] }
  /** `applied` names the existing relations when the constraint is already in place, so a caller can offer to remove them. */
  | { readonly status: 'invalid'; readonly reason: string; readonly applied?: readonly string[] };

type Entity = CadSketchGraphEntity;
/** What value-free relations keep in a sketch: coordinates at 0, pairs sharing a coordinate and line directions. */
type Traced = {
  readonly zero: (pointId: string, axis: 'x' | 'y') => boolean;
  /** Kept equal to a linked reference coordinate now at 0, which its source can move, and held at 0 by nothing else. */
  readonly linked: (pointId: string, axis: 'x' | 'y') => boolean;
  readonly equal: (pair: readonly [string, string], axis: 'x' | 'y') => boolean;
  readonly direction: (lineId: string) => 'horizontal' | 'vertical' | null;
};
// A sketch graph is never changed in place, so every step and choice over the same graph shares one trace.
const tracedSketches = new WeakMap<CadSketchGraph, Traced>();
// A level pair shares Y and an upright pair X.
const keeps = { horizontal: 'y', vertical: 'x' } as const;
/**
 * How a point already holds the coordinate a plane reference sets to zero. `held` says something holds it there: a relation
 * listed in `ids`, or a coordinate expression that is always zero. `away` says what holds it elsewhere, or `source` that only a
 * linked reference holds it there now, which its source sketch can move. Only fixed coordinates are `removable`: removing a
 * fixed point would release more than this coordinate, and an expression is edited, not removed.
 */
type Hold = { readonly held: boolean; readonly ids: readonly string[]; readonly removable: boolean; readonly away: 'dimension' | 'fixed' | 'linked' | 'source' | 'expression' | null };
const isLine = (entity: Entity | undefined): entity is Extract<Entity, { kind: 'line' }> => entity?.kind === 'line';
const isCurve = (entity: Entity | undefined): entity is Extract<Entity, { kind: 'arc' | 'circle' }> => entity?.kind === 'arc' || entity?.kind === 'circle';
const samePoints = (ids: readonly string[], pair: readonly [string, string]) => ids.length === 2 && ids.includes(pair[0]) && ids.includes(pair[1]);
const sameIds = (relation: CadSketchGraphRelation, pair: readonly [string, string]) => 'lineIds' in relation ? samePoints(relation.lineIds, pair)
  : 'curveIds' in relation ? samePoints(relation.curveIds, pair) : 'pointIds' in relation && samePoints(relation.pointIds, pair);
const attempt = (check: () => unknown) => { try { check(); return null; } catch (cause) { return userFacingMessage(cause, 'These picks cannot take this constraint.'); } };

/**
 * The next step of a tool-first positional constraint. `picks` are in click order and already passed the previous step's eligible ids.
 * A ready step carries new relations; an existing identical relation is reported instead of duplicated.
 */
export function cadSketchConstraintStep(graph: CadSketchGraph, tool: CadSketchConstraintTool, picks: readonly CadSketchConstraintPick[], newId: () => string): CadSketchConstraintStep {
  const entity = (id: string) => graph.entities.find(item => item.id === id);
  const points = picks.filter(pick => pick.kind === 'point').map(pick => pick.id);
  const entities = picks.filter(pick => pick.kind === 'entity').map(pick => entity(pick.id)).filter((item): item is Entity => Boolean(item));
  const allPoints = graph.points.map(point => point.id), lines = graph.entities.filter(isLine).map(line => line.id), curves = graph.entities.filter(isCurve).map(curve => curve.id);
  const datum = picks.find(pick => pick.kind === 'datum')?.id;
  const more = (prompt: string, entityIds: readonly string[], pointIds: readonly string[], datums: readonly CadSketchDatum[] = []): CadSketchConstraintStep => ({ status: 'more', prompt,
    entityIds: entityIds.filter(id => !picks.some(pick => pick.kind === 'entity' && pick.id === id)), pointIds: pointIds.filter(id => !points.includes(id)), datums: datum ? [] : datums });
  const invalid = (reason: string, applied?: readonly string[]): CadSketchConstraintStep => applied?.length ? { status: 'invalid', reason, applied } : { status: 'invalid', reason };
  const exists = (match: (relation: CadSketchGraphRelation) => boolean) => graph.relations.some(match);
  const matching = (match: (relation: CadSketchGraphRelation) => boolean) => graph.relations.filter(match).map(relation => relation.id);
  const ready = (relation: CadSketchGraphRelation, check?: () => unknown): CadSketchConstraintStep => {
    const existing = matching(other => other.kind === relation.kind && sameRelation(other, relation));
    if (existing.length) return invalid(`${cadSketchConstraintToolLabels[tool]} is already applied here.`, existing);
    const reason = check ? attempt(check) : null;
    return reason ? invalid(reason) : { status: 'ready', relations: [relation] };
  };
  // A point shares its position with every point joined to it, so a relation on any of them holds it too.
  let identityOf: ((pointId: string) => string) | undefined;
  const identity = (pointId: string) => (identityOf ??= resolveCadSketchPointIdentities(graph))(pointId);
  const sameJoints = (ids: readonly string[], pair: readonly [string, string]) => {
    if (ids.length !== 2) return false;
    const [a, b, p, q] = [ids[0], ids[1], pair[0], pair[1]].map(identity);
    return a === p && b === q || a === q && b === p;
  };
  // Other relations can already keep a pair level or upright, through a chain of them or both points on one axis.
  const axisRelation = (kind: 'horizontal' | 'vertical', pair: readonly [string, string]) => {
    const other = kind === 'horizontal' ? 'vertical' : 'horizontal', { equal } = traced();
    if (identity(pair[0]) === identity(pair[1])) return invalid('These points are already joined.');
    if (exists(relation => relation.kind === other && sameJoints(relation.pointIds, pair))) return invalid(`This is already ${other}.`);
    if (equal(pair, keeps[other])) return invalid(`This is already ${other} through other relations.`);
    const existing = matching(relation => relation.kind === kind && sameJoints(relation.pointIds, pair));
    if (existing.length) return invalid(`${cadSketchConstraintToolLabels[tool]} is already applied here.`, existing);
    return equal(pair, keeps[kind]) ? invalid(`This is already ${kind} through other relations.`) : ready({ id: newId(), kind, pointIds: pair });
  };
  const zeroAxis = (pointId: string, axis: 'x' | 'y') => ({ id: newId(), kind: 'fixed-axis' as const, pointId, axis, value: 0 });
  const joint = (pointId: string) => {
    const root = identity(pointId);
    return new Set(graph.points.filter(point => identity(point.id) === root).map(point => point.id));
  };
  const holding = (pointId: string, axis: 'x' | 'y'): Hold => {
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
      let values: readonly (CadScalar | undefined)[], kind: NonNullable<Hold['away']>;
      if (relation.kind === 'fixed-axis' && relation.axis === axis && joined.has(relation.pointId)) { values = [relation.value]; kind = 'dimension'; }
      else if (relation.kind === 'fixed-point' && joined.has(relation.pointId)) { values = [relation.position[index]]; kind = 'fixed'; }
      else if (relation.kind === 'external-reference') {
        const owner = entity(relation.entityId), linked = owner ? cadSketchEntityPointIds(owner).filter(id => joined.has(id)) : [];
        if (!linked.length) continue;
        values = linked.map(id => graph.points.find(point => point.id === id)?.position[index]); kind = 'linked';
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
  const traced = (): Traced => {
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
    const node = (pointId: string, axis: 'x' | 'y') => { const slot = slots.get(pointId); return slot === undefined ? -1 : slot * 2 + (axis === 'x' ? 0 : 1); };
    const origin = (axis: 'x' | 'y') => joints.size * 2 + (axis === 'x' ? 0 : 1);
    const same = (a: number, b: number) => a >= 0 && b >= 0 && find(a) === find(b);
    const zero = (pointId: string, axis: 'x' | 'y') => same(node(pointId, axis), origin(axis));
    const equal = (pair: readonly [string, string], axis: 'x' | 'y') => same(node(pair[0], axis), node(pair[1], axis));
    let changed = false;
    const join = (a: number, b: number) => { if (a < 0 || b < 0) return; const [p, q] = [find(a), find(b)]; if (p !== q) { parent[p] = q; changed = true; } };
    const link = (a: string, b: string, axis: 'x' | 'y') => join(node(a, axis), node(b, axis));
    // The holds `holding` reads, in one pass: a coordinate expression or a fixed coordinate or point at 0.
    const seed = (pointId: string, axis: 'x' | 'y', value: CadScalar | undefined) => { if (cadSketchZeroScalar(value)) join(node(pointId, axis), origin(axis)); };
    const snapshots: number[] = [];
    for (const point of graph.points) for (const [index, axis] of (['x', 'y'] as const).entries()) if (typeof point.position[index] === 'string') seed(point.id, axis, point.position[index]);
    const positions = new Map(graph.points.map(point => [point.id, point.position]));
    const lines = graph.entities.filter(isLine), byId = new Map(lines.map(line => [line.id, line]));
    const direction = new Map<string, 'horizontal' | 'vertical'>(), neighbours = new Map<string, { readonly lineId: string; readonly turned: boolean }[]>();
    const dependent: Extract<CadSketchGraphRelation, { kind: 'collinear' | 'point-on-line' | 'midpoint' | 'symmetric' }>[] = [];
    for (const relation of graph.relations) {
      if (relation.kind === 'fixed-axis') seed(relation.pointId, relation.axis, relation.value);
      else if (relation.kind === 'fixed-point') { seed(relation.pointId, 'x', relation.position[0]); seed(relation.pointId, 'y', relation.position[1]); }
      else if (relation.kind === 'external-reference') {
        const owner = entity(relation.entityId);
        for (const id of owner ? cadSketchEntityPointIds(owner) : []) for (const [index, axis] of (['x', 'y'] as const).entries()) {
          if (cadSketchZeroScalar(positions.get(id)?.[index])) snapshots.push(node(id, axis));
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
    // A point on, or at the middle of, a line whose two ends a linked reference keeps at 0 follows that snapshot too,
    // repeated until nothing more is marked so the order of the relations never matters.
    for (let grew = true; grew;) {
      grew = false;
      for (const relation of dependent) {
        if (relation.kind !== 'point-on-line' && relation.kind !== 'midpoint') continue;
        const line = byId.get(relation.lineId);
        if (line) for (const axis of ['x', 'y'] as const) {
          const [start, end, point] = [line.startPointId, line.endPointId, relation.pointId].map(id => node(id, axis));
          if (start < 0 || end < 0 || point < 0 || marked.has(find(point)) || !marked.has(find(start)) || !marked.has(find(end))) continue;
          marked.add(find(point)); grew = true;
        }
      }
    }
    const linked = (pointId: string, axis: 'x' | 'y') => { const at = node(pointId, axis); return at >= 0 && !zero(pointId, axis) && marked.has(find(at)); };
    const result: Traced = { zero, linked, equal, direction: lineId => direction.get(lineId) ?? null };
    tracedSketches.set(graph, result);
    return result;
  };
  // A coordinate held at 0 only through other relations counts as held; there is no single relation to offer for removal.
  const holdingTraced = (pointId: string, axis: 'x' | 'y'): Hold => {
    const hold = holding(pointId, axis), { zero, linked } = traced();
    if (hold.held || hold.away && hold.away !== 'source') return hold;
    return zero(pointId, axis) ? { held: true, ids: [], removable: false, away: null } : linked(pointId, axis) ? { held: false, ids: [], removable: false, away: 'source' } : hold;
  };
  const heldAway = (subject: string, hold: Hold, axis: 'x' | 'y', target: string) => invalid(hold.away === 'dimension' ? `${subject} already has a fixed ${axis.toUpperCase()}. Remove that dimension first.`
    : hold.away === 'expression' ? `${subject} has its ${axis.toUpperCase()} set by an expression away from ${target}. Edit that coordinate first.`
    : hold.away === 'linked' ? `${subject} follows a linked reference away from ${target}. Detach it first.`
    : hold.away === 'source' ? `${subject} follows a linked reference that its source sketch can move off ${target}. Detach it first.` : `${subject} is fixed away from ${target}. Remove that relation first.`);
  // Offer the holding relations for removal only when removing them releases exactly what this constraint holds.
  const alreadyHeld = (reason: string, holds: readonly Hold[]) => invalid(reason, holds.every(hold => hold.removable) ? [...new Set(holds.flatMap(hold => hold.ids))] : undefined);
  // A point placed on a plane reference fixes the coordinates that reference sets to zero, unless something already holds them there.
  const onDatum = (pointId: string, axes: readonly ('x' | 'y')[], subject: string, target: string, already: string): CadSketchConstraintStep => {
    const holds = axes.map(axis => holdingTraced(pointId, axis)), away = holds.findIndex(hold => hold.away);
    if (away >= 0) return heldAway(subject, holds[away], axes[away], target);
    const relations = axes.filter((_, index) => !holds[index].held).map(axis => zeroAxis(pointId, axis));
    return relations.length ? { status: 'ready', relations } : alreadyHeld(already, holds);
  };
  const onAxis = (pointId: string, reference: 'x-axis' | 'y-axis', subject: string, already: string) =>
    onDatum(pointId, [reference === 'x-axis' ? 'y' : 'x'], subject, `the ${reference === 'x-axis' ? 'X' : 'Y'} axis`, already);
  // A line on an axis keeps both endpoints on it. An endpoint already held there counts, and a line already level with the
  // axis, directly or through other relations, needs one endpoint, since a second would repeat the first.
  const lineOnAxis = (line: Extract<Entity, { kind: 'line' }>, reference: 'x-axis' | 'y-axis'): CadSketchConstraintStep => {
    const axis = reference === 'x-axis' ? 'y' : 'x', level = reference === 'x-axis' ? 'horizontal' : 'vertical', across = level === 'horizontal' ? 'vertical' : 'horizontal';
    const pair = [line.startPointId, line.endPointId] as const, name = reference === 'x-axis' ? 'X' : 'Y';
    if (exists(relation => relation.kind === across && sameJoints(relation.pointIds, pair))) return invalid(`This line is ${across}, so it cannot lie on the ${name} axis. Remove that relation first.`);
    const kept = traced().direction(line.id);
    if (kept === across) return invalid(`Other relations keep this line ${across}, so it cannot lie on the ${name} axis.`);
    // A level line with one end held keeps the other there too, so that end's own relations are what can be removed.
    // The other end is then held through the line too, even where a linked reference also keeps it at 0 for now.
    const direct = pair.map(pointId => holding(pointId, axis));
    const holds = kept === level && direct.some(hold => hold.held) ? direct.map((hold, index) => hold.away === 'source' ? holdingTraced(pair[index], axis) : hold)
      : pair.map(pointId => holdingTraced(pointId, axis)), away = holds.find(hold => hold.away);
    if (away) return heldAway('An endpoint of this line', away, axis, `the ${name} axis`);
    const missing = pair.filter((_, index) => !holds[index].held);
    const needed = kept === level ? missing.length === 2 ? missing.slice(0, 1) : [] : missing;
    return needed.length ? { status: 'ready', relations: needed.map(pointId => zeroAxis(pointId, axis)) } : alreadyHeld(`This line is already on the ${name} axis.`, holds);
  };
  // A line follows an axis through horizontal or vertical, the same relations a level or upright line takes.
  const alongAxis = (line: Extract<Entity, { kind: 'line' }>, reference: CadSketchDatum, parallel: boolean) => {
    if (reference === 'origin') return invalid('Choose an axis, not the origin.');
    const kind = (reference === 'x-axis') === parallel ? 'horizontal' : 'vertical', pair = [line.startPointId, line.endPointId] as const;
    const existing = matching(relation => relation.kind === kind && sameJoints(relation.pointIds, pair));
    return existing.length ? invalid(`This line is already ${kind}.`, existing) : axisRelation(kind, pair);
  };
  switch (tool) {
    case 'coincident': {
      if (datum && points.length === 1) return datum === 'origin' ? onDatum(points[0], ['x', 'y'], 'This point', 'the origin', 'This point is already at the origin.')
        : onAxis(points[0], datum, 'This point', `This point is already on the ${datum === 'x-axis' ? 'X' : 'Y'} axis.`);
      const line = entities.find(isLine), curve = entities.find(isCurve);
      if (datum && datum !== 'origin' && line) return lineOnAxis(line, datum);
      // An arc or circle on an axis keeps its center there; its curve cannot lie along a straight axis.
      if (datum && datum !== 'origin' && curve) return onAxis(curve.centerPointId, datum, `The center of this ${curve.kind}`, `This ${curve.kind} is already centered on the ${datum === 'x-axis' ? 'X' : 'Y'} axis.`);
      if (datum) return datum === 'origin' ? more('Choose a point to place at the origin', [], allPoints) : more('Choose a point, line, arc or circle to keep on this axis', [...lines, ...curves], allPoints);
      if (points.length === 2) {
        return identity(points[0]) === identity(points[1]) ? invalid('These points are already joined.', matching(relation => relation.kind === 'coincident' && samePoints(relation.pointIds, [points[0], points[1]])))
          : ready({ id: newId(), kind: 'coincident', pointIds: [points[0], points[1]] });
      }
      if (points.length === 1 && line) {
        const operands = { pointId: points[0], lineId: line.id };
        return ready({ id: newId(), kind: 'point-on-line', ...operands }, () => resolveCadSketchPointOnLineOperands(graph, operands));
      }
      // A point on an arc or circle stays on its full circle.
      if (points.length === 1 && curve) {
        const operands = { pointId: points[0], curveId: curve.id };
        return ready({ id: newId(), kind: 'point-on-curve', ...operands }, () => resolveCadSketchPointOnCurveOperands(graph, operands));
      }
      if (points.length === 1) return more('Choose a second point, a line, arc, circle or axis to keep the point on, or the origin', [...lines, ...curves], allPoints, ['origin', 'x-axis', 'y-axis']);
      if (line) return more('Choose a point to keep on this line, or an axis to lay it on', [], allPoints, ['x-axis', 'y-axis']);
      if (curve) return more(`Choose a point to keep on this ${curve.kind}, or an axis to center it on`, [], allPoints, ['x-axis', 'y-axis']);
      return more('Choose a point, line, arc or circle, or the origin or an axis', [...lines, ...curves], allPoints, ['origin', 'x-axis', 'y-axis']);
    }
    case 'horizontal': case 'vertical': {
      const line = entities.find(isLine);
      if (line) return axisRelation(tool, [line.startPointId, line.endPointId]);
      if (points.length === 2) return axisRelation(tool, [points[0], points[1]]);
      if (datum && points.length === 1) return tool === 'horizontal' ? onAxis(points[0], 'x-axis', 'This point', 'This point is already level with the origin.')
        : onAxis(points[0], 'y-axis', 'This point', 'This point is already above or below the origin.');
      if (datum) return more('Choose the point to align with the origin', [], allPoints);
      if (points.length === 1) return more('Choose the second point, or the origin', [], allPoints, ['origin']);
      return more('Choose a line, two points, or a point and the origin', lines, allPoints, ['origin']);
    }
    case 'parallel': case 'perpendicular': {
      const chosen = entities.filter(isLine);
      if (datum && chosen.length === 1) return alongAxis(chosen[0], datum, tool === 'parallel');
      if (datum) return more('Choose a line', lines, []);
      if (chosen.length === 2) {
        const pair = [chosen[0].id, chosen[1].id] as const;
        const blocker = graph.relations.find(relation => (relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear') && relation.kind !== tool && sameIds(relation, pair)
          || relation.kind === 'line-angle' && samePoints(relation.rays.map(ray => ray.lineId), pair));
        return blocker ? invalid(`These lines already have ${blocker.kind === 'line-angle' ? 'an angle' : `a ${blocker.kind} relation`}. Remove it first.`) : ready({ id: newId(), kind: tool, lineIds: pair });
      }
      return more(chosen.length ? 'Choose the second line, or an axis' : 'Choose a line, or an axis', lines, [], ['x-axis', 'y-axis']);
    }
    case 'tangent': {
      if (entities.length === 2) {
        const [a, b] = entities;
        if (!(isLine(a) && b.kind === 'arc' || a.kind === 'arc' && isLine(b))) return invalid('Choose a line and an arc.');
        const identity = resolveCadSketchPointIdentities(graph);
        const joints = [a.startPointId, a.endPointId].flatMap(first => [b.startPointId, b.endPointId].filter(second => identity(first) === identity(second))
          .map(second => [{ entityId: a.id, pointId: first }, { entityId: b.id, pointId: second }] as const));
        if (joints.length !== 1) return invalid(joints.length ? 'Choose a line and arc with one shared endpoint.' : 'Join these endpoints with Coincident before adding Tangent.');
        const endpoints = joints[0];
        return ready({ id: newId(), kind: 'tangent-joint', endpoints }, () => resolveCadSketchTangentJoint(graph, { endpoints }));
      }
      const first = entities[0];
      const arcs = graph.entities.filter(item => item.kind === 'arc').map(item => item.id);
      return first ? more(isLine(first) ? 'Choose the arc that joins this line' : 'Choose the line that joins this arc', isLine(first) ? arcs : lines, []) : more('Choose a line or an arc', [...lines, ...arcs], []);
    }
    case 'equal': {
      if (entities.length === 2) {
        const [a, b] = entities;
        if (isLine(a) && isLine(b)) return ready({ id: newId(), kind: 'equal-length', lineIds: [a.id, b.id] });
        if (isCurve(a) && isCurve(b)) return ready({ id: newId(), kind: 'equal-radius', curveIds: [a.id, b.id] });
        return invalid('Choose two lines, or two arcs or circles.');
      }
      const first = entities[0];
      return first ? more(isLine(first) ? 'Choose the second line' : 'Choose the second arc or circle', isLine(first) ? lines : curves, []) : more('Choose a line, arc or circle', [...lines, ...curves], []);
    }
    case 'midpoint': {
      const line = entities.find(isLine);
      if (line && points.length === 1) {
        const operands = { pointId: points[0], lineId: line.id };
        return ready({ id: newId(), kind: 'midpoint', ...operands }, () => resolveCadSketchMidpointOperands(graph, operands));
      }
      return line ? more('Choose the point for the middle', [], allPoints) : points.length ? more('Choose the line', lines, []) : more('Choose a point or a line', lines, allPoints);
    }
    case 'concentric': {
      const chosen = entities.filter(isCurve);
      // The origin is a fixed center, so an arc or circle concentric with it keeps its center there.
      if (datum && chosen.length === 1) return onDatum(chosen[0].centerPointId, ['x', 'y'], `The center of this ${chosen[0].kind}`, 'the origin', `This ${chosen[0].kind} is already centered at the origin.`);
      if (datum) return more('Choose an arc or circle to center at the origin', curves, []);
      if (chosen.length === 2) {
        const centers = [chosen[0].centerPointId, chosen[1].centerPointId] as const;
        if (identity(centers[0]) === identity(centers[1])) return invalid('These already share a center.', matching(relation => relation.kind === 'coincident' && samePoints(relation.pointIds, centers)));
        return ready({ id: newId(), kind: 'coincident', pointIds: [chosen[0].centerPointId, chosen[1].centerPointId] });
      }
      return more(chosen.length ? 'Choose the second arc or circle, or the origin' : 'Choose an arc or circle, or the origin', curves, [], ['origin']);
    }
    case 'symmetric': {
      const axisLine = entities.find(isLine);
      const targets = picks.flatMap(pick => {
        if (pick.kind === 'point') return [pick.id];
        const item = entity(pick.id);
        return item?.kind === 'circle' ? [item.centerPointId] : [];
      });
      if (axisLine && targets.length === 2) {
        const operands = { pointIds: [targets[0], targets[1]] as const, lineId: axisLine.id };
        return ready({ id: newId(), kind: 'symmetric', ...operands }, () => resolveCadSketchSymmetryOperands(graph, operands));
      }
      const circles = graph.entities.filter(item => item.kind === 'circle').map(item => item.id);
      const targetPrompt = targets.length ? 'Choose the second point or circle' : 'Choose a point or circle';
      return axisLine ? more(targetPrompt, circles, allPoints) : targets.length === 2 ? more('Choose the line to mirror about', lines, [])
        : more(`${targetPrompt}, or the line to mirror about`, [...lines, ...circles], allPoints);
    }
    case 'fix': {
      if (!points.length) return more('Choose a point to fix', [], allPoints);
      const point = graph.points.find(item => item.id === points[0]);
      if (!point) return invalid('This point is no longer in the sketch.');
      const relations = (['x', 'y'] as const).flatMap((axis, index) => {
        const value = point.position[index];
        return typeof value === 'number' && !exists(relation => relation.kind === 'fixed-axis' && relation.pointId === point.id && relation.axis === axis)
          ? [{ id: newId(), kind: 'fixed-axis' as const, pointId: point.id, axis, value }] : [];
      });
      const held = matching(relation => relation.kind === 'fixed-axis' && relation.pointId === point.id);
      return relations.length ? { status: 'ready', relations } : invalid('This point is already fixed or follows expressions.', held.length === 2 ? held : undefined);
    }
  }
}

/** One row of the selection-first constraint list, as CATIA's Constraint Definition dialog offers it. */
export type CadSketchConstraintChoice =
  | { readonly tool: CadSketchConstraintTool; readonly state: 'available'; readonly relations: readonly CadSketchGraphRelation[] }
  | { readonly tool: CadSketchConstraintTool; readonly state: 'applied'; readonly relationIds: readonly string[] }
  | { readonly tool: CadSketchConstraintTool; readonly state: 'blocked'; readonly reason: string };

/**
 * The constraints that take exactly the selected operands, in any order: the ones that can be added, the ones already
 * applied (with the relations that hold them) and the ones that fit but cannot be added now. Each tool's own steps decide,
 * so this list never offers what the tool-first command would refuse.
 */
export function cadSketchConstraintChoices(graph: CadSketchGraph, picks: readonly CadSketchConstraintPick[], newId: () => string): readonly CadSketchConstraintChoice[] {
  if (!picks.length || picks.length > 3) return [];
  return CAD_SKETCH_CONSTRAINT_TOOLS.flatMap((tool): CadSketchConstraintChoice[] => {
    let blocked: string | null = null;
    for (const order of orders(picks)) {
      const step = completedStep(graph, tool, order, newId);
      if (step?.status === 'ready') return [{ tool, state: 'available', relations: step.relations }];
      if (step?.status === 'invalid' && step.applied) return [{ tool, state: 'applied', relationIds: step.applied }];
      if (step?.status === 'invalid') blocked ??= step.reason;
    }
    return blocked ? [{ tool, state: 'blocked', reason: blocked }] : [];
  });
}

/** The final step when every pick is one the tool asked for in turn, or null when the tool takes different operands. */
function completedStep(graph: CadSketchGraph, tool: CadSketchConstraintTool, picks: readonly CadSketchConstraintPick[], newId: () => string) {
  for (let index = 0; index < picks.length; index++) {
    const step = cadSketchConstraintStep(graph, tool, picks.slice(0, index), newId), pick = picks[index];
    const eligible: readonly string[] = step.status !== 'more' ? [] : pick.kind === 'datum' ? step.datums : pick.kind === 'point' ? step.pointIds : step.entityIds;
    if (!eligible.includes(pick.id)) return null;
  }
  const step = cadSketchConstraintStep(graph, tool, picks, newId);
  return step.status === 'more' ? null : step;
}

function orders<T>(items: readonly T[]): readonly (readonly T[])[] {
  return items.length < 2 ? [items] : items.flatMap((item, index) => orders([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
}

function sameRelation(a: CadSketchGraphRelation, b: CadSketchGraphRelation): boolean {
  if ('pointId' in a && 'pointId' in b && a.pointId !== b.pointId) return false;
  if ('lineId' in a && 'lineId' in b && a.lineId !== b.lineId) return false;
  if ('curveId' in a && 'curveId' in b && a.curveId !== b.curveId) return false;
  if (a.kind === 'tangent-joint' && b.kind === 'tangent-joint') return a.endpoints.every(endpoint => b.endpoints.some(other => other.entityId === endpoint.entityId && other.pointId === endpoint.pointId));
  if ('pointIds' in b) return 'pointIds' in a && samePoints(a.pointIds, b.pointIds);
  if ('lineIds' in b) return 'lineIds' in a && samePoints(a.lineIds, b.lineIds);
  if ('curveIds' in b) return 'curveIds' in a && samePoints(a.curveIds, b.curveIds);
  return 'pointId' in b;
}
