import type { CadPathSegment, CadPoint2, CadPoint3, CadProfile, CadScalar } from '../cadDocument';
import type { CadEdgePredicate, CadEdgeSelection, CadFaceQuery, CadFacePredicate } from '../cadTopology';
import type { CadSketchGraph } from '../cadSketchGraph';
import { mapCadSketchRelationScalars } from '../cadSketchGraphReferences';
import { CAD_SKETCH_RELATION_DEFINITIONS } from '../sketch-relations/cadSketchRelationRegistry';
import type { CadFeatureNestedQuantity, CadFeatureQuantityPath, CadScalarMapper } from './cadFeatureDefinitionTypes';

// Each maps the dimension-bearing scalars of one stored value, naming each by its path below `path`. Ids, source text and pinned
// packages are left exact.

export function mapCadPoint2(point: CadPoint2, path: string, map: CadScalarMapper): CadPoint2 { return [map(point[0], `${path}.0`), map(point[1], `${path}.1`)]; }
export function mapCadPoint3(point: CadPoint3, path: string, map: CadScalarMapper): CadPoint3 { return [map(point[0], `${path}.0`), map(point[1], `${path}.1`), map(point[2], `${path}.2`)]; }
/** A sketch graph's point positions, circle radii and relation values, under `graph`. */
export function mapCadSketchGraphScalars(graph: CadSketchGraph, path: string, map: CadScalarMapper): CadSketchGraph {
  return { ...graph,
    points: graph.points.map((point, index) => ({ ...point, position: mapCadPoint2(point.position, `${path}.points.${index}.position`, map) })),
    entities: graph.entities.map((entity, index) => entity.kind === 'circle' ? { ...entity, radius: map(entity.radius, `${path}.entities.${index}.radius`) } : entity),
    relations: graph.relations.map((relation, index) => mapCadSketchRelationScalars(relation, (value, key) => map(value, `${path}.relations.${index}.${key}`)))
  };
}
export function mapCadPathSegment(segment: CadPathSegment, path: string, map: CadScalarMapper): CadPathSegment {
  return segment.kind === 'line' ? { ...segment, start: mapCadPoint2(segment.start, `${path}.start`, map), end: mapCadPoint2(segment.end, `${path}.end`, map) }
    : { ...segment, center: mapCadPoint2(segment.center, `${path}.center`, map), radius: map(segment.radius, `${path}.radius`), startAngle: map(segment.startAngle, `${path}.startAngle`), sweep: map(segment.sweep, `${path}.sweep`) };
}
export function mapCadPathSegments(segments: readonly CadPathSegment[], path: string, map: CadScalarMapper): readonly CadPathSegment[] {
  return segments.map((entry, index) => mapCadPathSegment(entry, `${path}.${index}`, map));
}
export function mapCadProfileScalars(profile: CadProfile, path: string, map: CadScalarMapper): CadProfile {
  const scalar = (value: CadScalar, key: string) => map(value, `${path}.${key}`);
  switch (profile.kind) {
    case 'plugin': return { ...profile, inputs: Object.fromEntries(Object.entries(profile.inputs).map(([name, value]) => [name, scalar(value, `inputs.${name}`)])) };
    case 'rectangle': return { ...profile, x: scalar(profile.x, 'x'), y: scalar(profile.y, 'y'), width: scalar(profile.width, 'width'), height: scalar(profile.height, 'height'), cornerRadius: scalar(profile.cornerRadius, 'cornerRadius') };
    case 'circle': return { ...profile, x: scalar(profile.x, 'x'), y: scalar(profile.y, 'y'), radius: scalar(profile.radius, 'radius') };
    case 'slot': return { ...profile, x: scalar(profile.x, 'x'), y: scalar(profile.y, 'y'), length: scalar(profile.length, 'length'), width: scalar(profile.width, 'width'), angle: scalar(profile.angle, 'angle') };
    case 'polygon': return { ...profile, points: profile.points.map((point, index) => mapCadPoint2(point, `${path}.points.${index}`, map)) };
    case 'path': return { ...profile, segments: mapCadPathSegments(profile.segments, `${path}.segments`, map) };
    default: { const exhaustive: never = profile; return exhaustive; }
  }
}
function mapEdgePredicate(predicate: CadEdgePredicate, path: string, map: CadScalarMapper): CadEdgePredicate {
  switch (predicate.kind) {
    case 'length': return { ...predicate, value: map(predicate.value, `${path}.value`) };
    case 'on-plane': return { ...predicate, offset: map(predicate.offset, `${path}.offset`) };
    case 'line-endpoints': return { ...predicate, start: mapCadPoint3(predicate.start, `${path}.start`, map), end: mapCadPoint3(predicate.end, `${path}.end`, map) };
    case 'arc-points': return { ...predicate, start: mapCadPoint3(predicate.start, `${path}.start`, map), end: mapCadPoint3(predicate.end, `${path}.end`, map), midpoint: mapCadPoint3(predicate.midpoint, `${path}.midpoint`, map) };
    case 'circle': return { ...predicate, center: mapCadPoint3(predicate.center, `${path}.center`, map), radius: map(predicate.radius, `${path}.radius`) };
    case 'parallel': case 'curve-type': return predicate;
    default: { const exhaustive: never = predicate; return exhaustive; }
  }
}
function mapFacePredicate(predicate: CadFacePredicate, path: string, map: CadScalarMapper): CadFacePredicate {
  switch (predicate.kind) {
    case 'plane': return { ...predicate, offset: map(predicate.offset, `${path}.offset`) };
    case 'centroid': return { ...predicate, point: mapCadPoint3(predicate.point, `${path}.point`, map) };
    case 'cylinder': return { ...predicate, origin: mapCadPoint3(predicate.origin, `${path}.origin`, map), radius: map(predicate.radius, `${path}.radius`) };
    case 'area': case 'surface-type': return predicate;
    default: { const exhaustive: never = predicate; return exhaustive; }
  }
}
/** An edge selection's query values. */
export function mapCadEdgeSelectionScalars(selection: CadEdgeSelection, path: string, map: CadScalarMapper): CadEdgeSelection {
  return { ...selection, queries: selection.queries.map((query, index) => ({ ...query,
    predicates: query.predicates.map((predicate, predicateIndex) => mapEdgePredicate(predicate, `${path}.queries.${index}.predicates.${predicateIndex}`, map)) })) };
}
/** A face query's predicate values. */
export function mapCadFaceQueryScalars(query: CadFaceQuery, path: string, map: CadScalarMapper): CadFaceQuery {
  return { ...query, predicates: query.predicates.map((predicate, index) => mapFacePredicate(predicate, `${path}.predicates.${index}`, map)) };
}

