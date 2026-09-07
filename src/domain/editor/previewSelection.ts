import { nearestPointOnSegment } from '@/domain/path-editor/pathPointInference';
import { classifyPathSegmentIntersection } from '@/domain/path-intel/intersections';
import { createLineSegment, distance } from '@/domain/path-intel/segments';
import type { Bounds2, PathSegment, Point2 } from '@/domain/path-intel/types';
import type { EditorPreviewPath } from './previewGeometry';

export const PREVIEW_SELECTION_FILTERS = [
  { value: 'all', label: 'All geometry' },
  { value: 'line', label: 'Lines' },
  { value: 'arc', label: 'Arcs' },
  { value: 'circle', label: 'Circles' },
  { value: 'active', label: 'Active cuts' },
  { value: 'reference', label: 'Reference geometry' }
] as const;
export type PreviewSelectionFilter = typeof PREVIEW_SELECTION_FILTERS[number]['value'];

export function matchesPreviewSelectionFilter(path: EditorPreviewPath, filter: PreviewSelectionFilter): boolean {
  if (path.source !== 'path-document' || !path.operationId || !path.segmentId || !path.selectionGeometry || path.travelRole) return false;
  switch (filter) {
    case 'all': return true;
    case 'active': return path.participation !== 'inactive-reference';
    case 'reference': return path.participation === 'inactive-reference';
    default: return (path.sourceGeometryKind ?? path.selectionGeometry.kind) === filter;
  }
}

/** Back-to-front display order matches ordinary SVG picking. */
export function previewSelectionCandidates(paths: readonly EditorPreviewPath[], point: Point2, radius: number,
  filter: PreviewSelectionFilter = 'all'): EditorPreviewPath[] {
  if (!Number.isFinite(radius) || radius < 0) return [];
  const seen = new Set<string>();
  return [...paths].reverse().filter((path) => {
    if (!matchesPreviewSelectionFilter(path, filter) || !path.selectionGeometry) return false;
    const nearest = nearestPointOnSegment(path.selectionGeometry, { segmentId: path.selectionGeometry.id, reversed: false }, point).point;
    const separation = distance(point, nearest);
    if (separation > radius || !Number.isFinite(separation)) return false;
    // A full circle is drawn as two SVG arcs but remains one selectable feature.
    const key = `${path.operationId}:${path.pathElementId ?? ''}:${path.segmentId}:${path.machiningSpanId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A boundary must enter/touch the rectangle; an enclosing curve's bounds alone do not count. */
export function segmentIntersectsSelectionRect(segment: PathSegment, rect: Bounds2): boolean {
  if (segment.bounds.maxX < rect.minX || segment.bounds.minX > rect.maxX ||
      segment.bounds.maxY < rect.minY || segment.bounds.minY > rect.maxY) return false;
  const inside = (point: Point2) => point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
  if (inside(segment.start) || inside(segment.end)) return true;
  const corners = [
    { x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }
  ];
  return corners.some((start, index) => classifyPathSegmentIntersection(segment,
    createLineSegment({ id: `selection-edge-${index}`, source: segment.source, start, end: corners[(index + 1) % 4] }), 0).kind !== 'none');
}
