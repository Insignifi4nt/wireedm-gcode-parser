import type { CadProfile, CadScalar } from './cadDocument';
import { CadError } from './cadError';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from './cadSketchGraph';
import { validateCadSketchGeometry } from './cadSketchGeometry';
import { copyCadConstructionPoint, type CadConstructionPoint } from './cadPathConstruction';
import { evaluateCadScalar } from './cadExpression';

/** The sketch plane's origin and its axes, as references a fresh point can be placed on. */
export type CadFreshSketchDatum = 'origin' | 'x-axis' | 'y-axis';
export type CadFreshSketchPick =
  | { readonly kind: 'position'; readonly point: CadConstructionPoint }
  | { readonly kind: 'coincident'; readonly point: CadConstructionPoint; readonly sourcePointId: string; readonly relationId: string }
  | { readonly kind: 'on-line'; readonly point: CadConstructionPoint; readonly lineId: string; readonly relationId: string }
  /** Fixes the coordinates the reference sets to zero: both at the origin, Y on the X axis and X on the Y axis. */
  | { readonly kind: 'datum'; readonly point: CadConstructionPoint; readonly datum: CadFreshSketchDatum; readonly relationIds: readonly string[] };

/** The coordinates a point on a plane reference keeps at zero. */
export function cadFreshSketchDatumAxes(datum: CadFreshSketchDatum): readonly ('x' | 'y')[] {
  return datum === 'origin' ? ['x', 'y'] : datum === 'x-axis' ? ['y'] : ['x'];
}
export type CadFreshSketchDrawing =
  | { readonly kind: 'rectangle'; readonly first: CadFreshSketchPick; readonly opposite: CadFreshSketchPick }
  | { readonly kind: 'circle'; readonly center: CadFreshSketchPick; readonly radius: number }
  | { readonly kind: 'polygon'; readonly vertices: readonly CadFreshSketchPick[] }
  /** A slot from its center to one rounded end; `width` is the end-arc diameter. */
  | { readonly kind: 'slot'; readonly center: CadFreshSketchPick; readonly end: CadConstructionPoint; readonly width: number };
export type CadFreshSketchCreated =
  | { readonly kind: 'rectangle'; readonly geometry: CadSketchGraph; readonly pointIds: { readonly first: string; readonly opposite: string } }
  | { readonly kind: 'circle'; readonly geometry: CadSketchGraph; readonly centerPointId: string }
  | { readonly kind: 'polygon'; readonly geometry: CadSketchGraph; readonly vertexPointIds: readonly string[] }
  | { readonly kind: 'slot'; readonly geometry: CadSketchGraph; readonly centerPointId: string };

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
 * Two parallel lines joined by two tangent end arcs of equal radius. A construction axis joins the arc centers and the
 * slot center is held at its middle, so the center, the axis and the ends stay selectable and constrainable.
 */
