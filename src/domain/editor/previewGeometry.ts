import type {
  GCodeArcPathPoint,
  GCodeBounds,
  GCodeParseResult,
  GCodePathPoint
} from './types';
import {
  boundsAreFinite,
  emptyBounds,
  mergeBounds,
  orientedArcClockwise,
  orientedCircleClockwise,
  orientedSegmentEnd,
  orientedSegmentStart,
  pathBounds,
  pointsEqual as pathPointsEqual,
  requiredSegment,
  segmentMap
} from '@/domain/path-intel/segments';
import { readOperationTransitions } from '@/domain/path-intel/operationTransitions';
import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import type {
  ArcPathSegment,
  Bounds2,
  CirclePathSegment,
  OperationId,
  OrientedSegmentRef,
  PathElementId,
  PathPlanningDocument,
  PathSegment,
  Point2,
  SegmentId
} from '@/domain/path-intel/types';
import { deriveActiveMachiningOperations } from '@/domain/path-intel/machiningParticipation';

export interface EditorPreviewPath {
  type: 'rapid' | 'cut' | 'arc';
  bounds: Bounds2;
  d: string;
  start: {
    x: number;
    y: number;
  };
  end: {
    x: number;
    y: number;
  };
  center?: {
    x: number;
    y: number;
  };
  line: number;
  operationId?: OperationId;
  pathElementId?: PathElementId;
  segmentId?: SegmentId;
  source?: 'gcode' | 'path-document';
  travelRole?: 'rapid-in' | 'lead-in' | 'lead-out';
  travelSource?: 'planned';
  machiningSpanId?: string;
  clippedSourceSegment?: boolean;
  participation?: 'active-cut' | 'inactive-reference';
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

interface BuildEditorPathDocumentPreviewGeometryOptions {
  lineHints?: number[];
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
        bounds: boundsFromPoints([start, point]),
        d: `M ${format(start.x)} ${format(start.y)} L ${format(point.x)} ${format(point.y)}`,
        start,
        end: {
          x: point.x,
          y: point.y
        },
        line: point.line,
        source: 'gcode'
      });
      currentPoint = { x: point.x, y: point.y };
      continue;
    }

    if (point.type === 'arc') {
      paths.push({
        type: 'arc',
        bounds: boundsFromPoints([
          { x: point.startX, y: point.startY },
          { x: point.endX, y: point.endY },
          { x: point.centerX, y: point.centerY }
        ]),
        d: arcPath(point),
        center: {
          x: point.centerX,
          y: point.centerY
        },
        start: {
          x: point.startX,
          y: point.startY
        },
        end: {
          x: point.endX,
          y: point.endY
        },
        line: point.line,
        source: 'gcode'
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

export function buildEditorPathDocumentPreviewGeometry(
  document: PathPlanningDocument,
  options: BuildEditorPathDocumentPreviewGeometryOptions = {}
): EditorPreviewGeometry {
  const padding = options.padding ?? 1;
  const hasParticipation = (document.machiningParticipation?.spans ?? []).some(
    (span) => span.participation === 'inactive-reference'
  );
  const machining = hasParticipation ? deriveActiveMachiningOperations(document) : null;
  const planningDocument = machining?.status === 'ready'
    ? {
        ...document,
        segments: machining.segments,
        plan: { ...document.plan, operations: machining.operations }
      }
    : document;
  const segmentsById = segmentMap(planningDocument.segments);
  const sourceSegmentsById = segmentMap(document.segments);
  const pathElementsByOperationId = new Map(
    document.pathElements
      .filter((element) => element.operationId !== null)
      .map((element) => [element.operationId!, element])
  );
  const paths: EditorPreviewPath[] = [];
  let bounds = emptyBounds();
  const initialWire = resolveInitialWirePosition(document);
  let currentPoint: Point2 | null = initialWire.status === 'ready' ? initialWire.point : null;
  let pathIndex = 0;

  if (hasParticipation) {
    const inactiveSegmentIds = new Set(
      document.machiningParticipation?.spans
        .filter((span) => span.participation === 'inactive-reference')
        .map((span) => span.sourceSegmentId)
    );
    for (const segmentId of inactiveSegmentIds) {
      const segment = sourceSegmentsById.get(segmentId);
      const sourceOperation = document.plan.operations.find((operation) =>
        operation.segmentRefs.some((ref) => ref.segmentId === segmentId)
      );
      if (!segment || !sourceOperation) continue;
      const ref = sourceOperation.segmentRefs.find((candidate) => candidate.segmentId === segmentId)!;
      bounds = mergeBounds(bounds, segment.bounds);
      for (const segmentPath of pathDocumentSegmentPaths(segment, ref)) {
        paths.push({
          type: segmentPath.type,
          bounds: segment.bounds,
          center: 'center' in segmentPath ? segmentPath.center : undefined,
          d: segmentPath.d,
          start: segmentPath.start,
          end: segmentPath.end,
          line: pathLineNumber(options.lineHints, pathIndex++),
          operationId: sourceOperation.id,
          pathElementId: pathElementsByOperationId.get(sourceOperation.id)?.id,
          segmentId,
          source: 'path-document',
          participation: 'inactive-reference'
        });
      }
    }
  }

  for (const operation of planningDocument.plan.operations) {
    bounds = mergeBounds(bounds, pathBounds(operation.segmentRefs, segmentsById));
    const sourceOperationId = operation.machiningIntent?.sourceOperationId ?? operation.id;
    const pathElementId = pathElementsByOperationId.get(sourceOperationId)?.id;
    const entry = readOperationTransitions(operation).entry;
    const leadIn = entry && entry.strategy !== 'none' ? entry : null;
    const entryPoint = leadIn?.from ?? operation.startPoint;
    const rapidStart = currentPoint ?? planningDocument.options.startPoint;
    if (
      !currentPoint ||
      !pathPointsEqual(
        currentPoint,
        entryPoint,
        planningDocument.options.coincidenceEpsilon
      )
    ) {
      const rapidBounds = boundsFromPoints([rapidStart, entryPoint]);
      bounds = mergeBounds(bounds, rapidBounds);
      paths.push({
        type: 'rapid',
        bounds: rapidBounds,
        d: linePath(rapidStart, entryPoint),
        start: rapidStart,
        end: entryPoint,
        line: pathLineNumber(options.lineHints, pathIndex++),
        operationId: sourceOperationId,
        pathElementId,
        source: 'path-document',
        travelRole: 'rapid-in',
        travelSource: 'planned'
      });
    }

    if (
      leadIn &&
      !pathPointsEqual(
        leadIn.from,
        leadIn.to,
        planningDocument.options.coincidenceEpsilon
      )
    ) {
      const leadInBounds = boundsFromPoints([leadIn.from, leadIn.to]);
      bounds = mergeBounds(bounds, leadInBounds);
      paths.push({
        type: 'cut',
        bounds: leadInBounds,
        d: linePath(leadIn.from, leadIn.to),
        start: leadIn.from,
        end: leadIn.to,
        line: pathLineNumber(options.lineHints, pathIndex++),
        operationId: sourceOperationId,
        pathElementId,
        source: 'path-document',
        travelRole: 'lead-in',
        travelSource: 'planned'
      });
    }

    for (const [refIndex, ref] of operation.segmentRefs.entries()) {
      const spanId = operation.machiningIntent?.spanIds[refIndex];
      const span = machining?.status === 'ready'
        ? machining.activeSpans.find((candidate) => candidate.id === spanId)
        : undefined;
      const segment = requiredSegment(segmentsById, ref.segmentId);
      for (const segmentPath of pathDocumentSegmentPaths(segment, ref)) {
        paths.push({
          type: segmentPath.type,
          bounds: segment.bounds,
          center: 'center' in segmentPath ? segmentPath.center : undefined,
          d: segmentPath.d,
          start: segmentPath.start,
          end: segmentPath.end,
          line: pathLineNumber(options.lineHints, pathIndex++),
          operationId: sourceOperationId,
          pathElementId,
          segmentId: span?.sourceSegmentId ?? ref.segmentId,
          machiningSpanId: spanId,
          clippedSourceSegment: span ? span.range.start !== 0 || span.range.end !== 1 : false,
          source: 'path-document',
          participation: hasParticipation ? 'active-cut' : undefined
        });
      }
    }

    const exit = readOperationTransitions(operation).exit;
    if (exit && exit.strategy !== 'none' && !pathPointsEqual(exit.from, exit.to, planningDocument.options.coincidenceEpsilon)) {
      const exitBounds = boundsFromPoints([exit.from, exit.to]);
      bounds = mergeBounds(bounds, exitBounds);
      paths.push({
        type: 'cut', bounds: exitBounds, d: linePath(exit.from, exit.to),
        start: exit.from, end: exit.to,
        line: pathLineNumber(options.lineHints, pathIndex++),
        operationId: sourceOperationId, pathElementId, source: 'path-document',
        travelRole: 'lead-out', travelSource: 'planned'
      });
    }
    currentPoint = exit && exit.strategy !== 'none' ? exit.to : operation.endPoint;
  }

  return {
    markers: pathDocumentPreviewMarkers(planningDocument),
    viewBox: paddedBoundsViewBox(bounds, padding),
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
  const sweepFlag = point.clockwise ? 0 : 1;

  if (radius > 1e-9 && pointsEqual({ x: point.startX, y: point.startY }, { x: point.endX, y: point.endY })) {
    const opposite = {
      x: point.centerX - (point.startX - point.centerX),
      y: point.centerY - (point.startY - point.centerY)
    };

    return [
      `M ${format(point.startX)} ${format(point.startY)}`,
      `A ${format(radius)} ${format(radius)} 0 1 ${sweepFlag} ${format(opposite.x)} ${format(opposite.y)}`,
      `A ${format(radius)} ${format(radius)} 0 1 ${sweepFlag} ${format(point.endX)} ${format(point.endY)}`
    ].join(' ');
  }

  const largeArcFlag = isLargeArc(point) ? 1 : 0;

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

function paddedBoundsViewBox(bounds: Bounds2, padding: number): EditorPreviewViewBox {
  if (!boundsAreFinite(bounds)) {
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

function pathDocumentPreviewMarkers(document: PathPlanningDocument): EditorPreviewMarker[] {
  const firstOperation = document.plan.operations[0];
  if (!firstOperation) return [];
  const initialWire = resolveInitialWirePosition(document);
  const start = initialWire.status === 'ready' ? initialWire.point : firstOperation.startPoint;

  const markers: EditorPreviewMarker[] = [
    {
      type: 'start',
      x: start.x,
      y: start.y,
      label: 'START'
    }
  ];
  const lastOperation = document.plan.operations.at(-1);
  if (lastOperation) {
    const exit = readOperationTransitions(lastOperation).exit;
    const end = exit && exit.strategy !== 'none' ? exit.to : lastOperation.endPoint;
    markers.push({
      type: 'end',
      x: end.x,
      y: end.y,
      label: 'END'
    });
  }

  return markers;
}

function pathLineNumber(lineHints: number[] | undefined, pathIndex: number) {
  return lineHints?.[pathIndex] ?? pathIndex + 1;
}

function pathDocumentSegmentPaths(segment: PathSegment, ref: OrientedSegmentRef) {
  if (segment.kind === 'line') {
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    return [
      {
        type: 'cut' as const,
        d: linePath(start, end),
        start,
        end
      }
    ];
  }

  if (segment.kind === 'circle') return circlePaths(segment, ref);

  const end = orientedSegmentEnd(segment, ref);
  return [
    {
      type: 'arc' as const,
      center: segment.center,
      d: pathDocumentArcPath(segment, ref),
      start: orientedSegmentStart(segment, ref),
      end
    }
  ];
}

function linePath(start: Point2, end: Point2) {
  return `M ${format(start.x)} ${format(start.y)} L ${format(end.x)} ${format(end.y)}`;
}

function pathDocumentArcPath(segment: ArcPathSegment, ref: OrientedSegmentRef) {
  const start = orientedSegmentStart(segment, ref);
  const end = orientedSegmentEnd(segment, ref);
  const sweep = ref.reversed ? -segment.sweepRadians : segment.sweepRadians;
  const largeArcFlag = Math.abs(sweep) > Math.PI ? 1 : 0;
  const sweepFlag = orientedArcClockwise(segment, ref) ? 0 : 1;

  return [
    `M ${format(start.x)} ${format(start.y)}`,
    `A ${format(segment.radius)} ${format(segment.radius)} 0 ${largeArcFlag} ${sweepFlag} ${format(end.x)} ${format(end.y)}`
  ].join(' ');
}

function boundsFromPoints(points: Point2[]): Bounds2 {
  return points.reduce(
    (bounds, point) => ({
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y)
    }),
    emptyBounds()
  );
}

function circlePaths(segment: CirclePathSegment, ref: OrientedSegmentRef) {
  const start = segment.preferredStart;
  const opposite = {
    x: segment.center.x - (start.x - segment.center.x),
    y: segment.center.y - (start.y - segment.center.y)
  };
  const sweepFlag = orientedCircleClockwise(segment, ref) ? 0 : 1;

  return [
    {
      type: 'arc' as const,
      center: segment.center,
      d: [
        `M ${format(start.x)} ${format(start.y)}`,
        `A ${format(segment.radius)} ${format(segment.radius)} 0 1 ${sweepFlag} ${format(opposite.x)} ${format(opposite.y)}`
      ].join(' '),
      start,
      end: opposite
    },
    {
      type: 'arc' as const,
      center: segment.center,
      d: [
        `M ${format(opposite.x)} ${format(opposite.y)}`,
        `A ${format(segment.radius)} ${format(segment.radius)} 0 1 ${sweepFlag} ${format(start.x)} ${format(start.y)}`
      ].join(' '),
      start: opposite,
      end: start
    }
  ];
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
