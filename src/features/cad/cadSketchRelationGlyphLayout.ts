import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds } from '@/domain/cad/cadSketchGraphReferences';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import type { SketchPoint } from './cadSketchInteraction';
import { CAD_SKETCH_ORIGIN_PAIR_NAME, cadSketchPointIdentity, cadSketchRelationHighlight, isCadSketchGlyphRelation } from './cadSketchDimensionSelection';
import { cadSketchCurveCentres, cadSketchRelationDescription, cadSketchRelationName, cadSketchRelationOperandLabels, createCadSketchRelationLabels, isCadSketchConcentric } from './cadSketchRelationNames';

/** The drawing a glyph shows, one per relation kind as the user knows it; a Concentric is stored as a Coincident between two centres. */
export type CadSketchRelationGlyphKind = 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'collinear' | 'equal-length' | 'equal-radius' | 'tangent'
  | 'coincident' | 'concentric' | 'midpoint' | 'symmetric' | 'fix' | 'point-on-line' | 'point-on-curve';
/** The point or edge a glyph sits on, as `point:<id>` or `entity:<id>`; a point is named by its Coincident identity, so the points of one place share one row of glyphs. */
export type CadSketchRelationGlyphOperand = `point:${string}` | `entity:${string}`;
/**
 * One relation glyph on one operand. A relation on several operands draws a glyph on each, its siblings; X and Y held at 0 on one point
 * draw one At the origin glyph that names both. The anchor is in sketch millimetres and the offset in screen pixels, x right and y down, so the
 * glyph keeps its distance from the geometry at every zoom.
 */
export interface CadSketchRelationGlyph {
  /** Relation IDs and operand: a glyph keeps its key while it names the same relations on the same point or edge. */
  readonly key: string;
  readonly relationIds: readonly string[];
  readonly operand: CadSketchRelationGlyphOperand;
  readonly kind: CadSketchRelationGlyphKind;
  readonly anchor: SketchPoint;
  readonly offset: SketchPoint;
  /** "Parallel", as the relations list names it. */
  readonly name: string;
  /** "Parallel: Line 3 and Line 5", the glyph's accessible name. */
  readonly label: string;
  readonly holds: CadSketchRelationGlyphHolds;
}

/**
 * The drawing of a relation's glyph, shared by the relations list and the Constrain menu, or null for a relation drawn otherwise. A point
 * held on an axis or at the origin draws as Coincident, the Constrain tool that puts it there; held away from the axis, the coordinate is
 * a Distance dimension, and the Fix tool's fixed point draws as Fix.
 */
export function cadSketchRelationGlyphKind(graph: CadSketchGraph, relation: CadSketchGraphRelation, centres = cadSketchCurveCentres(graph)): CadSketchRelationGlyphKind | null {
  switch (relation.kind) {
    case 'horizontal': case 'vertical': case 'parallel': case 'perpendicular': case 'collinear': case 'equal-length': case 'equal-radius':
    case 'midpoint': case 'symmetric': case 'point-on-line': case 'point-on-curve': return relation.kind;
    case 'coincident': return isCadSketchConcentric(graph, relation, centres) ? 'concentric' : 'coincident';
    case 'fixed-point': return 'fix';
    case 'fixed-axis': return isCadSketchGlyphRelation(relation) ? 'coincident' : null;
    case 'tangent-joint': return 'tangent';
    case 'distance': case 'point-line-distance': case 'axis-distance': case 'radial-size': case 'fillet-corner': case 'chamfer-corner': case 'line-angle': case 'reference-dimension':
    case 'linear-pattern': case 'external-reference': return null;
    default: { const unreachable: never = relation; return unreachable; }
  }
}

/** Screen-pixel placement: glyphs sit 12 px off a line or curve, 10 px diagonally off a point, and stack 15 px apart. */
export const CAD_SKETCH_RELATION_GLYPH_PIXELS = { size: 12, edge: 12, point: 10, stack: 15 } as const;

/** The points, by Coincident identity, and the edges that a glyph's relations name directly: what selecting or hovering geometry reveals and relates. */
export interface CadSketchRelationGlyphHolds { readonly points: readonly string[]; readonly entities: readonly string[] }
interface Entry { readonly relationIds: readonly string[]; readonly operand: CadSketchRelationGlyphOperand; readonly kind: CadSketchRelationGlyphKind; readonly name: string; readonly label: string; readonly holds: CadSketchRelationGlyphHolds }
/**
 * A glyph before it is placed: what it names and its slot among the glyphs on its operand. Only the sketch's relations, edges and point
 * IDs decide it, so a drag, which moves geometry only, places the same entries again without naming them again.
 */
