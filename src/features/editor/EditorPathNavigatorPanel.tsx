import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FlipHorizontal,
  FlipVertical,
  Flag,
  Info,
  Move,
  RotateCcw,
  RotateCw
} from 'lucide-react';
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type SetStateAction
} from 'react';

import { type PathMirrorAxis } from '@/domain/path-editor/pathDocumentOperations';
import { deriveCutSequenceMetrics, type CutSequenceMetrics } from '@/domain/path-intel/cutSequenceMetrics';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import type { ExecutionSpatialAction } from '@/domain/editor/executionSpatialActions';
import { orientedSegmentEnd, orientedSegmentStart, requiredSegment, segmentMap } from '@/domain/path-intel/segments';
import type {
  Bounds2,
  OperationOrderStrategy,
  OrientedSegmentRef,
  PathOperation,
  PathPlanningDocument,
  OperationEntry,
  OperationExit,
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
  type UpidProjectRailTreeNode
} from '@/domain/upid/projectRail';
import {
  readBoundsAnchorPoint,
  readPathDocumentBounds,
  readPathDocumentBoundsCenter,
  readPathSelectionBoundsCenter,
  type PathBoundsAnchor
} from './pathSelectionGeometry';
import {
  buildSegmentGeometryPresentation,
  type SegmentGeometryFieldPresentation,
  type SegmentGeometryPointKey,
  type SegmentGeometryPresentation
} from './segmentGeometryPresentation';

export type EditorPathElementRef = UpidPathElementRef;

const iconButtonClass =
  'flex size-7 items-center justify-center rounded-[2px] border border-border text-muted-foreground outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const textButtonClass =
  'flex h-7 items-center justify-center gap-1 rounded-[2px] border border-border px-1.5 text-[10px] text-muted-foreground outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const modeButtonClass =
  'flex h-7 items-center justify-center gap-1 rounded-[2px] border border-border px-1 text-[10px] text-muted-foreground outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const activeModeButtonClass =
  'flex h-7 items-center justify-center gap-1 rounded-[2px] border border-primary bg-primary px-1 text-[10px] text-primary-foreground outline-none transition hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const ORDER_STRATEGY_OPTIONS: Array<{
  label: string;
  value: OperationOrderStrategy;
}> = [
  { label: 'Inside/out nearest', value: 'inside-out-nearest' },
  { label: 'Nearest travel', value: 'nearest' },
  { label: 'Source order', value: 'source-order' }
];
type DiagnosticPanelActionId = 'endpoint-topology' | 'geometry-rail' | 'cut-sequence';
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
  hoveredPathElement: EditorPathElementRef | null;
  hoverAssistEnabled: boolean;
  isSaving: boolean;
  pathDocument: PathPlanningDocument;
  expandedPathElementIds: Record<string, boolean>;
  renderWorkspacePanel?: (id: string, title: string, children: ReactNode, options?: { fill?: boolean }) => ReactNode;
  latestMeasurementPoint: Point2 | null;
  measurementPoints: MeasurementPoint[];
  pathTargetXDraft: string;
  pathTargetYDraft: string;
  pathTranslateXDraft: string;
  pathTranslateYDraft: string;
  presentation?: 'workspace' | 'contour-tree';
  selectedDiagnosticId?: string | null;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  spatialActions?: readonly ExecutionSpatialAction[];
  selectedSpatialActionKey?: string | null;
  onSelectSpatialAction?: (key: string) => void;
  onActivateSpatialAction?: (key: string) => void;
  onExpandedPathElementIdsChange: Dispatch<SetStateAction<Record<string, boolean>>>;
  onMovePathOperation: (direction: -1 | 1, operationId?: string) => void;
  onMovePathSelectionCenter: (targetCenter: Point2) => void;
  onMoveSelectedSegmentCenter: (targetCenter: Point2) => void;
  onOpenWorkspacePanel?: (panelId: DiagnosticPanelActionId) => void;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onMirrorPathDocument: (axis: PathMirrorAxis) => void;
  onMirrorPathSelection: (axis: PathMirrorAxis) => void;
  onRotatePathDocument: (angleDegrees: number) => void;
  onRotatePathSelection: (angleDegrees: number) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  onPathTargetXDraftChange: (value: string) => void;
  onPathTargetYDraftChange: (value: string) => void;
  onPathTranslateXDraftChange: (value: string) => void;
  onPathTranslateYDraftChange: (value: string) => void;
  onSetPathOperationOrderStrategy: (strategy: OperationOrderStrategy) => void;
  onTranslatePathSelection: (delta: { x: number; y: number }) => void;
  onTranslatePathDocument: (
    delta: { x: number; y: number },
    completedSource?: 'transform-target' | 'transform-translate'
  ) => void;
  onToggleHoverAssist: () => void;
  onTransformDraftChange?: (source: 'target' | 'translate') => void;
  targetDraftPending?: boolean;
  transformTargetChangeBlocked?: boolean;
}

