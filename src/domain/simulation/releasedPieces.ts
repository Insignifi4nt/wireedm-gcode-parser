import { approximatePath, segmentMap } from '@/domain/path-intel/segments';
import type { PathPlanningDocument, Point2 } from '@/domain/path-intel/types';

import { distance, pointInPolygon, polygonArea } from './geometry';
import { unsupportedMaterialPolygons } from './materialTopology';
import type {
  ResolvedSimulationSettings, SimulationDiagnostic, SimulationPiece, SimulationPieceSnapshot, SimulationStep
} from './types';

const GRAVITY_MM_PER_SECOND_SQUARED = 9810;

export function compileReleasedPieces(
  document: PathPlanningDocument,
  steps: readonly SimulationStep[],
  settings: ResolvedSimulationSettings
): { pieces: SimulationPiece[]; diagnostics: SimulationDiagnostic[] } {
  const segments = segmentMap(document.segments);
  const diagnostics: SimulationDiagnostic[] = [];
  const coverage = new Map<string, Array<{ start: number; end: number }>>();
  const released = new Set<string>();
  const polygons = new Map<string, Point2[]>();
  const candidates = document.plan.operations.filter((operation) => operation.closed && operation.segmentRefs.length > 0);
  for (const operation of candidates) {
    const polygon = approximatePath(operation.segmentRefs, segments, Math.PI / 90).map((point) => ({ ...point }));
    if (polygon.length < 3 || distance(polygon[0], polygon.at(-1)!) > Math.max(1e-8, document.options.coincidenceEpsilon)) continue;
    polygon.pop();
    if (polygonArea(polygon) <= 1e-12) continue;
    let stockClearance = Infinity;
    for (const ref of operation.segmentRefs) {
      const bounds = segments.get(ref.segmentId)!.bounds;
      const stock = settings.stock;
      stockClearance = Math.min(stockClearance, bounds.minX - stock.originX, stock.originX + stock.width - bounds.maxX,
        bounds.minY - stock.originY, stock.originY + stock.depth - bounds.maxY);
    }
    if (stockClearance < -1e-8) {
      diagnostics.push({ code: 'SIMULATION_BOUNDARY_OUTSIDE_STOCK', severity: 'warning', operationId: operation.id,
        message: `${operation.displayName} extends outside the rough stock. Its released shape cannot be represented by this simulation.` });
      continue;
    }
    if (stockClearance <= 1e-8) {
      diagnostics.push({ code: 'SIMULATION_MATERIAL_TOPOLOGY_UNSUPPORTED', severity: 'warning', operationId: operation.id,
        message: `${operation.displayName} touches the rough-stock edge. Edge-connected cutouts require a material boundary reconstruction that this preview does not support; its material removal and released piece are omitted. The wire path remains visible.` });
      continue;
    }
    polygons.set(operation.id, polygon);
  }
  const candidatesBySegment = new Map<string, Array<{
    operation: (typeof candidates)[number]; polygon: Point2[]; boundaryKey: string;
  }>>();
  for (const operation of candidates) {
    const polygon = polygons.get(operation.id);
    if (!polygon) continue;
    const segmentIds = [...new Set(operation.segmentRefs.map(({ segmentId }) => segmentId))].sort();
    const candidate = { operation, polygon, boundaryKey: segmentIds.join('\u0000') };
    for (const segmentId of segmentIds) {
      const related = candidatesBySegment.get(segmentId) ?? [];
      related.push(candidate);
      candidatesBySegment.set(segmentId, related);
    }
  }
  const pieces: SimulationPiece[] = [];
  for (const step of steps) {
    const event = step.event;
    if (event.kind !== 'motion' || event.role !== 'contour' || !event.sourceSegmentId || !event.sourceRange) continue;
    const ranges = coverage.get(event.sourceSegmentId) ?? [];
    ranges.push({ start: Math.min(event.sourceRange.start, event.sourceRange.end), end: Math.max(event.sourceRange.start, event.sourceRange.end) });
    coverage.set(event.sourceSegmentId, ranges);
    for (const { operation, polygon, boundaryKey } of candidatesBySegment.get(event.sourceSegmentId) ?? []) {
      if (released.has(boundaryKey) || !operation.segmentRefs.every(({ segmentId }) => completeCoverage(coverage.get(segmentId) ?? []))) continue;
      released.add(boundaryKey);
      pieces.push({ id: `piece:${operation.id}`, operationId: operation.id, polygon,
        releaseSeconds: step.endSeconds, releaseEventId: event.id, parentPieceId: null });
    }
  }
  const topology = unsupportedMaterialPolygons(pieces);
  if (topology.budgetExceeded) diagnostics.push({ code: 'SIMULATION_MATERIAL_TOPOLOGY_LIMIT', severity: 'warning', operationId: null,
    message: 'Material boundary checking reached its geometry budget. Material removal and released pieces are omitted because their mesh topology could not be verified; wire playback remains available.' });
  else for (const piece of pieces) if (topology.ids.has(piece.id)) diagnostics.push({
    code: 'SIMULATION_MATERIAL_TOPOLOGY_UNSUPPORTED', severity: 'warning', operationId: piece.operationId,
    message: 'Sampled material boundaries cross or touch at this preview resolution. Their material removal and released pieces are omitted to avoid overlapping polygons; the exact wire motion remains available.'
  });
  const nested = associateParents(pieces.filter(piece => !topology.ids.has(piece.id)));
  const accepted: SimulationPiece[] = [];
  const acceptedIds = new Set<string>();
  const byId = new Map(nested.map((piece) => [piece.id, piece]));
  for (const piece of nested) {
    let enclosingRelease = Infinity;
    let ancestor = piece.parentPieceId ? byId.get(piece.parentPieceId) : undefined;
    while (ancestor) {
      if (acceptedIds.has(ancestor.id)) enclosingRelease = Math.min(enclosingRelease, ancestor.releaseSeconds);
      ancestor = ancestor.parentPieceId ? byId.get(ancestor.parentPieceId) : undefined;
    }
    const elapsed = Math.max(0, piece.releaseSeconds - enclosingRelease);
    const lowerWire = settings.stock.bottomZ - settings.guideClearanceMm;
    const bottomAtCompletion = Math.max(settings.supportFloorZ ?? -Infinity,
      settings.stock.bottomZ - 0.5 * GRAVITY_MM_PER_SECOND_SQUARED * elapsed * elapsed);
    if (settings.retention === 'fall' && bottomAtCompletion < lowerWire - 1e-8) {
      diagnostics.push({ code: 'SIMULATION_CUT_BELOW_WIRE', severity: 'warning', operationId: piece.operationId,
        message: 'An enclosing piece has already fallen partly below the vertical wire before this boundary finishes. A new through-cut release is not predicted.' });
    } else {
      accepted.push(piece);
      acceptedIds.add(piece.id);
    }
  }
  return { diagnostics, pieces: associateParents(accepted) };
}

