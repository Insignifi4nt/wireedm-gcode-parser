import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadSketchGraphIssueSchema, CadSketchGraphSchema, checkCadSketchGraph, parseCadSketchGraph } from '../../../domain/cad/cadSketchGraph';
import { CadIdentifierSchema, CadNumberSchema } from '../../../domain/cad/cadPrimitives';
import { isCadImportData } from '../../../domain/cad/cadImportData';
import { cadSketchExternalReferenceComponents } from '../../../domain/cad/cadSketchExternalReferences';
import type { CadSketchSolveDiagnostics, CadSketchSolveInput, CadSketchSolveResult } from './cadSketchSolverTypes';

const inputSchema = Type.Object({ graph: CadSketchGraphSchema, parameters: Type.Record(Type.String(), CadNumberSchema),
  drag: Type.Optional(Type.Object({ pointId: CadIdentifierSchema, position: Type.Tuple([CadNumberSchema, CadNumberSchema]) }, { additionalProperties: false }))
}, { additionalProperties: false });
const diagnosticsSchema = Type.Object({
  status: Type.Union([Type.Literal('success'), Type.Literal('converged'), Type.Literal('failed'), Type.Literal('invalid'), Type.Null()]),
  degreesOfFreedom: Type.Union([Type.Integer(), Type.Null()]),
  conflictingIds: Type.Array(CadIdentifierSchema), redundantIds: Type.Array(CadIdentifierSchema), partiallyRedundantIds: Type.Array(CadIdentifierSchema),
  issues: Type.Array(CadSketchGraphIssueSchema)
}, { additionalProperties: false });
const resultSchema = Type.Union([
  Type.Object({ kind: Type.Literal('solved'), graph: CadSketchGraphSchema, diagnostics: diagnosticsSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('rejected'), reason: Type.Union([Type.Literal('invalid-input'), Type.Literal('conflicting'), Type.Literal('redundant'), Type.Literal('failed'), Type.Literal('invalid-solution')]),
    message: Type.String({ maxLength: 8192 }), diagnostics: diagnosticsSchema }, { additionalProperties: false })
]);
export interface CadSketchSolverRequest { readonly id: number; readonly kind: 'solve'; readonly input: CadSketchSolveInput }
export type CadSketchSolverReply = { readonly id: number; readonly kind: 'result'; readonly result: CadSketchSolveResult }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };

export function parseCadSketchSolveInput(value: unknown): CadSketchSolveInput {
  if (!isCadImportData(value) || !Value.Check(inputSchema, value)) throw new Error('Invalid sketch solver input.');
  const graph = parseCadSketchGraph(value.graph);
  if (value.drag && !graph.points.some(point => point.id === value.drag?.pointId)) throw new Error('The sketch drag point does not exist.');
  if (value.drag && cadSketchExternalReferenceComponents(graph).pointIds.has(value.drag.pointId)) throw new Error('Detach the sketch reference before dragging its geometry.');
  return Object.freeze({ graph, parameters: Object.freeze({ ...value.parameters }), ...(value.drag ? { drag: Object.freeze({ pointId: value.drag.pointId,
    position: Object.freeze([value.drag.position[0], value.drag.position[1]] satisfies [number, number]) }) } : {}) });
}

export function isCadSketchSolverEnvelope(value: unknown): value is { id: number; kind: string } {
  return typeof value === 'object' && value !== null && 'id' in value && Number.isSafeInteger(value.id) && typeof value.id === 'number' && value.id > 0
    && 'kind' in value && typeof value.kind === 'string';
}
export function parseCadSketchSolverRequest(value: unknown): CadSketchSolverRequest {
  if (!isCadSketchSolverEnvelope(value) || value.kind !== 'solve' || !('input' in value)) throw new Error('Invalid sketch solver request.');
  return { id: value.id, kind: 'solve', input: parseCadSketchSolveInput(value.input) };
}

export function cadSketchSolutionMatchesInput(input: CadSketchSolveInput, graph: CadSketchSolveInput['graph']) {
  if (graph.points.length !== input.graph.points.length || graph.entities.length !== input.graph.entities.length) return false;
  const owned = cadSketchExternalReferenceComponents(input.graph);
  return Value.Equal({ ...graph, points: graph.points.map((point, index) => ({ ...point,
    position: point.position.map((value, axis) => typeof input.graph.points[index].position[axis] === 'number' && !owned.pointIds.has(input.graph.points[index].id) ? input.graph.points[index].position[axis] : value)
  })), entities: graph.entities.map((entity, index) => {
    const original = input.graph.entities[index];
    return entity.kind === 'circle' && original.kind === 'circle' && typeof original.radius === 'number' && !owned.circleIds.has(original.id) ? { ...entity, radius: original.radius } : entity;
  }) }, input.graph);
}

export function parseCadSketchSolverReply(value: unknown, input: CadSketchSolveInput): CadSketchSolverReply {
  if (!isCadSketchSolverEnvelope(value)) throw new Error('Invalid sketch worker response.');
  if (value.kind === 'error' && 'message' in value && typeof value.message === 'string' && value.message.length <= 8192) return { id: value.id, kind: 'error', message: value.message };
  if (value.kind !== 'result' || !('result' in value) || !Value.Check(resultSchema, value.result)) throw new Error('Invalid sketch worker response.');
  const result = value.result;
  const diagnostics: CadSketchSolveDiagnostics = result.diagnostics;
  const knownIds = new Set([...input.graph.points, ...input.graph.entities, ...input.graph.relations].map(item => item.id));
  if ([...diagnostics.conflictingIds, ...diagnostics.redundantIds, ...diagnostics.partiallyRedundantIds].some(id => !knownIds.has(id))
    || diagnostics.issues.some(issue => !knownIds.has(issue.source.id))) throw new Error('Sketch worker diagnostics do not match the request.');
  if (result.kind === 'rejected') return { id: value.id, kind: 'result', result: { ...result, diagnostics } };
  const graph = parseCadSketchGraph(result.graph);
  if ((diagnostics.status !== 'success' && diagnostics.status !== 'converged') || diagnostics.degreesOfFreedom === null || diagnostics.degreesOfFreedom < 0
    || diagnostics.conflictingIds.length || diagnostics.redundantIds.length || diagnostics.partiallyRedundantIds.length || diagnostics.issues.length
    || !cadSketchSolutionMatchesInput(input, graph) || checkCadSketchGraph(graph, input.parameters).length) throw new Error('Sketch worker solution does not match its request or constraints.');
  return { id: value.id, kind: 'result', result: { kind: 'solved', graph, diagnostics } };
}
