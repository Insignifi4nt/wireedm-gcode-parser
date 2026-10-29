import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { resolveCadSketchPointIdentities } from '@/domain/cad/cadSketchGraphJoints';
import { cadSketchRelationEntityIds } from '@/domain/cad/cadSketchGraphReferences';
import type { CadSketchDimensionRelation } from './cadSketchGraphDimensionLayout';
import type { CadSketchDatum } from './cadSketchGraphSelection';

const DIMENSION_KINDS: ReadonlySet<CadSketchGraphRelation['kind']> = new Set(['distance', 'point-line-distance', 'axis-distance', 'radial-size', 'fillet-corner', 'chamfer-corner', 'line-angle', 'reference-dimension']);
/** Relations drawn as a dimension annotation on the sketch canvas. */
export const isCadSketchDimensionRelation = (relation: CadSketchGraphRelation): relation is CadSketchDimensionRelation => DIMENSION_KINDS.has(relation.kind);

/**
 * One selected dimension: its relation ID, or a profile chip's field, and what it was authored to measure. A different dimension that
 * reuses the ID, after undo, redo or an agent edit, is a different pick and never inherits the selection.
 * - `form` is the kind of relation, such as a driving distance or a reference to a line's length.
 * - `identity` is what that form names: a reference to a line keeps the line, so it survives a Trim or Extend that rewrites an endpoint.
 * - `measures` is the measured quantity that a driving and a reference form share, so Make reference and Make driving keep the pick.
 */
export interface CadSketchDimensionPick { readonly id: string; readonly form: string; readonly identity: string; readonly measures: string }
/** Dimensions selected on the canvas or on a profile, in selection order. Geometry selection replaces it. */
export const NO_SKETCH_DIMENSIONS: readonly CadSketchDimensionPick[] = Object.freeze([]);
export const NO_SKETCH_DIMENSION_IDS: readonly string[] = Object.freeze([]);
const MAX_SELECTED_DIMENSIONS = 64;
/** Whether two picks name the same dimension: the same form must name the same thing; another form must measure the same quantity. */
export const sameCadSketchDimensionPick = (a: CadSketchDimensionPick, b: CadSketchDimensionPick) => a.id === b.id && (a.form === b.form ? a.identity === b.identity : a.measures === b.measures);
const samePick = sameCadSketchDimensionPick;
const equalPick = (a: CadSketchDimensionPick, b: CadSketchDimensionPick) => a.id === b.id && a.form === b.form && a.identity === b.identity && a.measures === b.measures;

/** A plain pick selects one dimension; an additive pick toggles it in or out of the current set. */
export function selectCadSketchDimension(current: readonly CadSketchDimensionPick[], pick: CadSketchDimensionPick, additive = false): readonly CadSketchDimensionPick[] {
  if (!additive) return current.length === 1 && samePick(current[0], pick) ? current : Object.freeze([pick]);
  if (current.some(item => samePick(item, pick))) { const kept = current.filter(item => !samePick(item, pick)); return kept.length ? Object.freeze(kept) : NO_SKETCH_DIMENSIONS; }
  return current.length >= MAX_SELECTED_DIMENSIONS ? current : Object.freeze([...current, pick]);
}
/** Keeps the picks that still name an available dimension; an unchanged set keeps its identity. */
export function keepCadSketchDimensionPicks(current: readonly CadSketchDimensionPick[], available: (pick: CadSketchDimensionPick) => boolean): readonly CadSketchDimensionPick[] {
  if (!current.length) return current;
  const kept = current.filter(available);
  return kept.length === current.length ? current : kept.length ? Object.freeze(kept) : NO_SKETCH_DIMENSIONS;
}
export function cadSketchDimensionIds(current: readonly CadSketchDimensionPick[]): readonly string[] {
  return current.length ? Object.freeze(current.map(pick => pick.id)) : NO_SKETCH_DIMENSION_IDS;
}

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);
// One resolver per graph, so a canvas of dimensions joins its Coincident relations once; a graph that names a missing point keeps raw IDs.
const identities = new WeakMap<CadSketchGraph, (pointId: string) => string>();
function pointIdentities(graph: CadSketchGraph): (pointId: string) => string {
  let identity = identities.get(graph);
  if (!identity) {
    let root: (pointId: string) => string;
    try { root = resolveCadSketchPointIdentities(graph); } catch { root = id => id; }
    identity = id => { try { return root(id); } catch { return id; } };
    identities.set(graph, identity);
  }
  return identity;
}
/**
 * The pick for a dimension relation, without its value. Editing the value keeps the selection, and so do Make reference and
 * Make driving, which keep the measured length, distance, radius or diameter. A relation that measures something else does not.
 * The measured quantity names points through their Coincident joins, as the dimension lookups do, so a driver on a coincident alias of a
 * line's endpoint and the line's reference measure the same length; the authored identity keeps the IDs it names.
 * A point to line distance names its point and line, not its side, which an edit that turns the line around flips to keep the point where it is.
 */
