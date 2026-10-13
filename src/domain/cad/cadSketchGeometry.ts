import type { CadProfile, CadSketchFeature } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadAngle, evaluateCadScalar } from './cadExpression';
import type { DxfEntity, DxfPoint } from '@/domain/dxf/types';

export type ResolvedCadProfile =
  | { kind: 'rectangle'; x: number; y: number; width: number; height: number; cornerRadius: number }
  | { kind: 'circle'; x: number; y: number; radius: number }
  | { kind: 'polygon'; points: readonly (readonly [number, number])[] }
  | { kind: 'slot'; x: number; y: number; length: number; width: number; angle: number };
const tolerance = 1e-7;
const tau = Math.PI * 2;
function polygonDoubleArea(points: readonly (readonly [number, number])[]): number {
  const origin = points[0];
  if (!origin) return 0;
  return points.reduce((area, [x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length];
    return area + (x - origin[0]) * (ny - origin[1]) - (y - origin[1]) * (nx - origin[0]);
  }, 0);
}

export function resolveCadProfile(profile: CadProfile, parameters: Readonly<Record<string, number>>): ResolvedCadProfile {
  const e = (value: number | string) => evaluateCadScalar(value, parameters);
  switch (profile.kind) {
    case 'rectangle': return { kind: profile.kind, x: e(profile.x), y: e(profile.y), width: e(profile.width), height: e(profile.height), cornerRadius: e(profile.cornerRadius) };
    case 'circle': return { kind: profile.kind, x: e(profile.x), y: e(profile.y), radius: e(profile.radius) };
    case 'slot': return { kind: profile.kind, x: e(profile.x), y: e(profile.y), length: e(profile.length), width: e(profile.width), angle: evaluateCadAngle(profile.angle, parameters) };
    case 'polygon': return { kind: profile.kind, points: profile.points.map(([x, y]) => [e(x), e(y)]) };
    default: { const exhaustive: never = profile; return exhaustive; }
  }
}

/** Closed, counterclockwise analytic contours. Rectangle x/y is lower-left; slot x/y is its centre. */
export function cadProfileToEntities(profile: ResolvedCadProfile, layer = 'CAD'): DxfEntity[] {
  const entities: DxfEntity[] = [];
  const line = (start: DxfPoint, end: DxfPoint) => {
    if (Math.hypot(start.x - end.x, start.y - end.y) > tolerance) entities.push({ type: 'line', layer, start, end });
  };
  const arc = (center: DxfPoint, radius: number, startAngle: number, endAngle: number) => {
    const point = (angle: number) => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
    entities.push({ type: 'arc', layer, center, radius, startAngle, endAngle, clockwise: false, sweepRadians: endAngle - startAngle, start: point(startAngle), end: point(endAngle) });
  };
  switch (profile.kind) {
    case 'circle': return [{ type: 'circle', layer, center: { x: profile.x, y: profile.y }, radius: profile.radius }];
    case 'polygon': {
      const points = profile.points.map(([x, y]) => ({ x, y }));
      const signedArea = polygonDoubleArea(profile.points);
      if (signedArea < 0) points.reverse();
      points.forEach((point, index) => line(point, points[(index + 1) % points.length]));
      break;
    }
    case 'rectangle': {
      const { x, y, width: w, height: h, cornerRadius: r } = profile;
      line({ x: x + r, y }, { x: x + w - r, y });
      if (r > 0) arc({ x: x + w - r, y: y + r }, r, -Math.PI / 2, 0);
      line({ x: x + w, y: y + r }, { x: x + w, y: y + h - r });
      if (r > 0) arc({ x: x + w - r, y: y + h - r }, r, 0, Math.PI / 2);
      line({ x: x + w - r, y: y + h }, { x: x + r, y: y + h });
      if (r > 0) arc({ x: x + r, y: y + h - r }, r, Math.PI / 2, Math.PI);
      line({ x, y: y + h - r }, { x, y: y + r });
      if (r > 0) arc({ x: x + r, y: y + r }, r, Math.PI, Math.PI * 1.5);
      break;
    }
    case 'slot': {
      const angle = profile.angle * Math.PI / 180;
      const half = (profile.length - profile.width) / 2;
      const r = profile.width / 2;
      if (half <= tolerance) return [{ type: 'circle', layer, center: { x: profile.x, y: profile.y }, radius: r }];
      const transform = (x: number, y: number) => ({ x: profile.x + x * Math.cos(angle) - y * Math.sin(angle), y: profile.y + x * Math.sin(angle) + y * Math.cos(angle) });
      line(transform(-half, -r), transform(half, -r));
      arc(transform(half, 0), r, angle - Math.PI / 2, angle + Math.PI / 2);
      line(transform(half, r), transform(-half, r));
      arc(transform(-half, 0), r, angle + Math.PI / 2, angle + Math.PI * 1.5);
      break;
    }
    default: { const exhaustive: never = profile; return exhaustive; }
  }
  return entities;
}

