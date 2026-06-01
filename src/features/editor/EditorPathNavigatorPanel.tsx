import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileText,
  Flag,
  Magnet,
  MousePointer2,
  Redo2,
  RefreshCw,
  Save,
  Undo2
} from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';

import type { MagnetizeMode } from '@/domain/path-editor/pathDocumentOperations';
import {
  orientedSegmentEnd,
  orientedSegmentStart,
  requiredSegment,
  segmentMap
} from '@/domain/path-intel/segments';
import type {
  ContourClassification,
  OperationOrderStrategy,
  OrientedSegmentRef,
  PathDiagnostic,
  PathPlanningDocument,
  PathSegment
} from '@/domain/path-intel/types';
import {
  createUpidProjectRail,
  readUpidSegmentGeometry,
  readUpidSelectedPathPoint,
  upidManualDecisionKinds,
  upidPathElementAncestorIds,
  upidPathElementNestLabel,
  upidPathElementRefForDiagnostic,
  upidPathElementRefsMatch,
  upidPathElementSourceEntityCount,
  type UpidManualDecisionKind,
  type UpidOperationPathElement,
  type UpidPathElementRef,
  type UpidSelectedPathSegmentGeometry,
  type UpidProjectRailTreeNode
} from '@/domain/upid/projectRail';

export type EditorPathElementRef = UpidPathElementRef;

const iconButtonClass =
  'flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';
const textButtonClass =
  'flex h-6 items-center justify-center gap-1 border border-border px-1.5 text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';
const modeButtonClass =
  'flex h-6 items-center justify-center gap-1 border border-border px-1 text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';
const activeModeButtonClass =
  'flex h-6 items-center justify-center gap-1 border border-primary bg-primary px-1 text-[10px] text-primary-foreground outline-none transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40';
const CONTOUR_ROLE_OPTIONS: ContourClassification[] = ['exterior', 'hole', 'island', 'ambiguous'];
const ORDER_STRATEGY_OPTIONS: Array<{
  label: string;
  value: OperationOrderStrategy;
}> = [
  { label: 'Inside/out nearest', value: 'inside-out-nearest' },
  { label: 'Nearest travel', value: 'nearest' },
  { label: 'Source order', value: 'source-order' }
];

interface EditorPathNavigatorPanelProps {
  hasUnsavedChanges: boolean;
  hoveredPathElement: EditorPathElementRef | null;
  hoverAssistEnabled: boolean;
  isSaving: boolean;
  magneticSnapEnabled: boolean;
  pathClickMode: 'set-start' | MagnetizeMode | null;
  pathDocument: PathPlanningDocument;
  redoAvailable: boolean;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  undoAvailable: boolean;
  onActivatePathClickMode: (mode: 'set-start' | MagnetizeMode | null) => void;
  onMovePathOperation: (direction: -1 | 1, operationId?: string) => void;
  onOpenExportPreview: () => void;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onRedoDraft: () => void;
  onReversePathOperation: () => void;
  onSaveClick: () => void | Promise<void>;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  onSetPathOperationClassification: (classification: ContourClassification) => void;
  onSetPathOperationOrderStrategy: (strategy: OperationOrderStrategy) => void;
  onSetPathStartFromElement: (element: EditorPathElementRef) => void;
  onToggleHoverAssist: () => void;
  onToggleMagneticSnap: () => void;
  onUndoDraft: () => void;
}

