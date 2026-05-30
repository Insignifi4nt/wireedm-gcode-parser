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
const PREVIEW_GRID_MAX_LABELS_PER_AXIS = 8;
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

export function buildPreviewGrid(viewBox: EditorPreviewViewBox, flipY: number) {
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

export function buildVisibleGridLabels(
  lines: PreviewGridLine[],
  labelSpacing: number
): PreviewGridLabels {
  const labels: PreviewGridLabels = { horizontal: [], vertical: [] };

  for (const line of lines) {
    if (!shouldRenderGridLabel(line.value, labelSpacing)) continue;
    labels[line.orientation].push(line);
  }

  return labels;
}

export function isInteractiveTarget(target: EventTarget | null) {
  if (isEditableTarget(target)) return true;
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(target.closest('button, a, summary, [role="button"], [role="dialog"]'));
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