// What each number of those stored values measures, by its path below the value (see CadFeatureQuantityPath). Each maps the scalars
// above, and also names the plain numbers a value holds: directions, areas, counts, places in a list and dimension placements.

/** `paths` below `prefix`. */
export function cadQuantitiesUnder(prefix: string, paths: readonly CadFeatureQuantityPath[]): readonly CadFeatureQuantityPath[] {
  return paths.map(({ path, quantity }) => ({ path: !path ? prefix : path.startsWith('{') ? prefix + path : `${prefix}.${path}`, quantity }));
}
const each = (quantity: CadFeatureNestedQuantity, ...paths: readonly string[]) => paths.map(path => ({ path, quantity }));
export const CAD_PATH_SEGMENT_QUANTITIES: readonly CadFeatureQuantityPath[] = [
  ...each('length', '{line}.start.*', '{line}.end.*', '{arc}.center.*', '{arc}.radius'), ...each('angle', '{arc}.startAngle', '{arc}.sweep')];
/** A sketch profile's geometry; a plugin's inputs measure what its pinned package declares. */
export const CAD_PROFILE_QUANTITIES: readonly CadFeatureQuantityPath[] = [
  ...each('length', '{rectangle}.x', '{rectangle}.y', '{rectangle}.width', '{rectangle}.height', '{rectangle}.cornerRadius', '{circle}.x', '{circle}.y',
    '{circle}.radius', '{slot}.x', '{slot}.y', '{slot}.length', '{slot}.width', '{polygon}.points.*.*'),
  ...each('angle', '{slot}.angle'), ...cadQuantitiesUnder('{path}.segments.*', CAD_PATH_SEGMENT_QUANTITIES), ...each('plugin', '{plugin}.inputs.*')];
/**
 * A sketch graph's point positions, circle radii and relation values, each relation's as its definition declares, a linear pattern's
 * count and omitted instances, and where each dimension is drawn: offsets, radii and distances, fractions along, and a leader's
 * direction in radians.
 */
export function cadSketchGraphQuantities(): readonly CadFeatureQuantityPath[] {
  return [...each('length', 'points.*.position.*', 'entities.*{circle}.radius'),
    ...Object.values(CAD_SKETCH_RELATION_DEFINITIONS).flatMap(({ kind, scalars }) =>
      scalars ? scalars.keys.map(key => ({ path: `relations.*{${kind}}.${key}`, quantity: scalars.quantity[key] })) : []),
    ...each('count', 'relations.*{linear-pattern}.count'), ...each('index', 'relations.*{linear-pattern}.omittedInstances.*'),
    ...each('length', 'relations.*.annotation{linear}.offset', 'relations.*.annotation{angle}.radius', 'relations.*.annotation{radial}.distance',
      'relations.*.annotation{setbacks}.sides.*.offset'),
    ...each('ratio', 'relations.*.annotation{linear}.along', 'relations.*.annotation{angle}.along', 'relations.*.annotation{setbacks}.sides.*.along'),
    ...each('radians', 'relations.*.annotation{radial}.angle')];
}
/** An edge selection: its queries' predicates, a direction's components, and the edges each query and the selection expect. */
export const CAD_EDGE_SELECTION_QUANTITIES: readonly CadFeatureQuantityPath[] = [
  ...cadQuantitiesUnder('queries.*.predicates.*', [
    ...each('length', '{length}.value', '{on-plane}.offset', '{line-endpoints}.start.*', '{line-endpoints}.end.*', '{circle}.center.*', '{circle}.radius',
      '{arc-points}.start.*', '{arc-points}.end.*', '{arc-points}.midpoint.*'),
    ...each('ratio', '{on-plane}.normal.*', '{parallel}.direction.*', '{circle}.axis.*')]),
  ...each('count', 'queries.*.expectedCount', 'expectedCount')];
/** A face query: its predicates, a direction's components, and the faces it expects. */
export const CAD_FACE_QUERY_QUANTITIES: readonly CadFeatureQuantityPath[] = [
  ...cadQuantitiesUnder('predicates.*', [
    ...each('length', '{plane}.offset', '{centroid}.point.*', '{cylinder}.origin.*', '{cylinder}.radius'), ...each('area', '{area}.value'),
    ...each('ratio', '{plane}.normal.*', '{cylinder}.axis.*')]),
  ...each('count', 'expectedCount')];
