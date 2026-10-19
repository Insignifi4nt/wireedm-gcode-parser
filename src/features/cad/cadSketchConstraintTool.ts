import { userFacingMessage } from '@/lib/userMessage';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { resolveCadSketchPointIdentities } from '@/domain/cad/cadSketchGraphJoints';
import { resolveCadSketchMidpointOperands } from '@/domain/cad/cadSketchMidpointRelations';
import { resolveCadSketchPointOnLineOperands } from '@/domain/cad/cadSketchPointOnLineRelations';
import { resolveCadSketchSymmetryOperands } from '@/domain/cad/cadSketchSymmetryRelations';
import { resolveCadSketchTangentJoint } from '@/domain/cad/cadSketchTangentRelations';
import type { CadSketchDatum, CadSketchGraphSelection } from './cadSketchGraphSelection';

/** Positional constraints offered as tools: each one says what to pick next and adds its relation once the picks are complete. */
export const CAD_SKETCH_CONSTRAINT_TOOLS = ['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'tangent', 'equal', 'midpoint', 'concentric', 'symmetric', 'fix'] as const;
export type CadSketchConstraintTool = typeof CAD_SKETCH_CONSTRAINT_TOOLS[number];
export const cadSketchConstraintToolLabels: Readonly<Record<CadSketchConstraintTool, string>> = {
  coincident: 'Coincident', horizontal: 'Horizontal', vertical: 'Vertical', parallel: 'Parallel', perpendicular: 'Perpendicular', tangent: 'Tangent',
  equal: 'Equal', midpoint: 'Midpoint', concentric: 'Concentric', symmetric: 'Symmetric', fix: 'Fix'
};
export const cadSketchConstraintToolHelp: Readonly<Record<CadSketchConstraintTool, string>> = {
  coincident: 'Two points share one position. A point and a line, or an axis, keep the point on it; a point and the origin pin it there.',
  horizontal: 'A line, or two points, stay level. A point and the origin stay level with it.', vertical: 'A line, or two points, stay upright. A point and the origin stay above or below it.',
  parallel: 'Two lines, or a line and an axis, keep the same direction.', perpendicular: 'Two lines, or a line and an axis, meet at a right angle.',
  tangent: 'A line and an arc that share an endpoint join smoothly.', equal: 'Two lines keep the same length, or two arcs or circles the same radius.',
  midpoint: 'A point stays at the middle of a line.', concentric: 'Two arcs or circles share one center.',
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
  const axisRelation = (kind: 'horizontal' | 'vertical', pair: readonly [string, string]) => {
    const other = kind === 'horizontal' ? 'vertical' : 'horizontal';
    return exists(relation => relation.kind === other && samePoints(relation.pointIds, pair)) ? invalid(`This is already ${other}.`) : ready({ id: newId(), kind, pointIds: pair });
  };
  // A point placed on a plane reference fixes the coordinates that reference sets to zero.
  const onDatum = (pointId: string, axes: readonly ('x' | 'y')[], label: string): CadSketchConstraintStep => {
    if (graph.relations.some(relation => relation.kind === 'fixed-point' && relation.pointId === pointId)) return invalid('This point is already fixed. Remove that relation first.');
    const fixed = graph.relations.filter((relation): relation is Extract<CadSketchGraphRelation, { kind: 'fixed-axis' }> => relation.kind === 'fixed-axis' && relation.pointId === pointId);
    const conflict = fixed.find(relation => axes.includes(relation.axis) && relation.value !== 0);
    if (conflict) return invalid(`This point already has a fixed ${conflict.axis.toUpperCase()}. Remove that dimension first.`);
    const relations = axes.filter(axis => !fixed.some(relation => relation.axis === axis)).map(axis => ({ id: newId(), kind: 'fixed-axis' as const, pointId, axis, value: 0 }));
    return relations.length ? { status: 'ready', relations } : invalid(`This point is already ${label}.`, fixed.filter(relation => axes.includes(relation.axis)).map(relation => relation.id));
  };
  // A line follows an axis through horizontal or vertical, the same relations a level or upright line takes.
  const alongAxis = (line: Extract<Entity, { kind: 'line' }>, reference: CadSketchDatum, parallel: boolean) => {
    if (reference === 'origin') return invalid('Choose an axis, not the origin.');
    const kind = (reference === 'x-axis') === parallel ? 'horizontal' : 'vertical', pair = [line.startPointId, line.endPointId] as const;
    const existing = matching(relation => relation.kind === kind && samePoints(relation.pointIds, pair));
    return existing.length ? invalid(`This line is already ${kind}.`, existing) : axisRelation(kind, pair);
  };
  switch (tool) {
    case 'coincident': {
      if (datum && points.length === 1) return datum === 'origin' ? onDatum(points[0], ['x', 'y'], 'at the origin')
        : onDatum(points[0], [datum === 'x-axis' ? 'y' : 'x'], `on the ${datum === 'x-axis' ? 'X' : 'Y'} axis`);
      if (datum) return more(datum === 'origin' ? 'Choose a point to place at the origin' : 'Choose a point to keep on this axis', [], allPoints);
      if (points.length === 2) {
        const identity = resolveCadSketchPointIdentities(graph);
        return identity(points[0]) === identity(points[1]) ? invalid('These points are already joined.', matching(relation => relation.kind === 'coincident' && samePoints(relation.pointIds, [points[0], points[1]])))
          : ready({ id: newId(), kind: 'coincident', pointIds: [points[0], points[1]] });
      }
      const line = entities.find(isLine);
      if (points.length === 1 && line) {
        const operands = { pointId: points[0], lineId: line.id };
        return ready({ id: newId(), kind: 'point-on-line', ...operands }, () => resolveCadSketchPointOnLineOperands(graph, operands));
      }
      if (points.length === 1) return more('Choose a second point, a line or an axis to keep the point on, or the origin', lines, allPoints, ['origin', 'x-axis', 'y-axis']);
      if (line) return more('Choose a point to keep on this line', [], allPoints);
      return more('Choose a point, or the origin or an axis', lines, allPoints, ['origin', 'x-axis', 'y-axis']);
    }
    case 'horizontal': case 'vertical': {
      const line = entities.find(isLine);
      if (line) return axisRelation(tool, [line.startPointId, line.endPointId]);
      if (points.length === 2) return axisRelation(tool, [points[0], points[1]]);
      if (datum && points.length === 1) return tool === 'horizontal' ? onDatum(points[0], ['y'], 'level with the origin') : onDatum(points[0], ['x'], 'above or below the origin');
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
      if (chosen.length === 2) {
        const identity = resolveCadSketchPointIdentities(graph);
        const centers = [chosen[0].centerPointId, chosen[1].centerPointId] as const;
        if (identity(centers[0]) === identity(centers[1])) return invalid('These already share a center.', matching(relation => relation.kind === 'coincident' && samePoints(relation.pointIds, centers)));
        return ready({ id: newId(), kind: 'coincident', pointIds: [chosen[0].centerPointId, chosen[1].centerPointId] });
      }
      return more(chosen.length ? 'Choose the second arc or circle' : 'Choose an arc or circle', curves, []);
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
  if (a.kind === 'tangent-joint' && b.kind === 'tangent-joint') return a.endpoints.every(endpoint => b.endpoints.some(other => other.entityId === endpoint.entityId && other.pointId === endpoint.pointId));
  if ('pointIds' in b) return 'pointIds' in a && samePoints(a.pointIds, b.pointIds);
  if ('lineIds' in b) return 'lineIds' in a && samePoints(a.lineIds, b.lineIds);
  if ('curveIds' in b) return 'curveIds' in a && samePoints(a.curveIds, b.curveIds);
  return 'pointId' in b;
}
