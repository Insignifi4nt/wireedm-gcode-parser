import {
  approximatePath,
  boundsAreFinite,
  distance,
  mergeBounds,
  pathBounds,
  pathStartPoint,
  segmentMap,
  signedAreaOfPath
} from './segments';
import { expandBounds, findPathSegmentIntersectionDiagnostics } from './intersections';
import { closedPathContainsPoint } from './pathContainment';
import { SpatialHash } from './spatialIndex';
import type {
  Bounds2,
  ContourAnalysisResult,
  ContourClassification,
  ContourOrientation,
  PathChain,
  PathContour,
  PathDiagnostic,
  PathElementProvenance,
  PathPlanningOptions,
  PathSegment,
  Point2
} from './types';
import { resolvePathPlanningOptions } from './segments';

export function analyzeContours(
  chains: PathChain[],
  segments: PathSegment[],
  options: PathPlanningOptions = {}
): ContourAnalysisResult {
  const resolved = resolvePathPlanningOptions(options);
  const segmentsById = segmentMap(segments);
  const intersectionDiagnostics = findPathSegmentIntersectionDiagnostics(
    segments,
    chains,
    resolved
  );
  const diagnostics: PathDiagnostic[] = [...intersectionDiagnostics];
  const intersectionDiagnosticsByChainId = groupDiagnosticsByChainId(intersectionDiagnostics);

  const contours: PathContour[] = chains.map((chain, index) => {
    const id = `contour_${String(index + 1).padStart(4, '0')}`;
    const approximatePolygon = approximatePath(chain.segmentRefs, segmentsById, resolved.approximationMaxAngleRadians);
    const bounds = boundsAreFinite(pathBounds(chain.segmentRefs, segmentsById))
      ? pathBounds(chain.segmentRefs, segmentsById)
      : boundsFromPolygon(approximatePolygon);
    const chainIntersectionDiagnostics = intersectionDiagnosticsByChainId.get(chain.id) ?? [];
    const diagnosticIds = [
      ...chain.diagnosticIds,
      ...chainIntersectionDiagnostics.map((diagnostic) => diagnostic.id)
    ];
    const provenance = summarizePathProvenance(chain.segmentRefs.map((ref) => segmentsById.get(ref.segmentId)));

    if (!chain.closed) {
      return {
        id,
        label: contourLabel(index),
        provenance,
        chainId: chain.id,
        closed: false,
        classification: 'open-chain',
        signedArea: null,
        area: null,
        orientation: null,
        bounds,
        containmentDepth: 0,
        parentId: null,
        childIds: [],
        representativePoint: null,
        approximatePolygon,
        confidence: 0.35,
        diagnosticIds
      };
    }

    const signedArea = signedAreaOfPath(chain.segmentRefs, segmentsById);
    const area = Math.abs(signedArea);
    if (!Number.isFinite(signedArea) || !Number.isFinite(area)) {
      const diagnostic: PathDiagnostic = {
        id: `diag_contour_${String(diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'error',
        code: 'non-finite-geometry',
        message: `Closed chain ${chain.id} produced a non-finite contour area; geometric metrics and classification were suppressed.`,
        relatedChainIds: [chain.id],
        relatedSegmentIds: chain.segmentRefs.map((ref) => ref.segmentId),
        relatedContourIds: [id],
        details: {
          metric: 'signed-area',
          result: Number.isNaN(signedArea) ? 'nan' : 'infinite'
        }
      };
      diagnostics.push(diagnostic);
      diagnosticIds.push(diagnostic.id);

      return {
        id,
        label: contourLabel(index),
        provenance,
        chainId: chain.id,
        closed: true,
        classification: 'ambiguous',
        signedArea: null,
        area: null,
        orientation: null,
        bounds,
        containmentDepth: 0,
        parentId: null,
        childIds: [],
        representativePoint: null,
        approximatePolygon,
        confidence: 0,
        diagnosticIds
      };
    }

    const orientation = orientationFromArea(signedArea, resolved.coincidenceEpsilon);
    const representativePoint = polygonCentroidOrAverage(approximatePolygon, resolved.coincidenceEpsilon);
    const intersects = chainIntersectionDiagnostics.length > 0;
    let classification: ContourClassification = 'ambiguous';
    let confidence = 0.95;

    if (intersects) {
      confidence = 0.2;
    } else if (area <= resolved.coincidenceEpsilon) {
      const diagnostic: PathDiagnostic = {
        id: `diag_contour_${String(diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'warning',
        code: 'degenerate-contour',
        message: `Closed chain ${chain.id} has near-zero signed area; classification is ambiguous.`,
        relatedChainIds: [chain.id],
        relatedSegmentIds: chain.segmentRefs.map((ref) => ref.segmentId),
        relatedContourIds: [id],
        details: { signedArea }
      };
      diagnostics.push(diagnostic);
      diagnosticIds.push(diagnostic.id);
      confidence = 0.25;
    } else {
      classification = 'exterior';
    }

    return {
      id,
      label: contourLabel(index),
      provenance,
      chainId: chain.id,
      closed: true,
      classification,
      signedArea,
      area,
      orientation,
      bounds,
      containmentDepth: 0,
      parentId: null,
      childIds: [],
      representativePoint,
      approximatePolygon,
      confidence,
      diagnosticIds
    };
  });

  assignContainment(contours, chains, segmentsById, resolved.coincidenceEpsilon);

  const contourIdByChainId = new Map(contours.map((contour) => [contour.chainId, contour.id]));
  for (const diagnostic of intersectionDiagnostics) {
    diagnostic.relatedContourIds = [
      ...new Set(
        (diagnostic.relatedChainIds ?? [])
          .map((chainId) => contourIdByChainId.get(chainId))
          .filter((contourId): contourId is string => Boolean(contourId))
      )
    ];
  }

  return { contours, diagnostics };
}

function groupDiagnosticsByChainId(diagnostics: readonly PathDiagnostic[]) {
  const byChainId = new Map<string, PathDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    for (const chainId of new Set(diagnostic.relatedChainIds ?? [])) {
      const chainDiagnostics = byChainId.get(chainId);
      if (chainDiagnostics) chainDiagnostics.push(diagnostic);
      else byChainId.set(chainId, [diagnostic]);
    }
  }
  return byChainId;
}

function contourLabel(index: number) {
  return `Contour ${index + 1}`;
}

function summarizePathProvenance(segments: Array<PathSegment | undefined>): PathElementProvenance {
  const entityIndices = new Set<number>();
  const entityHandles = new Set<string>();
  const entityTypes = new Set<string>();
  const dxfBlockNames = new Set<string>();
  const dxfInsertBlockNames = new Set<string>();
  const layers = new Set<string | null>();
  let exact = true;
  let insertedSegmentCount = 0;

  for (const segment of segments) {
    if (!segment) {
      exact = false;
      continue;
    }

    entityIndices.add(segment.source.sourceEntityIndex);
    if (segment.source.sourceEntityHandle) {
      entityHandles.add(segment.source.sourceEntityHandle);
    }
    entityTypes.add(segment.source.sourceEntityType);
    layers.add(segment.source.layer);
    if (segment.source.dxf?.blockName) {
      dxfBlockNames.add(segment.source.dxf.blockName);
    }
    if ((segment.source.dxf?.insertChain.length ?? 0) > 0) {
      insertedSegmentCount += 1;
      for (const insert of segment.source.dxf?.insertChain ?? []) {
        dxfInsertBlockNames.add(insert.blockName);
      }
    }
    exact = exact && segment.source.exact;
  }

  const dxf =
    dxfBlockNames.size > 0 || dxfInsertBlockNames.size > 0 || insertedSegmentCount > 0
      ? {
          blockNames: [...dxfBlockNames].sort(),
          insertBlockNames: [...dxfInsertBlockNames].sort(),
          insertedSegmentCount
        }
      : undefined;

  return {
    sourceEntityIndices: [...entityIndices].sort((first, second) => first - second),
    ...(entityHandles.size > 0 ? { sourceEntityHandles: [...entityHandles].sort() } : {}),
    sourceEntityTypes: [...entityTypes].sort(),
    layers: [...layers].sort(compareNullableText),
    exact,
    ...(dxf ? { dxf } : {})
  };
}

function compareNullableText(first: string | null, second: string | null) {
  if (first === second) return 0;
  if (first === null) return 1;
  if (second === null) return -1;
  return first.localeCompare(second);
}

function assignContainment(
  contours: PathContour[], chains: PathChain[], segmentsById: Map<string, PathSegment>, epsilon: number
) {
  const chainsById = new Map(chains.map((chain) => [chain.id, chain]));
  const closedSimple = contours.filter(
    (contour) => contour.closed && contour.classification !== 'ambiguous'
  );
  const possibleContainers = containerCandidateLookup(closedSimple, epsilon);

  for (const contour of closedSimple) {
    // Disjoint simple boundaries lie entirely inside or outside each other. A point
    // on this boundary is a valid witness; a concave polygon's centroid is not.
    const witness = pathStartPoint(chainsById.get(contour.chainId)!.segmentRefs, segmentsById);
    const containers = possibleContainers(contour)
      .filter((candidate) => candidate.id !== contour.id && (candidate.area ?? 0) > (contour.area ?? 0) + epsilon)
      .filter((candidate) => boundsContain(candidate.bounds, contour.bounds, epsilon))
      .filter((candidate) => witness && closedPathContainsPoint(
        chainsById.get(candidate.chainId)!.segmentRefs, witness, segmentsById
      ))
      .sort((a, b) => (a.area ?? 0) - (b.area ?? 0));

    contour.containmentDepth = containers.length;
    contour.parentId = containers[0]?.id ?? null;
    contour.classification = classificationFromDepth(contour.containmentDepth);
    contour.confidence = Math.max(0.5, contour.confidence - Math.min(0.2, contour.containmentDepth * 0.03));
  }

  for (const contour of contours) {
    contour.childIds = [];
  }

  const contoursById = new Map<string, PathContour>();
  for (const contour of contours) {
    if (!contoursById.has(contour.id)) contoursById.set(contour.id, contour);
  }
  for (const contour of contours) {
    if (!contour.parentId) continue;
    contoursById.get(contour.parentId)?.childIds.push(contour.id);
  }
}

/**
 * Returns, in contour order, every contour whose bounds could contain the given contour's bounds
 * within epsilon. Contours with unusable bounds or epsilon fall back to listing every contour.
 */
function containerCandidateLookup(contours: PathContour[], epsilon: number): (contour: PathContour) => PathContour[] {
  const indexable = Number.isFinite(epsilon) && contours.every(({ bounds }) =>
    boundsAreFinite(bounds) && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY);
  if (!indexable || contours.length < 2) return () => contours;

  const spans = contours
    .map(({ bounds }) => Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY))
    .filter((span) => Number.isFinite(span) && span > 0)
    .sort((left, right) => left - right);
  const index = new SpatialHash<PathContour>({ cellSize: spans[Math.floor(spans.length / 2)] ?? 1, maxCellsPerBounds: 64 });
  for (const contour of contours) index.insertBounds(contour.bounds, contour);
  // A container's bounds reach within epsilon of every side, so they meet the expanded bounds.
  return (contour) => index.queryBounds(expandBounds(contour.bounds, epsilon));
}

