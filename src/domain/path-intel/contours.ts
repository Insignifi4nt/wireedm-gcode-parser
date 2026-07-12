import {
  approximatePath,
  boundsAreFinite,
  cross,
  distance,
  mergeBounds,
  pathBounds,
  segmentMap,
  signedAreaOfPath,
  vector
} from './segments';
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
  const diagnostics: PathDiagnostic[] = [];

  const contours: PathContour[] = chains.map((chain, index) => {
    const id = `contour_${String(index + 1).padStart(4, '0')}`;
    const approximatePolygon = approximatePath(chain.segmentRefs, segmentsById, resolved.approximationMaxAngleRadians);
    const bounds = boundsAreFinite(pathBounds(chain.segmentRefs, segmentsById))
      ? pathBounds(chain.segmentRefs, segmentsById)
      : boundsFromPolygon(approximatePolygon);
    const diagnosticIds = [...chain.diagnosticIds];
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
    const selfIntersects = hasSelfIntersection(approximatePolygon, resolved.coincidenceEpsilon);
    let classification: ContourClassification = 'ambiguous';
    let confidence = 0.95;

    if (selfIntersects) {
      const diagnostic: PathDiagnostic = {
        id: `diag_contour_${String(diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'warning',
        code: 'self-intersection',
        message: `Closed chain ${chain.id} appears to self-intersect after arc approximation; classification is ambiguous.`,
        relatedChainIds: [chain.id],
        relatedSegmentIds: chain.segmentRefs.map((ref) => ref.segmentId),
        relatedContourIds: [id]
      };
      diagnostics.push(diagnostic);
      diagnosticIds.push(diagnostic.id);
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

  assignContainment(contours, resolved.coincidenceEpsilon);

  return { contours, diagnostics };
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

function assignContainment(contours: PathContour[], epsilon: number) {
  const closedSimple = contours.filter(
    (contour) => contour.closed && contour.classification !== 'ambiguous' && contour.representativePoint
  );

  for (const contour of closedSimple) {
    const containers = closedSimple
      .filter((candidate) => candidate.id !== contour.id && (candidate.area ?? 0) > (contour.area ?? 0) + epsilon)
      .filter((candidate) => pointInPolygon(contour.representativePoint!, candidate.approximatePolygon, epsilon))
      .sort((a, b) => (a.area ?? 0) - (b.area ?? 0));

    contour.containmentDepth = containers.length;
    contour.parentId = containers[0]?.id ?? null;
    contour.classification = classificationFromDepth(contour.containmentDepth);
    contour.confidence = Math.max(0.5, contour.confidence - Math.min(0.2, contour.containmentDepth * 0.03));
  }

  for (const contour of contours) {
    contour.childIds = [];
  }

  for (const contour of contours) {
    if (!contour.parentId) continue;
    const parent = contours.find((candidate) => candidate.id === contour.parentId);
    parent?.childIds.push(contour.id);
  }
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

function polygonCentroidOrAverage(points: Point2[], epsilon: number) {
  const clean = stripClosingDuplicate(points, epsilon);
  if (clean.length === 0) return null;
  if (clean.length < 3) return averagePoint(clean);

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;

  for (let index = 0; index < clean.length; index++) {
    const current = clean[index];
    const next = clean[(index + 1) % clean.length];
    const factor = current.x * next.y - next.x * current.y;
    twiceArea += factor;
    cx += (current.x + next.x) * factor;
    cy += (current.y + next.y) * factor;
  }

  if (Math.abs(twiceArea) <= 1e-9) return averagePoint(clean);

  return {
    x: cx / (3 * twiceArea),
    y: cy / (3 * twiceArea)
  };
}

function averagePoint(points: Point2[]): Point2 {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), {
    x: 0,
    y: 0
  });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function pointInPolygon(point: Point2, polygon: Point2[], epsilon = 1e-9) {
  const clean = stripClosingDuplicate(polygon, epsilon);
  let inside = false;

  for (let index = 0, previousIndex = clean.length - 1; index < clean.length; previousIndex = index++) {
    const current = clean[index];
    const previous = clean[previousIndex];

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

function hasSelfIntersection(points: Point2[], epsilon: number) {
  const clean = stripClosingDuplicate(points, epsilon);
  if (clean.length < 4) return false;

  for (let first = 0; first < clean.length; first++) {
    const a1 = clean[first];
    const a2 = clean[(first + 1) % clean.length];

    for (let second = first + 1; second < clean.length; second++) {
      const b1 = clean[second];
      const b2 = clean[(second + 1) % clean.length];

      const adjacent = first === second || (first + 1) % clean.length === second || first === (second + 1) % clean.length;
      if (adjacent) continue;

      if (segmentsIntersect(a1, a2, b1, b2, epsilon)) return true;
    }
  }

  return false;
}

function segmentsIntersect(a1: Point2, a2: Point2, b1: Point2, b2: Point2, epsilon: number) {
  const r = vector(a1, a2);
  const s = vector(b1, b2);
  const denominator = cross(r, s);
  const qp = vector(a1, b1);

  if (Math.abs(denominator) <= epsilon) {
    if (Math.abs(cross(qp, r)) > epsilon) return false;
    return rangesOverlap(a1.x, a2.x, b1.x, b2.x, epsilon) && rangesOverlap(a1.y, a2.y, b1.y, b2.y, epsilon);
  }

  const t = cross(qp, s) / denominator;
  const u = cross(qp, r) / denominator;
  return t > epsilon && t < 1 - epsilon && u > epsilon && u < 1 - epsilon;
}

function rangesOverlap(a: number, b: number, c: number, d: number, epsilon: number) {
  const minA = Math.min(a, b);
  const maxA = Math.max(a, b);
  const minB = Math.min(c, d);
  const maxB = Math.max(c, d);
  return Math.max(minA, minB) <= Math.min(maxA, maxB) + epsilon;
}

function stripClosingDuplicate(points: Point2[], epsilon = 1e-9) {
  if (points.length <= 1) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  if (distance(first, last) <= epsilon) return points.slice(0, -1);
  return points.slice();
}