export function cadSketchToEntities(sketch: CadSketchFeature, parameters: Readonly<Record<string, number>>): DxfEntity[] {
  return sketch.profiles.filter(profile => !profile.construction).flatMap(profile => cadProfileToEntities(resolveCadProfile(profile.geometry, parameters), `CAD_${profile.role.toUpperCase()}`));
}

export type CadAnalyticBoundary = Extract<DxfEntity, { type: 'line' | 'arc' | 'circle' }>;
type Boundary = CadAnalyticBoundary;
function boundary(entities: DxfEntity[]): Boundary[] { return entities.filter((entity): entity is Boundary => entity.type === 'line' || entity.type === 'arc' || entity.type === 'circle'); }
interface BoundaryBounds { minX: number; minY: number; maxX: number; maxY: number }
function boundaryBounds(entity: Boundary): BoundaryBounds {
  // Full-circle bounds for arcs are deliberately conservative. The exact predicate
  // still decides intersection; broadphase never clips an arc to sampled points.
  const bounds = entity.type === 'line'
    ? { minX: Math.min(entity.start.x, entity.end.x), minY: Math.min(entity.start.y, entity.end.y), maxX: Math.max(entity.start.x, entity.end.x), maxY: Math.max(entity.start.y, entity.end.y) }
    : { minX: entity.center.x - entity.radius, minY: entity.center.y - entity.radius, maxX: entity.center.x + entity.radius, maxY: entity.center.y + entity.radius };
  const padding = 2 * tolerance + 64 * Number.EPSILON * Math.max(1, ...Object.values(bounds).map(Math.abs));
  return { minX: bounds.minX - padding, minY: bounds.minY - padding, maxX: bounds.maxX + padding, maxY: bounds.maxY + padding };
}