function allocateSlot(center: CadConstructionPoint, end: CadConstructionPoint, width: number, construction: boolean, createId: () => string): { graph: CadSketchGraph; centerPointId: string } {
  const halfLength = Math.hypot(end[0] - center[0], end[1] - center[1]), radius = width / 2, half = halfLength - radius;
  if (!(radius > 0) || !(half > 0)) throw new CadError('invalid-fresh-sketch-geometry', 'A slot needs its end beyond half of its width from the center.');
  const ux = (end[0] - center[0]) / halfLength, uy = (end[1] - center[1]) / halfLength;
  const at = (along: number, across: number): CadConstructionPoint => [center[0] + along * ux - across * uy, center[1] + along * uy + across * ux];
  const point = (position: CadConstructionPoint) => ({ id: createId(), position });
  const [low, high, a, b, c, d, middle] = [at(-half, 0), at(half, 0), at(-half, -radius), at(half, -radius), at(half, radius), at(-half, radius), center].map(point);
  const entity = <T extends object>(value: T) => ({ id: createId(), construction, ...value });
  const bottom = entity({ kind: 'line' as const, startPointId: a.id, endPointId: b.id });
  const highArc = entity({ kind: 'arc' as const, centerPointId: high.id, startPointId: b.id, endPointId: c.id, direction: 'ccw' as const });
  const top = entity({ kind: 'line' as const, startPointId: c.id, endPointId: d.id });
  const lowArc = entity({ kind: 'arc' as const, centerPointId: low.id, startPointId: d.id, endPointId: a.id, direction: 'ccw' as const });
  const axis = { id: createId(), kind: 'line' as const, construction: true, startPointId: low.id, endPointId: high.id };
  const joint = (line: { id: string }, linePointId: string, arc: { id: string }): CadSketchGraphRelation => ({ id: createId(), kind: 'tangent-joint',
    endpoints: [{ entityId: line.id, pointId: linePointId }, { entityId: arc.id, pointId: linePointId }] });
  const relations: CadSketchGraphRelation[] = [joint(bottom, b.id, highArc), joint(top, c.id, highArc), joint(top, d.id, lowArc), joint(bottom, a.id, lowArc),
    { id: createId(), kind: 'equal-radius', curveIds: [lowArc.id, highArc.id] }, { id: createId(), kind: 'midpoint', pointId: middle.id, lineId: axis.id }];
  return { graph: { points: [low, high, a, b, c, d, middle], entities: [bottom, highArc, top, lowArc, axis], relations }, centerPointId: middle.id };
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

/** Fresh authored roles and removable coincidence; never promotes or rewrites source records. */
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
    if (pick.kind === 'datum' && (pick.relationIds.length !== cadFreshSketchDatumAxes(pick.datum).length
      || cadFreshSketchDatumAxes(pick.datum).some(axis => point[axis === 'x' ? 0 : 1] !== 0)))
      throw new CadError('invalid-fresh-sketch-reference', 'A point placed on the origin or an axis must lie exactly on it.');
    return point;
  }
  function finish(graph: CadSketchGraph, bindings: readonly { readonly pick: CadFreshSketchPick; readonly pointId: string }[]): CadSketchGraph {
    const relations: CadSketchGraphRelation[] = [...graph.relations, ...bindings.flatMap(({ pick, pointId }): CadSketchGraphRelation[] => {
      switch (pick.kind) {
        case 'coincident': return [{ id: pick.relationId, kind: 'coincident', pointIds: [pointId, pick.sourcePointId] }];
        case 'on-line': return [{ id: pick.relationId, kind: 'point-on-line', pointId, lineId: pick.lineId }];
        case 'datum': return cadFreshSketchDatumAxes(pick.datum).map((axis, index) => ({ id: pick.relationIds[index], kind: 'fixed-axis', pointId, axis, value: 0 }));
        case 'position': return [];
      }
    })];
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
    case 'polygon': {
      const positions = drawing.vertices.map(checkedPoint);
      validateFreshProfile({ kind: 'polygon', points: positions }, construction);
      const graph = allocateClosedLines(positions, false, construction, createId), vertexPointIds = Object.freeze(graph.points.map(point => point.id));
      return Object.freeze({ kind: 'polygon', vertexPointIds, geometry: finish(graph, drawing.vertices.map((pick, index) => ({ pick, pointId: vertexPointIds[index] }))) });
    }
    case 'slot': {
      const center = checkedPoint(drawing.center), end = copyCadConstructionPoint(drawing.end), width = numeric(drawing.width);
      const { graph, centerPointId } = allocateSlot(center, end, width, construction, createId);
      return Object.freeze({ kind: 'slot', centerPointId, geometry: finish(graph, [{ pick: drawing.center, pointId: centerPointId }]) });
    }
    default: { const exhaustive: never = drawing; throw new CadError('unsupported-fresh-sketch-geometry', `Unsupported authored shape: ${String(exhaustive)}`); }
  }
}