export function cadSketchDimensionPickOf(graph: CadSketchGraph, relation: CadSketchDimensionRelation): CadSketchDimensionPick {
  const pair = (pointIds: readonly string[]) => [...pointIds].sort();
  const joined = (pointIds: readonly string[]) => pair(pointIds.map(pointIdentities(graph)));
  const joinedPoint = (pointId: string) => pointIdentities(graph)(pointId);
  const pick = (form: string, identity: unknown, measures: unknown = identity) => ({ id: relation.id, form, identity: canonical(identity), measures: canonical(measures) });
  switch (relation.kind) {
    case 'distance': return pick('distance', pair(relation.pointIds), ['point-distance', joined(relation.pointIds)]);
    case 'point-line-distance': return pick('point-line-distance', [relation.pointId, relation.lineId], ['point-line-distance', joinedPoint(relation.pointId), relation.lineId]);
    case 'radial-size': return pick('radial-size', [relation.entityId, relation.quantity], ['radial-size', relation.entityId, relation.quantity]);
    case 'reference-dimension': {
      const measurement = relation.measurement, form = `reference/${measurement.kind}`;
      if (measurement.kind === 'radial-size') return pick(form, [measurement.entityId, measurement.quantity], ['radial-size', measurement.entityId, measurement.quantity]);
      if (measurement.kind === 'point-distance') return pick(form, pair(measurement.pointIds), ['point-distance', joined(measurement.pointIds)]);
      if (measurement.kind === 'point-line-distance') return pick(form, [measurement.pointId, measurement.lineId], ['point-line-distance', joinedPoint(measurement.pointId), measurement.lineId]);
      // A line reference names its line; only its match with a driving distance goes through the line's current endpoints.
      const line = graph.entities.find(entity => entity.id === measurement.entityId);
      return pick(form, measurement.entityId, line?.kind === 'line' ? ['point-distance', joined([line.startPointId, line.endPointId])] : [form, measurement.entityId]);
    }
    default: return pick(relation.kind, Object.fromEntries(Object.entries(relation).filter(([key]) => key !== 'id' && key !== 'value' && key !== 'values')));
  }
}
/** The pick for a canvas dimension, or null when the relation is gone or is not a dimension. */
export function cadSketchDimensionPick(graph: CadSketchGraph, relationId: string): CadSketchDimensionPick | null {
  const relation = graph.relations.find(item => item.id === relationId);
  return relation && isCadSketchDimensionRelation(relation) ? cadSketchDimensionPickOf(graph, relation) : null;
}
/** Whether a pick still names the dimension the graph holds under its ID. */
export function isCadSketchDimensionPickCurrent(graph: CadSketchGraph | undefined, pick: CadSketchDimensionPick): boolean {
  const current = graph ? cadSketchDimensionPick(graph, pick.id) : null;
  return Boolean(current && samePick(current, pick));
}
/**
 * Undo, redo, deletion and agent edits can remove or replace a selected dimension; the rest stay selected. A kept pick takes the
 * dimension's current form and endpoints, so a later Make driving still matches a line reference whose endpoint was rewritten.
 */
export function reconcileCadSketchDimensionSelection(graph: CadSketchGraph | undefined, current: readonly CadSketchDimensionPick[]): readonly CadSketchDimensionPick[] {
  if (!current.length) return current;
  if (!graph) return NO_SKETCH_DIMENSIONS;
  let changed = false;
  const kept = current.flatMap(pick => {
    const now = cadSketchDimensionPick(graph, pick.id);
    if (!now || !samePick(now, pick)) { changed = true; return []; }
    if (!equalPick(now, pick)) changed = true;
    return [equalPick(now, pick) ? pick : now];
  });
  return !changed ? current : kept.length ? Object.freeze(kept) : NO_SKETCH_DIMENSIONS;
}
/**
 * Mount keys for dimension annotations. A relation keeps its key while each new graph names the same dimension, so focus and a
 * menu's focus return stay with it; a replacement under the same ID gets a new key, so it never inherits either.
 */
export function createCadSketchDimensionKeys() {
  let entries = new Map<string, { pick: CadSketchDimensionPick; generation: number }>(), next = 0;
  return (graph: CadSketchGraph): ReadonlyMap<string, string> => {
    const updated = new Map<string, { pick: CadSketchDimensionPick; generation: number }>(), keys = new Map<string, string>();
    for (const relation of graph.relations) {
      if (!isCadSketchDimensionRelation(relation)) continue;
      const pick = cadSketchDimensionPickOf(graph, relation), previous = entries.get(relation.id);
      const entry = previous && samePick(previous.pick, pick) ? { pick, generation: previous.generation } : { pick, generation: next++ };
      updated.set(relation.id, entry); keys.set(relation.id, `${relation.id}/${entry.generation}`);
    }
    entries = updated;
    return keys;
  };
}

