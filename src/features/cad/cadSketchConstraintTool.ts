import { readableMessage } from '@/lib/userMessage';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchPickOrders, cadSketchRelationPlanner, type CadSketchCoordinateHold } from '@/domain/cad/sketch-relations/cadSketchRelationPlanning';
import type { CadSketchRelationPlan } from '@/domain/cad/sketch-relations/cadSketchRelationTypes';
import type { CadSketchDatum, CadSketchGraphSelection } from './cadSketchGraphSelection';

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
type Hold = CadSketchCoordinateHold;
const isLine = (entity: Entity | undefined): entity is Extract<Entity, { kind: 'line' }> => entity?.kind === 'line';
const isCurve = (entity: Entity | undefined): entity is Extract<Entity, { kind: 'arc' | 'circle' }> => entity?.kind === 'arc' || entity?.kind === 'circle';

/**
 * The next step of a tool-first positional constraint. `picks` are in click order and already passed the previous step's eligible ids.
 * A ready step carries new relations; an existing identical relation is reported instead of duplicated.
 */
export function cadSketchConstraintStep(graph: CadSketchGraph, tool: CadSketchConstraintTool, picks: readonly CadSketchConstraintPick[], newId: () => string): CadSketchConstraintStep {
  // The final steps are planned with the relation offers, so both give one answer; the step names the tool and gives the relations ids.
  const planning = cadSketchRelationPlanner(graph), { entity, sameJoints, traced, holding, holdingTraced } = planning;
  const points = picks.filter(pick => pick.kind === 'point').map(pick => pick.id);
  const entities = picks.filter(pick => pick.kind === 'entity').map(pick => entity(pick.id)).filter((item): item is Entity => Boolean(item));
  const allPoints = graph.points.map(point => point.id), lines = graph.entities.filter(isLine).map(line => line.id), curves = graph.entities.filter(isCurve).map(curve => curve.id);
  const datum = picks.find(pick => pick.kind === 'datum')?.id;
  const more = (prompt: string, entityIds: readonly string[], pointIds: readonly string[], datums: readonly CadSketchDatum[] = []): CadSketchConstraintStep => ({ status: 'more', prompt,
    entityIds: entityIds.filter(id => !picks.some(pick => pick.kind === 'entity' && pick.id === id)), pointIds: pointIds.filter(id => !points.includes(id)), datums: datum ? [] : datums });
  const invalid = (reason: string, applied?: readonly string[]): CadSketchConstraintStep => applied?.length ? { status: 'invalid', reason, applied } : { status: 'invalid', reason };
  const exists = (match: (relation: CadSketchGraphRelation) => boolean) => graph.relations.some(match);
  const matching = (match: (relation: CadSketchGraphRelation) => boolean) => graph.relations.filter(match).map(relation => relation.id);
  const planned = (plan: CadSketchRelationPlan): CadSketchConstraintStep => plan.state === 'available'
    ? { status: 'ready', relations: plan.relations.map(relation => ({ id: newId(), ...relation }) as CadSketchGraphRelation) }
    : plan.state === 'applied' ? invalid(plan.reason ?? `${cadSketchConstraintToolLabels[tool]} is already applied here.`, plan.relationIds) : invalid(readableMessage(plan.reason));
  const zeroAxis = (pointId: string, axis: 'x' | 'y') => ({ id: newId(), kind: 'fixed-axis' as const, pointId, axis, value: 0 });
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
    return existing.length ? invalid(`This line is already ${kind}.`, existing) : planned(planning.align(kind, pair));
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
      if (points.length === 2) return planned(planning.coincide([points[0], points[1]]));
      if (points.length === 1 && line) return planned(planning.place({ kind: 'point-on-line', pointId: points[0], lineId: line.id }));
      // A point on an arc or circle stays on its full circle.
      if (points.length === 1 && curve) return planned(planning.place({ kind: 'point-on-curve', pointId: points[0], curveId: curve.id }));
      if (points.length === 1) return more('Choose a second point, a line, arc, circle or axis to keep the point on, or the origin', [...lines, ...curves], allPoints, ['origin', 'x-axis', 'y-axis']);
      if (line) return more('Choose a point to keep on this line, or an axis to lay it on', [], allPoints, ['x-axis', 'y-axis']);
      if (curve) return more(`Choose a point to keep on this ${curve.kind}, or an axis to center it on`, [], allPoints, ['x-axis', 'y-axis']);
      return more('Choose a point, line, arc or circle, or the origin or an axis', [...lines, ...curves], allPoints, ['origin', 'x-axis', 'y-axis']);
    }
    case 'horizontal': case 'vertical': {
      const line = entities.find(isLine);
      if (line) return planned(planning.align(tool, [line.startPointId, line.endPointId]));
      if (points.length === 2) return planned(planning.align(tool, [points[0], points[1]]));
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
      if (chosen.length === 2) return planned(planning.orient(tool, [chosen[0].id, chosen[1].id]));
      return more(chosen.length ? 'Choose the second line, or an axis' : 'Choose a line, or an axis', lines, [], ['x-axis', 'y-axis']);
    }
    case 'tangent': {
      if (entities.length === 2) return planned(planning.tangent(entities[0], entities[1]));
      const first = entities[0];
      const arcs = graph.entities.filter(item => item.kind === 'arc').map(item => item.id);
      return first ? more(isLine(first) ? 'Choose the arc that joins this line' : 'Choose the line that joins this arc', isLine(first) ? arcs : lines, []) : more('Choose a line or an arc', [...lines, ...arcs], []);
    }
    case 'equal': {
      if (entities.length === 2) return planned(planning.equal(entities[0], entities[1]));
      const first = entities[0];
      return first ? more(isLine(first) ? 'Choose the second line' : 'Choose the second arc or circle', isLine(first) ? lines : curves, []) : more('Choose a line, arc or circle', [...lines, ...curves], []);
    }
    case 'midpoint': {
      const line = entities.find(isLine);
      if (line && points.length === 1) return planned(planning.place({ kind: 'midpoint', pointId: points[0], lineId: line.id }));
      return line ? more('Choose the point for the middle', [], allPoints) : points.length ? more('Choose the line', lines, []) : more('Choose a point or a line', lines, allPoints);
    }
    case 'concentric': {
      const chosen = entities.filter(isCurve);
      // The origin is a fixed center, so an arc or circle concentric with it keeps its center there.
      if (datum && chosen.length === 1) return onDatum(chosen[0].centerPointId, ['x', 'y'], `The center of this ${chosen[0].kind}`, 'the origin', `This ${chosen[0].kind} is already centered at the origin.`);
      if (datum) return more('Choose an arc or circle to center at the origin', curves, []);
      if (chosen.length === 2) return planned(planning.concentric(chosen[0], chosen[1]));
      return more(chosen.length ? 'Choose the second arc or circle, or the origin' : 'Choose an arc or circle, or the origin', curves, [], ['origin']);
    }
    case 'symmetric': {
      const axisLine = entities.find(isLine);
      // A circle stands for its center.
      const targets = picks.filter((pick): pick is CadSketchGraphSelection => pick.kind === 'point' || pick.kind === 'entity' && entity(pick.id)?.kind === 'circle');
      if (axisLine && targets.length === 2) return planned(planning.mirror([targets[0], targets[1]], axisLine));
      const circles = graph.entities.filter(item => item.kind === 'circle').map(item => item.id);
      const targetPrompt = targets.length ? 'Choose the second point or circle' : 'Choose a point or circle';
      return axisLine ? more(targetPrompt, circles, allPoints) : targets.length === 2 ? more('Choose the line to mirror about', lines, [])
        : more(`${targetPrompt}, or the line to mirror about`, [...lines, ...circles], allPoints);
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
 * so this list never offers what the tool-first command would refuse.
 */
export function cadSketchConstraintChoices(graph: CadSketchGraph, picks: readonly CadSketchConstraintPick[], newId: () => string): readonly CadSketchConstraintChoice[] {
  if (!picks.length || picks.length > 3) return [];
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
