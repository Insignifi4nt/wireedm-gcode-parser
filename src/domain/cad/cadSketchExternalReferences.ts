import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadDocument, CadFeature, CadSketchFeature } from './cadDocument';
import { CadIdentifierSchema } from './cadPrimitives';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { isCadImportData } from './cadImportData';
import { parseCadSketchGraph, type CadSketchExternalReference, type CadSketchGraph } from './cadSketchGraph';
import { cadSketchEntityPointIds } from './cadSketchGraphReferences';
import type { CadSketchGraphSelection } from './cadSketchGraphSelection';
import { appendCadSketchEntities } from './cadSketchGraphEdits';

export const CadSketchUseEntityRequestSchema = Type.Object({ sketchId: CadIdentifierSchema, sourceSketchId: CadIdentifierSchema,
  sourceEntityId: CadIdentifierSchema, idPrefix: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' }) }, { additionalProperties: false });
export type CadSketchUseEntityRequest = Readonly<Static<typeof CadSketchUseEntityRequestSchema>>;
type Context = { readonly sketch: CadSketchFeature; readonly parameters: Readonly<Record<string, number>>; readonly previous: ReadonlyMap<string, CadFeature> };
const invalid = (message: string): never => { throw new CadError('invalid-sketch-reference', message); };
const unavailable = (message: string): never => { throw new CadError('unavailable-sketch-reference', message); };
function freezeData(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freezeData(child);
  Object.freeze(value);
}
function readonlyIds(ids: readonly string[]): ReadonlySet<string> {
  const values = new Set(ids);
  const result: ReadonlySet<string> = Object.freeze({ size: values.size, has: (id: string) => values.has(id),
    entries: () => values.entries(), keys: () => values.keys(), values: () => values.values(), [Symbol.iterator]: () => values.values(),
    forEach: (callback: (value: string, key: string, set: ReadonlySet<string>) => void, thisArg?: unknown) => values.forEach(value => callback.call(thisArg, value, value, result)) });
  return result;
}
export function cadSketchExternalReferenceForSelection(graph: CadSketchGraph, selection: CadSketchGraphSelection): CadSketchExternalReference | undefined {
  for (const relation of graph.relations) if (relation.kind === 'external-reference' && (selection.kind === 'entity' ? relation.entityId === selection.id
    : graph.entities.some(entity => entity.id === relation.entityId && cadSketchEntityPointIds(entity).includes(selection.id)))) return relation;
}
export function cadSketchExternalReferenceLockReason(graph: CadSketchGraph, selection: CadSketchGraphSelection): string | null {
  return cadSketchExternalReferenceForSelection(graph, selection) ? 'Geometry follows a preceding sketch. Detach its reference before editing it.' : null;
}
/** Local ownership only; source identities are qualified by the document-level resolver. */
export function cadSketchExternalReferenceComponents(graph: CadSketchGraph): { readonly pointIds: ReadonlySet<string>; readonly circleIds: ReadonlySet<string> } {
  const entities = graph.relations.filter(relation => relation.kind === 'external-reference').map(relation => graph.entities.find(entity => entity.id === relation.entityId));
  return Object.freeze({ pointIds: readonlyIds(entities.flatMap(entity => entity ? cadSketchEntityPointIds(entity) : [])),
    circleIds: readonlyIds(entities.flatMap(entity => entity?.kind === 'circle' ? [entity.id] : [])) });
}
export function validateCadSketchExternalReference(graph: CadSketchGraph, reference: CadSketchExternalReference): void {
  const entity = graph.entities.find(entity => entity.id === reference.entityId);
  if (!entity || entity.kind !== reference.source.kind || !entity.construction)
    return invalid('An external reference must own a matching construction line or circle.');
  if (graph.relations.filter(relation => relation.kind === 'external-reference' && relation.entityId === entity.id).length !== 1)
    return invalid('An entity can have only one external reference owner.');
  const ids = cadSketchEntityPointIds(entity);
  if (ids.some(id => graph.points.find(point => point.id === id)?.position.some(value => typeof value !== 'number'))
    || entity.kind === 'circle' && typeof entity.radius !== 'number') return invalid('Reference supports are numeric evaluated snapshots. Detach before adding expression drivers.');
  if (reference.source.kind === 'line' && reference.source.startPointId === reference.source.endPointId)
    return invalid('A reference line needs two distinct source endpoint identities.');
  if (graph.entities.some(other => other.id !== entity.id && cadSketchEntityPointIds(other).some(id => ids.includes(id))))
    return invalid('Reference supports must have dedicated local point identities. Use an explicit relation to other geometry.');
  if (graph.relations.some(relation => (relation.kind === 'fixed-point' || relation.kind === 'fixed-axis') && ids.includes(relation.pointId)
    || relation.kind === 'radial-size' && relation.entityId === entity.id))
    return invalid('Reference geometry is driven by its source. Detach before adding a position or radius driver.');
}

function sourceFor({ sketch, parameters, previous }: Context, sourceSketchId: string): CadSketchFeature {
  const source = previous.get(sourceSketchId);
  if (source?.kind !== 'sketch' || source.id === sketch.id || !source.graph)
    return unavailable(`Sketch "${sketch.name}" needs an existing preceding graph sketch "${sourceSketchId}".`);
  if (!sketch.suppressed && source.suppressed) return unavailable(`Sketch "${sketch.name}" references suppressed sketch "${source.name}". Resume it or detach the reference.`);
  if (!Value.Equal(sketch.plane, source.plane)) return unavailable(`Sketch "${sketch.name}" must share its reference source's declared base plane or datum identity.`);
  // Shared base axes make normal-offset projection an exact local X/Y copy.
  evaluateCadScalar(sketch.offset, parameters); evaluateCadScalar(source.offset, parameters);
  return source;
}
function snapshots(context: Context) {
  const graph = context.sketch.graph, points = new Map<string, readonly [number, number]>(), circles = new Map<string, number>();
  if (!graph) return { points, circles };
  for (const reference of graph.relations) {
    if (reference.kind !== 'external-reference') continue;
    validateCadSketchExternalReference(graph, reference);
    const source = sourceFor(context, reference.sourceSketchId), entity = source.graph?.entities.find(entity => entity.id === reference.source.entityId);
    const target = graph.entities.find(entity => entity.id === reference.entityId);
    if (!entity || !target || entity.kind !== reference.source.kind || target.kind !== entity.kind
      || entity.kind === 'line' && reference.source.kind === 'line' && (entity.startPointId !== reference.source.startPointId || entity.endPointId !== reference.source.endPointId)
      || entity.kind === 'circle' && reference.source.kind === 'circle' && entity.centerPointId !== reference.source.centerPointId)
      throw new CadError('changed-sketch-reference', `The source topology for a reference in "${context.sketch.name}" changed. Detach or explicitly replace the reference.`);
    const sourcePoints = cadSketchEntityPointIds(entity), targetPoints = cadSketchEntityPointIds(target);
    sourcePoints.forEach((id, index) => {
      const point = source.graph?.points.find(point => point.id === id);
      if (!point) return unavailable('A referenced source support point is missing.');
      points.set(targetPoints[index], [evaluateCadScalar(point.position[0], context.parameters), evaluateCadScalar(point.position[1], context.parameters)]);
    });
    if (entity.kind === 'circle') circles.set(target.id, evaluateCadScalar(entity.radius, context.parameters));
  }
  return { points, circles };
}
/** Refresh only derived numeric snapshots from an already solved preceding prefix. Never parses a document. */
export function refreshCadSketchExternalReferences(context: Context): CadSketchFeature {
  const { sketch } = context;
  if (!sketch.graph?.relations.some(relation => relation.kind === 'external-reference')) return sketch;
  const { points, circles } = snapshots(context);
  const graph = parseCadSketchGraph({ ...sketch.graph, points: sketch.graph.points.map(point => points.has(point.id) ? { ...point, position: points.get(point.id) } : point),
    entities: sketch.graph.entities.map(entity => entity.kind === 'circle' && circles.has(entity.id) ? { ...entity, radius: circles.get(entity.id) } : entity) });
  const result = { ...structuredClone(sketch), graph }; freezeData(result); return result;
}
/** Strict accepted-cache authority, including suppressed targets. No stale fallback. */
export function assertCadSketchExternalReferences(context: Context): void {
  const { points, circles } = snapshots(context), graph = context.sketch.graph;
  if (graph?.points.some(point => points.has(point.id) && !Value.Equal(point.position, points.get(point.id)))
    || graph?.entities.some(entity => entity.kind === 'circle' && circles.has(entity.id) && entity.radius !== circles.get(entity.id)))
    throw new CadError('stale-sketch-reference', `Reference geometry in "${context.sketch.name}" does not match its current source. Prepare the source edit before accepting it.`);
}
export function cadSketchReferenceSources(document: CadDocument, targetSketchId: string): readonly CadSketchFeature[] {
  const index = document.features.findIndex(feature => feature.id === targetSketchId), target = document.features[index];
  if (target?.kind !== 'sketch' || target.suppressed) return Object.freeze([]);
  return Object.freeze(document.features.slice(0, index).filter((feature): feature is CadSketchFeature => feature.kind === 'sketch' && !feature.suppressed
    && Value.Equal(feature.plane, target.plane) && Boolean(feature.graph?.entities.some(entity => entity.kind === 'line' || entity.kind === 'circle'))));
}
export function prepareCadSketchUseEntity({ sketch, parameters, previous, ...request }: Context & CadSketchUseEntityRequest) {
  if (!isCadImportData(request) || !Value.Check(CadSketchUseEntityRequestSchema, request) || request.sketchId !== sketch.id || sketch.suppressed)
    return invalid('Use reference needs an active target sketch, a preceding graph entity and an identifier prefix of at most 64 characters.');
  const context = { sketch, parameters, previous }, source = sourceFor(context, request.sourceSketchId), entity = source.graph?.entities.find(entity => entity.id === request.sourceEntityId);
  if (!entity || entity.kind === 'arc') return unavailable('Choose a line or circle in the preceding source sketch.');
  const { idPrefix } = request, entityId = `${idPrefix}_e0`, referenceId = `${idPrefix}_reference`;
  const sourceIds = cadSketchEntityPointIds(entity), points = sourceIds.map((id, index) => {
    const point = source.graph?.points.find(point => point.id === id);
    if (!point) return unavailable('A reference source point no longer exists.');
    return { id: entity.kind === 'circle' ? `${idPrefix}_c0` : `${idPrefix}_p${index}`,
      position: [evaluateCadScalar(point.position[0], parameters), evaluateCadScalar(point.position[1], parameters)] };
  });
  const reference: CadSketchExternalReference = { id: referenceId, kind: 'external-reference', entityId, sourceSketchId: source.id,
    source: entity.kind === 'line' ? { kind: 'line', entityId: entity.id, startPointId: entity.startPointId, endPointId: entity.endPointId }
      : { kind: 'circle', entityId: entity.id, centerPointId: entity.centerPointId } };
  const addition = parseCadSketchGraph({ points, relations: [reference], entities: [entity.kind === 'line'
    ? { id: entityId, kind: 'line', construction: true, startPointId: points[0].id, endPointId: points[1].id }
    : { id: entityId, kind: 'circle', construction: true, centerPointId: points[0].id, radius: evaluateCadScalar(entity.radius, parameters) }] });
  const result = { sketch: appendCadSketchEntities({ sketch: structuredClone(sketch), geometry: addition }), referenceId, entityId };
  assertCadSketchExternalReferences({ ...context, sketch: result.sketch }); freezeData(result); return result;
}
