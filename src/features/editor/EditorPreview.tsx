import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type TouchEvent,
  type WheelEvent
} from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import { buildEditorPreviewGeometry, fitViewBoxToViewportAspect } from '@/domain/editor/previewGeometry';
import type { EditorPreviewViewBox } from '@/domain/editor/previewGeometry';

const MIN_PREVIEW_ZOOM = 0.25;
const MAX_PREVIEW_ZOOM = 8;
const PREVIEW_ZOOM_STEP = 1.25;
const PREVIEW_GRID_SIZE = 5;
const PREVIEW_GRID_MAJOR_INTERVAL = 20;
const PREVIEW_GRID_MAX_LINES_PER_AXIS = 120;
const PREVIEW_GRID_MAX_LABELS_PER_AXIS = 8;
const GRID_EPSILON = 1e-9;
const PREVIEW_CUT_STROKE = '#39ff14';
const PREVIEW_ARC_STROKE = '#39ff14';
const PREVIEW_RAPID_STROKE = '#9ca3af';
const PREVIEW_HOVER_STROKE = '#fbbf24';
const PREVIEW_PINNED_STROKE = '#ef4444';
const PREVIEW_SELECTED_STROKE = '#38bdf8';
const TOUCH_DOUBLE_TAP_TIMEOUT_MS = 500;
const TOUCH_TAP_THRESHOLD = 10;

interface PreviewPan {
  x: number;
  y: number;
}

interface PreviewDragState {
  clientX: number;
  clientY: number;
  pan: PreviewPan;
  viewBox: EditorPreviewViewBox;
}

interface PreviewTouchTapState {
  clientX: number;
  clientY: number;
  distance?: number;
  mode: 'tap' | 'pan';
  pan: PreviewPan;
  viewBox: EditorPreviewViewBox;
  zoom?: number;
}

interface PreviewLastTapState {
  clientX: number;
  clientY: number;
  time: number;
}

interface PreviewTouchPoint {
  clientX: number;
  clientY: number;
}

interface PreviewViewState {
  pan: PreviewPan;
  resetKey: string;
  zoom: number;
}

interface PreviewGridBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface PreviewGridLine {
  orientation: 'vertical' | 'horizontal';
  value: number;
  variant: 'minor' | 'major';
}

interface PreviewAxisLine {
  axis: 'x' | 'y';
  orientation: 'vertical' | 'horizontal';
  value: number;
}

interface PreviewGridLabels {
  horizontal: PreviewGridLine[];
  vertical: PreviewGridLine[];
}

interface EditorPreviewProps {
  program: LoadedEditorProgram | null;
  hoveredLine: number | null;
  keyboardShortcutsEnabled?: boolean;
  measurementPoints: MeasurementPoint[];
  onCursorPointChange?: (point: { x: number; y: number } | null) => void;
  onPreviewPointClick?: (point: { x: number; y: number }) => void;
  pinnedLines: number[];
  selectedLines: number[];
  snapToGrid?: boolean;
  snapGridSize?: number;
}

