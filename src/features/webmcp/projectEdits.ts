import { Type, type Static } from '@sinclair/typebox';
import { setManualCompensationIntent } from '@/domain/compensation/intent';
import * as paths from '@/domain/path-editor/pathDocumentOperations';
import * as participation from '@/domain/path-intel/machiningParticipation';
import { readOperationTransitions } from '@/domain/path-intel/operationTransitions';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { object, ToolError } from './siteTools';

export const identifier = Type.String({ minLength: 1, maxLength: 160 });
// Imported UPID identities have no fixed length; preserve IDs from geometry queries.
export const sourceIdentifier = Type.String({ minLength: 1 });
const number = Type.Number({ minimum: -1e9, maximum: 1e9 });
const point = object({ x: number, y: number });
const choices = <const T extends string[]>(...values: T) => Type.Union(values.map(value => Type.Literal<T[number]>(value)));
const threading = object({ mode: choices('continuous', 'manual', 'automatic'), wireSeparation: choices('already-separated', 'manual-before-positioning', 'automatic-during-positioning', 'automatic-before-positioning') });
const placement = Type.Union([
  object({ kind: choices('before-entry', 'after-positioning', 'after-contour', 'after-exit') }),
  object({ kind: Type.Literal('before-operation-end'), remainingCutLengthMm: Type.Number({ exclusiveMinimum: 0, maximum: 1e9 }) })
]);
export const projectEdit = Type.Union([
  object({ kind: Type.Literal('initial-wire'), point }),
  object({ kind: Type.Literal('geometry-basis'), basis: choices('finished-contour', 'wire-centre') }),
  object({ kind: Type.Literal('translate'), delta: point, operationId: Type.Optional(sourceIdentifier) }),
  object({ kind: Type.Literal('rotate'), degrees: number, origin: point }),
  object({ kind: Type.Literal('mirror'), axis: choices('x', 'y'), origin: point }),
  object({ kind: Type.Literal('order-strategy'), strategy: choices('inside-out-nearest', 'nearest', 'source-order') }),
  object({ kind: Type.Literal('move-operation'), operationId: sourceIdentifier, direction: Type.Union([Type.Literal(-1), Type.Literal(1)]) }),
  object({ kind: Type.Literal('reverse'), operationId: sourceIdentifier }),
  object({ kind: Type.Literal('classification'), operationId: sourceIdentifier, classification: choices('exterior', 'hole', 'island', 'ambiguous', 'open-chain') }),
  object({ kind: Type.Literal('start-point'), operationId: sourceIdentifier, point }),
  object({ kind: Type.Literal('compensation'), operationId: sourceIdentifier, selection: choices('automatic', 'inside', 'outside', 'centerline') }),
  object({ kind: Type.Literal('threading-default'), transition: threading }),
  object({ kind: Type.Literal('threading'), operationId: sourceIdentifier, transition: Type.Union([threading, Type.Null()]) }),
  object({ kind: Type.Literal('circle-center-entry'), operationId: sourceIdentifier }),
  object({ kind: Type.Literal('entry'), operationId: sourceIdentifier, from: Type.Union([point, Type.Null()]) }),
  object({ kind: Type.Literal('exit'), operationId: sourceIdentifier, to: Type.Union([point, Type.Null()]) }),
  object({ kind: Type.Literal('program-stops'), operationId: sourceIdentifier, stops: Type.Array(object({ id: sourceIdentifier, enabled: Type.Boolean(), placement, reason: choices('operator-check', 'part-retention', 'manual'), note: Type.Optional(Type.String({ maxLength: 500 })) }), { maxItems: 50 }) }),
  object({ kind: Type.Literal('participation'), sourceSegmentId: sourceIdentifier, range: object({ start: Type.Number({ minimum: 0, maximum: 1 }), end: Type.Number({ minimum: 0, maximum: 1 }) }), participation: choices('active-cut', 'inactive-reference') }),
  object({ kind: Type.Literal('partial-compensation'), operationId: sourceIdentifier, side: Type.Union([choices('left', 'right'), Type.Null()]) }),
  object({ kind: Type.Literal('partial-lead-review'), operationId: sourceIdentifier, role: choices('entry', 'exit'), reviewed: Type.Boolean() })
]);
export type ProjectEdit = Static<typeof projectEdit>;

