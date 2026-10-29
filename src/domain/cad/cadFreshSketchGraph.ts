import type { CadProfile, CadScalar } from './cadDocument';
import { CadError } from './cadError';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphEntity, type CadSketchGraphPoint, type CadSketchGraphRelation } from './cadSketchGraph';
import { validateCadSketchGeometry } from './cadSketchGeometry';
import { copyCadConstructionPoint, createCadThreePointArc, MAX_CAD_PATH_CONSTRUCTION_EDGES, type CadConstructionPoint } from './cadPathConstruction';
import { evaluateCadScalar } from './cadExpression';

/** The sketch plane's origin and its axes, as references a fresh point can be placed on. */
export type CadFreshSketchDatum = 'origin' | 'x-axis' | 'y-axis';
export type CadFreshSketchPick =
  | { readonly kind: 'position'; readonly point: CadConstructionPoint }
  | { readonly kind: 'coincident'; readonly point: CadConstructionPoint; readonly sourcePointId: string; readonly relationId: string }
  | { readonly kind: 'on-line'; readonly point: CadConstructionPoint; readonly lineId: string; readonly relationId: string }
  /** Keeps the point on the full circle of an arc or circle. */
  | { readonly kind: 'on-curve'; readonly point: CadConstructionPoint; readonly curveId: string; readonly relationId: string }
  /** Fixes the coordinates the reference sets to zero: both at the origin, Y on the X axis and X on the Y axis. */
  | { readonly kind: 'datum'; readonly point: CadConstructionPoint; readonly datum: CadFreshSketchDatum; readonly relationIds: readonly string[] };

/** The coordinates a point on a plane reference keeps at zero. */
export function cadFreshSketchDatumAxes(datum: CadFreshSketchDatum): readonly ('x' | 'y')[] {
  return datum === 'origin' ? ['x', 'y'] : datum === 'x-axis' ? ['y'] : ['x'];
}
/** A horizontal or vertical relation a drawn line keeps between its own two endpoints. */
export interface CadFreshSketchInference { readonly kind: 'horizontal' | 'vertical'; readonly relationId: string }
/**
 * One connected polyline step. An arc's `through` point only shapes it and never attaches to other geometry. A line's
 * `inferred` relation needs its ends exactly level or plumb and never closes the polyline.
 */
export type CadFreshSketchPolylineStep =
  | { readonly kind: 'line'; readonly end: CadFreshSketchPick; readonly inferred?: CadFreshSketchInference }
  | { readonly kind: 'arc'; readonly end: CadFreshSketchPick; readonly through: CadConstructionPoint };
export type CadFreshSketchDrawing =
  | { readonly kind: 'rectangle'; readonly first: CadFreshSketchPick; readonly opposite: CadFreshSketchPick }
  | { readonly kind: 'circle'; readonly center: CadFreshSketchPick; readonly radius: number }
  | { readonly kind: 'line'; readonly start: CadFreshSketchPick; readonly end: CadFreshSketchPick }
  /** A three-point arc from `start` to `end` through `through`, with its own new center point. */
  | { readonly kind: 'arc'; readonly start: CadFreshSketchPick; readonly end: CadFreshSketchPick; readonly through: CadConstructionPoint }
  /**
   * Lines and three-point arcs sharing their joints. A closed polyline whose last end is exactly its start shares the
   * start point; otherwise one more line closes it.
   */
  | { readonly kind: 'polyline'; readonly start: CadFreshSketchPick; readonly steps: readonly CadFreshSketchPolylineStep[]; readonly closed: boolean }
  /** Two equal end arcs about the picked centers, joined by two tangent lines; `width` is the arc diameter. */
  | { readonly kind: 'slot'; readonly first: CadFreshSketchPick; readonly second: CadFreshSketchPick; readonly width: number };
export type CadFreshSketchCreated =
  | { readonly kind: 'rectangle'; readonly geometry: CadSketchGraph; readonly pointIds: { readonly first: string; readonly opposite: string } }
  | { readonly kind: 'circle'; readonly geometry: CadSketchGraph; readonly centerPointId: string }
  | { readonly kind: 'line'; readonly geometry: CadSketchGraph; readonly pointIds: { readonly start: string; readonly end: string } }
  | { readonly kind: 'arc'; readonly geometry: CadSketchGraph; readonly pointIds: { readonly start: string; readonly end: string; readonly center: string } }
  /** The start point, then each step's end; a closing return repeats the start point. */
  | { readonly kind: 'polyline'; readonly geometry: CadSketchGraph; readonly pointIds: readonly string[] }
  | { readonly kind: 'slot'; readonly geometry: CadSketchGraph; readonly centerPointIds: readonly [string, string] };