export interface CadSketchRelationGlyphEntry extends Entry { readonly key: string; readonly index: number; readonly count: number }
type Operands = readonly CadSketchRelationGlyphOperand[];
const point = (id: string): CadSketchRelationGlyphOperand => `point:${id}`, entity = (id: string): CadSketchRelationGlyphOperand => `entity:${id}`;

/**
 * Where each relation draws its glyphs, from the operands the shared resolvers name, with points by Coincident identity. Dimensions draw as
 * dimensions; a linear pattern and a linked reference keep their own controls, whose Detach keeps their geometry, so a glyph Delete must never stand in for it.
 */
function glyphOperands(graph: CadSketchGraph, relation: CadSketchGraphRelation, lines: ReadonlyMap<string, string>, centres: ReadonlyMap<string, readonly string[]>,
  identity: (pointId: string) => string): { readonly kind: CadSketchRelationGlyphKind; readonly operands: Operands } | null {
  const kind = cadSketchRelationGlyphKind(graph, relation, centres);
  if (!kind) return null;
  const at = (id: string) => point(identity(id));
  switch (relation.kind) {
    case 'horizontal': case 'vertical': {
      // Between a line's own endpoints, or points joined to them, the relation is about that line; otherwise it aligns two points and marks both.
      const [a, b] = cadSketchRelationPointIds(graph, relation).map(identity), line = lines.get(pairKey(a, b));
      return { kind, operands: line ? [entity(line)] : [point(a), point(b)] };
    }
    case 'parallel': case 'perpendicular': case 'collinear': case 'equal-length': case 'equal-radius':
      return { kind, operands: cadSketchRelationEntityIds(relation).map(entity) };
    case 'coincident':
      // A Concentric marks both curves; the two points of any other Coincident share one place, so one glyph marks them.
      return kind === 'concentric' ? { kind, operands: cadSketchRelationPointIds(graph, relation).map(id => entity(centres.get(id)![0])) }
        : { kind, operands: [at(cadSketchRelationPointIds(graph, relation)[0])] };
    // Point on curve marks its point and the arc or circle that keeps it.
    case 'point-on-curve': return { kind, operands: [at(relation.pointId), entity(relation.curveId)] };
    case 'midpoint': case 'point-on-line': case 'fixed-point': case 'fixed-axis':
      return { kind, operands: [at(cadSketchRelationPointIds(graph, relation)[0])] };
    case 'symmetric': {
      const [a, b] = cadSketchRelationPointIds(graph, relation);
      return { kind, operands: [at(a), at(b), ...cadSketchRelationEntityIds(relation).map(entity)] };
    }
    case 'tangent-joint': return { kind, operands: [at(relation.endpoints[0].pointId)] };
    case 'distance': case 'point-line-distance': case 'axis-distance': case 'radial-size': case 'fillet-corner': case 'chamfer-corner': case 'line-angle': case 'reference-dimension':
    case 'linear-pattern': case 'external-reference':
      return null;
    default: { const unreachable: never = relation; return unreachable; }
  }
}
const pairKey = (a: string, b: string) => a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;

