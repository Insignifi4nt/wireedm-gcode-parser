import { Type, type Static } from '@sinclair/typebox';
import type { CadPoint2, CadScalar, CadSketchProfile } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { cadAnalyticSegments, resolveCadPathSegments } from './cadAnalyticSegments';
import { inspectCadSketchDimensions, isCadSketchExpressionDriven, translateCadSketchProfile } from './cadSketchConstraints';

const index = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const strict = { additionalProperties: false };
/** Indices address the accepted revision only. Never store these as persistent relation references. */
export const CadSketchHandleSchema = Type.Union([
  Type.Object({ kind: Type.Literal('vertex'), index }, strict),
  Type.Object({ kind: Type.Literal('rectangle-corner'), index: Type.Integer({ minimum: 0, maximum: 3 }) }, strict),
  Type.Object({ kind: Type.Literal('rectangle-side'), index: Type.Integer({ minimum: 0, maximum: 3 }) }, strict),
  Type.Object({ kind: Type.Literal('center') }, strict),
  Type.Object({ kind: Type.Literal('radius') }, strict)
]);
export type CadSketchHandle = Static<typeof CadSketchHandleSchema>;
export function cadSketchHandleKey(handle: CadSketchHandle): string {
  return `${handle.kind}/${'index' in handle ? handle.index : ''}`;
}
type Point = readonly [number, number];
export interface CadSketchHandleDescriptor {
  readonly handle: CadSketchHandle;
  readonly point: Point;
  readonly label: string;
  readonly draggable: boolean;
}

function freedoms(profile: CadSketchProfile, parameters: Readonly<Record<string, number>>) {
  const locked = new Set(inspectCadSketchDimensions(profile, parameters).map(dimension => dimension.field));
  const free = (value: CadScalar) => !isCadSketchExpressionDriven(value);
  const size = (name: 'width' | 'height' | 'radius', value: CadScalar) => free(value) && !locked.has(name);
  return { free, size };
}

