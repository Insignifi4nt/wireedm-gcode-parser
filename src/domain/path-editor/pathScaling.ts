import type { Bounds2, PathPlanningDocument, Point2 } from '@/domain/path-intel/types';

export type UniformScale = { kind: 'factor'; factor: number } | { kind: 'longest-side'; lengthMm: number };

export function pathGeometryBounds(document: PathPlanningDocument): Bounds2 | null {
  if (!document.segments.length) return null;
  return document.segments.reduce((bounds, segment) => ({
    minX: Math.min(bounds.minX, segment.bounds.minX), minY: Math.min(bounds.minY, segment.bounds.minY),
    maxX: Math.max(bounds.maxX, segment.bounds.maxX), maxY: Math.max(bounds.maxY, segment.bounds.maxY)
  }), { ...document.segments[0].bounds });
}

/** Geometric preview only. Applying also checks topology, finite geometry and authored stops. */
export function previewPathScale(document: PathPlanningDocument, scale: UniformScale, origin: Point2) {
  const before = pathGeometryBounds(document);
  if (!before || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return null;
  const longest = Math.max(before.maxX - before.minX, before.maxY - before.minY);
  const factor = scale.kind === 'factor' ? scale.factor : scale.lengthMm / longest;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const bounds = { minX: origin.x + (before.minX - origin.x) * factor, maxX: origin.x + (before.maxX - origin.x) * factor,
    minY: origin.y + (before.minY - origin.y) * factor, maxY: origin.y + (before.maxY - origin.y) * factor };
  if (Object.values(bounds).some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) return null;
  return { factor, origin, before, bounds, widthMm: bounds.maxX - bounds.minX, heightMm: bounds.maxY - bounds.minY };
}
