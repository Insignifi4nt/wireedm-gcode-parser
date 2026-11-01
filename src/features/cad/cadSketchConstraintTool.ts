import { readableMessage } from '@/lib/userMessage';
import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchPickOrders, cadSketchRelationPlanner } from '@/domain/cad/sketch-relations/cadSketchRelationPlanning';
import type { CadSketchEdge, CadSketchRelationPlan } from '@/domain/cad/sketch-relations/cadSketchRelationTypes';
import { CAD_SKETCH_H_AXIS_ID, CAD_SKETCH_ORIGIN_ID, CAD_SKETCH_V_AXIS_ID, isCadSketchVirtualId } from '@/domain/cad/sketch-relations/cadSketchVirtualElements';
import type { CadSketchGraphSelection } from './cadSketchGraphSelection';

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
  tangent: 'A line and an arc that share an endpoint join smoothly. An arc or circle and an axis touch.', equal: 'Two lines keep the same length, or two arcs or circles the same radius.',
  midpoint: 'A point, or the origin, stays at the middle of a line.', concentric: 'Two arcs or circles share one center, or an arc or circle is centered at the origin.',
  symmetric: 'Two points or circle centers mirror each other about a line or an axis.', fix: 'A point keeps its current position.'
};

/** A constraint operand: sketch geometry, the origin as a point or an axis as an edge. */
export type CadSketchConstraintPick = CadSketchGraphSelection;

export type CadSketchConstraintStep =
  | { readonly status: 'more'; readonly prompt: string; readonly entityIds: readonly string[]; readonly pointIds: readonly string[] }
  | { readonly status: 'ready'; readonly relations: readonly CadSketchGraphRelation[] }
  /** `applied` names the existing relations when the constraint is already in place, so a caller can offer to remove them. */
  | { readonly status: 'invalid'; readonly reason: string; readonly applied?: readonly string[] };

type Line = Extract<CadSketchEdge, { kind: 'line' }>;
type Round = Extract<CadSketchEdge, { kind: 'arc' | 'circle' }>;
type Axis = Extract<CadSketchEdge, { kind: 'axis' }>;
const isLine = (entity: CadSketchEdge | undefined): entity is Line => entity?.kind === 'line';
const isCurve = (entity: CadSketchEdge | undefined): entity is Round => entity?.kind === 'arc' || entity?.kind === 'circle';
const isAxis = (entity: CadSketchEdge | undefined): entity is Axis => entity?.kind === 'axis';
const ORIGIN: readonly string[] = [CAD_SKETCH_ORIGIN_ID], AXES: readonly string[] = [CAD_SKETCH_H_AXIS_ID, CAD_SKETCH_V_AXIS_ID];

/**
 * The next step of a tool-first positional constraint. `picks` are in click order and already passed the previous step's eligible ids.
 * A ready step carries new relations; an existing identical relation is reported instead of duplicated. The origin is a point and the
 * axes are edges that every sketch has, picked as other geometry is; they are fixed, so once one is picked the others are not offered.
 */
