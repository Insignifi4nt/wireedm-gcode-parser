import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import {
  movePathOperation,
  reversePathOperation,
  setCircleOperationCenterPierceLeadIn,
  setClosedOperationStartNearPoint,
  setPathOperationClassification
} from '@/domain/path-editor/pathDocumentOperations';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { nextUp } from '@/domain/path-intel/segments';

import {
  createUpidProjectRail,
  normalizeUpidPathElementSelection,
  projectUpidPathDiagnostic,
  readUpidManualOverrideRows,
  readUpidEndpointTopologyRows,
  readUpidOperationPathElement,
  readUpidPathElementDiagnostics,
  readUpidPathElementPoint,
  readUpidPathElementPointByRole,
  readUpidPathElementLineage,
  readUpidPathElementSegmentSequenceContext,
  readUpidPathElementSequenceContext,
  readUpidPathElementSourceSummary,
  readUpidPathElementTreeContext,
  readUpidPathElementTreeNode,
  summarizeUpidDiagnosticsForPathElementRef,
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
      manualDecisionCount: 0,
      manualDecisionCounts: {
        compensation: 0,
        direction: 0,
        'lead-in': 0,
        order: 0,
        role: 0,
        start: 0
      },
      operationCount: 2,
      rootCount: 1,
      source: {
        approximatedSegmentCount: 0,
        blockCount: 0,
        blockNames: [],
        editedSegmentCount: 0,
        entityCount: 8,
        exactSegmentCount: 8,
        insertBlockCount: 0,
        insertBlockNames: [],
        insertedSegmentCount: 0,
        layerCount: 1,
        layers: ['CUT'],
        segmentCount: 8
      },
      topology: {
        ambiguousEndpointClusterCount: 0,
        endpointClusterCount: document.endpointClusters.length,
        maxEndpointSnapGap: 0,
        snappedEndpointClusterCount: 0,
        snappedEndpointCount: 0
      }
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

  it('summarizes project-level source provenance for the path navigator', () => {
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
              column: 0,
              row: 0,
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
      },
      line(20, 0, 30, 0, 'ETCH')
    ]);

    const rail = createUpidProjectRail(document);

    expect(rail.summary.source).toEqual({
      approximatedSegmentCount: 0,
      blockCount: 1,
      blockNames: ['PROFILE'],
      editedSegmentCount: 0,
      entityCount: 2,
      exactSegmentCount: 2,
      insertBlockCount: 1,
      insertBlockNames: ['PROFILE'],
      insertedSegmentCount: 1,
      layerCount: 2,
      layers: ['CUT', 'ETCH'],
      segmentCount: 2
    });
  });

  it('summarizes endpoint topology for the project rail', () => {
    const document = createPathPlanningDocumentFromDxfEntities(gappedRectangle(0.004), {
      endpointTolerance: 0.01
    });

    const rail = createUpidProjectRail(document);

    expect(rail.summary.topology).toMatchObject({
      ambiguousEndpointClusterCount: 0,
      endpointClusterCount: document.endpointClusters.length,
      snappedEndpointClusterCount: 1,
      snappedEndpointCount: 2
    });
    expect(rail.summary.topology.maxEndpointSnapGap).toBeCloseTo(0.004);
  });

  it('projects snapped endpoint topology rows with selectable path refs', () => {
    const document = createPathPlanningDocumentFromDxfEntities(gappedRectangle(0.004), {
      endpointTolerance: 0.01
    });
    const operation = document.plan.operations[0];

    const rows = readUpidEndpointTopologyRows(document);

    const snappedRows = rows.filter((row) => row.kind === 'snapped-endpoint-cluster');
    expect(snappedRows).toHaveLength(1);
    const row = snappedRows[0];
    expect(row.kind).toBe('snapped-endpoint-cluster');
    if (row.kind !== 'snapped-endpoint-cluster') {
      throw new Error('Expected snapped endpoint topology row.');
    }
    expect(row).toMatchObject({
      kind: 'snapped-endpoint-cluster',
      method: 'within-tolerance',
      memberCount: 2,
      selectRef: {
        operationId: operation.id,
        pathElementId: document.pathElements[0].id,
        pointRole: 'end',
        segmentId: operation.segmentRefs[0].segmentId
      },
      toleranceUsed: 0.01
    });
    expect(row.clusterId).toMatch(/^ec_/);
    expect(row.maxPairDistance).toBeCloseTo(0.004);
    expect(row.radius).toBeCloseTo(0.002);
    expectPointClose(row.point, { x: 10.002, y: 0 });
    expect(row.members.map((member) => member.pointRole)).toEqual(['end', 'start']);
  });

  it('projects open endpoint topology rows with selectable endpoint refs', () => {
    const document = createPathPlanningDocumentFromDxfEntities([line(0, 0, 10, 0)]);
    const operation = document.plan.operations[0];

    const rows = readUpidEndpointTopologyRows(document);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind)).toEqual(['open-endpoint-cluster', 'open-endpoint-cluster']);
    const first = rows[0];
    expect(first.kind).toBe('open-endpoint-cluster');
    if (first.kind !== 'open-endpoint-cluster') {
      throw new Error('Expected open endpoint topology row.');
    }
    expect(first).toMatchObject({
      clusterId: document.endpointClusters[0].id,
      memberCount: 1,
      point: { x: 0, y: 0 },
      selectRef: {
        operationId: operation.id,
        pathElementId: document.pathElements[0].id,
        pointRole: 'start',
        segmentId: operation.segmentRefs[0].segmentId
      }
    });
    expect(rows[1]).toMatchObject({
      kind: 'open-endpoint-cluster',
      point: { x: 10, y: 0 },
      selectRef: {
        pointRole: 'end',
        segmentId: operation.segmentRefs[0].segmentId
      }
    });
  });

  it('projects exact endpoint topology rows with selectable paired endpoint refs', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 10, 10));
    const operation = document.plan.operations[0];

    const rows = readUpidEndpointTopologyRows(document);

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.kind)).toEqual([
      'exact-endpoint-cluster',
      'exact-endpoint-cluster',
      'exact-endpoint-cluster',
      'exact-endpoint-cluster'
    ]);
    const first = rows[0];
    expect(first.kind).toBe('exact-endpoint-cluster');
    if (first.kind !== 'exact-endpoint-cluster') {
      throw new Error('Expected exact endpoint topology row.');
    }
    expect(first).toMatchObject({
      memberCount: 2,
      method: 'exact',
      selectRef: {
        operationId: operation.id,
        pathElementId: document.pathElements[0].id,
        pointRole: 'start'
      }
    });
    expect(first.clusterId).toMatch(/^ec_/);
    expect(first.members).toHaveLength(2);
  });

  it('projects ambiguous endpoint topology rows with diagnostic context', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [
        line(0, 0, 10, 0),
        line(10.009, 0, 20, 0),
        line(10.018, 0, 30, 0)
      ],
      { endpointTolerance: 0.01 }
    );
    const diagnostics = document.diagnostics.filter(
      (candidate) => candidate.code === 'ambiguous-endpoint-cluster'
    );
    const diagnostic = diagnostics[0];

    const rows = readUpidEndpointTopologyRows(document);

    const ambiguousRows = rows.filter((row) => row.kind === 'ambiguous-endpoint-cluster');
    expect(diagnostic).not.toBeUndefined();
    expect(rows.some((row) => row.kind === 'snapped-endpoint-cluster')).toBe(false);
    expect(ambiguousRows).toHaveLength(diagnostics.length);
    const row = ambiguousRows[0];
    expect(row.kind).toBe('ambiguous-endpoint-cluster');
    if (row.kind !== 'ambiguous-endpoint-cluster') {
      throw new Error('Expected ambiguous endpoint topology row.');
    }
    expect(row).toMatchObject({
      diagnosticId: diagnostic!.id,
      kind: 'ambiguous-endpoint-cluster',
      relatedSegmentCount: diagnostic!.relatedSegmentIds!.length,
      selectRef: {
        operationId: document.plan.operations[0].id,
        pathElementId: document.pathElements[0].id,
        segmentId: diagnostic!.relatedSegmentIds![0]
      },
      severity: 'warning',
      toleranceUsed: 0.01
    });
    expect(row.candidateDistances).toContainEqual(expect.closeTo(0.009));
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

  it('resolves selected path refs into root-to-selected path tree lineage', () => {
    const document = createPathPlanningDocumentFromDxfEntities(
      [...rectangleLines(0, 0, 20, 20), ...rectangleLines(5, 5, 10, 10)]
    );
    const rail = createUpidProjectRail(document);
    const exteriorElement = rail.contourTree[0].element;
    const holeElement = rail.contourTree[0].children[0].element;

    expect(
      readUpidPathElementLineage(document, {
        operationId: holeElement.operationId,
        pathElementId: holeElement.id,
        segmentId: holeElement.segmentRefs[0].segmentId
      })?.map((element) => element.displayName)
    ).toEqual(['Exterior 1', 'Hole 1']);
    expect(
      readUpidPathElementLineage(document, {
        operationId: exteriorElement.operationId,
        pathElementId: exteriorElement.id,
        segmentId: null
      })?.map((element) => element.displayName)
    ).toEqual(['Exterior 1']);
  });

  it('resolves selected path refs into sibling tree nodes', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 5, 5),
      ...rectangleLines(20, 0, 25, 5)
    ]);
    const rail = createUpidProjectRail(document);
    const firstRoot = rail.contourTree[0].element;

    expect(
      readUpidPathElementTreeContext(document, {
        operationId: firstRoot.operationId,
        pathElementId: firstRoot.id,
        segmentId: null
      })?.siblings.map((node) => node.element.displayName)
    ).toEqual(['Exterior 2']);
  });

  it('resolves selected path refs into cut-sequence neighbors', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      ...rectangleLines(0, 0, 5, 5),
      ...rectangleLines(20, 0, 25, 5)
    ]);
    const rail = createUpidProjectRail(document);
    const firstElement = rail.cutSequenceElements[0];
    const secondElement = rail.cutSequenceElements[1];

    expect(
      readUpidPathElementSequenceContext(document, {
        operationId: firstElement.operationId,
        pathElementId: firstElement.id,
        segmentId: null
      })
    ).toMatchObject({
      current: {
        element: {
          displayName: firstElement.displayName,
          id: firstElement.id
        },
        index: 0
      },
      next: {
        element: {
          displayName: secondElement.displayName,
          id: secondElement.id
        },
        index: 1
      },
      previous: null
    });
    expect(
      readUpidPathElementSequenceContext(document, {
        operationId: secondElement.operationId,
        pathElementId: secondElement.id,
        segmentId: null
      })
    ).toMatchObject({
      current: {
        element: {
          displayName: secondElement.displayName,
          id: secondElement.id
        },
        index: 1
      },
      next: null,
      previous: {
        element: {
          displayName: firstElement.displayName,
          id: firstElement.id
        },
        index: 0
      }
    });
  });

  it('resolves selected segment refs into path-element segment neighbors', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 5, 5));
    const pathElement = createUpidProjectRail(document).cutSequenceElements[0];
    const firstSegment = pathElement.segmentRefs[0];
    const secondSegment = pathElement.segmentRefs[1];
    const lastSegment = pathElement.segmentRefs[3];

    expect(
      readUpidPathElementSegmentSequenceContext(document, {
        operationId: pathElement.operationId,
        pathElementId: pathElement.id,
        segmentId: firstSegment.segmentId
      })
    ).toMatchObject({
      current: {
        index: 0,
        segment: {
          id: firstSegment.segmentId
        }
      },
      next: {
        index: 1,
        segment: {
          id: secondSegment.segmentId
        }
      },
      previous: {
        index: 3,
        segment: {
          id: lastSegment.segmentId
        }
      },
      wraps: true
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
    expect(rail.summary.manualDecisionCount).toBe(3);
    expect(rail.summary.manualDecisionCounts).toEqual({
      compensation: 0,
      direction: 1,
      'lead-in': 0,
      order: 2,
      role: 0,
      start: 0
    });
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

  it.each([
    {
      severity: 'warning',
      refs: { relatedSegmentIds: 42 }
    },
    {
      severity: 'error',
      refs: { relatedClusterIds: 42 }
    }
  ] as const)(
    'projects malformed $severity diagnostic provenance without throwing',
    ({ severity, refs }) => {
      const document = createPathPlanningDocumentFromDxfEntities(
        rectangleLines(0, 0, 10, 5)
      );
      const diagnostic = {
        id: `diag_malformed_projection_${severity}`,
        severity,
        code: 'review-probe',
        message: 'Malformed projection provenance review probe',
        ...refs
      } as never;
      document.diagnostics.push(diagnostic);
      const operation = document.plan.operations[0];
      const pathElement = document.pathElements[0];

      expect(() => createUpidProjectRail(document)).not.toThrow();
      expect(() => projectUpidPathDiagnostic(document, diagnostic)).not.toThrow();
      expect(() =>
        readUpidPathElementDiagnostics(document, {
          operationId: operation.id,
          pathElementId: pathElement.id,
          segmentId: operation.segmentRefs[0].segmentId
        })
      ).not.toThrow();
      expect(projectUpidPathDiagnostic(document, diagnostic)).toMatchObject({
        relatedChainCount: 0,
        relatedClusterCount: 0,
        relatedContourCount: 0,
        relatedRefs: [],
        relatedSegmentCount: 0,
        selectRef: null
      });
    }
  );

  it('projects diagnostics that affect the selected path geometry', () => {
    const document = createPathPlanningDocumentFromDxfEntities(gappedRectangle(0.004), {
      endpointTolerance: 0.01
    });
    const operation = document.plan.operations[0];
    const pathElement = document.pathElements[0];

    const diagnostics = readUpidPathElementDiagnostics(document, {
      operationId: operation.id,
      pathElementId: pathElement.id,
      pointRole: 'end',
      segmentId: operation.segmentRefs[0].segmentId
    });

    const snapDiagnostic = diagnostics.find((diagnostic) => diagnostic.code === 'endpoint-cluster-snap');

    expect(snapDiagnostic).not.toBeUndefined();
    expect(snapDiagnostic).toMatchObject({
      code: 'endpoint-cluster-snap',
      relatedClusterCount: 1,
      relatedSegmentCount: 2,
      selectRef: {
        operationId: operation.id,
        pathElementId: pathElement.id,
        segmentId: operation.segmentRefs[0].segmentId
      },
      severity: 'warning'
    });
    expect(snapDiagnostic!.id).toMatch(/^diag_cluster_/);
    expect(snapDiagnostic!.metrics).toEqual([
      {
        key: 'tolerance',
        label: 'Tolerance',
        value: 0.01
      },
      {
        key: 'maxPairDistance',
        label: 'Max Gap',
        value: expect.closeTo(0.004)
      }
    ]);
    expect(snapDiagnostic!.relatedRefs).toEqual([
      expect.objectContaining({
        operationId: operation.id,
        pathElementId: pathElement.id,
        pointRole: 'end',
        segmentId: operation.segmentRefs[0].segmentId
      }),
      expect.objectContaining({
        operationId: operation.id,
        pathElementId: pathElement.id,
        pointRole: 'start',
        segmentId: operation.segmentRefs[1].segmentId
      })
    ]);
  });

  it('summarizes diagnostics for contour, segment, and point refs', () => {
    const document = createPathPlanningDocumentFromDxfEntities(gappedRectangle(0.004), {
      endpointTolerance: 0.01
    });
    const operation = document.plan.operations[0];
    const pathElement = document.pathElements[0];
    const [firstSegment, secondSegment, thirdSegment] = operation.segmentRefs;

    expect(
      summarizeUpidDiagnosticsForPathElementRef(document, {
        operationId: operation.id,
        pathElementId: pathElement.id,
        segmentId: null
      })
    ).toEqual({
      count: 2,
      codes: ['endpoint-cluster-snap', 'closed-chain-gap'],
      errorCount: 0,
      firstCode: 'endpoint-cluster-snap',
      ids: expect.arrayContaining([expect.stringMatching(/^diag_cluster_/), expect.stringMatching(/^diag_chain_/)]),
      infoCount: 0,
      severity: 'warning',
      warningCount: 2
    });
    expect(
      summarizeUpidDiagnosticsForPathElementRef(document, {
        operationId: operation.id,
        pathElementId: pathElement.id,
        segmentId: firstSegment.segmentId
      })
    ).toMatchObject({
      count: 2,
      severity: 'warning'
    });
    expect(
      summarizeUpidDiagnosticsForPathElementRef(document, {
        operationId: operation.id,
        pathElementId: pathElement.id,
        segmentId: thirdSegment.segmentId
      })
    ).toMatchObject({
      count: 1,
      severity: 'warning'
    });
    expect(
      summarizeUpidDiagnosticsForPathElementRef(document, {
        operationId: operation.id,
        pathElementId: pathElement.id,
        pointRole: 'end',
        segmentId: firstSegment.segmentId
      })
    ).toMatchObject({
      count: 1,
      severity: 'warning'
    });
    expect(
      summarizeUpidDiagnosticsForPathElementRef(document, {
        operationId: operation.id,
        pathElementId: pathElement.id,
        pointRole: 'start',
        segmentId: firstSegment.segmentId
      })
    ).toMatchObject({
      count: 1,
      severity: 'warning'
    });
    expect(
      summarizeUpidDiagnosticsForPathElementRef(document, {
        operationId: operation.id,
        pathElementId: pathElement.id,
        pointRole: 'start',
        segmentId: secondSegment.segmentId
      })
    ).toMatchObject({
      count: 1,
      severity: 'warning'
    });
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
        pathElementId: 'stale_path_element',
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
        pathElementId: 'stale_path_element',
        travelRole: 'rapid-in',
        segmentId: null
      })
    ).toEqual({
      operationId: operation.id,
      pathElementId: pathElement.id,
      segmentId: null,
      travelRole: 'rapid-in'
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

  it('resolves selected endpoint cluster metadata for snapped path points', () => {
    const document = createPathPlanningDocumentFromDxfEntities(gappedRectangle(0.004), {
      endpointTolerance: 0.01
    });
    const operation = document.plan.operations[0];
    const firstSegmentRef = operation.segmentRefs[0];
    const pathElement = readUpidOperationPathElement(document, operation.id, null);

    const selectedPoint = readUpidSelectedPathPoint(document, pathElement!, {
      operationId: operation.id,
      pathElementId: pathElement!.id,
      pointRole: 'end',
      segmentId: firstSegmentRef.segmentId
    });

    expect(selectedPoint).toMatchObject({
      point: { x: 10, y: 0 },
      role: 'end',
      endpointCluster: {
        rawEndpointSide: 'end',
        method: 'within-tolerance',
        memberCount: 2,
        toleranceUsed: 0.01
      }
    });
    expect(selectedPoint?.endpointCluster?.id).toMatch(/^ec_/);
    expectPointClose(selectedPoint?.endpointCluster?.point, { x: 10.002, y: 0 });
    expect(selectedPoint?.endpointCluster?.radius).toBeCloseTo(0.002);
    expect(selectedPoint?.endpointCluster?.maxPairDistance).toBeCloseTo(0.004);
    expect(selectedPoint?.endpointCluster?.members).toEqual([
      expect.objectContaining({
        operationId: operation.id,
        pathElementId: pathElement!.id,
        pointRole: 'end',
        rawEndpointSide: 'end',
        segmentId: firstSegmentRef.segmentId,
        segmentIndex: 0
      }),
      expect.objectContaining({
        operationId: operation.id,
        pathElementId: pathElement!.id,
        pointRole: 'start',
        rawEndpointSide: 'start',
        segmentId: operation.segmentRefs[1].segmentId,
        segmentIndex: 1
      })
    ]);
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
      kind: 'rapid-in',
      length: 20,
      start: { x: 0, y: 0 }
    });
  });

  it('reads center pierce lead-in travel from operation overrides', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operation = document.plan.operations[0];
    const edited = setCircleOperationCenterPierceLeadIn(document, operation.id)!;

    expect(
      normalizeUpidPathElementSelection(edited, operation.id, {
        operationId: operation.id,
        segmentId: null,
        travelRole: 'lead-in'
      })
    ).toEqual({
      operationId: operation.id,
      pathElementId: edited.pathElements[0].id,
      segmentId: null,
      travelRole: 'lead-in'
    });
    expect(
      readUpidSelectedPathTravel(edited, 0, {
        operationId: operation.id,
        segmentId: null,
        travelRole: 'lead-in'
      })
    ).toEqual({
      end: { x: 15, y: 20 },
      kind: 'lead-in',
      length: 5,
      start: { x: 10, y: 20 }
    });
    expect(summarizeUpidPathDocumentForEditor(edited)).toMatchObject({
      cuttingMoveCount: 1,
      pathCount: 4,
      rapidMoveCount: 1
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

    const summary = summarizeUpidPathDocumentForEditor(document);

    expect(summary).toMatchObject({
      arcMoveCount: 3,
      bounds: {
        maxX: 35,
        minX: 0,
        minY: 0
      },
      cuttingMoveCount: 1,
      pathCount: 6,
      rapidMoveCount: 2
    });
    expect(summary.bounds.maxY).toBeGreaterThanOrEqual(20);
    expect(summary.bounds.maxY).toBeLessThanOrEqual(nextUp(nextUp(20)));
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
    expect(readUpidSelectedPathPoint(document, pathElement!, { ...elementRef, pointRole: 'end' })).toMatchObject({
      endpointCluster: {
        maxPairDistance: 0,
        memberCount: 1,
        method: 'exact',
        radius: 0,
        rawEndpointSide: 'end'
      },
      point: { x: 10, y: 0 },
      role: 'end',
      segmentKind: 'line'
    });
    expect(readUpidPathElementSourceSummary(pathElement!)).toEqual({
      blocks: 'PROFILE',
      entities: '1 entity',
      edits: null,
      exact: 'exact',
      handles: 'BEEF',
      inserts: 'PROFILE / 1 segment',
      layers: 'CUT'
    });
  });

  it('reads selected arc geometry with oriented direction and tangents', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 0, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: 90,
        clockwise: false,
        start: { x: 10, y: 0 },
        end: { x: 0, y: 10 }
      }
    ]);
    const operation = document.plan.operations[0];
    const pathElement = readUpidOperationPathElement(document, operation.id, null);
    const selected = readUpidSelectedPathSegment(document, pathElement!, {
      operationId: operation.id,
      pathElementId: pathElement!.id,
      segmentId: operation.segmentRefs[0].segmentId
    });

    expect(selected?.geometry).toMatchObject({
      kind: 'arc',
      center: { x: 0, y: 0 },
      radius: 10,
      clockwise: false
    });
    if (selected?.geometry.kind !== 'arc') {
      throw new Error('Expected selected segment geometry to be an arc.');
    }
    expect(selected?.geometry.sweepDegrees).toBeCloseTo(90);
    expect(selected?.geometry.startAngleDegrees).toBeCloseTo(0);
    expect(selected?.geometry.endAngleDegrees).toBeCloseTo(90);
    expectPointClose(selected?.geometry.startTangent, { x: 0, y: 1 });
    expectPointClose(selected?.geometry.endTangent, { x: -1, y: 0 });

    const reversed = reversePathOperation(document, operation.id)!;
    const reversedOperation = reversed.plan.operations[0];
    const reversedPathElement = readUpidOperationPathElement(reversed, reversedOperation.id, null);
    const reversedSelected = readUpidSelectedPathSegment(reversed, reversedPathElement!, {
      operationId: reversedOperation.id,
      pathElementId: reversedPathElement!.id,
      segmentId: reversedOperation.segmentRefs[0].segmentId
    });

    expect(reversedSelected?.geometry).toMatchObject({
      kind: 'arc',
      center: { x: 0, y: 0 },
      radius: 10,
      clockwise: true
    });
    if (reversedSelected?.geometry.kind !== 'arc') {
      throw new Error('Expected reversed selected segment geometry to be an arc.');
    }
    expect(reversedSelected?.geometry.sweepDegrees).toBeCloseTo(90);
    expect(reversedSelected?.geometry.startAngleDegrees).toBeCloseTo(90);
    expect(reversedSelected?.geometry.endAngleDegrees).toBeCloseTo(0);
    expectPointClose(reversedSelected?.geometry.startTangent, { x: 1, y: 0 });
    expectPointClose(reversedSelected?.geometry.endTangent, { x: 0, y: -1 });
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
        value: '22.500, 0.000 / split 2 / source seg_0005'
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

function line(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  layer = 'CUT'
): DxfEntity {
  return {
    type: 'line',
    layer,
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}

function expectPointClose(
  actual: { x: number; y: number } | undefined,
  expected: { x: number; y: number }
) {
  expect(actual?.x).toBeCloseTo(expected.x);
  expect(actual?.y).toBeCloseTo(expected.y);
}