function boundsContain(outer: Bounds2, inner: Bounds2, epsilon: number) {
  return outer.minX <= inner.minX + epsilon && outer.minY <= inner.minY + epsilon &&
    outer.maxX >= inner.maxX - epsilon && outer.maxY >= inner.maxY - epsilon;
}

function classificationFromDepth(depth: number): ContourClassification {
  if (depth === 0) return 'exterior';
  return depth % 2 === 1 ? 'hole' : 'island';
}

function orientationFromArea(signedArea: number, epsilon: number): ContourOrientation {
  if (Math.abs(signedArea) <= epsilon) return 'degenerate';
  return signedArea > 0 ? 'ccw' : 'cw';
}

function boundsFromPolygon(points: Point2[]): Bounds2 {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  return points.reduce(
    (bounds, point) =>
      mergeBounds(bounds, {
        minX: point.x,
        minY: point.y,
        maxX: point.x,
        maxY: point.y
      }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

/**
 * Works relative to the first vertex. Absolute shoelace products cancel
 * catastrophically far from the origin. Coordinates are also rescaled by powers
 * of two, which is exact, so the cubic centroid terms cannot overflow for huge
 * contours while results stay bit-identical wherever they were finite before.
 */
function polygonCentroidOrAverage(points: Point2[], epsilon: number) {
  const clean = stripClosingDuplicate(points, epsilon);
  if (clean.length === 0) return null;
  const frame = scaledFrame(clean);
  if (clean.length < 3) return averagePoint(frame);

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;

  for (let index = 0; index < frame.points.length; index++) {
    const current = frame.points[index];
    const next = frame.points[(index + 1) % frame.points.length];
    const factor = current.x * next.y - next.x * current.y;
    twiceArea += factor;
    cx += (current.x + next.x) * factor;
    cy += (current.y + next.y) * factor;
  }

  // The degenerate-area threshold stays in square drawing units.
  if (Math.abs(twiceArea) * frame.relativeScale * frame.relativeScale * frame.absoluteScale * frame.absoluteScale <= 1e-9) {
    return averagePoint(frame);
  }
  return frameToWorld(frame, cx / (3 * twiceArea), cy / (3 * twiceArea)) ?? averagePoint(frame);
}

interface ScaledFrame {
  readonly origin: Point2;
  readonly absoluteScale: number;
  readonly relativeScale: number;
  /** Vertices relative to origin, divided by absoluteScale * relativeScale. */
  readonly points: readonly Point2[];
  /** Vertices divided by absoluteScale, for the overflow-free mean. */
  readonly absolutePoints: readonly Point2[];
}

function scaledFrame(points: readonly Point2[]): ScaledFrame {
  const absoluteScale = powerOfTwoScale(points.reduce((max, { x, y }) => Math.max(max, Math.abs(x), Math.abs(y)), 0));
  const absolutePoints = points.map(({ x, y }) => ({ x: x / absoluteScale, y: y / absoluteScale }));
  const origin = absolutePoints[0];
  const shifted = absolutePoints.map(({ x, y }) => ({ x: x - origin.x, y: y - origin.y }));
  const relativeScale = powerOfTwoScale(shifted.reduce((max, { x, y }) => Math.max(max, Math.abs(x), Math.abs(y)), 0));
  return {
    origin: points[0],
    absoluteScale,
    relativeScale,
    points: shifted.map(({ x, y }) => ({ x: x / relativeScale, y: y / relativeScale })),
    absolutePoints
  };
}

/** Largest power of two not above the magnitude; 1 for zero. Dividing by it is exact. */
function powerOfTwoScale(magnitude: number) {
  return magnitude > 0 && Number.isFinite(magnitude) ? 2 ** Math.floor(Math.log2(magnitude)) : 1;
}

function frameToWorld(frame: ScaledFrame, x: number, y: number): Point2 | null {
  const world = {
    x: frame.origin.x + x * frame.relativeScale * frame.absoluteScale,
    y: frame.origin.y + y * frame.relativeScale * frame.absoluteScale
  };
  return Number.isFinite(world.x) && Number.isFinite(world.y) ? world : null;
}

function averagePoint(frame: ScaledFrame): Point2 {
  let x = 0;
  let y = 0;
  for (const point of frame.points) {
    x += point.x;
    y += point.y;
  }
  const relative = frameToWorld(frame, x / frame.points.length, y / frame.points.length);
  if (relative) return relative;
  // Offsets wider than the number range: average the absolute-scaled vertices instead.
  let ax = 0;
  let ay = 0;
  for (const point of frame.absolutePoints) {
    ax += point.x;
    ay += point.y;
  }
  return { x: (ax / frame.absolutePoints.length) * frame.absoluteScale, y: (ay / frame.absolutePoints.length) * frame.absoluteScale };
}

function stripClosingDuplicate(points: Point2[], epsilon = 1e-9) {
  if (points.length <= 1) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  if (distance(first, last) <= epsilon) return points.slice(0, -1);
  return points.slice();
}