/** Sentence-case name of a canvas dimension, as the relations list names it. */
export function cadSketchDimensionName(graph: CadSketchGraph, relation: CadSketchDimensionRelation): string {
  switch (relation.kind) {
    case 'distance': return graph.entities.some(entity => entity.kind === 'line' && relation.pointIds.includes(entity.startPointId) && relation.pointIds.includes(entity.endPointId)) ? 'Length' : 'Distance';
    case 'point-line-distance': return 'Point to line distance';
    case 'axis-distance': return relation.axis === 'x' ? 'Horizontal distance' : 'Vertical distance';
    case 'radial-size': return relation.quantity === 'radius' ? 'Radius' : 'Diameter';
    case 'fillet-corner': return 'Fillet';
    case 'chamfer-corner': return 'Chamfer';
    case 'line-angle': return 'Angle';
    case 'reference-dimension': return 'Reference dimension';
  }
}
/** What the canvas status line says about the selected dimensions; selection never opens the editor. */
export function cadSketchDimensionSelectionStatus(graph: CadSketchGraph | undefined, ids: readonly string[]): string | null {
  if (!graph || !ids.length) return null;
  if (ids.length > 1) return `${ids.length} dimensions selected · Delete removes them`;
  const relation = graph.relations.find(item => item.id === ids[0]);
  return relation && isCadSketchDimensionRelation(relation) ? `${cadSketchDimensionName(graph, relation)} selected · Double-click or Enter edits · Delete removes` : null;
}

/** Geometry a relation names directly, plus the sketch datum it measures from. */
export interface CadSketchHighlight { readonly pointIds: readonly string[]; readonly entityIds: readonly string[]; readonly datums: readonly CadSketchDatum[] }
export const NO_SKETCH_HIGHLIGHT: CadSketchHighlight = Object.freeze({ pointIds: [], entityIds: [], datums: [] });
export function cadSketchRelationHighlight(graph: CadSketchGraph, relation: CadSketchGraphRelation): CadSketchHighlight {
  const named = relation.kind === 'reference-dimension' ? relation.measurement.kind === 'point-distance' ? relation.measurement.pointIds
    : relation.measurement.kind === 'point-line-distance' ? [relation.measurement.pointId] : []
    : relation.kind === 'tangent-joint' ? relation.endpoints.map(endpoint => endpoint.pointId)
      : 'pointIds' in relation ? relation.pointIds : 'pointId' in relation ? [relation.pointId] : [];
  // A dimension or relation between a line's own endpoints is about that line.
  const spanned = named.length === 2 ? graph.entities.filter(entity => entity.kind === 'line' && named.includes(entity.startPointId) && named.includes(entity.endPointId)).map(entity => entity.id) : [];
  const entities = new Set(graph.entities.map(entity => entity.id)), points = new Set(graph.points.map(point => point.id));
  // A coordinate is measured from the other axis: X from the Y axis, Y from the X axis.
  const datums: readonly CadSketchDatum[] = relation.kind === 'fixed-axis' ? [relation.axis === 'x' ? 'y-axis' : 'x-axis'] : relation.kind === 'fixed-point' ? ['origin'] : [];
  return { pointIds: [...new Set(named)].filter(id => points.has(id)), entityIds: [...new Set([...cadSketchRelationEntityIds(relation), ...spanned])].filter(id => entities.has(id)), datums };
}

/** A relation resolves against the drawn graph, so a dimension removed by undo highlights nothing; dock rows pass their own draft geometry. */
export type CadSketchHighlightSource = { readonly kind: 'relation'; readonly relationId: string } | ({ readonly kind: 'geometry' } & CadSketchHighlight);
/**
 * Hover highlight shared by canvas dimensions and dock rows. Only the overlay subscribes, so hovering renders no graph rows,
 * no canvas and no workbench. Each owner shows and hides only its own highlight.
 */
export interface CadSketchHighlightStore {
  getSnapshot(): CadSketchHighlightSource | null;
  subscribe(listener: () => void): () => void;
  show(owner: string, source: CadSketchHighlightSource): void;
  hide(owner: string): void;
}
export function createCadSketchHighlightStore(): CadSketchHighlightStore {
  let owner: string | null = null, current: CadSketchHighlightSource | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of [...listeners]) listener(); };
  return {
    getSnapshot: () => current,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    show: (key, source) => {
      if (owner === key && current && JSON.stringify(current) === JSON.stringify(source)) return;
      owner = key; current = source; publish();
    },
    hide: key => { if (owner !== key) return; owner = null; current = null; publish(); }
  };
}
