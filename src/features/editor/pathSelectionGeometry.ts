import type { Bounds2, PathPlanningDocument, PathSegment, Point2 } from '@/domain/path-intel/types';
import type { UpidPathElementRef } from '@/domain/upid/projectRail';

export function readPathSelectionBoundsCenter(
  document: PathPlanningDocument,
  selectedPathElement: UpidPathElementRef | null,
  selectedPathOperationId: string | null
): Point2 | null {
  const bounds = readPathSelectionBounds(document, selectedPathElement, selectedPathOperationId);
  if (!bounds || !boundsAreFinite(bounds)) return null;

  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
}

function readPathSelectionBounds(
  document: PathPlanningDocument,
  selectedPathElement: UpidPathElementRef | null,
  selectedPathOperationId: string | null
): Bounds2 | null {
  if (selectedPathElement?.segmentId) {
    return document.segments.find((segment) => segment.id === selectedPathElement.segmentId)?.bounds ?? null;
  }

  if (selectedPathElement?.pathElementId) {
    return document.pathElements.find((element) => element.id === selectedPathElement.pathElementId)?.bounds ?? null;
  }

  if (!selectedPathOperationId) return null;

  const operation = document.plan.operations.find((candidate) => candidate.id === selectedPathOperationId);
  if (!operation) return null;

  const segmentsById = new Map(document.segments.map((segment) => [segment.id, segment]));
  return mergeSegmentBounds(
    operation.segmentRefs
      .map((ref) => segmentsById.get(ref.segmentId))
      .filter((segment): segment is PathSegment => Boolean(segment))
  );
}

function mergeSegmentBounds(segments: PathSegment[]): Bounds2 | null {
  if (segments.length === 0) return null;

  return segments.reduce(
    (bounds, segment) => ({
      minX: Math.min(bounds.minX, segment.bounds.minX),
      minY: Math.min(bounds.minY, segment.bounds.minY),
      maxX: Math.max(bounds.maxX, segment.bounds.maxX),
      maxY: Math.max(bounds.maxY, segment.bounds.maxY)
    }),
    {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    }
  );
}

function boundsAreFinite(bounds: Bounds2) {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite);
}
