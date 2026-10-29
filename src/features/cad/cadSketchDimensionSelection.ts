import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationEntityIds } from '@/domain/cad/cadSketchGraphReferences';
import type { CadSketchDimensionRelation } from './cadSketchGraphDimensionLayout';
import type { CadSketchDatum } from './cadSketchGraphSelection';

const DIMENSION_KINDS: ReadonlySet<CadSketchGraphRelation['kind']> = new Set(['distance', 'axis-distance', 'radial-size', 'fillet-corner', 'chamfer-corner', 'line-angle', 'reference-dimension']);
/** Relations drawn as a dimension annotation on the sketch canvas. */
export const isCadSketchDimensionRelation = (relation: CadSketchGraphRelation): relation is CadSketchDimensionRelation => DIMENSION_KINDS.has(relation.kind);

/**
 * One selected dimension: its relation ID, or a profile chip's field, and what it measures. A different dimension that reuses the ID,
 * after undo, redo or an agent edit, is a different pick and never inherits the selection.
 */
export interface CadSketchDimensionPick { readonly id: string; readonly identity: string }
/** Dimensions selected on the canvas or on a profile, in selection order. Geometry selection replaces it. */
export const NO_SKETCH_DIMENSIONS: readonly CadSketchDimensionPick[] = Object.freeze([]);
export const NO_SKETCH_DIMENSION_IDS: readonly string[] = Object.freeze([]);
const MAX_SELECTED_DIMENSIONS = 64;
export const sameCadSketchDimensionPick = (a: CadSketchDimensionPick, b: CadSketchDimensionPick) => a.id === b.id && a.identity === b.identity;
const samePick = sameCadSketchDimensionPick;

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
/**
 * What a dimension measures, without its value or ID. Editing the value keeps the selection, and so do Make reference and
 * Make driving, which keep the measured length, distance, radius or diameter. A relation that measures something else does not.
 */
export function cadSketchDimensionIdentity(graph: CadSketchGraph, relation: CadSketchDimensionRelation): string {
  const pair = (pointIds: readonly string[]) => [...pointIds].sort();
  switch (relation.kind) {
    case 'distance': return canonical(['point-distance', pair(relation.pointIds)]);
    case 'radial-size': return canonical(['radial-size', relation.entityId, relation.quantity]);
    case 'reference-dimension': {
      const measurement = relation.measurement;
      if (measurement.kind === 'radial-size') return canonical(['radial-size', measurement.entityId, measurement.quantity]);
      if (measurement.kind === 'point-distance') return canonical(['point-distance', pair(measurement.pointIds)]);
      const line = graph.entities.find(entity => entity.id === measurement.entityId);
      return line?.kind === 'line' ? canonical(['point-distance', pair([line.startPointId, line.endPointId])]) : canonical(['line-length', measurement.entityId]);
    }
    default: return canonical(Object.fromEntries(Object.entries(relation).filter(([key]) => key !== 'id' && key !== 'value' && key !== 'values')));
  }
}
/** The pick for a canvas dimension, or null when the relation is gone or is not a dimension. */
export function cadSketchDimensionPick(graph: CadSketchGraph, relationId: string): CadSketchDimensionPick | null {
  const relation = graph.relations.find(item => item.id === relationId);
  return relation && isCadSketchDimensionRelation(relation) ? { id: relation.id, identity: cadSketchDimensionIdentity(graph, relation) } : null;
}
/** Undo, redo, deletion and agent edits can remove or replace a selected dimension; the rest stay selected. */
export function reconcileCadSketchDimensionSelection(graph: CadSketchGraph | undefined, current: readonly CadSketchDimensionPick[]): readonly CadSketchDimensionPick[] {
  if (!graph) return current.length ? NO_SKETCH_DIMENSIONS : current;
  return keepCadSketchDimensionPicks(current, pick => cadSketchDimensionPick(graph, pick.id)?.identity === pick.identity);
}

/** Sentence-case name of a canvas dimension, as the relations list names it. */
export function cadSketchDimensionName(graph: CadSketchGraph, relation: CadSketchDimensionRelation): string {
  switch (relation.kind) {
    case 'distance': return graph.entities.some(entity => entity.kind === 'line' && relation.pointIds.includes(entity.startPointId) && relation.pointIds.includes(entity.endPointId)) ? 'Length' : 'Distance';
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
  const named = relation.kind === 'reference-dimension' ? relation.measurement.kind === 'point-distance' ? relation.measurement.pointIds : []
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
