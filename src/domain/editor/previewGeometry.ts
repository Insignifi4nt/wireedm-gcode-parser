import type {
  GCodeArcPathPoint,
  GCodeBounds,
  GCodeParseResult,
  GCodePathPoint
} from './types';

export interface EditorPreviewPath {
  type: 'rapid' | 'cut' | 'arc';
  d: string;
  end: {
    x: number;
    y: number;
  };
  line: number;
}

export interface EditorPreviewViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface EditorPreviewMarker {
  type: 'start' | 'end';
  x: number;
  y: number;
  label: string;
}

export interface EditorPreviewGeometry {
  viewBox: EditorPreviewViewBox;
  paths: EditorPreviewPath[];
  markers: EditorPreviewMarker[];
}

interface BuildEditorPreviewGeometryOptions {
  padding?: number;
}

export function buildEditorPreviewGeometry(
  parseResult: GCodeParseResult,
  options: BuildEditorPreviewGeometryOptions = {}
): EditorPreviewGeometry {
  const padding = options.padding ?? 1;
  const paths: EditorPreviewPath[] = [];
  let currentPoint: { x: number; y: number } | null = null;

  for (const point of parseResult.path) {
    if (point.type === 'position') {
      currentPoint = { x: point.x, y: point.y };
      continue;
    }

    if (point.type === 'rapid' || point.type === 'cut') {
      const start = currentPoint ?? { x: point.x, y: point.y };
      paths.push({
        type: point.type,
        d: `M ${format(start.x)} ${format(start.y)} L ${format(point.x)} ${format(point.y)}`,
        end: {
          x: point.x,
          y: point.y
        },
        line: point.line
      });
      currentPoint = { x: point.x, y: point.y };
      continue;
    }

    if (point.type === 'arc') {
      paths.push({
        type: 'arc',
        d: arcPath(point),
        end: {
          x: point.endX,
          y: point.endY
        },
        line: point.line
      });
      currentPoint = { x: point.endX, y: point.endY };
    }
  }

  return {
    markers: previewMarkers(parseResult.path),
    viewBox: paddedViewBox(parseResult.bounds, padding),
    paths
  };
}

export function fitViewBoxToViewportAspect(
  viewBox: EditorPreviewViewBox,
  viewportWidth: number,
  viewportHeight: number
): EditorPreviewViewBox {
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    viewBox.width <= 0 ||
    viewBox.height <= 0 ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight)
  ) {
    return viewBox;
  }

  const viewportAspect = viewportWidth / viewportHeight;
  const viewBoxAspect = viewBox.width / viewBox.height;
  const centerX = viewBox.minX + viewBox.width / 2;
  const centerY = viewBox.minY + viewBox.height / 2;

  if (Math.abs(viewportAspect - viewBoxAspect) <= 1e-6) return viewBox;

  if (viewBoxAspect > viewportAspect) {
    const height = viewBox.width / viewportAspect;
    return normalizeViewBox({
      minX: viewBox.minX,
      minY: centerY - height / 2,
      width: viewBox.width,
      height
    });
  }

  const width = viewBox.height * viewportAspect;
  return normalizeViewBox({
    minX: centerX - width / 2,
    minY: viewBox.minY,
    width,
    height: viewBox.height
  });
}

function previewMarkers(path: GCodePathPoint[]): EditorPreviewMarker[] {
  if (path.length === 0) return [];

  const startPoint = pointCoordinates(path[0]);
  if (!startPoint) return [];

  const markers: EditorPreviewMarker[] = [
    {
      type: 'start',
      x: startPoint.x,
      y: startPoint.y,
      label: 'START'
    }
  ];

  if (path.length > 1) {
    const endPoint = pointCoordinates(path.at(-1)!);
    if (endPoint) {
      markers.push({
        type: 'end',
        x: endPoint.x,
        y: endPoint.y,
        label: 'END'
      });
    }
  }

  return markers;
}

function pointCoordinates(point: GCodePathPoint) {
  if (point.type === 'arc') {
    return {
      x: point.endX,
      y: point.endY
    };
  }

  return {
    x: point.x,
    y: point.y
  };
}

function arcPath(point: GCodeArcPathPoint) {
  const radius = Math.hypot(point.startX - point.centerX, point.startY - point.centerY);
  const largeArcFlag = isLargeArc(point) ? 1 : 0;
  const sweepFlag = point.clockwise ? 0 : 1;

  return [
    `M ${format(point.startX)} ${format(point.startY)}`,
    `A ${format(radius)} ${format(radius)} 0 ${largeArcFlag} ${sweepFlag} ${format(point.endX)} ${format(point.endY)}`
  ].join(' ');
}

function isLargeArc(point: GCodeArcPathPoint) {
  if (pointsEqual({ x: point.startX, y: point.startY }, { x: point.endX, y: point.endY })) {
    return true;
  }

  const start = normalizeAngle(Math.atan2(point.startY - point.centerY, point.startX - point.centerX));
  const end = normalizeAngle(Math.atan2(point.endY - point.centerY, point.endX - point.centerX));
  const full = Math.PI * 2;
  const span = point.clockwise
    ? (start - end + full) % full
    : (end - start + full) % full;

  return span > Math.PI;
}

function paddedViewBox(bounds: GCodeBounds, padding: number): EditorPreviewViewBox {
  const hasBounds = [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite);
  if (!hasBounds) {
    return {
      minX: -padding,
      minY: -padding,
      width: padding * 2,
      height: padding * 2
    };
  }

  const width = Math.max(bounds.maxX - bounds.minX, 0);
  const height = Math.max(bounds.maxY - bounds.minY, 0);

  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    width: Math.max(width + padding * 2, padding * 2),
    height: Math.max(height + padding * 2, padding * 2)
  };
}

function normalizeAngle(angle: number) {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function pointsEqual(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}

function format(value: number) {
  return Number(value.toFixed(6)).toString();
}

function normalizeViewBox(viewBox: EditorPreviewViewBox): EditorPreviewViewBox {
  return {
    minX: Number(viewBox.minX.toFixed(6)),
    minY: Number(viewBox.minY.toFixed(6)),
    width: Number(viewBox.width.toFixed(6)),
    height: Number(viewBox.height.toFixed(6))
  };
}