export function cadSketchConstraintStep(graph: CadSketchGraph, tool: CadSketchConstraintTool, picks: readonly CadSketchConstraintPick[], newId: () => string): CadSketchConstraintStep {
  // The final steps are planned with the relation offers, so both give one answer; the step names the tool and gives the relations ids.
  const planning = cadSketchRelationPlanner(graph), { entity } = planning;
  const points = picks.filter(pick => pick.kind === 'point').map(pick => pick.id);
  const entities = picks.filter(pick => pick.kind === 'entity').map(pick => entity(pick.id)).filter((item): item is CadSketchEdge => Boolean(item));
  const fixedPicked = picks.some(pick => isCadSketchVirtualId(pick.id)), origin = fixedPicked ? [] : ORIGIN, axes = fixedPicked ? [] : AXES;
  const allPoints = graph.points.map(point => point.id), lines = graph.entities.filter(isLine).map(line => line.id), curves = graph.entities.filter(isCurve).map(curve => curve.id);
  const more = (prompt: string, entityIds: readonly string[], pointIds: readonly string[]): CadSketchConstraintStep => ({ status: 'more', prompt,
    entityIds: entityIds.filter(id => !picks.some(pick => pick.kind === 'entity' && pick.id === id)), pointIds: pointIds.filter(id => !points.includes(id)) });
  const invalid = (reason: string, applied?: readonly string[]): CadSketchConstraintStep => applied?.length ? { status: 'invalid', reason, applied } : { status: 'invalid', reason };
  const planned = (plan: CadSketchRelationPlan): CadSketchConstraintStep => plan.state === 'available'
    ? { status: 'ready', relations: plan.relations.map(relation => ({ id: newId(), ...relation }) as CadSketchGraphRelation) }
    : plan.state === 'applied' ? invalid(plan.reason ?? `${cadSketchConstraintToolLabels[tool]} is already applied here.`, plan.relationIds) : invalid(readableMessage(plan.reason));
  switch (tool) {
    case 'coincident': {
      const line = entities.find(isLine), curve = entities.find(isCurve), axis = entities.find(isAxis), guide = line ?? axis;
      if (points.length === 2) return planned(planning.coincide([points[0], points[1]]));
      // A point on an axis keeps the coordinate across it at 0, as a point at the origin keeps both.
      if (points.length === 1 && guide) return planned(planning.place({ kind: 'point-on-line', pointId: points[0], lineId: guide.id }));
      // A point on an arc or circle stays on its full circle.
      if (points.length === 1 && curve) return planned(planning.place({ kind: 'point-on-curve', pointId: points[0], curveId: curve.id }));
      // A line on an axis keeps both its ends there; an arc or circle on an axis keeps its center there, as its curve cannot lie along it.
      if (axis && line) return planned(planning.orient('collinear', [line.id, axis.id]));
      if (axis && curve) return planned(planning.centre(curve, axis.id));
      if (points[0] === CAD_SKETCH_ORIGIN_ID) return more('Choose a point to place at the origin, or a line, arc or circle to pass through it', [...lines, ...curves], allPoints);
      if (points.length === 1) return more('Choose a second point, a line, arc, circle or axis to keep the point on, or the origin', [...lines, ...curves, ...axes], [...allPoints, ...origin]);
      if (axis) return more('Choose a point, line, arc or circle to keep on this axis', [...lines, ...curves], allPoints);
      if (line) return more('Choose a point to keep on this line, or an axis to lay it on', axes, [...allPoints, ...origin]);
      if (curve) return more(`Choose a point to keep on this ${curve.kind}, or an axis to center it on`, axes, [...allPoints, ...origin]);
      return more('Choose a point, line, arc or circle, or the origin or an axis', [...lines, ...curves, ...axes], [...allPoints, ...origin]);
    }
    case 'horizontal': case 'vertical': {
      const line = entities.find(isLine);
      if (line) return planned(planning.align(tool, [line.startPointId, line.endPointId]));
      if (points.length === 2) return planned(planning.align(tool, [points[0], points[1]]));
      if (points[0] === CAD_SKETCH_ORIGIN_ID) return more('Choose the point to align with the origin', [], allPoints);
      if (points.length === 1) return more('Choose the second point, or the origin', [], [...allPoints, ...origin]);
      return more('Choose a line, two points, or a point and the origin', lines, [...allPoints, ...origin]);
    }
    case 'parallel': case 'perpendicular': {
      // An axis is a line here: a line parallel to the H axis is horizontal, and one square to it vertical.
      const chosen = entities.filter(item => isLine(item) || isAxis(item));
      if (chosen.length === 2) return planned(planning.orient(tool, [chosen[0].id, chosen[1].id]));
      return isAxis(chosen[0]) ? more('Choose a line', lines, []) : more(chosen.length ? 'Choose the second line, or an axis' : 'Choose a line, or an axis', [...lines, ...axes], []);
    }
    case 'tangent': {
      if (entities.length === 2) return planned(planning.tangent(entities[0], entities[1]));
      const first = entities[0], arcs = graph.entities.filter(item => item.kind === 'arc').map(item => item.id);
      // An arc or circle touches an axis on either side of it.
      if (isAxis(first)) return more('Choose an arc or circle that touches this axis', curves, []);
      if (first?.kind === 'circle') return more('Choose an axis this circle touches', axes, []);
      if (first) return isLine(first) ? more('Choose the arc that joins this line', arcs, []) : more('Choose the line that joins this arc, or an axis it touches', [...lines, ...axes], []);
      return more('Choose a line, an arc or circle, or an axis', [...lines, ...curves, ...axes], []);
    }
    case 'equal': {
      if (entities.length === 2) return planned(planning.equal(entities[0], entities[1]));
      const first = entities[0];
      return first ? more(isLine(first) ? 'Choose the second line' : 'Choose the second arc or circle', isLine(first) ? lines : curves, []) : more('Choose a line, arc or circle', [...lines, ...curves], []);
    }
    case 'midpoint': {
      const line = entities.find(isLine);
      if (line && points.length === 1) return planned(planning.place({ kind: 'midpoint', pointId: points[0], lineId: line.id }));
      // The origin may be the middle of a line, as any point may.
      return line ? more('Choose the point for the middle', [], [...allPoints, ...ORIGIN]) : points.length ? more('Choose the line', lines, [])
        : more('Choose a point or a line', lines, [...allPoints, ...ORIGIN]);
    }
    case 'concentric': {
      const chosen = entities.filter(isCurve);
      // The origin is a fixed center, so an arc or circle concentric with it keeps its center there.
      if (chosen.length === 1 && points[0] === CAD_SKETCH_ORIGIN_ID) return planned(planning.centre(chosen[0], CAD_SKETCH_ORIGIN_ID));
      if (chosen.length === 2) return planned(planning.concentric(chosen[0], chosen[1]));
      if (points.length) return more('Choose an arc or circle to center at the origin', curves, []);
      return more(chosen.length ? 'Choose the second arc or circle, or the origin' : 'Choose an arc or circle, or the origin', curves, ORIGIN);
    }
    case 'symmetric': {
      // A circle stands for its center; the points mirror about a line or an axis.
      const mirror = entities.find(item => isLine(item) || isAxis(item)) as Line | Axis | undefined;
      const targets = picks.filter(pick => pick.kind === 'point' || pick.kind === 'entity' && entity(pick.id)?.kind === 'circle');
      if (mirror && targets.length === 2) return planned(planning.mirror([targets[0], targets[1]], mirror));
      const circles = graph.entities.filter(item => item.kind === 'circle').map(item => item.id);
      const targetPrompt = targets.length ? 'Choose the second point or circle' : 'Choose a point or circle';
      // The origin mirrors as a point does: about a line, or about an axis to hold its pair at the origin.
      return mirror ? more(targetPrompt, circles, [...allPoints, ...ORIGIN]) : targets.length === 2 ? more('Choose the line or axis to mirror about', [...lines, ...AXES], [])
        : more(`${targetPrompt}, or the line or axis to mirror about`, [...lines, ...AXES, ...circles], [...allPoints, ...ORIGIN]);
    }
    case 'fix': return points.length ? planned(planning.fix(points[0])) : more('Choose a point to fix', [], allPoints);
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
 * so this list never offers what the tool-first command would refuse. A tool that does not offer the origin or an axis the
 * selection names is listed as blocked when its planning says why, such as Equal with an axis, which has no length. A selection
 * of only the origin and the axes relates nothing that can move, so it is offered nothing.
 */
export function cadSketchConstraintChoices(graph: CadSketchGraph, picks: readonly CadSketchConstraintPick[], newId: () => string): readonly CadSketchConstraintChoice[] {
  if (!picks.length || picks.length > 3 || picks.every(pick => isCadSketchVirtualId(pick.id))) return [];
  return CAD_SKETCH_CONSTRAINT_TOOLS.flatMap((tool): CadSketchConstraintChoice[] => {
    let blocked: string | null = null;
    for (const order of cadSketchPickOrders(picks)) {
      const step = completedStep(graph, tool, order, newId);
      if (step?.status === 'ready') return [{ tool, state: 'available', relations: step.relations }];
      if (step?.status === 'invalid' && step.applied) return [{ tool, state: 'applied', relationIds: step.applied }];
      if (step?.status === 'invalid') blocked ??= step.reason;
    }
    return blocked ? [{ tool, state: 'blocked', reason: blocked }] : [];
  });
}

/**
 * The final step when every pick is one the tool asked for in turn, or null when the tool takes different operands. The origin or an
 * axis the tool did not offer is still let through as the last pick, where the tool reads every pick, but only to say why it refuses it.
 */
function completedStep(graph: CadSketchGraph, tool: CadSketchConstraintTool, picks: readonly CadSketchConstraintPick[], newId: () => string) {
  let unoffered = false;
  for (let index = 0; index < picks.length; index++) {
    const step = cadSketchConstraintStep(graph, tool, picks.slice(0, index), newId), pick = picks[index];
    if (step.status !== 'more') return null;
    if ((pick.kind === 'point' ? step.pointIds : step.entityIds).includes(pick.id)) continue;
    if (index < picks.length - 1 || !isCadSketchVirtualId(pick.id)) return null;
    unoffered = true;
  }
  const step = cadSketchConstraintStep(graph, tool, picks, newId);
  return step.status === 'more' || unoffered && (step.status !== 'invalid' || step.applied) ? null : step;
}
