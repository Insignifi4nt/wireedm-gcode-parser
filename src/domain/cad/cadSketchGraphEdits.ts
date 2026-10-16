import type { CadSketchFeature } from './cadDocument';
import { CadError } from './cadError';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphEntity, type CadSketchGraphRelation } from './cadSketchGraph';

/** Structural intent only. The shared preparation stage solves before complete-part acceptance. */
export function appendCadSketchEntities({ sketch, geometry }: { sketch: CadSketchFeature; geometry: CadSketchGraph }): CadSketchFeature {
  const profileIds = new Set(sketch.profiles.map(profile => profile.id));
  for (const item of [...geometry.points, ...geometry.entities, ...geometry.relations]) {
    if (profileIds.has(item.id)) throw new CadError('duplicate-sketch-id', `Sketch identity "${item.id}" already belongs to a legacy profile.`);
  }
  return { ...sketch, graph: parseCadSketchGraph({
    points: [...sketch.graph?.points ?? [], ...geometry.points],
    entities: [...sketch.graph?.entities ?? [], ...geometry.entities],
    relations: [...sketch.graph?.relations ?? [], ...geometry.relations]
  }) };
}

function requireGraph(sketch: CadSketchFeature): CadSketchGraph {
  if (!sketch.graph) throw new CadError('missing-sketch-graph', 'Choose an existing entity-based sketch.');
  return sketch.graph;
}

function selectedIds(items: readonly { readonly id: string }[], requested: readonly string[], kind: 'point' | 'entity' | 'relation'): Set<string> {
  const existing = new Set(items.map(item => item.id));
  for (const id of requested) if (!existing.has(id)) throw new CadError(`missing-sketch-${kind}`, `Sketch ${kind} "${id}" no longer exists.`);
  return new Set(requested);
}

function pointReferences(item: CadSketchGraphEntity | CadSketchGraphRelation): readonly string[] {
  if ('pointIds' in item) return item.pointIds;
  if ('pointId' in item) return [item.pointId];
  switch (item.kind) {
    case 'line': return [item.startPointId, item.endPointId];
    case 'arc': return [item.centerPointId, item.startPointId, item.endPointId];
    case 'circle': return [item.centerPointId];
    default: { const exhaustive: never = item; throw exhaustive; }
  }
}

/** Deleting an entity never deletes its points or relations between retained points. */
export function deleteCadSketchElements({ sketch, pointIds, entityIds, relationIds, cascade }: {
  sketch: CadSketchFeature; pointIds: readonly string[]; entityIds: readonly string[]; relationIds: readonly string[]; cascade: boolean;
}): CadSketchFeature {
  const graph = requireGraph(sketch), points = selectedIds(graph.points, pointIds, 'point');
  const entities = selectedIds(graph.entities, entityIds, 'entity'), relations = selectedIds(graph.relations, relationIds, 'relation');
  const removeDependents = (items: readonly (CadSketchGraphEntity | CadSketchGraphRelation)[], selected: Set<string>) => {
    for (const item of items) if (pointReferences(item).some(id => points.has(id))) {
      if (!cascade && !selected.has(item.id)) throw new CadError('dependent-sketch-element', `Sketch element "${item.id}" depends on a selected point. Select it explicitly or use cascade deletion.`);
      selected.add(item.id);
    }
  };
  removeDependents(graph.entities, entities); removeDependents(graph.relations, relations);
  return { ...sketch, graph: parseCadSketchGraph({
    points: graph.points.filter(point => !points.has(point.id)),
    entities: graph.entities.filter(entity => !entities.has(entity.id)),
    relations: graph.relations.filter(relation => !relations.has(relation.id))
  }) };
}

export function setCadSketchConstruction({ sketch, entityIds, construction }: {
  sketch: CadSketchFeature; entityIds: readonly string[]; construction: boolean;
}): CadSketchFeature {
  const graph = requireGraph(sketch), selected = selectedIds(graph.entities, entityIds, 'entity');
  return { ...sketch, graph: parseCadSketchGraph({ ...graph,
    entities: graph.entities.map(entity => selected.has(entity.id) ? { ...entity, construction } : entity)
  }) };
}
