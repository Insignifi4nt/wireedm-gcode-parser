import { CadError } from '@/domain/cad/cadError';
import type { CadSketchGraph, CadSketchGraphIssue, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchEntityPointIds, cadSketchRelationEntityIds, cadSketchRelationPointIds } from '@/domain/cad/cadSketchGraphReferences';
import { cadSketchDiagnosisMarks, type CadSketchDiagnosisMarks } from './cadSketchDefinitionMarks';
import { cadSketchDatumRelationLabel } from './cadSketchGraphSelection';
import { cadSketchSolverRecoveryMessages } from './sketch-solver/cadSketchSolverMessages';
import type { CadSketchSolveDiagnostics, CadSketchSolveResult } from './sketch-solver/cadSketchSolverTypes';

type Rejection = Extract<CadSketchSolveResult, { kind: 'rejected' }>;
type Source = CadSketchGraphIssue['source'];
type Subject = { readonly source: Source; readonly label: string; readonly pointIds: readonly string[]; readonly entityIds: readonly string[] };
export type CadSketchConstraintFeedbackSubject = Subject & (
  { readonly category: 'conflicting' | 'redundant' | 'partially-redundant' }
  | { readonly category: 'issue'; readonly code: CadSketchGraphIssue['code']; readonly detail: string; readonly residualMm?: number }
);
export interface CadSketchConstraintFeedback {
  readonly sketchId: string;
  readonly reason: Rejection['reason'];
  readonly message: string;
  readonly subjects: readonly CadSketchConstraintFeedbackSubject[];
  readonly subjectCount: number;
  readonly omittedSubjectCount: number;
}
interface PreparationFailureInput {
  readonly sketchId: string; readonly sketchName: string; readonly graph: CadSketchGraph; readonly rejection: Rejection; readonly dragPointId?: string;
}

const relationNames: Record<CadSketchGraphRelation['kind'], string> = {
  'tangent-joint': 'Tangent', 'point-on-line': 'Point on line', 'point-on-curve': 'Point on curve', symmetric: 'Symmetric points', 'linear-pattern': 'Linear pattern', 'reference-dimension': 'Reference dimension', coincident: 'Coincident', midpoint: 'Midpoint', horizontal: 'Horizontal', vertical: 'Vertical', parallel: 'Parallel', perpendicular: 'Perpendicular', collinear: 'Collinear', distance: 'Distance', 'point-line-distance': 'Point to line distance', 'axis-distance': 'Axis distance',
  'equal-length': 'Equal length', 'equal-radius': 'Equal radius', 'line-angle': 'Angle', 'external-reference': 'Linked reference',
  'fixed-point': 'Fixed point', 'fixed-axis': 'Distance', 'fillet-corner': 'Fillet', 'chamfer-corner': 'Chamfer', 'radial-size': 'Radial size'
};
const rejectionMessages: Record<Rejection['reason'], string> = {
  conflicting: 'Sketch constraints conflict.', redundant: 'Sketch constraints are redundant.', failed: 'The sketch solver could not solve this edit.',
  'invalid-input': 'Sketch input is invalid.', 'too-large': 'A connected group of sketch relations is too large to solve.', 'invalid-solution': 'The sketch solution does not satisfy its geometry and relations.'
};
const issueDetails: Record<CadSketchGraphIssue['code'], string> = {
  'invalid-expression': 'The expression could not be evaluated.', 'invalid-coordinate': 'The coordinate is outside the supported range.',
  'degenerate-entity': 'The edge endpoints are too close.', 'invalid-radius': 'The radius is outside the supported range.',
  'arc-radius-mismatch': 'The arc endpoints have different radii.', 'invalid-distance': 'The driving distance is invalid.',
  'relation-residual': 'The geometry does not satisfy this relation.'
};