/** Streaming broadphase pairs, including tolerance contacts; no quadratic pair array. */
export function* cadBoundaryCandidatePairs(boundaries: readonly Boundary[]): Generator<readonly [number, number]> {
  const entries = boundaries.map((entity, index) => ({ index, ...boundaryBounds(entity) })).sort((a, b) => a.minX - b.minX || a.index - b.index);
  let active: typeof entries = [];
  for (const entry of entries) {
    active = active.filter(previous => previous.maxX >= entry.minX);
    for (const previous of active) {
      if (previous.maxY < entry.minY || entry.maxY < previous.minY) continue;
      yield previous.index < entry.index ? [previous.index, entry.index] : [entry.index, previous.index];
    }
    active.push(entry);
  }
}
function cross(a: DxfPoint, b: DxfPoint) { return a.x * b.y - a.y * b.x; }
function subtract(a: DxfPoint, b: DxfPoint) { return { x: a.x - b.x, y: a.y - b.y }; }
function onCurve(entity: Boundary, point: DxfPoint): boolean {
  if (entity.type === 'line') {
    const direction = subtract(entity.end, entity.start);
    const delta = subtract(point, entity.start);
    const length = Math.hypot(direction.x, direction.y);
    const projection = (delta.x * direction.x + delta.y * direction.y) / length;
    return Math.abs(cross(direction, delta)) / length <= tolerance && projection >= -tolerance && projection <= length + tolerance;
  }
  if (Math.abs(Math.hypot(point.x - entity.center.x, point.y - entity.center.y) - entity.radius) > tolerance) return false;
  if (entity.type === 'circle') return true;
  const angle = Math.atan2(point.y - entity.center.y, point.x - entity.center.x);
  const delta = ((angle - entity.startAngle) % tau + tau) % tau;
  const sweep = entity.sweepRadians ?? ((entity.endAngle - entity.startAngle) % tau + tau) % tau;
  return delta <= sweep + tolerance / entity.radius || tau - delta <= tolerance / entity.radius;
}
export function cadBoundariesIntersect(first: Boundary, second: Boundary): boolean {
  if (first.type === 'line' && second.type === 'line') {
    const a = subtract(first.end, first.start); const b = subtract(second.end, second.start);
    const denominator = cross(a, b); const delta = subtract(second.start, first.start);
    if (Math.abs(denominator) < 1e-14) return onCurve(first, second.start) || onCurve(first, second.end) || onCurve(second, first.start) || onCurve(second, first.end);
    const t = cross(delta, b) / denominator;
    const point = { x: first.start.x + t * a.x, y: first.start.y + t * a.y };
    return onCurve(first, point) && onCurve(second, point);
  }
  if (first.type === 'line' || second.type === 'line') {
    const line = first.type === 'line' ? first : second;
    const circle = first.type !== 'line' ? first : second;
    if (line.type !== 'line' || circle.type === 'line') return false;
    const vector = subtract(line.end, line.start); const delta = subtract(line.start, circle.center);
    const lengthSquared = vector.x ** 2 + vector.y ** 2;
    const projection = -(delta.x * vector.x + delta.y * vector.y) / lengthSquared;
    const closest = { x: line.start.x + projection * vector.x, y: line.start.y + projection * vector.y };
    const distanceSquared = (closest.x - circle.center.x) ** 2 + (closest.y - circle.center.y) ** 2;
    const remainder = circle.radius ** 2 - distanceSquared;
    if (remainder < -tolerance * Math.max(1, circle.radius)) return false;
    const shift = Math.sqrt(Math.max(0, remainder) / lengthSquared);
    return [projection - shift, projection + shift].some(t => { const point = { x: line.start.x + t * vector.x, y: line.start.y + t * vector.y }; return onCurve(line, point) && onCurve(circle, point); });
  }
  const delta = subtract(second.center, first.center); const distance = Math.hypot(delta.x, delta.y);
  if (distance <= tolerance && Math.abs(first.radius - second.radius) <= tolerance) {
    if (first.type === 'circle' || second.type === 'circle') return true;
    return onCurve(first, second.start) || onCurve(first, second.end) || onCurve(second, first.start) || onCurve(second, first.end);
  }
  if (distance <= tolerance || distance > first.radius + second.radius + tolerance || distance < Math.abs(first.radius - second.radius) - tolerance) return false;
  const along = (first.radius ** 2 - second.radius ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, first.radius ** 2 - along ** 2));
  const base = { x: first.center.x + delta.x * along / distance, y: first.center.y + delta.y * along / distance };
  return [-1, 1].some(sign => { const point = { x: base.x - sign * delta.y * height / distance, y: base.y + sign * delta.x * height / distance }; return onCurve(first, point) && onCurve(second, point); });
}

export function cadProfileContainsPoint(profile: ResolvedCadProfile, point: DxfPoint): boolean {
  switch (profile.kind) {
    case 'circle': return Math.hypot(point.x - profile.x, point.y - profile.y) < profile.radius;
    case 'rectangle': {
      const dx = Math.abs(point.x - profile.x - profile.width / 2) - (profile.width / 2 - profile.cornerRadius);
      const dy = Math.abs(point.y - profile.y - profile.height / 2) - (profile.height / 2 - profile.cornerRadius);
      return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) < profile.cornerRadius;
    }
    case 'slot': {
      const angle = profile.angle * Math.PI / 180; const dx = point.x - profile.x; const dy = point.y - profile.y;
      const x = dx * Math.cos(angle) + dy * Math.sin(angle); const y = -dx * Math.sin(angle) + dy * Math.cos(angle);
      return Math.hypot(Math.max(Math.abs(x) - (profile.length - profile.width) / 2, 0), y) < profile.width / 2;
    }
    case 'polygon': {
      let inside = false;
      profile.points.forEach(([x, y], index) => { const [nx, ny] = profile.points[(index + 1) % profile.points.length]; if ((y > point.y) !== (ny > point.y) && point.x < (nx - x) * (point.y - y) / (ny - y) + x) inside = !inside; });
      return inside;
    }
    default: { const exhaustive: never = profile; return exhaustive; }
  }
}

