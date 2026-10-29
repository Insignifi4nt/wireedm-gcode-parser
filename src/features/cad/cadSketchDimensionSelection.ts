import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationEntityIds } from '@/domain/cad/cadSketchGraphReferences';
import type { CadSketchDimensionRelation } from './cadSketchGraphDimensionLayout';
import type { CadSketchDatum } from './cadSketchGraphSelection';

const DIMENSION_KINDS: ReadonlySet<CadSketchGraphRelation['kind']> = new Set(['distance', 'axis-distance', 'radial-size', 'fillet-corner', 'chamfer-corner', 'line-angle', 'reference-dimension']);
/** Relations drawn as a dimension annotation on the sketch canvas. */
export const isCadSketchDimensionRelation = (relation: CadSketchGraphRelation): relation is CadSketchDimensionRelation => DIMENSION_KINDS.has(relation.kind);

/** Relation IDs of the dimensions selected on the canvas, in selection order. Geometry selection replaces it. */
export const NO_SKETCH_DIMENSIONS: readonly string[] = Object.freeze([]);
const MAX_SELECTED_DIMENSIONS = 64;

/** A plain pick selects one dimension; an additive pick toggles it in or out of the current set. */
export function selectCadSketchDimension(current: readonly string[], id: string, additive = false): readonly string[] {
  if (!additive) return current.length === 1 && current[0] === id ? current : Object.freeze([id]);
  if (current.includes(id)) { const kept = current.filter(item => item !== id); return kept.length ? Object.freeze(kept) : NO_SKETCH_DIMENSIONS; }
  return current.length >= MAX_SELECTED_DIMENSIONS ? current : Object.freeze([...current, id]);
}
/** Undo, redo and deletion can remove a selected dimension; the rest stay selected and an unchanged set keeps its identity. */
export function reconcileCadSketchDimensionSelection(graph: CadSketchGraph | undefined, current: readonly string[]): readonly string[] {
  if (!current.length) return current;
  const kept = current.filter(id => graph?.relations.some(relation => relation.id === id && isCadSketchDimensionRelation(relation)));
  return kept.length === current.length ? current : kept.length ? Object.freeze(kept) : NO_SKETCH_DIMENSIONS;
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