export function EditorPreview({
  program,
  hoveredLine,
  keyboardShortcutsEnabled = true,
  measurementPoints,
  onCursorPointChange,
  onPreviewPointClick,
  pinnedLines,
  selectedLines,
  snapGridSize = PREVIEW_GRID_SIZE,
  snapToGrid = false
}: EditorPreviewProps) {
  const preview = useMemo(
    () => (program ? buildEditorPreviewGeometry(program.parseResult, { padding: 1 }) : null),
    [program]
  );
  const selected = useMemo(() => new Set(selectedLines), [selectedLines]);
  const pinned = useMemo(() => new Set(pinnedLines), [pinnedLines]);
  const [showGrid, setShowGrid] = useState(true);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const dragStateRef = useRef<PreviewDragState | null>(null);
  const lastTapRef = useRef<PreviewLastTapState | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const touchTapRef = useRef<PreviewTouchTapState | null>(null);

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
      if (isInteractiveTarget(event.target)) return;

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

  const activeViewBox = previewViewBox;
  const viewBox = `${format(activeViewBox.minX)} ${format(activeViewBox.minY)} ${format(activeViewBox.width)} ${format(activeViewBox.height)}`;
  const flipY = preview.viewBox.minY * 2 + preview.viewBox.height;
  const grid = buildPreviewGrid(activeViewBox, flipY);
  const gridLabels = buildVisibleGridLabels(grid.lines, grid.labelSpacing);
  const markerRadius = Math.max(Math.max(preview.viewBox.width, preview.viewBox.height) * 0.004, 0.06);
  const markerLabelFontSize = Math.max(markerRadius * 1.55, 0.16);
  const measurementLabelFontSize = Math.max(markerRadius * 1.75, 0.18);
  const highlightedPointRadius = Math.max(markerRadius * 1.45, 0.11);
  const highlightedPointLabelFontSize = Math.max(markerRadius * 1.7, 0.18);
  const gridLabelFontSize = Math.min(
    Math.max(Math.min(activeViewBox.width, activeViewBox.height) * 0.012, 0.18),
    0.42
  );
  const gridLabelInset = gridLabelFontSize * 1.8;
  const zoomPercent = Math.round(zoom * 100);

  function handlePreviewClick(event: MouseEvent<SVGSVGElement>) {
    if (!onPreviewPointClick || event.shiftKey || dragStateRef.current) return;

    const point = previewEventToWorldPoint(event, activeViewBox, flipY, {
      gridSize: snapGridSize,
      snapToGrid
    });
    if (!point) return;

    onPreviewPointClick(point);
  }

  function handlePreviewWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const nextZoom = event.deltaY > 0 ? zoom / PREVIEW_ZOOM_STEP : zoom * PREVIEW_ZOOM_STEP;
    setZoom(clampZoom(nextZoom));
  }

  function handlePreviewMouseDown(event: MouseEvent<SVGSVGElement>) {
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
    dragStateRef.current = null;
  }

  function handlePreviewMouseLeave() {
    onCursorPointChange?.(null);
    handlePreviewMouseUp();
  }

  function handlePreviewTouchStart(event: TouchEvent<SVGSVGElement>) {
    if (event.touches.length === 2) {
      event.preventDefault();
      const distance = touchDistance(event.touches[0], event.touches[1]);
      touchTapRef.current = {
        clientX: 0,
        clientY: 0,
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
        setZoom(clampZoom(state.zoom * (nextDistance / state.distance)));
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

    if (!state || !touch || !onPreviewPointClick || state.mode === 'pan') return;

    event.preventDefault();
    const distance = Math.hypot(touch.clientX - state.clientX, touch.clientY - state.clientY);
    if (distance > TOUCH_TAP_THRESHOLD) return;

    const now = Date.now();
    const previousTap = lastTapRef.current;
    if (
      previousTap &&
      now - previousTap.time <= TOUCH_DOUBLE_TAP_TIMEOUT_MS &&
      Math.hypot(touch.clientX - previousTap.clientX, touch.clientY - previousTap.clientY) <=
        TOUCH_TAP_THRESHOLD
    ) {
      lastTapRef.current = null;
      handleFitPreview();
      return;
    }
    lastTapRef.current = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      time: now
    };

    const point = previewTouchToWorldPoint(touch, event.currentTarget, activeViewBox, flipY, {
      gridSize: snapGridSize,
      snapToGrid
    });
    if (point) onPreviewPointClick(point);
  }

  function handlePreviewTouchCancel() {
    touchTapRef.current = null;
    onCursorPointChange?.(null);
  }

  function handleFitPreview() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    dragStateRef.current = null;
  }

  return (
    <div className="grid h-full min-h-[220px] grid-rows-[auto_minmax(0,1fr)] border border-border bg-background/70">
      <div className="flex h-7 items-center justify-end gap-1 border-b border-border bg-card/70 px-2 font-mono text-[10px] text-muted-foreground">
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
      <svg
        ref={setPreviewSvg}
        aria-label="G-code path preview"
        className="h-full min-h-0 w-full"
        onContextMenu={(event) => event.preventDefault()}
        onClick={handlePreviewClick}
        onMouseDown={handlePreviewMouseDown}
        onMouseLeave={handlePreviewMouseLeave}
        onMouseMove={handlePreviewMouseMove}
        onMouseUp={handlePreviewMouseUp}
        onTouchCancel={handlePreviewTouchCancel}
        onTouchEnd={handlePreviewTouchEnd}
        onTouchMove={handlePreviewTouchMove}
        onTouchStart={handlePreviewTouchStart}
        onWheel={handlePreviewWheel}
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
        <g transform={`matrix(1 0 0 -1 0 ${flipY})`}>
          {preview.paths.map((path, index) => {
            const highlight = highlightForLine(path.line, {
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
                data-type={path.type}
                fill="none"
                key={`${path.type}-${path.line}-${index}`}
                stroke={strokeForPath(path.type, highlight, isPinned)}
                strokeDasharray={path.type === 'rapid' ? '0.4 0.4' : undefined}
                strokeLinecap="round"
                strokeWidth={strokeWidthForPath(path.type, highlight, isPinned)}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
        <g>
          {preview.paths.map((path) => {
            const highlight = highlightForLine(path.line, {
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
          {preview.markers.map((marker) => {
            const svgY = flipY - marker.y;
            const radius = marker.type === 'start' ? markerRadius * 1.25 : markerRadius;

            return (
              <g data-path-marker={marker.type} key={marker.type}>
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
          {measurementPoints.map((point, index) => {
            const svgY = flipY - point.y;

            return (
              <g data-measurement-point={index + 1} key={point.id}>
                <circle
                  cx={point.x}
                  cy={svgY}
                  fill="#38bdf8"
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
        </g>
      </svg>
    </div>
  );
}

function zoomViewBox(
  viewBox: EditorPreviewViewBox,
  zoom: number,
  pan: PreviewPan
): EditorPreviewViewBox {
  const centerX = viewBox.minX + viewBox.width / 2 + pan.x;
  const centerY = viewBox.minY + viewBox.height / 2 + pan.y;
  const width = viewBox.width / zoom;
  const height = viewBox.height / zoom;

  return {
    minX: centerX - width / 2,
    minY: centerY - height / 2,
    width,
    height
  };
}

function previewEventToWorldPoint(
  event: MouseEvent<SVGSVGElement>,
  viewBox: EditorPreviewViewBox,
  flipY: number,
  options: { gridSize: number; snapToGrid: boolean } = {
    gridSize: PREVIEW_GRID_SIZE,
    snapToGrid: false
  }
) {
  return previewClientToWorldPoint(
    event.currentTarget,
    event.clientX,
    event.clientY,
    viewBox,
    flipY,
    options
  );
}

function previewTouchToWorldPoint(
  touch: PreviewTouchPoint,
  target: SVGSVGElement,
  viewBox: EditorPreviewViewBox,
  flipY: number,
  options: { gridSize: number; snapToGrid: boolean }
) {
  return previewClientToWorldPoint(target, touch.clientX, touch.clientY, viewBox, flipY, options);
}

function previewClientToWorldPoint(
  target: SVGSVGElement,
  clientX: number,
  clientY: number,
  viewBox: EditorPreviewViewBox,
  flipY: number,
  options: { gridSize: number; snapToGrid: boolean }
) {
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) return null;

  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const localX = clientX - rect.left - offsetX;
  const localY = clientY - rect.top - offsetY;

  if (localX < 0 || localY < 0 || localX > renderedWidth || localY > renderedHeight) {
    return null;
  }

  const svgX = viewBox.minX + localX / scale;
  const svgY = viewBox.minY + localY / scale;

  const point = {
    x: round(svgX),
    y: round(flipY - svgY)
  };

  return options.snapToGrid ? snapWorldPointToGrid(point, options.gridSize) : point;
}

function snapWorldPointToGrid(point: { x: number; y: number }, gridSize: number) {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return point;

  return {
    x: round(Math.round(point.x / gridSize) * gridSize),
    y: round(Math.round(point.y / gridSize) * gridSize)
  };
}

function touchDistance(first: PreviewTouchPoint, second: PreviewTouchPoint) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function buildPreviewGrid(viewBox: EditorPreviewViewBox, flipY: number) {
  const bounds = viewBoxToWorldBounds(viewBox, flipY);
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const spacing = pickPreviewGridSpacing(span);
  const labelSpacing = pickPreviewGridLabelSpacing(spacing, span);
  const verticalValues = gridValues(bounds.minX, bounds.maxX, spacing);
  const horizontalValues = gridValues(bounds.minY, bounds.maxY, spacing);
  const lines: PreviewGridLine[] = [];
  const axes: PreviewAxisLine[] = [];

  for (const value of verticalValues) {
    if (isZero(value)) {
      axes.push({ axis: 'y', orientation: 'vertical', value: 0 });
    } else {
      lines.push({
        orientation: 'vertical',
        value,
        variant: isMultipleOf(value, PREVIEW_GRID_MAJOR_INTERVAL) ? 'major' : 'minor'
      });
    }
  }

  for (const value of horizontalValues) {
    if (isZero(value)) {
      axes.push({ axis: 'x', orientation: 'horizontal', value: 0 });
    } else {
      lines.push({
        orientation: 'horizontal',
        value,
        variant: isMultipleOf(value, PREVIEW_GRID_MAJOR_INTERVAL) ? 'major' : 'minor'
      });
    }
  }

  return { bounds, labelSpacing, lines, axes };
}

function viewBoxToWorldBounds(viewBox: EditorPreviewViewBox, flipY: number): PreviewGridBounds {
  const svgMaxY = viewBox.minY + viewBox.height;

  return {
    minX: viewBox.minX,
    maxX: viewBox.minX + viewBox.width,
    minY: flipY - svgMaxY,
    maxY: flipY - viewBox.minY
  };
}

function pickPreviewGridSpacing(span: number) {
  let spacing = PREVIEW_GRID_SIZE;

  while (span / spacing > PREVIEW_GRID_MAX_LINES_PER_AXIS) {
    spacing *= 2;
  }

  return spacing;
}

function pickPreviewGridLabelSpacing(spacing: number, span: number) {
  let labelSpacing = spacing;

  while (span / labelSpacing > PREVIEW_GRID_MAX_LABELS_PER_AXIS) {
    labelSpacing *= 2;
  }

  return labelSpacing;
}

function shouldRenderGridLabel(value: number, labelSpacing: number) {
  return isMultipleOf(value, labelSpacing);
}

function buildVisibleGridLabels(lines: PreviewGridLine[], labelSpacing: number): PreviewGridLabels {
  const labels: PreviewGridLabels = { horizontal: [], vertical: [] };

  for (const line of lines) {
    if (!shouldRenderGridLabel(line.value, labelSpacing)) continue;
    labels[line.orientation].push(line);
  }

  return labels;
}

function gridValues(min: number, max: number, spacing: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(spacing) || spacing <= 0) {
    return [];
  }

  const startIndex = Math.ceil((Math.min(min, max) - GRID_EPSILON) / spacing);
  const endIndex = Math.floor((Math.max(min, max) + GRID_EPSILON) / spacing);
  const values: number[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    values.push(round(index * spacing));
  }

  return values;
}

function isZero(value: number) {
  return Math.abs(value) < GRID_EPSILON;
}

function isMultipleOf(value: number, interval: number) {
  const multiple = value / interval;

  return Math.abs(multiple - Math.round(multiple)) < GRID_EPSILON;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function isInteractiveTarget(target: EventTarget | null) {
  if (isEditableTarget(target)) return true;
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest('button, a, summary, [role="button"], [role="dialog"]'));
}

function strokeForPath(
  type: 'rapid' | 'cut' | 'arc',
  highlight: 'selected' | 'hover' | 'pinned' | undefined,
  isPinned: boolean
) {
  if (highlight === 'pinned' || isPinned) return PREVIEW_PINNED_STROKE;
  if (highlight === 'selected') return PREVIEW_SELECTED_STROKE;
  if (highlight === 'hover') return PREVIEW_HOVER_STROKE;
  return type === 'rapid' ? PREVIEW_RAPID_STROKE : type === 'arc' ? PREVIEW_ARC_STROKE : PREVIEW_CUT_STROKE;
}

function strokeWidthForPath(
  type: 'rapid' | 'cut' | 'arc',
  highlight: 'selected' | 'hover' | 'pinned' | undefined,
  isPinned: boolean
) {
  if (highlight || isPinned) return 3;
  return type === 'rapid' ? 1 : 1.8;
}

function highlightForLine(
  line: number,
  options: {
    hoveredLine: number | null;
    pinned: Set<number>;
    selected: Set<number>;
  }
) {
  if (options.pinned.has(line)) return 'pinned';
  if (options.selected.has(line)) return 'selected';
  if (options.hoveredLine === line) return 'hover';
  return undefined;
}

function highlightColor(highlight: 'selected' | 'hover' | 'pinned') {
  if (highlight === 'pinned') return PREVIEW_PINNED_STROKE;
  if (highlight === 'selected') return PREVIEW_SELECTED_STROKE;
  return PREVIEW_HOVER_STROKE;
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function format(value: number) {
  return Number(value.toFixed(6)).toString();
}

function clampZoom(value: number) {
  return Number(Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, value)).toFixed(4));
}

function initialPreviewViewState(resetKey: string): PreviewViewState {
  return {
    pan: { x: 0, y: 0 },
    resetKey,
    zoom: 1
  };
}