function associateParents(pieces: readonly SimulationPiece[]): SimulationPiece[] {
  return pieces.map((piece) => {
    const parents = pieces.filter((other) => other.id !== piece.id && polygonArea(other.polygon) > polygonArea(piece.polygon)
      && piece.polygon.every((point) => pointInPolygon(point, other.polygon)));
    parents.sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
    return { ...piece, parentPieceId: parents[0]?.id ?? null };
  });
}

function completeCoverage(ranges: readonly { start: number; end: number }[]): boolean {
  let coveredUntil = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    // Do not fill even a small uncut bridge simply because the source contour is closed.
    if (range.start > coveredUntil) return false;
    coveredUntil = Math.max(coveredUntil, range.end);
  }
  return coveredUntil >= 1;
}

export function releasedPieceSnapshots(
  pieces: readonly SimulationPiece[], settings: ResolvedSimulationSettings, elapsedSeconds: number
): { pieces: SimulationPieceSnapshot[]; stockHoles: (readonly Point2[])[] } {
  const released = pieces.filter(({ releaseSeconds }) => releaseSeconds <= elapsedSeconds);
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const releasedIds = new Set(released.map(({ id }) => id));
  function nearestReleasedParent(piece: SimulationPiece): SimulationPiece | null {
    let parent = piece.parentPieceId ? byId.get(piece.parentPieceId) : undefined;
    while (parent && !releasedIds.has(parent.id)) parent = parent.parentPieceId ? byId.get(parent.parentPieceId) : undefined;
    return parent ?? null;
  }
  const parents = new Map(released.map((piece) => [piece.id, nearestReleasedParent(piece)?.id ?? null]));
  const holesByParent = new Map<string, (readonly Point2[])[]>();
  for (const piece of released) {
    const parentId = parents.get(piece.id);
    if (!parentId) continue;
    const holes = holesByParent.get(parentId) ?? [];
    holes.push(piece.polygon);
    holesByParent.set(parentId, holes);
  }
  return {
    stockHoles: released.filter(({ id }) => parents.get(id) === null).map(({ polygon }) => polygon),
    pieces: released.map((piece) => {
      // An earlier enclosing release carries still-attached inner material with it.
      let fallStart = piece.releaseSeconds;
      let ancestor = piece.parentPieceId ? byId.get(piece.parentPieceId) : undefined;
      while (ancestor) {
        fallStart = Math.min(fallStart, ancestor.releaseSeconds);
        ancestor = ancestor.parentPieceId ? byId.get(ancestor.parentPieceId) : undefined;
      }
      const elapsed = Math.max(0, elapsedSeconds - fallStart);
      const freeBottom = settings.stock.bottomZ - 0.5 * GRAVITY_MM_PER_SECOND_SQUARED * elapsed * elapsed;
      const bottomZ = settings.retention === 'retain' ? settings.stock.bottomZ
        : Math.max(settings.supportFloorZ ?? -Infinity, freeBottom);
      return { id: piece.id, operationId: piece.operationId, polygon: piece.polygon,
        holes: holesByParent.get(piece.id) ?? [],
        bottomZ, topZ: bottomZ + settings.stock.thickness,
        state: settings.retention === 'retain' ? 'retained'
          : settings.supportFloorZ !== null && bottomZ <= settings.supportFloorZ ? 'supported' : 'falling' };
    })
  };
}

export function settlingDuration(settings: ResolvedSimulationSettings): number {
  if (settings.retention === 'retain') return 0;
  return settings.supportFloorZ === null ? 2
    : Math.max(0.5, Math.sqrt(2 * (settings.stock.bottomZ - settings.supportFloorZ) / GRAVITY_MM_PER_SECOND_SQUARED));
}
