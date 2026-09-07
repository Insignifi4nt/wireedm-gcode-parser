import { setManualCompensationIntent } from '@/domain/compensation/intent';
import {
  reversePathOperation,
  setManualInitialWirePosition,
  setPathOperationProgramStops,
  setPathOperationThreadingTransition,
  setPathOperationTransitions,
  setProjectThreadingDefault
} from '@/domain/path-editor/pathDocumentOperations';
import {
  setMachiningSpanParticipation,
  setPartialContourCompensationSide,
  setPartialContourEntryReview,
  setPartialContourExitReview
} from '@/domain/path-intel/machiningParticipation';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { createUpidFromDxfEntities } from '../upidDocument';

export function portableUpidIntentFixture() {
  let document = createUpidFromDxfEntities([
    { type: 'circle', layer: 'Matriță 日本', center: { x: 10, y: 10 }, radius: 5 }
  ], {}, {
    fileName: 'source.dxf', projectId: 'original-workbench-project',
    coordinateScaleToMillimeters: 1,
    appliedUnits: { label: 'millimeters', scaleToMillimeters: 1, basis: 'user-confirmed', confirmed: true, confirmedAt: '2026-09-07T10:00:00.000Z' }
  });
  document.geometryBasis = 'finished-contour';
  const operationId = document.plan.operations[0].id;
  document = required(reversePathOperation(document, operationId));
  document = required(setManualCompensationIntent(document, operationId, 'outside'));
  document = required(setManualInitialWirePosition(document, { x: 18, y: 10 }));
  document = required(setProjectThreadingDefault(document, { mode: 'manual', wireSeparation: 'manual-before-positioning' }));
  document = required(setPathOperationThreadingTransition(document, operationId, { mode: 'automatic', wireSeparation: 'automatic-before-positioning' }));
  document = required(setPathOperationTransitions(document, operationId, {
    entry: { strategy: 'none', review: 'reviewed' },
    exit: { strategy: 'none', review: 'reviewed' }
  }));
  document = required(setPathOperationProgramStops(document, operationId, [{
    id: 'inspect-before-cut', enabled: true, placement: { kind: 'before-entry' },
    reason: 'operator-check', note: 'Inspect pinned insert'
  }]));
  document = required(setMachiningSpanParticipation(document, {
    sourceSegmentId: document.segments[0].id, range: { start: 0.5, end: 1 }, participation: 'inactive-reference'
  }));
  document = required(setPartialContourCompensationSide(document, operationId, 'left'));
  document = required(setPartialContourEntryReview(document, operationId, true));
  document = required(setPartialContourExitReview(document, operationId, true));
  return document;
}

function required(document: PathPlanningDocument | null) {
  if (!document) throw new Error('Could not construct portable machining intent fixture.');
  return document;
}