export function EditorPathNavigatorPanel({
  hoveredPathElement,
  hoverAssistEnabled,
  isSaving,
  pathDocument,
  expandedPathElementIds,
  latestMeasurementPoint,
  measurementPoints,
  renderWorkspacePanel = (_id, _title, children) => children,
  selectedDiagnosticId = null,
  selectedPathElement,
  selectedPathOperationId,
  spatialActions = [],
  selectedSpatialActionKey = null,
  onSelectSpatialAction,
  onActivateSpatialAction,
  onExpandedPathElementIdsChange,
  onMovePathOperation,
  onMovePathSelectionCenter,
  onMoveSelectedSegmentCenter,
  onOpenWorkspacePanel,
  onHoverPathElement,
  onMirrorPathDocument,
  onMirrorPathSelection,
  onRotatePathDocument,
  onRotatePathSelection,
  onSelectPathElement,
  onPathTargetXDraftChange,
  onPathTargetYDraftChange,
  onPathTranslateXDraftChange,
  onPathTranslateYDraftChange,
  onSetPathOperationOrderStrategy,
  onTranslatePathDocument,
  onTranslatePathSelection,
  onToggleHoverAssist,
  onTransformDraftChange,
  pathTargetXDraft,
  pathTargetYDraft,
  pathTranslateXDraft,
  pathTranslateYDraft,
  presentation = 'workspace',
  targetDraftPending = false,
  transformTargetChangeBlocked = false
}: EditorPathNavigatorPanelProps) {
  const diagnosticsListRef = useRef<HTMLDivElement>(null);

  function setUserTargetX(value: string) {
    onPathTargetXDraftChange(value);
    onTransformDraftChange?.('target');
  }

  function setUserTargetY(value: string) {
    onPathTargetYDraftChange(value);
    onTransformDraftChange?.('target');
  }

  function setUserTranslateX(value: string) {
    onPathTranslateXDraftChange(value);
    onTransformDraftChange?.('translate');
  }

  function setUserTranslateY(value: string) {
    onPathTranslateYDraftChange(value);
    onTransformDraftChange?.('translate');
  }
  const segmentsById = segmentMap(pathDocument.segments);
  const projectRail = createUpidProjectRail(pathDocument);
  const { contourTree, cutSequenceElements, manualOrderActive } = projectRail;
  const sequenceMetrics = useMemo(() => deriveCutSequenceMetrics(pathDocument), [pathDocument]);
  const unavailableSequenceMetrics = [...sequenceMetrics.values()].find((metrics) => metrics.status === 'unavailable');
  const endpointTopologyRows = readUpidEndpointTopologyRows(pathDocument);
  const endpointTopologyPanel = summarizeEndpointTopologyPanel(pathDocument);
  const pathDiagnostics = readUpidPathDiagnostics(pathDocument);
  useEffect(() => {
    if (!selectedDiagnosticId) return;
    const selectedRow = [...(
      diagnosticsListRef.current?.querySelectorAll<HTMLElement>('[data-upid-diagnostic-id]') ?? []
    )].find((row) => row.dataset.upidDiagnosticId === selectedDiagnosticId);
    selectedRow?.scrollIntoView?.({ block: 'nearest' });
  }, [
    selectedDiagnosticId,
    pathDiagnostics.map((diagnostic) => diagnostic.id).join('|')
  ]);
  const pathTreeElementIds = projectRail.operationElements.map((element) => element.id);
  const selectedEndpointSegmentKey = readSelectedEndpointSegmentKey(
    projectRail.operationElements,
    selectedPathElement
  );
  const selectedOperationIndex = pathDocument.plan.operations.findIndex(
    (operation) => operation.id === selectedPathOperationId
  );
  const selectedOperation = selectedOperationIndex >= 0 ? pathDocument.plan.operations[selectedOperationIndex] : null;
  const selectedSegmentIndex =
    selectedOperation && selectedPathElement?.segmentId
      ? selectedOperation.segmentRefs.findIndex((ref) => ref.segmentId === selectedPathElement.segmentId)
      : -1;
  const selectedSegment = selectedPathElement?.segmentId
    ? (segmentsById.get(selectedPathElement.segmentId) ?? null)
    : null;
  const selectedSegmentCenter = selectedSegment && selectedSegment.kind !== 'line' ? selectedSegment.center : null;
  const documentBounds = readPathDocumentBounds(pathDocument);
  const documentCenter = readPathDocumentBoundsCenter(pathDocument);
  const selectedGeometryCenter = readPathSelectionBoundsCenter(
    pathDocument,
    selectedPathElement,
    selectedPathOperationId
  );
  const translateX = pathTranslateXDraft.trim() ? Number(pathTranslateXDraft) : NaN;
  const translateY = pathTranslateYDraft.trim() ? Number(pathTranslateYDraft) : NaN;
  const targetX = pathTargetXDraft.trim() ? Number(pathTargetXDraft) : NaN;
  const targetY = pathTargetYDraft.trim() ? Number(pathTargetYDraft) : NaN;
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
  const [pathTransformTarget, setPathTransformTarget] = useState<PathTransformTarget>('document');
  const [pathTransformTargetPinned, setPathTransformTargetPinned] = useState(false);
  const [expandedCutPathIds, setExpandedCutPathIds] = useState<Record<string, boolean>>({});
  const [expandedSegmentDetailIds, setExpandedSegmentDetailIds] = useState<Record<string, boolean>>({});
  const [geometryTreeOptionsOpen, setGeometryTreeOptionsOpen] = useState(false);
  const [documentReferenceMode, setDocumentReferenceMode] = useState<DocumentReferenceMode>('center');
  const [documentReferenceMeasurementPointId, setDocumentReferenceMeasurementPointId] = useState<string | null>(null);
  const selectedDocumentReferenceMeasurementPoint = documentReferenceMeasurementPointId
    ? (measurementPoints.find((point) => point.id === documentReferenceMeasurementPointId) ?? null)
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
  const activeTransformTargetLabel = activePathTransformTarget === 'document' ? 'Document' : translateTargetLabel;
  const activeTransformCenter = activePathTransformTarget === 'document' ? documentCenter : selectedGeometryCenter;
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

    onPathTargetXDraftChange(formatCoordinateDraft(point.x));
    onPathTargetYDraftChange(formatCoordinateDraft(point.y));
  };
  const isPathElementExpanded = (pathElementId: string) =>
    hoverRevealedPathElementIds.has(pathElementId) || (expandedPathElementIds[pathElementId] ?? true);
  const isCutPathExpanded = (pathElementId: string) =>
    expandedCutPathIds[pathElementId] ?? presentation !== 'contour-tree';
  const togglePathElementExpanded = (pathElementId: string) => {
    onExpandedPathElementIdsChange((current) => ({
      ...current,
      [pathElementId]: !(current[pathElementId] ?? true)
    }));
  };
  const toggleCutPathExpanded = (pathElementId: string) => {
    setExpandedCutPathIds((current) => ({
      ...current,
      [pathElementId]: !(current[pathElementId] ?? presentation !== 'contour-tree')
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
    setExpandedCutPathIds((current) => {
      const next = { ...current };

      for (const pathElementId of pathTreeElementIds) {
        next[pathElementId] = expanded;
      }

      return next;
    });
  };

  useEffect(() => {
    if (targetDraftPending) return;
    setTargetDraftsFromPoint(activeTargetReferencePoint);
  }, [
    activePathTransformTarget,
    activeTargetReferencePoint?.x,
    activeTargetReferencePoint?.y,
    documentReferenceMode,
    documentReferenceMeasurementPointId,
    targetDraftPending
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

  useEffect(() => {
    if (!selectedPathElement?.segmentId) return;

    const owningPathElement = projectRail.operationElements.find(
      (element) =>
        (selectedPathElement.pathElementId
          ? element.id === selectedPathElement.pathElementId
          : element.operationId === selectedPathElement.operationId) &&
        element.segmentRefs.some((ref) => ref.segmentId === selectedPathElement.segmentId)
    );
    if (!owningPathElement) return;

    setExpandedCutPathIds((current) =>
      current[owningPathElement.id] === true
        ? current
        : { ...current, [owningPathElement.id]: true }
    );
  }, [
    pathDocument,
    selectedPathElement?.operationId,
    selectedPathElement?.pathElementId,
    selectedPathElement?.segmentId
  ]);

  useEffect(() => {
    if (!selectedEndpointSegmentKey) return;

    setExpandedSegmentDetailIds((current) =>
      current[selectedEndpointSegmentKey] === true
        ? current
        : { ...current, [selectedEndpointSegmentKey]: true }
    );
  }, [selectedEndpointSegmentKey, selectedPathElement?.pointRole]);

  const contourTreeContent = presentation === 'contour-tree' ? (
    <section className="min-h-0" data-upid-contour-tree>
      <div
        className="flex h-7 items-center gap-1 border-b border-border/60 px-1"
        data-upid-path-tree-controls
      >
        <div className="mr-auto flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">
            {projectRail.summary.rootCount} {projectRail.summary.rootCount === 1 ? 'contour' : 'contours'}
          </span>
          <div className="group relative">
            <button
              aria-describedby="contour-tree-help-tooltip"
              aria-label="Contour Tree help"
              className="flex size-6 items-center justify-center text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              title="Contour Tree help"
              type="button"
            >
              <Info aria-hidden="true" className="size-3.5" />
            </button>
            <div
              className="pointer-events-none invisible absolute left-[-36px] top-7 z-30 w-[170px] border border-border bg-card p-2 text-[10px] normal-case leading-4 text-foreground opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
              data-upid-contour-tree-tooltip
              id="contour-tree-help-tooltip"
              role="tooltip"
            >
              Hover or select a row to cross-highlight the canvas. A contour is a whole cut loop made from ordered
              line or arc segments; each segment exposes start and end endpoint handles. Inspect joins in Endpoint
              Topology from the View menu or Path Diagnostics workflow.
            </div>
          </div>
        </div>
          <div className="relative">
            <button
              aria-expanded={geometryTreeOptionsOpen}
              aria-haspopup="menu"
              aria-label="Geometry tree options"
              className="flex size-6 items-center justify-center text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setGeometryTreeOptionsOpen((open) => !open)}
              title="Geometry tree options"
              type="button"
            >
              <Ellipsis aria-hidden="true" className="size-4" />
            </button>
            {geometryTreeOptionsOpen && (
              <div
                aria-label="Geometry tree options"
                className="absolute right-0 top-7 z-40 w-48 border border-border bg-popover p-1 text-popover-foreground shadow-xl"
                data-upid-geometry-tree-options
                role="menu"
              >
                <button
                  aria-label="Expand entire contour tree"
                  className="flex h-7 w-full items-center px-2 text-left text-[10px] outline-none hover:bg-accent focus-visible:bg-accent"
                  disabled={pathTreeElementIds.length === 0 || isSaving}
                  onClick={() => {
                    setPathTreeExpanded(true);
                    setGeometryTreeOptionsOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  Expand all
                </button>
                <button
                  aria-label="Collapse entire contour tree"
                  className="flex h-7 w-full items-center px-2 text-left text-[10px] outline-none hover:bg-accent focus-visible:bg-accent"
                  disabled={pathTreeElementIds.length === 0 || isSaving}
                  onClick={() => {
                    setPathTreeExpanded(false);
                    setGeometryTreeOptionsOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  Collapse all
                </button>
                <label
                  className="flex h-7 items-center justify-between gap-2 border-t border-border px-2 text-[10px] text-muted-foreground hover:bg-accent"
                  role="menuitemcheckbox"
                >
                  <span>Hover cross-highlight</span>
                  <input
                    aria-label="Toggle canvas hover assist"
                    checked={hoverAssistEnabled}
                    data-upid-hover-assist-toggle
                    onChange={onToggleHoverAssist}
                    type="checkbox"
                  />
                </label>
              </div>
            )}
          </div>
      </div>
      {spatialActions.filter((action) => action.operationId === null).map((action) => (
        <div className="flex items-center border-b border-border/40" key={action.key}>
          <button type="button" data-upid-machining-action={action.key}
            aria-pressed={selectedSpatialActionKey === action.key}
            className={`min-w-0 flex-1 px-2 py-1.5 text-left hover:bg-accent ${selectedSpatialActionKey === action.key ? 'bg-sky-500/15' : ''}`}
            onClick={() => onSelectSpatialAction?.(action.key)}>
            {action.label} · X {action.point.x.toFixed(3)} Y {action.point.y.toFixed(3)}
          </button>
          <button type="button" className="px-2 text-cyan-300 hover:bg-accent"
            aria-label={`Edit ${action.label.toLowerCase()}`} onClick={() => onActivateSpatialAction?.(action.key)}>Edit</button>
        </div>
      ))}
      {contourTree.map((node) =>
        renderContourTreeNode({
          hoveredPathElement,
          node,
          onHoverPathElement,
          onSelectPathElement,
          isPathElementExpanded,
          isCutPathExpanded,
          isSaving,
          pathDocument,
          selectedPathElement,
          selectedPathOperationId,
          spatialActions,
          selectedSpatialActionKey,
          onSelectSpatialAction,
          onActivateSpatialAction,
          segmentsById,
          expandedSegmentDetailIds,
          onToggleSegmentDetails: (segmentKey) =>
            setExpandedSegmentDetailIds((current) => ({
              ...current,
              [segmentKey]: !(current[segmentKey] ?? false)
            })),
          togglePathElementExpanded,
          toggleCutPathExpanded,
          treeDepth: 0
        })
      )}
    </section>
  ) : null;

  if (presentation === 'contour-tree') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden text-[10px]" data-editor-project-rail>
        <section
          className="work-region-scrollbar min-h-0 flex-1 overflow-auto"
          data-upid-path-navigator
        >
          {contourTreeContent}
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-2 text-[10px]" data-editor-project-rail>
      <section
        className="work-region-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-auto"
        data-upid-path-navigator
      >

        {renderWorkspacePanel(
          'path-transform',
          'Transform',
        <section data-upid-path-transform>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase text-muted-foreground">Placement</span>
            <span className="truncate text-[10px] text-muted-foreground" data-upid-transform-target>
              {activeTransformTargetLabel}
            </span>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-1" data-upid-transform-target-mode>
            <button
              aria-label="Target document for transform"
              aria-pressed={activePathTransformTarget === 'document'}
              className={activePathTransformTarget === 'document' ? activeModeButtonClass : modeButtonClass}
              disabled={!documentBounds || isSaving || transformTargetChangeBlocked}
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
              disabled={!hasTransformSelection || isSaving || transformTargetChangeBlocked}
              onClick={() => {
                setPathTransformTarget('selection');
                setPathTransformTargetPinned(true);
              }}
              type="button"
            >
              Selection
            </button>
          </div>
            <div className="mb-3 border border-border bg-background/35 p-2" data-upid-transform-document-placement>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase text-muted-foreground">Reference</span>
              <select
                aria-label="Document reference point"
                className="h-6 max-w-[132px] border border-border bg-background px-1 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-upid-transform-document-reference
                disabled={!documentBounds || isSaving || transformTargetChangeBlocked}
                onChange={(event) => {
                  const nextMode = event.currentTarget.value as DocumentReferenceMode;
                  const nextMeasurementPointId =
                    nextMode === 'picked'
                        ? (documentReferenceMeasurementPointId ?? measurementPoints.at(-1)?.id ?? null)
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
              <p
                className="mb-2 text-[10px] leading-4 text-muted-foreground"
                data-upid-transform-document-placement-help
              >
                Move the active reference or selection center to X0 Y0, or enter a precise target. DXF source extents
                come from DXF header metadata and are shown unchanged.
            </p>
            <dl className="grid gap-1 font-mono text-[10px]">
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
                    {pathDocument.source.drawing?.basePoint ? formatPoint(pathDocument.source.drawing.basePoint) : '-'}
                </dd>
              </div>
            </dl>
            {documentReferenceMode === 'picked' && (
                <div className="mt-2 border-t border-border pt-2" data-upid-transform-document-reference-points>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase text-muted-foreground">Picked Point</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {pickedDocumentReferencePoint ? formatPoint(pickedDocumentReferencePoint) : 'No point'}
                  </span>
                </div>
                <div className="grid max-h-16 grid-cols-4 gap-1 overflow-auto">
                  <button
                    aria-label="Use latest measurement point as document reference"
                    className={textButtonClass}
                    data-upid-transform-document-reference-use-latest
                    disabled={!latestDocumentReferenceMeasurementPoint || isSaving || transformTargetChangeBlocked}
                    onClick={() => {
                        setDocumentReferenceMeasurementPointId(latestDocumentReferenceMeasurementPoint?.id ?? null);
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
                      disabled={isSaving || transformTargetChangeBlocked}
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
            <span className="text-[10px] uppercase text-muted-foreground">Move</span>
            <span className="truncate text-[10px] text-muted-foreground">
              {activePathTransformTarget === 'document' ? 'Document geometry' : 'Selected geometry'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[10px] uppercase text-muted-foreground">
              X
              <input
                aria-label="Translate X"
                className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-upid-transform-delta-x
                  disabled={
                    (activePathTransformTarget === 'document' ? !documentBounds : !selectedOperation) || isSaving
                  }
                inputMode="decimal"
                onChange={(event) => setUserTranslateX(event.currentTarget.value)}
                type="number"
                value={pathTranslateXDraft}
              />
            </label>
            <label className="grid gap-1 text-[10px] uppercase text-muted-foreground">
              Y
              <input
                aria-label="Translate Y"
                className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-upid-transform-delta-y
                  disabled={
                    (activePathTransformTarget === 'document' ? !documentBounds : !selectedOperation) || isSaving
                  }
                inputMode="decimal"
                onChange={(event) => setUserTranslateY(event.currentTarget.value)}
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
          {(!Number.isFinite(translateX) || !Number.isFinite(translateY)) && (
            <p className="mt-1 text-[10px] text-destructive" role="status">Enter both move coordinates. Use 0 for an unchanged axis.</p>
          )}
          <div className="mt-3 border-t border-border pt-2" data-upid-transform-orientation>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase text-muted-foreground">Orientation</span>
              <span className="truncate text-[10px] text-muted-foreground" data-upid-transform-orientation-origin>
                {activeTransformCenter ? formatPoint(activeTransformCenter) : '-'}
              </span>
            </div>
            <div
              className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-1"
              data-upid-transform-document-orientation={activePathTransformTarget === 'document' ? 'true' : undefined}
                data-upid-transform-selection-orientation={
                  activePathTransformTarget === 'selection' ? 'true' : undefined
                }
            >
              <span className="truncate text-[10px] uppercase text-muted-foreground">
                {activePathTransformTarget}
              </span>
              <div className="grid grid-cols-5 gap-1">
                <button
                  aria-label={`Rotate ${activePathTransformTarget} 90 degrees counterclockwise`}
                  className={iconButtonClass}
                  disabled={!canOrientActiveTarget}
                  onClick={() =>
                      activePathTransformTarget === 'document' ? onRotatePathDocument(90) : onRotatePathSelection(90)
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
                    activePathTransformTarget === 'document' ? onRotatePathDocument(-90) : onRotatePathSelection(-90)
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
                  <span className="font-mono text-[10px]">180</span>
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
              <span className="text-[10px] uppercase text-muted-foreground">
                {activePathTransformTarget === 'document' ? 'Reference Target' : 'Center Target'}
              </span>
              <span
                className="truncate text-[10px] text-muted-foreground"
                data-upid-transform-selection-center-current
                data-upid-transform-target-center-current
              >
                {activeTargetReferencePoint ? formatPoint(activeTargetReferencePoint) : '-'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[10px] uppercase text-muted-foreground">
                X
                <input
                  aria-label={`${activeTransformTargetLabel} ${activeTargetReferenceName} target X`}
                  className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                  data-upid-transform-selection-center-x
                  data-upid-transform-target-center-x
                  disabled={!activeTargetReferencePoint || isSaving}
                  inputMode="decimal"
                  onChange={(event) => setUserTargetX(event.currentTarget.value)}
                  type="number"
                  value={pathTargetXDraft}
                />
              </label>
              <label className="grid gap-1 text-[10px] uppercase text-muted-foreground">
                Y
                <input
                  aria-label={`${activeTransformTargetLabel} ${activeTargetReferenceName} target Y`}
                  className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                  data-upid-transform-selection-center-y
                  data-upid-transform-target-center-y
                  disabled={!activeTargetReferencePoint || isSaving}
                  inputMode="decimal"
                  onChange={(event) => setUserTargetY(event.currentTarget.value)}
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
                  setUserTargetX(formatCoordinateDraft(0));
                  setUserTargetY(formatCoordinateDraft(0));
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
                  setUserTargetX(formatCoordinateDraft(latestMeasurementPoint.x));
                  setUserTargetY(formatCoordinateDraft(latestMeasurementPoint.y));
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
                    }, 'transform-target');
                  } else {
                    onMovePathSelectionCenter({ x: targetX, y: targetY });
                  }
                }}
                type="button"
              >
                {activePathTransformTarget === 'document' ? 'Move Ref' : 'Move Center'}
              </button>
            </div>
            {(!Number.isFinite(targetX) || !Number.isFinite(targetY)) && (
              <p className="mt-1 text-[10px] text-destructive" role="status">Enter both target coordinates.</p>
            )}
            {measurementPoints.length > 0 && (
              <div
                className="mt-2 border-t border-border pt-2"
                data-upid-transform-selection-center-points
                data-upid-transform-target-center-points
              >
                <span className="mb-1 block text-[10px] uppercase text-muted-foreground">Target Point</span>
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
                        setUserTargetX(formatCoordinateDraft(point.x));
                        setUserTargetY(formatCoordinateDraft(point.y));
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
              <span className="text-[10px] uppercase text-muted-foreground">Segment Center</span>
              <span className="truncate text-[10px] text-muted-foreground" data-upid-transform-center-current>
                {selectedSegmentCenter ? formatPoint(selectedSegmentCenter) : '-'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[10px] uppercase text-muted-foreground">
                X
                <input
                  aria-label="Center target X"
                  className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                  data-upid-transform-center-x
                  disabled={!selectedSegmentCenter || isSaving}
                  inputMode="decimal"
                  onChange={(event) => setUserTargetX(event.currentTarget.value)}
                  type="number"
                  value={pathTargetXDraft}
                />
              </label>
              <label className="grid gap-1 text-[10px] uppercase text-muted-foreground">
                Y
                <input
                  aria-label="Center target Y"
                  className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                  data-upid-transform-center-y
                  disabled={!selectedSegmentCenter || isSaving}
                  inputMode="decimal"
                  onChange={(event) => setUserTargetY(event.currentTarget.value)}
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
                  setUserTargetX(formatCoordinateDraft(0));
                  setUserTargetY(formatCoordinateDraft(0));
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
                  setUserTargetX(formatCoordinateDraft(latestMeasurementPoint.x));
                  setUserTargetY(formatCoordinateDraft(latestMeasurementPoint.y));
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
                <span className="mb-1 block text-[10px] uppercase text-muted-foreground">Target Point</span>
                <div className="grid max-h-16 grid-cols-4 gap-1 overflow-auto">
                  {measurementPoints.map((point, index) => (
                    <button
                      aria-label={`Use measurement point P${index + 1} as center target`}
                      className={textButtonClass}
                      data-upid-transform-center-use-point={index + 1}
                      disabled={!selectedSegmentCenter || isSaving}
                      key={point.id}
                      onClick={() => {
                        setUserTargetX(formatCoordinateDraft(point.x));
                        setUserTargetY(formatCoordinateDraft(point.y));
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
        )}

        {renderWorkspacePanel(
          'endpoint-topology',
          'Endpoint Topology',
        <section data-upid-endpoint-topology>
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-[10px] uppercase text-muted-foreground">Endpoint Topology</span>
              <span
                className="block truncate text-[12px] font-semibold text-foreground"
                data-upid-endpoint-topology-title
              >
                Endpoint Join Map
              </span>
              <span className="block text-[10px] leading-3 text-muted-foreground">
                Shows which start/end handles form chains.
              </span>
            </span>
            <span
              className={`shrink-0 border px-1.5 py-0.5 text-[10px] ${
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
            className="mb-2 border border-border bg-background/35 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground"
            data-upid-endpoint-topology-help
          >
              Endpoint topology pairs segment starts and ends into continuous contours. The join map tells you whether
              the importer found exact joins, tiny healed gaps, open chain clues, or ambiguous endpoint candidates that
              need review before export.
          </p>
          <div
            className="mb-2 grid grid-cols-2 gap-1 text-[10px]"
            data-upid-endpoint-topology-summary
            title="Endpoint topology explains how segment starts and ends are paired into continuous contours."
          >
              <TopologyMetric
                id="exact-joins"
                label="Exact joins"
                value={endpointTopologyPanel.exactJoinCount}
                tone="ok"
              />
              <TopologyMetric
                id="open-ends"
                label="Open chain clues"
                value={endpointTopologyPanel.openEndCount}
                tone={endpointTopologyPanel.openEndCount > 0 ? 'warn' : 'muted'}
              />
              <TopologyMetric
                id="healed-joins"
                label="Healed joins"
                value={endpointTopologyPanel.snappedCount}
                tone={endpointTopologyPanel.snappedCount > 0 ? 'warn' : 'muted'}
              />
              <TopologyMetric
                id="ambiguous"
                label="Ambiguous joins"
                value={endpointTopologyPanel.ambiguousCount}
                tone={endpointTopologyPanel.ambiguousCount > 0 ? 'warn' : 'muted'}
              />
          </div>
          {endpointTopologyRows.length > 0 ? (
              <div className="border border-border bg-background/35" data-upid-endpoint-topology-list>
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
            <p className="border border-border bg-background/35 px-2 py-1.5 text-[10px] text-muted-foreground">
              No healed or ambiguous joins. Every contour endpoint is cleanly paired inside import precision.
            </p>
          )}
        </section>
        )}

        {renderWorkspacePanel(
          'path-diagnostics',
          'Path Diagnostics',
          <section data-upid-diagnostics>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase text-muted-foreground">Path Diagnostics</span>
              <span className="text-[10px] text-amber-200">
                {pathDiagnostics.length} {pathDiagnostics.length === 1 ? 'issue' : 'issues'}
              </span>
            </div>
            {pathDiagnostics.length > 0 && (
              <div
                className="mb-2 border border-amber-400/35 bg-amber-400/10 px-2 py-1.5 text-[10px] leading-4 text-amber-50"
                data-upid-diagnostics-repair-workflow
                title="Repair guidance: identify the broken join, inspect affected geometry, then open one owning workflow at a time."
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] uppercase text-amber-100">Repair workflow</span>
                </div>
                <ol className="grid gap-0.5 text-muted-foreground">
                  <li>
                    <span className="text-amber-100">1 Find the broken join:</span> use the targeted Endpoint Topology
                    link on the relevant diagnostic below.
                  </li>
                  <li>
                    <span className="text-amber-100">2 Inspect affected geometry:</span> use one targeted link at a
                    time, then select the affected refs to cross-highlight the canvas.
                  </li>
                  <li>
                    <span className="text-amber-100">3 Decide:</span> fix the source geometry, simplify the join, then
                    repair or re-import before trusting export.
                  </li>
                </ol>
              </div>
            )}
            <div
              className="border border-border bg-background/35"
              data-upid-diagnostics-list
              ref={diagnosticsListRef}
            >
              {pathDiagnostics.length > 0 ? (
                pathDiagnostics.map((diagnostic) =>
                  renderDiagnosticRow({
                    diagnostic,
                    hoveredPathElement,
                    onHoverPathElement,
                    onOpenWorkspacePanel,
                    onSelectPathElement,
                    selectedDiagnosticId,
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
        )}

        {renderWorkspacePanel(
          'cut-sequence',
          'Cut Sequence',
        <section className="-m-2" data-upid-cut-sequence>
          <div className="grid gap-1 border-b border-border p-2">
            <label
              className="grid gap-1 uppercase text-muted-foreground"
              data-upid-manual-order-active={manualOrderActive ? 'true' : undefined}
              data-upid-order-strategy
            >
              Planning Mode
              <select
                aria-label="Planning order strategy"
                className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
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
            </label>
            <span className="text-muted-foreground" data-upid-order-strategy-status>
              {manualOrderActive ? 'Manual order overrides active' : 'Automatic order active'}
            </span>
            <p className="text-[10px] text-muted-foreground">
              Automatic modes cut nested contours first. Manual moves override that order.
            </p>
            <button
              aria-label="Reapply planning order strategy"
              className={textButtonClass}
              disabled={!manualOrderActive || isSaving}
              onClick={() => onSetPathOperationOrderStrategy(pathDocument.options.operationOrderStrategy)}
              type="button"
            >
              Reapply Planning Mode
            </button>
          </div>
          <div data-upid-cut-sequence data-upid-cut-sequence-list>
            {unavailableSequenceMetrics?.status === 'unavailable' && (
              <p className="p-2 text-[10px] text-destructive" role="status">{unavailableSequenceMetrics.reason}</p>
            )}
            {cutSequenceElements.map((pathElement) =>
              renderCutSequenceRow({
                hoveredPathElement,
                isSaving,
                onHoverPathElement,
                onMovePathOperation,
                onSelectPathElement,
                operation: pathDocument.plan.operations.find(
                  (operation) => operation.id === pathElement.operationId
                ),
                operationCount: cutSequenceElements.length,
                metrics: sequenceMetrics.get(pathElement.operationId) ?? { status: 'unavailable', reason: 'Operation is unavailable.' },
                pathElement,
                selectedPathElement
              })
            )}
          </div>
        </section>
        )}

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
            <span className="block truncate text-[10px] text-muted-foreground">
              {formatPoint(row.point)} / paired exactly / {formatEndpointMemberPair(row.members)}
            </span>
          </span>
          <span className="text-right text-[10px] text-emerald-200">{row.memberCount} ends</span>
        </>
      ) : row.kind === 'open-endpoint-cluster' ? (
        <>
          <span className="min-w-0">
            <span className="block truncate text-[10px] text-amber-100">Open end {row.clusterId}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {formatPoint(row.point)} / not paired / {formatOpenEndpointMember(row.member)}
            </span>
          </span>
          <span className="text-right text-[10px] text-amber-200">{row.method}</span>
        </>
      ) : row.kind === 'snapped-endpoint-cluster' ? (
        <>
          <span className="min-w-0">
            <span className="block truncate text-[10px] text-foreground">Snapped {row.clusterId}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {formatPoint(row.point)} / gap {formatNumber(row.maxPairDistance)} / {row.memberCount} ends
            </span>
          </span>
          <span className="text-right text-[10px] text-muted-foreground">R {formatNumber(row.radius)}</span>
        </>
      ) : (
        <>
          <span className="min-w-0">
            <span className="block truncate text-[10px] text-foreground">Ambiguous {row.diagnosticId}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              ambiguous / candidates {row.candidateCount} / min gap{' '}
              {row.minCandidateDistance !== null ? formatNumber(row.minCandidateDistance) : '-'}
            </span>
          </span>
          <span className="text-right text-[10px] text-muted-foreground">{row.relatedSegmentCount} seg</span>
        </>
      )}
    </button>
  );
}

function formatEndpointMemberPair(
  members: Array<{
    pointRole: 'start' | 'end' | null;
    rawEndpointSide: 'start' | 'end';
    segmentIndex: number | null;
    segmentId: string;
  }>
) {
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
        className="block text-[10px] uppercase text-muted-foreground"
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
  selectedDiagnosticId,
  selectedPathElement
}: {
  diagnostic: UpidSelectedPathDiagnostic;
  hoveredPathElement: EditorPathElementRef | null;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onOpenWorkspacePanel?: (panelId: DiagnosticPanelActionId) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  selectedDiagnosticId: string | null;
  selectedPathElement: EditorPathElementRef | null;
}) {
  const hoverElement = diagnostic.selectRef;
  const hovered = upidPathElementRefsMatch(hoverElement, hoveredPathElement);
  const selected = selectedDiagnosticId !== null
    ? diagnostic.id === selectedDiagnosticId
    : upidPathElementRefsMatch(hoverElement, selectedPathElement);
  const selectDiagnostic = () => {
    if (hoverElement) onSelectPathElement(hoverElement);
  };

  return (
    <div
      aria-disabled={hoverElement ? undefined : true}
      aria-current={selected ? 'true' : undefined}
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
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectDiagnostic();
        }
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
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase">
        <span className={diagnostic.severity === 'error' ? 'text-destructive' : 'text-amber-200'}>
          {diagnostic.severity}
        </span>
        <span className="truncate text-muted-foreground">{diagnostic.code}</span>
      </div>
      <p className="text-[10px] leading-4 text-muted-foreground">{diagnostic.message}</p>
      {renderDiagnosticGuidance(diagnostic, onOpenWorkspacePanel)}
      <span className="text-[10px] text-muted-foreground">
        segments {diagnostic.relatedSegmentCount} / clusters {diagnostic.relatedClusterCount}
      </span>
      {diagnostic.metrics.length > 0 && (
        <span className="flex min-w-0 flex-wrap gap-1 pt-0.5">
          {diagnostic.metrics.map((metric) => (
            <span
              className="border border-border bg-background/60 px-1 text-[10px] text-muted-foreground"
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
              className="border border-border bg-background/60 px-1 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
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
      className="mt-1 border border-border bg-background/45 px-2 py-1 text-[10px] leading-4 text-muted-foreground"
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
              className="border border-border bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
          { label: 'Show Geometry', panelId: 'geometry-rail' }
        ],
        title: 'Open chains have unmatched start/end endpoints.',
        text: 'Open Endpoint Topology, select the affected start/end refs below, and inspect the gap in the Contour Tree. If this should be a closed loop, repair or re-import the source endpoints before exporting.'
      };
    case 'ambiguous-endpoint-cluster':
      return {
        actions: [{ label: 'Open Endpoint Topology', panelId: 'endpoint-topology' }],
        title: 'More than one endpoint pairing is possible inside tolerance.',
        text: 'Open Endpoint Topology and compare the candidate endpoint refs. Simplify the nearby geometry or re-import with cleaner endpoints so the chain order is unambiguous.'
      };
    case 'endpoint-cluster-snap':
      return {
        actions: [{ label: 'Open Endpoint Topology', panelId: 'endpoint-topology' }],
        title: 'The importer healed a small endpoint gap.',
        text: 'Inspect the snapped endpoint in Endpoint Topology. If the healed gap is intentional and tiny, continue; if it bridges the wrong edges, fix the source geometry.'
      };
    case 'post-bridged-gap':
    case 'post-unexpected-gap':
      return {
        actions: [
          { label: 'Show Geometry', panelId: 'geometry-rail' },
          { label: 'Open Cut Sequence', panelId: 'cut-sequence' }
        ],
        title: 'The posted path contains a bridge or unexpected travel gap.',
        text: 'Select the affected refs, then check cut order, direction, and endpoint joins before trusting the exported G-code.'
      };
    case 'invalid-arc':
    case 'invalid-polyline':
    case 'zero-length-segment':
      return {
        actions: [{ label: 'Show Geometry', panelId: 'geometry-rail' }],
        title: 'The source entity could not become clean cut geometry.',
        text: 'Select the affected refs, then repair the source entity or remove duplicate/invalid geometry before importing again.'
      };
    case 'self-intersection':
    case 'degenerate-contour':
      return {
        actions: [{ label: 'Show Geometry', panelId: 'geometry-rail' }],
        title: 'The contour shape is not a clean closed machining loop.',
        text: 'Inspect the highlighted contour and segment rows. Repair overlapping, crossing, or collapsed geometry before relying on automatic ordering.'
      };
    case 'branching-topology':
    case 'closed-chain-gap':
    case 'route-dependency-cycle':
      return {
        actions: [
          { label: 'Show Geometry', panelId: 'geometry-rail' },
          { label: 'Open Cut Sequence', panelId: 'cut-sequence' }
        ],
        title: 'The path graph needs manual inspection.',
        text: 'Use the affected refs and Contour Tree to find the conflicting joins, then fix the source geometry or adjust ordering manually.'
      };
    default:
      return null;
  }
}

function renderCutSequenceRow({
  hoveredPathElement,
  isSaving,
  onHoverPathElement,
  onMovePathOperation,
  onSelectPathElement,
  operation,
  operationCount,
  metrics,
  pathElement,
  selectedPathElement
}: {
  hoveredPathElement: EditorPathElementRef | null;
  isSaving: boolean;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onMovePathOperation: (direction: -1 | 1, operationId?: string) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  operation: PathOperation | undefined;
  operationCount: number;
  metrics: CutSequenceMetrics;
  pathElement: UpidOperationPathElement;
  selectedPathElement: EditorPathElementRef | null;
}) {
  const selected = selectedPathElement?.operationId === pathElement.operationId;
  const hovered = hoveredPathElement?.operationId === pathElement.operationId;
  const rapidSelected =
    selectedPathElement?.operationId === pathElement.operationId && selectedPathElement.travelRole === 'rapid-in';
  const rapidHovered =
    hoveredPathElement?.operationId === pathElement.operationId && hoveredPathElement.travelRole === 'rapid-in';
  const manualDecisions = upidManualDecisionKinds(operation ?? pathElement);
  const cutLength = metrics.status === 'active' ? metrics.cutLength.toFixed(3) : null;
  const rapidInLength = metrics.status === 'active' && metrics.rapidInLength !== null ? metrics.rapidInLength.toFixed(3) : null;
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
          <span className="block truncate text-[10px] text-muted-foreground">
            {pathElement.label} / {pathElement.closed ? 'closed contour' : 'open chain'} / {pathElement.direction}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {upidPathElementNestLabel(pathElement)}
          </span>
          {renderManualDecisionBadges(manualDecisions)}
        </span>
      </button>
      <button
        aria-label="Select rapid travel for cut sequence operation"
        disabled={metrics.status !== 'active' || metrics.rapidInLength === null}
        aria-pressed={rapidSelected}
        className={`grid h-full content-center px-1 text-right text-[10px] leading-tight outline-none hover:bg-accent ${
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
        title={metrics.status === 'unavailable' ? metrics.reason : metrics.status === 'inactive' ? 'Excluded from cutting' : metrics.rapidInLength === null ? 'Set and review Initial Wire Position to measure this travel.' : 'Rapid travel into this operation'}
        type="button"
      >
        {metrics.status === 'active' ? <>
          <span data-upid-cut-sequence-cut-value={cutLength}>Cut {cutLength}</span>
          <span data-upid-cut-sequence-rapid-value={rapidInLength}>Rapid {rapidInLength ?? 'unavailable'}</span>
        </> : <span>{metrics.status === 'inactive' ? 'Inactive' : 'Unavailable'}</span>}
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

function segmentDetailsKey(pathElementId: string, segmentId: string, index: number) {
  return `${pathElementId}:${segmentId}:${index}`;
}

function readSelectedEndpointSegmentKey(
  elements: UpidOperationPathElement[],
  selectedPathElement: EditorPathElementRef | null
) {
  if (!selectedPathElement?.pointRole || !selectedPathElement.segmentId) return null;

  const owner = elements.find(
    (element) =>
      (selectedPathElement.pathElementId
        ? element.id === selectedPathElement.pathElementId
        : element.operationId === selectedPathElement.operationId) &&
      element.segmentRefs.some((ref) => ref.segmentId === selectedPathElement.segmentId)
  );
  if (!owner) return null;

  const index = owner.segmentRefs.findIndex((ref) => ref.segmentId === selectedPathElement.segmentId);
  return index < 0 ? null : segmentDetailsKey(owner.id, selectedPathElement.segmentId, index);
}

function renderContourTreeNode({
  expandedSegmentDetailIds,
  hoveredPathElement,
  isSaving,
  node,
  onHoverPathElement,
  onSelectPathElement,
  onToggleSegmentDetails,
  pathDocument,
  isCutPathExpanded,
  isPathElementExpanded,
  selectedPathElement,
  selectedPathOperationId,
  spatialActions,
  selectedSpatialActionKey,
  onSelectSpatialAction,
  onActivateSpatialAction,
  segmentsById,
  togglePathElementExpanded,
  toggleCutPathExpanded,
  treeDepth
}: {
  expandedSegmentDetailIds: Record<string, boolean>;
  hoveredPathElement: EditorPathElementRef | null;
  isSaving: boolean;
  isCutPathExpanded: (pathElementId: string) => boolean;
  isPathElementExpanded: (pathElementId: string) => boolean;
  node: UpidProjectRailTreeNode;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  onToggleSegmentDetails: (segmentKey: string) => void;
  pathDocument: PathPlanningDocument;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  spatialActions: readonly ExecutionSpatialAction[];
  selectedSpatialActionKey: string | null;
  onSelectSpatialAction?: (key: string) => void;
  onActivateSpatialAction?: (key: string) => void;
  segmentsById: ReturnType<typeof segmentMap>;
  togglePathElementExpanded: (pathElementId: string) => void;
  toggleCutPathExpanded: (pathElementId: string) => void;
  treeDepth: number;
}) {
  const { element } = node;
  const transitions = pathDocument.plan.operations.find(
    (operation) => operation.id === element.operationId
  )?.transitions;
  const manualDecisions = upidManualDecisionKinds(element);
  const label = element.displayName;
  const sourceEntityCount = upidPathElementSourceEntityCount(element);
  const editedSegmentCount = element.provenance.edit?.derivedSegmentIds.length ?? 0;
  const expanded = isPathElementExpanded(element.id);
  const cutPathExpanded = isCutPathExpanded(element.id);
  const contourKindLabel = element.closed ? 'Closed contour' : 'Open chain';
  const diagnosticSummary = summarizeUpidDiagnosticsForPathElementRef(pathDocument, {
    operationId: element.operationId,
    pathElementId: element.id,
    segmentId: null
  });
  const workbookNumber = String(element.orderIndex + 1).padStart(2, '0');
  const contourRef: EditorPathElementRef = {
    operationId: element.operationId,
    pathElementId: element.id,
    segmentId: null
  };
  const contourHelp = formatContourRowHelp({
    contourKindLabel,
    diagnosticSummary,
    editedSegmentCount,
    element,
    manualDecisions,
    node,
    sourceEntityCount
  });

  return (
    <details
      className="overflow-hidden"
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
          className={`grid w-full grid-cols-[18px_26px_minmax(0,1fr)] items-stretch border-b border-border/50 ${
            element.operationId === selectedPathOperationId
              ? 'bg-sky-500/15 text-sky-100'
              : hoveredPathElement?.operationId === element.operationId
                ? 'bg-cyan-500/10 text-cyan-100'
                : ''
          }`}
          style={{ paddingLeft: `${treeDepth * 10}px` }}
        >
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
            className="flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              togglePathElementExpanded(element.id);
            }}
            title={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
            type="button"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
          <span
            className="flex items-center justify-center font-mono text-[10px] font-semibold text-sky-200"
            data-upid-contour-field="order"
          >
            {workbookNumber}
          </span>
          <button
            aria-label={`Select ${label}`}
            aria-pressed={element.operationId === selectedPathOperationId}
            className="min-w-0 px-2 py-1.5 text-left outline-none"
            data-upid-contour-children={element.childIds.length}
            data-upid-contour-depth={element.containmentDepth}
            data-upid-contour-display-name={element.displayName}
            data-upid-contour-diagnostic-codes={formatDiagnosticSummaryCodes(diagnosticSummary)}
            data-upid-contour-diagnostic-ids={formatDiagnosticSummaryIds(diagnosticSummary)}
            data-upid-contour-diagnostic-severity={diagnosticSummary.severity ?? undefined}
            data-upid-contour-diagnostics={diagnosticSummary.count}
            data-upid-contour-label={element.label}
            data-upid-contour-manual={manualDecisions.length > 0 ? manualDecisions.join(' ') : undefined}
            data-upid-contour-order={element.orderIndex + 1}
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
            onBlur={() => onHoverPathElement(null)}
            onClick={(event) => {
              event.preventDefault();
              onSelectPathElement(contourRef);
            }}
            onFocus={() => onHoverPathElement(contourRef)}
            onMouseEnter={() => onHoverPathElement(contourRef)}
            onMouseLeave={() => onHoverPathElement(null)}
            onPointerEnter={() => onHoverPathElement(contourRef)}
            onPointerLeave={() => onHoverPathElement(null)}
            title={contourHelp}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-1">
              <span
                className="min-w-0 truncate text-[11px] font-medium text-foreground"
                data-upid-tree-kind-label
              >
                {label}
              </span>
              <span className="min-w-0 truncate text-[10px] capitalize text-muted-foreground" data-upid-contour-field="role">
                · {element.classification}
              </span>
              {diagnosticSummary.count > 0 && (
                <span className="ml-auto shrink-0 text-[9px] text-amber-200">
                  {diagnosticSummary.count}<span className="sr-only"> issues</span>
                </span>
              )}
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  diagnosticSummary.count > 0
                    ? 'bg-amber-400'
                    : element.closed
                      ? 'bg-emerald-400'
                      : 'bg-muted-foreground'
                }`}
                data-upid-contour-node-summary
                title={`${element.closed ? 'Closed' : 'Open'} ${diagnosticSummary.count > 0 ? `· ${diagnosticSummary.count} issues` : ''}`}
              >
                <span className="sr-only">{element.closed ? 'Closed' : 'Open'}</span>
              </span>
              <span className="sr-only" data-upid-contour-field="cut-length">
                Cut {element.metrics.cutLength.toFixed(3)}
              </span>
              <span className="sr-only" data-upid-contour-field="segments">
                {node.treeMetrics.directSegmentCount} segments
              </span>
              <span className="sr-only" data-upid-tree-action-hint>
                Selects whole contour on canvas
              </span>
            </span>
          </button>
        </div>
      </summary>
      {expanded && (
        <>
          {spatialActions.filter((action) => action.operationId === element.operationId &&
            (action.eventKind !== 'motion' || action.label !== 'Cut endpoint')).map((action) => (
            <div key={action.key} className="flex items-center border-b border-border/40">
            <button type="button" data-upid-machining-action={action.key}
              aria-pressed={selectedSpatialActionKey === action.key}
              className={`flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[10px] hover:bg-accent ${selectedSpatialActionKey === action.key ? 'bg-sky-500/15' : ''}`}
              style={{ paddingLeft: `${32 + (treeDepth + 1) * 10}px` }}
              onClick={() => onSelectSpatialAction?.(action.key)} title={action.detail}>
              <span className={action.pause === 'generated-manual-thread' ? 'text-rose-300' :
                action.pause === 'authored' ? 'text-amber-300' :
                action.pause === 'emitted-post' ? 'text-violet-300' : 'text-cyan-300'}>●</span>
              <span>{action.label}</span>
              <span className="ml-auto pr-2 font-mono text-muted-foreground">
                X {action.point.x.toFixed(3)} Y {action.point.y.toFixed(3)}
              </span>
            </button>
            <button type="button" className="px-2 text-cyan-300 hover:bg-accent"
              aria-label={`Edit ${action.label}`} onClick={() => onActivateSpatialAction?.(action.key)}>Edit</button>
            </div>
          ))}
          <button
            aria-expanded={cutPathExpanded}
            aria-label={`${cutPathExpanded ? 'Collapse' : 'Expand'} cut path in ${label}`}
            className={`flex h-6 w-full min-w-0 items-center gap-1 border-b border-border/40 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring pr-2`}
            data-upid-cut-path-disclosure
            onClick={() => toggleCutPathExpanded(element.id)}
            style={{ paddingLeft: `${22 + (treeDepth + 1) * 10}px` }}
            type="button"
          >
            {cutPathExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <span className="truncate">Cut path</span>
            <span className="shrink-0">
              · {element.segmentRefs.length} {element.segmentRefs.length === 1 ? 'segment' : 'segments'}
            </span>
          </button>
          {cutPathExpanded && (
            <div data-upid-segment-stack>
              {renderLeadRow(element, transitions?.entry, 'lead-in', hoveredPathElement,
                selectedPathElement, onHoverPathElement, onSelectPathElement)}
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
                  isSaving,
                  expandedSegmentDetailIds[segmentDetailsKey(element.id, ref.segmentId, index)] ?? false,
                  () => onToggleSegmentDetails(segmentDetailsKey(element.id, ref.segmentId, index)),
                  treeDepth
                )
              )}
              {renderLeadRow(element, transitions?.exit, 'lead-out', hoveredPathElement,
                selectedPathElement, onHoverPathElement, onSelectPathElement)}
            </div>
          )}
        </>
      )}
      {expanded && node.children.length > 0 && (
        <div
          data-upid-contour-children-list
          data-upid-nested-contours-section
        >
            <span className="sr-only">
              Nested contours · {node.children.length} inside {label}
            </span>
          {node.children.map((child) =>
            renderContourTreeNode({
              expandedSegmentDetailIds,
              hoveredPathElement,
              isSaving,
              node: child,
              onHoverPathElement,
              onSelectPathElement,
              onToggleSegmentDetails,
              isCutPathExpanded,
              isPathElementExpanded,
              pathDocument,
              selectedPathElement,
              selectedPathOperationId,
              spatialActions,
              selectedSpatialActionKey,
              onSelectSpatialAction,
              onActivateSpatialAction,
              segmentsById,
              togglePathElementExpanded,
              toggleCutPathExpanded,
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
          className="border border-amber-400/40 bg-amber-400/10 px-1 text-[10px] uppercase text-amber-200"
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
        className={`border px-1 text-[10px] uppercase ${
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

function formatContourRowHelp({
  contourKindLabel,
  diagnosticSummary,
  editedSegmentCount,
  element,
  manualDecisions,
  node,
  sourceEntityCount
}: {
  contourKindLabel: string;
  diagnosticSummary: UpidPathDiagnosticSummary;
  editedSegmentCount: number;
  element: UpidOperationPathElement;
  manualDecisions: UpidManualDecisionKind[];
  node: UpidProjectRailTreeNode;
  sourceEntityCount: number;
}) {
  const nesting = element.parentId
    ? `depth ${element.containmentDepth}, nested under ${element.parentId}`
    : `depth ${element.containmentDepth}, root contour`;
  const manual =
    manualDecisions.length === 0
      ? 'automatic decisions'
      : `manual ${manualDecisions
          .map((decision) => (decision === 'direction' ? `direction ${element.direction}` : decision))
          .join(', ')}`;
  const diagnostics =
    diagnosticSummary.count === 0
      ? 'diagnostics clean'
      : `diagnostics ${diagnosticSummary.count}: ${diagnosticSummary.codes.join(', ')}`;

  return `${contourKindLabel.toLowerCase()}; ${nesting}; direction ${element.direction}; provenance ${element.label}; source ${sourceEntityCount} ${sourceEntityCount === 1 ? 'entity' : 'entities'}; edits ${editedSegmentCount}; topology ${formatTreeMetrics(node.treeMetrics)}; ${diagnostics}; ${manual}. Selects and highlights the whole contour.`;
}

function formatTreeMetrics(metrics: UpidProjectRailTreeNode['treeMetrics']) {
  const segmentLabel = metrics.directSegmentCount === 1 ? 'segment' : 'segments';
  if (metrics.descendantCount === 0) return `${metrics.directSegmentCount} ${segmentLabel}`;

  const descendantLabel = metrics.descendantCount === 1 ? 'nested contour' : 'nested contours';
  return `${metrics.directSegmentCount} ${segmentLabel} / ${metrics.descendantCount} ${descendantLabel} / ${metrics.totalSegmentCount} total`;
}

function formatSegmentRowHelp({
  diagnosticSummary,
  index,
  pathElement,
  ref,
  segment
}: {
  diagnosticSummary: UpidPathDiagnosticSummary;
  index: number;
  pathElement: UpidOperationPathElement;
  ref: OrientedSegmentRef;
  segment: PathSegment;
}) {
  const sourceHandle = segment.source.sourceEntityHandle
    ? ` handle ${segment.source.sourceEntityHandle}`
    : '';
  const sourceSubIndex =
    segment.source.sourceSubIndex === undefined ? '' : ` part ${segment.source.sourceSubIndex + 1}`;
  const edit = segment.source.edit ? `; edit ${segment.source.edit.kind}` : '; unedited';
  const diagnostics =
    diagnosticSummary.count === 0
      ? 'diagnostics clean'
      : `diagnostics ${diagnosticSummary.count}: ${diagnosticSummary.codes.join(', ')}`;

  return `${segment.kind} segment ${index + 1} in ${pathElement.displayName}; ${ref.reversed ? 'reversed' : 'forward'} reference; source ${segment.source.sourceEntityType} entity ${segment.source.sourceEntityIndex + 1}${sourceHandle}${sourceSubIndex}; ${segment.source.exact ? 'exact' : 'approximated'} provenance; layer ${segment.layer ?? '-'}${edit}; ${diagnostics}. Selects and highlights one segment.`;
}

function renderLeadRow(
  pathElement: UpidOperationPathElement,
  lead: OperationEntry | OperationExit | undefined,
  travelRole: 'lead-in' | 'lead-out',
  hoveredPathElement: EditorPathElementRef | null,
  selectedPathElement: EditorPathElementRef | null,
  onHoverPathElement: (element: EditorPathElementRef | null) => void,
  onSelectPathElement: (element: EditorPathElementRef) => void
) {
  if (!lead || lead.strategy === 'none') return null;
  const element: EditorPathElementRef = {
    operationId: pathElement.operationId,
    pathElementId: pathElement.id,
    segmentId: null,
    travelRole
  };
  const hovered = hoveredPathElement?.operationId === pathElement.operationId &&
    hoveredPathElement.travelRole === travelRole;
  const selected = selectedPathElement?.operationId === pathElement.operationId &&
    selectedPathElement.travelRole === travelRole;
  const length = Math.hypot(lead.to.x - lead.from.x, lead.to.y - lead.from.y);
  const label = travelRole === 'lead-in' ? 'Entry' : 'Exit';
  const strategy = lead.strategy === 'circle-center' ? 'Circle center' : 'Straight';
  const reviewRequired = 'review' in lead && lead.review === 'required';

  return (
    <button
      aria-label={`Select ${travelRole} for ${pathElement.displayName}`}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2 border-l border-border/70 px-2 py-1 text-left text-[10px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring ${
        selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : 'hover:bg-accent'
      }`}
      data-upid-operation-id={pathElement.operationId}
      data-upid-path-element-id={pathElement.id}
      data-upid-hovered={hovered ? 'true' : undefined}
      data-upid-selected={selected ? 'true' : undefined}
      data-upid-travel-role={travelRole}
      data-upid-tree-row-action={`select-${travelRole}`}
      data-upid-tree-row-kind={travelRole}
      data-upid-tree-row-level="1"
      onBlur={() => onHoverPathElement(null)}
      onClick={() => onSelectPathElement(element)}
      onFocus={() => onHoverPathElement(element)}
      onMouseEnter={() => onHoverPathElement(element)}
      onMouseLeave={() => onHoverPathElement(null)}
      onPointerEnter={() => onHoverPathElement(element)}
      onPointerLeave={() => onHoverPathElement(null)}
      title={`${label}: ${formatPoint(lead.from)} → ${formatPoint(lead.to)}`}
      type="button"
    >
      <Flag className="size-3 shrink-0" aria-hidden="true" />
      <span className="font-medium text-foreground">{label}</span>
      <span className="truncate">{strategy}</span>
      {reviewRequired && <span className="text-amber-200">Review required</span>}
      <span className="ml-auto shrink-0 tabular-nums">{length.toFixed(3)} mm</span>
    </button>
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
  isSaving: boolean,
  detailsExpanded: boolean,
  onToggleDetails: () => void,
  treeDepth: number
) {
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const segmentLength = segment.length.toFixed(3);
  const geometry = readUpidSegmentGeometry(segment, ref);
  const segmentKindLabel = `${segment.kind.toUpperCase()} segment`;
  const diagnosticSummary = summarizeUpidDiagnosticsForPathElementRef(pathDocument, {
    operationId: pathElement.operationId,
    pathElementId: pathElement.id,
    segmentId: segment.id
  });
  const startDiagnosticSummary = summarizeUpidDiagnosticsForPathElementRef(pathDocument, {
    operationId: pathElement.operationId,
    pathElementId: pathElement.id,
    pointRole: 'start',
    segmentId: segment.id
  });
  const endDiagnosticSummary = summarizeUpidDiagnosticsForPathElementRef(pathDocument, {
    operationId: pathElement.operationId,
    pathElementId: pathElement.id,
    pointRole: 'end',
    segmentId: segment.id
  });
  const showCircleClosureSides =
    geometry.kind === 'circle' &&
    (Math.hypot(end.x - start.x, end.y - start.y) > 1e-6 ||
      startDiagnosticSummary.count > 0 ||
      endDiagnosticSummary.count > 0);
  const geometryPresentation = buildSegmentGeometryPresentation({
    end,
    geometry,
    length: segment.length,
    showCircleClosureSides,
    start
  });
  const hovered =
    hoveredPathElement?.operationId === pathElement.operationId &&
    hoveredPathElement.segmentId === segment.id &&
    !hoveredPathElement.pointRole;
  const selected =
    selectedPathElement?.operationId === pathElement.operationId &&
    selectedPathElement.segmentId === segment.id &&
    !selectedPathElement.pointRole;
  const element: EditorPathElementRef = {
    operationId: pathElement.operationId,
    pathElementId: pathElement.id,
    segmentId: segment.id
  };
  const detailsId = `upid-segment-details-${pathElement.id}-${index}`;
  const segmentHelp = formatSegmentRowHelp({
    diagnosticSummary,
    index,
    pathElement,
    ref,
    segment
  });

  return (
    <div
      className="border-b border-border/40 last:border-b-0"
      data-upid-segment-details-expanded={detailsExpanded ? 'true' : 'false'}
      data-upid-path-element-id={pathElement.id}
      data-upid-segment-group
      key={`${pathElement.id}-${segment.id}-${index}`}
    >
      <div
        className="grid grid-cols-[18px_minmax(0,1fr)]"
        style={{ paddingLeft: `${30 + (treeDepth + 1) * 10}px` }}
      >
      <button
        aria-label={`Select segment ${index + 1} in ${pathElement.displayName}`}
        aria-pressed={selected}
          className={`order-last flex h-6 min-w-0 items-center gap-1 px-1 pr-2 text-left text-[10px] text-muted-foreground outline-none ${
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
          data-upid-segment-orientation={geometry.kind === 'line' ? undefined : geometry.clockwise ? 'cw' : 'ccw'}
        data-upid-segment-radius={geometry.kind === 'line' ? undefined : formatNumber(geometry.radius)}
        data-upid-segment-reversed={ref.reversed ? 'true' : 'false'}
        data-upid-segment-sweep={geometry.kind === 'line' ? undefined : formatNumber(geometry.sweepDegrees)}
        data-upid-segment-row
        data-upid-segment-id={segment.id}
        data-upid-tree-row-action="select-segment"
        data-upid-tree-row-kind="segment"
        data-upid-tree-row-level="1"
        onBlur={() => onHoverPathElement(null)}
        onClick={() => onSelectPathElement(element)}
        onFocus={() => onHoverPathElement(element)}
        onMouseEnter={() => onHoverPathElement(element)}
        onMouseLeave={() => onHoverPathElement(null)}
        onPointerEnter={() => onHoverPathElement(element)}
        onPointerLeave={() => onHoverPathElement(null)}
        title={segmentHelp}
        type="button"
      >
          <>
            <span
              className="shrink-0 font-mono text-[10px] text-cyan-100"
              data-upid-tree-depth-rail="segment"
            >
              S{index + 1}
            </span>
            <span className="shrink-0 text-border">·</span>
            <span className="shrink-0 font-medium uppercase text-foreground" data-upid-tree-kind-label>
              {segment.kind}
            </span>
            {renderSegmentSummary(geometryPresentation)}
            {diagnosticSummary.count > 0 && (
              <span className="shrink-0 text-[9px] text-amber-200">{diagnosticSummary.count}</span>
            )}
            <span className="sr-only" data-upid-segment-span>
              {formatPoint(start)} → {formatPoint(end)}
            </span>
          </>
          <>
            <span className="sr-only" data-upid-tree-action-hint>
              Selects one segment on canvas
            </span>
            <span className="sr-only" data-upid-segment-kind-label>
              {segmentKindLabel}
            </span>
          </>
        </button>
        <button
          aria-controls={detailsId}
          aria-expanded={detailsExpanded}
          aria-label={`${detailsExpanded ? 'Collapse' : 'Expand'} segment ${index + 1} details in ${pathElement.displayName}`}
          className="order-first flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleDetails();
          }}
          title={`${detailsExpanded ? 'Hide' : 'Show'} exact geometry and endpoints`}
          type="button"
        >
          {detailsExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
      </div>
      {detailsExpanded && (
        <div
          className="ml-14 border-t border-border bg-background/35 px-2 py-1.5"
          data-upid-segment-details
          id={detailsId}
        >
          {geometryPresentation.kind !== 'line' && (
            <div
              className={`grid gap-2 border-b border-border/50 pb-1.5 text-[9px] ${
                geometryPresentation.kind === 'arc' ? 'grid-cols-2' : 'grid-cols-1'
              }`}
              data-upid-segment-detail-metrics
            >
              <span className="flex min-w-0 flex-col gap-0.5" data-upid-segment-detail-metric="radius">
                <span className="text-muted-foreground">Radius</span>
                <span className="truncate font-mono text-foreground">
                  {formatNumber(geometryPresentation.summary.radius ?? 0)}
                </span>
              </span>
              {geometryPresentation.kind === 'arc' && (
                <span className="flex min-w-0 flex-col gap-0.5" data-upid-segment-detail-metric="sweep">
                  <span className="text-muted-foreground">Sweep</span>
                  <span className="truncate font-mono text-foreground">
                    {formatNumber(geometryPresentation.summary.sweepDegrees ?? 0)}°
                  </span>
                </span>
              )}
            </div>
          )}
          {geometryPresentation.derivedFields.length > 0 && (
            <div
              className="grid grid-cols-3 gap-2 pb-1.5 text-[9px]"
              data-upid-segment-derived-fields
            >
              {geometryPresentation.derivedFields.map((field) => (
                <span
                  className="flex min-w-0 flex-col gap-0.5"
                  data-upid-segment-derived={field.key}
                  key={field.key}
                >
                  <span className="text-muted-foreground">{field.label}</span>
                  <span className="truncate font-mono text-foreground">
                    {formatSegmentGeometryField(field)}
                  </span>
                </span>
              ))}
            </div>
          )}
          {diagnosticSummary.count > 0 && (
            <div className="pb-1">{renderDiagnosticSummaryBadge(diagnosticSummary)}</div>
          )}
          <div className="divide-y divide-border/50" data-upid-point-stack>
            {geometryPresentation.points.map((pointPresentation) => (
              <Fragment key={pointPresentation.key}>
                {pointPresentation.selectableRole
                  ? renderPointRow({
                      index,
                      label: pointPresentation.label,
                      onHoverPathElement,
                      onSelectPathElement,
                      pathElement,
                      point: pointPresentation.point,
                      pointKey: pointPresentation.key,
                      pathDocument,
                      role: pointPresentation.selectableRole,
                      segment,
                      hoveredPathElement,
                      isSaving,
                      selectedPathElement
                    })
                  : renderGeometryPointRow(
                      pointPresentation.key,
                      pointPresentation.label,
                      pointPresentation.point
                    )}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function renderPointRow({
  hoveredPathElement,
  index,
  isSaving,
  label,
  onHoverPathElement,
  onSelectPathElement,
  pathElement,
  point,
  pointKey,
  pathDocument,
  role,
  segment,
  selectedPathElement
}: {
  hoveredPathElement: EditorPathElementRef | null;
  index: number;
  isSaving: boolean;
  label: string;
  onHoverPathElement: (element: EditorPathElementRef | null) => void;
  onSelectPathElement: (element: EditorPathElementRef) => void;
  pathElement: UpidOperationPathElement;
  pathDocument: PathPlanningDocument;
  point: { x: number; y: number };
  pointKey: SegmentGeometryPointKey;
  role: 'center' | 'start' | 'end';
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
  const showEndpointClusterSummary = Boolean(
    endpointCluster && endpointCluster.method !== 'exact'
  );
  const diagnosticSummary = summarizeUpidDiagnosticsForPathElementRef(pathDocument, element);
  const endpointHelpId = `upid-endpoint-help-${pathElement.id}-${segment.id}-${index}-${role}`;
  const isCenter = role === 'center';
  const accessiblePointLabel =
    label === 'Start'
      ? 'start endpoint'
      : label === 'End'
        ? 'end endpoint'
        : label.toLowerCase();
  const endpointHelp = isCenter
    ? `Geometry center of segment ${index + 1} in ${pathElement.displayName} at ${formatPoint(point)}; ${diagnosticSummary.count === 0 ? 'diagnostics clean' : `diagnostics ${diagnosticSummary.count}: ${diagnosticSummary.codes.join(', ')}`}.`
    : `${endpointCluster ? `Endpoint cluster ${endpointCluster.id}` : 'Unpaired endpoint'}: ${accessiblePointLabel} of segment ${index + 1} in ${pathElement.displayName} at ${formatPoint(point)}; ${endpointClusterSummary ?? 'no topology pairing'}; ${diagnosticSummary.count === 0 ? 'diagnostics clean' : `diagnostics ${diagnosticSummary.count}: ${diagnosticSummary.codes.join(', ')}`}.`;

  return (
    <div
      className={`w-full text-left text-[10px] text-muted-foreground outline-none ${
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
      data-upid-geometry-point-key={pointKey}
      data-upid-geometry-point-row
      data-upid-point-row
      data-upid-tree-row-action={isCenter ? 'select-center' : 'select-endpoint'}
      data-upid-tree-row-kind={isCenter ? 'center' : 'endpoint'}
      data-upid-tree-row-level="2"
      onMouseEnter={() => onHoverPathElement(element)}
      onMouseLeave={() => onHoverPathElement(null)}
      onPointerEnter={() => onHoverPathElement(element)}
      onPointerLeave={() => onHoverPathElement(null)}
    >
      <button
        aria-describedby={endpointHelpId}
        aria-label={`Select ${accessiblePointLabel} of segment ${index + 1} in ${pathElement.displayName}`}
        aria-pressed={selected}
        className="grid w-full min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-x-2 px-1.5 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        data-upid-point-select
        onBlur={() => onHoverPathElement(null)}
        onClick={() => onSelectPathElement(element)}
        onFocus={() => onHoverPathElement(element)}
        title={endpointHelp}
        type="button"
      >
        <span
          className="truncate text-muted-foreground"
          data-upid-point-label
          data-upid-tree-depth-label="endpoint"
        >
          {label}
        </span>
        <span
          className="truncate font-mono text-foreground"
          data-upid-point-field="coordinate"
          data-upid-tree-depth-rail="endpoint"
        >
          {formatPoint(point)}
        </span>
        {showEndpointClusterSummary && endpointClusterSummary && (
          <span className="col-span-2 mt-0.5 truncate text-[9px] text-amber-200">
            {endpointClusterSummary}
          </span>
        )}
        {diagnosticSummary.count > 0 && (
          <span className="col-span-2 mt-0.5">
            {renderDiagnosticSummaryBadge(diagnosticSummary)}
          </span>
        )}
        <span className="sr-only" data-upid-tree-action-hint>
          Selects the {accessiblePointLabel} handle
        </span>
      </button>
      <span className="sr-only" data-upid-point-help={role} id={endpointHelpId}>
        {endpointHelp}
      </span>
    </div>
  );
}

function renderGeometryPointRow(
  pointKey: SegmentGeometryPointKey,
  label: string,
  point: { x: number; y: number }
) {
  return (
    <div
      className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 px-1.5 py-1.5 text-[10px]"
      data-upid-geometry-point-key={pointKey}
      data-upid-geometry-point-row
    >
      <span className="truncate text-muted-foreground" data-upid-point-label>
        {label}
      </span>
      <span className="truncate font-mono text-foreground">{formatPoint(point)}</span>
    </div>
  );
}

function renderSegmentSummary(presentation: SegmentGeometryPresentation) {
  const summaryClass = 'min-w-0 truncate text-[9px] text-muted-foreground';

  if (presentation.kind === 'line') {
    return (
      <span
        className="ml-auto shrink-0 font-mono text-foreground"
        data-upid-segment-summary="length"
        title="Length"
      >
        L {formatNumber(presentation.summary.length)}
      </span>
    );
  }

  if (presentation.kind === 'circle') {
    return (
      <>
        <span className={summaryClass}>
          · <span data-upid-segment-summary="direction">{presentation.summary.direction}</span>
        </span>
        <span
          className="ml-auto shrink-0 font-mono text-foreground"
          data-upid-segment-summary="circumference"
          title="Circumference"
        >
          Circ {formatNumber(presentation.summary.length)}
        </span>
      </>
    );
  }

  return (
    <>
      <span className={summaryClass}>
        · <span data-upid-segment-summary="direction">{presentation.summary.direction}</span>
      </span>
      <span
        className="ml-auto shrink-0 font-mono text-foreground"
        data-upid-segment-summary="arc-length"
        title="Arc length"
      >
        L {formatNumber(presentation.summary.length)}
      </span>
    </>
  );
}

function formatSegmentGeometryField(field: SegmentGeometryFieldPresentation) {
  if (field.format === 'point') {
    return typeof field.value === 'number' ? '-' : formatPoint(field.value);
  }
  if (typeof field.value !== 'number') return '-';
  if (field.format === 'degrees') return `${formatNumber(field.value)}°`;
  return formatNumber(field.value);
}

function formatPoint(point: { x: number; y: number }) {
  return `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`;
}

function formatBounds(bounds: Bounds2) {
  return `X ${formatNumber(bounds.minX)}..${formatNumber(bounds.maxX)} Y ${formatNumber(bounds.minY)}..${formatNumber(bounds.maxY)}`;
}

function formatDrawingExtents(extents: { min: { x: number; y: number }; max: { x: number; y: number } } | undefined) {
  if (!extents) return '-';
  return `X ${formatNumber(extents.min.x)}..${formatNumber(extents.max.x)} Y ${formatNumber(extents.min.y)}..${formatNumber(extents.max.y)}`;
}

function formatCoordinateDraft(value: number) {
  const rounded = value.toFixed(3);
  return Number(rounded) === value ? rounded : String(value);
}

function formatNumber(value: number) {
  return value.toFixed(3);
}