export function validateCadSketchGeometry(sketch: CadSketchFeature, parameters: Readonly<Record<string, number>>): void {
  const profiles = sketch.profiles.map(profile => ({ profile, geometry: resolveCadProfile(profile.geometry, parameters) }));
  for (const { profile, geometry } of profiles) {
    const positive = (value: number) => value > tolerance && value <= 1e6;
    switch (geometry.kind) {
      case 'circle': if (!positive(geometry.radius)) throw new CadError('invalid-profile', `Circle "${profile.name}" needs a positive radius.`); break;
      case 'rectangle': if (!positive(geometry.width) || !positive(geometry.height) || geometry.cornerRadius < 0 || geometry.cornerRadius > Math.min(geometry.width, geometry.height) / 2) throw new CadError('invalid-profile', `Rectangle "${profile.name}" has invalid dimensions or corner radius.`); break;
      case 'slot': if (!positive(geometry.width) || !positive(geometry.length) || geometry.length < geometry.width) throw new CadError('invalid-profile', `Slot "${profile.name}" needs length at least its positive width.`); break;
      case 'polygon': {
        const lines = boundary(cadProfileToEntities(geometry));
        if (lines.length !== geometry.points.length) throw new CadError('invalid-profile', `Polygon "${profile.name}" contains a zero-length edge.`);
        const area = polygonDoubleArea(geometry.points);
        if (Math.abs(area) <= tolerance ** 2) throw new CadError('invalid-profile', `Polygon "${profile.name}" has zero area.`);
        for (const [i, j] of cadBoundaryCandidatePairs(lines)) {
          if (j === i + 1 || (i === 0 && j === lines.length - 1)) continue;
          if (cadBoundariesIntersect(lines[i], lines[j])) throw new CadError('self-intersection', `Polygon "${profile.name}" intersects itself.`);
        }
        break;
      }
      default: { const exhaustive: never = geometry; throw exhaustive; }
    }
  }
  const contours = profiles.filter(item => !item.profile.construction).map(item => ({ ...item, edges: boundary(cadProfileToEntities(item.geometry)) }));
  const indexedEdges = contours.flatMap((contour, index) => contour.edges.map(edge => ({ edge, contourIndex: index })));
  for (const [i, j] of cadBoundaryCandidatePairs(indexedEdges.map(item => item.edge))) {
    const first = indexedEdges[i]; const second = indexedEdges[j];
    if (first.contourIndex === second.contourIndex) continue;
    if (cadBoundariesIntersect(first.edge, second.edge)) {
      const firstContour = contours[Math.min(first.contourIndex, second.contourIndex)];
      const secondContour = contours[Math.max(first.contourIndex, second.contourIndex)];
      throw new CadError('profile-intersection', `Profiles "${firstContour.profile.name}" and "${secondContour.profile.name}" overlap or touch.`);
    }
  }
  for (const contour of contours) {
    const first = contour.edges[0];
    if (first === undefined) throw new CadError('invalid-profile', 'Profile has no edges.');
    const point = first.type === 'circle' ? { x: first.center.x + first.radius, y: first.center.y } : first.start;
    const containers = contours.filter(other => other !== contour && cadProfileContainsPoint(other.geometry, point));
    const expectedRole = containers.length % 2 === 0 ? 'outer' : 'hole';
    if (contour.profile.role !== expectedRole) throw new CadError('invalid-profile-role', `Profile "${contour.profile.name}" must be ${expectedRole} at nesting depth ${containers.length}.`);
  }
}
