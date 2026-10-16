import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadIdentifierSchema, CadPoint2Schema, CadScalarSchema } from './cadPrimitives';
import { isCadImportData } from './cadImportData';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { cadPathClosureTolerance } from './cadAnalyticSegments';
import type { Point2 } from '@/domain/path-intel/types';
import { cadSketchEntityPointIds, cadSketchRelationPointIds } from './cadSketchGraphReferences';
import { checkCadSketchCornerRelation, resolveCadSketchCornerTopology } from './cadSketchCornerGeometry';
import { checkCadSketchLineRelation, resolveCadSketchLinePair } from './cadSketchLineRelations';

const strict = { additionalProperties: false };
const id = CadIdentifierSchema, pair = Type.Tuple([id, id]);
const entity = { id, construction: Type.Boolean() };
export const CadSketchGraphSchema = Type.Object({
  points: Type.Array(Type.Object({ id, position: CadPoint2Schema }, strict)),
  entities: Type.Array(Type.Union([
    Type.Object({ ...entity, kind: Type.Literal('line'), startPointId: id, endPointId: id }, strict),
    Type.Object({ ...entity, kind: Type.Literal('arc'), centerPointId: id, startPointId: id, endPointId: id,
      direction: Type.Union([Type.Literal('cw'), Type.Literal('ccw')]) }, strict),
    Type.Object({ ...entity, kind: Type.Literal('circle'), centerPointId: id, radius: CadScalarSchema }, strict)
  ])),
  relations: Type.Array(Type.Union([
    ...(['coincident', 'horizontal', 'vertical'] as const).map(kind => Type.Object({ id, kind: Type.Literal(kind), pointIds: pair }, strict)),
    Type.Object({ id, kind: Type.Literal('parallel'), lineIds: pair }, strict),
    Type.Object({ id, kind: Type.Literal('perpendicular'), lineIds: pair }, strict),
    Type.Object({ id, kind: Type.Literal('fixed-point'), pointId: id, position: CadPoint2Schema }, strict),
    Type.Object({ id, kind: Type.Literal('fixed-axis'), pointId: id, axis: Type.Union([Type.Literal('x'), Type.Literal('y')]), value: CadScalarSchema }, strict),
    Type.Object({ id, kind: Type.Literal('distance'), pointIds: pair, value: CadScalarSchema }, strict),
    Type.Object({ id, kind: Type.Literal('fillet-corner'), pointId: id, lineIds: pair, arcId: id, value: CadScalarSchema }, strict),
    Type.Object({ id, kind: Type.Literal('chamfer-corner'), pointId: id, lineIds: pair, chamferId: id, values: Type.Tuple([CadScalarSchema, CadScalarSchema]) }, strict)
  ]))
}, strict);
type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
export type CadSketchGraph = Immutable<Static<typeof CadSketchGraphSchema>>;
export type CadSketchGraphPoint = CadSketchGraph['points'][number];
export type CadSketchGraphEntity = CadSketchGraph['entities'][number];
export type CadSketchGraphRelation = CadSketchGraph['relations'][number];
export type CadSketchCornerRelation = Extract<CadSketchGraphRelation, { kind: 'fillet-corner' | 'chamfer-corner' }>;
export type CadSketchLineRelation = Extract<CadSketchGraphRelation, { kind: 'parallel' | 'perpendicular' }>;
const issueCodes = ['invalid-expression', 'invalid-coordinate', 'degenerate-entity', 'invalid-radius', 'arc-radius-mismatch', 'invalid-distance', 'relation-residual'] as const;
export const CadSketchGraphIssueSchema = Type.Object({
  source: Type.Object({ kind: Type.Union([Type.Literal('point'), Type.Literal('entity'), Type.Literal('relation')]), id }, strict),
  code: Type.Union(issueCodes.map(code => Type.Literal(code))),
  message: Type.String(), residualMm: Type.Optional(Type.Number({ minimum: 0 }))
}, strict);
export type CadSketchGraphIssue = Immutable<Static<typeof CadSketchGraphIssueSchema>>;

function freezeData(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freezeData(child);
  Object.freeze(value);
}

/** Parse unsolved intent without solving, changing scalars, or checking geometric residuals. */
export function parseCadSketchGraph(value: unknown): CadSketchGraph {
  if (!isCadImportData(value) || !Value.Check(CadSketchGraphSchema, value)) throw new CadError('invalid-sketch-graph', 'Sketch graph must contain complete portable point, entity and relation data.');
  const graph = structuredClone(value), ids = new Set<string>(), points = new Set(graph.points.map(point => point.id));
  for (const item of [...graph.points, ...graph.entities, ...graph.relations]) {
    if (ids.has(item.id)) throw new CadError('duplicate-sketch-id', `Duplicate sketch graph identity "${item.id}".`);
    ids.add(item.id);
  }
  const references = (owner: string, refs: readonly string[]) => {
    if (new Set(refs).size !== refs.length) throw new CadError('invalid-sketch-reference', `Sketch graph "${owner}" needs distinct point references.`);
    for (const ref of refs) if (!points.has(ref)) throw new CadError('missing-sketch-point', `Sketch graph "${owner}" references missing point "${ref}".`);
  };
  for (const item of graph.entities) references(item.id, cadSketchEntityPointIds(item));
  for (const item of graph.relations) {
    if (item.kind === 'fillet-corner' || item.kind === 'chamfer-corner') resolveCadSketchCornerTopology(graph, item);
    if (item.kind === 'parallel' || item.kind === 'perpendicular') resolveCadSketchLinePair(graph, item.lineIds);
    references(item.id, cadSketchRelationPointIds(graph, item));
  }
  freezeData(graph);
  return graph;
}