function numeric(value: CadScalar): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new CadError('invalid-fresh-sketch-scalar', 'Fresh sketch geometry requires finite numeric scalars. Expression sources must remain unchanged.');
  return value;
}

function acceptedGraph(value: CadSketchGraph, parameters: Readonly<Record<string, number>> = {}): CadSketchGraph {
  const graph = parseCadSketchGraph(value), issue = checkCadSketchGraph(graph, parameters)[0];
  if (issue) throw new CadError('invalid-fresh-sketch-geometry', `${issue.source.id}: ${issue.message}`);
  return graph;
}

function allocateCircle(position: CadConstructionPoint, radius: number, construction: boolean, createId: () => string): CadSketchGraph {
  const center = { id: createId(), position };
  return { points: [center], entities: [{ id: createId(), kind: 'circle', construction, centerPointId: center.id, radius }], relations: [] };
}
function allocateClosedLines(positions: readonly CadConstructionPoint[], rectangle: boolean, construction: boolean, createId: () => string): CadSketchGraph {
  const points = positions.map(position => ({ id: createId(), position }));
  const entities = points.map((point, index) => ({ id: createId(), kind: 'line' as const, construction,
    startPointId: point.id, endPointId: points[(index + 1) % points.length].id }));
  const relations: CadSketchGraphRelation[] = rectangle ? entities.map((entity, index) => ({ id: createId(), kind: index % 2 === 0 ? 'horizontal' : 'vertical',
    pointIds: [entity.startPointId, entity.endPointId] })) : [];
  return { points, entities, relations };
}

/**
 * Two lines joined by two end arcs about the picked centers: each joint is tangent and the arcs keep equal radii, which is
 * all the shape needs. Nothing else is added, so the centers, ends and width stay free to dimension.
 */
function allocateSlot(first: CadConstructionPoint, second: CadConstructionPoint, width: number, construction: boolean, createId: () => string): { graph: CadSketchGraph; centerPointIds: readonly [string, string] } {
  const length = Math.hypot(second[0] - first[0], second[1] - first[1]), radius = width / 2;
  if (!(length > 0) || !(radius > 0) || !Number.isFinite(length) || !Number.isFinite(radius))
    throw new CadError('invalid-fresh-sketch-geometry', 'A slot needs two distinct arc centers and a positive width.');
  const ux = (second[0] - first[0]) / length, uy = (second[1] - first[1]) / length;
  const side = (center: CadConstructionPoint, across: number): CadConstructionPoint => [center[0] - across * uy, center[1] + across * ux];
  const point = (position: CadConstructionPoint) => ({ id: createId(), position });
  const [low, high, a, b, c, d] = [first, second, side(first, -radius), side(second, -radius), side(second, radius), side(first, radius)].map(point);
  const entity = <T extends object>(value: T) => ({ id: createId(), construction, ...value });
  const bottom = entity({ kind: 'line' as const, startPointId: a.id, endPointId: b.id });
  const highArc = entity({ kind: 'arc' as const, centerPointId: high.id, startPointId: b.id, endPointId: c.id, direction: 'ccw' as const });
  const top = entity({ kind: 'line' as const, startPointId: c.id, endPointId: d.id });
  const lowArc = entity({ kind: 'arc' as const, centerPointId: low.id, startPointId: d.id, endPointId: a.id, direction: 'ccw' as const });
  const joint = (line: { id: string }, linePointId: string, arc: { id: string }): CadSketchGraphRelation => ({ id: createId(), kind: 'tangent-joint',
    endpoints: [{ entityId: line.id, pointId: linePointId }, { entityId: arc.id, pointId: linePointId }] });
  const relations: CadSketchGraphRelation[] = [joint(bottom, b.id, highArc), joint(top, c.id, highArc), joint(top, d.id, lowArc), joint(bottom, a.id, lowArc),
    { id: createId(), kind: 'equal-radius', curveIds: [lowArc.id, highArc.id] }];
  return { graph: { points: [low, high, a, b, c, d], entities: [bottom, highArc, top, lowArc], relations }, centerPointIds: [low.id, high.id] };
}

