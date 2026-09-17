import type { MouseEvent } from 'react';

import type { EditorPreviewViewBox } from '@/domain/editor/previewGeometry';

export const MIN_PREVIEW_ZOOM = 0.25;
export const MAX_PREVIEW_ZOOM = 8;
export const PREVIEW_ZOOM_STEP = 1.25;
export const PREVIEW_GRID_SIZE = 5;
export const PREVIEW_GRID_MAJOR_INTERVAL = 20;
export const PREVIEW_CUT_STROKE = '#39ff14';
export const PREVIEW_ARC_STROKE = '#39ff14';
export const PREVIEW_RAPID_STROKE = '#9ca3af';
export const PREVIEW_HOVER_STROKE = '#fbbf24';
export const PREVIEW_PINNED_STROKE = '#ef4444';
export const PREVIEW_SELECTED_STROKE = '#38bdf8';
export const TOUCH_DOUBLE_TAP_TIMEOUT_MS = 500;
export const TOUCH_TAP_THRESHOLD = 10;

const PREVIEW_GRID_MAX_LINES_PER_AXIS = 120;
const GRID_EPSILON = 1e-9;

export interface PreviewPan {
  x: number;
  y: number;
}

export interface PreviewDragState {
  clientX: number;
  clientY: number;
  pan: PreviewPan;
  viewBox: EditorPreviewViewBox;
}

export interface PreviewTouchTapState {
  clientX: number;
  clientY: number;
  distance?: number;
  mode: 'tap' | 'pan';
  pan: PreviewPan;
  viewBox: EditorPreviewViewBox;
  zoom?: number;
}

export interface PreviewLastTapState {
  clientX: number;
  clientY: number;
  time: number;
}

export interface PreviewTouchPoint {
  clientX: number;
  clientY: number;
}

export interface PreviewViewState {
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

export function zoomViewBox(
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

export function previewEventToWorldPoint(
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

export function previewTouchToWorldPoint(
  touch: PreviewTouchPoint,
  target: SVGSVGElement,
  viewBox: EditorPreviewViewBox,
  flipY: number,
  options: { gridSize: number; snapToGrid: boolean }
) {
  return previewClientToWorldPoint(target, touch.clientX, touch.clientY, viewBox, flipY, options);
}

export function snapWorldPointToGrid(point: { x: number; y: number }, gridSize: number) {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return point;

  return {
    x: round(Math.round(point.x / gridSize) * gridSize),
    y: round(Math.round(point.y / gridSize) * gridSize)
  };
}

export function touchDistance(first: PreviewTouchPoint, second: PreviewTouchPoint) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

/** SVG user units per CSS pixel after preserveAspectRatio has fitted the viewBox. */
export function previewWorldUnitsPerCssPixel(
  viewBox: EditorPreviewViewBox,
  surface: { width: number; height: number }
) {
  const width = surface.width > 0 ? surface.width : 700;
  const height = surface.height > 0 ? surface.height : 500;
  return Math.max(viewBox.width / width, viewBox.height / height);
}

/** Keep a small visible sample while retaining every endpoint in the source geometry. */
export function visibleEndpointIndices<T extends { point: { x: number; y: number } }>(
  handles: readonly T[],
  worldPerPixel: number,
  alwaysVisible: (handle: T) => boolean
): ReadonlySet<number> {
  const cellSize = Math.max(worldPerPixel * 6, 1e-9);
  const buckets = new Map<string, Array<{ x: number; y: number }>>();
  const visible = new Set<number>();
  handles.forEach((handle, index) => {
    const x = Math.floor(handle.point.x / cellSize);
    const y = Math.floor(handle.point.y / cellSize);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx += 1) {
      for (let dy = -1; dy <= 1 && !near; dy += 1) {
        for (const previous of buckets.get(`${x + dx}:${y + dy}`) ?? []) {
          if (Math.hypot(previous.x - handle.point.x, previous.y - handle.point.y) < cellSize) {
            near = true;
            break;
          }
        }
      }
    }
    if (near && !alwaysVisible(handle)) return;
    visible.add(index);
    const key = `${x}:${y}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(handle.point);
    buckets.set(key, bucket);
  });
  return visible;
}

/** Shrink invisible targets only where neighboring endpoints would cover the whole segment. */
export function endpointHitRadiiPixels<T extends { point: { x: number; y: number } }>(
  handles: readonly T[],
  worldPerPixel: number
): number[] {
  const cellSize = Math.max(worldPerPixel * 15, 1e-9);
  const buckets = new Map<string, number[]>();
  const nearest = handles.map(() => Number.POSITIVE_INFINITY);
  handles.forEach((handle, index) => {
    const x = Math.floor(handle.point.x / cellSize);
    const y = Math.floor(handle.point.y / cellSize);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const otherIndex of buckets.get(`${x + dx}:${y + dy}`) ?? []) {
          const other = handles[otherIndex];
          const distance = Math.hypot(other.point.x - handle.point.x,
            other.point.y - handle.point.y) / worldPerPixel;
          if (distance < 1e-4) continue;
          nearest[index] = Math.min(nearest[index], distance);
          nearest[otherIndex] = Math.min(nearest[otherIndex], distance);
        }
      }
    }
    const key = `${x}:${y}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(index);
    if (bucket.length > 16) bucket.shift();
    buckets.set(key, bucket);
  });
  return nearest.map((distance) => Math.min(7.5, Math.max(2.5, distance * 0.45)));
}

export function buildPreviewGrid(viewBox: EditorPreviewViewBox, flipY: number, worldPerPixel: number) {
  const bounds = viewBoxToWorldBounds(viewBox, flipY);
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const labelSpacing = pickPreviewGridLabelSpacing(worldPerPixel * 85);
  const spacing = Math.max(labelSpacing / 5, span / PREVIEW_GRID_MAX_LINES_PER_AXIS);
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
        variant: isMultipleOf(value, labelSpacing) ? 'major' : 'minor'
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
        variant: isMultipleOf(value, labelSpacing) ? 'major' : 'minor'
      });
    }
  }

  return { bounds, labelSpacing, lines, axes };
}

