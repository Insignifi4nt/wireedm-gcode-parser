import type { EditorPreviewPath } from '@/domain/editor/previewGeometry';
import { orientedSegmentEnd, orientedSegmentStart } from '@/domain/path-intel/segments';
import type { OrientedSegmentRef, PathOperation, PathPlanningDocument, PathSegment, Point2 } from '@/domain/path-intel/types';

export interface PreviewPathEndpointHandle {
  operationId: string;
  pathElementId?: string;
  point: Point2;
  role: 'start' | 'end';
  segmentId: string;
}

interface SegmentEndpoints {
  operationId: string;
  pathElementId?: string;
  segmentId: string;
  start: Point2;
  end: Point2;
}

/** Editable handles belong to original sources, including when displayed spans are clipped. */
export function readPathEndpointHandles(
  paths: readonly EditorPreviewPath[], document?: PathPlanningDocument | null
): PreviewPathEndpointHandle[] {
  const sourceSegments = new Map<string, PathSegment>();
  const operationsById = new Map<string, PathOperation>();
  const refsByOperation = new Map<PathOperation, Map<string, OrientedSegmentRef>>();
  if (document && paths.some(path => path.source === 'path-document' && path.clippedSourceSegment)) {
    for (const segment of document.segments) if (!sourceSegments.has(segment.id)) sourceSegments.set(segment.id, segment);
    for (const operation of document.plan.operations) {
      if (operationsById.has(operation.id)) continue;
      operationsById.set(operation.id, operation);
      const refs = new Map<string, OrientedSegmentRef>();
      for (const ref of operation.segmentRefs) if (!refs.has(ref.segmentId)) refs.set(ref.segmentId, ref);
      refsByOperation.set(operation, refs);
    }
  }
  const segmentPaths = new Map<string, { first: SegmentEndpoints; last: SegmentEndpoints }>();
  for (const path of paths) {
    const { operationId, pathElementId, segmentId } = path;
    if (path.source !== 'path-document' || !operationId || !segmentId) continue;
    let start = path.start;
    let end = path.end;
    if (path.clippedSourceSegment) {
      const source = sourceSegments.get(segmentId);
      const operation = operationsById.get(operationId);
      const ref = operation && refsByOperation.get(operation)?.get(segmentId);
      if (!source || !ref) continue;
      start = orientedSegmentStart(source, ref);
      end = orientedSegmentEnd(source, ref);
    }
    const endpoints = { operationId, pathElementId, segmentId, start, end };
    const key = `${operationId}:${pathElementId ?? ''}:${segmentId}`;
    const grouped = segmentPaths.get(key);
    if (grouped) grouped.last = endpoints;
    else segmentPaths.set(key, { first: endpoints, last: endpoints });
  }
  return [...segmentPaths.values()].flatMap(({ first, last }) => {
    const start: PreviewPathEndpointHandle = {
      operationId: first.operationId, pathElementId: first.pathElementId,
      point: first.start, role: 'start', segmentId: first.segmentId
    };
    if (Math.abs(first.start.x - last.end.x) <= 1e-9 && Math.abs(first.start.y - last.end.y) <= 1e-9) return [start];
    return [start, {
      operationId: last.operationId, pathElementId: last.pathElementId,
      point: last.end, role: 'end', segmentId: last.segmentId
    }];
  });
}
