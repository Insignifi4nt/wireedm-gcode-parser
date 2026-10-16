import type { CadConstructionPoint } from '@/domain/cad/cadPathConstruction';

export interface CadPathGraphPointSnap {
  readonly point: CadConstructionPoint;
  readonly existingPointId: string;
}

/**
 * Propose one deliberate identity from prepared numeric source points, before grid
 * snapping. Equal distances within eight screen-space floating-point ULPs are
 * ambiguous. Multiple nearby points still allow a uniquely nearest target.
 */
export function snapCadPathGraphPoint(points: readonly { readonly id: string; readonly position: CadConstructionPoint }[],
  cursor: CadConstructionPoint, millimetersPerPixel: number, tolerancePixels = 6): CadPathGraphPointSnap | null {
  if (!cursor.every(Number.isFinite) || !Number.isFinite(millimetersPerPixel) || millimetersPerPixel <= 0
    || !Number.isFinite(tolerancePixels) || tolerancePixels < 0) return null;
  let selected: typeof points[number] | null = null, closest = Infinity, secondClosest = Infinity;
  for (const point of points) {
    const distance = Math.hypot(point.position[0] - cursor[0], point.position[1] - cursor[1]) / millimetersPerPixel;
    if (!Number.isFinite(distance) || distance > tolerancePixels) continue;
    if (distance < closest) {
      if (point.id !== selected?.id) secondClosest = closest;
      selected = point; closest = distance;
    } else if (point.id !== selected?.id) secondClosest = Math.min(secondClosest, distance);
  }
  const ambiguous = Number.isFinite(secondClosest) && secondClosest - closest <= 8 * Number.EPSILON * Math.max(1, closest, secondClosest);
  return selected && !ambiguous ? Object.freeze({ point: Object.freeze([selected.position[0], selected.position[1]] satisfies [number, number]), existingPointId: selected.id }) : null;
}