/** Nonrepairing acceptance check. Empty issues means current numeric geometry and relations agree. */
export function checkCadSketchGraph(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>): readonly CadSketchGraphIssue[] {
  const issues: CadSketchGraphIssue[] = [], points = new Map<string, Point2>();
  const scalar = (value: number | string) => evaluateCadScalar(value, parameters);
  const report = (source: CadSketchGraphIssue['source'], code: CadSketchGraphIssue['code'], message: string, residualMm?: number) => {
    issues.push({ source, code, message, ...(residualMm === undefined ? {} : { residualMm }) });
  };
  for (const point of graph.points) {
    const source = { kind: 'point', id: point.id } as const;
    try {
      const x = scalar(point.position[0]), y = scalar(point.position[1]);
      if (Math.abs(x) > 1e9 || Math.abs(y) > 1e9) report(source, 'invalid-coordinate', 'Sketch point exceeds the supported coordinate range.');
      else points.set(point.id, { x, y });
    } catch (error) { report(source, 'invalid-expression', error instanceof Error ? error.message : 'Invalid point expression.'); }
  }
  for (const item of graph.entities) {
    const source = { kind: 'entity', id: item.id } as const;
    try {
      if (item.kind === 'circle') {
        const radius = scalar(item.radius);
        if (radius <= 1e-7 || radius > 1e6) report(source, 'invalid-radius', 'Circle radius must be positive and within one million millimetres.');
        continue;
      }
      const start = points.get(item.startPointId), end = points.get(item.endPointId);
      if (!start || !end) continue;
      if (Math.hypot(start.x - end.x, start.y - end.y) <= 1e-7) {
        report(source, 'degenerate-entity', 'A line or endpoint arc needs distinct endpoints; use a circle for a full turn.'); continue;
      }
      if (item.kind === 'arc') {
        const center = points.get(item.centerPointId); if (!center) continue;
        const radius = Math.hypot(start.x - center.x, start.y - center.y), other = Math.hypot(end.x - center.x, end.y - center.y);
        if (radius <= 1e-7 || radius > 1e6) report(source, 'invalid-radius', 'Arc radius must be positive and within one million millimetres.');
        const residual = Math.abs(radius - other);
        if (residual > cadPathClosureTolerance([center, start, end])) report(source, 'arc-radius-mismatch', 'Arc endpoints must share their declared center and radius.', residual);
      }
    } catch (error) { report(source, 'invalid-expression', error instanceof Error ? error.message : 'Invalid entity expression.'); }
  }
  for (const relation of graph.relations) {
    const source = { kind: 'relation', id: relation.id } as const;
    try {
      if (relation.kind === 'parallel' || relation.kind === 'perpendicular') {
        issues.push(...checkCadSketchLineRelation(graph, relation, points)); continue;
      }
      if (relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner') {
        issues.push(...checkCadSketchCornerRelation(graph, relation, points, parameters)); continue;
      }
      let residual: number, operands: Point2[];
      if ('pointIds' in relation) {
        const a = points.get(relation.pointIds[0]), b = points.get(relation.pointIds[1]); if (!a || !b) continue;
        operands = [a, b];
        switch (relation.kind) {
          case 'coincident': residual = Math.hypot(a.x - b.x, a.y - b.y); break;
          case 'horizontal': residual = Math.abs(a.y - b.y); break;
          case 'vertical': residual = Math.abs(a.x - b.x); break;
          case 'distance': {
            const value = scalar(relation.value);
            if (value < 0) { report(source, 'invalid-distance', 'Point distance must not be negative.'); continue; }
            residual = Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - value); break;
          }
          default: { const exhaustive: never = relation; throw exhaustive; }
        }
      } else {
        const point = points.get(relation.pointId); if (!point) continue;
        const target = relation.kind === 'fixed-point' ? { x: scalar(relation.position[0]), y: scalar(relation.position[1]) }
          : { ...point, [relation.axis]: scalar(relation.value) };
        operands = [point, target]; residual = Math.hypot(point.x - target.x, point.y - target.y);
      }
      if (residual > cadPathClosureTolerance(operands)) report(source, 'relation-residual', 'Sketch geometry does not satisfy its driving relation.', residual);
    } catch (error) { report(source, 'invalid-expression', error instanceof Error ? error.message : 'Invalid relation expression.'); }
  }
  freezeData(issues);
  return issues;
}
