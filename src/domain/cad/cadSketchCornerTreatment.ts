import type { CadScalar } from './cadDocument';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphEntity, type CadSketchGraphPoint, type CadSketchCornerRelation } from './cadSketchGraph';
import { cadSketchCornerFrame } from './cadSketchCornerGeometry';
import { compileCadSketchGraph } from './cadSketchGraphGeometry';
import { evaluateCadScalar } from './cadExpression';
import { CadError } from './cadError';
import type { Point2 } from '@/domain/path-intel/types';
import { Type, type Static } from '@sinclair/typebox';
import { CadIdentifierSchema, CadScalarSchema } from './cadPrimitives';

const commandIds = { trimPointIds: Type.Tuple([CadIdentifierSchema, CadIdentifierSchema]), entityId: CadIdentifierSchema, relationId: CadIdentifierSchema };
export const CadSketchCornerCommandTreatmentSchema = Type.Union([
  Type.Object({ kind: Type.Literal('fillet'), radius: CadScalarSchema, ...commandIds, centerPointId: CadIdentifierSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('chamfer'), setbacks: Type.Tuple([CadScalarSchema, CadScalarSchema]), ...commandIds }, { additionalProperties: false })
]);
type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
export type CadSketchCornerCommandTreatment = Immutable<Static<typeof CadSketchCornerCommandTreatmentSchema>>;

/** Named portable command identities map only here to the builder's point/entity/relation allocation. */
export function createCadSketchCornerTreatmentFromIds(input: { readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>;
  readonly pointId: string; readonly treatment: CadSketchCornerCommandTreatment }) {
  const treatment = input.treatment;
  const ids = [...treatment.trimPointIds, ...(treatment.kind === 'fillet' ? [treatment.centerPointId] : []), treatment.entityId, treatment.relationId];
  let index = 0;
  return createCadSketchCornerTreatment({ ...input, createId: () => {
    const id = ids[index++]; if (id === undefined) throw new Error('Corner identity allocation is incomplete.'); return id;
  } });
}

/** The same target guards used by construction, without allocating identities or assuming a size. */
export function inspectCadSketchCornerTarget(input: CadSketchGraph, pointId: string, parameters: Readonly<Record<string, number>>) {
  const graph = parseCadSketchGraph(input), geometry = compileCadSketchGraph(graph, parameters);
  const incident = graph.entities.filter(entity => entity.kind !== 'circle' && (entity.startPointId === pointId || entity.endPointId === pointId))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (incident.length !== 2 || incident[0].kind !== 'line' || incident[1].kind !== 'line' || incident.some(entity => entity.construction))
    throw new CadError('unsupported-sketch-corner', 'Choose a shared vertex of exactly two nonconstruction lines.');
  const lines = [incident[0], incident[1]] as const;
  if (geometry.arrangementEntityIds.some(id => lines.some(line => line.id === id))) throw new CadError('unsupported-sketch-corner', 'Intersecting or overlapping supports need an explicit unambiguous corner.');
  function position(id: string): Point2 {
    const point = graph.points.find(point => point.id === id);
    if (!point) throw new CadError('missing-sketch-point', 'The selected corner point no longer exists.');
    return { x: evaluateCadScalar(point.position[0], parameters), y: evaluateCadScalar(point.position[1], parameters) };
  }
  const vertex = position(pointId), a = position(lines[0].startPointId === pointId ? lines[0].endPointId : lines[0].startPointId);
  const b = position(lines[1].startPointId === pointId ? lines[1].endPointId : lines[1].startPointId), frame = cadSketchCornerFrame(vertex, a, b);
  return Object.freeze({ graph, lines, vertex, a, b, frame });
}

export function createCadSketchCornerTreatment({ graph: input, parameters, pointId, treatment, createId }: { readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>;
  readonly pointId: string; readonly treatment: { readonly kind: 'fillet'; readonly radius: CadScalar } | { readonly kind: 'chamfer'; readonly setbacks: readonly [CadScalar, CadScalar] };
  readonly createId: () => string }): { readonly graph: CadSketchGraph; readonly relationId: string; readonly entityId: string } {
  const { graph, lines, vertex, frame } = inspectCadSketchCornerTarget(input, pointId, parameters);
  const points: CadSketchGraphPoint[] = [...graph.points];
  function point(x: number, y: number) { const value = { id: createId(), position: [x, y] as const }; points.push(value); return value.id; }
  const values = treatment.kind === 'fillet' ? [evaluateCadScalar(treatment.radius, parameters)]
    : treatment.setbacks.map(value => evaluateCadScalar(value, parameters));
  if (values.some(value => !(value > 1e-7 && value <= 1e6))) throw new CadError('invalid-corner-dimension', 'Corner dimensions must be positive and within one million millimetres.');
  const da = treatment.kind === 'fillet' ? values[0] / Math.tan(frame.angle / 2) : values[0];
  const db = treatment.kind === 'fillet' ? da : values[1];
  if (frame.lengthA - da <= 1e-7 || frame.lengthB - db <= 1e-7) throw new CadError('invalid-corner-dimension', 'The corner treatment must leave a positive segment on both lines.');
  const p = point(vertex.x + da * frame.u.x, vertex.y + da * frame.u.y), q = point(vertex.x + db * frame.v.x, vertex.y + db * frame.v.y);
  let entity: CadSketchGraphEntity, relation: CadSketchCornerRelation;
  if (treatment.kind === 'fillet') {
    const bx = frame.u.x + frame.v.x, by = frame.u.y + frame.v.y, factor = values[0] / Math.sin(frame.angle / 2) / Math.hypot(bx, by);
    const centerPointId = point(vertex.x + bx * factor, vertex.y + by * factor);
    entity = { id: createId(), kind: 'arc', construction: false, centerPointId, startPointId: p, endPointId: q, direction: frame.cross > 0 ? 'cw' : 'ccw' };
    relation = { id: createId(), kind: 'fillet-corner', pointId, lineIds: [lines[0].id, lines[1].id], arcId: entity.id, value: treatment.radius };
  } else {
    entity = { id: createId(), kind: 'line', construction: false, startPointId: p, endPointId: q };
    relation = { id: createId(), kind: 'chamfer-corner', pointId, lineIds: [lines[0].id, lines[1].id], chamferId: entity.id, values: treatment.setbacks };
  }
  const entities = graph.entities.map(item => {
    const trim = item.id === lines[0].id ? p : item.id === lines[1].id ? q : null;
    return trim && item.kind === 'line' ? { ...item, startPointId: item.startPointId === pointId ? trim : item.startPointId,
      endPointId: item.endPointId === pointId ? trim : item.endPointId } : item;
  });
  const candidate = parseCadSketchGraph({ points, entities: [...entities, entity], relations: [...graph.relations, relation] });
  const issue = checkCadSketchGraph(candidate, parameters)[0];
  if (issue) throw new CadError('invalid-corner-geometry', issue.message);
  const changed = new Set([...relation.lineIds, entity.id]);
  if (compileCadSketchGraph(candidate, parameters).arrangementEntityIds.some(id => changed.has(id)))
    throw new CadError('corner-intersection', 'The corner treatment intersects or overlaps other sketch geometry.');
  return Object.freeze({ graph: candidate, relationId: relation.id, entityId: entity.id });
}
