import {
  ArrowDown,
  ArrowUp,
  FileText,
  Magnet,
  MousePointer2,
  Redo2,
  RefreshCw,
  Save,
  Undo2
} from 'lucide-react';

import type { MagnetizeMode } from '@/domain/path-editor/pathDocumentOperations';
import {
  orientedSegmentEnd,
  orientedSegmentStart,
  requiredSegment,
  segmentMap
} from '@/domain/path-intel/segments';
import type {
  ContourClassification,
  OrientedSegmentRef,
  PathContour,
  PathOperation,
  PathPlanningDocument,
  PathSegment
} from '@/domain/path-intel/types';

export interface EditorPathElementRef {
  operationId: string | null;
  segmentId: string | null;
}

const iconButtonClass =
  'flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';
const textButtonClass =
  'flex h-6 items-center justify-center gap-1 border border-border px-1.5 text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';
const modeButtonClass =
  'flex h-6 items-center justify-center gap-1 border border-border px-1 text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';
const activeModeButtonClass =
  'flex h-6 items-center justify-center gap-1 border border-primary bg-primary px-1 text-[10px] text-primary-foreground outline-none transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40';
const CONTOUR_ROLE_OPTIONS: ContourClassification[] = ['exterior', 'hole', 'island', 'ambiguous'];

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
  onMovePathOperation: (direction: -1 | 1) => void;
  onOpenExportPreview: () => void;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onRedoDraft: () => void;
  onReversePathOperation: () => void;
  onSaveClick: () => void | Promise<void>;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  onSetPathOperationClassification: (classification: ContourClassification) => void;
  onToggleHoverAssist: () => void;
  onToggleMagneticSnap: () => void;
  onUndoDraft: () => void;
}

interface ContourTreeNode {
  children: ContourTreeNode[];
  contour: PathContour;
  operation: PathOperation;
}

type ManualDecisionKind = 'order' | 'role' | 'direction' | 'start';

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
  onToggleHoverAssist,
  onToggleMagneticSnap,
  onUndoDraft
}: EditorPathNavigatorPanelProps) {
  const segmentsById = segmentMap(pathDocument.segments);
  const contoursById = new Map(pathDocument.contours.map((contour) => [contour.id, contour]));
  const operationsByContourId = new Map(
    pathDocument.plan.operations.map((operation) => [operation.contourId, operation])
  );
  const contourTree = buildContourTree(pathDocument.contours, operationsByContourId);
  const selectedOperationIndex = pathDocument.plan.operations.findIndex(
    (operation) => operation.id === selectedPathOperationId
  );
  const selectedOperation =
    selectedOperationIndex >= 0 ? pathDocument.plan.operations[selectedOperationIndex] : null;

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
            {pathDocument.plan.operations.length} operations / {pathDocument.contours.length} contours
          </p>
        </div>

        <div className="shrink-0 border-b border-border py-2" data-upid-path-action-bar>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9px] uppercase text-muted-foreground">Path Action Bar</span>
            {hasUnsavedChanges && <span className="text-[9px] text-amber-200">Unsaved</span>}
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

        <section className="shrink-0 border-b border-border py-2" data-upid-cut-sequence>
          <div className="mb-2 text-[9px] uppercase text-muted-foreground">Cut Sequence</div>
          <div className="max-h-32 overflow-auto border border-border bg-background/35" data-upid-cut-sequence-list>
            {pathDocument.plan.operations.map((operation) =>
              renderCutSequenceRow({
                contour: contoursById.get(operation.contourId),
                hoveredPathElement,
                onHoverPathElement,
                onSelectPathElement,
                operation,
                selectedPathElement
              })
            )}
          </div>
        </section>

        <section className="min-h-0 flex-1 overflow-auto py-2" data-upid-contour-tree>
          <div className="mb-2 text-[9px] uppercase text-muted-foreground">Contour Tree</div>
          {contourTree.map((node) =>
            renderContourTreeNode({
              hoveredPathElement,
              node,
              onHoverPathElement,
              onSelectPathElement,
              selectedPathElement,
              selectedPathOperationId,
              segmentsById,
              treeDepth: 0
            })
          )}
        </section>
      </section>
    </div>
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
  contour,
  hoveredPathElement,
  onHoverPathElement,
  onSelectPathElement,
  operation,
  selectedPathElement
}: {
  contour: PathContour | undefined;
  hoveredPathElement: EditorPathElementRef | null;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  operation: PathOperation;
  selectedPathElement: EditorPathElementRef | null;
}) {
  const selected = selectedPathElement?.operationId === operation.id;
  const hovered = hoveredPathElement?.operationId === operation.id;
  const manualDecisions = manualDecisionKinds(operation);

  return (
    <button
      aria-pressed={selected}
      className={`grid w-full grid-cols-[24px_minmax(0,1fr)_52px] items-center gap-1 border-b border-border px-1.5 py-1.5 text-left last:border-b-0 outline-none hover:bg-accent ${
        selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/10 text-cyan-100' : ''
      }`}
      data-upid-cut-sequence-index={operation.orderIndex}
      data-upid-cut-sequence-manual={manualDecisions.length > 0 ? manualDecisions.join(' ') : undefined}
      data-upid-cut-sequence-role={operation.classification}
      data-upid-cut-sequence-row
      data-upid-hovered={hovered ? 'true' : undefined}
      data-upid-operation-id={operation.id}
      data-upid-selected={selected ? 'true' : undefined}
      key={`cut-sequence-${operation.id}`}
      onClick={() => onSelectPathElement({ operationId: operation.id, segmentId: null })}
      onMouseEnter={() => onHoverPathElement({ operationId: operation.id, segmentId: null })}
      onMouseLeave={() => onHoverPathElement(null)}
      type="button"
    >
      <span className="text-muted-foreground">{operation.orderIndex + 1}</span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] uppercase">{operation.classification}</span>
        <span className="block truncate text-[9px] text-muted-foreground">
          {operation.closed ? 'closed contour' : 'open chain'} / {operation.direction}
        </span>
        <span className="block truncate text-[9px] text-muted-foreground">
          {formatContourNest(contour)}
        </span>
        {renderManualDecisionBadges(manualDecisions)}
      </span>
      <span className="text-right text-[9px] text-muted-foreground">
        {operation.metrics.cutLength.toFixed(3)}
      </span>
    </button>
  );
}

