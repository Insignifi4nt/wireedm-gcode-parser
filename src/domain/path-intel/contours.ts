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
import { CAD_PRECISION } from '../precision/cadPrecision';

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
 * catastrophically far from the origin and overflow long before coordinates do.
 * Huge contours can still overflow the cubic centroid terms; only then is the
 * centroid recomputed in a power-of-two scaled frame.
 */
function polygonCentroidOrAverage(points: Point2[], epsilon: number) {
  const clean = stripClosingDuplicate(points, epsilon);
  if (clean.length === 0) return null;
  const direct = relativeCentroidOrAverage(clean);
  if (isFinitePoint(direct)) return direct;
  const scaled = scaledCentroidOrAverage(clean);
  return isFinitePoint(scaled) ? scaled : boundsMidpoint(clean);
}

function relativeCentroidOrAverage(points: readonly Point2[]): Point2 {
  const origin = points[0];
  if (points.length < 3) return averagePoint(points, origin);

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;

  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const currentX = current.x - origin.x;
    const currentY = current.y - origin.y;
    const nextX = next.x - origin.x;
    const nextY = next.y - origin.y;
    const factor = currentX * nextY - nextX * currentY;
    twiceArea += factor;
    cx += (currentX + nextX) * factor;
    cy += (currentY + nextY) * factor;
  }

  if (Math.abs(twiceArea) <= CAD_PRECISION.camDegenerateAreaMm2) return averagePoint(points, origin);

  return {
    x: origin.x + cx / (3 * twiceArea),
    y: origin.y + cy / (3 * twiceArea)
  };
}

function averagePoint(points: readonly Point2[], origin: Point2): Point2 {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x - origin.x;
    y += point.y - origin.y;
  }
  return { x: origin.x + x / points.length, y: origin.y + y / points.length };
}

/**
 * The same centroid with each axis divided by its own powers of two, so the cubic terms
 * stay finite and a tiny extent beside a huge one keeps its precision. The centroid
 * follows axis scaling exactly; the area threshold is compared in square drawing units.
 */
function scaledCentroidOrAverage(points: readonly Point2[]): Point2 {
  const x = scaledAxis(points.map((point) => point.x));
  const y = scaledAxis(points.map((point) => point.y));
  const average = () => ({ x: x.toWorld(mean(x.local)), y: y.toWorld(mean(y.local)) });
  if (points.length < 3) return average();

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < points.length; index++) {
    const next = (index + 1) % points.length;
    const factor = x.local[index] * y.local[next] - x.local[next] * y.local[index];
    twiceArea += factor;
    cx += (x.local[index] + x.local[next]) * factor;
    cy += (y.local[index] + y.local[next]) * factor;
  }

  // Logarithms avoid forming a scaled area that could itself overflow or underflow.
  if (Math.log2(Math.abs(twiceArea)) + x.log2Scale + y.log2Scale <= Math.log2(CAD_PRECISION.camDegenerateAreaMm2)) return average();
  const centroid = { x: x.toWorld(cx / (3 * twiceArea)), y: y.toWorld(cy / (3 * twiceArea)) };
  return isFinitePoint(centroid) ? centroid : average();
}

/** One axis relative to its first value, divided by powers of two, which is exact short of underflow. */
function scaledAxis(values: readonly number[]) {
  const absoluteScale = powerOfTwoScale(maxMagnitude(values));
  const absolute = values.map((value) => value / absoluteScale);
  const shifted = absolute.map((value) => value - absolute[0]);
  const relativeScale = powerOfTwoScale(maxMagnitude(shifted));
  return {
    local: shifted.map((value) => value / relativeScale),
    log2Scale: Math.log2(relativeScale) + Math.log2(absoluteScale),
    // One factor at a time; their product alone can exceed the number range.
    toWorld: (value: number) => values[0] + value * relativeScale * absoluteScale
  };
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxMagnitude(values: readonly number[]) {
  return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}

/** Largest power of two not above the magnitude, capped at the largest finite one; 1 for zero. */
function powerOfTwoScale(magnitude: number) {
  return magnitude > 0 && Number.isFinite(magnitude) ? 2 ** Math.min(1023, Math.floor(Math.log2(magnitude))) : 1;
}

/** Halves before adding, so the midpoint of finite bounds is always finite. */
function boundsMidpoint(points: Point2[]): Point2 {
  const bounds = boundsFromPolygon(points);
  return { x: bounds.minX / 2 + bounds.maxX / 2, y: bounds.minY / 2 + bounds.maxY / 2 };
}

function isFinitePoint(point: Point2) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function stripClosingDuplicate(points: Point2[], epsilon = CAD_PRECISION.camClosingDuplicateMm) {
  if (points.length <= 1) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  if (distance(first, last) <= epsilon) return points.slice(0, -1);
  return points.slice();
}