const samePosition = (a: CadConstructionPoint, b: CadConstructionPoint) => a[0] === b[0] && a[1] === b[1];
/** Whether two picks attach to the same reference, whatever their relation IDs. */
function sameAttachment(a: CadFreshSketchPick, b: CadFreshSketchPick): boolean {
  switch (a.kind) {
    case 'position': return b.kind === 'position';
    case 'coincident': return b.kind === 'coincident' && a.sourcePointId === b.sourcePointId;
    case 'on-line': return b.kind === 'on-line' && a.lineId === b.lineId;
    case 'on-curve': return b.kind === 'on-curve' && a.curveId === b.curveId;
    case 'datum': return b.kind === 'datum' && a.datum === b.datum;
  }
}

/**
 * Fresh points joined in order. Arcs are solved from their three points before any ID is allocated and always get a new
 * center. Repeated coordinates stay distinct points; only a closing exact return shares the start.
 */
function allocatePolyline(start: CadConstructionPoint, steps: readonly { readonly end: CadConstructionPoint; readonly through?: CadConstructionPoint }[], closed: boolean,
  construction: boolean, createId: () => string): { graph: CadSketchGraph; pointIds: readonly string[] } {
  if (!steps.length) throw new CadError('empty-path', 'Draw at least one segment.');
  const returns = closed && samePosition(steps[steps.length - 1].end, start), closing = closed && !returns;
  if (steps.length + Number(closing) > MAX_CAD_PATH_CONSTRUCTION_EDGES)
    throw new CadError('construction-limit', 'A path can contain at most 2048 edges including its closing edge.');
  let from = start;
  const arcs = steps.map(step => {
    if (samePosition(step.end, from)) throw new CadError('invalid-fresh-sketch-geometry', 'Each chain segment needs two different points.');
    const arc = step.through ? createCadThreePointArc({ start: from, end: step.end, through: step.through }) : null;
    from = step.end; return arc;
  });
  const points: CadSketchGraphPoint[] = [], entities: CadSketchGraphEntity[] = [];
  const point = (position: CadConstructionPoint) => { const value = { id: createId(), position }; points.push(value); return value; };
  const first = point(start), pointIds = [first.id];
  let current = first;
  steps.forEach((step, index) => {
    const end = returns && index === steps.length - 1 ? first : point(step.end), arc = arcs[index];
    if (arc) {
      const center = point(arc.center);
      entities.push({ id: createId(), kind: 'arc', construction, centerPointId: center.id, startPointId: current.id, endPointId: end.id, direction: arc.sweep < 0 ? 'cw' : 'ccw' });
    } else entities.push({ id: createId(), kind: 'line', construction, startPointId: current.id, endPointId: end.id });
    pointIds.push(end.id); current = end;
  });
  if (closing) entities.push({ id: createId(), kind: 'line', construction, startPointId: current.id, endPointId: first.id });
  return { graph: { points, entities, relations: [] }, pointIds };
}

function validateFreshProfile(geometry: CadProfile, construction: boolean): void {
  validateCadSketchGeometry({ id: 'fresh', name: 'Fresh shape', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'shape', name: 'Fresh shape', construction, geometry }] }, {});
}

/**
 * Fresh numeric rectangles without rounding, circles and polygons only. Never promote saved profiles.
 * Caller-owned IDs must be fresh across the sketch; append still checks the complete namespace.
 * Mixed paths need their live authoring joints before angle encoding loses those logical endpoints.
 * Slots/rounded rectangles retain legacy semantics until their tangent/equal-radius relations exist.
 */
export function createCadFreshSketchGraph({ geometry, construction, createId }: {
  readonly geometry: CadProfile;
  readonly construction: boolean;
  readonly createId: () => string;
}): CadSketchGraph {
  if (geometry.kind === 'circle') {
    const x = numeric(geometry.x), y = numeric(geometry.y), radius = numeric(geometry.radius);
    validateFreshProfile({ kind: 'circle', x, y, radius }, construction);
    return acceptedGraph(allocateCircle([x, y], radius, construction, createId));
  }
  let positions: readonly (readonly [number, number])[];
  switch (geometry.kind) {
    case 'rectangle': {
      const x = numeric(geometry.x), y = numeric(geometry.y), width = numeric(geometry.width), height = numeric(geometry.height);
      if (numeric(geometry.cornerRadius) !== 0) throw new CadError('unsupported-fresh-sketch-geometry', 'Rounded rectangles must retain their existing profile representation.');
      validateFreshProfile({ kind: 'rectangle', x, y, width, height, cornerRadius: 0 }, construction);
      positions = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
      break;
    }
    case 'polygon':
      positions = geometry.points.map(([x, y]) => [numeric(x), numeric(y)]);
      validateFreshProfile({ kind: 'polygon', points: positions }, construction);
      break;
    case 'slot': case 'path': case 'plugin':
      throw new CadError('unsupported-fresh-sketch-geometry', 'This fresh shape must retain its existing profile representation.');
    default: { const exhaustive: never = geometry; throw exhaustive; }
  }
  return acceptedGraph(allocateClosedLines(positions, geometry.kind === 'rectangle', construction, createId));
}

