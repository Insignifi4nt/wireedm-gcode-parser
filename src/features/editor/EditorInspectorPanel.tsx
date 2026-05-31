import {
  ArrowDown,
  ArrowRightFromLine,
  ArrowUp,
  Download,
  Magnet,
  MousePointer2,
  RefreshCw,
  Trash2
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { GCodeStructure } from '@/domain/editor/gcodeStructure';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import type { MachineFitResult } from '@/domain/machine/machineFit';
import type { MagnetizeMode } from '@/domain/path-editor/pathDocumentOperations';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { MachineProfile } from '@/domain/workbench/types';

import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';

type MeasurementExportFormat = 'csv' | 'gcode' | 'iso';

interface EditorInspectorPanelProps {
  arcMoveCount: number;
  boundsText: string;
  cuttingMoveCount: number;
  draftProgram: LoadedEditorProgram | null;
  editorFileName: string;
  gridSnapEnabled: boolean;
  guideHighlightTarget: EditorGuideTarget | null;
  isSaving: boolean;
  machineFit: MachineFitResult | null;
  machineProfile: MachineProfile | null;
  measurementPoints: MeasurementPoint[];
  pathCount: number;
  pathClickMode: 'set-start' | MagnetizeMode | null;
  pathDocument: PathPlanningDocument | null;
  pointXDraft: string;
  pointYDraft: string;
  previewCursorPoint: { x: number; y: number } | null;
  program: LoadedEditorProgram | null;
  rapidMoveCount: number;
  selectedPathOperationId: string | null;
  structure: GCodeStructure | null;
  onActivatePathClickMode: (mode: 'set-start' | MagnetizeMode | null) => void;
  onAddMeasurementPoint: () => void;
  onClearMeasurementPoints: () => void;
  onDeleteMeasurementPoint: (pointId: string) => void;
  onExportMeasurementPoints: (format: MeasurementExportFormat) => void;
  onInsertMeasurementPoints: () => void;
  onMovePathOperation: (direction: -1 | 1) => void;
  onPointXDraftChange: (value: string) => void;
  onPointYDraftChange: (value: string) => void;
  onReversePathOperation: () => void;
  onSelectPathOperation: (operationId: string) => void;
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
  isSaving,
  machineFit,
  machineProfile,
  measurementPoints,
  pathCount,
  pathClickMode,
  pathDocument,
  pointXDraft,
  pointYDraft,
  previewCursorPoint,
  program,
  rapidMoveCount,
  selectedPathOperationId,
  structure,
  onActivatePathClickMode,
  onAddMeasurementPoint,
  onClearMeasurementPoints,
  onDeleteMeasurementPoint,
  onExportMeasurementPoints,
  onInsertMeasurementPoints,
  onMovePathOperation,
  onPointXDraftChange,
  onPointYDraftChange,
  onReversePathOperation,
  onSelectPathOperation,
  onToggleGridSnap
}: EditorInspectorPanelProps) {
  const selectedPathOperationIndex =
    pathDocument?.plan.operations.findIndex((operation) => operation.id === selectedPathOperationId) ?? -1;
  const selectedPathOperation =
    selectedPathOperationIndex >= 0 ? pathDocument?.plan.operations[selectedPathOperationIndex] : null;

  return (
    <div
      className="max-h-[42vh] overflow-y-auto border-t border-border p-2"
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
          <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Program</h3>
          {draftProgram ? (
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
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
              <dd>{draftProgram.parseResult.stats.totalLines}</dd>
              <dt className="text-muted-foreground">Linear</dt>
              <dd>{draftProgram.parseResult.stats.linearMoves}</dd>
              <dt className="text-muted-foreground">Warnings</dt>
              <dd>{draftProgram.parseResult.warnings.length}</dd>
              <dt className="text-muted-foreground">Errors</dt>
              <dd>{draftProgram.parseResult.errors.length}</dd>
            </dl>
          ) : (
            <p className="border border-border bg-background/50 p-2 text-muted-foreground">
              Import `.gcode`, `.nc`, `.iso`, or `.txt` to preview and edit it.
            </p>
          )}
        </section>

        {structure && (
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

        {draftProgram &&
          (draftProgram.parseResult.errors.length > 0 ||
            draftProgram.parseResult.warnings.length > 0) && (
            <section className="mt-3 border-t border-border pt-3">
              <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Parse Issues</h3>
              <div className="max-h-32 overflow-auto border border-border bg-background/50">
                {[...draftProgram.parseResult.errors, ...draftProgram.parseResult.warnings].map(
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

      {pathDocument && pathDocument.plan.operations.length > 0 && (
        <section className="mt-3 border-t border-border pt-3" data-editor-path-operations>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold">Path</h3>
            <span className="text-[10px] text-muted-foreground">{pathDocument.plan.operations.length}</span>
          </div>
          <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
            Operation
            <select
              aria-label="Path operation"
              className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary"
              onChange={(event) => onSelectPathOperation(event.currentTarget.value)}
              value={selectedPathOperationId ?? ''}
            >
              {pathDocument.plan.operations.map((operation) => (
                <option key={operation.id} value={operation.id}>
                  {operation.orderIndex + 1} {operation.classification}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <Button
              aria-label="Move path operation up"
              className="h-6 px-2 text-[10px]"
              disabled={selectedPathOperationIndex <= 0}
              onClick={() => onMovePathOperation(-1)}
              size="sm"
              type="button"
              variant="outline"
            >
              <ArrowUp />
            </Button>
            <Button
              aria-label="Move path operation down"
              className="h-6 px-2 text-[10px]"
              disabled={
                selectedPathOperationIndex < 0 ||
                selectedPathOperationIndex >= pathDocument.plan.operations.length - 1
              }
              onClick={() => onMovePathOperation(1)}
              size="sm"
              type="button"
              variant="outline"
            >
              <ArrowDown />
            </Button>
            <Button
              aria-label="Reverse path operation"
              className="h-6 px-2 text-[10px]"
              disabled={!selectedPathOperation}
              onClick={onReversePathOperation}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw />
            </Button>
            <Button
              aria-label="Set path start from canvas"
              aria-pressed={pathClickMode === 'set-start'}
              className="h-6 px-2 text-[10px]"
              disabled={!selectedPathOperation?.closed}
              onClick={() =>
                onActivatePathClickMode(pathClickMode === 'set-start' ? null : 'set-start')
              }
              size="sm"
              type="button"
              variant={pathClickMode === 'set-start' ? 'default' : 'outline'}
            >
              <MousePointer2 />
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Button
              aria-label="Magnetize latest point perpendicular"
              aria-pressed={pathClickMode === 'perpendicular'}
              className="h-6 px-2 text-[10px]"
              onClick={() =>
                onActivatePathClickMode(pathClickMode === 'perpendicular' ? null : 'perpendicular')
              }
              size="sm"
              type="button"
              variant={pathClickMode === 'perpendicular' ? 'default' : 'outline'}
            >
              <Magnet />
              Perp
            </Button>
            <Button
              aria-label="Magnetize latest point tangent"
              aria-pressed={pathClickMode === 'tangent'}
              className="h-6 px-2 text-[10px]"
              onClick={() => onActivatePathClickMode(pathClickMode === 'tangent' ? null : 'tangent')}
              size="sm"
              type="button"
              variant={pathClickMode === 'tangent' ? 'default' : 'outline'}
            >
              <Magnet />
              Tangent
            </Button>
          </div>
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
                data-measurement-point-row={index + 1}
                key={point.id}
              >
                <span className="text-sky-200">P{index + 1}</span>
                <span className="text-muted-foreground">{point.x.toFixed(3)}</span>
                <span className="text-muted-foreground">{point.y.toFixed(3)}</span>
                <span
                  className="text-[9px] uppercase text-muted-foreground"
                  data-measurement-point-mode={index + 1}
                >
                  {point.pathSnap?.relation === 'nearest-fallback'
                    ? 'Snap'
                    : point.pathSnap?.mode === 'perpendicular'
                    ? 'Perp'
                    : point.pathSnap?.mode === 'tangent'
                      ? 'Tan'
                      : '-'}
                </span>
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
            disabled={!program || measurementPoints.length === 0 || isSaving}
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