export function buildVisibleGridLabels(
  lines: PreviewGridLine[],
  labelSpacing: number,
  bounds: PreviewGridBounds,
  worldPerPixel: number
): PreviewGridLabels {
  const labels: PreviewGridLabels = { horizontal: [], vertical: [] };

  for (const line of lines) {
    if (!shouldRenderGridLabel(line.value, labelSpacing)) continue;
    const min = line.orientation === 'vertical' ? bounds.minX : bounds.minY;
    const max = line.orientation === 'vertical' ? bounds.maxX : bounds.maxY;
    if (line.value - min < worldPerPixel * 22 || max - line.value < worldPerPixel * 22) continue;
    labels[line.orientation].push(line);
  }

  return labels;
}

export function isInteractiveTarget(target: EventTarget | null) {
  if (isEditableTarget(target)) return true;
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest('button, a, summary, [role="button"], [role="dialog"], [role="tree"], [role="treeitem"]'));
}

export function strokeForPath(
  type: 'rapid' | 'cut' | 'arc',
  highlight: 'selected' | 'hover' | 'pinned' | undefined,
  isPinned: boolean
) {
  if (highlight === 'pinned' || isPinned) return PREVIEW_PINNED_STROKE;
  if (highlight === 'selected') return PREVIEW_SELECTED_STROKE;
  if (highlight === 'hover') return PREVIEW_HOVER_STROKE;
  return type === 'rapid' ? PREVIEW_RAPID_STROKE : type === 'arc' ? PREVIEW_ARC_STROKE : PREVIEW_CUT_STROKE;
}

export function strokeWidthForPath(
  type: 'rapid' | 'cut' | 'arc',
  highlight: 'selected' | 'hover' | 'pinned' | undefined,
  isPinned: boolean
) {
  if (highlight || isPinned) return 3;
  return type === 'rapid' ? 1 : 1.8;
}

export function highlightForLine(
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

export function highlightColor(highlight: 'selected' | 'hover' | 'pinned') {
  if (highlight === 'pinned') return PREVIEW_PINNED_STROKE;
  if (highlight === 'selected') return PREVIEW_SELECTED_STROKE;
  return PREVIEW_HOVER_STROKE;
}

export function round(value: number) {
  return Number(value.toFixed(6));
}

export function format(value: number) {
  return Number(value.toFixed(6)).toString();
}

export function clampZoom(value: number) {
  return Number(Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, value)).toFixed(4));
}

export function initialPreviewViewState(resetKey: string): PreviewViewState {
  return {
    pan: { x: 0, y: 0 },
    resetKey,
    zoom: 1
  };
}

export function previewClientToWorldPoint(
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

function viewBoxToWorldBounds(viewBox: EditorPreviewViewBox, flipY: number): PreviewGridBounds {
  const svgMaxY = viewBox.minY + viewBox.height;

  return {
    minX: viewBox.minX,
    maxX: viewBox.minX + viewBox.width,
    minY: flipY - svgMaxY,
    maxY: flipY - viewBox.minY
  };
}

function pickPreviewGridLabelSpacing(target: number) {
  const decade = 10 ** Math.floor(Math.log10(Math.max(target, 1e-9)));
  return [1, 2, 5, 10].map((factor) => factor * decade)
    .reduce((best, candidate) => Math.abs(candidate - target) < Math.abs(best - target)
      ? candidate : best);
}

function shouldRenderGridLabel(value: number, labelSpacing: number) {
  return isMultipleOf(value, labelSpacing);
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