export function EditorPathNavigatorPanel({
  hasUnsavedChanges,
  hoveredPathElement,
  hoverAssistEnabled,
  isSaving,
  magneticSnapEnabled,
  pathClickMode,
  pathDocument,
  redoAvailable,
  selectedPathElement,
  selectedPathOperationId,
  undoAvailable,
  onActivatePathClickMode,
  onMovePathOperation,
  onOpenExportPreview,
  onHoverPathElement,
  onRedoDraft,
  onReversePathOperation,
  onSaveClick,
  onSelectPathElement,
  onSetPathOperationClassification,
  onSetPathOperationOrderStrategy,
  onSetPathStartFromElement,
  onToggleHoverAssist,
  onToggleMagneticSnap,
  onUndoDraft
}: EditorPathNavigatorPanelProps) {
  const segmentsById = segmentMap(pathDocument.segments);
  const projectRail = createUpidProjectRail(pathDocument);
  const { contourTree, cutSequenceElements, manualOrderActive } = projectRail;
  const pathTreeElementIds = projectRail.operationElements.map((element) => element.id);
  const [expandedPathElementIds, setExpandedPathElementIds] = useState<Record<string, boolean>>({});
  const selectedOperationIndex = pathDocument.plan.operations.findIndex(
    (operation) => operation.id === selectedPathOperationId
  );
  const selectedOperation =
    selectedOperationIndex >= 0 ? pathDocument.plan.operations[selectedOperationIndex] : null;
  const selectedSegmentIndex =
    selectedOperation && selectedPathElement?.segmentId
      ? selectedOperation.segmentRefs.findIndex((ref) => ref.segmentId === selectedPathElement.segmentId)
      : -1;
  const hoverRevealedPathElementIds = new Set(
    hoveredPathElement ? upidPathElementAncestorIds(pathDocument, hoveredPathElement) : []
  );
  const isPathElementExpanded = (pathElementId: string) =>
    hoverRevealedPathElementIds.has(pathElementId) || (expandedPathElementIds[pathElementId] ?? true);
  const togglePathElementExpanded = (pathElementId: string) => {
    setExpandedPathElementIds((current) => ({
      ...current,
      [pathElementId]: !(current[pathElementId] ?? true)
    }));
  };
  const setPathTreeExpanded = (expanded: boolean) => {
    setExpandedPathElementIds((current) => {
      const next = { ...current };

      for (const pathElementId of pathTreeElementIds) {
        next[pathElementId] = expanded;
      }

      return next;
    });
  };

  useEffect(() => {
    const pathElementIdsToReveal = selectedPathElement
      ? upidPathElementAncestorIds(pathDocument, selectedPathElement)
      : [];
    if (pathElementIdsToReveal.length === 0) return;

    setExpandedPathElementIds((current) => {
      let changed = false;
      const next = { ...current };

      for (const pathElementId of pathElementIdsToReveal) {
        if (next[pathElementId] === false) {
          next[pathElementId] = true;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [pathDocument, selectedPathElement]);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden p-2 font-mono text-[10px]"
      data-editor-project-rail
    >
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden" data-upid-path-navigator>
        <div className="shrink-0 border-b border-border pb-2">
          <p className="text-[9px] uppercase text-muted-foreground">Project Rail</p>
          <h2 className="mt-1 text-sm font-semibold">UPID Path Navigator</h2>
          <p className="mt-1 text-[9px] text-muted-foreground">
            {projectRail.summary.operationCount} operations / {projectRail.summary.contourCount} contours
          </p>
          <p
            className="mt-1 text-[9px] text-muted-foreground"
            data-upid-path-manual-decision-count={projectRail.summary.manualDecisionCount}
            data-upid-path-manual-decision-direction={projectRail.summary.manualDecisionCounts.direction}
            data-upid-path-manual-decision-order={projectRail.summary.manualDecisionCounts.order}
            data-upid-path-manual-decision-role={projectRail.summary.manualDecisionCounts.role}
            data-upid-path-manual-decision-start={projectRail.summary.manualDecisionCounts.start}
            data-upid-path-manual-decisions
          >
            {formatPathManualDecisionCount(projectRail.summary.manualDecisionCount)}
            {projectRail.summary.manualDecisionCount > 0 && (
              <span className="block truncate">
                {formatPathManualDecisionBreakdown(projectRail.summary.manualDecisionCounts)}
              </span>
            )}
          </p>
        </div>

        <div className="shrink-0 border-b border-border py-2" data-upid-path-action-bar>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9px] uppercase text-muted-foreground">Path Action Bar</span>
            {hasUnsavedChanges && <span className="text-[9px] text-amber-200">Unsaved</span>}
          </div>
          <div
            className="mb-2 border border-border bg-background/35 px-2 py-1.5"
            data-upid-active-selection
            data-upid-active-selection-operation={selectedOperation?.id}
            data-upid-active-selection-path-element={selectedPathElement?.pathElementId ?? undefined}
            data-upid-active-selection-segment={selectedPathElement?.segmentId ?? undefined}
            data-upid-active-selection-state={selectedOperation ? 'selected' : 'empty'}
          >
            <div className="text-[8px] uppercase text-muted-foreground">Active Selection</div>
            {selectedOperation ? (
              <>
                <div className="mt-0.5 truncate text-[10px] text-foreground">
                  {selectedOperation.displayName}
                </div>
                <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
                  order {selectedOperationIndex + 1} /{' '}
                  {selectedOperation.closed ? 'closed contour' : 'open chain'} /{' '}
                  {selectedOperation.direction}
                </div>
                {selectedSegmentIndex >= 0 && (
                  <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
                    segment {selectedSegmentIndex + 1} / {selectedPathElement?.pointRole ?? 'body'}
                  </div>
                )}
              </>
            ) : (
              <div className="mt-0.5 text-[9px] text-muted-foreground">No path selected</div>
            )}
          </div>
          <div className="grid grid-cols-4 gap-1">
            <button
              aria-label="Undo"
              className={iconButtonClass}
              disabled={!undoAvailable || isSaving}
              onClick={onUndoDraft}
              title="Undo"
              type="button"
            >
              <Undo2 className="size-3" />
            </button>
            <button
              aria-label="Redo"
              className={iconButtonClass}
              disabled={!redoAvailable || isSaving}
              onClick={onRedoDraft}
              title="Redo"
              type="button"
            >
              <Redo2 className="size-3" />
            </button>
            <button
              aria-label="Move path operation up"
              className={iconButtonClass}
              disabled={selectedOperationIndex <= 0 || isSaving}
              onClick={() => onMovePathOperation(-1)}
              title="Move operation up"
              type="button"
            >
              <ArrowUp className="size-3" />
            </button>
            <button
              aria-label="Move path operation down"
              className={iconButtonClass}
              disabled={
                selectedOperationIndex < 0 ||
                selectedOperationIndex >= pathDocument.plan.operations.length - 1 ||
                isSaving
              }
              onClick={() => onMovePathOperation(1)}
              title="Move operation down"
              type="button"
            >
              <ArrowDown className="size-3" />
            </button>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            <button
              aria-label="Reverse path operation"
              className={textButtonClass}
              disabled={!selectedOperation || isSaving}
              onClick={onReversePathOperation}
              type="button"
            >
              <RefreshCw className="size-3" />
              Reverse
            </button>
            <button
              aria-label="Save Path Plan"
              className={textButtonClass}
              disabled={!hasUnsavedChanges || isSaving}
              onClick={onSaveClick}
              type="button"
            >
              <Save className="size-3" />
              Save
            </button>
          </div>
          <button
            aria-label="Open UPID export preview"
            className={`mt-1 w-full ${textButtonClass}`}
            disabled={isSaving}
            onClick={onOpenExportPreview}
            type="button"
          >
            <FileText className="size-3" />
            Export Preview
          </button>
          <label
            className="mt-2 grid gap-1 text-[9px] uppercase text-muted-foreground"
            data-upid-manual-order-active={manualOrderActive ? 'true' : undefined}
            data-upid-order-strategy
          >
            Planning Mode
            <select
              aria-label="Planning order strategy"
              className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSaving}
              onChange={(event) =>
                onSetPathOperationOrderStrategy(event.currentTarget.value as OperationOrderStrategy)
              }
              value={pathDocument.options.operationOrderStrategy}
            >
              {ORDER_STRATEGY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="normal-case text-[9px] text-muted-foreground" data-upid-order-strategy-status>
              {manualOrderActive ? 'Manual order overrides active' : 'Automatic order active'}
            </span>
          </label>
          <button
            aria-label="Reapply planning order strategy"
            className={`mt-1 w-full ${textButtonClass}`}
            disabled={!manualOrderActive || isSaving}
            onClick={() => onSetPathOperationOrderStrategy(pathDocument.options.operationOrderStrategy)}
            type="button"
          >
            Reapply Planning Mode
          </button>
          <label className="mt-2 grid gap-1 text-[9px] uppercase text-muted-foreground">
            Contour Role
            <select
              aria-label="Contour role"
              className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!selectedOperation || !selectedOperation.closed || isSaving}
              onChange={(event) =>
                onSetPathOperationClassification(event.currentTarget.value as ContourClassification)
              }
              value={selectedOperation?.classification ?? ''}
            >
              {CONTOUR_ROLE_OPTIONS.map((classification) => (
                <option key={classification} value={classification}>
                  {classification}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-1 grid grid-cols-3 gap-1">
            <button
              aria-label="Set path start from canvas"
              aria-pressed={pathClickMode === 'set-start'}
              className={pathClickMode === 'set-start' ? activeModeButtonClass : modeButtonClass}
              disabled={!selectedOperation?.closed || isSaving}
              onClick={() => onActivatePathClickMode(pathClickMode === 'set-start' ? null : 'set-start')}
              type="button"
            >
              <MousePointer2 className="size-3" />
              Start
            </button>
            <button
              aria-label="Magnetize latest point perpendicular"
              aria-pressed={pathClickMode === 'perpendicular'}
              className={pathClickMode === 'perpendicular' ? activeModeButtonClass : modeButtonClass}
              onClick={() =>
                onActivatePathClickMode(pathClickMode === 'perpendicular' ? null : 'perpendicular')
              }
              type="button"
            >
              <Magnet className="size-3" />
              Perp
            </button>
            <button
              aria-label="Magnetize latest point tangent"
              aria-pressed={pathClickMode === 'tangent'}
              className={pathClickMode === 'tangent' ? activeModeButtonClass : modeButtonClass}
              onClick={() => onActivatePathClickMode(pathClickMode === 'tangent' ? null : 'tangent')}
              type="button"
            >
              <Magnet className="size-3" />
              Tangent
            </button>
          </div>
        </div>

        <section className="shrink-0 border-b border-border py-2" data-upid-hover-assist>
          <div className="mb-1 text-[9px] uppercase text-muted-foreground">Hover Assist</div>
          <label className="flex items-center justify-between gap-2">
            <span>Canvas hover highlights navigator</span>
            <input
              aria-label="Toggle canvas hover assist"
              checked={hoverAssistEnabled}
              data-upid-hover-assist-toggle
              onChange={onToggleHoverAssist}
              type="checkbox"
            />
          </label>
          <label className="mt-1 flex items-center justify-between gap-2 pl-3" data-upid-magnetic-snap>
            <span>Magnetic non-existing points</span>
            <input
              aria-label="Toggle magnetic non-existing point snap"
              checked={magneticSnapEnabled}
              data-upid-magnetic-snap-toggle
              disabled={!hoverAssistEnabled}
              onChange={onToggleMagneticSnap}
              type="checkbox"
            />
          </label>
        </section>

        {pathDocument.diagnostics.length > 0 && (
          <section className="shrink-0 border-b border-border py-2" data-upid-diagnostics>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase text-muted-foreground">Path Diagnostics</span>
              <span className="text-[9px] text-amber-200">
                {pathDocument.diagnostics.length}{' '}
                {pathDocument.diagnostics.length === 1 ? 'issue' : 'issues'}
              </span>
            </div>
            <div className="max-h-24 overflow-auto border border-border bg-background/35">
              {pathDocument.diagnostics.map((diagnostic) =>
                renderDiagnosticRow({
                  diagnostic,
                  hoveredPathElement,
                  onHoverPathElement,
                  onSelectPathElement,
                  pathDocument,
                  selectedPathElement
                })
              )}
            </div>
          </section>
        )}

        <section className="shrink-0 border-b border-border py-2" data-upid-cut-sequence>
          <div className="mb-2 text-[9px] uppercase text-muted-foreground">Cut Sequence</div>
          <div className="max-h-32 overflow-auto border border-border bg-background/35" data-upid-cut-sequence-list>
            {cutSequenceElements.map((pathElement) =>
              renderCutSequenceRow({
                hoveredPathElement,
                isSaving,
                onHoverPathElement,
                onMovePathOperation,
                onSelectPathElement,
                operationCount: cutSequenceElements.length,
                pathElement,
                selectedPathElement
              })
            )}
          </div>
        </section>

        <section className="min-h-0 flex-1 overflow-auto py-2" data-upid-contour-tree>
          <div className="mb-2 grid gap-1" data-upid-path-tree-controls>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase text-muted-foreground">Contour Tree</span>
              <span className="text-[9px] text-muted-foreground">{projectRail.summary.rootCount} roots</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                aria-label="Expand entire contour tree"
                className={textButtonClass}
                disabled={pathTreeElementIds.length === 0 || isSaving}
                onClick={() => setPathTreeExpanded(true)}
                type="button"
              >
                Expand All
              </button>
              <button
                aria-label="Collapse entire contour tree"
                className={textButtonClass}
                disabled={pathTreeElementIds.length === 0 || isSaving}
                onClick={() => setPathTreeExpanded(false)}
                type="button"
              >
                Collapse All
              </button>
            </div>
          </div>
          {contourTree.map((node) =>
            renderContourTreeNode({
              hoveredPathElement,
              node,
              onHoverPathElement,
              onSelectPathElement,
              onSetPathStartFromElement,
              isPathElementExpanded,
              isSaving,
              pathDocument,
              selectedPathElement,
              selectedPathOperationId,
              segmentsById,
              togglePathElementExpanded,
              treeDepth: 0
            })
          )}
        </section>
      </section>
    </div>
  );
}

function renderDiagnosticRow({
  diagnostic,
  hoveredPathElement,
  onHoverPathElement,
  onSelectPathElement,
  pathDocument,
  selectedPathElement
}: {
  diagnostic: PathDiagnostic;
  hoveredPathElement: EditorPathElementRef | null;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  pathDocument: PathPlanningDocument;
  selectedPathElement: EditorPathElementRef | null;
}) {
  const hoverElement = upidPathElementRefForDiagnostic(pathDocument, diagnostic);
  const hovered = upidPathElementRefsMatch(hoverElement, hoveredPathElement);
  const selected = upidPathElementRefsMatch(hoverElement, selectedPathElement);

  return (
    <button
      className={`w-full border-b border-border px-2 py-1.5 text-left outline-none last:border-b-0 hover:bg-accent disabled:cursor-default ${
        selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : ''
      }`}
      data-upid-diagnostic-code={diagnostic.code}
      data-upid-hovered={hovered ? 'true' : undefined}
      data-upid-diagnostic-row
      data-upid-diagnostic-severity={diagnostic.severity}
      data-upid-selected={selected ? 'true' : undefined}
      disabled={!hoverElement}
      key={diagnostic.id}
      onClick={() => {
        if (hoverElement) onSelectPathElement(hoverElement);
      }}
      onMouseEnter={() => {
        if (hoverElement) onHoverPathElement(hoverElement);
      }}
      onMouseLeave={() => {
        if (hoverElement) onHoverPathElement(null);
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[8px] uppercase">
        <span className={diagnostic.severity === 'error' ? 'text-destructive' : 'text-amber-200'}>
          {diagnostic.severity}
        </span>
        <span className="truncate text-muted-foreground">{diagnostic.code}</span>
      </div>
      <p className="text-[9px] leading-4 text-muted-foreground">{diagnostic.message}</p>
    </button>
  );
}

export function EditorPathNavigatorRailCollapsed() {
  return (
    <div className="flex h-full flex-col items-center gap-3 py-3" data-editor-project-rail-collapsed>
      <Magnet className="size-4 text-primary" />
      <div
        className="rotate-180 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground [writing-mode:vertical-rl]"
        title="UPID Path Navigator"
      >
        UPID
      </div>
    </div>
  );
}

function renderCutSequenceRow({
  hoveredPathElement,
  isSaving,
  onHoverPathElement,
  onMovePathOperation,
  onSelectPathElement,
  operationCount,
  pathElement,
  selectedPathElement
}: {
  hoveredPathElement: EditorPathElementRef | null;
  isSaving: boolean;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onMovePathOperation: (direction: -1 | 1, operationId?: string) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  operationCount: number;
  pathElement: UpidOperationPathElement;
  selectedPathElement: EditorPathElementRef | null;
}) {
  const selected = selectedPathElement?.operationId === pathElement.operationId;
  const hovered = hoveredPathElement?.operationId === pathElement.operationId;
  const rapidSelected =
    selectedPathElement?.operationId === pathElement.operationId && selectedPathElement.travelRole === 'rapid-in';
  const rapidHovered =
    hoveredPathElement?.operationId === pathElement.operationId && hoveredPathElement.travelRole === 'rapid-in';
  const manualDecisions = upidManualDecisionKinds(pathElement);
  const cutLength = pathElement.metrics.cutLength.toFixed(3);
  const rapidInLength = pathElement.metrics.rapidInLength.toFixed(3);
  const label = pathElement.displayName;
  const sourceEntityCount = upidPathElementSourceEntityCount(pathElement);
  const editedSegmentCount = pathElement.provenance.edit?.derivedSegmentIds.length ?? 0;
  const rapidElement: EditorPathElementRef = {
    operationId: pathElement.operationId,
    pathElementId: pathElement.id,
    segmentId: null,
    travelRole: 'rapid-in'
  };
  const selectOperation = () =>
    onSelectPathElement({
      operationId: pathElement.operationId,
      pathElementId: pathElement.id,
      segmentId: null
    });
  const selectRapid = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onSelectPathElement(rapidElement);
  };
  const moveOperation = (event: MouseEvent<HTMLButtonElement>, direction: -1 | 1) => {
    event.stopPropagation();
    selectOperation();
    onMovePathOperation(direction, pathElement.operationId);
  };

  return (
    <div
      className={`grid w-full grid-cols-[minmax(0,1fr)_68px_20px] items-center border-b border-border last:border-b-0 hover:bg-accent ${
        selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/10 text-cyan-100' : ''
      }`}
      data-upid-cut-sequence-controls
      data-upid-cut-sequence-cut={cutLength}
      data-upid-cut-sequence-index={pathElement.orderIndex}
      data-upid-cut-sequence-label={label}
      data-upid-cut-sequence-edited-segments={editedSegmentCount > 0 ? editedSegmentCount : undefined}
      data-upid-cut-sequence-manual={manualDecisions.length > 0 ? manualDecisions.join(' ') : undefined}
      data-upid-cut-sequence-rapid={rapidInLength}
      data-upid-cut-sequence-role={pathElement.classification}
      data-upid-cut-sequence-row
      data-upid-cut-sequence-source-entities={sourceEntityCount}
      data-upid-hovered={hovered ? 'true' : undefined}
      data-upid-operation-id={pathElement.operationId}
      data-upid-path-element-id={pathElement.id}
      data-upid-selected={selected ? 'true' : undefined}
      key={`cut-sequence-${pathElement.id}`}
      onMouseEnter={() =>
        onHoverPathElement({
          operationId: pathElement.operationId,
          pathElementId: pathElement.id,
          segmentId: null
        })
      }
      onMouseLeave={() => onHoverPathElement(null)}
    >
      <button
        aria-pressed={selected}
        className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-1 px-1.5 py-1.5 text-left outline-none hover:bg-accent"
        data-upid-cut-sequence-select
        onClick={selectOperation}
        type="button"
      >
        <span className="text-muted-foreground">{pathElement.orderIndex + 1}</span>
        <span className="min-w-0">
          <span className="block truncate text-[10px]">{label}</span>
          <span className="block truncate text-[9px] text-muted-foreground">
            {pathElement.label} / {pathElement.closed ? 'closed contour' : 'open chain'} /{' '}
            {pathElement.direction}
          </span>
          <span className="block truncate text-[9px] text-muted-foreground">
            {upidPathElementNestLabel(pathElement)}
          </span>
          {renderManualDecisionBadges(manualDecisions)}
        </span>
      </button>
      <button
        aria-label="Select rapid travel for cut sequence operation"
        aria-pressed={rapidSelected}
        className={`grid h-full content-center px-1 text-right text-[8px] leading-tight outline-none hover:bg-accent ${
          rapidSelected
            ? 'bg-sky-500/15 text-sky-100'
            : rapidHovered
              ? 'bg-cyan-500/15 text-cyan-100'
              : 'text-muted-foreground'
        }`}
        data-upid-cut-sequence-metrics
        data-upid-cut-sequence-rapid-control
        data-upid-hovered={rapidHovered ? 'true' : undefined}
        data-upid-selected={rapidSelected ? 'true' : undefined}
        onClick={selectRapid}
        onMouseEnter={() => onHoverPathElement(rapidElement)}
        onMouseLeave={() => onHoverPathElement(null)}
        title="Rapid travel into this operation"
        type="button"
      >
        <span data-upid-cut-sequence-cut-value={cutLength}>Cut {cutLength}</span>
        <span data-upid-cut-sequence-rapid-value={rapidInLength}>Rapid {rapidInLength}</span>
      </button>
      <span className="grid grid-rows-2 self-stretch border-l border-border">
        <button
          aria-label="Move cut sequence operation up"
          className="flex items-center justify-center text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          disabled={pathElement.orderIndex <= 0 || isSaving}
          onClick={(event) => moveOperation(event, -1)}
          title="Move cut operation up"
          type="button"
        >
          <ArrowUp className="size-3" />
        </button>
        <button
          aria-label="Move cut sequence operation down"
          className="flex items-center justify-center border-t border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          disabled={pathElement.orderIndex >= operationCount - 1 || isSaving}
          onClick={(event) => moveOperation(event, 1)}
          title="Move cut operation down"
          type="button"
        >
          <ArrowDown className="size-3" />
        </button>
      </span>
    </div>
  );
}

function renderContourTreeNode({
  hoveredPathElement,
  isSaving,
  node,
  onHoverPathElement,
  onSelectPathElement,
  onSetPathStartFromElement,
  pathDocument,
  isPathElementExpanded,
  selectedPathElement,
  selectedPathOperationId,
  segmentsById,
  togglePathElementExpanded,
  treeDepth
}: {
  hoveredPathElement: EditorPathElementRef | null;
  isSaving: boolean;
  isPathElementExpanded: (pathElementId: string) => boolean;
  node: UpidProjectRailTreeNode;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  onSetPathStartFromElement: (element: EditorPathElementRef) => void;
  pathDocument: PathPlanningDocument;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  segmentsById: ReturnType<typeof segmentMap>;
  togglePathElementExpanded: (pathElementId: string) => void;
  treeDepth: number;
}) {
  const { element } = node;
  const nested = treeDepth > 0;
  const manualDecisions = upidManualDecisionKinds(element);
  const label = element.displayName;
  const sourceEntityCount = upidPathElementSourceEntityCount(element);
  const editedSegmentCount = element.provenance.edit?.derivedSegmentIds.length ?? 0;
  const expanded = isPathElementExpanded(element.id);

  return (
    <details
      className={
        nested
          ? 'ml-3 border-l border-border/80 bg-background/20 pl-2'
          : 'mb-1 border border-border bg-background/45'
      }
      data-upid-expanded={expanded ? 'true' : 'false'}
      data-upid-hovered={hoveredPathElement?.operationId === element.operationId ? 'true' : undefined}
      data-upid-contour-group={element.id}
      data-upid-contour-direct-segments={node.treeMetrics.directSegmentCount}
      data-upid-contour-total-segments={node.treeMetrics.totalSegmentCount}
      data-upid-contour-descendants={node.treeMetrics.descendantCount}
      data-upid-operation-id={element.operationId}
      data-upid-path-element-id={element.id}
      data-upid-selected={selectedPathElement?.operationId === element.operationId ? 'true' : undefined}
      data-upid-tree-depth={treeDepth}
      key={element.id}
      open={expanded}
    >
      <summary className="list-none" onClick={(event) => event.preventDefault()}>
        <div
          className={`grid w-full grid-cols-[20px_minmax(0,1fr)] items-stretch hover:bg-accent ${
            element.operationId === selectedPathOperationId
              ? 'bg-sky-500/15 text-sky-100'
              : hoveredPathElement?.operationId === element.operationId
                ? 'bg-cyan-500/10 text-cyan-100'
                : ''
          }`}
        >
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
            className="flex items-center justify-center text-muted-foreground outline-none hover:bg-accent"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              togglePathElementExpanded(element.id);
            }}
            type="button"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
          <button
            aria-label={`Select ${label}`}
            aria-pressed={element.operationId === selectedPathOperationId}
            className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)_52px] items-center gap-1 px-1.5 py-1.5 text-left outline-none hover:bg-accent"
            data-upid-contour-children={element.childIds.length}
            data-upid-contour-depth={element.containmentDepth}
            data-upid-contour-display-name={element.displayName}
            data-upid-contour-label={element.label}
            data-upid-contour-manual={manualDecisions.length > 0 ? manualDecisions.join(' ') : undefined}
            data-upid-contour-parent={element.parentId ?? undefined}
            data-upid-contour-role={element.classification}
            data-upid-contour-row
            data-upid-contour-direct-segments={node.treeMetrics.directSegmentCount}
            data-upid-contour-total-segments={node.treeMetrics.totalSegmentCount}
            data-upid-contour-descendants={node.treeMetrics.descendantCount}
            data-upid-contour-edited-segments={editedSegmentCount > 0 ? editedSegmentCount : undefined}
            data-upid-contour-source-entities={sourceEntityCount}
            data-upid-hovered={hoveredPathElement?.operationId === element.operationId ? 'true' : undefined}
            data-upid-operation-id={element.operationId}
            data-upid-path-element-id={element.id}
            data-upid-selected={
              selectedPathElement?.operationId === element.operationId && !selectedPathElement.segmentId
                ? 'true'
                : undefined
            }
            onClick={(event) => {
              event.preventDefault();
              onSelectPathElement({
                operationId: element.operationId,
                pathElementId: element.id,
                segmentId: null
              });
            }}
            onMouseEnter={() =>
              onHoverPathElement({
                operationId: element.operationId,
                pathElementId: element.id,
                segmentId: null
              })
            }
            onMouseLeave={() => onHoverPathElement(null)}
            type="button"
          >
            <span className="text-muted-foreground">{element.orderIndex + 1}</span>
            <span className="min-w-0">
              <span className="block truncate text-[10px]">{label}</span>
              <span className="block truncate text-[9px] text-muted-foreground">
                {element.label} / {element.closed ? 'closed contour' : 'open chain'} / {element.direction}
              </span>
              <span className="block truncate text-[9px] text-muted-foreground">
                {upidPathElementNestLabel(element)}
              </span>
              <span className="block truncate text-[9px] text-muted-foreground">
                {formatTreeMetrics(node.treeMetrics)}
              </span>
              {renderManualDecisionBadges(manualDecisions)}
            </span>
            <span className="text-right text-[9px] text-muted-foreground">
              {element.metrics.cutLength.toFixed(3)}
            </span>
          </button>
        </div>
      </summary>
      {expanded && (
        <div className="border-t border-border bg-card/35 py-1" data-upid-segment-stack>
          {element.segmentRefs.map((ref, index) =>
            renderSegmentRow(
              element,
              ref,
              index,
              requiredSegment(segmentsById, ref.segmentId),
              pathDocument,
              hoveredPathElement,
              selectedPathElement,
              onHoverPathElement,
              onSelectPathElement,
              onSetPathStartFromElement,
              isSaving
            )
          )}
        </div>
      )}
      {expanded && node.children.length > 0 && (
        <div className="py-1" data-upid-contour-children-list>
          {node.children.map((child) =>
            renderContourTreeNode({
              hoveredPathElement,
              isSaving,
              node: child,
              onHoverPathElement,
              onSelectPathElement,
              onSetPathStartFromElement,
              isPathElementExpanded,
              pathDocument,
              selectedPathElement,
              selectedPathOperationId,
              segmentsById,
              togglePathElementExpanded,
              treeDepth: treeDepth + 1
            })
          )}
        </div>
      )}
    </details>
  );
}

function renderManualDecisionBadges(decisions: UpidManualDecisionKind[]) {
  if (decisions.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1" data-upid-manual-decision-list>
      {decisions.map((decision) => (
        <span
          className="border border-amber-400/40 bg-amber-400/10 px-1 text-[8px] uppercase text-amber-200"
          data-upid-manual-decision={decision}
          key={decision}
        >
          {decision}
        </span>
      ))}
    </span>
  );
}

function formatTreeMetrics(metrics: UpidProjectRailTreeNode['treeMetrics']) {
  const segmentLabel = metrics.directSegmentCount === 1 ? 'segment' : 'segments';
  if (metrics.descendantCount === 0) return `${metrics.directSegmentCount} ${segmentLabel}`;

  const descendantLabel = metrics.descendantCount === 1 ? 'nested contour' : 'nested contours';
  return `${metrics.directSegmentCount} ${segmentLabel} / ${metrics.descendantCount} ${descendantLabel} / ${metrics.totalSegmentCount} total`;
}

function formatPathManualDecisionCount(count: number) {
  if (count <= 0) return 'Automatic path plan';
  return `${count} manual ${count === 1 ? 'decision' : 'decisions'}`;
}

function formatPathManualDecisionBreakdown(
  counts: Record<UpidManualDecisionKind, number>
) {
  return `order ${counts.order} / role ${counts.role} / direction ${counts.direction} / start ${counts.start}`;
}

function renderSegmentRow(
  pathElement: UpidOperationPathElement,
  ref: OrientedSegmentRef,
  index: number,
  segment: PathSegment,
  pathDocument: PathPlanningDocument,
  hoveredPathElement: EditorPathElementRef | null,
  selectedPathElement: EditorPathElementRef | null,
  onHoverPathElement: (element: EditorPathElementRef | null) => void,
  onSelectPathElement: (element: EditorPathElementRef) => void,
  onSetPathStartFromElement: (element: EditorPathElementRef) => void,
  isSaving: boolean
) {
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const segmentLength = segment.length.toFixed(3);
  const refDirection = ref.reversed ? 'reversed ref' : 'forward ref';
  const geometry = readUpidSegmentGeometry(segment, ref);
  const geometrySummary = formatSegmentGeometrySummary(geometry);
  const hovered =
    hoveredPathElement?.operationId === pathElement.operationId &&
    hoveredPathElement.segmentId === segment.id &&
    !hoveredPathElement.pointRole;
  const selected =
    selectedPathElement?.operationId === pathElement.operationId &&
    selectedPathElement.segmentId === segment.id &&
    !selectedPathElement.pointRole;

  return (
    <div data-upid-path-element-id={pathElement.id} data-upid-segment-group key={`${pathElement.id}-${segment.id}-${index}`}>
      <button
        aria-pressed={selected}
        className={`grid w-full grid-cols-[26px_minmax(0,1fr)] gap-1 px-1.5 py-1 text-left text-[9px] text-muted-foreground outline-none hover:bg-accent ${
          selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : ''
        }`}
        data-upid-hovered={hovered ? 'true' : undefined}
        data-upid-operation-id={pathElement.operationId}
        data-upid-path-element-id={pathElement.id}
        data-upid-selected={selected ? 'true' : undefined}
        data-upid-segment-geometry={geometry.kind}
        data-upid-segment-index={index}
        data-upid-segment-length={segmentLength}
        data-upid-segment-orientation={
          geometry.kind === 'line' ? undefined : geometry.clockwise ? 'cw' : 'ccw'
        }
        data-upid-segment-radius={geometry.kind === 'line' ? undefined : formatNumber(geometry.radius)}
        data-upid-segment-reversed={ref.reversed ? 'true' : 'false'}
        data-upid-segment-sweep={geometry.kind === 'line' ? undefined : formatNumber(geometry.sweepDegrees)}
        data-upid-segment-row
        data-upid-segment-id={segment.id}
        onClick={() =>
          onSelectPathElement({
            operationId: pathElement.operationId,
            pathElementId: pathElement.id,
            segmentId: segment.id
          })
        }
        onMouseEnter={() =>
          onHoverPathElement({
            operationId: pathElement.operationId,
            pathElementId: pathElement.id,
            segmentId: segment.id
          })
        }
        onMouseLeave={() => onHoverPathElement(null)}
        type="button"
      >
        <span>{index + 1}</span>
        <span className="min-w-0">
          <span className="block truncate uppercase text-foreground">{segment.kind}</span>
          <span className="block truncate">
            {formatPoint(start)}
            {' -> '}
            {formatPoint(end)}
          </span>
          <span className="block truncate">length {segmentLength} / {refDirection}</span>
          {geometrySummary && <span className="block truncate">{geometrySummary}</span>}
        </span>
      </button>
      <div className="border-t border-border/70 bg-background/35" data-upid-point-stack>
        {renderPointRow({
          index,
          onHoverPathElement,
          onSelectPathElement,
          pathElement,
          point: start,
          pathDocument,
          role: 'start',
          segment,
          hoveredPathElement,
          isSaving,
          onSetPathStartFromElement,
          selectedPathElement
        })}
        {renderPointRow({
          index,
          onHoverPathElement,
          onSelectPathElement,
          pathElement,
          point: end,
          pathDocument,
          role: 'end',
          segment,
          hoveredPathElement,
          isSaving,
          onSetPathStartFromElement,
          selectedPathElement
        })}
      </div>
    </div>
  );
}

function renderPointRow({
  hoveredPathElement,
  index,
  isSaving,
  onHoverPathElement,
  onSelectPathElement,
  onSetPathStartFromElement,
  pathElement,
  point,
  pathDocument,
  role,
  segment,
  selectedPathElement
}: {
  hoveredPathElement: EditorPathElementRef | null;
  index: number;
  isSaving: boolean;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  onSetPathStartFromElement: (element: EditorPathElementRef) => void;
  pathElement: UpidOperationPathElement;
  pathDocument: PathPlanningDocument;
  point: { x: number; y: number };
  role: 'start' | 'end';
  segment: PathSegment;
  selectedPathElement: EditorPathElementRef | null;
}) {
  const element: EditorPathElementRef = {
    operationId: pathElement.operationId,
    pathElementId: pathElement.id,
    segmentId: segment.id,
    pointRole: role
  };
  const hovered =
    hoveredPathElement?.operationId === pathElement.operationId &&
    hoveredPathElement.segmentId === segment.id &&
    hoveredPathElement.pointRole === role;
  const selected =
    selectedPathElement?.operationId === pathElement.operationId &&
    selectedPathElement.segmentId === segment.id &&
    selectedPathElement.pointRole === role;
  const selectedPoint = readUpidSelectedPathPoint(pathDocument, pathElement, element);
  const endpointCluster = selectedPoint?.endpointCluster ?? null;
  const endpointClusterGap = endpointCluster ? formatNumber(endpointCluster.maxPairDistance) : undefined;
  const endpointClusterSummary = endpointCluster
    ? `cluster ${endpointCluster.method} / gap ${endpointClusterGap} / ${endpointCluster.memberCount} ends`
    : null;

  return (
    <div
      className={`grid w-full grid-cols-[38px_minmax(0,1fr)_20px] gap-1 px-1.5 py-0.5 pl-5 text-left text-[8px] text-muted-foreground outline-none hover:bg-accent ${
        selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : ''
      }`}
      data-upid-hovered={hovered ? 'true' : undefined}
      data-upid-operation-id={pathElement.operationId}
      data-upid-path-element-id={pathElement.id}
      data-upid-point-cluster-gap={endpointClusterGap}
      data-upid-point-cluster-id={endpointCluster?.id}
      data-upid-point-cluster-members={endpointCluster?.memberCount}
      data-upid-point-cluster-method={endpointCluster?.method}
      data-upid-selected={selected ? 'true' : undefined}
      data-upid-segment-index={index}
      data-upid-segment-id={segment.id}
      data-upid-point-role={role}
      data-upid-point-row
      onMouseEnter={() => onHoverPathElement(element)}
      onMouseLeave={() => onHoverPathElement(null)}
    >
      <button
        aria-pressed={selected}
        className="col-span-2 grid min-w-0 grid-cols-[38px_minmax(0,1fr)] gap-1 text-left outline-none"
        onClick={() => onSelectPathElement(element)}
        type="button"
      >
        <span className="uppercase">{role}</span>
        <span className="min-w-0">
          <span className="block truncate">{formatPoint(point)}</span>
          {endpointClusterSummary && <span className="block truncate">{endpointClusterSummary}</span>}
        </span>
      </button>
      <button
        aria-label="Set path start to this point"
        className="flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!pathElement.closed || isSaving}
        onClick={(event) => {
          event.stopPropagation();
          onSelectPathElement(element);
          onSetPathStartFromElement(element);
        }}
        title="Set start to this point"
        type="button"
      >
        <Flag className="size-3" />
      </button>
    </div>
  );
}

function formatPoint(point: { x: number; y: number }) {
  return `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`;
}

function formatSegmentGeometrySummary(geometry: UpidSelectedPathSegmentGeometry) {
  if (geometry.kind === 'line') return null;

  return [
    `R ${formatNumber(geometry.radius)}`,
    `sweep ${formatNumber(geometry.sweepDegrees)} deg`,
    geometry.clockwise ? 'cw' : 'ccw'
  ].join(' / ');
}

function formatNumber(value: number) {
  return value.toFixed(3);
}
