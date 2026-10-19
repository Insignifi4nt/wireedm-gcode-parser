import type { CadProfile } from '@/domain/cad/cadDocument';

export type SketchPoint = readonly [number, number];
export type SketchTool = 'select' | 'trim' | 'rectangle' | 'circle' | 'slot' | 'polygon' | 'path';

export function snapSketchPoint(point: SketchPoint, gridStep: number, enabled: boolean): SketchPoint {
  if (!enabled) return point;
  if (!Number.isFinite(gridStep) || gridStep <= 0) throw new Error('Grid spacing must be positive.');
  // `+ 0` keeps a node just below zero from reporting a negative zero.
  return [Math.round(point[0] / gridStep) * gridStep + 0, Math.round(point[1] / gridStep) * gridStep + 0];
}

/** Screen distance at which a dragged point sticks to a grid node. */
export const DRAG_GRID_CATCH_PIXELS = 6;

/** Drags stay continuous: a grid node only catches the pointer within `catchRadius`, so motion never jumps a whole cell. */
export function magnetSketchPoint(point: SketchPoint, gridStep: number, enabled: boolean, catchRadius: number): SketchPoint {
  const node = snapSketchPoint(point, gridStep, enabled);
  return Math.hypot(node[0] - point[0], node[1] - point[1]) <= catchRadius ? node : point;
}

/** The scalar form of {@link magnetSketchPoint}, for sizes and distances along one direction. */
export function magnetSketchValue(value: number, step: number, enabled: boolean, catchRadius: number): number {
  if (!enabled) return value;
  if (!Number.isFinite(step) || step <= 0) throw new Error('Grid spacing must be positive.');
  const node = Math.round(value / step) * step + 0;
  return Math.abs(node - value) <= catchRadius ? node : value;
}

/** The path anchor remains reachable at every zoom, including off-grid anchors. */
export function snapSketchPathPoint(point: SketchPoint, start: SketchPoint | null, unitsPerPixel: number, gridStep: number, enabled: boolean): SketchPoint {
  if (start && Number.isFinite(unitsPerPixel) && unitsPerPixel > 0
    && Math.hypot(point[0] - start[0], point[1] - start[1]) <= 6 * unitsPerPixel) return start;
  return snapSketchPoint(point, gridStep, enabled);
}

/** Rectangle origin is always its lower left corner, regardless of drawing direction. */
export function twoPointSketchProfile(tool: 'rectangle' | 'circle' | 'slot', start: SketchPoint, end: SketchPoint): CadProfile {
  if (tool === 'slot') {
    const halfLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (halfLength < 0.001) throw new Error('Click a different point to define the slot axis.');
    return { kind: 'slot', x: start[0], y: start[1], length: halfLength * 2, width: Math.min(10, halfLength), angle: Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI };
  }
  if (tool === 'circle') {
    const radius = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (radius < 0.001) throw new Error('Click a different point to define a circle radius.');
    return { kind: 'circle', x: start[0], y: start[1], radius };
  }
  const width = Math.abs(end[0] - start[0]);
  const height = Math.abs(end[1] - start[1]);
  if (width < 0.001 || height < 0.001) throw new Error('Choose a second corner with nonzero width and height.');
  return { kind: 'rectangle', x: Math.min(start[0], end[0]), y: Math.min(start[1], end[1]), width, height, cornerRadius: 0 };
}

export function closeSketchPolygon(points: readonly SketchPoint[]): CadProfile {
  if (points.length < 3) throw new Error('A closed profile needs at least three vertices.');
  return { kind: 'polygon', points };
}
