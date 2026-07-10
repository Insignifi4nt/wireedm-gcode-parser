import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileText,
  FlipHorizontal,
  FlipVertical,
  Flag,
  Magnet,
  MousePointer2,
  Move,
  Redo2,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Undo2
} from 'lucide-react';
import {
  useEffect,
  useState,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type SetStateAction
} from 'react';

import {
  canSetCircleOperationCenterPierceLeadIn,
  type MagnetizeMode,
  type PathMirrorAxis
} from '@/domain/path-editor/pathDocumentOperations';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import {
  orientedSegmentEnd,
  orientedSegmentStart,
  requiredSegment,
  segmentMap
} from '@/domain/path-intel/segments';
import type {
  Bounds2,
  ContourClassification,
  OperationOrderStrategy,
  OrientedSegmentRef,
  PathPlanningDocument,
  PathSegment,
  Point2
} from '@/domain/path-intel/types';
import {
  createUpidProjectRail,
  readUpidEndpointTopologyRows,
  readUpidPathDiagnostics,
  readUpidSegmentGeometry,
  readUpidSelectedPathPoint,
  summarizeUpidDiagnosticsForPathElementRef,
  upidManualDecisionKinds,
  upidPathElementAncestorIds,
  upidPathElementNestLabel,
  upidPathElementRefsMatch,
  upidPathElementSourceEntityCount,
  type UpidManualDecisionKind,
  type UpidOperationPathElement,
  type UpidPathElementRef,
  type UpidEndpointTopologyRow,
  type UpidPathDiagnosticSummary,
  type UpidSelectedPathDiagnostic,
  type UpidSelectedPathSegmentGeometry,
  type UpidProjectRail,
  type UpidProjectRailTreeNode
} from '@/domain/upid/projectRail';
import {
  readBoundsAnchorPoint,
  readPathDocumentBounds,
  readPathDocumentBoundsCenter,
  readPathSelectionBoundsCenter,
  type PathBoundsAnchor
} from './pathSelectionGeometry';

export type EditorPathElementRef = UpidPathElementRef;

const iconButtonClass =
  'flex size-7 items-center justify-center rounded-[2px] border border-border text-muted-foreground outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const textButtonClass =
  'flex h-7 items-center justify-center gap-1 rounded-[2px] border border-border px-1.5 text-[10px] text-muted-foreground outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const modeButtonClass =
  'flex h-7 items-center justify-center gap-1 rounded-[2px] border border-border px-1 text-[10px] text-muted-foreground outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const activeModeButtonClass =
  'flex h-7 items-center justify-center gap-1 rounded-[2px] border border-primary bg-primary px-1 text-[10px] text-primary-foreground outline-none transition hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const CONTOUR_ROLE_OPTIONS: ContourClassification[] = ['exterior', 'hole', 'island', 'ambiguous'];
const ORDER_STRATEGY_OPTIONS: Array<{
  label: string;
  value: OperationOrderStrategy;
}> = [
  { label: 'Inside/out nearest', value: 'inside-out-nearest' },
  { label: 'Nearest travel', value: 'nearest' },
  { label: 'Source order', value: 'source-order' }
];
type DiagnosticPanelActionId = 'endpoint-topology' | 'contour-tree' | 'cut-sequence';
type PathTransformTarget = 'document' | 'selection';
type DocumentReferenceMode = PathBoundsAnchor | 'picked';
const DOCUMENT_REFERENCE_OPTIONS: Array<{
  label: string;
  value: DocumentReferenceMode;
}> = [
  { label: 'Center', value: 'center' },
  { label: 'Min XY', value: 'min' },
  { label: 'Max XY', value: 'max' },
  { label: 'Min X / Max Y', value: 'min-x-max-y' },
  { label: 'Max X / Min Y', value: 'max-x-min-y' },
  { label: 'Picked Point', value: 'picked' }
];
interface DiagnosticGuidance {
  actions: Array<{
    label: string;
    panelId: DiagnosticPanelActionId;
  }>;
  text: string;
  title: string;
}

