import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadIdentifierSchema } from './cadPrimitives';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import { parseCadSketchGraph, type CadSketchGraph } from './cadSketchGraph';
import { compileCadSketchGraph } from './cadSketchGraphGeometry';
import { cadSketchRelationEntityIds } from './cadSketchGraphReferences';
import { cadPathClosureTolerance } from './cadAnalyticSegments';
import { pointOnArcAtParameter } from '@/domain/path-intel/segments';

const fields = { entityId: CadIdentifierSchema, parameter: Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1 }),
  splitPointId: CadIdentifierSchema, newEntityId: CadIdentifierSchema };
export const CadSketchSplitTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('line'), ...fields, supportRelationId: CadIdentifierSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('arc'), ...fields }, { additionalProperties: false })
]);
type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
export type CadSketchSplitTarget = Immutable<Static<typeof CadSketchSplitTargetSchema>>;
export interface CadSketchSplitResult {
  readonly graph: CadSketchGraph;
  readonly retainedEntityId: string;
  readonly newEntityId: string;
  readonly splitPointId: string;
}

export class CadSketchSplitDependencyError extends CadError {
  readonly relationIds: readonly string[];
  constructor(relationIds: readonly string[]) {
    super('dependent-sketch-split', 'Remove or recreate the relations that reference this whole edge before splitting it.');
    this.relationIds = Object.freeze([...relationIds]);
  }
}

/** One source-oriented cut, with no coordinate welding or whole-entity relation transfer. */
export function splitCadSketchEntity({ graph: input, parameters, split }: {
  readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>; readonly split: CadSketchSplitTarget;
}): CadSketchSplitResult {
  if (!isCadImportData(split) || !Value.Check(CadSketchSplitTargetSchema, split))
    throw new CadError('invalid-sketch-split', 'Choose a line or open arc and a finite split parameter strictly between zero and one.');
  const graph = parseCadSketchGraph(input), entity = graph.entities.find(item => item.id === split.entityId);
  if (!entity || entity.kind !== split.kind) throw new CadError('invalid-sketch-split-target', 'The split source must remain the requested line or open arc.');
  const blockers = graph.relations.filter(relation => relation.kind !== 'reference-dimension' && cadSketchRelationEntityIds(relation).includes(entity.id));
  if (blockers.length) throw new CadSketchSplitDependencyError(blockers.map(relation => relation.id));
  const geometry = compileCadSketchGraph(graph, parameters), segment = geometry.segments.find(item => item.id === entity.id);
  if (!segment || segment.kind === 'circle') throw new CadError('invalid-sketch-split-target', 'This split source is not supported.');
  const point = segment.kind === 'line' ? { x: segment.start.x + (segment.end.x - segment.start.x) * split.parameter,
    y: segment.start.y + (segment.end.y - segment.start.y) * split.parameter }
    : pointOnArcAtParameter(segment, { segmentId: entity.id, reversed: false }, split.parameter);
  const minimum = Math.max(1e-7, cadPathClosureTolerance([segment.start, point, segment.end]));
  if (Math.hypot(point.x - segment.start.x, point.y - segment.start.y) <= minimum
    || Math.hypot(segment.end.x - point.x, segment.end.y - point.y) <= minimum)
    throw new CadError('sketch-split-precision', 'The cut must leave two representable nondegenerate pieces.');
  const retained = { ...entity, endPointId: split.splitPointId }, second = { ...entity, id: split.newEntityId, startPointId: split.splitPointId };
  const candidate = parseCadSketchGraph({ points: [...graph.points, { id: split.splitPointId, position: [point.x, point.y] }],
    entities: graph.entities.flatMap(item => item.id === entity.id ? [retained, second] : [item]),
    relations: split.kind === 'line' ? [...graph.relations, { id: split.supportRelationId, kind: 'parallel', lineIds: [entity.id, split.newEntityId] }] : graph.relations });
  const compiled = compileCadSketchGraph(candidate, parameters);
  if (segment.kind === 'arc') {
    const first = compiled.segments.find(item => item.id === entity.id), second = compiled.segments.find(item => item.id === split.newEntityId);
    if (!first || !second || first.kind !== 'arc' || second.kind !== 'arc') throw new CadError('invalid-sketch-split-target', 'The split must retain two endpoint arcs.');
    const tolerance = cadPathClosureTolerance([segment.start, segment.end, segment.center, point]);
    const expected = [segment.sweepRadians * split.parameter, segment.sweepRadians * (1 - split.parameter)];
    const sweeps = [first.sweepRadians, second.sweepRadians];
    const deltas = [sweeps[0] - expected[0], sweeps[1] - expected[1], sweeps[0] + sweeps[1] - segment.sweepRadians];
    if (deltas.some(delta => Math.abs(delta) >= Math.PI || Math.abs(delta) * segment.radius > tolerance)
      || sweeps.some((sweep, index) => Math.sign(Math.abs(sweep) - Math.PI) !== Math.sign(Math.abs(expected[index]) - Math.PI)))
      throw new CadError('sketch-split-precision', 'The cut cannot preserve the original signed arc coverage at these coordinates.');
  }
  return Object.freeze({ graph: candidate, retainedEntityId: entity.id, newEntityId: split.newEntityId, splitPointId: split.splitPointId });
}
