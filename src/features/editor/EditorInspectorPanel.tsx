import {
  ArrowRightFromLine,
  Download,
  Magnet,
  Trash2
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { GCodeStructure } from '@/domain/editor/gcodeStructure';
import type { DxfInsertSource } from '@/domain/dxf/types';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import type { MachineFitResult } from '@/domain/machine/machineFit';
import {
  orientedSegmentEnd,
  orientedSegmentStart,
  distance,
  segmentMap
} from '@/domain/path-intel/segments';
import type { PathElement, PathPlanningDocument } from '@/domain/path-intel/types';
import {
  readUpidOperationPathElement,
  type UpidOperationPathElement
} from '@/domain/upid/projectRail';
import type { MachineProfile } from '@/domain/workbench/types';

import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';
import type { EditorPathElementRef } from './EditorPathNavigatorPanel';

type MeasurementExportFormat = 'csv' | 'gcode' | 'iso';

interface EditorInspectorPanelProps {
  arcMoveCount: number;
  boundsText: string;
  cuttingMoveCount: number;
  draftProgram: LoadedEditorProgram | null;
  editorFileName: string;
  gridSnapEnabled: boolean;
  guideHighlightTarget: EditorGuideTarget | null;
  fullHeight?: boolean;
  isSaving: boolean;
  machineFit: MachineFitResult | null;
  machineProfile: MachineProfile | null;
  measurementPoints: MeasurementPoint[];
  pathCount: number;
  pathDocument: PathPlanningDocument | null;
  pointXDraft: string;
  pointYDraft: string;
  previewCursorPoint: { x: number; y: number } | null;
  program: LoadedEditorProgram | null;
  rapidMoveCount: number;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  structure: GCodeStructure | null;
  canInsertMeasurementPoints?: boolean;
  onAddMeasurementPoint: () => void;
  onClearMeasurementPoints: () => void;
  onDeleteMeasurementPoint: (pointId: string) => void;
  onExportMeasurementPoints: (format: MeasurementExportFormat) => void;
  onHoverPathElement?: (element: EditorPathElementRef | null) => void;
  onInsertMeasurementPoints: () => void;
  onPointXDraftChange: (value: string) => void;
  onPointYDraftChange: (value: string) => void;
  onSelectPathElement?: (element: EditorPathElementRef) => void;
  onToggleGridSnap: () => void;
}

export function EditorInspectorPanel({
  arcMoveCount,
  boundsText,
  cuttingMoveCount,
  draftProgram,
  editorFileName,
  gridSnapEnabled,
  guideHighlightTarget,
  fullHeight = false,
  isSaving,
  machineFit,
  machineProfile,
  measurementPoints,
  pathCount,
  pathDocument,
  pointXDraft,
  pointYDraft,
  previewCursorPoint,
  program,
  rapidMoveCount,
  selectedPathElement,
  selectedPathOperationId,
  structure,
  canInsertMeasurementPoints = true,
  onAddMeasurementPoint,
  onClearMeasurementPoints,
  onDeleteMeasurementPoint,
  onExportMeasurementPoints,
  onHoverPathElement,
  onInsertMeasurementPoints,
  onPointXDraftChange,
  onPointYDraftChange,
  onSelectPathElement,
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
    ? readSelectedPathSegment(pathDocument, selectedPathElementModel, selectedPathElement)
    : null;
  const selectedPathPoint = selectedPathElementModel
    ? readSelectedPathPoint(pathDocument, selectedPathElementModel, selectedPathElement)
    : null;
  const selectedPathTravel = selectedPathOperation
    ? readSelectedPathTravel(pathDocument, selectedPathOperationIndex, selectedPathElement)
    : null;
  const selectedPathOverrideRows = selectedPathElementModel
    ? manualOverrideRows(selectedPathElementModel.overrides)
    : [];
  const selectedPathSource = selectedPathElementModel
    ? sourceSummaryRows(selectedPathElementModel)
    : null;
  const selectedPathStart = selectedPathElementModel ? readPathElementPoint(selectedPathElementModel, 'start') : null;
  const selectedPathEnd = selectedPathElementModel ? readPathElementPoint(selectedPathElementModel, 'end') : null;
  const draftParseResult = draftProgram?.parseResult ?? null;

  return (
    <div
      className={`${fullHeight ? 'h-full min-h-0' : 'max-h-[42vh] border-t border-border'} overflow-y-auto p-2`}
      data-editor-inspector-summary
    >
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

      <details className="mt-3 border-t border-border pt-3" data-editor-stats-section>
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

        {selectedPathTravel && (
          <section className="mt-3 border-t border-border pt-3" data-upid-selected-travel>
            <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Selected Travel</h3>
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
              <dt className="text-muted-foreground">Kind</dt>
              <dd data-upid-selected-travel="kind">rapid-in</dd>
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
          <section className="mt-3 border-t border-border pt-3" data-upid-selected-segment>
            <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Selected Segment</h3>
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
              <dt className="text-muted-foreground">Type</dt>
              <dd data-upid-selected-segment-kind>{selectedPathSegment.kind}</dd>
              <dt className="text-muted-foreground">Direction</dt>
              <dd>{selectedPathSegment.reversed ? 'reversed' : 'forward'}</dd>
              <dt className="text-muted-foreground">Layer</dt>
              <dd>{selectedPathSegment.layer ?? '-'}</dd>
              <dt className="text-muted-foreground">Length</dt>
              <dd>{selectedPathSegment.length.toFixed(3)}</dd>
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
                      <div className="flex items-center justify-between gap-2 text-[9px] uppercase">
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

      {machineProfile && (
        <section className="mt-3 border-t border-border pt-3" data-editor-machine-section>
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
      )}

      <section
        className={`mt-3 border-t border-border pt-3 ${guideHighlightClass(
          'measurement-points',
          guideHighlightTarget
        )}`}
        {...guideTargetProps('measurement-points', guideHighlightTarget)}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold">Measurement</h3>
          <span className="text-[10px] text-muted-foreground">{measurementPoints.length}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
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
          <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
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
          <div className="mt-2 max-h-24 overflow-auto border border-border bg-background/50">
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
                    className="text-left text-[9px] uppercase text-muted-foreground outline-none hover:text-foreground"
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
                    className="text-[9px] uppercase text-muted-foreground"
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
    </div>
  );
}

function formatCursorCoordinate(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '-';
}

function formatLimit(value: number | null) {
  return typeof value === 'number' ? `${value.toFixed(3)} mm` : '-';
}

function formatPoint(point: { x: number; y: number }) {
  return `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`;
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

function manualOverrideRows(overrides: PathElement['overrides']) {
  if (!overrides) return [];

  const rows: Array<{ kind: string; label: string; value: string }> = [];
  if (overrides.order) {
    rows.push({
      kind: 'order',
      label: 'Order',
      value: `Manual position ${overrides.order.orderIndex + 1}`
    });
  }
  if (overrides.classification) {
    rows.push({
      kind: 'classification',
      label: 'Role',
      value: overrides.classification.classification
    });
  }
  if (overrides.direction) {
    rows.push({
      kind: 'direction',
      label: 'Direction',
      value: overrides.direction.direction
    });
  }
  if (overrides.start) {
    rows.push({
      kind: 'start',
      label: 'Start',
      value:
        overrides.start.createdSegmentIds.length > 0
          ? `${formatPoint(overrides.start.point)} / split ${overrides.start.createdSegmentIds.length}`
          : formatPoint(overrides.start.point)
    });
  }

  return rows;
}

function sourceSummaryRows(element: PathElement) {
  const provenance = element.provenance;
  const entityCount = provenance.sourceEntityIndices.length;
  const insertedSegmentCount = provenance.dxf?.insertedSegmentCount ?? 0;

  return {
    blocks:
      provenance.dxf && provenance.dxf.blockNames.length > 0
        ? provenance.dxf.blockNames.join(', ')
        : null,
    entities: `${entityCount} ${entityCount === 1 ? 'entity' : 'entities'}`,
    exact: provenance.exact ? 'exact' : 'mixed',
    handles:
      provenance.sourceEntityHandles && provenance.sourceEntityHandles.length > 0
        ? provenance.sourceEntityHandles.join(', ')
        : null,
    inserts:
      provenance.dxf && provenance.dxf.insertBlockNames.length > 0
        ? `${provenance.dxf.insertBlockNames.join(', ')} / ${insertedSegmentCount} ${
            insertedSegmentCount === 1 ? 'segment' : 'segments'
          }`
        : null,
    layers: provenance.layers.length > 0 ? provenance.layers.map((layer) => layer ?? '-').join(', ') : '-'
  };
}

function readSelectedPathSegment(
  document: PathPlanningDocument | null,
  pathElement: UpidOperationPathElement,
  element: EditorPathElementRef | null
) {
  if (!document || !element?.segmentId || element.operationId !== pathElement.operationId) return null;

  const ref = pathElement.segmentRefs.find((candidate) => candidate.segmentId === element.segmentId);
  if (!ref) return null;

  const segment = segmentMap(document.segments).get(ref.segmentId);
  if (!segment) return null;

  return {
    end: orientedSegmentEnd(segment, ref),
    kind: segment.kind,
    layer: segment.layer,
    length: segment.length,
    reversed: ref.reversed,
    source: {
      block: segment.source.dxf?.blockName ?? null,
      entityIndex: segment.source.sourceEntityIndex,
      exact: segment.source.exact,
      handle: segment.source.sourceEntityHandle ?? null,
      insert: formatSegmentInsertSource(segment.source.dxf?.insertChain[0] ?? null),
      subIndex: segment.source.sourceSubIndex,
      type: segment.source.sourceEntityType
    },
    start: orientedSegmentStart(segment, ref)
  };
}

function formatSegmentInsertSource(insert: DxfInsertSource | null) {
  return insert ? `${insert.blockName} / row ${insert.row} col ${insert.column}` : null;
}

function readSelectedPathPoint(
  document: PathPlanningDocument | null,
  pathElement: UpidOperationPathElement,
  element: EditorPathElementRef | null
) {
  if (
    !document ||
    !element?.segmentId ||
    !element.pointRole ||
    element.operationId !== pathElement.operationId
  ) {
    return null;
  }

  const ref = pathElement.segmentRefs.find((candidate) => candidate.segmentId === element.segmentId);
  if (!ref) return null;

  const segment = segmentMap(document.segments).get(ref.segmentId);
  if (!segment) return null;

  return {
    point: element.pointRole === 'start' ? orientedSegmentStart(segment, ref) : orientedSegmentEnd(segment, ref),
    role: element.pointRole,
    segmentKind: segment.kind
  };
}

function readPathElementPoint(element: PathElement, role: 'start' | 'end') {
  return element.points.find((point) => point.role === role) ?? null;
}

function readSelectedPathTravel(
  document: PathPlanningDocument | null,
  operationIndex: number,
  element: EditorPathElementRef | null
) {
  if (!document || element?.travelRole !== 'rapid-in' || operationIndex < 0) return null;

  const operation = document.plan.operations[operationIndex];
  if (!operation || element.operationId !== operation.id) return null;

  const previousOperation = operationIndex > 0 ? document.plan.operations[operationIndex - 1] : null;
  const start = previousOperation?.endPoint ?? document.options.startPoint;
  const end = operation.startPoint;

  return {
    end,
    length: distance(start, end),
    start
  };
}