/** Pure, atomic batch. The editor adds a single undo checkpoint only after all edits succeed. */
export function applyProjectEdits(document: PathPlanningDocument, edits: readonly ProjectEdit[]): PathPlanningDocument {
  let next = document;
  for (const [index, edit] of edits.entries()) {
    const result = apply(next, edit);
    if (!result) throw new ToolError('EDIT_REJECTED', `Edit ${index + 1} (${edit.kind}) is not applicable. No edits were applied.`, {
      editIndex: index, editKind: edit.kind, ...('operationId' in edit ? { operationId: edit.operationId } : {}),
      recovery: 'Read current geometry IDs and edm_describe_edits for this kind, then retry the complete batch with a fresh draftVersion.'
    });
    next = result;
  }
  return next;
}

function apply(doc: PathPlanningDocument, edit: ProjectEdit): PathPlanningDocument | null {
  switch (edit.kind) {
    case 'initial-wire': return paths.setManualInitialWirePosition(doc, edit.point);
    case 'geometry-basis': return { ...structuredClone(doc), geometryBasis: edit.basis };
    case 'translate': return edit.operationId ? paths.translatePathOperation(doc, edit.operationId, edit.delta) : paths.translatePathDocument(doc, edit.delta);
    case 'rotate': return paths.rotatePathDocument(doc, edit.degrees, edit.origin);
    case 'mirror': return paths.mirrorPathDocument(doc, edit.axis, edit.origin);
    case 'order-strategy': return paths.setPathOperationOrderStrategy(doc, edit.strategy) ?? doc;
    case 'move-operation': return paths.movePathOperation(doc, edit.operationId, edit.direction);
    case 'reverse': return paths.reversePathOperation(doc, edit.operationId);
    case 'classification': return paths.setPathOperationClassification(doc, edit.operationId, edit.classification);
    case 'start-point': return paths.setClosedOperationStartNearPoint(doc, edit.operationId, edit.point);
    case 'compensation': return setManualCompensationIntent(doc, edit.operationId, edit.selection);
    case 'threading-default': return paths.setProjectThreadingDefault(doc, edit.transition);
    case 'threading': return paths.setPathOperationThreadingTransition(doc, edit.operationId, edit.transition);
    case 'circle-center-entry': return paths.setCircleOperationCenterPierceLeadIn(doc, edit.operationId);
    case 'entry': {
      if (edit.from) return paths.setPathOperationManualLeadIn(doc, edit.operationId, edit.from);
      const op = doc.plan.operations.find(op => op.id === edit.operationId);
      return op ? paths.setPathOperationTransitions(doc, op.id, { ...readOperationTransitions(op), entry: { strategy: 'none', review: 'reviewed' } }) : null;
    }
    case 'exit': {
      const op = doc.plan.operations.find(op => op.id === edit.operationId);
      return op ? paths.setPathOperationTransitions(doc, op.id, { ...readOperationTransitions(op), exit: edit.to ? { strategy: 'manual-straight', move: 'cut', from: op.endPoint, to: edit.to, review: 'reviewed' } : { strategy: 'none', review: 'reviewed' } }) : null;
    }
    case 'program-stops': return paths.setPathOperationProgramStops(doc, edit.operationId, edit.stops);
    case 'participation': return participation.setMachiningSpanParticipation(doc, edit);
    case 'partial-compensation': return participation.setPartialContourCompensationSide(doc, edit.operationId, edit.side);
    case 'partial-lead-review': return edit.role === 'entry' ? participation.setPartialContourEntryReview(doc, edit.operationId, edit.reviewed) : participation.setPartialContourExitReview(doc, edit.operationId, edit.reviewed);
  }
}
