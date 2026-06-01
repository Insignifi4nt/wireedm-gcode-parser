import { describe, expect, it } from 'vitest';

import {
  movePathOperation,
  reversePathOperation,
  setClosedOperationStartAtSegmentEndpoint,
  setPathOperationClassification
} from '@/domain/path-editor/pathDocumentOperations';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';

import {
  readUpidManualDecisionDetails,
  summarizeUpidManualDecisions,
  upidManualDecisionKinds
} from '../manualDecisions';

describe('UPID manual decisions', () => {
  it('summarizes manual override kinds and structured details from UPID path elements or operations', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      ...rectangle(0, 0, 10, 5),
      ...rectangle(20, 0, 30, 5)
    ]);
    const editedOperationId = document.plan.operations[0].id;
    const moved = movePathOperation(document, editedOperationId, 1);
    const classified = setPathOperationClassification(moved!, editedOperationId, 'hole');
    const reversed = reversePathOperation(classified!, editedOperationId);
    const editedOperation = reversed!.plan.operations.find(
      (operation) => operation.id === editedOperationId
    )!;
    const startSegmentId = editedOperation.segmentRefs[0].segmentId;
    const started = setClosedOperationStartAtSegmentEndpoint(
      reversed!,
      editedOperationId,
      startSegmentId,
      'start'
    );
    const finalOperation = started!.plan.operations.find(
      (operation) => operation.id === editedOperationId
    )!;

    expect(summarizeUpidManualDecisions(started!.plan.operations)).toEqual({
      count: 5,
      counts: {
        direction: 1,
        order: 2,
        role: 1,
        start: 1
      }
    });
    expect(upidManualDecisionKinds(finalOperation)).toEqual(['order', 'role', 'direction', 'start']);
    expect(readUpidManualDecisionDetails(finalOperation)).toMatchObject({
      classification: { classification: 'hole' },
      direction: { direction: 'reverse' },
      order: { orderIndex: 1 },
      start: {
        pointRole: 'start',
        relation: 'existing-point',
        sourceSegmentId: startSegmentId
      }
    });
  });

  it('returns empty manual-decision summaries for automatic operations', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangle(0, 0, 10, 5));

    expect(summarizeUpidManualDecisions(document.plan.operations)).toEqual({
      count: 0,
      counts: {
        direction: 0,
        order: 0,
        role: 0,
        start: 0
      }
    });
    expect(upidManualDecisionKinds(document.plan.operations[0])).toEqual([]);
    expect(readUpidManualDecisionDetails(document.plan.operations[0])).toEqual({
      classification: null,
      direction: null,
      order: null,
      start: null
    });
  });
});

function rectangle(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    line(minX, minY, maxX, minY),
    line(maxX, minY, maxX, maxY),
    line(maxX, maxY, minX, maxY),
    line(minX, maxY, minX, minY)
  ];
}

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
