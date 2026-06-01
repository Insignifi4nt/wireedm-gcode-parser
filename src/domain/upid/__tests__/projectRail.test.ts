import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { movePathOperation, reversePathOperation } from '@/domain/path-editor/pathDocumentOperations';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';

import {
  createUpidProjectRail,
  readUpidOperationPathElement,
  upidManualDecisionKinds,
  upidPathElementRefForDiagnostic,
  upidPathElementRefsMatch,
  upidPathElementSourceEntityCount
} from '../projectRail';

describe('UPID project rail projection', () => {
  it('projects nested contours and cut sequence from the path document', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 20, 20), ...rectangleLines(5, 5, 10, 10)]
    );

    const rail = createUpidProjectRail(document);

    expect(rail.summary).toEqual({
      contourCount: 2,
      operationCount: 2,
      rootCount: 1
    });
    expect(rail.manualOrderActive).toBe(false);
    expect(rail.cutSequenceElements.map((element) => element.displayName)).toEqual([
      'Hole 1',
      'Exterior 1'
    ]);
    expect(rail.contourTree).toHaveLength(1);
    expect(rail.contourTree[0].element.displayName).toBe('Exterior 1');
    expect(rail.contourTree[0].children.map((child) => child.element.displayName)).toEqual([
      'Hole 1'
    ]);
    expect(rail.operationElements.map(upidPathElementSourceEntityCount)).toEqual([4, 4]);
  });

  it('keeps manual decisions available without React panel bookkeeping', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 5, 5), ...rectangleLines(20, 0, 25, 5)]
    );
    const moved = movePathOperation(document, document.plan.operations[1].id, -1);
    const reversed = reversePathOperation(moved!, document.plan.operations[0].id);

    const rail = createUpidProjectRail(reversed!);
    const reversedElement = readUpidOperationPathElement(
      reversed!,
      document.plan.operations[0].id,
      null
    );

    expect(rail.manualOrderActive).toBe(true);
    expect(rail.cutSequenceElements.map((element) => upidManualDecisionKinds(element))).toEqual([
      ['order'],
      ['order', 'direction']
    ]);
    expect(upidManualDecisionKinds(reversedElement!)).toEqual(['order', 'direction']);
  });

  it('resolves diagnostics and compares path-element refs with path identity semantics', () => {
    const document = createPathPlanningDocumentFromDxfEntities(gappedRectangle(0.004), {
      endpointTolerance: 0.01
    });
    const diagnostic = document.diagnostics.find((candidate) => candidate.relatedSegmentIds?.length);

    expect(diagnostic).not.toBeUndefined();
    const ref = upidPathElementRefForDiagnostic(document, diagnostic!);

    expect(ref).toMatchObject({
      operationId: document.plan.operations[0].id,
      pathElementId: document.pathElements[0].id,
      segmentId: diagnostic!.relatedSegmentIds![0]
    });
    expect(upidPathElementRefsMatch(ref, { ...ref! })).toBe(true);
    expect(upidPathElementRefsMatch(ref, { ...ref!, pointRole: 'start' })).toBe(true);
    expect(upidPathElementRefsMatch({ ...ref!, pointRole: 'start' }, ref)).toBe(false);
    expect(upidPathElementRefsMatch({ ...ref!, pointRole: 'start' }, { ...ref!, pointRole: 'start' })).toBe(
      true
    );
  });
});

function rectangleLines(minX: number, minY: number, maxX: number, maxY: number): DxfEntity[] {
  return [
    line(minX, minY, maxX, minY),
    line(maxX, minY, maxX, maxY),
    line(maxX, maxY, minX, maxY),
    line(minX, maxY, minX, minY)
  ];
}

function gappedRectangle(gap: number): DxfEntity[] {
  return [
    line(0, 0, 10, 0),
    line(10 + gap, 0, 10, 5),
    line(10, 5, 0, 5),
    line(0, 5, 0, 0)
  ];
}

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return {
    type: 'line',
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
