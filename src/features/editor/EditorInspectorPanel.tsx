import {
  ArrowRightFromLine,
  Download,
  Magnet,
  MousePointer2,
  Trash2
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { GCodeStructure } from '@/domain/editor/gcodeStructure';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import type { MagnetizeMode } from '@/domain/path-editor/pathDocumentOperations';
import type { MachineFitResult } from '@/domain/machine/machineFit';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import {
  readUpidManualOverrideRows,
  readUpidPathElementDiagnostics,
  readUpidPathElementPointByRole,
  readUpidPathElementSegmentSequenceContext,
  readUpidPathElementSourceSummary,
  readUpidPathElementSequenceContext,
  readUpidPathElementTreeContext,
  readUpidOperationPathElement,
  readUpidSelectedPathPoint,
  readUpidSelectedPathSegment,
  readUpidSelectedPathTravel,
  type UpidSelectedPathDiagnostic,
  type UpidSelectedPathSegmentGeometry
} from '@/domain/upid/projectRail';
import type { MachineProfile } from '@/domain/workbench/types';

import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';
import type { EditorPathElementRef } from './EditorPathNavigatorPanel';

type MeasurementExportFormat = 'csv' | 'gcode' | 'iso';
type CanvasMouseMode = 'select' | 'point';

interface EditorInspectorPanelProps {
  arcMoveCount: number;
  boundsText: string;
  cuttingMoveCount: number;
  draftProgram: LoadedEditorProgram | null;
  editorFileName: string;
  gridSnapEnabled: boolean;
  canvasMouseMode: CanvasMouseMode;
  guideHighlightTarget: EditorGuideTarget | null;
  fullHeight?: boolean;
  isSaving: boolean;
  machineFit: MachineFitResult | null;
  machineProfile: MachineProfile | null;
  measurementPoints: MeasurementPoint[];
  pathCount: number;
  pathConstructionMode?: MagnetizeMode | null;
  pathDocument: PathPlanningDocument | null;
  pointXDraft: string;
  pointYDraft: string;
  previewCursorPoint: { x: number; y: number } | null;
  program: LoadedEditorProgram | null;
  rapidMoveCount: number;
  renderWorkspacePanel?: (
    id: string,
    title: string,
    children: ReactNode,
    options?: { fill?: boolean }
  ) => ReactNode;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  structure: GCodeStructure | null;
  canInsertMeasurementPoints?: boolean;
  canReimportDxfUnits?: boolean;
  reimportDxfUnitsDisabledReason?: string | null;
  onAddMeasurementPoint: () => void;
  onActivatePathConstructionMode?: (mode: MagnetizeMode | null) => void;
  onClearMeasurementPoints: () => void;
  onDeleteMeasurementPoint: (pointId: string) => void;
  onExportMeasurementPoints: (format: MeasurementExportFormat) => void;
  onHoverPathElement?: (element: EditorPathElementRef | null) => void;
  onInsertMeasurementPoints: () => void;
  onReimportDxfUnits?: () => void | Promise<void>;
  onPointXDraftChange: (value: string) => void;
  onPointYDraftChange: (value: string) => void;
  onSelectPathElement?: (element: EditorPathElementRef) => void;
  onSetCanvasMouseMode: (mode: CanvasMouseMode) => void;
  onToggleGridSnap: () => void;
}

export function EditorInspectorPanel({
  arcMoveCount,
  boundsText,
  cuttingMoveCount,
  draftProgram,
  editorFileName,
  gridSnapEnabled,
  canvasMouseMode,
  guideHighlightTarget,
  fullHeight = false,
  isSaving,
  machineFit,
  machineProfile,
  measurementPoints,
  pathCount,
  pathConstructionMode = null,
  pathDocument,
  pointXDraft,
  pointYDraft,
  previewCursorPoint,
  program,
  rapidMoveCount,
  renderWorkspacePanel = (_id, _title, children) => children,
  selectedPathElement,
  selectedPathOperationId,
  structure,
  canInsertMeasurementPoints = true,
  canReimportDxfUnits = false,
  reimportDxfUnitsDisabledReason = null,
  onAddMeasurementPoint,
  onActivatePathConstructionMode,
  onClearMeasurementPoints,
  onDeleteMeasurementPoint,
  onExportMeasurementPoints,
  onHoverPathElement,
  onInsertMeasurementPoints,
  onReimportDxfUnits,
  onPointXDraftChange,
  onPointYDraftChange,
  onSelectPathElement,
  onSetCanvasMouseMode,
  onToggleGridSnap
}: EditorInspectorPanelProps) {
  const selectedPathOperationIndex =
    pathDocument?.plan.operations.findIndex((operation) => operation.id === selectedPathOperationId) ?? -1;
  const selectedPathOperation =
    selectedPathOperationIndex >= 0 ? pathDocument?.plan.operations[selectedPathOperationIndex] : null;
  const selectedPathElementModel = selectedPathOperation
    ? readUpidOperationPathElement(pathDocument, selectedPathOperation.id, selectedPathElement?.pathElementId)
    : null;
  const selectedPathSegment = selectedPathElementModel
    ? readUpidSelectedPathSegment(pathDocument, selectedPathElementModel, selectedPathElement)
    : null;
  const selectedPathPoint = selectedPathElementModel
    ? readUpidSelectedPathPoint(pathDocument, selectedPathElementModel, selectedPathElement)
    : null;
  const selectedPathTravel = selectedPathOperation
    ? readUpidSelectedPathTravel(pathDocument, selectedPathOperationIndex, selectedPathElement)
    : null;
  const selectedPathOverrideRows = selectedPathElementModel
    ? readUpidManualOverrideRows(selectedPathElementModel.overrides)
    : [];
  const selectedPathSource = selectedPathElementModel
    ? readUpidPathElementSourceSummary(selectedPathElementModel)
    : null;
  const selectedPathTreeContext = pathDocument && selectedPathElementModel
    ? readUpidPathElementTreeContext(pathDocument, {
        operationId: selectedPathElementModel.operationId,
        pathElementId: selectedPathElementModel.id,
        segmentId: selectedPathElement?.segmentId ?? null
      })
    : null;
  const selectedPathTreeNode = selectedPathTreeContext?.node ?? null;
  const selectedPathLineage = selectedPathTreeContext?.lineage ?? [];
  const selectedPathSequenceContext = pathDocument && selectedPathElementModel
    ? readUpidPathElementSequenceContext(pathDocument, {
        operationId: selectedPathElementModel.operationId,
        pathElementId: selectedPathElementModel.id,
        segmentId: selectedPathElement?.segmentId ?? null
      })
    : null;
  const selectedPathSegmentSequenceContext = pathDocument && selectedPathElementModel && selectedPathElement?.segmentId
    ? readUpidPathElementSegmentSequenceContext(pathDocument, {
        operationId: selectedPathElementModel.operationId,
        pathElementId: selectedPathElementModel.id,
        segmentId: selectedPathElement.segmentId
      })
    : null;
  const selectedPathDiagnostics = pathDocument && selectedPathElement
    ? readUpidPathElementDiagnostics(pathDocument, selectedPathElement)
    : [];
  const selectedPathStart = selectedPathElementModel
    ? readUpidPathElementPointByRole(selectedPathElementModel, 'start')
    : null;
  const selectedPathEnd = selectedPathElementModel
    ? readUpidPathElementPointByRole(selectedPathElementModel, 'end')
    : null;
  const draftParseResult = draftProgram?.parseResult ?? null;

  return (
    <div
      className={`work-region-scrollbar ${fullHeight ? 'h-full min-h-0' : 'max-h-[42vh] border-t border-border'} overflow-y-auto p-2 text-[10px]`}
      data-editor-inspector-summary
    >
      {renderWorkspacePanel('position', 'Position', (
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold">Position</h3>
          <button
            aria-label="Toggle preview grid snap"
            aria-pressed={gridSnapEnabled}
            className={`inline-flex h-6 items-center gap-1 border px-2 font-mono text-[10px] outline-none transition hover:bg-accent ${
              gridSnapEnabled ? 'border-primary text-primary' : 'border-border text-muted-foreground'
            } ${guideHighlightClass('grid-snap', guideHighlightTarget)}`}
            data-editor-grid-snap
            {...guideTargetProps('grid-snap', guideHighlightTarget)}
            onClick={onToggleGridSnap}
            title="Snap cursor and measurement clicks to the 5 mm preview grid"
            type="button"
          >
            <Magnet className="size-3" />
            {gridSnapEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
          <dt className="text-muted-foreground">Mouse X</dt>
          <dd data-editor-cursor="x">{formatCursorCoordinate(previewCursorPoint?.x)}</dd>
          <dt className="text-muted-foreground">Mouse Y</dt>
          <dd data-editor-cursor="y">{formatCursorCoordinate(previewCursorPoint?.y)}</dd>
        </dl>
      </section>
      ))}

      {renderWorkspacePanel('statistics', 'Statistics', (
      <details data-editor-stats-section open>
        <summary className="cursor-pointer select-none font-mono text-[11px] font-semibold outline-none hover:text-foreground">
          Statistics
        </summary>
        <section className="mt-2">
          {pathDocument ? (
            <>
              <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">UPID</h3>
              <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
                <dt className="text-muted-foreground">Operations</dt>
                <dd data-upid-stat="operations">{pathDocument.plan.operations.length}</dd>
                <dt className="text-muted-foreground">Contours</dt>
                <dd data-upid-stat="contours">{pathDocument.contours.length}</dd>
                <dt className="text-muted-foreground">Segments</dt>
                <dd data-upid-stat="segments">{pathDocument.segments.length}</dd>
                <dt className="text-muted-foreground">Cut Length</dt>
                <dd data-upid-stat="cut-length">{pathDocument.plan.metrics.totalCutLength.toFixed(3)}</dd>
                <dt className="text-muted-foreground">Rapid</dt>
                <dd data-upid-stat="rapid-length">{pathDocument.plan.metrics.totalRapidLength.toFixed(3)}</dd>
                <dt className="text-muted-foreground">Bounds</dt>
                <dd data-editor-stat="bounds">{boundsText}</dd>
                <dt className="text-muted-foreground">File</dt>
                <dd className="truncate" data-editor-stat="file" title={program?.filePath}>
                  {editorFileName}
                </dd>
              </dl>
            </>
          ) : draftParseResult ? (
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
              <dt className="col-span-2 mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                Program
              </dt>
              <dt className="text-muted-foreground">Path</dt>
              <dd>
                <span data-editor-stat="total-moves">{pathCount}</span>{' '}
                {pathCount === 1 ? 'path item' : 'path items'}
              </dd>
              <dt className="text-muted-foreground">Rapid</dt>
              <dd data-editor-stat="rapid-moves">{rapidMoveCount}</dd>
              <dt className="text-muted-foreground">Cutting</dt>
              <dd data-editor-stat="cutting-moves">{cuttingMoveCount}</dd>
              <dt className="text-muted-foreground">Arcs</dt>
              <dd data-editor-stat="arc-moves">{arcMoveCount}</dd>
              <dt className="text-muted-foreground">Bounds</dt>
              <dd data-editor-stat="bounds">{boundsText}</dd>
              <dt className="text-muted-foreground">File</dt>
              <dd className="truncate" data-editor-stat="file" title={program?.filePath}>
                {editorFileName}
              </dd>
              <dt className="text-muted-foreground">Lines</dt>
              <dd>{draftParseResult.stats.totalLines}</dd>
              <dt className="text-muted-foreground">Linear</dt>
              <dd>{draftParseResult.stats.linearMoves}</dd>
              <dt className="text-muted-foreground">Warnings</dt>
              <dd>{draftParseResult.warnings.length}</dd>
              <dt className="text-muted-foreground">Errors</dt>
              <dd>{draftParseResult.errors.length}</dd>
            </dl>
          ) : (
            <p className="border border-border bg-background/50 p-2 text-muted-foreground">
              Import `.gcode`, `.nc`, `.iso`, or `.txt` to preview and edit it.
            </p>
          )}
        </section>

        {pathDocument && selectedPathElementModel && (
          <section
            className="mt-3 border-t border-border pt-3"
            data-upid-path-element-id={selectedPathElementModel.id}
            data-upid-selected-geometry
          >
            <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Selected Geometry</h3>
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
              <dt className="text-muted-foreground">Element</dt>
              <dd data-upid-selected="label">{selectedPathElementModel.displayName}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd data-upid-selected="source-label">{selectedPathElementModel.label}</dd>
              <dt className="text-muted-foreground">Contour</dt>
              <dd data-upid-selected="classification">{selectedPathElementModel.classification}</dd>
              <dt className="text-muted-foreground">Kind</dt>
              <dd data-upid-selected="kind">
                {selectedPathElementModel.closed ? 'closed contour' : 'open chain'}
              </dd>
              <dt className="text-muted-foreground">Direction</dt>
              <dd data-upid-selected="direction">{selectedPathElementModel.direction}</dd>
              <dt className="text-muted-foreground">Planning</dt>
              <dd data-upid-selected="planning-mode">
                {formatOperationOrderStrategy(pathDocument.options.operationOrderStrategy)}
              </dd>
              <dt className="text-muted-foreground">Sequence</dt>
              <dd data-upid-selected="sequence">
                {selectedPathElementModel.orderIndex + 1} / {pathDocument.plan.operations.length}
              </dd>
              <dt className="text-muted-foreground">Order</dt>
              <dd data-upid-selected="order-source">
                {selectedPathElementModel.overrides?.order ? 'Manual order' : 'Automatic order'}
              </dd>
              <dt className="text-muted-foreground">Nest</dt>
              <dd data-upid-selected="nest">
                depth {selectedPathElementModel.containmentDepth}
              </dd>
              <dt className="text-muted-foreground">Children</dt>
              <dd data-upid-selected="children">{selectedPathElementModel.childIds.length}</dd>
              <dt className="text-muted-foreground">Segments</dt>
              <dd data-upid-selected="segments">
                {selectedPathElementModel.segmentRefs.length}{' '}
                {selectedPathElementModel.segmentRefs.length === 1 ? 'segment' : 'segments'}
              </dd>
              <dt className="text-muted-foreground">Entities</dt>
              <dd data-upid-selected="source-entities">{selectedPathSource?.entities ?? '0 entities'}</dd>
              <dt className="text-muted-foreground">Layers</dt>
              <dd data-upid-selected="source-layers">{selectedPathSource?.layers ?? '-'}</dd>
              <dt className="text-muted-foreground">Exact</dt>
              <dd data-upid-selected="source-exact">{selectedPathSource?.exact ?? '-'}</dd>
              {selectedPathSource?.edits && (
                <>
                  <dt className="text-muted-foreground">Edits</dt>
                  <dd data-upid-selected="source-edits">{selectedPathSource.edits}</dd>
                </>
              )}
              {selectedPathSource?.blocks && (
                <>
                  <dt className="text-muted-foreground">Blocks</dt>
                  <dd data-upid-selected="source-blocks">{selectedPathSource.blocks}</dd>
                </>
              )}
              {selectedPathSource?.handles && (
                <>
                  <dt className="text-muted-foreground">Handles</dt>
                  <dd data-upid-selected="source-handles">{selectedPathSource.handles}</dd>
                </>
              )}
              {selectedPathSource?.inserts && (
                <>
                  <dt className="text-muted-foreground">Inserts</dt>
                  <dd data-upid-selected="source-inserts">{selectedPathSource.inserts}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Cut</dt>
              <dd data-upid-selected="cut-length">{selectedPathElementModel.metrics.cutLength.toFixed(3)}</dd>
              <dt className="text-muted-foreground">Start</dt>
              <dd data-upid-selected="start">{selectedPathStart ? formatPoint(selectedPathStart.point) : '-'}</dd>
              <dt className="text-muted-foreground">End</dt>
              <dd data-upid-selected="end">{selectedPathEnd ? formatPoint(selectedPathEnd.point) : '-'}</dd>
            </dl>
            {selectedPathTreeNode && (
              <section
                className="mt-3 border-t border-border pt-3"
                data-upid-path-element-id={selectedPathTreeNode.element.id}
                data-upid-selected-tree-context
              >
                <h4 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  Path Tree Context
                </h4>
                <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
                  <dt className="text-muted-foreground">Lineage</dt>
                  <dd
                    className="flex min-w-0 flex-wrap gap-1"
                    data-upid-lineage-depth={selectedPathLineage.length}
                    data-upid-selected="tree-lineage"
                  >
                    {selectedPathLineage.map((element, index) => (
                      <span className="inline-flex items-center gap-1" key={element.id}>
                        {index > 0 && <span className="text-muted-foreground"> / </span>}
                        <button
                          aria-label={`Select lineage ${element.displayName}`}
                          className="text-left text-foreground underline-offset-2 outline-none hover:text-primary hover:underline"
                          data-upid-lineage-item={element.id}
                          onClick={() =>
                            onSelectPathElement?.({
                              operationId: element.operationId,
                              pathElementId: element.id,
                              segmentId: null
                            })
                          }
                          onMouseEnter={() =>
                            onHoverPathElement?.({
                              operationId: element.operationId,
                              pathElementId: element.id,
                              segmentId: null
                            })
                          }
                          onMouseLeave={() => onHoverPathElement?.(null)}
                          type="button"
                        >
                          {element.displayName}
                        </button>
                      </span>
                    ))}
                  </dd>
                  {selectedPathSequenceContext && (
                    <>
                      <dt className="text-muted-foreground">Cut Seq</dt>
                      <dd
                        className="flex min-w-0 flex-wrap items-center gap-1"
                        data-upid-selected="sequence-neighbors"
                        data-upid-sequence-current={selectedPathSequenceContext.current.element.id}
                      >
                        {selectedPathSequenceContext.previous ? (
                          <button
                            aria-label={`Select previous cut sequence ${selectedPathSequenceContext.previous.element.displayName}`}
                            className="text-left text-muted-foreground underline-offset-2 outline-none hover:text-primary hover:underline"
                            data-upid-sequence-previous={selectedPathSequenceContext.previous.element.id}
                            onClick={() =>
                              onSelectPathElement?.({
                                operationId: selectedPathSequenceContext.previous!.element.operationId,
                                pathElementId: selectedPathSequenceContext.previous!.element.id,
                                segmentId: null
                              })
                            }
                            onMouseEnter={() =>
                              onHoverPathElement?.({
                                operationId: selectedPathSequenceContext.previous!.element.operationId,
                                pathElementId: selectedPathSequenceContext.previous!.element.id,
                                segmentId: null
                              })
                            }
                            onMouseLeave={() => onHoverPathElement?.(null)}
                            type="button"
                          >
                            Prev {selectedPathSequenceContext.previous.index + 1}
                          </button>
                        ) : (
                          <span className="text-muted-foreground" data-upid-sequence-boundary="start">
                            Start
                          </span>
                        )}
                        <span className="text-muted-foreground">/</span>
                        <span data-upid-sequence-current-label>
                          {selectedPathSequenceContext.current.index + 1}.{' '}
                          {selectedPathSequenceContext.current.element.displayName}
                        </span>
                        <span className="text-muted-foreground">/</span>
                        {selectedPathSequenceContext.next ? (
                          <button
                            aria-label={`Select next cut sequence ${selectedPathSequenceContext.next.element.displayName}`}
                            className="text-left text-muted-foreground underline-offset-2 outline-none hover:text-primary hover:underline"
                            data-upid-sequence-next={selectedPathSequenceContext.next.element.id}
                            onClick={() =>
                              onSelectPathElement?.({
                                operationId: selectedPathSequenceContext.next!.element.operationId,
                                pathElementId: selectedPathSequenceContext.next!.element.id,
                                segmentId: null
                              })
                            }
                            onMouseEnter={() =>
                              onHoverPathElement?.({
                                operationId: selectedPathSequenceContext.next!.element.operationId,
                                pathElementId: selectedPathSequenceContext.next!.element.id,
                                segmentId: null
                              })
                            }
                            onMouseLeave={() => onHoverPathElement?.(null)}
                            type="button"
                          >
                            Next {selectedPathSequenceContext.next.index + 1}
                          </button>
                        ) : (
                          <span className="text-muted-foreground" data-upid-sequence-boundary="end">
                            End
                          </span>
                        )}
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Direct Segs</dt>
                  <dd data-upid-selected="tree-direct-segments">
                    {selectedPathTreeNode.treeMetrics.directSegmentCount}
                  </dd>
                  <dt className="text-muted-foreground">Nested</dt>
                  <dd data-upid-selected="tree-descendants">
                    {selectedPathTreeNode.treeMetrics.descendantCount}
                  </dd>
                  <dt className="text-muted-foreground">Total Segs</dt>
                  <dd data-upid-selected="tree-total-segments">
                    {selectedPathTreeNode.treeMetrics.totalSegmentCount}
                  </dd>
                  {selectedPathTreeNode.children.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">Child Paths</dt>
                      <dd className="flex min-w-0 flex-wrap gap-1" data-upid-selected="tree-children">
                        {selectedPathTreeNode.children.map((child) => (
                          <button
                            aria-label={`Select child ${child.element.displayName}`}
                            className="text-left text-foreground underline-offset-2 outline-none hover:text-primary hover:underline"
                            data-upid-child-path-element={child.element.id}
                            key={child.element.id}
                            onClick={() =>
                              onSelectPathElement?.({
                                operationId: child.element.operationId,
                                pathElementId: child.element.id,
                                segmentId: null
                              })
                            }
                            onMouseEnter={() =>
                              onHoverPathElement?.({
                                operationId: child.element.operationId,
                                pathElementId: child.element.id,
                                segmentId: null
                              })
                            }
                            onMouseLeave={() => onHoverPathElement?.(null)}
                            type="button"
                          >
                            {child.element.displayName}
                          </button>
                        ))}
                      </dd>
                    </>
                  )}
                  {selectedPathTreeContext && selectedPathTreeContext.siblings.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">Sibling Paths</dt>
                      <dd className="flex min-w-0 flex-wrap gap-1" data-upid-selected="tree-siblings">
                        {selectedPathTreeContext.siblings.map((sibling) => (
                          <button
                            aria-label={`Select sibling ${sibling.element.displayName}`}
                            className="text-left text-foreground underline-offset-2 outline-none hover:text-primary hover:underline"
                            data-upid-sibling-path-element={sibling.element.id}
                            key={sibling.element.id}
                            onClick={() =>
                              onSelectPathElement?.({
                                operationId: sibling.element.operationId,
                                pathElementId: sibling.element.id,
                                segmentId: null
                              })
                            }
                            onMouseEnter={() =>
                              onHoverPathElement?.({
                                operationId: sibling.element.operationId,
                                pathElementId: sibling.element.id,
                                segmentId: null
                              })
                            }
                            onMouseLeave={() => onHoverPathElement?.(null)}
                            type="button"
                          >
                            {sibling.element.displayName}
                          </button>
                        ))}
                      </dd>
                    </>
                  )}
                </dl>
              </section>
            )}
          </section>
        )}

        {selectedPathOverrideRows.length > 0 && (
          <section className="mt-3 border-t border-border pt-3" data-upid-selected-overrides>
            <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Manual Decisions</h3>
            <div className="grid gap-1">
              {selectedPathOverrideRows.map((row) => (
                <div
                  className="grid grid-cols-[78px_minmax(0,1fr)] gap-1.5"
                  data-upid-manual-override={row.kind}
                  key={row.kind}
                >
                  <span className="text-muted-foreground">{row.label}</span>
                  <span>{row.value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {selectedPathDiagnostics.length > 0 && (
          <section className="mt-3 border-t border-border pt-3" data-upid-selected-diagnostics>
            <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">
              Selection Diagnostics
            </h3>
            <div className="grid gap-1">
              {selectedPathDiagnostics.map((diagnostic) =>
                renderSelectedPathDiagnosticRow({
                  diagnostic,
                  onHoverPathElement,
                  onSelectPathElement
                })
              )}
            </div>
          </section>
        )}

        {selectedPathTravel && (
          <section className="mt-3 border-t border-border pt-3" data-upid-selected-travel>
            <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Selected Travel</h3>
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
              <dt className="text-muted-foreground">Kind</dt>
              <dd data-upid-selected-travel="kind">{selectedPathTravel.kind}</dd>
              <dt className="text-muted-foreground">Length</dt>
              <dd data-upid-selected-travel="length">{selectedPathTravel.length.toFixed(3)}</dd>
              <dt className="text-muted-foreground">Start</dt>
              <dd data-upid-selected-travel="start">{formatPoint(selectedPathTravel.start)}</dd>
              <dt className="text-muted-foreground">End</dt>
              <dd data-upid-selected-travel="end">{formatPoint(selectedPathTravel.end)}</dd>
            </dl>
          </section>
        )}

        {selectedPathSegment && (
          <section
            className="mt-3 border-t border-border pt-3"
            data-upid-selected-segment
            data-upid-selected-segment-geometry={selectedPathSegment.geometry.kind}
            data-upid-selected-segment-id={
              selectedPathSegmentSequenceContext?.current.segment.id ?? selectedPathElement?.segmentId
            }
            data-upid-selected-segment-index={selectedPathSegmentSequenceContext?.current.index}
          >
            <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Selected Segment</h3>
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
              <dt className="text-muted-foreground">Type</dt>
              <dd data-upid-selected-segment-kind>{selectedPathSegment.kind}</dd>
              {selectedPathSegmentSequenceContext && (
                <>
                  <dt className="text-muted-foreground">Segment Seq</dt>
                  <dd
                    className="flex min-w-0 flex-wrap items-center gap-1"
                    data-upid-selected-segment="sequence-neighbors"
                    data-upid-segment-current={selectedPathSegmentSequenceContext.current.segment.id}
                  >
                    {selectedPathSegmentSequenceContext.previous ? (
                      <button
                        aria-label={`Select previous segment ${
                          selectedPathSegmentSequenceContext.previous.index + 1
                        } in ${selectedPathSegmentSequenceContext.element.displayName}`}
                        className="text-left text-muted-foreground underline-offset-2 outline-none hover:text-primary hover:underline"
                        data-upid-segment-previous={selectedPathSegmentSequenceContext.previous.segment.id}
                        onClick={() =>
                          onSelectPathElement?.({
                            operationId: selectedPathSegmentSequenceContext.element.operationId,
                            pathElementId: selectedPathSegmentSequenceContext.element.id,
                            segmentId: selectedPathSegmentSequenceContext.previous!.segment.id
                          })
                        }
                        onMouseEnter={() =>
                          onHoverPathElement?.({
                            operationId: selectedPathSegmentSequenceContext.element.operationId,
                            pathElementId: selectedPathSegmentSequenceContext.element.id,
                            segmentId: selectedPathSegmentSequenceContext.previous!.segment.id
                          })
                        }
                        onMouseLeave={() => onHoverPathElement?.(null)}
                        type="button"
                      >
                        Prev {selectedPathSegmentSequenceContext.previous.index + 1}
                      </button>
                    ) : (
                      <span className="text-muted-foreground" data-upid-segment-boundary="start">
                        Start
                      </span>
                    )}
                    <span className="text-muted-foreground">/</span>
                    <span data-upid-segment-current-label>
                      {selectedPathSegmentSequenceContext.current.index + 1}.{' '}
                      {selectedPathSegmentSequenceContext.current.segment.kind}
                    </span>
                    <span className="text-muted-foreground">/</span>
                    {selectedPathSegmentSequenceContext.next ? (
                      <button
                        aria-label={`Select next segment ${
                          selectedPathSegmentSequenceContext.next.index + 1
                        } in ${selectedPathSegmentSequenceContext.element.displayName}`}
                        className="text-left text-muted-foreground underline-offset-2 outline-none hover:text-primary hover:underline"
                        data-upid-segment-next={selectedPathSegmentSequenceContext.next.segment.id}
                        onClick={() =>
                          onSelectPathElement?.({
                            operationId: selectedPathSegmentSequenceContext.element.operationId,
                            pathElementId: selectedPathSegmentSequenceContext.element.id,
                            segmentId: selectedPathSegmentSequenceContext.next!.segment.id
                          })
                        }
                        onMouseEnter={() =>
                          onHoverPathElement?.({
                            operationId: selectedPathSegmentSequenceContext.element.operationId,
                            pathElementId: selectedPathSegmentSequenceContext.element.id,
                            segmentId: selectedPathSegmentSequenceContext.next!.segment.id
                          })
                        }
                        onMouseLeave={() => onHoverPathElement?.(null)}
                        type="button"
                      >
                        Next {selectedPathSegmentSequenceContext.next.index + 1}
                      </button>
                    ) : (
                      <span className="text-muted-foreground" data-upid-segment-boundary="end">
                        End
                      </span>
                    )}
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Direction</dt>
              <dd>{selectedPathSegment.reversed ? 'reversed' : 'forward'}</dd>
              <dt className="text-muted-foreground">Layer</dt>
              <dd>{selectedPathSegment.layer ?? '-'}</dd>
              <dt className="text-muted-foreground">Length</dt>
              <dd>{selectedPathSegment.length.toFixed(3)}</dd>
              {renderSelectedSegmentGeometry(selectedPathSegment.geometry)}
              <dt className="text-muted-foreground">Start</dt>
              <dd>{formatPoint(selectedPathSegment.start)}</dd>
              <dt className="text-muted-foreground">End</dt>
              <dd>{formatPoint(selectedPathSegment.end)}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd data-upid-selected-segment-source="type">{selectedPathSegment.source.type}</dd>
              <dt className="text-muted-foreground">Entity</dt>
              <dd data-upid-selected-segment-source="entity">{selectedPathSegment.source.entityIndex}</dd>
              {selectedPathSegment.source.handle && (
                <>
                  <dt className="text-muted-foreground">Handle</dt>
                  <dd data-upid-selected-segment-source="handle">{selectedPathSegment.source.handle}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Part</dt>
              <dd data-upid-selected-segment-source="sub">{selectedPathSegment.source.subIndex ?? '-'}</dd>
              <dt className="text-muted-foreground">Exact</dt>
              <dd data-upid-selected-segment-source="exact">
                {selectedPathSegment.source.exact ? 'exact' : 'approximated'}
              </dd>
              {selectedPathSegment.source.edit && (
                <>
                  <dt className="text-muted-foreground">Edit</dt>
                  <dd data-upid-selected-segment-source-edit-kind>
                    {selectedPathSegment.source.edit.kind}
                  </dd>
                  <dt className="text-muted-foreground">Parent</dt>
                  <dd data-upid-selected-segment-source-edit-parent>
                    {selectedPathSegment.source.edit.parentSegmentId}
                  </dd>
                  <dt className="text-muted-foreground">Split At</dt>
                  <dd data-upid-selected-segment-source-edit-point>
                    {formatPoint(selectedPathSegment.source.edit.point)}
                  </dd>
                </>
              )}
              {selectedPathSegment.source.block && (
                <>
                  <dt className="text-muted-foreground">Block</dt>
                  <dd data-upid-selected-segment-source="block">{selectedPathSegment.source.block}</dd>
                </>
              )}
              {selectedPathSegment.source.insert && (
                <>
                  <dt className="text-muted-foreground">Insert</dt>
                  <dd data-upid-selected-segment-source="insert">{selectedPathSegment.source.insert}</dd>
                </>
              )}
            </dl>
          </section>
        )}

        {selectedPathPoint && (
          <section className="mt-3 border-t border-border pt-3" data-upid-selected-point>
            <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Selected Point</h3>
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
              <dt className="text-muted-foreground">Role</dt>
              <dd data-upid-selected-point-role>{selectedPathPoint.role}</dd>
              <dt className="text-muted-foreground">Segment</dt>
              <dd>{selectedPathPoint.segmentKind}</dd>
              <dt className="text-muted-foreground">Point</dt>
              <dd data-upid-selected-point-coordinate>{formatPoint(selectedPathPoint.point)}</dd>
              {selectedPathPoint.endpointCluster && (
                <>
                  <dt className="text-muted-foreground">Cluster</dt>
                  <dd data-upid-selected-point-cluster>{selectedPathPoint.endpointCluster.id}</dd>
                  <dt className="text-muted-foreground">Method</dt>
                  <dd data-upid-selected-point-cluster-method>
                    {selectedPathPoint.endpointCluster.method}
                  </dd>
                  <dt className="text-muted-foreground">Members</dt>
                  <dd data-upid-selected-point-cluster-members>
                    {selectedPathPoint.endpointCluster.memberCount}
                  </dd>
                  <dt className="text-muted-foreground">Raw Side</dt>
                  <dd data-upid-selected-point-cluster-side>
                    {selectedPathPoint.endpointCluster.rawEndpointSide}
                  </dd>
                  <dt className="text-muted-foreground">Cluster Pt</dt>
                  <dd data-upid-selected-point-cluster-point>
                    {formatPoint(selectedPathPoint.endpointCluster.point)}
                  </dd>
                  <dt className="text-muted-foreground">Radius</dt>
                  <dd data-upid-selected-point-cluster-radius>
                    {formatNumber(selectedPathPoint.endpointCluster.radius)}
                  </dd>
                  <dt className="text-muted-foreground">Gap</dt>
                  <dd data-upid-selected-point-cluster-gap>
                    {formatNumber(selectedPathPoint.endpointCluster.maxPairDistance)}
                  </dd>
                  <dt className="text-muted-foreground">Tolerance</dt>
                  <dd data-upid-selected-point-cluster-tolerance>
                    {formatNumber(selectedPathPoint.endpointCluster.toleranceUsed)}
                  </dd>
                  <dt className="text-muted-foreground">Cluster Ends</dt>
                  <dd
                    className="flex min-w-0 flex-wrap gap-1"
                    data-upid-selected-point-cluster-member-list
                  >
                    {selectedPathPoint.endpointCluster.members.map((member, index) =>
                      member.operationId && member.pointRole ? (
                        <button
                          aria-label={`Select cluster member ${index + 1} ${member.pointRole}`}
                          className="text-left text-foreground underline-offset-2 outline-none hover:text-primary hover:underline"
                          data-upid-cluster-member-index={index}
                          data-upid-cluster-member-operation={member.operationId}
                          data-upid-cluster-member-side={member.rawEndpointSide}
                          data-upid-cluster-member-segment={member.segmentId}
                          data-upid-cluster-member-segment-index={member.segmentIndex ?? undefined}
                          data-upid-selected-point-cluster-member
                          key={`${member.segmentId}-${member.rawEndpointSide}`}
                          onClick={() =>
                            onSelectPathElement?.({
                              operationId: member.operationId,
                              pathElementId: member.pathElementId,
                              pointRole: member.pointRole,
                              segmentId: member.segmentId
                            })
                          }
                          onMouseEnter={() =>
                            onHoverPathElement?.({
                              operationId: member.operationId,
                              pathElementId: member.pathElementId,
                              pointRole: member.pointRole,
                              segmentId: member.segmentId
                            })
                          }
                          onMouseLeave={() => onHoverPathElement?.(null)}
                          type="button"
                        >
                          {index + 1} {member.pointRole} {formatPoint(member.point)}
                        </button>
                      ) : (
                        <span
                          className="text-muted-foreground"
                          data-upid-cluster-member-side={member.rawEndpointSide}
                          data-upid-cluster-member-segment={member.segmentId}
                          data-upid-selected-point-cluster-member
                          key={`${member.segmentId}-${member.rawEndpointSide}`}
                        >
                          {index + 1} {member.rawEndpointSide} {formatPoint(member.point)}
                        </span>
                      )
                    )}
                  </dd>
                </>
              )}
            </dl>
          </section>
        )}

        {!pathDocument && structure && (
          <section className="mt-3 border-t border-border pt-3">
            <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Structure</h3>
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
              <dt className="text-muted-foreground">Header</dt>
              <dd data-editor-structure="header">{structure.header.lines.length}</dd>
              <dt className="text-muted-foreground">Body</dt>
              <dd data-editor-structure="body">{structure.body.lines.length}</dd>
              <dt className="text-muted-foreground">Footer</dt>
              <dd data-editor-structure="footer">{structure.footer.lines.length}</dd>
              <dt className="text-muted-foreground">Groups</dt>
              <dd data-editor-structure="groups">{structure.body.contours?.length ?? 0}</dd>
            </dl>
          </section>
        )}

        {!pathDocument && draftParseResult &&
          (draftParseResult.errors.length > 0 ||
            draftParseResult.warnings.length > 0) && (
            <section className="mt-3 border-t border-border pt-3">
              <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Parse Issues</h3>
              <div className="max-h-32 overflow-auto border border-border bg-background/50">
                {[...draftParseResult.errors, ...draftParseResult.warnings].map(
                  (issue, index) => (
                    <div
                      className="border-b border-border px-2 py-1.5 last:border-b-0"
                      data-editor-parse-issue={index}
                      key={`${issue.type}-${issue.line}-${issue.message}-${index}`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] uppercase">
                        <span className={issue.type === 'error' ? 'text-destructive' : 'text-amber-300'}>
                          {issue.type}
                        </span>
                        <span className="text-muted-foreground">
                          {issue.line > 0 ? `Line ${issue.line}` : 'Program'}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                        {issue.message}
                      </p>
                    </div>
                  )
                )}
              </div>
            </section>
          )}
      </details>
      ), { fill: true })}

      {machineProfile && (
        renderWorkspacePanel('machine', 'Machine', (
        <section data-editor-machine-section>
          <h3 className="mb-2 text-[11px] font-semibold">Machine</h3>
          <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
            <dt className="text-muted-foreground">Profile</dt>
            <dd className="truncate" data-editor-machine="profile" title={machineProfile.name}>
              {machineProfile.name}
            </dd>
            <dt className="text-muted-foreground">Max W</dt>
            <dd data-editor-machine="max-width">{formatLimit(machineProfile.workArea?.widthMm ?? null)}</dd>
            <dt className="text-muted-foreground">Max L</dt>
            <dd data-editor-machine="max-length">{formatLimit(machineProfile.workArea?.lengthMm ?? null)}</dd>
          </dl>
          {pathDocument?.source.appliedUnits && (
            <div
              className="mt-3 border-t border-border pt-3"
              data-editor-dxf-unit-provenance
            >
              <h4 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">
                DXF unit provenance
              </h4>
              <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
                <dt className="text-muted-foreground">Raw</dt>
                <dd data-editor-dxf-unit-raw>
                  {formatDxfUnitDeclaration(pathDocument.source.unitDeclaration)}
                </dd>
                <dt className="text-muted-foreground">Applied</dt>
                <dd data-editor-dxf-unit-applied>
                  {pathDocument.source.appliedUnits.label} ×{formatUnitScale(
                    pathDocument.source.appliedUnits.scaleToMillimeters
                  )}
                </dd>
                <dt className="text-muted-foreground">Decision</dt>
                <dd data-editor-dxf-unit-basis>
                  {formatAppliedUnitBasis(pathDocument.source.appliedUnits.basis)}
                </dd>
                <dt className="text-muted-foreground">Confirmed</dt>
                <dd data-editor-dxf-unit-confirmed>
                  {pathDocument.source.appliedUnits.confirmed ? 'Yes' : 'No'}
                </dd>
              </dl>
              {isDeclaredUnitOverride(pathDocument) && (
                <p className="mt-2 border border-amber-500/50 bg-amber-500/10 p-2 text-amber-200">
                  Applied units override the DXF declaration.
                </p>
              )}
              {onReimportDxfUnits && (
                <Button
                  aria-label="Re-import with different units"
                  className="mt-2 h-7 w-full text-[10px]"
                  disabled={!canReimportDxfUnits}
                  onClick={() => void onReimportDxfUnits()}
                  title={reimportDxfUnitsDisabledReason ?? 'Rebuild from the persisted raw DXF with reviewed units'}
                  type="button"
                  variant="outline"
                >
                  Re-import with Different Units
                </Button>
              )}
            </div>
          )}
          {machineFit?.status === 'too-large' && (
            <div
              className="mt-2 border border-amber-500/50 bg-amber-500/10 p-2 text-amber-200"
              data-editor-machine-fit="too-large"
            >
              {machineFit.issues
                .map((issue) => `${issue.axis} ${issue.actualMm.toFixed(3)} > ${issue.limitMm.toFixed(3)} mm`)
                .join('\n')}
            </div>
          )}
        </section>
        ))
      )}

      {renderWorkspacePanel('measurement', 'Measurement', (
      <section
        className={`${guideHighlightClass(
          'measurement-points',
          guideHighlightTarget
        )}`}
        {...guideTargetProps('measurement-points', guideHighlightTarget)}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold">Measurement</h3>
          <span className="text-[10px] text-muted-foreground">{measurementPoints.length}</span>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1" data-editor-canvas-mouse-mode>
          <button
            aria-label="Select geometry on canvas"
            aria-pressed={canvasMouseMode === 'select'}
            className={`flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] outline-none transition hover:bg-accent ${
              canvasMouseMode === 'select'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground'
            }`}
            data-editor-canvas-mouse-mode-select
            onClick={() => onSetCanvasMouseMode('select')}
            type="button"
          >
            <MousePointer2 className="size-3" />
            Select
          </button>
          <button
            aria-label="Place measurement points on canvas"
            aria-pressed={canvasMouseMode === 'point'}
            className={`flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] outline-none transition hover:bg-accent ${
              canvasMouseMode === 'point'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground'
            }`}
            data-editor-canvas-mouse-mode-point
            onClick={() => onSetCanvasMouseMode('point')}
            type="button"
          >
            <Magnet className="size-3" />
            Point
          </button>
        </div>
        {pathDocument && onActivatePathConstructionMode && (
          <div className="mb-2 border border-border bg-background/35 p-1.5" data-path-construction-tools>
            <div className="mb-1 text-[10px] text-muted-foreground">
              Constrain the latest measurement/construction point to selected path geometry.
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(['perpendicular', 'tangent'] as const).map((mode) => (
                <button
                  aria-label={`Magnetize latest point ${mode}`}
                  aria-pressed={pathConstructionMode === mode}
                  className={`flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] outline-none transition hover:bg-accent ${
                    pathConstructionMode === mode
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground'
                  }`}
                  disabled={isSaving}
                  onClick={() => onActivatePathConstructionMode(
                    pathConstructionMode === mode ? null : mode
                  )}
                  type="button"
                >
                  <Magnet className="size-3" />
                  {mode === 'perpendicular' ? 'Perpendicular' : 'Tangent'}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <label className="grid gap-1 text-[10px] uppercase text-muted-foreground">
            X
            <input
              aria-label="Measurement point X"
              className="h-6 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary"
              inputMode="decimal"
              onChange={(event) => onPointXDraftChange(event.currentTarget.value)}
              placeholder="0.000"
              type="number"
              value={pointXDraft}
            />
          </label>
          <label className="grid gap-1 text-[10px] uppercase text-muted-foreground">
            Y
            <input
              aria-label="Measurement point Y"
              className="h-6 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary"
              inputMode="decimal"
              onChange={(event) => onPointYDraftChange(event.currentTarget.value)}
              placeholder="0.000"
              type="number"
              value={pointYDraft}
            />
          </label>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button
            className="h-6 px-2 text-[10px]"
            onClick={onAddMeasurementPoint}
            size="sm"
            type="button"
            variant="outline"
          >
            Add Point
          </Button>
          <Button
            className="h-6 px-2 text-[10px]"
            disabled={measurementPoints.length === 0}
            onClick={onClearMeasurementPoints}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear Points
          </Button>
        </div>
        {measurementPoints.length > 0 && (
          <div
            className="mt-2 border border-border bg-background/50"
            data-measurement-point-list
          >
            {measurementPoints.map((point, index) => (
              <div
                className="grid grid-cols-[30px_1fr_1fr_36px_22px] items-center gap-1.5 border-b border-border px-1.5 py-1 last:border-b-0"
                data-measurement-point-operation={point.pathSnap?.operationId}
                data-measurement-point-row={index + 1}
                data-measurement-point-segment={point.pathSnap?.segmentId}
                onMouseEnter={() => {
                  if (!point.pathSnap) return;
                  onHoverPathElement?.({
                    operationId: point.pathSnap.operationId,
                    segmentId: point.pathSnap.segmentId
                  });
                }}
                onMouseLeave={() => {
                  if (point.pathSnap) onHoverPathElement?.(null);
                }}
                key={point.id}
              >
                <span className="text-sky-200">P{index + 1}</span>
                <span className="text-muted-foreground">{point.x.toFixed(3)}</span>
                <span className="text-muted-foreground">{point.y.toFixed(3)}</span>
                {point.pathSnap ? (
                  <button
                    aria-label={`Select measurement point target P${index + 1}`}
                    className="text-left text-[10px] uppercase text-muted-foreground outline-none hover:text-foreground"
                    data-measurement-point-mode={index + 1}
                    onClick={() =>
                      onSelectPathElement?.({
                        operationId: point.pathSnap?.operationId ?? null,
                        segmentId: point.pathSnap?.segmentId ?? null
                      })
                    }
                    title="Select constrained path segment"
                    type="button"
                  >
                    {measurementPointModeLabel(point)}
                  </button>
                ) : (
                  <span
                    className="text-[10px] uppercase text-muted-foreground"
                    data-measurement-point-mode={index + 1}
                  >
                    -
                  </span>
                )}
                <button
                  aria-label={`Delete measurement point P${index + 1}`}
                  className="flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onDeleteMeasurementPoint(point.id)}
                  title="Delete point"
                  type="button"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 grid grid-cols-1 gap-1.5">
          <Button
            className="h-6 px-2 text-[10px]"
            disabled={!canInsertMeasurementPoints || !program || measurementPoints.length === 0 || isSaving}
            onClick={onInsertMeasurementPoints}
            size="sm"
            type="button"
            variant="outline"
          >
            <ArrowRightFromLine />
            Insert Points
          </Button>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              className="h-6 px-2 text-[10px]"
              disabled={measurementPoints.length === 0}
              onClick={() => onExportMeasurementPoints('csv')}
              size="sm"
              type="button"
              variant="outline"
            >
              <Download />
              Export CSV
            </Button>
            <Button
              className="h-6 px-2 text-[10px]"
              disabled={measurementPoints.length === 0}
              onClick={() => onExportMeasurementPoints('gcode')}
              size="sm"
              type="button"
              variant="outline"
            >
              <Download />
              Export G-code
            </Button>
          </div>
          <Button
            className="h-6 px-2 text-[10px]"
            disabled={measurementPoints.length === 0}
            onClick={() => onExportMeasurementPoints('iso')}
            size="sm"
            type="button"
            variant="outline"
          >
            <Download />
            Export Point ISO
          </Button>
        </div>
      </section>
      ))}
    </div>
  );
}

function formatCursorCoordinate(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '-';
}

function formatLimit(value: number | null) {
  return typeof value === 'number' ? `${value.toFixed(3)} mm` : '-';
}

function formatDxfUnitDeclaration(
  declaration: PathPlanningDocument['source']['unitDeclaration']
) {
  if (!declaration) return 'Legacy / not recorded';
  if (declaration.status === 'recognized') return `Declared by DXF: ${declaration.units.label}`;
  if (declaration.status === 'unitless') return 'Unitless DXF declaration';
  if (declaration.status === 'unknown') return `Unknown DXF unit code ${declaration.units.code}`;
  if (declaration.status === 'malformed') return 'Malformed DXF declaration';
  return 'Not declared';
}

function formatAppliedUnitBasis(basis: NonNullable<PathPlanningDocument['source']['appliedUnits']>['basis']) {
  if (basis === 'dxf-declared') return 'Declared by DXF';
  if (basis === 'user-confirmed') return 'User confirmed';
  return 'Legacy assumed';
}

function formatUnitScale(scale: number) {
  return Number.isInteger(scale) ? String(scale) : String(scale);
}

function isDeclaredUnitOverride(document: PathPlanningDocument) {
  const declaration = document.source.unitDeclaration;
  const applied = document.source.appliedUnits;
  return declaration?.status === 'recognized' && applied != null &&
    declaration.units.scaleToMillimeters !== applied.scaleToMillimeters;
}

function formatPoint(point: { x: number; y: number }) {
  return `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`;
}

function renderSelectedPathDiagnosticRow({
  diagnostic,
  onHoverPathElement,
  onSelectPathElement
}: {
  diagnostic: UpidSelectedPathDiagnostic;
  onHoverPathElement?: (element: EditorPathElementRef | null) => void;
  onSelectPathElement?: (element: EditorPathElementRef) => void;
}) {
  return (
    <div
      className="grid min-w-0 gap-0.5 border border-border bg-background/45 px-2 py-1.5 text-left outline-none hover:bg-accent disabled:cursor-default"
      data-upid-selected-diagnostic-code={diagnostic.code}
      data-upid-selected-diagnostic-id={diagnostic.id}
      data-upid-selected-diagnostic-related-clusters={diagnostic.relatedClusterCount}
      data-upid-selected-diagnostic-related-segments={diagnostic.relatedSegmentCount}
      data-upid-selected-diagnostic-row
      data-upid-selected-diagnostic-severity={diagnostic.severity}
      key={diagnostic.id}
      onClick={() => {
        if (diagnostic.selectRef) onSelectPathElement?.(diagnostic.selectRef);
      }}
      onMouseEnter={() => {
        if (diagnostic.selectRef) onHoverPathElement?.(diagnostic.selectRef);
      }}
      onMouseLeave={() => onHoverPathElement?.(null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && diagnostic.selectRef) onSelectPathElement?.(diagnostic.selectRef);
      }}
      role={diagnostic.selectRef ? 'button' : undefined}
      tabIndex={diagnostic.selectRef ? 0 : undefined}
    >
      <span className="flex min-w-0 items-center justify-between gap-2 text-[10px] uppercase">
        <span className={diagnostic.severity === 'error' ? 'text-destructive' : 'text-amber-200'}>
          {diagnostic.severity}
        </span>
        <span className="truncate text-foreground">{diagnostic.code}</span>
      </span>
      <span className="line-clamp-2 text-[10px] leading-4 text-muted-foreground">
        {diagnostic.message}
      </span>
      <span className="text-[10px] text-muted-foreground">
        segments {diagnostic.relatedSegmentCount} / clusters {diagnostic.relatedClusterCount}
      </span>
      {diagnostic.metrics.length > 0 && (
        <span className="flex min-w-0 flex-wrap gap-1 pt-0.5">
          {diagnostic.metrics.map((metric) => (
            <span
              className="border border-border bg-background/60 px-1 text-[10px] text-muted-foreground"
              data-upid-selected-diagnostic-metric={metric.key}
              key={metric.key}
            >
              {metric.label} {formatNumber(metric.value)}
            </span>
          ))}
        </span>
      )}
      {diagnostic.relatedRefs.length > 0 && (
        <span className="flex min-w-0 flex-wrap gap-1 pt-0.5">
          {diagnostic.relatedRefs.map((ref, index) => (
            <button
              aria-label={`Select diagnostic affected geometry ${index + 1}`}
              className="border border-border bg-background/60 px-1 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
              data-upid-selected-diagnostic-ref
              data-upid-selected-diagnostic-ref-index={index}
              data-upid-selected-diagnostic-ref-operation={ref.operationId ?? undefined}
              data-upid-selected-diagnostic-ref-path-element={ref.pathElementId ?? undefined}
              data-upid-selected-diagnostic-ref-segment={ref.segmentId ?? undefined}
              key={`${ref.operationId ?? ''}-${ref.pathElementId ?? ''}-${ref.segmentId ?? ''}-${index}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectPathElement?.(ref);
              }}
              onMouseEnter={() => onHoverPathElement?.(ref)}
              onMouseLeave={() => onHoverPathElement?.(null)}
              type="button"
            >
              {index + 1} {ref.segmentId ?? ref.pathElementId ?? ref.operationId ?? 'ref'}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

function renderSelectedSegmentGeometry(geometry: UpidSelectedPathSegmentGeometry) {
  if (geometry.kind === 'line') {
    return (
      <>
        <dt className="text-muted-foreground">Vector</dt>
        <dd data-upid-selected-segment-geometry="vector">
          {geometry.vector ? formatPoint(geometry.vector) : '-'}
        </dd>
        <dt className="text-muted-foreground">Heading</dt>
        <dd data-upid-selected-segment-geometry="heading">{formatDegrees(geometry.headingDegrees)}</dd>
        <dt className="text-muted-foreground">Tangent</dt>
        <dd data-upid-selected-segment-geometry="start-tangent">
          {formatPoint(geometry.startTangent)}
        </dd>
      </>
    );
  }

  return (
    <>
      <dt className="text-muted-foreground">Center</dt>
      <dd data-upid-selected-segment-geometry="center">
        {geometry.center ? formatPoint(geometry.center) : '-'}
      </dd>
      <dt className="text-muted-foreground">Radius</dt>
      <dd data-upid-selected-segment-geometry="radius">{formatNumber(geometry.radius)}</dd>
      <dt className="text-muted-foreground">Orient</dt>
      <dd data-upid-selected-segment-geometry="orientation">
        {geometry.clockwise ? 'cw' : 'ccw'}
      </dd>
      <dt className="text-muted-foreground">Sweep</dt>
      <dd data-upid-selected-segment-geometry="sweep">{formatDegrees(geometry.sweepDegrees)}</dd>
      <dt className="text-muted-foreground">Angles</dt>
      <dd data-upid-selected-segment-geometry="angles">
        {formatDegrees(geometry.startAngleDegrees)} - {formatDegrees(geometry.endAngleDegrees)}
      </dd>
      <dt className="text-muted-foreground">Start Tan</dt>
      <dd data-upid-selected-segment-geometry="start-tangent">
        {formatPoint(geometry.startTangent)}
      </dd>
      <dt className="text-muted-foreground">End Tan</dt>
      <dd data-upid-selected-segment-geometry="end-tangent">
        {formatPoint(geometry.endTangent)}
      </dd>
    </>
  );
}

function formatNumber(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '-';
}

function formatDegrees(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(3)} deg` : '-';
}

function formatOperationOrderStrategy(strategy: PathPlanningDocument['options']['operationOrderStrategy']) {
  if (strategy === 'source-order') return 'Source order';
  if (strategy === 'nearest') return 'Nearest travel';
  return 'Inside/out nearest';
}

function measurementPointModeLabel(point: MeasurementPoint) {
  if (!point.pathSnap) return '-';
  if (point.pathSnap.relation === 'nearest-fallback') return 'Snap';
  if (point.pathSnap.mode === 'perpendicular') return 'Perp';
  if (point.pathSnap.mode === 'tangent') return 'Tan';
  return '-';
}