function renderContourTreeNode({
  hoveredPathElement,
  node,
  onHoverPathElement,
  onSelectPathElement,
  selectedPathElement,
  selectedPathOperationId,
  segmentsById,
  treeDepth
}: {
  hoveredPathElement: EditorPathElementRef | null;
  node: ContourTreeNode;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  segmentsById: ReturnType<typeof segmentMap>;
  treeDepth: number;
}) {
  const { contour, operation } = node;
  const nested = treeDepth > 0;
  const manualDecisions = manualDecisionKinds(operation);

  return (
    <details
      className={
        nested
          ? 'ml-3 border-l border-border/80 bg-background/20 pl-2'
          : 'mb-1 border border-border bg-background/45'
      }
      data-upid-hovered={hoveredPathElement?.operationId === operation.id ? 'true' : undefined}
      data-upid-contour-group={operation.id}
      data-upid-selected={selectedPathElement?.operationId === operation.id ? 'true' : undefined}
      data-upid-tree-depth={treeDepth}
      key={operation.id}
      open
    >
      <summary className="list-none">
        <button
          aria-pressed={operation.id === selectedPathOperationId}
          className={`grid w-full grid-cols-[24px_minmax(0,1fr)_52px] items-center gap-1 px-1.5 py-1.5 text-left outline-none hover:bg-accent ${
            operation.id === selectedPathOperationId
              ? 'bg-sky-500/15 text-sky-100'
              : hoveredPathElement?.operationId === operation.id
                ? 'bg-cyan-500/10 text-cyan-100'
                : ''
          }`}
          data-upid-contour-children={contour.childIds.length}
          data-upid-contour-depth={contour.containmentDepth}
          data-upid-contour-manual={manualDecisions.length > 0 ? manualDecisions.join(' ') : undefined}
          data-upid-contour-parent={contour.parentId ?? undefined}
          data-upid-contour-role={contour.classification}
          data-upid-contour-row
          data-upid-operation-id={operation.id}
          data-upid-selected={
            selectedPathElement?.operationId === operation.id && !selectedPathElement.segmentId
              ? 'true'
              : undefined
          }
          onClick={(event) => {
            event.preventDefault();
            onSelectPathElement({ operationId: operation.id, segmentId: null });
          }}
          onMouseEnter={() => onHoverPathElement({ operationId: operation.id, segmentId: null })}
          onMouseLeave={() => onHoverPathElement(null)}
          type="button"
        >
          <span className="text-muted-foreground">{operation.orderIndex + 1}</span>
          <span className="min-w-0">
            <span className="block truncate text-[10px] uppercase">{operation.classification}</span>
            <span className="block truncate text-[9px] text-muted-foreground">
              {operation.closed ? 'closed contour' : 'open chain'} / {operation.direction}
            </span>
            <span className="block truncate text-[9px] text-muted-foreground">
              {formatContourNest(contour)}
            </span>
            {renderManualDecisionBadges(manualDecisions)}
          </span>
          <span className="text-right text-[9px] text-muted-foreground">
            {operation.metrics.cutLength.toFixed(3)}
          </span>
        </button>
      </summary>
      <div className="border-t border-border bg-card/35 py-1" data-upid-segment-stack>
        {operation.segmentRefs.map((ref, index) =>
          renderSegmentRow(
            operation,
            ref,
            index,
            requiredSegment(segmentsById, ref.segmentId),
            hoveredPathElement,
            selectedPathElement,
            onHoverPathElement,
            onSelectPathElement
          )
        )}
      </div>
      {node.children.length > 0 && (
        <div className="py-1" data-upid-contour-children-list>
          {node.children.map((child) =>
            renderContourTreeNode({
              hoveredPathElement,
              node: child,
              onHoverPathElement,
              onSelectPathElement,
              selectedPathElement,
              selectedPathOperationId,
              segmentsById,
              treeDepth: treeDepth + 1
            })
          )}
        </div>
      )}
    </details>
  );
}