/** How many glyphs the sketch draws, without placing them, so the canvas can tell when it shows only some. */
export function countCadSketchRelationGlyphs(graph: CadSketchGraph): number {
  return glyphEntries(graph).length;
}
/** Every relation glyph of a sketch, in a deterministic order: relations in graph order, and on each operand in that order too. */
export function layoutCadSketchRelationGlyphs(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>): readonly CadSketchRelationGlyph[] {
  return placeCadSketchRelationGlyphs(graph, parameters, cadSketchRelationGlyphEntries(graph));
}
/** The glyph entries of a sketch, in layout order, each with its slot among the glyphs on its operand. */
export function cadSketchRelationGlyphEntries(graph: CadSketchGraph): readonly CadSketchRelationGlyphEntry[] {
  const entries = glyphEntries(graph), counts = new Map<CadSketchRelationGlyphOperand, number>(), placed = new Map<CadSketchRelationGlyphOperand, number>();
  for (const entry of entries) counts.set(entry.operand, (counts.get(entry.operand) ?? 0) + 1);
  return Object.freeze(entries.map(entry => {
    const index = placed.get(entry.operand) ?? 0; placed.set(entry.operand, index + 1);
    return Object.freeze({ ...entry, relationIds: Object.freeze(entry.relationIds), key: `${entry.relationIds.join('+')}@${entry.operand}`, index, count: counts.get(entry.operand)! });
  }));
}
function glyphEntries(graph: CadSketchGraph): readonly Entry[] {
  if (!graph.relations.length) return [];
  const labels = createCadSketchRelationLabels(graph), centres = labels.centres, identity = cadSketchPointIdentity(graph);
  // Lines by the identities of their ends, so a Horizontal or Vertical on points joined to a line's ends marks that line.
  const lines = new Map<string, string>();
  for (const item of graph.entities) if (item.kind === 'line') {
    const key = pairKey(identity(item.startPointId), identity(item.endPointId));
    if (!lines.has(key)) lines.set(key, item.id);
  }
  const holdsOf = (relations: readonly CadSketchGraphRelation[]): CadSketchRelationGlyphHolds => {
    const points = new Set<string>(), entities = new Set<string>();
    for (const relation of relations) {
      const named = cadSketchRelationHighlight(graph, relation);
      for (const id of named.pointIds) points.add(identity(id));
      for (const id of named.entityIds) entities.add(id);
    }
    return Object.freeze({ points: Object.freeze([...points]), entities: Object.freeze([...entities]) });
  };
  const entries: Entry[] = [];
  // The coordinates held at 0 on one point, or on points that Coincident joins in one place, draw one glyph; X and Y together keep the point
  // at the origin. The relations list keeps a row for each, and a coordinate held away from 0 is a Distance dimension, drawn as one.
  const onAxes = new Map<string, Extract<CadSketchGraphRelation, { kind: 'fixed-axis' }>[]>();
  for (const relation of graph.relations) if (relation.kind === 'fixed-axis' && isCadSketchGlyphRelation(relation)) {
    const place = identity(relation.pointId);
    onAxes.set(place, [...onAxes.get(place) ?? [], relation]);
  }
  for (const relation of graph.relations) {
    let placed: ReturnType<typeof glyphOperands>;
    try { placed = glyphOperands(graph, relation, lines, centres, identity); } catch { continue; } // A relation on missing geometry has nowhere to sit.
    if (!placed) continue;
    if (relation.kind === 'fixed-axis') {
      const shared = onAxes.get(identity(relation.pointId))!;
      if (shared[0] !== relation) continue;
      if (shared.length > 1) {
        const both = shared.some(item => item.axis === 'x') && shared.some(item => item.axis === 'y'), name = both ? CAD_SKETCH_ORIGIN_PAIR_NAME : cadSketchRelationName(graph, relation, centres);
        entries.push({ relationIds: shared.map(item => item.id), operand: placed.operands[0], kind: placed.kind, name,
          label: `${name}: ${cadSketchRelationOperandLabels(graph, relation, labels).join(' and ')}`, holds: holdsOf(shared) });
        continue;
      }
    }
    const name = cadSketchRelationName(graph, relation, centres), label = cadSketchRelationDescription(graph, relation, labels, name), holds = holdsOf([relation]);
    for (const operand of new Set(placed.operands)) entries.push({ relationIds: [relation.id], operand, kind: placed.kind, name, label, holds });
  }
  return entries;
}
/**
 * Places entries made from this graph, or from one with the same relations, edges and point IDs; an entry whose geometry is missing draws
 * nothing. A glyph that lands where it lies in `previous`, placed from these same entries, is that same object, so a drag allocates only
 * the glyphs it moves and a caller can tell them apart by identity.
 */
export function placeCadSketchRelationGlyphs(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, entries: readonly CadSketchRelationGlyphEntry[],
  previous?: readonly CadSketchRelationGlyph[]): readonly CadSketchRelationGlyph[] {
  if (!entries.length) return [];
  const before = previous?.length ? glyphsByKey(previous) : null;
  const positions = new Map(graph.points.map(item => [item.id, [evaluateCadScalar(item.position[0], parameters), evaluateCadScalar(item.position[1], parameters)] as const]));
  const entities = new Map(graph.entities.map(item => [item.id, item]));
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of positions.values()) if (Number.isFinite(x) && Number.isFinite(y)) {
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x); bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  }
  const middle: SketchPoint = [bounds.minX / 2 + bounds.maxX / 2, bounds.minY / 2 + bounds.maxY / 2];
  return Object.freeze(entries.flatMap((entry): CadSketchRelationGlyph[] => {
    const at = place(entry.operand, entry.index, entry.count, positions, entities, parameters, middle);
    if (!at) return [];
    // Adding zero turns a negative zero into zero, so equal places compare equal.
    const offset: SketchPoint = [at.offset[0] + 0, at.offset[1] + 0], kept = before?.get(entry.key);
    if (kept && kept.holds === entry.holds && kept.anchor[0] === at.anchor[0] && kept.anchor[1] === at.anchor[1] && kept.offset[0] === offset[0] && kept.offset[1] === offset[1]) return [kept];
    return [Object.freeze({ key: entry.key, relationIds: entry.relationIds, operand: entry.operand, kind: entry.kind, anchor: at.anchor, offset, name: entry.name, label: entry.label, holds: entry.holds })];
  }));
}
const placedByKey = new WeakMap<readonly CadSketchRelationGlyph[], ReadonlyMap<string, CadSketchRelationGlyph>>();
function glyphsByKey(glyphs: readonly CadSketchRelationGlyph[]): ReadonlyMap<string, CadSketchRelationGlyph> {
  let byKey = placedByKey.get(glyphs);
  if (!byKey) { byKey = new Map(glyphs.map(glyph => [glyph.key, glyph])); placedByKey.set(glyphs, byKey); }
  return byKey;
}