/** Ordinals describe this graph snapshot only. Exact source IDs remain the action keys. */
export function describeCadSketchConstraintSource(graph: CadSketchGraph, source: Source): Subject {
  const pointLabel = (id: string) => {
    const index = graph.points.findIndex(point => point.id === id);
    return index < 0 ? 'Unavailable point' : `Point ${index + 1}`;
  };
  let label: string, pointIds: readonly string[] = [], entityIds: readonly string[] = [];
  if (source.kind === 'relation') {
    const index = graph.relations.findIndex(relation => relation.id === source.id), relation = graph.relations[index];
    if (relation) {
      pointIds = cadSketchRelationPointIds(graph, relation); entityIds = cadSketchRelationEntityIds(relation);
      const operands = relation.kind === 'tangent-joint' ? relation.endpoints.map(endpoint => `${describeCadSketchConstraintSource(graph,{kind:'entity',id:endpoint.entityId}).label} at ${pointLabel(endpoint.pointId)}`)
        : relation.kind === 'midpoint' || relation.kind === 'point-on-line' || relation.kind === 'point-line-distance' ? [pointLabel(relation.pointId), describeCadSketchConstraintSource(graph, { kind: 'entity', id: relation.lineId }).label]
        : relation.kind === 'point-on-curve' ? [pointLabel(relation.pointId), describeCadSketchConstraintSource(graph, { kind: 'entity', id: relation.curveId }).label]
        : relation.kind === 'line-angle' ? relation.rays.map(ray => describeCadSketchConstraintSource(graph, { kind: 'entity', id: ray.lineId }).label)
        : relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear' || relation.kind === 'equal-length'
        ? relation.lineIds.map(id => describeCadSketchConstraintSource(graph, { kind: 'entity', id }).label)
        : relation.kind === 'equal-radius' ? relation.curveIds.map(id => describeCadSketchConstraintSource(graph, { kind: 'entity', id }).label)
        : relation.kind === 'radial-size' || relation.kind === 'external-reference' ? [describeCadSketchConstraintSource(graph, { kind: 'entity', id: relation.entityId }).label]
        : relation.kind === 'symmetric' ? [...relation.pointIds.map(pointLabel), describeCadSketchConstraintSource(graph,{kind:'entity',id:relation.lineId}).label]
        : relation.kind === 'linear-pattern' ? [describeCadSketchConstraintSource(graph, { kind: 'entity', id: relation.seed.entityId }).label]
        : relation.kind === 'reference-dimension' ? relation.measurement.kind === 'point-distance' ? relation.measurement.pointIds.map(pointLabel)
          : relation.measurement.kind === 'point-line-distance' ? [pointLabel(relation.measurement.pointId), describeCadSketchConstraintSource(graph, { kind: 'entity', id: relation.measurement.lineId }).label]
          : [describeCadSketchConstraintSource(graph, { kind: 'entity', id: relation.measurement.entityId }).label]
        // A distance from an axis names the axis among its operands, as a distance between two lines names both.
        : relation.kind === 'fixed-axis' && !cadSketchDatumRelationLabel(relation) ? [pointLabel(relation.pointId), relation.axis === 'x' ? 'Y axis' : 'X axis']
        : ('pointIds' in relation ? relation.pointIds : [relation.pointId]).map(pointLabel);
      const name = cadSketchDatumRelationLabel(relation) ?? (relation.kind === 'axis-distance' ? relation.axis === 'x' ? 'Horizontal distance' : 'Vertical distance'
        : relation.kind === 'radial-size' ? relation.quantity === 'radius' ? 'Radius' : 'Diameter' : relationNames[relation.kind]);
      label = `${name} relation ${index + 1} · ${operands.join(relation.kind === 'axis-distance' ? ' → ' : ' and ')}`;
    } else label = 'Unavailable relation';
  } else if (source.kind === 'entity') {
    const entity = graph.entities.find(entity => entity.id === source.id);
    if (entity) {
      const ordinal = [...graph.entities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).findIndex(item => item.id === source.id) + 1;
      label = `${entity.kind[0].toUpperCase()}${entity.kind.slice(1)} ${ordinal}`;
      pointIds = cadSketchEntityPointIds(entity); entityIds = [entity.id];
    } else label = 'Unavailable edge';
  } else {
    label = pointLabel(source.id);
    if (graph.points.some(point => point.id === source.id)) pointIds = [source.id];
  }
  return Object.freeze({ source: Object.freeze({ ...source }), label, pointIds: Object.freeze([...pointIds]), entityIds: Object.freeze([...entityIds]) });
}