/** Human grips and agent discovery use exactly the same eligible targets and locks. */
export function inspectCadSketchHandles(profile: CadSketchProfile, parameters: Readonly<Record<string, number>>): readonly CadSketchHandleDescriptor[] {
  const g = profile.geometry, e = (value: CadScalar) => evaluateCadScalar(value, parameters), { free, size } = freedoms(profile, parameters);
  const descriptor = (handle: CadSketchHandle, point: Point, label: string, draggable: boolean): CadSketchHandleDescriptor => ({ handle, point, label, draggable });
  switch (g.kind) {
    case 'plugin': return [];
    case 'polygon': return g.points.map(([x, y], index) => descriptor({ kind: 'vertex', index }, [e(x), e(y)], `Point ${index + 1}`, free(x) || free(y)));
    case 'path': {
      const segments = cadAnalyticSegments(resolveCadPathSegments(g.segments, parameters)).segments;
      return segments.map((segment, index) => {
        const before = g.segments[(index + g.segments.length - 1) % g.segments.length], after = g.segments[index];
        const movable = before.kind === 'line' && after.kind === 'line'
          && ([0, 1] as const).some(axis => free(before.end[axis]) && free(after.start[axis]));
        return descriptor({ kind: 'vertex', index }, [segment.start.x, segment.start.y], `Point ${index + 1}`, movable);
      });
    }
    case 'rectangle': {
      const x = e(g.x), y = e(g.y), w = e(g.width), h = e(g.height);
      const horizontal = size('width', g.width), vertical = size('height', g.height);
      const left = horizontal && free(g.x), bottom = vertical && free(g.y);
      const corners: readonly Point[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      const sides: readonly Point[] = [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
      return [
        ...corners.map((point, index) => descriptor({ kind: 'rectangle-corner', index }, point, `${['Lower left', 'Lower right', 'Upper right', 'Upper left'][index]} corner`, (index === 0 || index === 3 ? left : horizontal) || (index < 2 ? bottom : vertical))),
        ...sides.map((point, index) => descriptor({ kind: 'rectangle-side', index }, point, `${['Bottom', 'Right', 'Top', 'Left'][index]} side`, [bottom, horizontal, vertical, left][index]))
      ];
    }
    case 'circle': return [
      descriptor({ kind: 'center' }, [e(g.x), e(g.y)], 'Center', free(g.x) || free(g.y)),
      descriptor({ kind: 'radius' }, [e(g.x) + e(g.radius), e(g.y)], 'Radius', size('radius', g.radius))
    ];
    case 'slot': return [descriptor({ kind: 'center' }, [e(g.x), e(g.y)], 'Center', free(g.x) || free(g.y))];
    default: { const exhaustive: never = g; return exhaustive; }
  }
}

/** Project motion onto free scalar components. Explicit dimensions and expressions stay authoritative. */
export function moveCadSketchHandle(input: { profile: CadSketchProfile; handle: CadSketchHandle; translation: Point; parameters: Readonly<Record<string, number>> }): CadSketchProfile {
  const { profile, handle, translation: [dx, dy], parameters } = input, g = profile.geometry;
  const target = inspectCadSketchHandles(profile, parameters).find(item => item.handle.kind === handle.kind && (!('index' in item.handle) || 'index' in handle && item.handle.index === handle.index));
  if (!target) throw new CadError('missing-sketch-handle', 'This sketch point or grip is unavailable in the accepted geometry. Select it again.');
  if (!target.draggable || dx === 0 && dy === 0) return profile;
  const { free, size } = freedoms(profile, parameters), e = (value: CadScalar) => evaluateCadScalar(value, parameters);
  const shifted = (value: CadScalar, delta: number): CadScalar => delta === 0 ? value : e(value) + delta;
  if (handle.kind === 'vertex' && g.kind === 'polygon') {
    return { ...profile, geometry: { ...g, points: g.points.map((point, index): CadPoint2 => index === handle.index
      ? [shifted(point[0], free(point[0]) ? dx : 0), shifted(point[1], free(point[1]) ? dy : 0)] : point) } };
  }
  if (handle.kind === 'vertex' && g.kind === 'path') {
    const previous = (handle.index + g.segments.length - 1) % g.segments.length;
    const before = g.segments[previous], after = g.segments[handle.index];
    if (before.kind !== 'line' || after.kind !== 'line') return profile;
    const delta: Point = [free(before.end[0]) && free(after.start[0]) ? dx : 0, free(before.end[1]) && free(after.start[1]) ? dy : 0];
    const point = (value: CadPoint2): CadPoint2 => [shifted(value[0], delta[0]), shifted(value[1], delta[1])];
    return { ...profile, geometry: { ...g, segments: g.segments.map((segment, index) => segment.kind !== 'line' ? segment : {
      ...segment, ...(index === previous ? { end: point(segment.end) } : {}), ...(index === handle.index ? { start: point(segment.start) } : {})
    }) } };
  }
  if (handle.kind === 'center' && (g.kind === 'circle' || g.kind === 'slot')) {
    return translateCadSketchProfile({ profile, parameters, translation: [free(g.x) ? dx : 0, free(g.y) ? dy : 0] });
  }
  if (handle.kind === 'radius' && g.kind === 'circle') {
    const radius = Math.hypot(e(g.radius) + dx, dy);
    if (radius <= 1e-7) throw new CadError('invalid-profile', 'The radius must remain positive.');
    return { ...profile, geometry: { ...g, radius } };
  }
  if ((handle.kind === 'rectangle-corner' || handle.kind === 'rectangle-side') && g.kind === 'rectangle') {
    const corner = handle.kind === 'rectangle-corner';
    const left = corner ? handle.index === 0 || handle.index === 3 : handle.index === 3;
    const right = corner ? !left : handle.index === 1;
    const bottom = corner ? handle.index < 2 : handle.index === 0;
    const top = corner ? !bottom : handle.index === 2;
    const x = (left || right) && size('width', g.width) && (!left || free(g.x)) ? dx : 0;
    const y = (bottom || top) && size('height', g.height) && (!bottom || free(g.y)) ? dy : 0;
    const width = e(g.width) + (left ? -x : x), height = e(g.height) + (bottom ? -y : y);
    if (width <= 1e-7 || height <= 1e-7 || 2 * e(g.cornerRadius) > Math.min(width, height)) throw new CadError('invalid-profile', 'Keep the opposite corner fixed and enough room for the corner radius.');
    return { ...profile, geometry: { ...g, x: shifted(g.x, left ? x : 0), y: shifted(g.y, bottom ? y : 0), width: x === 0 ? g.width : width, height: y === 0 ? g.height : height } };
  }
  throw new CadError('unsupported-sketch-handle', 'This sketch grip does not support direct editing.');
}
