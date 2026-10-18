export interface CadScreenBox { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** The box spanned by a drag, whichever direction it went. */
export function cadScreenBox(start: { readonly x: number; readonly y: number }, end: { readonly x: number; readonly y: number }): CadScreenBox {
  return { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y) };
}

/**
 * Screen extents of a body's vertices. `project` maps a world point to viewport pixels.
 * Returns null when no vertex is in front of the camera's clip range.
 */
export function cadProjectedBounds(positions: readonly number[], project: (x: number, y: number, z: number) => { readonly x: number; readonly y: number } | null): CadScreenBox | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const point = project(positions[index], positions[index + 1], positions[index + 2]);
    if (!point) continue;
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
  }
  return left <= right && top <= bottom ? { left, top, right, bottom } : null;
}

/**
 * The body a box selection takes: one whose whole projection lies inside the box. When several fit,
 * the largest on screen wins, so a box drawn around an assembly-sized body is not taken by a small one inside it.
 */
export function cadBoxSelectedBody(box: CadScreenBox, bodies: readonly { readonly featureId: string; readonly bounds: CadScreenBox | null }[], tolerance = 2): string | null {
  let best: { featureId: string; area: number } | null = null;
  for (const body of bodies) {
    const bounds = body.bounds;
    if (!bounds || bounds.left < box.left - tolerance || bounds.top < box.top - tolerance || bounds.right > box.right + tolerance || bounds.bottom > box.bottom + tolerance) continue;
    const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
    if (!best || area > best.area) best = { featureId: body.featureId, area };
  }
  return best?.featureId ?? null;
}