function feedback({ sketchId, sketchName, graph, rejection, dragPointId }: PreparationFailureInput): CadSketchConstraintFeedback {
  const diagnostics = rejection.diagnostics, subjects: CadSketchConstraintFeedbackSubject[] = [];
  for (const [category, ids] of [['conflicting', diagnostics.conflictingIds], ['redundant', diagnostics.redundantIds], ['partially-redundant', diagnostics.partiallyRedundantIds]] as const) {
    for (const id of ids) {
      if (subjects.length >= 8) break;
      const source: Source | null = graph.relations.some(item => item.id === id) ? { kind: 'relation', id }
        : graph.entities.some(item => item.id === id) ? { kind: 'entity', id } : graph.points.some(item => item.id === id) ? { kind: 'point', id } : null;
      if (source) {
        const subject = describeCadSketchConstraintSource(graph, source);
        const label = source.kind === 'point' && source.id === dragPointId ? `Move ${subject.label}`
          : source.kind === 'entity' && graph.entities.some(entity => entity.id === source.id && entity.kind === 'arc') ? `${subject.label} endpoint radii` : subject.label;
        subjects.push(Object.freeze({ ...subject, label, category }));
      }
    }
  }
  for (const issue of diagnostics.issues) {
    if (subjects.length >= 8) break;
    subjects.push(Object.freeze({ ...describeCadSketchConstraintSource(graph, issue.source), category: 'issue', code: issue.code, detail: issueDetails[issue.code],
      ...(issue.residualMm === undefined ? {} : { residualMm: issue.residualMm }) }));
  }
  const subjectCount = diagnostics.conflictingIds.length + diagnostics.redundantIds.length + diagnostics.partiallyRedundantIds.length + diagnostics.issues.length;
  // A solver that could not load says how to recover, which the generic wording would hide.
  const message = rejection.reason === 'failed' && cadSketchSolverRecoveryMessages.has(rejection.message) ? rejection.message : rejectionMessages[rejection.reason];
  return Object.freeze({ sketchId, reason: rejection.reason, message: `${sketchName}: ${message}`,
    subjects: Object.freeze(subjects), subjectCount, omittedSubjectCount: subjectCount - subjects.length });
}

/** A failed candidate retains diagnosis and operand identities without owning accepted data or history. */
export class CadSketchPreparationError extends CadError {
  readonly feedback: CadSketchConstraintFeedback;
  readonly diagnostics: CadSketchSolveDiagnostics;
  readonly solverMessage: string;
  /** Every reported operand, not only the summarized subjects, so the canvas can colour them. */
  readonly marks: CadSketchDiagnosisMarks | null;
  constructor(input: PreparationFailureInput) {
    const presentation = feedback(input);
    super(`sketch-${input.rejection.reason}`, presentation.message);
    this.name = 'CadSketchPreparationError'; this.feedback = presentation; this.solverMessage = input.rejection.message;
    const diagnostics = input.rejection.diagnostics;
    this.diagnostics = Object.freeze({ ...diagnostics, conflictingIds: Object.freeze([...diagnostics.conflictingIds]), redundantIds: Object.freeze([...diagnostics.redundantIds]),
      partiallyRedundantIds: Object.freeze([...diagnostics.partiallyRedundantIds]), issues: Object.freeze(diagnostics.issues.map(issue => Object.freeze({ ...issue, source: Object.freeze({ ...issue.source }) }))) });
    this.marks = cadSketchDiagnosisMarks(input.sketchId, input.graph, diagnostics);
  }
}
