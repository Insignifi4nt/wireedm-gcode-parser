import type { CadMesh } from '@/domain/cad/cadDocument';
import type { CadTopologyPick } from '@/domain/cad/cadTopology';
import { cadBoxPolyline, cadBoxTakes, cadBoxTriangleTouches, type CadBoxMode, type CadBoxTest, type CadScreenPoint, type CadScreenRect } from '@/domain/cad/selection/cadSelectionBox';
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

/** What a box in the model view selected: one body, the edges or faces of one body, or nothing. */
export type CadBoxTarget = { readonly kind: 'body'; readonly featureId: string }
  | { readonly kind: 'topology'; readonly bodyId: string; readonly picks: readonly CadTopologyPick[] } | null;

/**
 * What a box in the model view takes. A window, dragged rightward, takes what lies wholly inside it; a crossing, dragged leftward, what it
 * touches. Bodies come first when the filter and pick mode allow them, then edges, then faces; edges and faces come from the one body with
 * the most of them in the box. Hidden edges and faces count too. Each body's points are projected once, so the test is linear in its mesh.
 */
export function cadBoxSelection({ rect, mode, bodies, kinds, project }: {
  rect: CadScreenRect; mode: CadBoxMode; bodies: readonly CadMesh[];
  kinds: { readonly body: boolean; readonly edge: boolean; readonly face: boolean };
  project(x: number, y: number, z: number): CadScreenPoint | null;
}): CadBoxTarget {
  const projectAll = (values: readonly number[]) => {
    const points: (CadScreenPoint | null)[] = new Array(values.length / 3);
    for (let index = 0; index < points.length; index++) points[index] = project(values[index * 3], values[index * 3 + 1], values[index * 3 + 2]);
    return points;
  };
  const triangles = (points: readonly (CadScreenPoint | null)[], indices: readonly number[], start: number, end: number): CadBoxTest => {
    let inside = end > start, touches = false;
    for (let at = start; at + 3 <= end && at + 2 < indices.length; at += 3) {
      const a = points[indices[at]], b = points[indices[at + 1]], c = points[indices[at + 2]];
      if (!a || !b || !c) { inside = false; continue; }
      const test = cadBoxPolyline(rect, [a, b, c], true);
      if (!test.inside) inside = false;
      if (!touches && cadBoxTriangleTouches(rect, a, b, c)) touches = true;
      if (!inside && touches) break;
    }
    return { inside, touches };
  };
  if (kinds.body) {
    // A window keeps its body test: the whole projection inside, the largest such body winning.
    const measured = bodies.map(body => ({ body, bounds: cadProjectedBounds(body.positions, project) }));
    if (mode === 'window') {
      const featureId = cadBoxSelectedBody(rect, measured.map(({ body, bounds }) => ({ featureId: body.featureId, bounds })));
      return featureId ? { kind: 'body', featureId } : null;
    }
    let best: { featureId: string; area: number } | null = null;
    for (const { body, bounds } of measured) {
      if (!bounds || bounds.right < rect.left || bounds.left > rect.right || bounds.bottom < rect.top || bounds.top > rect.bottom) continue;
      if (!triangles(projectAll(body.positions), body.indices, 0, body.indices.length).touches) continue;
      const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
      if (!best || area > best.area) best = { featureId: body.featureId, area };
    }
    return best ? { kind: 'body', featureId: best.featureId } : null;
  }
  for (const kind of ['edge', 'face'] as const) {
    if (!kinds[kind]) continue;
    let best: { bodyId: string; keys: string[] } | null = null;
    for (const body of bodies) {
      const keys: string[] = [];
      if (kind === 'edge') {
        const points = projectAll(body.edges);
        for (const group of body.edgeGroups) {
          let inside = group.count > 0, touches = false;
          for (let at = group.start; at + 1 < group.start + group.count; at += 2) {
            const test = cadBoxPolyline(rect, [points[at] ?? null, points[at + 1] ?? null]);
            if (!test.inside) inside = false;
            if (test.touches) touches = true;
          }
          if (cadBoxTakes(mode, { inside, touches })) keys.push(group.key);
        }
      } else {
        const points = projectAll(body.positions);
        for (const group of body.faceGroups) if (cadBoxTakes(mode, triangles(points, body.indices, group.start, group.start + group.count))) keys.push(group.key);
      }
      if (keys.length && (!best || keys.length > best.keys.length)) best = { bodyId: body.featureId, keys };
    }
    if (best) return { kind: 'topology', bodyId: best.bodyId, picks: best.keys.map(key => ({ kind, key })) };
  }
  return null;
}
