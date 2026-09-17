import type { ExecutionSpatialAction } from './executionSpatialActions';
import { orientedSegmentEnd, orientedSegmentStart } from '@/domain/path-intel/segments';
import type { PathPlanningDocument, Point2 } from '@/domain/path-intel/types';
import type { UpidPathElementRef } from '@/domain/upid/projectRail';

/** Only exact points carry coordinates; selecting a travel or contour line does not. */
export function selectedEditorPoint(
  document: PathPlanningDocument | null,
  element: UpidPathElementRef | null,
  action: ExecutionSpatialAction | null
): Point2 | null {
  if (action) return action.point;
  if (!document || !element?.pointRole || !element.segmentId || element.travelRole) return null;
  const operation = document.plan.operations.find((candidate) => candidate.id === element.operationId);
  const ref = operation?.segmentRefs.find((candidate) => candidate.segmentId === element.segmentId);
  const segment = document.segments.find((candidate) => candidate.id === element.segmentId);
  if (!ref || !segment) return null;
  if (element.pointRole === 'center') return segment.kind === 'line' ? null : segment.center;
  return element.pointRole === 'start'
    ? orientedSegmentStart(segment, ref) : orientedSegmentEnd(segment, ref);
}
