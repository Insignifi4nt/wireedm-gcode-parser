import type { PathPlanningDocument, Point2 } from './types';

export type InitialWirePositionResolution =
  | { status: 'ready'; point: Point2; source: 'manual' | 'geometry-linked' }
  | { status: 'blocked'; reason: 'missing' | 'review-required' | 'missing-reference' | 'invalid-point' };

export function resolveInitialWirePosition(
  document: PathPlanningDocument
): InitialWirePositionResolution {
  const initial = document.setup?.initialWirePosition;
  if (!initial) return { status: 'blocked', reason: 'missing' };
  if (initial.kind === 'manual') {
    if (initial.review !== 'reviewed') return { status: 'blocked', reason: 'review-required' };
    return finiteResolution(initial.point, 'manual');
  }

  const segment = document.segments.find(
    (candidate) => candidate.id === initial.reference.segmentId && candidate.kind === 'circle'
  );
  if (!segment || segment.kind !== 'circle') {
    return { status: 'blocked', reason: 'missing-reference' };
  }
  return finiteResolution(segment.center, 'geometry-linked');
}

function finiteResolution(
  point: Point2,
  source: 'manual' | 'geometry-linked'
): InitialWirePositionResolution {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    ? { status: 'ready', point: { ...point }, source }
    : { status: 'blocked', reason: 'invalid-point' };
}
