import type { CadProfile } from '@/domain/cad/cadDocument';

export type SketchPoint = readonly [number, number];
/** `path` is the Polyline tool; curves draw with it too. */
export type SketchTool = 'select' | 'trim' | 'line' | 'arc' | 'rectangle' | 'circle' | 'slot' | 'path';

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

/** Rectangle origin is always its lower left corner, regardless of drawing direction. */
export function twoPointSketchProfile(tool: 'rectangle' | 'circle', start: SketchPoint, end: SketchPoint): CadProfile {
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

/** Below this, two slot centers or a slot width are treated as one click and rejected. */
const SLOT_MINIMUM = 0.001;

/** A slot's third click sets its width: twice the distance from the line through both arc centers. */
export function slotSketchWidth(first: SketchPoint, second: SketchPoint, cursor: SketchPoint): number {
  const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
  if (length < SLOT_MINIMUM) throw new Error('Click a different point for the second arc center.');
  return 2 * Math.abs((second[0] - first[0]) * (cursor[1] - first[1]) - (second[1] - first[1]) * (cursor[0] - first[0])) / length;
}

/**
 * The saved slot profile spanning two arc centers, for sketches that keep profiles rather than connected edges:
 * centered between them, as long as their distance plus the width.
 */
export function slotSketchProfile(first: SketchPoint, second: SketchPoint, width: number): Extract<CadProfile, { kind: 'slot' }> {
  const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
  if (length < SLOT_MINIMUM) throw new Error('Click a different point for the second arc center.');
  if (!(width >= SLOT_MINIMUM) || !Number.isFinite(width)) throw new Error('Move away from the line between the arc centers to set the slot width.');
  return { kind: 'slot', x: (first[0] + second[0]) / 2, y: (first[1] + second[1]) / 2, length: length + width, width,
    angle: Math.atan2(second[1] - first[1], second[0] - first[0]) * 180 / Math.PI };
}
