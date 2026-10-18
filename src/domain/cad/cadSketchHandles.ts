import { Type, type Static } from '@sinclair/typebox';
import type { CadPathSegment, CadPoint2, CadScalar, CadSketchProfile } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadAngle, evaluateCadScalar } from './cadExpression';
import { cadAnalyticSegments, resolveCadPathSegments, type ResolvedCadPathSegment } from './cadAnalyticSegments';
import { createCadThreePointArc } from './cadPathConstruction';
import { inspectCadSketchDimensions, isCadSketchExpressionDriven, translateCadSketchProfile } from './cadSketchConstraints';

const index = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const strict = { additionalProperties: false };
/** Indices address the accepted revision only. Never store these as persistent relation references. */
export const CadSketchHandleSchema = Type.Union([
  Type.Object({ kind: Type.Literal('vertex'), index }, strict),
  Type.Object({ kind: Type.Literal('rectangle-corner'), index: Type.Integer({ minimum: 0, maximum: 3 }) }, strict),
  Type.Object({ kind: Type.Literal('rectangle-side'), index: Type.Integer({ minimum: 0, maximum: 3 }) }, strict),
  Type.Object({ kind: Type.Literal('center') }, strict),
  Type.Object({ kind: Type.Literal('radius') }, strict),
  Type.Object({ kind: Type.Literal('slot-length') }, strict),
  Type.Object({ kind: Type.Literal('slot-width') }, strict),
  Type.Object({ kind: Type.Literal('slot-angle') }, strict)
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
  /** An unsupported operation, distinct from an existing dimension/expression lock. */
  readonly unavailableReason?: string;
}

function freedoms(profile: CadSketchProfile, parameters: Readonly<Record<string, number>>) {
  const locked = new Set(inspectCadSketchDimensions(profile, parameters).map(dimension => dimension.field));
  const free = (value: CadScalar) => !isCadSketchExpressionDriven(value);
  const size = (name: 'width' | 'height' | 'radius' | 'length' | 'angle', value: CadScalar) => free(value) && !locked.has(name);
  return { free, size };
}

function drivenArc(segment: CadPathSegment): boolean {
  return segment.kind === 'arc' && [...segment.center, segment.radius, segment.startAngle, segment.sweep].some(isCadSketchExpressionDriven);
}
function jointAxes(before: CadPathSegment, after: CadPathSegment, free: (value: CadScalar) => boolean): readonly [boolean, boolean] {
  if (drivenArc(before) || drivenArc(after)) return [false, false];
  const available = (axis: 0 | 1) => (before.kind === 'arc' || free(before.end[axis])) && (after.kind === 'arc' || free(after.start[axis]));
  return [available(0), available(1)];
}

function refitArc(source: Extract<CadPathSegment, { kind: 'arc' }>, resolved: Extract<ResolvedCadPathSegment, { kind: 'arc' }>, start: Point, end: Point) {
  const mid = (resolved.startAngle + resolved.sweep / 2) * Math.PI / 180;
  const fitted = createCadThreePointArc({ start, end, through: [resolved.center[0] + resolved.radius * Math.cos(mid), resolved.center[1] + resolved.radius * Math.sin(mid)] });
  if (Math.sign(fitted.sweep) !== Math.sign(resolved.sweep)
    || Math.abs(resolved.sweep) !== 180 && (Math.abs(fitted.sweep) > 180) !== (Math.abs(resolved.sweep) > 180)) {
    throw new CadError('arc-branch-change', 'Keep the arc traversal direction and its major or minor branch.');
  }
  const retain = (previous: CadScalar, next: number) => Number(previous) === next ? previous : next;
  return { ...source, center: [retain(source.center[0], fitted.center[0]), retain(source.center[1], fitted.center[1])] satisfies CadPoint2,
    radius: retain(source.radius, fitted.radius), startAngle: retain(source.startAngle, fitted.startAngle), sweep: retain(source.sweep, fitted.sweep) };
}

/** Human grips and agent discovery use exactly the same eligible targets and locks. */
type RectangleGrip = 'rectangle-corner' | 'rectangle-side';
/** Edges moved by a rectangle grip; corners run lower-left counterclockwise and sides bottom, right, top, left. */
function rectangleGripSides(kind: RectangleGrip, index: number) {
  const corner = kind === 'rectangle-corner', left = corner ? index === 0 || index === 3 : index === 3, bottom = corner ? index < 2 : index === 0;
  return { left, right: corner ? !left : index === 1, bottom, top: corner ? !bottom : index === 2 };
}

export function inspectCadSketchHandles(profile: CadSketchProfile, parameters: Readonly<Record<string, number>>): readonly CadSketchHandleDescriptor[] {
  const g = profile.geometry, e = (value: CadScalar) => evaluateCadScalar(value, parameters), { free, size } = freedoms(profile, parameters);
  const descriptor = (handle: CadSketchHandle, point: Point, label: string, draggable: boolean, unavailableReason?: string): CadSketchHandleDescriptor => ({ handle, point, label, draggable, ...(unavailableReason ? { unavailableReason } : {}) });
  switch (g.kind) {
    case 'plugin': return [];
    case 'polygon': return g.points.map(([x, y], index) => descriptor({ kind: 'vertex', index }, [e(x), e(y)], `Point ${index + 1}`, free(x) || free(y)));
    case 'path': {
      const resolved = resolveCadPathSegments(g.segments, parameters), first = g.segments[0];
      if (g.segments.length === 1 && first.kind === 'arc' && Math.abs(e(first.sweep)) === 360) return [
        descriptor({ kind: 'center' }, [e(first.center[0]), e(first.center[1])], 'Center', first.center.some(free)),
        descriptor({ kind: 'radius' }, [e(first.center[0]) + e(first.radius), e(first.center[1])], 'Radius', free(first.radius))
      ];
      const segments = cadAnalyticSegments(resolved).segments;
      return segments.map((segment, index) => {
        const before = g.segments[(index + g.segments.length - 1) % g.segments.length], after = g.segments[index];
        const movable = jointAxes(before, after, free).some(Boolean);
        return descriptor({ kind: 'vertex', index }, [segment.start.x, segment.start.y], `Point ${index + 1}`, movable,
          drivenArc(before) || drivenArc(after) ? 'Arc endpoint editing cannot preserve its driving expressions. Edit the arc inputs instead.' : undefined);
      });
    }
    case 'rectangle': {
      const x = e(g.x), y = e(g.y), w = e(g.width), h = e(g.height);
      const horizontal = size('width', g.width), vertical = size('height', g.height);
      const draggable = (kind: RectangleGrip, index: number) => { const side = rectangleGripSides(kind, index);
        return (side.left || side.right) && horizontal && (!side.left || free(g.x)) || (side.bottom || side.top) && vertical && (!side.bottom || free(g.y)); };
      const corners: readonly Point[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      const sides: readonly Point[] = [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
      return [
        ...corners.map((point, index) => descriptor({ kind: 'rectangle-corner', index }, point, `${['Lower left', 'Lower right', 'Upper right', 'Upper left'][index]} corner`, draggable('rectangle-corner', index))),
        ...sides.map((point, index) => descriptor({ kind: 'rectangle-side', index }, point, `${['Bottom', 'Right', 'Top', 'Left'][index]} side`, draggable('rectangle-side', index)))
      ];
    }
    case 'circle': return [
      descriptor({ kind: 'center' }, [e(g.x), e(g.y)], 'Center', free(g.x) || free(g.y)),
      descriptor({ kind: 'radius' }, [e(g.x) + e(g.radius), e(g.y)], 'Radius', size('radius', g.radius))
    ];
    case 'slot': {
      const angle = evaluateCadAngle(g.angle, parameters) * Math.PI / 180, ux = Math.cos(angle), uy = Math.sin(angle);
      const at = (along: number, across = 0): Point => [e(g.x) + along * ux - across * uy, e(g.y) + along * uy + across * ux];
      return [
        descriptor({ kind: 'center' }, at(0), 'Center', free(g.x) || free(g.y)),
        descriptor({ kind: 'slot-length' }, at(e(g.length) / 2), 'Length', size('length', g.length)),
        descriptor({ kind: 'slot-width' }, at(0, e(g.width) / 2), 'Width', size('width', g.width)),
        descriptor({ kind: 'slot-angle' }, at(e(g.length) / 2 + e(g.width)), 'Angle', size('angle', g.angle))
      ];
    }
    default: { const exhaustive: never = g; return exhaustive; }
  }
}

/** Project motion onto free scalar components. Explicit dimensions and expressions stay authoritative. */
export function moveCadSketchHandle(input: { profile: CadSketchProfile; handle: CadSketchHandle; translation: Point; parameters: Readonly<Record<string, number>> }): CadSketchProfile {
  const { profile, handle, translation: [dx, dy], parameters } = input, g = profile.geometry;
  const target = inspectCadSketchHandles(profile, parameters).find(item => item.handle.kind === handle.kind && (!('index' in item.handle) || 'index' in handle && item.handle.index === handle.index));
  if (!target) throw new CadError('missing-sketch-handle', 'This sketch point or grip is unavailable in the accepted geometry. Select it again.');
  if (target.unavailableReason) throw new CadError('unavailable-sketch-handle', target.unavailableReason);
  if (!target.draggable || dx === 0 && dy === 0) return profile;
  const { free, size } = freedoms(profile, parameters), e = (value: CadScalar) => evaluateCadScalar(value, parameters);
  const shifted = (value: CadScalar, delta: number): CadScalar => delta === 0 ? value : e(value) + delta;
  const resizedRadius = (value: CadScalar) => {
    const radius = Math.hypot(e(value) + dx, dy);
    if (radius <= 1e-7) throw new CadError('invalid-profile', 'The radius must remain positive.');
    return radius;
  };
  if (g.kind === 'path' && g.segments.length === 1 && g.segments[0].kind === 'arc' && (handle.kind === 'center' || handle.kind === 'radius')) {
    const arc = g.segments[0];
    return { ...profile, geometry: { ...g, segments: [{ ...arc, ...(handle.kind === 'radius' ? { radius: resizedRadius(arc.radius) }
      : { center: [shifted(arc.center[0], free(arc.center[0]) ? dx : 0), shifted(arc.center[1], free(arc.center[1]) ? dy : 0)] satisfies CadPoint2 }) }] } };
  }
  if (handle.kind === 'vertex' && g.kind === 'polygon') {
    return { ...profile, geometry: { ...g, points: g.points.map((point, index): CadPoint2 => index === handle.index
      ? [shifted(point[0], free(point[0]) ? dx : 0), shifted(point[1], free(point[1]) ? dy : 0)] : point) } };
  }
  if (handle.kind === 'vertex' && g.kind === 'path') {
    const previous = (handle.index + g.segments.length - 1) % g.segments.length;
    const before = g.segments[previous], after = g.segments[handle.index];
    const axes = jointAxes(before, after, free), delta: Point = [axes[0] ? dx : 0, axes[1] ? dy : 0];
    const point = (value: CadPoint2): CadPoint2 => [shifted(value[0], delta[0]), shifted(value[1], delta[1])];
    if (!delta[0] && !delta[1]) return profile;
    const resolved = resolveCadPathSegments(g.segments, parameters), analytic = cadAnalyticSegments(resolved).segments;
    const anchor = analytic[handle.index].start, moved: Point = [anchor.x + delta[0], anchor.y + delta[1]];
    return { ...profile, geometry: { ...g, segments: g.segments.map((segment, index) => {
      if (index !== previous && index !== handle.index) return segment;
      if (segment.kind === 'line') return { ...segment,
        ...(index === previous ? { end: point(segment.end) } : {}), ...(index === handle.index ? { start: point(segment.start) } : {}) };
      const value = resolved[index], edge = analytic[index];
      if (value.kind !== 'arc') throw new CadError('missing-sketch-handle', 'The arc no longer exists.');
      return refitArc(segment, value, index === handle.index ? moved : [edge.start.x, edge.start.y], index === previous ? moved : [edge.end.x, edge.end.y]);
    }) } };
  }
  if (handle.kind === 'center' && (g.kind === 'circle' || g.kind === 'slot')) {
    return translateCadSketchProfile({ profile, parameters, translation: [free(g.x) ? dx : 0, free(g.y) ? dy : 0] });
  }
  if (handle.kind === 'radius' && g.kind === 'circle') {
    return { ...profile, geometry: { ...g, radius: resizedRadius(g.radius) } };
  }
  if ((handle.kind === 'slot-length' || handle.kind === 'slot-width' || handle.kind === 'slot-angle') && g.kind === 'slot') {
    const angle = evaluateCadAngle(g.angle, parameters) * Math.PI / 180, ux = Math.cos(angle), uy = Math.sin(angle);
    if (handle.kind === 'slot-angle') {
      const reach = e(g.length) / 2 + e(g.width), x = reach * ux + dx, y = reach * uy + dy;
      if (Math.hypot(x, y) <= 1e-7) throw new CadError('invalid-profile', 'Move the angle grip away from the slot center.');
      const turn = Math.atan2(ux * y - uy * x, ux * x + uy * y) * 180 / Math.PI;
      return turn === 0 ? profile : { ...profile, geometry: { ...g, angle: e(g.angle) + turn } };
    }
    const length = e(g.length) + (handle.kind === 'slot-length' ? 2 * (dx * ux + dy * uy) : 0);
    const width = e(g.width) + (handle.kind === 'slot-width' ? 2 * (-dx * uy + dy * ux) : 0);
    if (width <= 1e-7 || length < width) throw new CadError('invalid-profile', 'The slot width must stay positive and no greater than its length.');
    return { ...profile, geometry: { ...g, length: length === e(g.length) ? g.length : length, width: width === e(g.width) ? g.width : width } };
  }
  if ((handle.kind === 'rectangle-corner' || handle.kind === 'rectangle-side') && g.kind === 'rectangle') {
    const { left, right, bottom, top } = rectangleGripSides(handle.kind, handle.index);
    const x = (left || right) && size('width', g.width) && (!left || free(g.x)) ? dx : 0;
    const y = (bottom || top) && size('height', g.height) && (!bottom || free(g.y)) ? dy : 0;
    const width = e(g.width) + (left ? -x : x), height = e(g.height) + (bottom ? -y : y);
    if (width <= 1e-7 || height <= 1e-7 || 2 * e(g.cornerRadius) > Math.min(width, height)) throw new CadError('invalid-profile', 'Keep the opposite corner fixed and enough room for the corner radius.');
    return { ...profile, geometry: { ...g, x: shifted(g.x, left ? x : 0), y: shifted(g.y, bottom ? y : 0), width: x === 0 ? g.width : width, height: y === 0 ? g.height : height } };
  }
  throw new CadError('unsupported-sketch-handle', 'This sketch grip does not support direct editing.');
}