function renderManualDecisionBadges(decisions: ManualDecisionKind[]) {
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

function renderSegmentRow(
  operation: PathOperation,
  ref: OrientedSegmentRef,
  index: number,
  segment: PathSegment,
  hoveredPathElement: EditorPathElementRef | null,
  selectedPathElement: EditorPathElementRef | null,
  onHoverPathElement: (element: EditorPathElementRef | null) => void,
  onSelectPathElement: (element: EditorPathElementRef) => void
) {
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const hovered =
    hoveredPathElement?.operationId === operation.id && hoveredPathElement.segmentId === segment.id;
  const selected =
    selectedPathElement?.operationId === operation.id && selectedPathElement.segmentId === segment.id;

  return (
    <button
      aria-pressed={selected}
      className={`grid w-full grid-cols-[26px_minmax(0,1fr)] gap-1 px-1.5 py-1 text-left text-[9px] text-muted-foreground outline-none hover:bg-accent ${
        selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : ''
      }`}
      data-upid-hovered={hovered ? 'true' : undefined}
      data-upid-operation-id={operation.id}
      data-upid-selected={selected ? 'true' : undefined}
      data-upid-segment-index={index}
      data-upid-segment-row
      data-upid-segment-id={segment.id}
      key={`${operation.id}-${segment.id}-${index}`}
      onClick={() => onSelectPathElement({ operationId: operation.id, segmentId: segment.id })}
      onMouseEnter={() => onHoverPathElement({ operationId: operation.id, segmentId: segment.id })}
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
      </span>
    </button>
  );
}

function formatPoint(point: { x: number; y: number }) {
  return `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`;
}

function formatContourNest(contour: PathContour | undefined) {
  if (!contour) return 'depth 0 / children 0';
  return `depth ${contour.containmentDepth} / children ${contour.childIds.length}`;
}

function manualDecisionKinds(operation: PathOperation): ManualDecisionKind[] {
  const overrides = operation.overrides;
  if (!overrides) return [];

  const decisions: ManualDecisionKind[] = [];
  if (overrides.order) decisions.push('order');
  if (overrides.classification) decisions.push('role');
  if (overrides.direction) decisions.push('direction');
  if (overrides.start) decisions.push('start');
  return decisions;
}

function buildContourTree(
  contours: PathContour[],
  operationsByContourId: Map<string, PathOperation>
): ContourTreeNode[] {
  const contoursById = new Map(contours.map((contour) => [contour.id, contour]));
  const visited = new Set<string>();

  function buildNode(contour: PathContour): ContourTreeNode | null {
    if (visited.has(contour.id)) return null;
    const operation = operationsByContourId.get(contour.id);
    if (!operation) return null;

    visited.add(contour.id);
    return {
      children: contour.childIds
        .map((childId) => contoursById.get(childId))
        .filter((child): child is PathContour => Boolean(child))
        .map((child) => buildNode(child))
        .filter((child): child is ContourTreeNode => Boolean(child)),
      contour,
      operation
    };
  }

  const roots = contours.filter((contour) => {
    if (!operationsByContourId.has(contour.id)) return false;
    return !contour.parentId || !contoursById.has(contour.parentId) || !operationsByContourId.has(contour.parentId);
  });
  const rootNodes = roots.map((contour) => buildNode(contour)).filter((node): node is ContourTreeNode => Boolean(node));

  const orphanNodes = contours
    .filter((contour) => operationsByContourId.has(contour.id) && !visited.has(contour.id))
    .map((contour) => buildNode(contour))
    .filter((node): node is ContourTreeNode => Boolean(node));

  return [...rootNodes, ...orphanNodes];
}