interface EditorPathNavigatorPanelProps {
  hasUnsavedChanges: boolean;
  hoveredPathElement: EditorPathElementRef | null;
  hoverAssistEnabled: boolean;
  isSaving: boolean;
  magneticSnapEnabled: boolean;
  pathClickMode: 'set-start' | MagnetizeMode | null;
  pathDocument: PathPlanningDocument;
  expandedPathElementIds: Record<string, boolean>;
  renderWorkspacePanel?: (
    id: string,
    title: string,
    children: ReactNode,
    options?: { fill?: boolean }
  ) => ReactNode;
  latestMeasurementPoint: Point2 | null;
  measurementPoints: MeasurementPoint[];
  pathTargetXDraft: string;
  pathTargetYDraft: string;
  pathTranslateXDraft: string;
  pathTranslateYDraft: string;
  redoAvailable: boolean;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  undoAvailable: boolean;
  onExpandedPathElementIdsChange: Dispatch<SetStateAction<Record<string, boolean>>>;
  onActivatePathClickMode: (mode: 'set-start' | MagnetizeMode | null) => void;
  onMovePathOperation: (direction: -1 | 1, operationId?: string) => void;
  onMovePathSelectionCenter: (targetCenter: Point2) => void;
  onMoveSelectedSegmentCenter: (targetCenter: Point2) => void;
  onOpenWorkspacePanel?: (panelId: DiagnosticPanelActionId) => void;
  onOpenWorkspacePanels?: (panelIds: DiagnosticPanelActionId[]) => void;
  onOpenExportPreview: () => void;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onMirrorPathDocument: (axis: PathMirrorAxis) => void;
  onMirrorPathSelection: (axis: PathMirrorAxis) => void;
  onRedoDraft: () => void;
  onReversePathOperation: () => void;
  onRotatePathDocument: (angleDegrees: number) => void;
  onRotatePathSelection: (angleDegrees: number) => void;
  onSaveClick: () => void | Promise<void>;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  onPathTargetXDraftChange: (value: string) => void;
  onPathTargetYDraftChange: (value: string) => void;
  onPathTranslateXDraftChange: (value: string) => void;
  onPathTranslateYDraftChange: (value: string) => void;
  onSetPathOperationClassification: (classification: ContourClassification) => void;
  onSetPathOperationCenterPierceLeadIn: () => void;
  onSetPathOperationOrderStrategy: (strategy: OperationOrderStrategy) => void;
  onSetPathStartFromElement: (element: EditorPathElementRef) => void;
  onTranslatePathSelection: (delta: { x: number; y: number }) => void;
  onTranslatePathDocument: (delta: { x: number; y: number }) => void;
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
  expandedPathElementIds,
  latestMeasurementPoint,
  measurementPoints,
  renderWorkspacePanel = (_id, _title, children) => children,
  redoAvailable,
  selectedPathElement,
  selectedPathOperationId,
  undoAvailable,
  onExpandedPathElementIdsChange,
  onActivatePathClickMode,
  onMovePathOperation,
  onMovePathSelectionCenter,
  onMoveSelectedSegmentCenter,
  onOpenWorkspacePanel,
  onOpenWorkspacePanels,
  onOpenExportPreview,
  onHoverPathElement,
  onMirrorPathDocument,
  onMirrorPathSelection,
  onRedoDraft,
  onReversePathOperation,
  onRotatePathDocument,
  onRotatePathSelection,
  onSaveClick,
  onSelectPathElement,
  onPathTargetXDraftChange,
  onPathTargetYDraftChange,
  onPathTranslateXDraftChange,
  onPathTranslateYDraftChange,
  onSetPathOperationClassification,
  onSetPathOperationCenterPierceLeadIn,
  onSetPathOperationOrderStrategy,
  onSetPathStartFromElement,
  onTranslatePathDocument,
  onTranslatePathSelection,
  onToggleHoverAssist,
  onToggleMagneticSnap,
  onUndoDraft,
  pathTargetXDraft,
  pathTargetYDraft,
  pathTranslateXDraft,
  pathTranslateYDraft
}: EditorPathNavigatorPanelProps) {
  const segmentsById = segmentMap(pathDocument.segments);
  const projectRail = createUpidProjectRail(pathDocument);
  const { contourTree, cutSequenceElements, manualOrderActive } = projectRail;
  const endpointTopology = projectRail.summary.topology;
  const sourceSummary = projectRail.summary.source;
  const endpointTopologyRows = readUpidEndpointTopologyRows(pathDocument);
  const endpointTopologyPanel = summarizeEndpointTopologyPanel(pathDocument);
  const pathDiagnostics = readUpidPathDiagnostics(pathDocument);
  const pathTreeElementIds = projectRail.operationElements.map((element) => element.id);
  const selectedOperationIndex = pathDocument.plan.operations.findIndex(
    (operation) => operation.id === selectedPathOperationId
  );
  const selectedOperation =
    selectedOperationIndex >= 0 ? pathDocument.plan.operations[selectedOperationIndex] : null;
  const selectedSegmentIndex =
    selectedOperation && selectedPathElement?.segmentId
      ? selectedOperation.segmentRefs.findIndex((ref) => ref.segmentId === selectedPathElement.segmentId)
      : -1;
  const selectedSegment =
    selectedPathElement?.segmentId ? segmentsById.get(selectedPathElement.segmentId) ?? null : null;
  const selectedSegmentCenter = selectedSegment && selectedSegment.kind !== 'line' ? selectedSegment.center : null;
  const documentBounds = readPathDocumentBounds(pathDocument);
  const documentCenter = readPathDocumentBoundsCenter(pathDocument);
  const selectedGeometryCenter = readPathSelectionBoundsCenter(
    pathDocument,
    selectedPathElement,
    selectedPathOperationId
  );
  const translateX = Number(pathTranslateXDraft);
  const translateY = Number(pathTranslateYDraft);
  const targetX = Number(pathTargetXDraft);
  const targetY = Number(pathTargetYDraft);
  const translateTargetLabel = selectedPathElement?.segmentId
    ? `Segment ${selectedSegmentIndex >= 0 ? selectedSegmentIndex + 1 : ''}`.trim()
    : selectedOperation
      ? selectedOperation.closed
        ? selectedOperation.displayName
        : 'Open chain'
      : 'No selection';
  const canTranslateSelection =
    Boolean(selectedOperation) &&
    Number.isFinite(translateX) &&
    Number.isFinite(translateY) &&
    (translateX !== 0 || translateY !== 0) &&
    !isSaving;
  const canMoveSelectedSegmentCenter =
    Boolean(selectedSegmentCenter) &&
    Number.isFinite(targetX) &&
    Number.isFinite(targetY) &&
    (!selectedSegmentCenter || targetX !== selectedSegmentCenter.x || targetY !== selectedSegmentCenter.y) &&
    !isSaving;
  const canMoveSelectedGeometryCenter =
    Boolean(selectedGeometryCenter) &&
    Number.isFinite(targetX) &&
    Number.isFinite(targetY) &&
    (!selectedGeometryCenter || targetX !== selectedGeometryCenter.x || targetY !== selectedGeometryCenter.y) &&
    !isSaving;
  const hasTransformSelection = Boolean(selectedOperation && selectedGeometryCenter);
  const canOrientDocument = Boolean(documentCenter) && pathDocument.segments.length > 0 && !isSaving;
  const canOrientSelection = hasTransformSelection && !isSaving;
  const canSetCenterPierceLeadIn =
    selectedPathOperationId
      ? canSetCircleOperationCenterPierceLeadIn(pathDocument, selectedPathOperationId) && !isSaving
      : false;
  const [pathTransformTarget, setPathTransformTarget] = useState<PathTransformTarget>('document');
  const [pathTransformTargetPinned, setPathTransformTargetPinned] = useState(false);
  const [documentReferenceMode, setDocumentReferenceMode] = useState<DocumentReferenceMode>('center');
  const [documentReferenceMeasurementPointId, setDocumentReferenceMeasurementPointId] = useState<string | null>(
    null
  );
  const selectedDocumentReferenceMeasurementPoint = documentReferenceMeasurementPointId
    ? measurementPoints.find((point) => point.id === documentReferenceMeasurementPointId) ?? null
    : null;
  const latestDocumentReferenceMeasurementPoint = measurementPoints.at(-1) ?? null;
  const pickedDocumentReferencePoint =
    selectedDocumentReferenceMeasurementPoint ?? latestDocumentReferenceMeasurementPoint;
  const documentReferencePoint =
    documentReferenceMode === 'picked'
      ? pickedDocumentReferencePoint
      : documentBounds
        ? readBoundsAnchorPoint(documentBounds, documentReferenceMode)
        : null;
  const documentOriginOffset = documentReferencePoint
    ? { x: -documentReferencePoint.x, y: -documentReferencePoint.y }
    : null;
  const selectedTransformIdentity =
    selectedPathElement?.segmentId ?? selectedPathElement?.pathElementId ?? selectedPathOperationId;
  const activePathTransformTarget =
    pathTransformTarget === 'selection' && hasTransformSelection ? 'selection' : 'document';
  const activePathTransformTargetName = activePathTransformTarget === 'document' ? 'document' : 'selection';
  const activeTransformTargetLabel =
    activePathTransformTarget === 'document' ? 'Document' : translateTargetLabel;
  const activeTransformCenter =
    activePathTransformTarget === 'document' ? documentCenter : selectedGeometryCenter;
  const activeTargetReferencePoint =
    activePathTransformTarget === 'document' ? documentReferencePoint : selectedGeometryCenter;
  const activeTargetReferenceName = activePathTransformTarget === 'document' ? 'reference' : 'center';
  const canTranslateDocument =
    Boolean(documentBounds) &&
    Number.isFinite(translateX) &&
    Number.isFinite(translateY) &&
    (translateX !== 0 || translateY !== 0) &&
    !isSaving;
  const canTranslateActiveTarget =
    activePathTransformTarget === 'document' ? canTranslateDocument : canTranslateSelection;
  const canMoveDocumentReference =
    Boolean(documentReferencePoint) &&
    Number.isFinite(targetX) &&
    Number.isFinite(targetY) &&
    (!documentReferencePoint || targetX !== documentReferencePoint.x || targetY !== documentReferencePoint.y) &&
    !isSaving;
  const canMoveActiveTargetReference =
    activePathTransformTarget === 'document' ? canMoveDocumentReference : canMoveSelectedGeometryCenter;
  const canOrientActiveTarget = activePathTransformTarget === 'document' ? canOrientDocument : canOrientSelection;
  const hoverRevealedPathElementIds = new Set(
    hoveredPathElement ? upidPathElementAncestorIds(pathDocument, hoveredPathElement) : []
  );
  const readDocumentReferencePoint = (
    mode: DocumentReferenceMode,
    measurementPointId = documentReferenceMeasurementPointId
  ): Point2 | null => {
    if (mode === 'picked') {
      if (measurementPointId) {
        return measurementPoints.find((point) => point.id === measurementPointId) ?? null;
      }

      return measurementPoints.at(-1) ?? null;
    }

    return documentBounds ? readBoundsAnchorPoint(documentBounds, mode) : null;
  };
  const setTargetDraftsFromPoint = (point: Point2 | null) => {
    if (!point) return;

    onPathTargetXDraftChange(formatNumber(point.x));
    onPathTargetYDraftChange(formatNumber(point.y));
  };
  const isPathElementExpanded = (pathElementId: string) =>
    hoverRevealedPathElementIds.has(pathElementId) || (expandedPathElementIds[pathElementId] ?? true);
  const togglePathElementExpanded = (pathElementId: string) => {
    onExpandedPathElementIdsChange((current) => ({
      ...current,
      [pathElementId]: !(current[pathElementId] ?? true)
    }));
  };
  const setPathTreeExpanded = (expanded: boolean) => {
    onExpandedPathElementIdsChange((current) => {
      const next = { ...current };

      for (const pathElementId of pathTreeElementIds) {
        next[pathElementId] = expanded;
      }

      return next;
    });
  };

  useEffect(() => {
    setTargetDraftsFromPoint(activeTargetReferencePoint);
  }, [
    activePathTransformTarget,
    activeTargetReferencePoint?.x,
    activeTargetReferencePoint?.y,
    documentReferenceMode,
    documentReferenceMeasurementPointId
  ]);

  useEffect(() => {
    if (pathTransformTargetPinned) return;

    setPathTransformTarget(selectedTransformIdentity ? 'selection' : 'document');
  }, [pathTransformTargetPinned, selectedTransformIdentity]);

  useEffect(() => {
    if (pathTransformTarget !== 'selection' || hasTransformSelection) return;

    setPathTransformTarget('document');
    setPathTransformTargetPinned(false);
  }, [hasTransformSelection, pathTransformTarget]);

  useEffect(() => {
    const pathElementIdsToReveal = selectedPathElement
      ? upidPathElementAncestorIds(pathDocument, selectedPathElement)
      : [];
    if (pathElementIdsToReveal.length === 0) return;

    onExpandedPathElementIdsChange((current) => {
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
  }, [onExpandedPathElementIdsChange, pathDocument, selectedPathElement]);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden p-2 text-[10px]"
      data-editor-project-rail
    >
      <section className="work-region-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-auto" data-upid-path-navigator>
        {renderWorkspacePanel('path-summary', 'Path Summary', (
        <div>
          <p className="text-[9px] uppercase text-muted-foreground">Project Rail</p>
          <h2 className="mt-1 text-sm font-semibold">UPID Path Navigator</h2>
          <p className="mt-1 text-[9px] text-muted-foreground">
            {projectRail.summary.operationCount} operations / {projectRail.summary.contourCount} contours
          </p>
          <p
            className="mt-1 truncate text-[9px] text-muted-foreground"
            data-upid-topology-ambiguous={endpointTopology.ambiguousEndpointClusterCount}
            data-upid-topology-clusters={endpointTopology.endpointClusterCount}
            data-upid-topology-max-gap={endpointTopology.maxEndpointSnapGap.toFixed(3)}
            data-upid-topology-snapped={endpointTopology.snappedEndpointClusterCount}
            data-upid-topology-snapped-endpoints={endpointTopology.snappedEndpointCount}
            data-upid-topology-summary
          >
            Topology: {endpointTopology.endpointClusterCount} clusters / snapped{' '}
            {endpointTopology.snappedEndpointClusterCount} / max gap{' '}
            {endpointTopology.maxEndpointSnapGap.toFixed(3)}
            {endpointTopology.ambiguousEndpointClusterCount > 0 && (
              <> / ambiguous {endpointTopology.ambiguousEndpointClusterCount}</>
            )}
          </p>
          <p
            className="mt-1 text-[9px] text-muted-foreground"
            data-upid-path-manual-decision-count={projectRail.summary.manualDecisionCount}
            data-upid-path-manual-decision-direction={projectRail.summary.manualDecisionCounts.direction}
            data-upid-path-manual-decision-lead-in={projectRail.summary.manualDecisionCounts['lead-in']}
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
          <p
            className="mt-1 truncate text-[9px] text-muted-foreground"
            data-upid-source-approximated-segments={sourceSummary.approximatedSegmentCount}
            data-upid-source-block-count={sourceSummary.blockCount}
            data-upid-source-blocks={
              sourceSummary.blockNames.length > 0 ? sourceSummary.blockNames.join(', ') : undefined
            }
            data-upid-source-edited-segments={sourceSummary.editedSegmentCount}
            data-upid-source-entities={sourceSummary.entityCount}
            data-upid-source-exact-segments={sourceSummary.exactSegmentCount}
            data-upid-source-insert-block-count={sourceSummary.insertBlockCount}
            data-upid-source-inserted-segments={sourceSummary.insertedSegmentCount}
            data-upid-source-inserts={
              sourceSummary.insertBlockNames.length > 0 ? sourceSummary.insertBlockNames.join(', ') : undefined
            }
            data-upid-source-layer-count={sourceSummary.layerCount}
            data-upid-source-layers={formatSourceLayers(sourceSummary.layers)}
            data-upid-source-segments={sourceSummary.segmentCount}
            data-upid-source-summary
          >
            {formatProjectSourceSummary(sourceSummary)}
          </p>
        </div>
        ))}

        {renderWorkspacePanel('path-actions', 'Path Actions', (
        <div data-upid-path-action-bar>
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
          <div className="mt-1 grid grid-cols-4 gap-1">
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
              aria-label="Add center pierce lead-in"
              aria-pressed={Boolean(selectedOperation?.overrides?.leadIn)}
              className={selectedOperation?.overrides?.leadIn ? activeModeButtonClass : modeButtonClass}
              disabled={!canSetCenterPierceLeadIn}
              onClick={onSetPathOperationCenterPierceLeadIn}
              type="button"
            >
              <Flag className="size-3" />
              Pierce
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
        ))}

        {renderWorkspacePanel('path-transform', 'Transform', (
        <section data-upid-path-transform>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9px] uppercase text-muted-foreground">Placement</span>
            <span className="truncate text-[9px] text-muted-foreground" data-upid-transform-target>
              {activeTransformTargetLabel}
            </span>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-1" data-upid-transform-target-mode>
            <button
              aria-label="Target document for transform"
              aria-pressed={activePathTransformTarget === 'document'}
              className={activePathTransformTarget === 'document' ? activeModeButtonClass : modeButtonClass}
              disabled={!documentBounds || isSaving}
              onClick={() => {
                setPathTransformTarget('document');
                setPathTransformTargetPinned(true);
              }}
              type="button"
            >
              Document
            </button>
            <button
              aria-label="Target selection for transform"
              aria-pressed={activePathTransformTarget === 'selection'}
              className={activePathTransformTarget === 'selection' ? activeModeButtonClass : modeButtonClass}
              disabled={!hasTransformSelection || isSaving}
              onClick={() => {
                setPathTransformTarget('selection');
                setPathTransformTargetPinned(true);
              }}
              type="button"
            >
              Selection
            </button>
          </div>
          <div
            className="mb-3 border border-border bg-background/35 p-2"
            data-upid-transform-document-placement
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase text-muted-foreground">Reference</span>
              <select
                aria-label="Document reference point"
                className="h-6 max-w-[132px] border border-border bg-background px-1 font-mono text-[9px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-upid-transform-document-reference
                disabled={!documentBounds || isSaving}
                onChange={(event) => {
                  const nextMode = event.currentTarget.value as DocumentReferenceMode;
                  const nextMeasurementPointId =
                    nextMode === 'picked'
                      ? documentReferenceMeasurementPointId ?? measurementPoints.at(-1)?.id ?? null
                      : documentReferenceMeasurementPointId;
                  setDocumentReferenceMode(nextMode);
                  if (nextMode === 'picked' && nextMeasurementPointId !== documentReferenceMeasurementPointId) {
                    setDocumentReferenceMeasurementPointId(nextMeasurementPointId);
                  }
                  setTargetDraftsFromPoint(readDocumentReferencePoint(nextMode, nextMeasurementPointId));
                }}
                value={documentReferenceMode}
              >
                {DOCUMENT_REFERENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="mb-2 text-[9px] leading-4 text-muted-foreground" data-upid-transform-document-placement-help>
              Move the active reference or selection center to X0 Y0, or enter a precise target. DXF
              source extents come from DXF header metadata and are shown unchanged.
            </p>
            <dl className="grid gap-1 font-mono text-[9px]">
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-1">
                <dt className="uppercase text-muted-foreground">Bounds</dt>
                <dd
                  className="truncate text-foreground"
                  data-upid-transform-document-bounds
                  title={documentBounds ? formatBounds(documentBounds) : 'No drawable bounds'}
                >
                  {documentBounds ? formatBounds(documentBounds) : '-'}
                </dd>
              </div>
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-1">
                <dt className="uppercase text-muted-foreground">Center</dt>
                <dd className="truncate text-foreground" data-upid-transform-document-center>
                  {documentCenter ? formatPoint(documentCenter) : '-'}
                </dd>
              </div>
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-1">
                <dt className="uppercase text-muted-foreground">Reference</dt>
                <dd className="truncate text-foreground" data-upid-transform-document-reference-point>
                  {documentReferencePoint ? formatPoint(documentReferencePoint) : '-'}
                </dd>
              </div>
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-1">
                <dt className="uppercase text-muted-foreground">To Origin</dt>
                <dd className="truncate text-foreground" data-upid-transform-origin-offset>
                  {documentOriginOffset ? formatPoint(documentOriginOffset) : '-'}
                </dd>
              </div>
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-1">
                <dt className="uppercase text-muted-foreground">Source Ext</dt>
                <dd className="truncate text-foreground" data-upid-transform-source-extents>
                  {formatDrawingExtents(pathDocument.source.drawing?.extents)}
                </dd>
              </div>
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-1">
                <dt className="uppercase text-muted-foreground">Source Base</dt>
                <dd className="truncate text-foreground" data-upid-transform-source-base>
                  {pathDocument.source.drawing?.basePoint
                    ? formatPoint(pathDocument.source.drawing.basePoint)
                    : '-'}
                </dd>
              </div>
            </dl>
            {documentReferenceMode === 'picked' && (
              <div
                className="mt-2 border-t border-border pt-2"
                data-upid-transform-document-reference-points
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[9px] uppercase text-muted-foreground">Picked Point</span>
                  <span className="truncate text-[9px] text-muted-foreground">
                    {pickedDocumentReferencePoint ? formatPoint(pickedDocumentReferencePoint) : 'No point'}
                  </span>
                </div>
                <div className="grid max-h-16 grid-cols-4 gap-1 overflow-auto">
                  <button
                    aria-label="Use latest measurement point as document reference"
                    className={textButtonClass}
                    data-upid-transform-document-reference-use-latest
                    disabled={!latestDocumentReferenceMeasurementPoint || isSaving}
                    onClick={() => {
                      setDocumentReferenceMeasurementPointId(
                        latestDocumentReferenceMeasurementPoint?.id ?? null
                      );
                      setTargetDraftsFromPoint(latestDocumentReferenceMeasurementPoint);
                    }}
                    type="button"
                  >
                    Latest
                  </button>
                  {measurementPoints.map((point, index) => (
                    <button
                      aria-label={`Use measurement point P${index + 1} as document reference`}
                      className={
                        point.id === pickedDocumentReferencePoint?.id ? activeModeButtonClass : textButtonClass
                      }
                      data-upid-transform-document-reference-use-point={index + 1}
                      disabled={isSaving}
                      key={point.id}
                      onClick={() => {
                        setDocumentReferenceMeasurementPointId(point.id);
                        setTargetDraftsFromPoint(point);
                      }}
                      title={`P${index + 1}: ${formatPoint(point)}`}
                      type="button"
                    >
                      P{index + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[9px] uppercase text-muted-foreground">Move</span>
            <span className="truncate text-[9px] text-muted-foreground">
              {activePathTransformTarget === 'document' ? 'Document geometry' : 'Selected geometry'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
              X
              <input
                aria-label="Translate X"
                className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-upid-transform-delta-x
                disabled={(activePathTransformTarget === 'document' ? !documentBounds : !selectedOperation) || isSaving}
                inputMode="decimal"
                onChange={(event) => onPathTranslateXDraftChange(event.currentTarget.value)}
                type="number"
                value={pathTranslateXDraft}
              />
            </label>
            <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
              Y
              <input
                aria-label="Translate Y"
                className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-upid-transform-delta-y
                disabled={(activePathTransformTarget === 'document' ? !documentBounds : !selectedOperation) || isSaving}
                inputMode="decimal"
                onChange={(event) => onPathTranslateYDraftChange(event.currentTarget.value)}
                type="number"
                value={pathTranslateYDraft}
              />
            </label>
          </div>
          <button
            aria-label={
              activePathTransformTarget === 'document'
                ? 'Apply translation to document geometry'
                : 'Apply translation to selected path geometry'
            }
            className={`mt-2 w-full ${textButtonClass}`}
            data-upid-transform-apply
            disabled={!canTranslateActiveTarget}
            onClick={() => {
              if (activePathTransformTarget === 'document') {
                onTranslatePathDocument({ x: translateX, y: translateY });
              } else {
                onTranslatePathSelection({ x: translateX, y: translateY });
              }
            }}
            type="button"
          >
            <Move className="size-3" />
            Apply Translation
          </button>
          <div className="mt-3 border-t border-border pt-2" data-upid-transform-orientation>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase text-muted-foreground">Orientation</span>
              <span className="truncate text-[9px] text-muted-foreground" data-upid-transform-orientation-origin>
                {activeTransformCenter ? formatPoint(activeTransformCenter) : '-'}
              </span>
            </div>
            <div
              className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-1"
              data-upid-transform-document-orientation={activePathTransformTarget === 'document' ? 'true' : undefined}
              data-upid-transform-selection-orientation={activePathTransformTarget === 'selection' ? 'true' : undefined}
            >
              <span className="truncate text-[9px] uppercase text-muted-foreground">
                {activePathTransformTarget}
              </span>
              <div className="grid grid-cols-5 gap-1">
                <button
                  aria-label={`Rotate ${activePathTransformTarget} 90 degrees counterclockwise`}
                  className={iconButtonClass}
                  disabled={!canOrientActiveTarget}
                  onClick={() =>
                    activePathTransformTarget === 'document'
                      ? onRotatePathDocument(-90)
                      : onRotatePathSelection(-90)
                  }
                  title={`Rotate ${activePathTransformTarget} 90 degrees counterclockwise`}
                  type="button"
                >
                  <RotateCcw className="size-3" />
                </button>
                <button
                  aria-label={`Rotate ${activePathTransformTarget} 90 degrees clockwise`}
                  className={iconButtonClass}
                  disabled={!canOrientActiveTarget}
                  onClick={() =>
                    activePathTransformTarget === 'document' ? onRotatePathDocument(90) : onRotatePathSelection(90)
                  }
                  title={`Rotate ${activePathTransformTarget} 90 degrees clockwise`}
                  type="button"
                >
                  <RotateCw className="size-3" />
                </button>
                <button
                  aria-label={`Rotate ${activePathTransformTarget} 180 degrees`}
                  className={iconButtonClass}
                  disabled={!canOrientActiveTarget}
                  onClick={() =>
                    activePathTransformTarget === 'document' ? onRotatePathDocument(180) : onRotatePathSelection(180)
                  }
                  title={`Rotate ${activePathTransformTarget} 180 degrees`}
                  type="button"
                >
                  <span className="font-mono text-[9px]">180</span>
                </button>
                <button
                  aria-label={`Mirror ${activePathTransformTarget} across X axis`}
                  className={iconButtonClass}
                  disabled={!canOrientActiveTarget}
                  onClick={() =>
                    activePathTransformTarget === 'document' ? onMirrorPathDocument('x') : onMirrorPathSelection('x')
                  }
                  title={`Mirror ${activePathTransformTarget} across X axis`}
                  type="button"
                >
                  <FlipVertical className="size-3" />
                </button>
                <button
                  aria-label={`Mirror ${activePathTransformTarget} across Y axis`}
                  className={iconButtonClass}
                  disabled={!canOrientActiveTarget}
                  onClick={() =>
                    activePathTransformTarget === 'document' ? onMirrorPathDocument('y') : onMirrorPathSelection('y')
                  }
                  title={`Mirror ${activePathTransformTarget} across Y axis`}
                  type="button"
                >
                  <FlipHorizontal className="size-3" />
                </button>
              </div>
            </div>
          </div>
          <div
            className="mt-3 border-t border-border pt-2"
            data-upid-transform-selection-center={activePathTransformTarget === 'selection' ? 'true' : undefined}
            data-upid-transform-selection-center-enabled={activeTargetReferencePoint ? 'true' : 'false'}
            data-upid-transform-target-center
            data-upid-transform-target-center-target={activePathTransformTarget}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase text-muted-foreground">
                {activePathTransformTarget === 'document' ? 'Reference Target' : 'Center Target'}
              </span>
              <span
                className="truncate text-[9px] text-muted-foreground"
                data-upid-transform-selection-center-current
                data-upid-transform-target-center-current
              >
                {activeTargetReferencePoint ? formatPoint(activeTargetReferencePoint) : '-'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
                X
                <input
                  aria-label={`${activeTransformTargetLabel} ${activeTargetReferenceName} target X`}
                  className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                  data-upid-transform-selection-center-x
                  data-upid-transform-target-center-x
                  disabled={!activeTargetReferencePoint || isSaving}
                  inputMode="decimal"
                  onChange={(event) => onPathTargetXDraftChange(event.currentTarget.value)}
                  type="number"
                  value={pathTargetXDraft}
                />
              </label>
              <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
                Y
                <input
                  aria-label={`${activeTransformTargetLabel} ${activeTargetReferenceName} target Y`}
                  className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                  data-upid-transform-selection-center-y
                  data-upid-transform-target-center-y
                  disabled={!activeTargetReferencePoint || isSaving}
                  inputMode="decimal"
                  onChange={(event) => onPathTargetYDraftChange(event.currentTarget.value)}
                  type="number"
                  value={pathTargetYDraft}
                />
              </label>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
              <button
                aria-label={`Use origin as ${activePathTransformTargetName} ${activeTargetReferenceName} target`}
                className={textButtonClass}
                data-upid-transform-selection-center-use-origin
                data-upid-transform-target-center-use-origin
                disabled={!activeTargetReferencePoint || isSaving}
                onClick={() => {
                  onPathTargetXDraftChange(formatNumber(0));
                  onPathTargetYDraftChange(formatNumber(0));
                }}
                type="button"
              >
                Origin
              </button>
              <button
                aria-label={`Use latest measurement point as ${activePathTransformTargetName} ${activeTargetReferenceName} target`}
                className={textButtonClass}
                data-upid-transform-selection-center-use-latest
                data-upid-transform-target-center-use-latest
                disabled={!activeTargetReferencePoint || !latestMeasurementPoint || isSaving}
                onClick={() => {
                  if (!latestMeasurementPoint) return;
                  onPathTargetXDraftChange(formatNumber(latestMeasurementPoint.x));
                  onPathTargetYDraftChange(formatNumber(latestMeasurementPoint.y));
                }}
                type="button"
              >
                Latest Point
              </button>
              <button
                aria-label={`Move ${activePathTransformTargetName} ${activeTargetReferenceName} to target`}
                className={textButtonClass}
                data-upid-transform-selection-center-apply
                data-upid-transform-target-center-apply
                disabled={!canMoveActiveTargetReference}
                onClick={() => {
                  if (activePathTransformTarget === 'document') {
                    if (!documentReferencePoint) return;
                    onTranslatePathDocument({
                      x: targetX - documentReferencePoint.x,
                      y: targetY - documentReferencePoint.y
                    });
                  } else {
                    onMovePathSelectionCenter({ x: targetX, y: targetY });
                  }
                }}
                type="button"
              >
                {activePathTransformTarget === 'document' ? 'Move Ref' : 'Move Center'}
              </button>
            </div>
            {measurementPoints.length > 0 && (
              <div
                className="mt-2 border-t border-border pt-2"
                data-upid-transform-selection-center-points
                data-upid-transform-target-center-points
              >
                <span className="mb-1 block text-[9px] uppercase text-muted-foreground">Target Point</span>
                <div className="grid max-h-16 grid-cols-4 gap-1 overflow-auto">
                  {measurementPoints.map((point, index) => (
                    <button
                      aria-label={`Use measurement point P${index + 1} as ${activePathTransformTargetName} ${activeTargetReferenceName} target`}
                      className={textButtonClass}
                      data-upid-transform-selection-center-use-point={index + 1}
                      data-upid-transform-target-center-use-point={index + 1}
                      disabled={!activeTargetReferencePoint || isSaving}
                      key={point.id}
                      onClick={() => {
                        onPathTargetXDraftChange(formatNumber(point.x));
                        onPathTargetYDraftChange(formatNumber(point.y));
                      }}
                      title={`P${index + 1}: ${formatPoint(point)}`}
                      type="button"
                    >
                      P{index + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {selectedSegmentCenter && (
            <div
              className="mt-3 border-t border-border pt-2"
              data-upid-transform-center
              data-upid-transform-center-enabled="true"
            >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase text-muted-foreground">Segment Center</span>
              <span className="truncate text-[9px] text-muted-foreground" data-upid-transform-center-current>
                {selectedSegmentCenter ? formatPoint(selectedSegmentCenter) : '-'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
                X
                <input
                  aria-label="Center target X"
                  className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                  data-upid-transform-center-x
                  disabled={!selectedSegmentCenter || isSaving}
                  inputMode="decimal"
                  onChange={(event) => onPathTargetXDraftChange(event.currentTarget.value)}
                  type="number"
                  value={pathTargetXDraft}
                />
              </label>
              <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
                Y
                <input
                  aria-label="Center target Y"
                  className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                  data-upid-transform-center-y
                  disabled={!selectedSegmentCenter || isSaving}
                  inputMode="decimal"
                  onChange={(event) => onPathTargetYDraftChange(event.currentTarget.value)}
                  type="number"
                  value={pathTargetYDraft}
                />
              </label>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
              <button
                aria-label="Use origin as center target"
                className={textButtonClass}
                data-upid-transform-center-use-origin
                disabled={!selectedSegmentCenter || isSaving}
                onClick={() => {
                  onPathTargetXDraftChange(formatNumber(0));
                  onPathTargetYDraftChange(formatNumber(0));
                }}
                type="button"
              >
                Origin
              </button>
              <button
                aria-label="Use latest measurement point as center target"
                className={textButtonClass}
                data-upid-transform-center-use-latest
                disabled={!selectedSegmentCenter || !latestMeasurementPoint || isSaving}
                onClick={() => {
                  if (!latestMeasurementPoint) return;
                  onPathTargetXDraftChange(formatNumber(latestMeasurementPoint.x));
                  onPathTargetYDraftChange(formatNumber(latestMeasurementPoint.y));
                }}
                type="button"
              >
                Latest Point
              </button>
              <button
                aria-label="Move selected arc center to target"
                className={textButtonClass}
                data-upid-transform-center-apply
                disabled={!canMoveSelectedSegmentCenter}
                onClick={() => onMoveSelectedSegmentCenter({ x: targetX, y: targetY })}
                type="button"
              >
                Move Center
              </button>
            </div>
            {measurementPoints.length > 0 && (
              <div className="mt-2 border-t border-border pt-2" data-upid-transform-center-points>
                <span className="mb-1 block text-[9px] uppercase text-muted-foreground">Target Point</span>
                <div className="grid max-h-16 grid-cols-4 gap-1 overflow-auto">
                  {measurementPoints.map((point, index) => (
                    <button
                      aria-label={`Use measurement point P${index + 1} as center target`}
                      className={textButtonClass}
                      data-upid-transform-center-use-point={index + 1}
                      disabled={!selectedSegmentCenter || isSaving}
                      key={point.id}
                      onClick={() => {
                        onPathTargetXDraftChange(formatNumber(point.x));
                        onPathTargetYDraftChange(formatNumber(point.y));
                      }}
                      title={`P${index + 1}: ${formatPoint(point)}`}
                      type="button"
                    >
                      P{index + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </section>
        ))}

        {renderWorkspacePanel('path-hover-assist', 'Hover Assist', (
        <section data-upid-hover-assist>
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
        ))}

        {renderWorkspacePanel('endpoint-topology', 'Endpoint Topology', (
        <section data-upid-endpoint-topology>
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-[9px] uppercase text-muted-foreground">Endpoint Topology</span>
              <span
                className="block truncate text-[12px] font-semibold text-foreground"
                data-upid-endpoint-topology-title
              >
                Endpoint Join Map
              </span>
              <span className="block text-[9px] leading-3 text-muted-foreground">
                Shows which start/end handles form chains.
              </span>
            </span>
            <span
              className={`shrink-0 border px-1.5 py-0.5 text-[9px] ${
                endpointTopologyPanel.openEndCount > 0 || endpointTopologyPanel.ambiguousCount > 0
                  ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                  : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
              }`}
              data-upid-endpoint-topology-status
            >
              {formatEndpointTopologyStatus(endpointTopologyPanel)}
            </span>
          </div>
          <p
            className="mb-2 border border-border bg-background/35 px-2 py-1.5 text-[9px] leading-4 text-muted-foreground"
            data-upid-endpoint-topology-help
          >
            Endpoint topology pairs segment starts and ends into continuous contours. The join map tells you
            whether the importer found exact joins, tiny healed gaps, open chain clues, or ambiguous endpoint
            candidates that need review before export.
          </p>
          <div
            className="mb-2 grid grid-cols-2 gap-1 text-[9px]"
            data-upid-endpoint-topology-summary
            title="Endpoint topology explains how segment starts and ends are paired into continuous contours."
          >
            <TopologyMetric id="exact-joins" label="Exact joins" value={endpointTopologyPanel.exactJoinCount} tone="ok" />
            <TopologyMetric id="open-ends" label="Open chain clues" value={endpointTopologyPanel.openEndCount} tone={endpointTopologyPanel.openEndCount > 0 ? 'warn' : 'muted'} />
            <TopologyMetric id="healed-joins" label="Healed joins" value={endpointTopologyPanel.snappedCount} tone={endpointTopologyPanel.snappedCount > 0 ? 'warn' : 'muted'} />
            <TopologyMetric id="ambiguous" label="Ambiguous joins" value={endpointTopologyPanel.ambiguousCount} tone={endpointTopologyPanel.ambiguousCount > 0 ? 'warn' : 'muted'} />
          </div>
          {endpointTopologyRows.length > 0 ? (
            <div className="max-h-32 overflow-auto border border-border bg-background/35">
              {endpointTopologyRows.map((row) =>
                renderEndpointTopologyRow({
                  hoveredPathElement,
                  onHoverPathElement,
                  onSelectPathElement,
                  row,
                  selectedPathElement
                })
              )}
            </div>
          ) : (
            <p className="border border-border bg-background/35 px-2 py-1.5 text-[9px] text-muted-foreground">
              No healed or ambiguous joins. Every contour endpoint is cleanly paired inside import precision.
            </p>
          )}
        </section>
        ))}

        {renderWorkspacePanel('path-diagnostics', 'Path Diagnostics', (
          <section data-upid-diagnostics>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase text-muted-foreground">Path Diagnostics</span>
              <span className="text-[9px] text-amber-200">
                {pathDiagnostics.length} {pathDiagnostics.length === 1 ? 'issue' : 'issues'}
              </span>
            </div>
            {pathDiagnostics.length > 0 && (
              <div
                className="mb-2 border border-amber-400/35 bg-amber-400/10 px-2 py-1.5 text-[9px] leading-4 text-amber-50"
                data-upid-diagnostics-repair-workflow
                title="Repair workflow for diagnostics: identify the broken join, inspect affected geometry, then repair or re-import before export."
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[9px] uppercase text-amber-100">Repair workflow</span>
                  <button
                    aria-label="Open Repair Workspace"
                    className="border border-amber-300/40 bg-background/70 px-1.5 py-0.5 text-[8px] text-amber-50 outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!onOpenWorkspacePanel && !onOpenWorkspacePanels}
                    onClick={() => {
                      if (onOpenWorkspacePanels) {
                        onOpenWorkspacePanels(['endpoint-topology', 'contour-tree']);
                        return;
                      }
                      onOpenWorkspacePanel?.('endpoint-topology');
                      onOpenWorkspacePanel?.('contour-tree');
                    }}
                    type="button"
                  >
                    Open Repair Workspace
                  </button>
                </div>
                <ol className="grid gap-0.5 text-muted-foreground">
                  <li>
                    <span className="text-amber-100">1 Find the broken join:</span> use Endpoint Topology to inspect
                    open, healed, or ambiguous endpoint pairs.
                  </li>
                  <li>
                    <span className="text-amber-100">2 Inspect affected geometry:</span> select the refs below and
                    cross-highlight the Contour Tree and canvas.
                  </li>
                  <li>
                    <span className="text-amber-100">3 Decide:</span> fix the source geometry, simplify the join, then
                    repair or re-import before trusting export.
                  </li>
                </ol>
              </div>
            )}
            <div className="max-h-48 overflow-auto border border-border bg-background/35">
              {pathDiagnostics.length > 0 ? (
                pathDiagnostics.map((diagnostic) =>
                  renderDiagnosticRow({
                    diagnostic,
                    hoveredPathElement,
                    onHoverPathElement,
                    onOpenWorkspacePanel,
                    onSelectPathElement,
                    selectedPathElement
                  })
                )
              ) : (
                <p className="px-2 py-1.5 text-muted-foreground" data-upid-diagnostics-empty>
                  No path issues
                </p>
              )}
            </div>
          </section>
        ))}

        {renderWorkspacePanel('cut-sequence', 'Cut Sequence', (
        <section data-upid-cut-sequence>
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
        ))}

        {renderWorkspacePanel('contour-tree', 'Contour Tree', (
        <section className="min-h-0 overflow-auto" data-upid-contour-tree>
          <div
            className="mb-2 border border-border bg-background/45 p-2"
            data-upid-contour-tree-map
            title="Tree map: Contour rows contain Segment rows, and each Segment exposes start/end Endpoint handles. Endpoint Join Map explains how those handles connect."
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase text-muted-foreground">Tree Map</span>
              <button
                aria-label="Open Endpoint Join Map from Contour Tree"
                className={textButtonClass}
                disabled={!onOpenWorkspacePanel}
                onClick={() => onOpenWorkspacePanel?.('endpoint-topology')}
                type="button"
              >
                Endpoint Join Map
              </button>
            </div>
            <div className="grid grid-cols-2 items-stretch gap-1 text-[10px] uppercase text-muted-foreground">
              <span
                className="border border-sky-400/35 bg-sky-400/10 px-1.5 py-1 text-sky-100"
                data-upid-contour-tree-map-step="contour"
              >
                Contour
              </span>
              <span className="hidden" aria-hidden="true">&gt;</span>
              <span
                className="border border-cyan-400/35 bg-cyan-400/10 px-1.5 py-1 text-cyan-100"
                data-upid-contour-tree-map-step="segment"
              >
                Segment
              </span>
              <span className="hidden" aria-hidden="true">&gt;</span>
              <span
                className="border border-violet-400/35 bg-violet-400/10 px-1.5 py-1 text-violet-100"
                data-upid-contour-tree-map-step="endpoint"
              >
                Endpoint
              </span>
              <span className="hidden" aria-hidden="true">&gt;</span>
              <span
                className="border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-1 text-emerald-100"
                data-upid-contour-tree-map-step="topology"
              >
                Endpoint Join Map
              </span>
            </div>
          </div>
          <p
            className="mb-2 border border-border bg-background/35 px-2 py-1.5 text-[9px] leading-4 text-muted-foreground"
            data-upid-contour-tree-help
          >
            Hover or select any row to cross-highlight the canvas. The tree is the editable hierarchy:
            contours contain ordered segments, and each segment exposes start/end endpoint handles.
          </p>
          <div
            className="mb-2 grid grid-cols-1 gap-1 text-[10px] uppercase text-muted-foreground"
            data-upid-contour-tree-legend
          >
            <span className="border border-border bg-background/35 px-1 py-0.5" data-upid-contour-tree-legend="contour">
              Contour: whole cut loop
            </span>
            <span className="border border-border bg-background/35 px-1 py-0.5" data-upid-contour-tree-legend="segment">
              Segment: line or arc
            </span>
            <span className="border border-border bg-background/35 px-1 py-0.5" data-upid-contour-tree-legend="endpoint">
              Endpoint: start/end handle
            </span>
          </div>
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
        ), { fill: true })}
      </section>
    </div>
  );
}

function renderEndpointTopologyRow({
  hoveredPathElement,
  onHoverPathElement,
  onSelectPathElement,
  row,
  selectedPathElement
}: {
  hoveredPathElement: EditorPathElementRef | null;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  row: UpidEndpointTopologyRow;
  selectedPathElement: EditorPathElementRef | null;
}) {
  const hovered = upidPathElementRefsMatch(row.selectRef, hoveredPathElement);
  const selected = upidPathElementRefsMatch(row.selectRef, selectedPathElement);

  return (
    <button
      className={`grid w-full grid-cols-[minmax(0,1fr)_66px] items-center border-b border-border px-2 py-1.5 text-left outline-none last:border-b-0 hover:bg-accent disabled:cursor-default ${
        selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : ''
      }`}
      data-upid-exact-endpoint-cluster={row.kind === 'exact-endpoint-cluster' ? row.clusterId : undefined}
      data-upid-cluster-id={row.kind === 'snapped-endpoint-cluster' ? row.clusterId : undefined}
      data-upid-open-endpoint-cluster={row.kind === 'open-endpoint-cluster' ? row.clusterId : undefined}
      data-upid-diagnostic-id={row.kind === 'ambiguous-endpoint-cluster' ? row.diagnosticId : undefined}
      data-upid-endpoint-topology-candidates={
        row.kind === 'ambiguous-endpoint-cluster' ? row.candidateCount : undefined
      }
      data-upid-endpoint-topology-gap={
        row.kind === 'snapped-endpoint-cluster' ? formatNumber(row.maxPairDistance) : undefined
      }
      data-upid-endpoint-topology-kind={row.kind}
      data-upid-endpoint-topology-members={
        row.kind === 'snapped-endpoint-cluster' ||
        row.kind === 'open-endpoint-cluster' ||
        row.kind === 'exact-endpoint-cluster'
          ? row.memberCount
          : undefined
      }
      data-upid-endpoint-topology-method={
        row.kind === 'snapped-endpoint-cluster' ||
        row.kind === 'open-endpoint-cluster' ||
        row.kind === 'exact-endpoint-cluster'
          ? row.method
          : undefined
      }
      data-upid-endpoint-topology-min-candidate-gap={
        row.kind === 'ambiguous-endpoint-cluster' && row.minCandidateDistance !== null
          ? formatNumber(row.minCandidateDistance)
          : undefined
      }
      data-upid-endpoint-topology-related-segments={
        row.kind === 'ambiguous-endpoint-cluster' ? row.relatedSegmentCount : undefined
      }
      data-upid-endpoint-topology-row
      data-upid-hovered={hovered ? 'true' : undefined}
      data-upid-selected={selected ? 'true' : undefined}
      disabled={!row.selectRef}
      key={row.id}
      onClick={() => {
        if (row.selectRef) onSelectPathElement(row.selectRef);
      }}
      onMouseEnter={() => {
        if (row.selectRef) onHoverPathElement(row.selectRef);
      }}
      onMouseLeave={() => onHoverPathElement(null)}
      type="button"
    >
      {row.kind === 'exact-endpoint-cluster' ? (
        <>
          <span className="min-w-0">
            <span className="block truncate text-[10px] text-emerald-100">Exact join {row.clusterId}</span>
            <span className="block truncate text-[9px] text-muted-foreground">
              {formatPoint(row.point)} / paired exactly / {formatEndpointMemberPair(row.members)}
            </span>
          </span>
          <span className="text-right text-[9px] text-emerald-200">{row.memberCount} ends</span>
        </>
      ) : row.kind === 'open-endpoint-cluster' ? (
        <>
          <span className="min-w-0">
            <span className="block truncate text-[10px] text-amber-100">Open end {row.clusterId}</span>
            <span className="block truncate text-[9px] text-muted-foreground">
              {formatPoint(row.point)} / not paired / {formatOpenEndpointMember(row.member)}
            </span>
          </span>
          <span className="text-right text-[9px] text-amber-200">{row.method}</span>
        </>
      ) : row.kind === 'snapped-endpoint-cluster' ? (
        <>
          <span className="min-w-0">
            <span className="block truncate text-[10px] text-foreground">Snapped {row.clusterId}</span>
            <span className="block truncate text-[9px] text-muted-foreground">
              {formatPoint(row.point)} / gap {formatNumber(row.maxPairDistance)} / {row.memberCount} ends
            </span>
          </span>
          <span className="text-right text-[9px] text-muted-foreground">R {formatNumber(row.radius)}</span>
        </>
      ) : (
        <>
          <span className="min-w-0">
            <span className="block truncate text-[10px] text-foreground">Ambiguous {row.diagnosticId}</span>
            <span className="block truncate text-[9px] text-muted-foreground">
              ambiguous / candidates {row.candidateCount} / min gap{' '}
              {row.minCandidateDistance !== null ? formatNumber(row.minCandidateDistance) : '-'}
            </span>
          </span>
          <span className="text-right text-[9px] text-muted-foreground">{row.relatedSegmentCount} seg</span>
        </>
      )}
    </button>
  );
}

function formatEndpointMemberPair(members: Array<{ pointRole: 'start' | 'end' | null; rawEndpointSide: 'start' | 'end'; segmentIndex: number | null; segmentId: string }>) {
  const labels = members.slice(0, 2).map((member) => formatEndpointMember(member));
  if (members.length > 2) labels.push(`+${members.length - 2}`);
  return labels.join(' / ');
}

function formatOpenEndpointMember(
  member: Extract<UpidEndpointTopologyRow, { kind: 'open-endpoint-cluster' }>['member']
) {
  if (!member) return 'unknown endpoint';
  return formatEndpointMember(member);
}

function formatEndpointMember(member: {
  pointRole: 'start' | 'end' | null;
  rawEndpointSide: 'start' | 'end';
  segmentId: string;
  segmentIndex: number | null;
}) {
  const role = member.pointRole ? member.pointRole.toUpperCase() : member.rawEndpointSide.toUpperCase();
  const segmentIndex = member.segmentIndex !== null ? `S${member.segmentIndex + 1}` : member.segmentId;
  return `${segmentIndex} ${role}`;
}

function TopologyMetric({
  id,
  label,
  tone,
  value
}: {
  id: string;
  label: string;
  tone: 'muted' | 'ok' | 'warn';
  value: number;
}) {
  return (
    <div
      className={`border px-1.5 py-1 ${
        tone === 'ok'
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
          : tone === 'warn'
            ? 'border-amber-400/40 bg-amber-400/10 text-amber-100'
            : 'border-border bg-background/40 text-muted-foreground'
      }`}
      data-upid-endpoint-topology-summary-card={id}
    >
      <span
        className="block text-[8px] uppercase text-muted-foreground"
        data-upid-endpoint-topology-summary-label={id}
      >
        {label}
      </span>
      <span className="block text-[11px] font-semibold text-foreground">{value}</span>
    </div>
  );
}

function summarizeEndpointTopologyPanel(document: PathPlanningDocument) {
  const openEndCount = document.endpointClusters.filter((cluster) => cluster.members.length === 1).length;
  const exactJoinCount = document.endpointClusters.filter(
    (cluster) => cluster.method === 'exact' && cluster.members.length > 1
  ).length;
  const snappedCount = document.endpointClusters.filter((cluster) => cluster.method === 'within-tolerance').length;
  const ambiguousCount = document.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'ambiguous-endpoint-cluster'
  ).length;

  return {
    ambiguousCount,
    exactJoinCount,
    openEndCount,
    snappedCount
  };
}

function formatEndpointTopologyStatus(summary: ReturnType<typeof summarizeEndpointTopologyPanel>) {
  if (summary.openEndCount > 0) return `${summary.openEndCount} open ${summary.openEndCount === 1 ? 'end' : 'ends'}`;
  if (summary.ambiguousCount > 0) return `${summary.ambiguousCount} ambiguous`;
  if (summary.snappedCount > 0) return `${summary.snappedCount} healed`;
  return 'cleanly paired';
}

function renderDiagnosticRow({
  diagnostic,
  hoveredPathElement,
  onHoverPathElement,
  onOpenWorkspacePanel,
  onSelectPathElement,
  selectedPathElement
}: {
  diagnostic: UpidSelectedPathDiagnostic;
  hoveredPathElement: EditorPathElementRef | null;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onOpenWorkspacePanel?: (panelId: DiagnosticPanelActionId) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  selectedPathElement: EditorPathElementRef | null;
}) {
  const hoverElement = diagnostic.selectRef;
  const hovered = upidPathElementRefsMatch(hoverElement, hoveredPathElement);
  const selected = upidPathElementRefsMatch(hoverElement, selectedPathElement);
  const selectDiagnostic = () => {
    if (hoverElement) onSelectPathElement(hoverElement);
  };

  return (
    <div
      aria-disabled={hoverElement ? undefined : true}
      className={`grid w-full gap-0.5 border-b border-border px-2 py-1.5 text-left outline-none last:border-b-0 hover:bg-accent ${
        selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : ''
      }`}
      data-upid-diagnostic-code={diagnostic.code}
      data-upid-diagnostic-id={diagnostic.id}
      data-upid-diagnostic-related-clusters={diagnostic.relatedClusterCount}
      data-upid-diagnostic-related-segments={diagnostic.relatedSegmentCount}
      data-upid-hovered={hovered ? 'true' : undefined}
      data-upid-diagnostic-row
      data-upid-diagnostic-severity={diagnostic.severity}
      data-upid-selected={selected ? 'true' : undefined}
      key={diagnostic.id}
      onClick={selectDiagnostic}
      onKeyDown={(event) => {
        if (event.key === 'Enter') selectDiagnostic();
      }}
      onMouseEnter={() => {
        if (hoverElement) onHoverPathElement(hoverElement);
      }}
      onMouseLeave={() => {
        if (hoverElement) onHoverPathElement(null);
      }}
      role={hoverElement ? 'button' : undefined}
      tabIndex={hoverElement ? 0 : undefined}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[8px] uppercase">
        <span className={diagnostic.severity === 'error' ? 'text-destructive' : 'text-amber-200'}>
          {diagnostic.severity}
        </span>
        <span className="truncate text-muted-foreground">{diagnostic.code}</span>
      </div>
      <p className="text-[9px] leading-4 text-muted-foreground">{diagnostic.message}</p>
      {renderDiagnosticGuidance(diagnostic, onOpenWorkspacePanel)}
      <span className="text-[8px] text-muted-foreground">
        segments {diagnostic.relatedSegmentCount} / clusters {diagnostic.relatedClusterCount}
      </span>
      {diagnostic.metrics.length > 0 && (
        <span className="flex min-w-0 flex-wrap gap-1 pt-0.5">
          {diagnostic.metrics.map((metric) => (
            <span
              className="border border-border bg-background/60 px-1 text-[8px] text-muted-foreground"
              data-upid-diagnostic-metric={metric.key}
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
              className="border border-border bg-background/60 px-1 text-left text-[8px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
              data-upid-diagnostic-ref
              data-upid-diagnostic-ref-index={index}
              data-upid-diagnostic-ref-operation={ref.operationId ?? undefined}
              data-upid-diagnostic-ref-path-element={ref.pathElementId ?? undefined}
              data-upid-diagnostic-ref-point-role={ref.pointRole ?? undefined}
              data-upid-diagnostic-ref-segment={ref.segmentId ?? undefined}
              data-upid-diagnostic-ref-travel={ref.travelRole ?? undefined}
              key={`${ref.operationId ?? ''}-${ref.pathElementId ?? ''}-${ref.segmentId ?? ''}-${ref.pointRole ?? ''}-${index}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectPathElement(ref);
              }}
              onMouseEnter={() => onHoverPathElement(ref)}
              onMouseLeave={() => onHoverPathElement(null)}
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

function renderDiagnosticGuidance(
  diagnostic: UpidSelectedPathDiagnostic,
  onOpenWorkspacePanel?: (panelId: DiagnosticPanelActionId) => void
) {
  const guidance = readDiagnosticGuidance(diagnostic);
  if (!guidance) return null;

  return (
    <div
      className="mt-1 border border-border bg-background/45 px-2 py-1 text-[8px] leading-4 text-muted-foreground"
      data-upid-diagnostic-guidance
      title={guidance.title}
    >
      <span className="mr-1 uppercase text-foreground" data-upid-diagnostic-guidance-label>
        Next
      </span>
      {guidance.text}
      {guidance.actions.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-1" data-upid-diagnostic-guidance-actions>
          {guidance.actions.map((action) => (
            <button
              aria-label={action.label}
              className="border border-border bg-background/70 px-1.5 py-0.5 text-[8px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              data-upid-diagnostic-guidance-action={action.panelId}
              disabled={!onOpenWorkspacePanel}
              key={action.panelId}
              onClick={(event) => {
                event.stopPropagation();
                onOpenWorkspacePanel?.(action.panelId);
              }}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

function readDiagnosticGuidance(diagnostic: UpidSelectedPathDiagnostic): DiagnosticGuidance | null {
  switch (diagnostic.code) {
    case 'open-chain':
      return {
        actions: [
          { label: 'Open Endpoint Topology', panelId: 'endpoint-topology' },
          { label: 'Open Contour Tree', panelId: 'contour-tree' }
        ],
        title: 'Open chains have unmatched start/end endpoints.',
        text:
          'Open Endpoint Topology, select the affected start/end refs below, and inspect the gap in the Contour Tree. If this should be a closed loop, repair or re-import the source endpoints before exporting.'
      };
    case 'ambiguous-endpoint-cluster':
      return {
        actions: [{ label: 'Open Endpoint Topology', panelId: 'endpoint-topology' }],
        title: 'More than one endpoint pairing is possible inside tolerance.',
        text:
          'Open Endpoint Topology and compare the candidate endpoint refs. Simplify the nearby geometry or re-import with cleaner endpoints so the chain order is unambiguous.'
      };
    case 'endpoint-cluster-snap':
      return {
        actions: [{ label: 'Open Endpoint Topology', panelId: 'endpoint-topology' }],
        title: 'The importer healed a small endpoint gap.',
        text:
          'Inspect the snapped endpoint in Endpoint Topology. If the healed gap is intentional and tiny, continue; if it bridges the wrong edges, fix the source geometry.'
      };
    case 'post-bridged-gap':
    case 'post-unexpected-gap':
      return {
        actions: [
          { label: 'Open Contour Tree', panelId: 'contour-tree' },
          { label: 'Open Cut Sequence', panelId: 'cut-sequence' }
        ],
        title: 'The posted path contains a bridge or unexpected travel gap.',
        text:
          'Select the affected refs, then check cut order, direction, and endpoint joins before trusting the exported G-code.'
      };
    case 'invalid-arc':
    case 'invalid-polyline':
    case 'zero-length-segment':
      return {
        actions: [{ label: 'Open Contour Tree', panelId: 'contour-tree' }],
        title: 'The source entity could not become clean cut geometry.',
        text:
          'Select the affected refs, then repair the source entity or remove duplicate/invalid geometry before importing again.'
      };
    case 'self-intersection':
    case 'degenerate-contour':
      return {
        actions: [{ label: 'Open Contour Tree', panelId: 'contour-tree' }],
        title: 'The contour shape is not a clean closed machining loop.',
        text:
          'Inspect the highlighted contour and segment rows. Repair overlapping, crossing, or collapsed geometry before relying on automatic ordering.'
      };
    case 'branching-topology':
    case 'closed-chain-gap':
    case 'route-dependency-cycle':
      return {
        actions: [
          { label: 'Open Contour Tree', panelId: 'contour-tree' },
          { label: 'Open Cut Sequence', panelId: 'cut-sequence' }
        ],
        title: 'The path graph needs manual inspection.',
        text:
          'Use the affected refs and Contour Tree to find the conflicting joins, then fix the source geometry or adjust ordering manually.'
      };
    default:
      return null;
  }
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
  const contourKindLabel = element.closed ? 'Closed contour' : 'Open chain';
  const diagnosticSummary = summarizeUpidDiagnosticsForPathElementRef(pathDocument, {
    operationId: element.operationId,
    pathElementId: element.id,
    segmentId: null
  });

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
          className={`grid w-full grid-cols-[22px_minmax(0,1fr)] items-stretch hover:bg-accent ${
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
            className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-start gap-1 px-1.5 py-1.5 text-left outline-none hover:bg-accent"
            data-upid-contour-children={element.childIds.length}
            data-upid-contour-depth={element.containmentDepth}
            data-upid-contour-display-name={element.displayName}
            data-upid-contour-diagnostic-codes={formatDiagnosticSummaryCodes(diagnosticSummary)}
            data-upid-contour-diagnostic-ids={formatDiagnosticSummaryIds(diagnosticSummary)}
            data-upid-contour-diagnostic-severity={diagnosticSummary.severity ?? undefined}
            data-upid-contour-diagnostics={diagnosticSummary.count}
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
            data-upid-tree-row-action="select-contour"
            data-upid-tree-row-kind="contour"
            data-upid-tree-row-level={treeDepth}
            data-upid-hovered={hoveredPathElement?.operationId === element.operationId ? 'true' : undefined}
            data-upid-operation-id={element.operationId}
            data-upid-path-element-id={element.id}
            data-upid-selected={
              selectedPathElement?.operationId === element.operationId && !selectedPathElement.segmentId
                ? 'true'
                : undefined
            }
            title={`${label}: ${contourKindLabel}. Selects and highlights the whole contour on the canvas.`}
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
            <span
              className="flex flex-col items-center gap-0.5 pt-0.5 text-center text-muted-foreground"
              data-upid-tree-depth-rail="contour"
            >
              <span className="text-[8px] uppercase" data-upid-tree-depth-label="contour">
                Contour
              </span>
              <span className="text-[8px] uppercase">#{element.orderIndex + 1}</span>
              <span className="h-full min-h-6 border-l border-border/80" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                <span
                  className="shrink-0 border border-sky-400/35 bg-sky-400/10 px-1 text-[8px] uppercase text-sky-100"
                  data-upid-tree-kind-label
                  title="Contour row: selects the complete path operation and highlights the whole loop on the canvas."
                >
                  Contour
                </span>
                <span
                  className={`shrink-0 border px-1 text-[8px] uppercase ${
                    element.closed
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                      : 'border-amber-400/40 bg-amber-400/10 text-amber-100'
                  }`}
                  data-upid-contour-node-summary
                >
                  {contourKindLabel}
                </span>
                <span className="truncate text-[10px] text-foreground">{label}</span>
              </span>
              <span
                className="mt-0.5 block text-[8px] uppercase tracking-normal text-muted-foreground"
                data-upid-tree-action-hint
              >
                selects whole contour on canvas
              </span>
              <span className="mt-1 flex flex-wrap gap-1 text-[8px] text-muted-foreground">
                <span className="border border-border bg-background/45 px-1" data-upid-contour-field="role">
                  Role <span className="text-foreground">{element.classification}</span>
                </span>
                <span className="border border-border bg-background/45 px-1" data-upid-contour-field="order">
                  Cut order <span className="text-foreground">{element.orderIndex + 1}</span>
                </span>
                <span className="border border-border bg-background/45 px-1" data-upid-contour-field="segments">
                  Segments <span className="text-foreground">{node.treeMetrics.directSegmentCount}</span>
                  {node.treeMetrics.totalSegmentCount !== node.treeMetrics.directSegmentCount && (
                    <> / total {node.treeMetrics.totalSegmentCount}</>
                  )}
                </span>
                <span className="border border-border bg-background/45 px-1" data-upid-contour-field="cut-length">
                  Cut <span className="text-foreground">{element.metrics.cutLength.toFixed(3)}</span>
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
                Source {element.label} / direction {element.direction}
              </span>
              <span className="block truncate text-[9px] text-muted-foreground">
                {upidPathElementNestLabel(element)}
              </span>
              <span className="block truncate text-[9px] text-muted-foreground">
                {formatTreeMetrics(node.treeMetrics)}
              </span>
              {renderManualDecisionBadges(manualDecisions)}
              {renderDiagnosticSummaryBadge(diagnosticSummary)}
            </span>
          </button>
        </div>
      </summary>
      {expanded && (
        <div className="border-t border-border bg-card/35 py-1" data-upid-segment-stack>
          {element.overrides?.leadIn &&
            renderLeadInRow(
              element,
              hoveredPathElement,
              selectedPathElement,
              onHoverPathElement,
              onSelectPathElement
            )}
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

function renderDiagnosticSummaryBadge(summary: UpidPathDiagnosticSummary) {
  if (summary.count === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1" data-upid-diagnostic-summary-badge>
      <span
        className={`border px-1 text-[8px] uppercase ${
          summary.severity === 'error'
            ? 'border-destructive/50 bg-destructive/10 text-destructive'
            : summary.severity === 'warning'
              ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
              : 'border-sky-400/40 bg-sky-400/10 text-sky-200'
        }`}
        data-upid-diagnostic-summary-severity={summary.severity ?? undefined}
      >
        {formatDiagnosticSummaryLabel(summary)}
      </span>
    </span>
  );
}

function formatDiagnosticSummaryCodes(summary: UpidPathDiagnosticSummary) {
  return summary.codes.length > 0 ? summary.codes.join(' ') : undefined;
}

function formatDiagnosticSummaryIds(summary: UpidPathDiagnosticSummary) {
  return summary.ids.length > 0 ? summary.ids.join(' ') : undefined;
}

function formatDiagnosticSummaryLabel(summary: UpidPathDiagnosticSummary) {
  if (!summary.firstCode) return `${summary.count} ${summary.count === 1 ? 'issue' : 'issues'}`;
  if (summary.count === 1) return summary.firstCode;
  return `${summary.firstCode} +${summary.count - 1}`;
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
  return `order ${counts.order} / role ${counts.role} / direction ${counts.direction} / start ${counts.start} / lead-in ${counts['lead-in']}`;
}

function formatProjectSourceSummary(source: UpidProjectRail['summary']['source']) {
  const parts = [
    `Source: ${formatCount(source.entityCount, 'entity')} / ${formatCount(source.segmentCount, 'segment')} / ${formatCount(source.layerCount, 'layer')}`
  ];

  if (source.blockNames.length > 0) {
    parts.push(`blocks ${source.blockNames.join(', ')}`);
  }

  if (source.insertBlockNames.length > 0) {
    parts.push(`inserts ${source.insertBlockNames.join(', ')}`);
  }

  if (source.approximatedSegmentCount > 0 || source.editedSegmentCount > 0) {
    parts.push(
      `exact ${source.exactSegmentCount} / approx ${source.approximatedSegmentCount} / edits ${source.editedSegmentCount}`
    );
  }

  return parts.join(' / ');
}

function formatCount(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatSourceLayers(layers: Array<string | null>) {
  return layers.map((layer) => layer ?? '-').join(', ');
}

function renderLeadInRow(
  pathElement: UpidOperationPathElement,
  hoveredPathElement: EditorPathElementRef | null,
  selectedPathElement: EditorPathElementRef | null,
  onHoverPathElement: (element: EditorPathElementRef | null) => void,
  onSelectPathElement: (element: EditorPathElementRef) => void
) {
  const leadIn = pathElement.overrides?.leadIn;
  if (!leadIn) return null;

  const element: EditorPathElementRef = {
    operationId: pathElement.operationId,
    pathElementId: pathElement.id,
    segmentId: null,
    travelRole: 'lead-in'
  };
  const hovered =
    hoveredPathElement?.operationId === pathElement.operationId &&
    hoveredPathElement.travelRole === 'lead-in';
  const selected =
    selectedPathElement?.operationId === pathElement.operationId &&
    selectedPathElement.travelRole === 'lead-in';
  const length = Math.hypot(leadIn.to.x - leadIn.from.x, leadIn.to.y - leadIn.from.y);

  return (
    <div
      className="border-l border-border/70 pl-2"
      data-upid-lead-in-row
      data-upid-operation-id={pathElement.operationId}
      data-upid-path-element-id={pathElement.id}
      data-upid-selected={selected ? 'true' : undefined}
      data-upid-travel-role="lead-in"
      key={`${pathElement.id}-lead-in`}
    >
      <button
        aria-pressed={selected}
        className={`grid w-full grid-cols-[28px_minmax(0,1fr)] gap-1 px-1.5 py-1 text-left text-[9px] text-muted-foreground outline-none hover:bg-accent ${
          selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : ''
        }`}
        data-upid-hovered={hovered ? 'true' : undefined}
        data-upid-selected={selected ? 'true' : undefined}
        data-upid-tree-row-action="select-lead-in"
        data-upid-tree-row-kind="lead-in"
        data-upid-tree-row-level="1"
        onClick={() => onSelectPathElement(element)}
        onMouseEnter={() => onHoverPathElement(element)}
        onMouseLeave={() => onHoverPathElement(null)}
        title={`Lead-in cut from ${formatPoint(leadIn.from)} to ${formatPoint(leadIn.to)}.`}
        type="button"
      >
        <span className="flex flex-col items-center gap-0.5 pt-0.5" data-upid-tree-depth-rail="lead-in">
          <span className="text-[8px] uppercase" data-upid-tree-depth-label="lead-in">
            Pierce
          </span>
          <Flag className="size-3" />
          <span className="h-full min-h-5 border-l border-border/70" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <span
              className="shrink-0 border border-amber-400/40 bg-amber-400/10 px-1 text-[8px] uppercase text-amber-100"
              data-upid-tree-kind-label
              title="Pierce lead-in row: selects the center-to-contour cut move."
            >
              Lead-in
            </span>
            <span className="truncate text-[9px] text-muted-foreground">Center pierce cut</span>
          </span>
          <span
            className="mt-0.5 block text-[8px] uppercase tracking-normal text-muted-foreground"
            data-upid-tree-action-hint
          >
            selects pierce cut on canvas
          </span>
          <span className="block truncate" data-upid-lead-in-span>
            {formatPoint(leadIn.from)}
            {' -> '}
            {formatPoint(leadIn.to)}
          </span>
          <span className="mt-1 grid gap-0.5 text-[8px]">
            <span className="grid grid-cols-[42px_minmax(0,1fr)] gap-1" data-upid-lead-in-field="from">
              <span className="uppercase text-muted-foreground">From</span>
              <span className="truncate text-foreground">{formatPoint(leadIn.from)}</span>
            </span>
            <span className="grid grid-cols-[42px_minmax(0,1fr)] gap-1" data-upid-lead-in-field="to">
              <span className="uppercase text-muted-foreground">To</span>
              <span className="truncate text-foreground">{formatPoint(leadIn.to)}</span>
            </span>
            <span className="grid grid-cols-[42px_minmax(0,1fr)] gap-1" data-upid-lead-in-field="length">
              <span className="uppercase text-muted-foreground">Length</span>
              <span className="truncate text-foreground">{length.toFixed(3)} / G1</span>
            </span>
          </span>
        </span>
      </button>
    </div>
  );
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
  const segmentKindLabel = `${segment.kind.toUpperCase()} segment`;
  const diagnosticSummary = summarizeUpidDiagnosticsForPathElementRef(pathDocument, {
    operationId: pathElement.operationId,
    pathElementId: pathElement.id,
    segmentId: segment.id
  });
  const hovered =
    hoveredPathElement?.operationId === pathElement.operationId &&
    hoveredPathElement.segmentId === segment.id &&
    !hoveredPathElement.pointRole;
  const selected =
    selectedPathElement?.operationId === pathElement.operationId &&
    selectedPathElement.segmentId === segment.id &&
    !selectedPathElement.pointRole;

  return (
    <div
      className="border-l border-border/70 pl-2"
      data-upid-path-element-id={pathElement.id}
      data-upid-segment-group
      key={`${pathElement.id}-${segment.id}-${index}`}
    >
      <button
        aria-pressed={selected}
        className={`grid w-full grid-cols-[28px_minmax(0,1fr)] gap-1 px-1.5 py-1 text-left text-[9px] text-muted-foreground outline-none hover:bg-accent ${
          selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : ''
        }`}
        data-upid-hovered={hovered ? 'true' : undefined}
        data-upid-operation-id={pathElement.operationId}
        data-upid-path-element-id={pathElement.id}
        data-upid-segment-diagnostic-codes={formatDiagnosticSummaryCodes(diagnosticSummary)}
        data-upid-segment-diagnostic-ids={formatDiagnosticSummaryIds(diagnosticSummary)}
        data-upid-segment-diagnostic-severity={diagnosticSummary.severity ?? undefined}
        data-upid-segment-diagnostics={diagnosticSummary.count}
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
        data-upid-tree-row-action="select-segment"
        data-upid-tree-row-kind="segment"
        data-upid-tree-row-level="1"
        title={`${segmentKindLabel}. Selects and highlights one segment of ${pathElement.displayName}.`}
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
        <span className="flex flex-col items-center gap-0.5 pt-0.5" data-upid-tree-depth-rail="segment">
          <span className="text-[8px] uppercase" data-upid-tree-depth-label="segment">
            Segment
          </span>
          <span className="text-[8px] uppercase">S{index + 1}</span>
          <span className="h-full min-h-5 border-l border-border/70" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <span
              className="shrink-0 border border-cyan-400/35 bg-cyan-400/10 px-1 text-[8px] uppercase text-cyan-100"
              data-upid-tree-kind-label
              title="Segment row: selects one line or arc inside the contour."
            >
              Segment
            </span>
            <span
              className="shrink-0 border border-border bg-background/50 px-1 text-[8px] uppercase text-muted-foreground"
              data-upid-segment-kind-label
            >
              {segmentKindLabel}
            </span>
            <span className="truncate text-[9px] text-muted-foreground">#{index + 1}</span>
          </span>
          <span
            className="mt-0.5 block text-[8px] uppercase tracking-normal text-muted-foreground"
            data-upid-tree-action-hint
          >
            selects one segment on canvas
          </span>
          <span className="block truncate" data-upid-segment-span>
            {formatPoint(start)}
            {' -> '}
            {formatPoint(end)}
          </span>
          <span className="mt-1 grid gap-0.5 text-[8px]">
            <span className="grid grid-cols-[42px_minmax(0,1fr)] gap-1" data-upid-segment-field="from">
              <span className="uppercase text-muted-foreground">From</span>
              <span className="truncate text-foreground">{formatPoint(start)}</span>
            </span>
            <span className="grid grid-cols-[42px_minmax(0,1fr)] gap-1" data-upid-segment-field="to">
              <span className="uppercase text-muted-foreground">To</span>
              <span className="truncate text-foreground">{formatPoint(end)}</span>
            </span>
            <span className="grid grid-cols-[42px_minmax(0,1fr)] gap-1" data-upid-segment-field="length">
              <span className="uppercase text-muted-foreground">Length</span>
              <span className="truncate text-foreground">{segmentLength} / {refDirection}</span>
            </span>
          </span>
          {geometrySummary && <span className="block truncate">{geometrySummary}</span>}
          {renderDiagnosticSummaryBadge(diagnosticSummary)}
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
  const diagnosticSummary = summarizeUpidDiagnosticsForPathElementRef(pathDocument, element);

  return (
    <div
      className={`grid w-full grid-cols-[34px_minmax(0,1fr)_20px] gap-1 border-l border-border/60 px-1.5 py-1 pl-5 text-left text-[8px] text-muted-foreground outline-none hover:bg-accent ${
        selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : ''
      }`}
      data-upid-hovered={hovered ? 'true' : undefined}
      data-upid-operation-id={pathElement.operationId}
      data-upid-path-element-id={pathElement.id}
      data-upid-point-cluster-gap={endpointClusterGap}
      data-upid-point-cluster-id={endpointCluster?.id}
      data-upid-point-cluster-members={endpointCluster?.memberCount}
      data-upid-point-cluster-method={endpointCluster?.method}
      data-upid-point-diagnostic-codes={formatDiagnosticSummaryCodes(diagnosticSummary)}
      data-upid-point-diagnostic-ids={formatDiagnosticSummaryIds(diagnosticSummary)}
      data-upid-point-diagnostic-severity={diagnosticSummary.severity ?? undefined}
      data-upid-point-diagnostics={diagnosticSummary.count}
      data-upid-selected={selected ? 'true' : undefined}
      data-upid-segment-index={index}
      data-upid-segment-id={segment.id}
      data-upid-point-role={role}
      data-upid-point-row
      data-upid-tree-row-action="select-endpoint"
      data-upid-tree-row-kind="endpoint"
      data-upid-tree-row-level="2"
      title={`Endpoint cluster ${endpointCluster?.id ?? 'unpaired'}: ${role} point for segment ${index + 1}.`}
      onMouseEnter={() => onHoverPathElement(element)}
      onMouseLeave={() => onHoverPathElement(null)}
    >
      <span className="flex flex-col items-center gap-0.5 pt-0.5" data-upid-tree-depth-rail="endpoint">
        <span className="text-[8px] uppercase" data-upid-tree-depth-label="endpoint">
          Endpoint
        </span>
        <span className="h-full min-h-5 border-l border-border/60" aria-hidden="true" />
      </span>
      <button
        aria-pressed={selected}
        className="min-w-0 text-left outline-none"
        onClick={() => onSelectPathElement(element)}
        type="button"
      >
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <span
              className="shrink-0 border border-violet-400/35 bg-violet-400/10 px-1 text-[8px] uppercase text-violet-100"
              data-upid-tree-kind-label
              title="Endpoint row: selects one start or end handle for this segment."
            >
              Endpoint
            </span>
            <span className="uppercase text-muted-foreground" data-upid-point-role-label>{role.toUpperCase()}</span>
          </span>
          <span
            className="mt-0.5 block text-[8px] uppercase tracking-normal text-muted-foreground"
            data-upid-tree-action-hint
          >
            selects a start/end handle
          </span>
          <span className="grid grid-cols-[52px_minmax(0,1fr)] gap-1" data-upid-point-field="role">
            <span className="uppercase text-muted-foreground">Endpoint</span>
            <span className="truncate text-foreground">{role.toUpperCase()}</span>
          </span>
          <span className="grid grid-cols-[52px_minmax(0,1fr)] gap-1" data-upid-point-field="coordinate">
            <span className="uppercase text-muted-foreground">XY</span>
            <span className="truncate">{formatPoint(point)}</span>
          </span>
          {endpointClusterSummary && <span className="block truncate">{endpointClusterSummary}</span>}
          {renderDiagnosticSummaryBadge(diagnosticSummary)}
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

function formatBounds(bounds: Bounds2) {
  return `X ${formatNumber(bounds.minX)}..${formatNumber(bounds.maxX)} Y ${formatNumber(bounds.minY)}..${formatNumber(bounds.maxY)}`;
}

function formatDrawingExtents(
  extents: { min: { x: number; y: number }; max: { x: number; y: number } } | undefined
) {
  if (!extents) return '-';
  return `X ${formatNumber(extents.min.x)}..${formatNumber(extents.max.x)} Y ${formatNumber(extents.min.y)}..${formatNumber(extents.max.y)}`;
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
