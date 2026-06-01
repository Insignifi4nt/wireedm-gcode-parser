import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import {
  movePathOperation,
  reversePathOperation,
  setClosedOperationStartNearPoint,
  setPathOperationClassification
} from '@/domain/path-editor/pathDocumentOperations';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';

import {
  createUpidProjectRail,
  normalizeUpidPathElementSelection,
  readUpidManualOverrideRows,
  readUpidOperationPathElement,
  readUpidPathElementPoint,
  readUpidPathElementPointByRole,
  readUpidPathElementSourceSummary,
  readUpidPathElementTreeNode,
  readUpidSelectedPathPoint,
  readUpidSelectedPathSegment,
  readUpidSelectedPathTravel,
  summarizeUpidPathDocumentForEditor,
  upidManualDecisionKinds,
  upidPathElementAncestorIds,
  upidPathElementRefForDiagnostic,
  upidPathElementRefsMatch,
  upidStartPreviewPointRole,
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
    expect(rail.contourTree[0].treeMetrics).toEqual({
      descendantCount: 1,
      directSegmentCount: 4,
      totalSegmentCount: 8
    });
    expect(rail.contourTree[0].children.map((child) => child.element.displayName)).toEqual([
      'Hole 1'
    ]);
    expect(rail.contourTree[0].children[0].treeMetrics).toEqual({
      descendantCount: 0,
      directSegmentCount: 4,
      totalSegmentCount: 4
    });
    expect(
      upidPathElementAncestorIds(document, {
        operationId: rail.contourTree[0].children[0].element.operationId,
        segmentId: rail.contourTree[0].children[0].element.segmentRefs[0].segmentId
      })
    ).toEqual(['contour_0002', 'contour_0001']);
    expect(
      upidPathElementAncestorIds(document, {
        operationId: rail.contourTree[0].element.operationId,
        pathElementId: 'contour_0001',
        segmentId: null
      })
    ).toEqual(['contour_0001']);
    expect(rail.operationElements.map(upidPathElementSourceEntityCount)).toEqual([4, 4]);
  });

  it('resolves selected path refs back to path tree nodes with subtree metrics', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 20, 20), ...rectangleLines(5, 5, 10, 10)]
    );
    const rail = createUpidProjectRail(document);
    const exteriorElement = rail.contourTree[0].element;
    const holeElement = rail.contourTree[0].children[0].element;

    expect(
      readUpidPathElementTreeNode(document, {
        operationId: holeElement.operationId,
        pathElementId: holeElement.id,
        segmentId: holeElement.segmentRefs[0].segmentId
      })
    ).toMatchObject({
      element: {
        id: 'contour_0002'
      },
      treeMetrics: {
        descendantCount: 0,
        directSegmentCount: 4,
        totalSegmentCount: 4
      }
    });
    expect(
      readUpidPathElementTreeNode(document, {
        operationId: exteriorElement.operationId,
        pathElementId: exteriorElement.id,
        segmentId: null
      })
    ).toMatchObject({
      element: {
        id: 'contour_0001'
      },
      treeMetrics: {
        descendantCount: 1,
        directSegmentCount: 4,
        totalSegmentCount: 8
      }
    });
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

  it('normalizes selected path refs and resolves selected points from UPID geometry', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 5));
    const operation = document.plan.operations[0];
    const pathElement = document.pathElements[0];
    const firstSegmentId = operation.segmentRefs[0].segmentId;

    expect(normalizeUpidPathElementSelection(document, null, null)).toEqual({
      operationId: operation.id,
      pathElementId: pathElement.id,
      segmentId: null
    });
    expect(
      normalizeUpidPathElementSelection(document, operation.id, {
        operationId: operation.id,
        segmentId: firstSegmentId,
        pointRole: 'start'
      })
    ).toEqual({
      operationId: operation.id,
      pathElementId: pathElement.id,
      pointRole: 'start',
      segmentId: firstSegmentId
    });
    expect(
      normalizeUpidPathElementSelection(document, operation.id, {
        operationId: operation.id,
        segmentId: 'missing_segment'
      })
    ).toEqual({
      operationId: operation.id,
      pathElementId: pathElement.id,
      segmentId: null
    });
    expect(
      readUpidPathElementPoint(document, {
        operationId: operation.id,
        segmentId: firstSegmentId,
        pointRole: 'start'
      })
    ).toEqual({ x: 0, y: 0 });
    expect(readUpidPathElementPointByRole(pathElement, 'end')?.point).toEqual({ x: 0, y: 0 });
  });

  it('classifies start previews and rapid travel with shared UPID selection helpers', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 5, 5), ...rectangleLines(20, 0, 25, 5)]
    );
    const secondOperation = document.plan.operations[1];
    const firstSegmentId = secondOperation.segmentRefs[0].segmentId;

    expect(
      upidStartPreviewPointRole(document, {
        operationId: secondOperation.id,
        point: { x: 20, y: 0 },
        segmentId: firstSegmentId
      })
    ).toBe('start');
    expect(
      upidStartPreviewPointRole(document, {
        operationId: secondOperation.id,
        point: { x: 25, y: 0 },
        segmentId: firstSegmentId
      })
    ).toBe('end');
    expect(
      upidStartPreviewPointRole(document, {
        operationId: secondOperation.id,
        point: { x: 22.5, y: 0 },
        segmentId: firstSegmentId
      })
    ).toBeNull();
    expect(
      readUpidSelectedPathTravel(document, 1, {
        operationId: secondOperation.id,
        segmentId: null,
        travelRole: 'rapid-in'
      })
    ).toEqual({
      end: { x: 20, y: 0 },
      length: 20,
      start: { x: 0, y: 0 }
    });
  });

  it('summarizes path-document preview stats without posting G-code', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 10, y: 10 },
        radius: 10,
        startAngle: 270,
        endAngle: 180,
        clockwise: false,
        start: { x: 10, y: 0 },
        end: { x: 0, y: 10 }
      },
      {
        type: 'circle',
        layer: 'CUT',
        center: { x: 30, y: 10 },
        radius: 5
      }
    ]);

    expect(summarizeUpidPathDocumentForEditor(document)).toEqual({
      arcMoveCount: 3,
      bounds: {
        maxX: 35,
        maxY: 20,
        minX: 0,
        minY: 0
      },
      cuttingMoveCount: 1,
      pathCount: 6,
      rapidMoveCount: 2
    });
  });

  it('reads selected segment and point details with DXF provenance', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      {
        type: 'line',
        handle: 'BEEF',
        layer: 'CUT',
        source: {
          blockName: 'PROFILE',
          insertChain: [
            {
              blockName: 'PROFILE',
              column: 2,
              row: 3,
              layer: 'CUT',
              transform: {
                insertion: { x: 100, y: 200 },
                rotationDegrees: 0,
                scaleX: 1,
                scaleY: 1
              }
            }
          ]
        },
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      }
    ]);
    const operation = document.plan.operations[0];
    const pathElement = readUpidOperationPathElement(document, operation.id, null);
    const elementRef = {
      operationId: operation.id,
      pathElementId: pathElement!.id,
      segmentId: operation.segmentRefs[0].segmentId
    };

    expect(readUpidSelectedPathSegment(document, pathElement!, elementRef)).toMatchObject({
      end: { x: 10, y: 0 },
      kind: 'line',
      layer: 'CUT',
      length: 10,
      reversed: false,
      source: {
        block: 'PROFILE',
        entityIndex: 0,
        exact: true,
        handle: 'BEEF',
        insert: 'PROFILE / row 3 col 2',
        type: 'line'
      },
      start: { x: 0, y: 0 }
    });
    expect(readUpidSelectedPathPoint(document, pathElement!, { ...elementRef, pointRole: 'end' })).toEqual({
      point: { x: 10, y: 0 },
      role: 'end',
      segmentKind: 'line'
    });
    expect(readUpidPathElementSourceSummary(pathElement!)).toEqual({
      blocks: 'PROFILE',
      entities: '1 entity',
      exact: 'exact',
      handles: 'BEEF',
      inserts: 'PROFILE / 1 segment',
      layers: 'CUT'
    });
  });

  it('formats selected element manual override rows from UPID overrides', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 5, 5), ...rectangleLines(20, 0, 25, 5)]
    );
    const targetOperationId = document.plan.operations[1].id;

    const moved = movePathOperation(document, targetOperationId, -1);
    const classified = setPathOperationClassification(moved!, targetOperationId, 'hole');
    const reversed = reversePathOperation(classified!, targetOperationId);
    const started = setClosedOperationStartNearPoint(reversed!, targetOperationId, { x: 22.5, y: 0 });
    const pathElement = readUpidOperationPathElement(started!, targetOperationId, null);

    expect(readUpidManualOverrideRows(pathElement!.overrides)).toEqual([
      {
        kind: 'order',
        label: 'Order',
        value: 'Manual position 1'
      },
      {
        kind: 'classification',
        label: 'Role',
        value: 'hole'
      },
      {
        kind: 'direction',
        label: 'Direction',
        value: 'reverse'
      },
      {
        kind: 'start',
        label: 'Start',
        value: '22.500, 0.000 / split 2'
      }
    ]);
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