/** A glyph's place: on an edge beside its middle, on a point diagonally above right, stacked side by side when several share one. */
function place(operand: CadSketchRelationGlyphOperand, index: number, count: number, positions: ReadonlyMap<string, readonly [number, number]>, entities: ReadonlyMap<string, CadSketchGraphEntity>,
  parameters: Readonly<Record<string, number>>, middle: SketchPoint): { readonly anchor: SketchPoint; readonly offset: SketchPoint } | null {
  const { edge, point: diagonal, stack } = CAD_SKETCH_RELATION_GLYPH_PIXELS, spread = (index - (count - 1) / 2) * stack;
  const finite = (value: readonly number[]) => value.every(Number.isFinite);
  const id = operand.slice(operand.indexOf(':') + 1);
  if (operand.startsWith('point:')) {
    const at = positions.get(id); if (!at || !finite(at)) return null;
    return { anchor: [at[0], at[1]], offset: [diagonal + index * stack, -diagonal] };
  }
  const item = entities.get(id); if (!item) return null;
  if (item.kind === 'line') {
    const a = positions.get(item.startPointId), b = positions.get(item.endPointId); if (!a || !b || !finite([...a, ...b])) return null;
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy), ux = length ? dx / length : 1, uy = length ? dy / length : 0;
    const mid: SketchPoint = [a[0] / 2 + b[0] / 2, a[1] / 2 + b[1] / 2];
    // Glyphs sit on the inner side of an edge, toward the middle of the sketch, leaving the outer side to the dimensions.
    let nx = -uy, ny = ux;
    const inward = (middle[0] - mid[0]) * nx + (middle[1] - mid[1]) * ny, tie = !Number.isFinite(inward) || Math.abs(inward) <= 1e-9 * Math.max(1, length);
    if (tie ? Math.abs(dx) >= Math.abs(dy) ? ny < 0 : nx < 0 : inward < 0) { nx = -nx; ny = -ny; }
    // A row along the edge reads left to right.
    const rx = ux < 0 || ux === 0 && uy < 0 ? -ux : ux, ry = ux < 0 || ux === 0 && uy < 0 ? -uy : uy;
    return { anchor: mid, offset: [nx * edge + rx * spread, -(ny * edge + ry * spread)] };
  }
  const centre = positions.get(item.centerPointId); if (!centre || !finite(centre)) return null;
  if (item.kind === 'circle') {
    const radius = evaluateCadScalar(item.radius, parameters); if (!Number.isFinite(radius)) return null;
    return { anchor: [centre[0], centre[1] + radius], offset: [spread, -edge] };
  }
  const start = positions.get(item.startPointId), end = positions.get(item.endPointId); if (!start || !end || !finite([...start, ...end])) return null;
  const from = Math.atan2(start[1] - centre[1], start[0] - centre[0]), to = Math.atan2(end[1] - centre[1], end[0] - centre[0]);
  const ccw = ((to - from) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
  const angle = from + (item.direction === 'cw' ? -(2 * Math.PI - ccw) : ccw) / 2, radius = Math.hypot(start[0] - centre[0], start[1] - centre[1]);
  const cx = Math.cos(angle), cy = Math.sin(angle);
  return { anchor: [centre[0] + cx * radius, centre[1] + cy * radius], offset: [cx * edge - cy * spread, -(cy * edge + cx * spread)] };
}

/**
 * Where a glyph draws in the glyph layer's screen pixels, x right and y down from the sketch point the canvas centres: its anchor scaled
 * from millimetres, plus its pixel offset. The layer draws every glyph in one scaled group, so no glyph carries a transform of its own.
 */
export function cadSketchRelationGlyphPixel(glyph: Pick<CadSketchRelationGlyph, 'anchor' | 'offset'>, center: SketchPoint, mmPerPixel: number): SketchPoint {
  return [(glyph.anchor[0] - center[0]) / mmPerPixel + glyph.offset[0], -(glyph.anchor[1] - center[1]) / mmPerPixel + glyph.offset[1]];
}

/** A glyph's plate around its pixel centre, grown by `margin` pixels for a ring. Each glyph row, and each ring, asks for it once per render. */
export function cadSketchRelationGlyphPlate(x: number, y: number, margin = 0): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const half = CAD_SKETCH_RELATION_GLYPH_PIXELS.size / 2 + 1 + margin;
  return { x: x - half, y: y - half, width: 2 * half, height: 2 * half };
}