/**
 * Fresh authored roles and removable relations; never promotes or rewrites source records. Every shape is ordinary lines,
 * arcs and circles: picks attach their own new points to existing geometry, and nothing reuses an existing point's identity.
 */
export function createCadFreshSketchDrawing({ drawing, construction, createId, existingGraph, parameters = {} }: {
  readonly drawing: CadFreshSketchDrawing;
  readonly construction: boolean;
  readonly createId: () => string;
  readonly existingGraph?: CadSketchGraph;
  readonly parameters?: Readonly<Record<string, number>>;
}): CadFreshSketchCreated {
  const existing = existingGraph ?? { points: [], entities: [], relations: [] }, source = new Map(existing.points.map(point => [point.id, point]));
  function checkedPoint(pick: CadFreshSketchPick): CadConstructionPoint {
    const point = copyCadConstructionPoint(pick.point);
    if (pick.kind === 'coincident') {
      const target = source.get(pick.sourcePointId);
      if (!target || !target.position.every((value, axis) => evaluateCadScalar(value, parameters) === point[axis]))
        throw new CadError('stale-fresh-sketch-point-reference', 'A picked graph point changed or no longer exists. Pick its exact current position again.');
    }
    if (pick.kind === 'on-line' && !existing.entities.some(entity => entity.id === pick.lineId && entity.kind === 'line'))
      throw new CadError('stale-fresh-sketch-point-reference', 'A picked line changed or no longer exists. Pick a position on it again.');
    if (pick.kind === 'on-curve' && !existing.entities.some(entity => entity.id === pick.curveId && (entity.kind === 'arc' || entity.kind === 'circle')))
      throw new CadError('stale-fresh-sketch-point-reference', 'A picked arc or circle changed or no longer exists. Pick a position on it again.');
    if (pick.kind === 'datum' && (pick.relationIds.length !== cadFreshSketchDatumAxes(pick.datum).length
      || cadFreshSketchDatumAxes(pick.datum).some(axis => point[axis === 'x' ? 0 : 1] !== 0)))
      throw new CadError('invalid-fresh-sketch-reference', 'A point placed on the origin or an axis must lie exactly on it.');
    return point;
  }
  /** Inferred relations follow every attachment, so a solver that sets a repeated relation aside names them first. */
  function finish(graph: CadSketchGraph, bindings: readonly { readonly pick: CadFreshSketchPick; readonly pointId: string }[], inferred: readonly CadSketchGraphRelation[] = []): CadSketchGraph {
    const relations: CadSketchGraphRelation[] = [...graph.relations, ...bindings.flatMap(({ pick, pointId }): CadSketchGraphRelation[] => {
      switch (pick.kind) {
        case 'coincident': return [{ id: pick.relationId, kind: 'coincident', pointIds: [pointId, pick.sourcePointId] }];
        case 'on-line': return [{ id: pick.relationId, kind: 'point-on-line', pointId, lineId: pick.lineId }];
        case 'on-curve': return [{ id: pick.relationId, kind: 'point-on-curve', pointId, curveId: pick.curveId }];
        case 'datum': return cadFreshSketchDatumAxes(pick.datum).map((axis, index) => ({ id: pick.relationIds[index], kind: 'fixed-axis', pointId, axis, value: 0 }));
        case 'position': return [];
      }
    }), ...inferred];
    const merged = acceptedGraph({ points: [...existing.points, ...graph.points], entities: [...existing.entities, ...graph.entities], relations: [...existing.relations, ...relations] }, parameters);
    return Object.freeze({ points: Object.freeze(merged.points.slice(existing.points.length)), entities: Object.freeze(merged.entities.slice(existing.entities.length)),
      relations: Object.freeze(merged.relations.slice(existing.relations.length)) });
  }
  switch (drawing.kind) {
    case 'rectangle': {
      const a = checkedPoint(drawing.first), b = checkedPoint(drawing.opposite), x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), highX = Math.max(a[0], b[0]), highY = Math.max(a[1], b[1]);
      validateFreshProfile({ kind: 'rectangle', x, y, width: highX - x, height: highY - y, cornerRadius: 0 }, construction);
      const graph = allocateClosedLines([[x, y], [highX, y], [highX, highY], [x, highY]], true, construction, createId);
      const firstIndex = a[0] < b[0] ? a[1] < b[1] ? 0 : 3 : a[1] < b[1] ? 1 : 2;
      const pointIds = Object.freeze({ first: graph.points[firstIndex].id, opposite: graph.points[(firstIndex + 2) % 4].id });
      return Object.freeze({ kind: 'rectangle', pointIds, geometry: finish(graph, [{ pick: drawing.first, pointId: pointIds.first }, { pick: drawing.opposite, pointId: pointIds.opposite }]) });
    }
    case 'circle': {
      const center = checkedPoint(drawing.center), radius = numeric(drawing.radius);
      validateFreshProfile({ kind: 'circle', x: center[0], y: center[1], radius }, construction);
      const graph = allocateCircle(center, radius, construction, createId), centerPointId = graph.points[0].id;
      return Object.freeze({ kind: 'circle', centerPointId, geometry: finish(graph, [{ pick: drawing.center, pointId: centerPointId }]) });
    }
    case 'line': case 'arc': {
      const start = checkedPoint(drawing.start), end = checkedPoint(drawing.end);
      const through = drawing.kind === 'arc' ? copyCadConstructionPoint(drawing.through) : undefined;
      const { graph, pointIds: [startId, endId] } = allocatePolyline(start, [{ end, ...(through ? { through } : {}) }], false, construction, createId);
      const geometry = finish(graph, [{ pick: drawing.start, pointId: startId }, { pick: drawing.end, pointId: endId }]), arc = geometry.entities[0];
      return arc.kind === 'arc' ? Object.freeze({ kind: 'arc', geometry, pointIds: Object.freeze({ start: startId, end: endId, center: arc.centerPointId }) })
        : Object.freeze({ kind: 'line', geometry, pointIds: Object.freeze({ start: startId, end: endId }) });
    }
    case 'polyline': {
      const start = checkedPoint(drawing.start), steps = drawing.steps.map(step => ({ end: checkedPoint(step.end), ...(step.kind === 'arc' ? { through: copyCadConstructionPoint(step.through) } : {}) }));
      const last = drawing.steps[drawing.steps.length - 1];
      // A closing return is the start point itself, so it can only repeat the start's own attachment.
      const returns = drawing.closed && last !== undefined && samePosition(steps[steps.length - 1].end, start);
      if (returns && last.end.kind !== 'position' && !sameAttachment(last.end, drawing.start))
        throw new CadError('ambiguous-path-closure', 'The last point attaches to different geometry than the start. Click the start itself to close the chain.');
      const inferences = drawing.steps.flatMap((step, index) => {
        if (step.kind !== 'line' || !step.inferred) return [];
        const { kind, relationId } = step.inferred, from = index ? steps[index - 1].end : start, to = steps[index].end;
        if (returns && index === steps.length - 1) throw new CadError('invalid-fresh-sketch-inference', 'A line that closes a chain cannot keep an inferred relation.');
        if (kind === 'horizontal' ? from[1] !== to[1] : kind === 'vertical' ? from[0] !== to[0] : true)
          throw new CadError('invalid-fresh-sketch-inference', 'An inferred horizontal or vertical relation needs a line drawn exactly level or plumb.');
        return [{ index, kind, relationId }];
      });
      const { graph, pointIds } = allocatePolyline(start, steps, drawing.closed, construction, createId);
      const bindings = [{ pick: drawing.start, pointId: pointIds[0] }, ...drawing.steps.flatMap((step, index) => returns && index === steps.length - 1 ? [] : [{ pick: step.end, pointId: pointIds[index + 1] }])];
      return Object.freeze({ kind: 'polyline', pointIds: Object.freeze(pointIds), geometry: finish(graph, bindings,
        inferences.map(({ index, kind, relationId }) => ({ id: relationId, kind, pointIds: [pointIds[index], pointIds[index + 1]] }))) });
    }
    case 'slot': {
      const first = checkedPoint(drawing.first), second = checkedPoint(drawing.second), width = numeric(drawing.width);
      const { graph, centerPointIds } = allocateSlot(first, second, width, construction, createId);
      return Object.freeze({ kind: 'slot', centerPointIds: Object.freeze(centerPointIds), geometry: finish(graph, [{ pick: drawing.first, pointId: centerPointIds[0] }, { pick: drawing.second, pointId: centerPointIds[1] }]) });
    }
    default: { const exhaustive: never = drawing; throw new CadError('unsupported-fresh-sketch-geometry', `Unsupported authored shape: ${String(exhaustive)}`); }
  }
}
