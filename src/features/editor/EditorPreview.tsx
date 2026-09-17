import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type TouchEvent
} from 'react';
import { Magnet, Maximize2, MousePointer2, ZoomIn, ZoomOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import { measurePointPair } from '@/domain/editor/geometryMeasurement';
import { matchesPreviewSelectionFilter, PREVIEW_SELECTION_FILTERS, previewSelectionCandidates, segmentIntersectsSelectionRect, type PreviewSelectionFilter } from '@/domain/editor/previewSelection';
import { programStopPreview } from '@/domain/editor/programStopPreview';
import type { ExecutionSpatialAction } from '@/domain/editor/executionSpatialActions';
import type { EditorMeasurementState } from './useEditorMeasurement';
import type {
  MagnetizeMode,
  PathPointRelation
} from '@/domain/path-editor/pathPointInference';
import {
  buildEditorPathDocumentPreviewGeometry,
  buildEditorPreviewGeometry,
  fitViewBoxToViewportAspect
} from '@/domain/editor/previewGeometry';
import type { EditorPreviewPath, EditorPreviewViewBox } from '@/domain/editor/previewGeometry';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { orientedSegmentStart, orientedSegmentEnd } from '@/domain/path-intel/segments';
import type { EditorPathElementRef } from './EditorPathNavigatorPanel';
import {
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  PREVIEW_GRID_SIZE,
  PREVIEW_ZOOM_STEP,
  TOUCH_DOUBLE_TAP_TIMEOUT_MS,
  TOUCH_TAP_THRESHOLD,
  buildPreviewGrid,
  buildVisibleGridLabels,
  clampZoom,
  format,
  highlightColor,
  highlightForLine,
  initialPreviewViewState,
  isInteractiveTarget,
  previewEventToWorldPoint,
  previewClientToWorldPoint,
  previewTouchToWorldPoint,
  previewWorldUnitsPerCssPixel,
  visibleEndpointIndices,
  endpointHitRadiiPixels,
  round,
  strokeForPath,
  strokeWidthForPath,
  touchDistance,
  zoomViewBox,
  type PreviewDragState,
  type PreviewLastTapState,
  type PreviewPan,
  type PreviewTouchTapState
} from './editorPreviewHelpers';

interface EditorPreviewProps {
  canvasMouseMode?: CanvasMouseMode;
  constructionPreview?: EditorConstructionPreview | null;
  startPreview?: EditorStartPreview | null;
  previewLabel?: string;
  previewTitle?: string;
  program: LoadedEditorProgram | null;
  hoveredLine: number | null;
  hoveredPathElement?: EditorPathElementRef | null;
  keyboardShortcutsEnabled?: boolean;
  measurementPoints: MeasurementPoint[];
  measurement?: EditorMeasurementState;
  onCursorPointChange?: (point: { x: number; y: number } | null) => void;
  onMeasurementPointMove?: (pointId: string, point: { x: number; y: number }) => void;
  onPathEndpointClick?: (element: EditorPathElementRef) => void;
  onPathElementDrag?: (element: EditorPathElementRef, delta: { x: number; y: number }) => void;
  onPathElementClick?: (element: EditorPathElementRef) => void;
  onPathElementHover?: (element: EditorPathElementRef | null) => void;
  onPathSegmentCenterMove?: (element: EditorPathElementRef, targetCenter: { x: number; y: number }) => void;
  onPreviewPointClick?: (point: { x: number; y: number }) => void;
  onSetCanvasMouseMode?: (mode: CanvasMouseMode) => void;
  pathDocument?: PathPlanningDocument | null;
  pathEndpointActionOperationId?: string | null;
  pathCount?: number;
  pinnedLines: number[];
  selectedPathElement?: EditorPathElementRef | null;
  spatialActions?: readonly ExecutionSpatialAction[];
  selectedSpatialActionKey?: string | null;
  onSelectSpatialAction?: (key: string) => void;
  selectedLines: number[];
  snapToGrid?: boolean;
  snapGridSize?: number;
}

type CanvasMouseMode = 'select' | 'point';

interface SelectionMarqueeState {
  currentWorld: { x: number; y: number };
  moved: boolean;
  startWorld: { x: number; y: number };
}

interface SelectionMarqueeRect {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export interface EditorConstructionPreview {
  mode: MagnetizeMode;
  operationId: string;
  pathElementId?: string | null;
  relation: 'perpendicular' | 'tangent' | 'nearest-fallback';
  segmentId: string;
  sourcePoint: { x: number; y: number };
  targetPoint: { x: number; y: number };
}

export interface EditorStartPreview {
  operationId: string;
  pathElementId?: string | null;
  inferenceRelation: PathPointRelation;
  point: { x: number; y: number };
  pointRole?: 'start' | 'end' | null;
  relation: 'existing-point' | 'new-split-point';
  segmentId: string;
  sourcePoint?: { x: number; y: number };
}

export function EditorPreview({
  canvasMouseMode,
  constructionPreview,
  startPreview,
  program,
  hoveredLine,
  hoveredPathElement,
  keyboardShortcutsEnabled = true,
  measurementPoints,
  measurement,
  onCursorPointChange,
  onMeasurementPointMove,
  onPathEndpointClick,
  onPathElementDrag,
  onPathElementClick,
  onPathElementHover,
  onPathSegmentCenterMove,
  onPreviewPointClick,
  onSetCanvasMouseMode,
  pathDocument,
  pathEndpointActionOperationId,
  pathCount,
  previewLabel = 'G-code path preview',
  previewTitle = 'Preview',
  pinnedLines,
  selectedPathElement,
  spatialActions = [],
  selectedSpatialActionKey = null,
  onSelectSpatialAction,
  selectedLines,
  snapGridSize = PREVIEW_GRID_SIZE,
  snapToGrid = false
}: EditorPreviewProps) {
  const preview = useMemo(
    () =>
      pathDocument
        ? buildEditorPathDocumentPreviewGeometry(pathDocument, {
            padding: 1,
          })
        : program?.parseResult
          ? buildEditorPreviewGeometry(program.parseResult, { padding: 1 })
          : null,
    [pathDocument, program]
  );
  const selected = useMemo(() => new Set(selectedLines), [selectedLines]);
  const stopMarkers = useMemo(() => pathDocument && spatialActions.length === 0 ? programStopPreview(pathDocument) : [], [pathDocument, spatialActions]);
  const [expandedPauseGroup, setExpandedPauseGroup] = useState<string | null>(null);
  const pinned = useMemo(() => new Set(pinnedLines), [pinnedLines]);
  const [showGrid, setShowGrid] = useState(true);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const dragStateRef = useRef<PreviewDragState | null>(null);
  const lastTapRef = useRef<PreviewLastTapState | null>(null);
  const pointDragStateRef = useRef<{ pointId: string } | null>(null);
  const pathDragStateRef = useRef<{
    currentWorld: { x: number; y: number };
    element: EditorPathElementRef;
    moved: boolean;
    startWorld: { x: number; y: number };
  } | null>(null);
  const selectionMarqueeRef = useRef<SelectionMarqueeState | null>(null);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarqueeState | null>(null);
  const segmentCenterDragStateRef = useRef<{
    currentWorld: { x: number; y: number };
    element: EditorPathElementRef;
    moved: boolean;
    startWorld: { x: number; y: number };
  } | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const suppressClickRef = useRef(false);
  const [selectionFilter, setSelectionFilter] = useState<PreviewSelectionFilter>('all');
  const [overlapCandidates, setOverlapCandidates] = useState<EditorPreviewPath[]>([]);
  const touchTapRef = useRef<PreviewTouchTapState | null>(null);
  const pendingTouchPointClickTimeoutRef = useRef<number | null>(null);

  const fittedViewBox = preview
    ? fitViewBoxToViewportAspect(preview.viewBox, surfaceSize.width, surfaceSize.height)
    : null;
  const viewStateResetKey = fittedViewBox
    ? `${fittedViewBox.minX}:${fittedViewBox.minY}:${fittedViewBox.width}:${fittedViewBox.height}`
    : 'empty-preview';
  const [viewState, setViewState] = useState(() => initialPreviewViewState(viewStateResetKey));
  const activeViewState =
    viewState.resetKey === viewStateResetKey ? viewState : initialPreviewViewState(viewStateResetKey);
  const zoom = activeViewState.zoom;
  const pan = activeViewState.pan;
  const previewViewBox = fittedViewBox ? zoomViewBox(fittedViewBox, zoom, pan) : null;

  if (viewState.resetKey !== viewStateResetKey) {
    dragStateRef.current = null;
    setViewState(activeViewState);
  }

  useEffect(() => {
    return () => {
      if (pendingTouchPointClickTimeoutRef.current !== null) {
        window.clearTimeout(pendingTouchPointClickTimeoutRef.current);
      }
    };
  }, []);

  function setZoom(action: number | ((current: number) => number)) {
    setViewState((current) => ({
      ...current,
      zoom: typeof action === 'function' ? action(current.zoom) : action
    }));
  }

  function setPan(action: PreviewPan | ((current: PreviewPan) => PreviewPan)) {
    setViewState((current) => ({
      ...current,
      pan: typeof action === 'function' ? action(current.pan) : action
    }));
  }

  const setPreviewSvg = useCallback((svg: SVGSVGElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    svgRef.current = svg;
    if (!svg || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      if (width <= 0 || height <= 0) return;
      setSurfaceSize((current) =>
        Math.abs(current.width - width) <= 0.5 && Math.abs(current.height - height) <= 0.5
          ? current
          : { width, height }
      );
    });
    observer.observe(svg);
    resizeObserverRef.current = observer;
  }, []);

  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
    },
    []
  );

  useEffect(() => {
    const activeViewBox = previewViewBox;
    if (!keyboardShortcutsEnabled || !preview || !activeViewBox || preview.paths.length === 0) return;
    const shortcutViewBox: EditorPreviewViewBox = activeViewBox;

    function handlePreviewKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isInteractiveTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;
      const plainKey = !event.ctrlKey && !event.metaKey && !event.altKey;
      const panStepX = shortcutViewBox.width * 0.08;
      const panStepY = shortcutViewBox.height * 0.08;

      if (plainKey && key === 'g') {
        event.preventDefault();
        setShowGrid((current) => !current);
        return;
      }

      if (commandKey && (event.code === 'Equal' || key === '=' || key === '+')) {
        event.preventDefault();
        setZoom((current) => clampZoom(current * PREVIEW_ZOOM_STEP));
        return;
      }

      if (commandKey && (event.code === 'Minus' || key === '-')) {
        event.preventDefault();
        setZoom((current) => clampZoom(current / PREVIEW_ZOOM_STEP));
        return;
      }

      if (commandKey && (event.code === 'Digit0' || key === '0')) {
        event.preventDefault();
        handleFitPreview();
        return;
      }

      if (plainKey && (key === 'f' || key === 'r')) {
        event.preventDefault();
        handleFitPreview();
        return;
      }

      if (!plainKey) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPan((current) => ({ ...current, x: round(current.x - panStepX) }));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPan((current) => ({ ...current, x: round(current.x + panStepX) }));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPan((current) => ({ ...current, y: round(current.y - panStepY) }));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPan((current) => ({ ...current, y: round(current.y + panStepY) }));
      }
    }

    window.addEventListener('keydown', handlePreviewKeyDown);
    return () => window.removeEventListener('keydown', handlePreviewKeyDown);
  }, [
    preview,
    previewViewBox?.height,
    previewViewBox?.width,
    previewViewBox,
    preview?.paths.length,
    keyboardShortcutsEnabled
  ]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !preview || !previewViewBox || preview.paths.length === 0) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      const nextZoom = event.deltaY > 0
        ? zoom / PREVIEW_ZOOM_STEP
        : zoom * PREVIEW_ZOOM_STEP;
      const clampedZoom = clampZoom(nextZoom);
      const point = previewClientToWorldPoint(svg, event.clientX, event.clientY, previewViewBox, 0, { gridSize: 1, snapToGrid: false });
      if (point) {
        const ratio = 1 - zoom / clampedZoom;
        setPan((current) => ({
          x: current.x + (point.x - previewViewBox.minX - previewViewBox.width / 2) * ratio,
          y: current.y + (-point.y - previewViewBox.minY - previewViewBox.height / 2) * ratio
        }));
      }
      setZoom(clampedZoom);
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [preview, previewViewBox, zoom]);

  if (!preview || !previewViewBox || preview.paths.length === 0) {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center border border-border bg-background/70 font-mono text-[11px] text-muted-foreground"
        data-editor-empty-preview
      >
        No drawable toolpath loaded.
      </div>
    );
  }

  const activePreview = preview;
  const activeViewBox = previewViewBox;
  const viewBox = `${format(activeViewBox.minX)} ${format(activeViewBox.minY)} ${format(activeViewBox.width)} ${format(activeViewBox.height)}`;
  const flipY = activePreview.viewBox.minY * 2 + activePreview.viewBox.height;
  const worldPerPixel = previewWorldUnitsPerCssPixel(activeViewBox, surfaceSize);
  const grid = buildPreviewGrid(activeViewBox, flipY, worldPerPixel);
  const gridLabels = buildVisibleGridLabels(grid.lines, grid.labelSpacing, grid.bounds, worldPerPixel);
  const markerRadius = worldPerPixel * 3.5;
  const markerLabelFontSize = worldPerPixel * 10;
  const measurementLabelFontSize = worldPerPixel * 11;
  const highlightedPointRadius = worldPerPixel * 4;
  const highlightedPointLabelFontSize = worldPerPixel * 11;
  const gridLabelFontSize = worldPerPixel * 11;
  const gridLabelInset = worldPerPixel * 9;
  const zoomPercent = Math.round(zoom * 100);
  const pathEndpointHandles = readPathEndpointHandles(activePreview.paths, pathDocument);
  const visibleEndpoints = visibleEndpointIndices(pathEndpointHandles, worldPerPixel,
    (handle) => pathEndpointMatches(handle, handle.role, selectedPathElement) ||
      pathEndpointMatches(handle, handle.role, hoveredPathElement));
  const endpointHitRadii = endpointHitRadiiPixels(pathEndpointHandles, worldPerPixel);
  const selectedArcCenterHandles = readSelectedArcCenterHandles(activePreview.paths, selectedPathElement);
  const measurementFirst = measurement?.picks[0];
  const measurementSecond = measurement?.picks[1] ?? measurement?.hover;
  const measurementResult = measurementFirst && measurementSecond
    ? measurePointPair(measurementFirst.point, measurementSecond.point) : null;
  const measurementDisplayScale = worldPerPixel;
  const pauseGroups = new Map<string, ExecutionSpatialAction[]>();
  for (const action of spatialActions) {
    if (!action.pause) continue;
    const groupKey = `${action.point.x.toFixed(6)}:${action.point.y.toFixed(6)}`;
    const group = pauseGroups.get(groupKey) ?? [];
    group.push(action);
    pauseGroups.set(groupKey, group);
  }
  const measurementPickRadius = measurementDisplayScale * 4;
  const measurementTextSize = measurementDisplayScale * 11;
  const selectionEnabled = Boolean(pathDocument && onPathElementClick && canvasMouseMode === 'select' && !measurement);
  const currentOverlapIndex = overlapCandidates.findIndex((path) => pathElementMatches(path, selectedPathElement));
  const overlapSelection = currentOverlapIndex >= 0 ? overlapCandidates[currentOverlapIndex] : null;
  const overlapOperation = pathDocument?.plan.operations.find((operation) => operation.id === overlapSelection?.operationId);
  const overlapSegmentIndex = overlapOperation?.segmentRefs.findIndex((ref) => ref.segmentId === overlapSelection?.segmentId) ?? -1;

  function measurementScale(svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    return Math.max(activeViewBox.width / rect.width, activeViewBox.height / rect.height);
  }

  function handleMeasurementClick(event: MouseEvent<SVGSVGElement>) {
    if (selectionEnabled && !event.shiftKey && event.button === 0 && (event.altKey || selectionFilter !== 'all')) {
      event.stopPropagation();
      if (suppressClickRef.current) { suppressClickRef.current = false; return; }
      const point = previewEventToWorldPoint(event, activeViewBox, flipY, { gridSize: snapGridSize, snapToGrid: false });
      if (!point) return;
      const candidates = previewSelectionCandidates(activePreview.paths, point, measurementScale(event.currentTarget) * 6, selectionFilter);
      setOverlapCandidates(candidates);
      const selectedIndex = candidates.findIndex((path) => pathElementMatches(path, selectedPathElement));
      const picked = candidates.length > 0 ? candidates[event.altKey ? (selectedIndex + 1) % candidates.length : 0] : undefined;
      if (picked?.operationId) onPathElementClick?.({
        operationId: picked.operationId, pathElementId: picked.pathElementId ?? null,
        segmentId: picked.segmentId ?? null, machiningSpanId: picked.machiningSpanId
      });
      return;
    }
    if (selectionEnabled) setOverlapCandidates([]);
    if (!measurement || event.shiftKey || event.button !== 0) return;
    event.stopPropagation();
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    const point = previewEventToWorldPoint(event, activeViewBox, flipY, { gridSize: snapGridSize, snapToGrid: false });
    if (point) measurement.onPick(point, measurementScale(event.currentTarget));
  }

  function handlePreviewClick(event: MouseEvent<SVGSVGElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!onPreviewPointClick || event.shiftKey || dragStateRef.current) return;

    const point = previewEventToWorldPoint(event, activeViewBox, flipY, {
      gridSize: snapGridSize,
      snapToGrid
    });
    if (!point) return;

    onPreviewPointClick(point);
  }

  function handlePreviewMouseDown(event: MouseEvent<SVGSVGElement>) {
    if (
      event.button === 0 &&
      !event.shiftKey &&
      canvasMouseMode === 'select' &&
      onPathElementClick &&
      activePreview.paths.some((path) => path.source === 'path-document')
    ) {
      const point = previewEventToWorldPoint(event, activeViewBox, flipY, {
        gridSize: snapGridSize,
        snapToGrid: false
      });
      if (!point) return;

      event.preventDefault();
      const nextSelectionMarquee = {
        currentWorld: point,
        moved: false,
        startWorld: point
      };
      selectionMarqueeRef.current = nextSelectionMarquee;
      setSelectionMarquee(nextSelectionMarquee);
      return;
    }

    if (!(event.button === 1 || (event.button === 0 && event.shiftKey))) return;

    event.preventDefault();
    const nextDragState = {
      clientX: event.clientX,
      clientY: event.clientY,
      pan,
      viewBox: activeViewBox
    };
    dragStateRef.current = nextDragState;
  }

  function handlePreviewMouseMove(event: MouseEvent<SVGSVGElement>) {
    const segmentCenterDragState = segmentCenterDragStateRef.current;
    if (segmentCenterDragState) {
      event.preventDefault();
      const point = previewEventToWorldPoint(event, activeViewBox, flipY, {
        gridSize: snapGridSize,
        snapToGrid
      });
      if (point) {
        segmentCenterDragState.currentWorld = point;
        segmentCenterDragState.moved =
          segmentCenterDragState.moved ||
          Math.hypot(
            point.x - segmentCenterDragState.startWorld.x,
            point.y - segmentCenterDragState.startWorld.y
          ) > 1e-6;
        suppressClickRef.current = segmentCenterDragState.moved;
        onCursorPointChange?.(point);
      }
      return;
    }

    const pathDragState = pathDragStateRef.current;
    if (pathDragState) {
      event.preventDefault();
      const point = previewEventToWorldPoint(event, activeViewBox, flipY, {
        gridSize: snapGridSize,
        snapToGrid
      });
      if (point) {
        pathDragState.currentWorld = point;
        pathDragState.moved =
          pathDragState.moved ||
          Math.hypot(point.x - pathDragState.startWorld.x, point.y - pathDragState.startWorld.y) > 1e-6;
        suppressClickRef.current = pathDragState.moved;
        onCursorPointChange?.(point);
      }
      return;
    }

    const pointDragState = pointDragStateRef.current;
    if (pointDragState) {
      event.preventDefault();
      suppressClickRef.current = true;
      const point = previewEventToWorldPoint(event, activeViewBox, flipY, {
        gridSize: snapGridSize,
        snapToGrid
      });
      if (point) {
        onMeasurementPointMove?.(pointDragState.pointId, point);
        onCursorPointChange?.(point);
      }
      return;
    }

    const activeSelectionMarquee = selectionMarqueeRef.current;
    if (activeSelectionMarquee) {
      event.preventDefault();
      const point = previewEventToWorldPoint(event, activeViewBox, flipY, {
        gridSize: snapGridSize,
        snapToGrid: false
      });
      if (point) {
        const moved =
          activeSelectionMarquee.moved ||
          Math.hypot(point.x - activeSelectionMarquee.startWorld.x, point.y - activeSelectionMarquee.startWorld.y) >
            selectionMarqueeMoveThreshold(activeViewBox);
        const nextSelectionMarquee = {
          ...activeSelectionMarquee,
          currentWorld: point,
          moved
        };
        selectionMarqueeRef.current = nextSelectionMarquee;
        setSelectionMarquee(nextSelectionMarquee);
        suppressClickRef.current = moved;
        onCursorPointChange?.(point);
      }
      return;
    }

    const activeDragState = dragStateRef.current;
    if (!activeDragState) {
      onCursorPointChange?.(
        previewEventToWorldPoint(event, activeViewBox, flipY, {
          gridSize: snapGridSize,
          snapToGrid
        })
      );
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const scale = Math.min(rect.width / activeDragState.viewBox.width, rect.height / activeDragState.viewBox.height);
    if (!Number.isFinite(scale) || scale <= 0) return;

    const dx = (event.clientX - activeDragState.clientX) / scale;
    const dy = (event.clientY - activeDragState.clientY) / scale;

    setPan({
      x: round(activeDragState.pan.x - dx),
      y: round(activeDragState.pan.y - dy)
    });
    onCursorPointChange?.(
      previewEventToWorldPoint(event, activeViewBox, flipY, {
        gridSize: snapGridSize,
        snapToGrid
      })
    );
  }

  function handlePreviewMouseUp() {
    const activeSelectionMarquee = selectionMarqueeRef.current;
    if (activeSelectionMarquee) {
      selectionMarqueeRef.current = null;
      setSelectionMarquee(null);
      if (activeSelectionMarquee.moved) {
        const element = selectPathElementInMarquee(activePreview.paths, readSelectionMarqueeRect(activeSelectionMarquee), selectionEnabled ? selectionFilter : 'all');
        if (element) onPathElementClick?.(element);
        suppressClickRef.current = true;
      }
    }

    const segmentCenterDragState = segmentCenterDragStateRef.current;
    if (segmentCenterDragState) {
      segmentCenterDragStateRef.current = null;
      if (segmentCenterDragState.moved) {
        onPathSegmentCenterMove?.(segmentCenterDragState.element, segmentCenterDragState.currentWorld);
      }
    }
    const pathDragState = pathDragStateRef.current;
    if (pathDragState) {
      pathDragStateRef.current = null;
      if (pathDragState.moved) {
        onPathElementDrag?.(pathDragState.element, {
          x: round(pathDragState.currentWorld.x - pathDragState.startWorld.x),
          y: round(pathDragState.currentWorld.y - pathDragState.startWorld.y)
        });
      }
    }
    pointDragStateRef.current = null;
    dragStateRef.current = null;
  }

  function handlePreviewMouseLeave() {
    // Keep the last measurement preview stable while using its panel controls.
    onCursorPointChange?.(null);
    suppressClickRef.current = false;
    handlePreviewMouseUp();
  }

  function handlePreviewTouchStart(event: TouchEvent<SVGSVGElement>) {
    if (event.touches.length === 2) {
      event.preventDefault();
      const distance = touchDistance(event.touches[0], event.touches[1]);
      touchTapRef.current = {
        clientX: (event.touches[0].clientX + event.touches[1].clientX) / 2,
        clientY: (event.touches[0].clientY + event.touches[1].clientY) / 2,
        distance,
        mode: 'pan',
        pan,
        viewBox: activeViewBox,
        zoom
      };
      onCursorPointChange?.(null);
      return;
    }

    if (event.touches.length !== 1) {
      touchTapRef.current = null;
      return;
    }

    event.preventDefault();
    const touch = event.touches[0];
    touchTapRef.current = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      mode: 'tap',
      pan,
      viewBox: activeViewBox
    };
    onCursorPointChange?.(
      previewTouchToWorldPoint(touch, event.currentTarget, activeViewBox, flipY, {
        gridSize: snapGridSize,
        snapToGrid
      })
    );
  }

  function handlePreviewTouchMove(event: TouchEvent<SVGSVGElement>) {
    const state = touchTapRef.current;
    if (state?.distance && state.zoom && event.touches.length === 2) {
      event.preventDefault();
      const nextDistance = touchDistance(event.touches[0], event.touches[1]);
      if (Number.isFinite(nextDistance) && nextDistance > 0) {
        const nextZoom = clampZoom(state.zoom * (nextDistance / state.distance));
        const rect = event.currentTarget.getBoundingClientRect();
        const scale = Math.min(rect.width / state.viewBox.width, rect.height / state.viewBox.height);
        if (scale > 0) {
          const ratio = state.zoom / nextZoom;
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const clientX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
          const clientY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
          setPan({
            x: state.pan.x + ((state.clientX - centerX) - (clientX - centerX) * ratio) / scale,
            y: state.pan.y + ((state.clientY - centerY) - (clientY - centerY) * ratio) / scale
          });
        }
        setZoom(nextZoom);
      }
      onCursorPointChange?.(null);
      return;
    }

    if (!state || event.touches.length !== 1) return;

    event.preventDefault();
    const touch = event.touches[0];
    const distance = Math.hypot(touch.clientX - state.clientX, touch.clientY - state.clientY);
    if (distance > TOUCH_TAP_THRESHOLD || state.mode === 'pan') {
      state.mode = 'pan';
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const scale = Math.min(rect.width / state.viewBox.width, rect.height / state.viewBox.height);
        if (Number.isFinite(scale) && scale > 0) {
          setPan({
            x: round(state.pan.x - (touch.clientX - state.clientX) / scale),
            y: round(state.pan.y - (touch.clientY - state.clientY) / scale)
          });
        }
      }
      onCursorPointChange?.(null);
      return;
    }

    onCursorPointChange?.(
      previewTouchToWorldPoint(touch, event.currentTarget, activeViewBox, flipY, {
        gridSize: snapGridSize,
        snapToGrid
      })
    );
  }

  function handlePreviewTouchEnd(event: TouchEvent<SVGSVGElement>) {
    const state = touchTapRef.current;
    const touch = event.changedTouches[0];
    touchTapRef.current = null;
    onCursorPointChange?.(null);

    if (state?.mode === 'pan' && event.touches.length === 1) {
      touchTapRef.current = {
        clientX: event.touches[0].clientX,
        clientY: event.touches[0].clientY,
        mode: 'pan',
        pan,
        viewBox: activeViewBox
      };
    }

    if (!state || !touch || state.mode === 'pan') return;

    event.preventDefault();
    const distance = Math.hypot(touch.clientX - state.clientX, touch.clientY - state.clientY);
    if (distance > TOUCH_TAP_THRESHOLD) return;

    if (measurement) {
      const point = previewTouchToWorldPoint(touch, event.currentTarget, activeViewBox, flipY, { gridSize: snapGridSize, snapToGrid: false });
      if (point) measurement.onPick(point, measurementScale(event.currentTarget));
      return;
    }

    const now = Date.now();
    const previousTap = lastTapRef.current;
    if (
      previousTap &&
      now - previousTap.time <= TOUCH_DOUBLE_TAP_TIMEOUT_MS &&
      Math.hypot(touch.clientX - previousTap.clientX, touch.clientY - previousTap.clientY) <=
        TOUCH_TAP_THRESHOLD
    ) {
      if (pendingTouchPointClickTimeoutRef.current !== null) {
        window.clearTimeout(pendingTouchPointClickTimeoutRef.current);
        pendingTouchPointClickTimeoutRef.current = null;
      }
      lastTapRef.current = null;
      handleFitPreview();
      return;
    }
    const point = previewTouchToWorldPoint(touch, event.currentTarget, activeViewBox, flipY, {
      gridSize: snapGridSize,
      snapToGrid
    });
    lastTapRef.current = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      time: now
    };
    if (selectionEnabled) {
      const exactPoint = previewTouchToWorldPoint(touch, event.currentTarget, activeViewBox, flipY, { gridSize: snapGridSize, snapToGrid: false });
      const candidates = exactPoint ? previewSelectionCandidates(activePreview.paths, exactPoint, measurementScale(event.currentTarget) * 6, selectionFilter) : [];
      const picked = candidates[0];
      if (picked?.operationId) {
        const element = { operationId: picked.operationId, pathElementId: picked.pathElementId ?? null,
          segmentId: picked.segmentId ?? null, machiningSpanId: picked.machiningSpanId };
        pendingTouchPointClickTimeoutRef.current = window.setTimeout(() => {
          pendingTouchPointClickTimeoutRef.current = null;
          setOverlapCandidates(candidates);
          onPathElementClick?.(element);
        }, TOUCH_DOUBLE_TAP_TIMEOUT_MS);
      }
      return;
    }
    if (!point || !onPreviewPointClick) return;

    pendingTouchPointClickTimeoutRef.current = window.setTimeout(() => {
      pendingTouchPointClickTimeoutRef.current = null;
      onPreviewPointClick(point);
    }, TOUCH_DOUBLE_TAP_TIMEOUT_MS);
  }

  function handlePreviewTouchCancel() {
    touchTapRef.current = null;
    onCursorPointChange?.(null);
  }

  function handleFitPreview() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    dragStateRef.current = null;
    selectionMarqueeRef.current = null;
    setSelectionMarquee(null);
    segmentCenterDragStateRef.current = null;
  }

  function handleMeasurementPointMouseDown(pointId: string, event: MouseEvent<SVGCircleElement>) {
    if (event.button !== 0 || !onMeasurementPointMove) return;

    event.preventDefault();
    event.stopPropagation();
    pointDragStateRef.current = { pointId };
    suppressClickRef.current = true;
  }

  function beginPathElementDrag(element: EditorPathElementRef, event: MouseEvent<SVGPathElement>) {
    if (event.button !== 0 || !onPathElementDrag || event.shiftKey) return;
    const svg = svgRef.current;
    if (!svg) return;

    const point = previewClientToWorldPoint(svg, event.clientX, event.clientY, activeViewBox, flipY, {
      gridSize: snapGridSize,
      snapToGrid
    });
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();
    pathDragStateRef.current = {
      currentWorld: point,
      element,
      moved: false,
      startWorld: point
    };
  }

  function beginPathSegmentCenterDrag(element: EditorPathElementRef, event: MouseEvent<SVGCircleElement>) {
    if (event.button !== 0 || !onPathSegmentCenterMove || event.shiftKey) return;
    const svg = svgRef.current;
    if (!svg) return;

    const point = previewClientToWorldPoint(svg, event.clientX, event.clientY, activeViewBox, flipY, {
      gridSize: snapGridSize,
      snapToGrid
    });
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();
    segmentCenterDragStateRef.current = {
      currentWorld: point,
      element,
      moved: false,
      startWorld: point
    };
  }

  return (
    <div className={`relative grid h-full min-h-[220px] bg-background/70 ${pathDocument ? 'grid-rows-[auto_auto_minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]'}`}>
      <div
        className="flex h-7 items-center justify-between gap-2 border-b border-border bg-card/70 px-2 font-mono text-[10px] text-muted-foreground"
        data-editor-preview-header
      >
        <div className="flex min-w-0 items-center gap-3">
          <h3
            className="font-mono text-[11px] font-semibold text-foreground"
            data-editor-preview-title
          >
            {previewTitle}
          </h3>
          {typeof pathCount === 'number' && (
            <span>
              {pathCount} {pathCount === 1 ? 'path item' : 'path items'}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1">
          {canvasMouseMode && onSetCanvasMouseMode && (
            <div
              className="mr-1 flex items-center gap-0.5 border-r border-border pr-1"
              data-editor-preview-mouse-mode-toolbar
            >
              <button
                aria-label="Select geometry on canvas"
                aria-pressed={canvasMouseMode === 'select'}
                className={`flex size-5 items-center justify-center border text-muted-foreground outline-none transition hover:bg-accent ${
                  canvasMouseMode === 'select'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border'
                }`}
                data-editor-preview-mouse-mode-select
                onClick={() => onSetCanvasMouseMode('select')}
                title="Select geometry"
                type="button"
              >
                <MousePointer2 className="size-3" />
              </button>
              <button
                aria-label="Place measurement points on canvas"
                aria-pressed={canvasMouseMode === 'point'}
                className={`flex size-5 items-center justify-center border text-muted-foreground outline-none transition hover:bg-accent ${
                  canvasMouseMode === 'point'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border'
                }`}
                data-editor-preview-mouse-mode-point
                onClick={() => onSetCanvasMouseMode('point')}
                title="Place measurement points"
                type="button"
              >
                <Magnet className="size-3" />
              </button>
            </div>
          )}
          <Button
            aria-label="Zoom preview out"
            disabled={zoom <= MIN_PREVIEW_ZOOM}
            onClick={() => setZoom((current) => clampZoom(current / PREVIEW_ZOOM_STEP))}
            size="icon"
            title="Zoom out"
            type="button"
            variant="ghost"
          >
            <ZoomOut />
          </Button>
          <span className="min-w-10 text-center" title="Preview zoom">
            {zoomPercent}%
          </span>
          <Button
            aria-label="Zoom preview in"
            disabled={zoom >= MAX_PREVIEW_ZOOM}
            onClick={() => setZoom((current) => clampZoom(current * PREVIEW_ZOOM_STEP))}
            size="icon"
            title="Zoom in"
            type="button"
            variant="ghost"
          >
            <ZoomIn />
          </Button>
          <Button
            aria-label="Fit preview to screen"
            disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
            onClick={handleFitPreview}
            size="icon"
            title="Fit to screen"
            type="button"
            variant="ghost"
          >
            <Maximize2 />
          </Button>
        </div>
      </div>
      {pathDocument && <div className="flex h-7 min-w-0 items-center gap-3 overflow-hidden border-b border-border px-2 text-[10px] text-muted-foreground" data-preview-selection-tools>
        {selectionEnabled ? <>
        <label className="flex items-center gap-1">Pick
          <select aria-label="Canvas selection filter" className="h-5 border border-border bg-background px-1 text-foreground" value={selectionFilter}
            onChange={(event) => {
              const filter = PREVIEW_SELECTION_FILTERS.find((candidate) => candidate.value === event.target.value);
              if (filter) { setSelectionFilter(filter.value); setOverlapCandidates([]); }
            }}>
            {PREVIEW_SELECTION_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </select>
        </label>
        <span className="truncate" title="Alt-click cycles overlaps. Drag selects one contour or segment. Use Geometry for exact selection.">Alt-click cycles overlaps. Drag selects one contour or segment. Use Geometry for exact selection.</span>
        </> : <span className="truncate">{measurement ? 'Measure source points and the gap between picked edges.' : 'Follow the active tool instructions. Shift-drag pans the canvas.'}</span>}
      </div>}
      {selectionEnabled && overlapCandidates.length > 1 && <div className="pointer-events-none absolute bottom-2 left-2 z-10 border border-border bg-background/90 px-2 py-1 text-[10px] text-cyan-200" role="status" data-preview-overlap-selection>
          {currentOverlapIndex >= 0 ? `${currentOverlapIndex + 1}/${overlapCandidates.length} · ${overlapOperation?.displayName ?? 'Source geometry'} · Segment ${overlapSegmentIndex + 1}` : `${overlapCandidates.length} overlapping edges`}
      </div>}
      <svg
        ref={setPreviewSvg}
        aria-label={previewLabel}
        data-preview-model={pathDocument ? 'upid' : 'gcode'}
        className="h-full min-h-0 w-full"
        onContextMenu={(event) => event.preventDefault()}
        onClick={handlePreviewClick}
        onClickCapture={handleMeasurementClick}
        onMouseDownCapture={(event) => {
          if (measurement && !event.shiftKey && event.button === 0) event.stopPropagation();
          if (!selectionEnabled || event.shiftKey || event.button !== 0) return;
          if (event.altKey) { event.preventDefault(); event.stopPropagation(); return; }
          if (selectionFilter !== 'all' && event.target instanceof Element) {
            const targetPath = event.target.closest('path[data-line]');
            const path = targetPath ? activePreview.paths.find((candidate) => candidate.line === Number(targetPath.getAttribute('data-line'))) : null;
            if (path && !matchesPreviewSelectionFilter(path, selectionFilter)) event.stopPropagation();
            if (!path) {
              const targetSegment = event.target.closest('[data-preview-segment]')?.getAttribute('data-preview-segment');
              const point = previewEventToWorldPoint(event, activeViewBox, flipY, { gridSize: snapGridSize, snapToGrid: false });
              if (targetSegment && point && !previewSelectionCandidates(activePreview.paths, point, measurementScale(event.currentTarget) * 6, selectionFilter)
                .some((candidate) => candidate.segmentId === targetSegment)) event.stopPropagation();
            }
          }
        }}
        onMouseMoveCapture={(event) => {
          if (!measurement) return;
          const point = previewEventToWorldPoint(event, activeViewBox, flipY, { gridSize: snapGridSize, snapToGrid: false });
          measurement.onHover(point, measurementScale(event.currentTarget));
        }}
        onMouseDown={handlePreviewMouseDown}
        onMouseLeave={handlePreviewMouseLeave}
        onMouseMove={handlePreviewMouseMove}
        onMouseUp={handlePreviewMouseUp}
        onTouchCancel={handlePreviewTouchCancel}
        onTouchEnd={handlePreviewTouchEnd}
        onTouchMove={handlePreviewTouchMove}
        onTouchStart={handlePreviewTouchStart}
        preserveAspectRatio="xMidYMid meet"
        style={{ touchAction: 'none' }}
        viewBox={viewBox}
      >
        {showGrid && (
          <>
            <g data-preview-grid-layer="true" transform={`matrix(1 0 0 -1 0 ${flipY})`}>
              {grid.lines.map((line) => (
                <line
                  data-preview-grid={line.variant}
                  data-preview-grid-orientation={line.orientation}
                  key={`${line.orientation}-${line.variant}-${format(line.value)}`}
                  stroke={line.variant === 'major' ? '#334155' : '#1f2937'}
                  strokeOpacity={line.variant === 'major' ? 0.78 : 0.62}
                  strokeWidth={line.variant === 'major' ? '0.55' : '0.35'}
                  vectorEffect="non-scaling-stroke"
                  x1={line.orientation === 'vertical' ? line.value : grid.bounds.minX}
                  x2={line.orientation === 'vertical' ? line.value : grid.bounds.maxX}
                  y1={line.orientation === 'vertical' ? grid.bounds.minY : line.value}
                  y2={line.orientation === 'vertical' ? grid.bounds.maxY : line.value}
                />
              ))}
              {grid.axes.map((axis) => (
                <line
                  data-preview-axis={axis.axis}
                  key={`axis-${axis.axis}`}
                  stroke="#64748b"
                  strokeOpacity="0.9"
                  strokeWidth="0.75"
                  vectorEffect="non-scaling-stroke"
                  x1={axis.orientation === 'vertical' ? axis.value : grid.bounds.minX}
                  x2={axis.orientation === 'vertical' ? axis.value : grid.bounds.maxX}
                  y1={axis.orientation === 'vertical' ? grid.bounds.minY : axis.value}
                  y2={axis.orientation === 'vertical' ? grid.bounds.maxY : axis.value}
                />
              ))}
            </g>
            <g data-preview-grid-label-layer="true" pointerEvents="none">
              {gridLabels.vertical.map((line) => (
                <text
                  data-preview-grid-label="x"
                  fill="#64748b"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize={gridLabelFontSize}
                  key={`x-label-${format(line.value)}`}
                  paintOrder="stroke"
                  stroke="#020617"
                  strokeWidth={gridLabelFontSize * 0.22}
                  x={line.value + gridLabelFontSize * 0.35}
                  y={activeViewBox.minY + activeViewBox.height - gridLabelInset}
                >
                  {format(line.value)}
                </text>
              ))}
              {gridLabels.horizontal.map((line) => (
                <text
                  data-preview-grid-label="y"
                  fill="#64748b"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize={gridLabelFontSize}
                  key={`y-label-${format(line.value)}`}
                  paintOrder="stroke"
                  stroke="#020617"
                  strokeWidth={gridLabelFontSize * 0.22}
                  x={activeViewBox.minX + gridLabelInset}
                  y={flipY - line.value - gridLabelFontSize * 0.35}
                >
                  {format(line.value)}
                </text>
              ))}
            </g>
          </>
        )}
        {selectionMarquee && (
          <rect
            data-preview-selection-marquee
            fill="#38bdf8"
            fillOpacity="0.12"
            pointerEvents="none"
            stroke="#67e8f9"
            strokeDasharray="0.5 0.32"
            strokeOpacity="0.9"
            strokeWidth="0.75"
            vectorEffect="non-scaling-stroke"
            {...selectionMarqueeSvgRect(selectionMarquee, flipY)}
          />
        )}
        <g transform={`matrix(1 0 0 -1 0 ${flipY})`}>
          {activePreview.paths.map((path, index) => {
            const pathElementHovered = pathElementMatches(path, hoveredPathElement);
            const pathElementSelected = pathElementMatches(path, selectedPathElement);
            const highlight = pathElementHovered
              ? 'hover'
              : pathElementSelected
                ? 'selected'
                : highlightForLine(path.line, {
                    hoveredLine,
                    pinned,
                    selected
                  });
            const isPinned = pinned.has(path.line);

            return (
              <path
                d={path.d}
                data-highlight={highlight}
                data-line={path.line}
                data-pinned={isPinned ? 'true' : undefined}
                data-preview-hovered={pathElementHovered ? 'true' : undefined}
                data-preview-operation={path.operationId}
                data-preview-path-element-id={path.pathElementId}
                data-preview-participation={path.participation}
                data-preview-selected={pathElementSelected ? 'true' : undefined}
                data-preview-segment={path.segmentId}
                data-preview-source={path.source}
                data-preview-travel={path.travelRole}
                data-preview-travel-source={path.travelSource}
                aria-label={path.travelRole
                  ? `${path.travelSource ?? 'planned'} ${path.travelRole} for ${path.operationId ?? 'path'}`
                  : undefined}
                role={path.travelRole ? 'img' : undefined}
                data-type={path.type}
                fill="none"
                key={`${path.type}-${path.line}-${index}`}
                className={pathElementSelected && path.type !== 'rapid' ? 'cursor-move' : undefined}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    event.stopPropagation();
                    return;
                  }
                  if (path.source !== 'path-document' || !path.operationId || !onPathElementClick) return;
                  event.stopPropagation();
                  onPathElementClick({
                    operationId: path.operationId,
                    pathElementId: path.pathElementId ?? null,
                    segmentId: path.segmentId ?? null,
                    machiningSpanId: path.machiningSpanId,
                    travelRole: path.travelRole ?? null
                  });
                }}
                onMouseEnter={() => {
                  if (path.source !== 'path-document' || !path.operationId) return;
                  onPathElementHover?.({
                    operationId: path.operationId,
                    pathElementId: path.pathElementId ?? null,
                    segmentId: path.segmentId ?? null,
                    machiningSpanId: path.machiningSpanId,
                    travelRole: path.travelRole ?? null
                  });
                }}
                onMouseLeave={() => onPathElementHover?.(null)}
                onMouseDown={(event) => {
                  if (path.source !== 'path-document' || !path.operationId || path.type === 'rapid') return;
                  beginPathElementDrag(
                    {
                      operationId: path.operationId,
                      pathElementId: path.pathElementId ?? null,
                      segmentId: path.segmentId ?? null,
                      machiningSpanId: path.machiningSpanId,
                      travelRole: path.travelRole ?? null
                    },
                    event
                  );
                }}
                stroke={path.participation === 'inactive-reference' && !highlight
                  ? '#64748b'
                  : strokeForPath(path.type, highlight, isPinned)}
                strokeDasharray={path.participation === 'inactive-reference'
                  ? '0.8 0.5'
                  : path.type === 'rapid'
                  ? '0.4 0.4'
                  : undefined}
                strokeOpacity={path.participation === 'inactive-reference' ? 0.72 : undefined}
                strokeLinecap="round"
                strokeWidth={strokeWidthForPath(path.type, highlight, isPinned)}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
        <g>
          {pathEndpointHandles.map((handle, handleIndex) => {
            const highlight = pathEndpointMatches(handle, handle.role, selectedPathElement)
              ? 'selected'
              : pathEndpointMatches(handle, handle.role, hoveredPathElement)
                ? 'hover'
                : undefined;
            const color = highlight ? highlightColor(highlight) : '#67e8f9';
            const svgY = flipY - handle.point.y;
            const endpointActionable = Boolean(
              onPathEndpointClick &&
              (
                pathEndpointActionOperationId == null ||
                handle.operationId === pathEndpointActionOperationId
              )
            );
            const element: EditorPathElementRef = {
              operationId: handle.operationId,
              pathElementId: handle.pathElementId ?? null,
              pointRole: handle.role,
              segmentId: handle.segmentId
            };

            const visible = visibleEndpoints.has(handleIndex);
            return (
              <g key={`endpoint-${handle.operationId}-${handle.pathElementId ?? ''}-${handle.segmentId}-${handle.role}`}>
              <circle
                aria-disabled={onPathEndpointClick && !endpointActionable ? true : undefined}
                className={onPathElementClick || endpointActionable ? 'cursor-pointer' : undefined}
                cx={handle.point.x}
                cy={svgY}
                data-preview-hovered={highlight === 'hover' ? 'true' : undefined}
                data-preview-operation={handle.operationId}
                data-preview-path-element-id={handle.pathElementId}
                data-preview-path-endpoint
                data-preview-point-role={handle.role}
                data-preview-selected={highlight === 'selected' ? 'true' : undefined}
                data-preview-segment={handle.segmentId}
                fill="transparent"
                onClick={(event) => {
                  if (onPathEndpointClick) {
                    event.stopPropagation();
                    if (endpointActionable) onPathEndpointClick(element);
                    return;
                  }
                  if (!onPathElementClick) return;
                  event.stopPropagation();
                  onPathElementClick(element);
                }}
                onMouseEnter={() => onPathElementHover?.(element)}
                onMouseLeave={() => onPathElementHover?.(null)}
                r={worldPerPixel * (visible ? endpointHitRadii[handleIndex] : 2.5)}
              />
              {visible && <circle
                cx={handle.point.x} cy={svgY} pointerEvents="none"
                data-preview-visible-endpoint={handle.role}
                fill={highlight ? color : 'none'}
                r={worldPerPixel * (highlight === 'selected' ? 4 : highlight === 'hover' ? 3.5 : 2)}
                stroke={color} strokeOpacity={highlight ? 1 : 0.72}
                strokeWidth={highlight ? worldPerPixel * 1.3 : worldPerPixel * 0.9}
              />}
              </g>
            );
          })}
          {selectedArcCenterHandles.map((handle) => {
            const svgY = flipY - handle.center.y;
            const element = {
              operationId: handle.operationId,
              pathElementId: handle.pathElementId ?? null,
              pointRole: 'center' as const,
              segmentId: handle.segmentId
            };

            return (
              <g
                data-preview-arc-center-group
                data-preview-operation={handle.operationId}
                data-preview-path-element-id={handle.pathElementId}
                data-preview-segment={handle.segmentId}
                key={`arc-center-${handle.operationId}-${handle.segmentId}`}
              >
                <line
                  data-preview-arc-center-crosshair="horizontal"
                  pointerEvents="none"
                  stroke="#fbbf24"
                  strokeOpacity="0.72"
                  strokeWidth={highlightedPointRadius * 0.2}
                  vectorEffect="non-scaling-stroke"
                  x1={handle.center.x - highlightedPointRadius * 1.65}
                  x2={handle.center.x + highlightedPointRadius * 1.65}
                  y1={svgY}
                  y2={svgY}
                />
                <line
                  data-preview-arc-center-crosshair="vertical"
                  pointerEvents="none"
                  stroke="#fbbf24"
                  strokeOpacity="0.72"
                  strokeWidth={highlightedPointRadius * 0.2}
                  vectorEffect="non-scaling-stroke"
                  x1={handle.center.x}
                  x2={handle.center.x}
                  y1={svgY - highlightedPointRadius * 1.65}
                  y2={svgY + highlightedPointRadius * 1.65}
                />
                <circle
                  aria-label="Drag selected arc center"
                  className={onPathSegmentCenterMove ? 'cursor-grab active:cursor-grabbing' : undefined}
                  cx={handle.center.x}
                  cy={svgY}
                  data-preview-arc-center={formatPreviewPoint(handle.center)}
                  data-preview-arc-center-handle
                  data-preview-operation={handle.operationId}
                  data-preview-path-element-id={handle.pathElementId}
                  data-preview-point-role="center"
                  data-preview-selected="true"
                  data-preview-segment={handle.segmentId}
                  fill="#f59e0b"
                  fillOpacity="0.95"
                  onClick={(event) => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      event.stopPropagation();
                      return;
                    }
                    if (!onPathElementClick) return;
                    event.stopPropagation();
                    onPathElementClick(element);
                  }}
                  onMouseDown={(event) => beginPathSegmentCenterDrag(element, event)}
                  onMouseEnter={() => onPathElementHover?.(element)}
                  onMouseLeave={() => onPathElementHover?.(null)}
                  r={highlightedPointRadius * 0.78}
                  stroke="#020617"
                  strokeWidth={highlightedPointRadius * 0.3}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={handle.center.x}
                  cy={svgY}
                  fill="none"
                  pointerEvents="none"
                  r={highlightedPointRadius * 1.95}
                  stroke="#fbbf24"
                  strokeOpacity="0.58"
                  strokeWidth={highlightedPointRadius * 0.22}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  data-preview-arc-center-label
                  dx={highlightedPointRadius * 1.45}
                  dy={-highlightedPointRadius}
                  fill="#fde68a"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize={measurementLabelFontSize}
                  fontWeight="700"
                  paintOrder="stroke"
                  pointerEvents="none"
                  stroke="#020617"
                  strokeWidth={measurementLabelFontSize * 0.22}
                  x={handle.center.x}
                  y={svgY}
                >
                  CENTER
                </text>
              </g>
            );
          })}
          {activePreview.paths.map((path) => {
            const highlight = pathElementMatches(path, hoveredPathElement)
              ? 'hover'
              : pathElementMatches(path, selectedPathElement)
                ? 'selected'
                : highlightForLine(path.line, {
                    hoveredLine,
                    pinned,
                    selected
                  });
            if (!highlight) return null;

            const svgY = flipY - path.end.y;
            const color = highlightColor(highlight);

            return (
              <g data-preview-path-point={path.line} key={`point-${path.line}-${highlight}`}>
                <circle
                  cx={path.end.x}
                  cy={svgY}
                  data-line={path.line}
                  data-preview-path-point-highlight={highlight}
                  fill={color}
                  fillOpacity="0.92"
                  r={highlightedPointRadius}
                  stroke="#020617"
                  strokeWidth={highlightedPointRadius * 0.35}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={path.end.x}
                  cy={svgY}
                  fill="none"
                  r={highlightedPointRadius * 1.75}
                  stroke={color}
                  strokeOpacity="0.55"
                  strokeWidth={highlightedPointRadius * 0.24}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  data-line={path.line}
                  data-preview-path-point-label={highlight}
                  dx={highlightedPointRadius * 1.7}
                  dy={-highlightedPointRadius * 1.2}
                  fill={color}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize={highlightedPointLabelFontSize}
                  fontWeight="700"
                  paintOrder="stroke"
                  stroke="#020617"
                  strokeWidth={highlightedPointLabelFontSize * 0.22}
                  x={path.end.x}
                  y={svgY}
                >
                  L{path.line}
                </text>
              </g>
            );
          })}
          {activePreview.markers.map((marker) => {
            const svgY = flipY - marker.y;
            const radius = marker.type === 'start' ? markerRadius * 1.25 : markerRadius;

            return (
              <g data-path-marker={marker.type} key={marker.type} pointerEvents="none">
                <circle
                  cx={marker.x}
                  cy={svgY}
                  fill={marker.type === 'start' ? '#ef4444' : '#41cfcf'}
                  r={radius}
                  stroke="#020617"
                  strokeWidth={radius * 0.32}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  data-path-marker-label={marker.type}
                  dx={radius * 1.45}
                  dy={marker.type === 'start' ? -radius * 1.5 : -radius}
                  fill={marker.type === 'start' ? '#fecaca' : '#a5f3fc'}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize={markerLabelFontSize}
                  fontWeight="700"
                  x={marker.x}
                  y={svgY}
                >
                  {marker.label}
                </text>
              </g>
            );
          })}
          {constructionPreview && (
            <g
              data-upid-construction-mode={constructionPreview.mode}
              data-upid-construction-operation={constructionPreview.operationId}
              data-upid-construction-path-element-id={constructionPreview.pathElementId}
              data-upid-construction-preview
              data-upid-construction-relation={constructionPreview.relation}
              data-upid-construction-segment={constructionPreview.segmentId}
              pointerEvents="none"
            >
              <line
                data-upid-construction-line
                stroke="#22d3ee"
                strokeDasharray="0.45 0.28"
                strokeOpacity="0.88"
                strokeWidth={markerRadius * 0.42}
                vectorEffect="non-scaling-stroke"
                x1={constructionPreview.sourcePoint.x}
                x2={constructionPreview.targetPoint.x}
                y1={flipY - constructionPreview.sourcePoint.y}
                y2={flipY - constructionPreview.targetPoint.y}
              />
              <circle
                cx={constructionPreview.targetPoint.x}
                cy={flipY - constructionPreview.targetPoint.y}
                data-upid-construction-point
                fill="#22d3ee"
                fillOpacity="0.92"
                r={markerRadius * 1.05}
                stroke="#020617"
                strokeWidth={markerRadius * 0.3}
                vectorEffect="non-scaling-stroke"
              />
              <text
                data-upid-construction-label
                dx={markerRadius * 1.35}
                dy={-markerRadius}
                fill="#a5f3fc"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontSize={measurementLabelFontSize}
                fontWeight="700"
                paintOrder="stroke"
                stroke="#020617"
                strokeWidth={measurementLabelFontSize * 0.22}
                x={constructionPreview.targetPoint.x}
                y={flipY - constructionPreview.targetPoint.y}
              >
                {constructionPreview.mode === 'perpendicular' ? 'PERP' : 'TAN'}
              </text>
            </g>
          )}
          {startPreview && (
            <g
              data-upid-start-operation={startPreview.operationId}
              data-upid-start-path-element-id={startPreview.pathElementId}
              data-upid-start-point-role={startPreview.pointRole ?? undefined}
              data-upid-start-preview
              data-upid-start-inference={startPreview.inferenceRelation}
              data-upid-start-relation={startPreview.relation}
              data-upid-start-segment={startPreview.segmentId}
              pointerEvents="none"
            >
              {startPreview.sourcePoint && (
                <>
                  <line
                    data-upid-start-inference-guide-shadow
                    stroke="#020617"
                    strokeOpacity="0.9"
                    strokeWidth={5}
                    vectorEffect="non-scaling-stroke"
                    x1={startPreview.sourcePoint.x}
                    x2={startPreview.point.x}
                    y1={flipY - startPreview.sourcePoint.y}
                    y2={flipY - startPreview.point.y}
                  />
                  <line
                    data-upid-start-inference-guide
                    stroke="#67e8f9"
                    strokeDasharray="6 4"
                    strokeOpacity="1"
                    strokeWidth={2.5}
                    vectorEffect="non-scaling-stroke"
                    x1={startPreview.sourcePoint.x}
                    x2={startPreview.point.x}
                    y1={flipY - startPreview.sourcePoint.y}
                    y2={flipY - startPreview.point.y}
                  />
                </>
              )}
              <circle
                cx={startPreview.point.x}
                cy={flipY - startPreview.point.y}
                data-upid-start-preview-point
                fill={startPreview.relation === 'existing-point' ? '#f59e0b' : '#22d3ee'}
                fillOpacity="0.92"
                r={markerRadius * 1.15}
                stroke="#020617"
                strokeWidth={markerRadius * 0.34}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={startPreview.point.x}
                cy={flipY - startPreview.point.y}
                fill="none"
                r={markerRadius * 1.95}
                stroke={startPreview.relation === 'existing-point' ? '#fbbf24' : '#67e8f9'}
                strokeDasharray={startPreview.relation === 'existing-point' ? undefined : '0.38 0.26'}
                strokeOpacity="0.78"
                strokeWidth={markerRadius * 0.24}
                vectorEffect="non-scaling-stroke"
              />
              <text
                data-upid-start-preview-label
                dx={markerRadius * 1.45}
                dy={-markerRadius * 1.1}
                fill={startPreview.relation === 'existing-point' ? '#fde68a' : '#a5f3fc'}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontSize={measurementLabelFontSize}
                fontWeight="700"
                paintOrder="stroke"
                stroke="#020617"
                strokeWidth={measurementLabelFontSize * 0.22}
                x={startPreview.point.x}
                y={flipY - startPreview.point.y}
              >
                {startPreview.inferenceRelation.replace('-', ' ').toUpperCase()}
              </text>
            </g>
          )}
          {measurementPoints.map((point, index) => {
            const svgY = flipY - point.y;

            return (
              <g data-measurement-point={index + 1} key={point.id}>
                <circle
                  cx={point.x}
                  cy={svgY}
                  className={onMeasurementPointMove ? 'cursor-grab active:cursor-grabbing' : undefined}
                  data-measurement-point-handle={index + 1}
                  fill="#38bdf8"
                  onMouseDown={(event) => handleMeasurementPointMouseDown(point.id, event)}
                  r={markerRadius}
                  stroke="#020617"
                  strokeWidth={markerRadius * 0.35}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  data-measurement-point-label={index + 1}
                  dx={markerRadius * 1.4}
                  dy={-markerRadius * 1.4}
                  fill="#bae6fd"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize={measurementLabelFontSize}
                  x={point.x}
                  y={svgY}
                >
                  P{index + 1}
                </text>
              </g>
            );
          })}
          <g pointerEvents="none" data-preview-program-stops>
            {stopMarkers.map((stop) => <g key={`${stop.operationId}:${stop.stopId}`}>
              <circle cx={stop.point.x} cy={flipY - stop.point.y} r={measurementDisplayScale * 6}
                fill="#020617" stroke="#fbbf24" strokeWidth="2" vectorEffect="non-scaling-stroke"
                data-preview-program-stop={stop.stopId} data-stop-operation={stop.operationId} />
              <text x={stop.point.x} y={flipY - stop.point.y} dy="0.35em" textAnchor="middle"
                fill="#fbbf24" fontSize={measurementDisplayScale * 9} fontWeight="bold">Ⅱ</text>
              <text x={stop.point.x + measurementDisplayScale * 9} y={flipY - stop.point.y + measurementDisplayScale * 14}
                fill="#fde68a" fontSize={measurementTextSize} paintOrder="stroke" stroke="#020617"
                strokeWidth={measurementTextSize * 0.25}>STOP</text>
            </g>)}
          </g>
          <g data-preview-spatial-actions>
            {spatialActions.filter((action) => !action.pause &&
              (action.eventKind === 'position' || action.eventKind === 'wire-thread')).map((action) => (
              <g key={action.key} className="cursor-pointer" onClick={(event) => {
                event.stopPropagation(); onSelectSpatialAction?.(action.key);
              }}>
                <circle cx={action.point.x} cy={flipY - action.point.y}
                  r={measurementDisplayScale * 8} fill="transparent" data-preview-action-hit={action.key} />
                <circle cx={action.point.x} cy={flipY - action.point.y}
                  r={measurementDisplayScale * 3.5} fill="#020617" stroke="#67e8f9"
                  strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none"
                  data-preview-spatial-action={action.key} />
              </g>
            ))}
            {[...pauseGroups.entries()].map(([groupKey, group]) => {
              const point = group[0].point;
              const selected = group.some((action) => action.key === selectedSpatialActionKey);
              const generated = group.some((action) => action.pause === 'generated-manual-thread');
              const color = generated ? '#fb7185' : '#fbbf24';
              const expanded = expandedPauseGroup === groupKey;
              return <g key={groupKey} data-preview-pause-group={groupKey}>
                <g className="cursor-pointer" onClick={(event) => {
                  event.stopPropagation();
                  if (group.length === 1) onSelectSpatialAction?.(group[0].key);
                  else setExpandedPauseGroup(expanded ? null : groupKey);
                }}>
                  <circle cx={point.x} cy={flipY - point.y} r={measurementDisplayScale * 9}
                    fill="transparent" data-preview-pause-hit={groupKey} />
                  <circle cx={point.x} cy={flipY - point.y} r={measurementDisplayScale * 6}
                    fill="#020617" stroke={color} strokeWidth={selected ? '2.5' : '1.5'}
                    vectorEffect="non-scaling-stroke" pointerEvents="none"
                    data-preview-program-stop={group.length === 1 ? group[0].stopId : undefined}
                    data-preview-pause={group.length === 1 ? group[0].key : groupKey} />
                  <text x={point.x} y={flipY - point.y} dy="0.33em" textAnchor="middle"
                    fill={color} fontSize={measurementDisplayScale * 9} pointerEvents="none">
                    {group.length > 1 ? group.length : 'Ⅱ'}
                  </text>
                  <text x={point.x + measurementDisplayScale * 9}
                    y={flipY - point.y + measurementDisplayScale * 14}
                    fill={color} fontSize={measurementDisplayScale * 10}
                    paintOrder="stroke" stroke="#020617" strokeWidth={measurementDisplayScale * 2}
                    pointerEvents="none">{group.length > 1 ? `${group.length} pauses` : generated ? 'RETHREAD' : 'STOP'}</text>
                </g>
                {expanded && group.map((action, index) => <g key={action.key}
                  className="cursor-pointer" onClick={(event) => {
                    event.stopPropagation(); onSelectSpatialAction?.(action.key);
                  }}>
                  <rect x={point.x + measurementDisplayScale * 12}
                    y={flipY - point.y + measurementDisplayScale * (18 + index * 18)}
                    width={measurementDisplayScale * 156} height={measurementDisplayScale * 18}
                    fill="#0f172a" stroke={action.pause === 'authored' ? '#fbbf24' : '#fb7185'}
                    strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <text x={point.x + measurementDisplayScale * 18}
                    y={flipY - point.y + measurementDisplayScale * (31 + index * 18)}
                    fill="#e2e8f0" fontSize={measurementDisplayScale * 11}>{action.label}</text>
                </g>)}
              </g>;
            })}
          </g>
          <g data-preview-point-emphasis-layer pointerEvents="none">
            {pathEndpointHandles.map((handle) => {
              const highlight = pathEndpointMatches(handle, handle.role, hoveredPathElement)
                ? 'hover'
                : pathEndpointMatches(handle, handle.role, selectedPathElement) ? 'selected' : null;
              if (!highlight) return null;
              return <circle
                key={`emphasis-${handle.operationId}-${handle.segmentId}-${handle.role}`}
                data-preview-point-emphasis={highlight}
                data-preview-segment={handle.segmentId}
                data-preview-point-role={handle.role}
                cx={handle.point.x}
                cy={flipY - handle.point.y}
                  r={worldPerPixel * 5.5}
                fill="none"
                stroke={highlightColor(highlight)}
                  strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />;
            })}
          </g>
          {measurement && <g data-preview-measurement pointerEvents="none">
            {measurement.featurePair && <g data-preview-feature-gap>
              <line x1={measurement.featurePair.first.x} y1={flipY - measurement.featurePair.first.y}
                x2={measurement.featurePair.second.x} y2={flipY - measurement.featurePair.second.y}
                stroke="#67e8f9" strokeWidth="2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              {[measurement.featurePair.first, measurement.featurePair.second].map((point, index) => <circle key={index}
                cx={point.x} cy={flipY - point.y} r={measurementPickRadius * 0.8}
                fill="#67e8f9" stroke="#020617" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            </g>}
            {measurementFirst && measurementSecond && <line
              x1={measurementFirst.point.x} y1={flipY - measurementFirst.point.y}
              x2={measurementSecond.point.x} y2={flipY - measurementSecond.point.y}
              stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="5 3" vectorEffect="non-scaling-stroke"
            />}
            {measurement.picks.map((pick, index) => <g key={index}>
              <circle cx={pick.point.x} cy={flipY - pick.point.y} r={measurementPickRadius} fill="#fbbf24" />
              <text x={pick.point.x + measurementPickRadius * 1.4} y={flipY - pick.point.y - measurementPickRadius} fill="#fde68a" fontSize={measurementTextSize}>{index === 0 ? 'A' : 'B'}</text>
            </g>)}
            {measurement.hover && <g data-preview-measurement-snap={measurement.hover.kind === 'geometry' ? measurement.hover.snap : 'free'}>
              <circle cx={measurement.hover.point.x} cy={flipY - measurement.hover.point.y} r={measurementPickRadius * 1.8} fill="none" stroke="#fbbf24" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <text x={measurement.hover.point.x + measurementPickRadius * 2} y={flipY - measurement.hover.point.y - measurementPickRadius * 2} fill="#fde68a" fontSize={measurementTextSize} paintOrder="stroke" stroke="#020617" strokeWidth={measurementTextSize * 0.2}>
                {measurement.hover.kind === 'geometry' ? measurement.hover.snap : 'Free point'}
              </text>
            </g>}
            {measurementFirst && measurementSecond && measurementResult && <text
              data-preview-measurement-distance
              x={(measurementFirst.point.x + measurementSecond.point.x) / 2}
              y={flipY - (measurementFirst.point.y + measurementSecond.point.y) / 2 - measurementPickRadius * 2}
              textAnchor="middle" fill="#fde68a" fontSize={measurementTextSize} paintOrder="stroke" stroke="#020617" strokeWidth={measurementTextSize * 0.25}
            >{measurementResult.distance.toFixed(measurement.precision)} mm</text>}
          </g>}
        </g>
      </svg>
    </div>
  );
}

function pathElementMatches(
  path: { operationId?: string; pathElementId?: string; segmentId?: string; machiningSpanId?: string; travelRole?: 'rapid-in' | 'lead-in' | 'lead-out' },
  element: EditorPathElementRef | null | undefined
) {
  if (!element?.operationId || path.operationId !== element.operationId) return false;
  if (element.pathElementId && path.pathElementId !== element.pathElementId) return false;
  if (element.machiningSpanId && path.machiningSpanId !== element.machiningSpanId) return false;
  if (element.pointRole) return false;
  if (element.travelRole) return path.travelRole === element.travelRole;
  if (path.travelRole) return false;
  if (!path.segmentId) return false;
  return element.segmentId ? path.segmentId === element.segmentId : true;
}

interface PreviewPathEndpointHandle {
  operationId: string;
  pathElementId?: string;
  point: { x: number; y: number };
  role: 'start' | 'end';
  segmentId: string;
}

function readPathEndpointHandles(paths: EditorPreviewPath[], document?: PathPlanningDocument | null): PreviewPathEndpointHandle[] {
  const segmentPaths = new Map<
    string,
    {
      first: EditorPreviewPath;
      last: EditorPreviewPath;
    }
  >();

  for (const previewPath of paths) {
    if (previewPath.source !== 'path-document' || !previewPath.operationId || !previewPath.segmentId) continue;
    let path = previewPath;
    if (path.clippedSourceSegment) {
      const source = document?.segments.find((segment) => segment.id === path.segmentId);
      const ref = document?.plan.operations.find((operation) => operation.id === path.operationId)?.segmentRefs.find((candidate) => candidate.segmentId === path.segmentId);
      if (!source || !ref) continue;
      path = { ...path, start: orientedSegmentStart(source, ref), end: orientedSegmentEnd(source, ref) };
    }

    const key = `${path.operationId}:${path.pathElementId ?? ''}:${path.segmentId}`;
    const grouped = segmentPaths.get(key);
    if (grouped) {
      grouped.last = path;
    } else {
      segmentPaths.set(key, { first: path, last: path });
    }
  }

  return [...segmentPaths.values()].flatMap(({ first, last }) => {
    const start: PreviewPathEndpointHandle = {
      operationId: first.operationId!,
      pathElementId: first.pathElementId,
      point: first.start,
      role: 'start',
      segmentId: first.segmentId!
    };
    if (previewPointsEqual(first.start, last.end)) return [start];

    return [
      start,
      {
        operationId: last.operationId!,
        pathElementId: last.pathElementId,
        point: last.end,
        role: 'end',
        segmentId: last.segmentId!
      }
    ];
  });
}

function previewPointsEqual(
  first: { x: number; y: number },
  second: { x: number; y: number }
) {
  return Math.abs(first.x - second.x) <= 1e-9 && Math.abs(first.y - second.y) <= 1e-9;
}

function pathEndpointMatches(
  path: { operationId?: string; pathElementId?: string; segmentId?: string },
  role: 'start' | 'end',
  element: EditorPathElementRef | null | undefined
) {
  return Boolean(
    element?.operationId &&
      path.operationId === element.operationId &&
      (!element.pathElementId || path.pathElementId === element.pathElementId) &&
      path.segmentId &&
      element.segmentId === path.segmentId &&
      element.pointRole === role
  );
}

function readSelectedArcCenterHandles(
  paths: Array<{
    center?: { x: number; y: number };
    operationId?: string;
    pathElementId?: string;
    segmentId?: string;
    source?: 'gcode' | 'path-document';
    type: 'rapid' | 'cut' | 'arc';
  }>,
  selectedPathElement: EditorPathElementRef | null | undefined
) {
  const handles = new Map<
    string,
    {
      center: { x: number; y: number };
      operationId: string;
      pathElementId?: string;
      segmentId: string;
    }
  >();

  for (const path of paths) {
    if (
      path.source !== 'path-document' ||
      path.type !== 'arc' ||
      !path.center ||
      !path.operationId ||
      !path.segmentId ||
      !pathArcCenterMatches(path, selectedPathElement)
    ) {
      continue;
    }

    handles.set(`${path.operationId}:${path.segmentId}`, {
      center: path.center,
      operationId: path.operationId,
      pathElementId: path.pathElementId,
      segmentId: path.segmentId
    });
  }

  return [...handles.values()];
}

function pathArcCenterMatches(
  path: { operationId?: string; pathElementId?: string; segmentId?: string },
  element: EditorPathElementRef | null | undefined
) {
  if (!element?.operationId || path.operationId !== element.operationId) return false;
  if (element.pathElementId && path.pathElementId !== element.pathElementId) return false;
  if (element.travelRole || (element.pointRole && element.pointRole !== 'center')) return false;
  if (!path.segmentId) return false;
  return element.segmentId ? path.segmentId === element.segmentId : true;
}

function selectionMarqueeMoveThreshold(viewBox: EditorPreviewViewBox) {
  return Math.max(Math.min(viewBox.width, viewBox.height) * 0.003, 0.02);
}

function readSelectionMarqueeRect(selection: SelectionMarqueeState): SelectionMarqueeRect {
  return {
    maxX: Math.max(selection.startWorld.x, selection.currentWorld.x),
    maxY: Math.max(selection.startWorld.y, selection.currentWorld.y),
    minX: Math.min(selection.startWorld.x, selection.currentWorld.x),
    minY: Math.min(selection.startWorld.y, selection.currentWorld.y)
  };
}

function selectionMarqueeSvgRect(selection: SelectionMarqueeState, flipY: number) {
  const rect = readSelectionMarqueeRect(selection);
  return {
    height: Math.max(rect.maxY - rect.minY, 0),
    width: Math.max(rect.maxX - rect.minX, 0),
    x: rect.minX,
    y: flipY - rect.maxY
  };
}

function selectPathElementInMarquee(
  paths: EditorPreviewPath[],
  marquee: SelectionMarqueeRect,
  filter: PreviewSelectionFilter
): EditorPathElementRef | null {
  const selectablePaths = paths.filter((path) => matchesPreviewSelectionFilter(path, filter));
  const hitPaths = selectablePaths.filter((path) => path.selectionGeometry && segmentIntersectsSelectionRect(path.selectionGeometry, marquee));
  if (hitPaths.length === 0) return null;

  const hitGroups = new Map<string, EditorPreviewPath[]>();
  const selectableGroups = new Map<string, EditorPreviewPath[]>();
  for (const path of selectablePaths) {
    const key = pathSelectionGroupKey(path);
    selectableGroups.set(key, [...(selectableGroups.get(key) ?? []), path]);
  }
  for (const path of hitPaths) {
    const key = pathSelectionGroupKey(path);
    hitGroups.set(key, [...(hitGroups.get(key) ?? []), path]);
  }

  for (const [key, hitGroup] of hitGroups) {
    const selectableGroup = selectableGroups.get(key) ?? [];
    if (hitGroup.length > 1 || hitGroup.length >= selectableGroup.length) {
      const first = hitGroup[0];
      return {
        operationId: first.operationId!,
        pathElementId: first.pathElementId ?? null,
        segmentId: null
      };
    }
  }

  const first = hitPaths[0];
  return {
    operationId: first.operationId!,
    pathElementId: first.pathElementId ?? null,
    segmentId: first.segmentId ?? null,
    machiningSpanId: first.machiningSpanId
  };
}

function pathSelectionGroupKey(path: EditorPreviewPath) {
  return `${path.operationId ?? ''}:${path.pathElementId ?? ''}`;
}

function formatPreviewPoint(point: { x: number; y: number }) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}
