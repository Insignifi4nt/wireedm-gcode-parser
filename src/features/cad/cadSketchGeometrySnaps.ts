import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchEntityPointIds } from '@/domain/cad/cadSketchGraphReferences';
import { resolveCadSketchGraphJoints } from '@/domain/cad/cadSketchGraphJoints';
import { angleIsOnSweep, pointOnArcAtParameter } from '@/domain/path-intel/segments';
import type { PathSegment } from '@/domain/path-intel/types';
import type { SketchPoint } from './cadSketchInteraction';

export type CadSketchProfileSnapLocation =
  | { readonly kind: 'center' }
  | { readonly kind: 'endpoint'; readonly boundaryIndex: number }
  | { readonly kind: 'midpoint'; readonly boundaryIndex: number }
  | { readonly kind: 'arc-center'; readonly boundaryIndex: number };
export interface CadSketchProfilePositionSnapSource {
  readonly profileId: string;
  readonly location: CadSketchProfileSnapLocation;
  readonly point: SketchPoint;
}
export type CadSketchSnapTarget =
  | { readonly kind: 'endpoint'; readonly pointId: string }
  | { readonly kind: 'center'; readonly pointId: string }
  | { readonly kind: 'point'; readonly pointId: string }
  | { readonly kind: 'midpoint'; readonly entityId: string }
  | { readonly kind: 'profile-position'; readonly profileId: string; readonly location: CadSketchProfileSnapLocation }
  | { readonly kind: 'draft-start' }
  | { readonly kind: 'origin' }
  | { readonly kind: 'intersection'; readonly axes: readonly ('x' | 'y')[] }
  /** A position on an edge or axis; `horizontal` or `vertical` names the acquired point whose guide crosses it there. */
  | { readonly kind: 'on-entity'; readonly entityId: string; readonly entityKind: 'line' | 'arc' | 'circle'; readonly horizontal?: SketchPoint; readonly vertical?: SketchPoint }
  | { readonly kind: 'on-axis'; readonly axis: 'x' | 'y'; readonly horizontal?: SketchPoint; readonly vertical?: SketchPoint }
  /** Level with `horizontal` and/or above or below `vertical`: inference from points the pointer acquired. */
  | { readonly kind: 'aligned'; readonly horizontal?: SketchPoint; readonly vertical?: SketchPoint };
export interface CadSketchSnapCandidate {
  readonly target: CadSketchSnapTarget;
  readonly point: SketchPoint;
  readonly distancePx: number;
  readonly entityIds: readonly string[];
}
export type CadSketchSnapResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'hit'; readonly candidate: CadSketchSnapCandidate }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly CadSketchSnapCandidate[] };
export interface CadSketchSnapQuery {
  readonly cursor: SketchPoint;
  readonly mmPerPixel: SketchPoint;
  readonly tolerancePx?: number;
  readonly excludePointIds?: readonly string[];
  readonly excludeEntityIds?: readonly string[];
  readonly kinds?: readonly CadSketchSnapTarget['kind'][];
  readonly draftStart?: { readonly point: SketchPoint; readonly pointId?: string };
  /**
   * Also snap to the plane origin, onto edges and axes, to their intersections and to alignment with `alignTo`.
   * Point targets win over intersections, intersections over positions on a curve, and those over alignment.
   */
  readonly references?: boolean;
  readonly alignTo?: readonly SketchPoint[];
}
const NONE: CadSketchSnapResult = Object.freeze({ kind: 'none' });
function copyPoint(point: SketchPoint): SketchPoint { return Object.freeze([point[0], point[1]] satisfies [number, number]); }
function targetKey(target: CadSketchSnapTarget): string {
  switch (target.kind) {
    case 'profile-position': return `profile-position:${target.profileId}:${target.location.kind}:${'boundaryIndex' in target.location ? target.location.boundaryIndex : ''}`;
    case 'draft-start': case 'origin': case 'aligned': return target.kind;
    case 'intersection': return `intersection:${target.axes.join()}`;
    case 'midpoint': case 'on-entity': return `${target.kind}:${target.entityId}`;
    case 'on-axis': return `on-axis:${target.axis}`;
    default: return `${target.kind}:${target.pointId}`;
  }
}
type CurveOwner = { readonly entityId: string; readonly entityKind: 'line' | 'arc' | 'circle'; readonly pointIds: readonly string[] } | { readonly axis: 'x' | 'y' };
type Curve = { readonly owner: CurveOwner } & ({ readonly kind: 'line'; readonly start: SketchPoint; readonly end: SketchPoint; readonly bounded: boolean }
  | { readonly kind: 'circle'; readonly center: SketchPoint; readonly radius: number; readonly arc?: { readonly start: number; readonly sweep: number } });
const AXES: readonly Curve[] = Object.freeze([
  { owner: { axis: 'x' }, kind: 'line', start: [0, 0], end: [1, 0], bounded: false },
  { owner: { axis: 'y' }, kind: 'line', start: [0, 0], end: [0, 1], bounded: false }
]);
const LINE_SLACK = 1e-9;
function onArc(curve: Extract<Curve, { kind: 'circle' }>, point: SketchPoint): boolean {
  return !curve.arc || angleIsOnSweep(Math.atan2(point[1] - curve.center[1], point[0] - curve.center[0]), curve.arc.start, curve.arc.sweep, 1e-9);
}
/** The nearest point of a curve, or null where the nearest position lies beyond an arc's ends. */
function nearestOnCurve(curve: Curve, point: SketchPoint): SketchPoint | null {
  if (curve.kind === 'line') {
    const dx = curve.end[0] - curve.start[0], dy = curve.end[1] - curve.start[1], length = dx * dx + dy * dy;
    if (!(length > 0)) return null;
    const raw = ((point[0] - curve.start[0]) * dx + (point[1] - curve.start[1]) * dy) / length, t = curve.bounded ? Math.min(1, Math.max(0, raw)) : raw;
    return [curve.start[0] + dx * t, curve.start[1] + dy * t];
  }
  const dx = point[0] - curve.center[0], dy = point[1] - curve.center[1], distance = Math.hypot(dx, dy);
  if (!(distance > 0)) return null;
  const nearest: SketchPoint = [curve.center[0] + dx / distance * curve.radius, curve.center[1] + dy / distance * curve.radius];
  return onArc(curve, nearest) ? nearest : null;
}
function lineParameter(curve: Extract<Curve, { kind: 'line' }>, point: SketchPoint): number {
  const dx = curve.end[0] - curve.start[0], dy = curve.end[1] - curve.start[1];
  return ((point[0] - curve.start[0]) * dx + (point[1] - curve.start[1]) * dy) / (dx * dx + dy * dy);
}
function onCurve(curve: Curve, point: SketchPoint): boolean {
  if (curve.kind === 'circle') return onArc(curve, point);
  if (!curve.bounded) return true;
  const t = lineParameter(curve, point);
  return t >= -LINE_SLACK && t <= 1 + LINE_SLACK;
}
/** Exact crossings of two curves; tangency counts once. */
function intersections(a: Curve, b: Curve): SketchPoint[] {
  const raw: SketchPoint[] = [];
  if (a.kind === 'line' && b.kind === 'line') {
    const r = [a.end[0] - a.start[0], a.end[1] - a.start[1]], q = [b.end[0] - b.start[0], b.end[1] - b.start[1]], cross = r[0] * q[1] - r[1] * q[0];
    if (Math.abs(cross) <= 1e-12 * Math.hypot(...r) * Math.hypot(...q)) return [];
    const t = ((b.start[0] - a.start[0]) * q[1] - (b.start[1] - a.start[1]) * q[0]) / cross;
    raw.push([a.start[0] + r[0] * t, a.start[1] + r[1] * t]);
  } else if (a.kind === 'line' || b.kind === 'line') {
    const line = (a.kind === 'line' ? a : b) as Extract<Curve, { kind: 'line' }>, circle = (a.kind === 'circle' ? a : b) as Extract<Curve, { kind: 'circle' }>;
    // Work from the circle's center so a small circle far from the origin keeps its precision.
    const d = [line.end[0] - line.start[0], line.end[1] - line.start[1]], f = [line.start[0] - circle.center[0], line.start[1] - circle.center[1]], length = Math.hypot(d[0], d[1]);
    if (!(length > 0)) return [];
    const u = [d[0] / length, d[1] / length], along = f[0] * u[0] + f[1] * u[1], foot = [f[0] - u[0] * along, f[1] - u[1] * along];
    const square = circle.radius * circle.radius - (foot[0] * foot[0] + foot[1] * foot[1]);
    if (square < -1e-12 * circle.radius * circle.radius) return [];
    const half = Math.sqrt(Math.max(0, square));
    for (const offset of half === 0 ? [0] : [-half, half]) raw.push([circle.center[0] + foot[0] + u[0] * offset, circle.center[1] + foot[1] + u[1] * offset]);
  } else {
    const dx = b.center[0] - a.center[0], dy = b.center[1] - a.center[1], distance = Math.hypot(dx, dy);
    if (!(distance > 0) || distance > a.radius + b.radius || distance < Math.abs(a.radius - b.radius)) return [];
    const along = (a.radius * a.radius - b.radius * b.radius + distance * distance) / (2 * distance), height = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
    const base = [a.center[0] + dx * along / distance, a.center[1] + dy * along / distance];
    raw.push([base[0] - dy * height / distance, base[1] + dx * height / distance]);
    if (height > 0) raw.push([base[0] + dy * height / distance, base[1] - dx * height / distance]);
  }
  return raw.filter(point => point.every(Number.isFinite) && onCurve(a, point) && onCurve(b, point));
}
interface PointOwner { readonly entityId: string; readonly kind: 'endpoint' | 'center' }
type SourceCandidate =
  | { readonly kind: 'point'; readonly pointId: string; readonly point: SketchPoint; readonly owners: readonly PointOwner[] }
  | { readonly kind: 'midpoint'; readonly entityId: string; readonly point: SketchPoint; readonly pointIds: readonly string[] };

/** Prepare numeric source copies once; querying never compiles, solves or edits geometry. */
export function prepareCadSketchGeometrySnaps(source?: {
  readonly graph: CadSketchGraph;
  readonly points: readonly { readonly id: string; readonly position: SketchPoint }[];
  readonly segments: readonly PathSegment[];
}, profilePositions: readonly CadSketchProfilePositionSnapSource[] = []): (query: CadSketchSnapQuery) => CadSketchSnapResult {
  const profileCandidates = profilePositions.map(source => ({ profileId: source.profileId,
    location: Object.freeze({ ...source.location }), point: copyPoint(source.point) }));
  const owners = new Map<string, PointOwner[]>();
  for (const entity of source?.graph.entities ?? []) {
    for (const pointId of cadSketchEntityPointIds(entity)) {
      const entries = owners.get(pointId) ?? [];
      entries.push({ entityId: entity.id, kind: entity.kind !== 'line' && pointId === entity.centerPointId ? 'center' : 'endpoint' });
      owners.set(pointId, entries);
    }
  }
  const candidates: SourceCandidate[] = (source?.points ?? []).map(point => ({ kind: 'point', pointId: point.id,
    point: copyPoint(point.position), owners: (owners.get(point.id) ?? []).sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0) }));
  const entities = new Map(source?.graph.entities.map(entity => [entity.id, entity]));
  const sourcePoints = new Map(candidates.flatMap(candidate => candidate.kind === 'point' ? [[candidate.pointId, candidate.point] as const] : []));
  const joint = source ? resolveCadSketchGraphJoints(source.graph, new Map([...sourcePoints].map(([id, point]) => [id, { x: point[0], y: point[1] }]))) : (id: string) => id;
  const joints = new Map([...sourcePoints.keys()].map(id => [id, joint(id)]));
  const midpointOwners = new Map<string, string[]>();
  for (const relation of source?.graph.relations ?? []) if (relation.kind === 'midpoint') {
    const owners = midpointOwners.get(relation.lineId) ?? [];
    owners.push(relation.pointId); midpointOwners.set(relation.lineId, owners);
  }
  const curves: Curve[] = [];
  for (const segment of source?.segments ?? []) {
    const entity = entities.get(segment.id);
    if (!entity) continue;
    const owner = Object.freeze({ entityId: entity.id, entityKind: entity.kind, pointIds: cadSketchEntityPointIds(entity) });
    curves.push(segment.kind === 'line' ? { owner, kind: 'line', start: copyPoint([segment.start.x, segment.start.y]), end: copyPoint([segment.end.x, segment.end.y]), bounded: true }
      : { owner, kind: 'circle', center: copyPoint([segment.center.x, segment.center.y]), radius: segment.radius,
        ...(segment.kind === 'arc' ? { arc: { start: segment.startAngleRadians, sweep: segment.sweepRadians } } : {}) });
    if (segment.kind === 'circle') continue;
    const point = segment.kind === 'line' ? { x: segment.start.x + (segment.end.x - segment.start.x) / 2, y: segment.start.y + (segment.end.y - segment.start.y) / 2 }
      : pointOnArcAtParameter(segment, { segmentId: segment.id, reversed: false }, .5);
    candidates.push({ kind: 'midpoint', entityId: entity.id, point: copyPoint([point.x, point.y]), pointIds: [...cadSketchEntityPointIds(entity), ...(midpointOwners.get(entity.id) ?? [])] });
  }
  return ({ cursor, mmPerPixel, tolerancePx = 6, excludePointIds = [], excludeEntityIds = [], kinds, draftStart, references = false, alignTo = [] }) => {
    if (!cursor.every(Number.isFinite) || !mmPerPixel.every(value => Number.isFinite(value) && value > 0)
      || !Number.isFinite(tolerancePx) || tolerancePx < 0) return NONE;
    if (draftStart?.pointId !== undefined) {
      const current = sourcePoints.get(draftStart.pointId);
      if (!current || !current.every((value, axis) => value === draftStart.point[axis])) return NONE;
    }
    const excludedJoints = new Set(excludePointIds.map(id => joints.get(id) ?? id)), excludedEntities = new Set(excludeEntityIds);
    const excludedPoint = (id: string) => excludedJoints.has(joints.get(id) ?? id);
    const permitted = (kind: CadSketchSnapTarget['kind']) => !kinds || kinds.includes(kind);
    const hits: CadSketchSnapCandidate[] = [];
    const add = (target: CadSketchSnapTarget, point: SketchPoint, entityIds: readonly string[]) => {
      const distancePx = Math.hypot((point[0] - cursor[0]) / mmPerPixel[0], (point[1] - cursor[1]) / mmPerPixel[1]);
      if (Number.isFinite(distancePx) && distancePx <= tolerancePx)
        hits.push(Object.freeze({ target: Object.freeze(target), point: copyPoint(point), distancePx, entityIds: Object.freeze([...entityIds]) }));
    };
    for (const candidate of candidates) {
      if (candidate.kind === 'midpoint') {
        if (permitted('midpoint') && !excludedEntities.has(candidate.entityId) && !candidate.pointIds.some(excludedPoint))
          add({ kind: 'midpoint', entityId: candidate.entityId }, candidate.point, [candidate.entityId]);
      } else if (!excludedPoint(candidate.pointId)) {
        const eligible = candidate.owners.filter(owner => !excludedEntities.has(owner.entityId));
        if (candidate.owners.length && !eligible.length) continue;
        const kind = eligible.some(owner => owner.kind === 'endpoint') && permitted('endpoint') ? 'endpoint'
          : eligible.some(owner => owner.kind === 'center') && permitted('center') ? 'center'
            : !candidate.owners.length && permitted('point') ? 'point' : null;
        if (kind) add({ kind, pointId: candidate.pointId }, candidate.point, eligible.map(owner => owner.entityId));
      }
    }
    if (permitted('profile-position')) for (const candidate of profileCandidates)
      add({ kind: 'profile-position', profileId: candidate.profileId, location: candidate.location }, candidate.point, []);
    // A bound start already competes as its exact source point. Stale references
    // never become a fresh closure target with invented identity.
    if (draftStart?.pointId === undefined && draftStart && permitted('draft-start')) add({ kind: 'draft-start' }, draftStart.point, []);
    const reach = (point: SketchPoint) => Math.hypot((point[0] - cursor[0]) / mmPerPixel[0], (point[1] - cursor[1]) / mmPerPixel[1]);
    const near: { readonly curve: Curve; readonly point: SketchPoint; readonly distancePx: number }[] = [];
    if (references) {
      if (permitted('origin')) add({ kind: 'origin' }, [0, 0], []);
      // Geometry moving with the pointer never attracts it.
      const live = (curve: Curve) => 'axis' in curve.owner || !excludedEntities.has(curve.owner.entityId) && !curve.owner.pointIds.some(excludedPoint);
      for (const curve of [...curves.filter(live), ...AXES]) {
        const point = nearestOnCurve(curve, cursor), distancePx = point ? reach(point) : Infinity;
        if (point && distancePx <= tolerancePx) near.push({ curve, point, distancePx });
      }
      if (permitted('intersection')) for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
        const owners = [near[i].curve.owner, near[j].curve.owner];
        // The axes cross at the origin, which is its own target.
        if (owners.every(owner => 'axis' in owner)) continue;
        for (const point of intersections(near[i].curve, near[j].curve)) add({ kind: 'intersection', axes: owners.flatMap(owner => 'axis' in owner ? [owner.axis] : []) }, point,
          owners.flatMap(owner => 'entityId' in owner ? [owner.entityId] : []));
      }
    }
    const pointPositions = new Map<number, Set<number>>();
    for (const hit of hits) if ('pointId' in hit.target) {
      const ys = pointPositions.get(hit.point[0]) ?? new Set<number>();
      ys.add(hit.point[1]); pointPositions.set(hit.point[0], ys);
    }
    // An exact owned point supersedes a position-only midpoint, never another point ID.
    // The origin and crossings only name a place, so any other target already there supersedes them.
    const reference = (hit: CadSketchSnapCandidate) => hit.target.kind === 'origin' || hit.target.kind === 'intersection';
    const named = hits.filter(hit => !reference(hit));
    const ranked = hits.filter(hit => reference(hit) ? !named.some(other => other.point[0] === hit.point[0] && other.point[1] === hit.point[1])
      : hit.target.kind !== 'midpoint' || !pointPositions.get(hit.point[0])?.has(hit.point[1]));
    // A crossing yields to any exact point target nearby; it only resolves where two curves meet.
    if (ranked.some(hit => hit.target.kind !== 'intersection')) for (let index = ranked.length - 1; index >= 0; index--) if (ranked[index].target.kind === 'intersection') ranked.splice(index, 1);
    ranked.sort((a, b) => a.distancePx - b.distancePx || (targetKey(a.target) < targetKey(b.target) ? -1 : targetKey(a.target) > targetKey(b.target) ? 1 : 0));
    if (!ranked.length) return references ? curveOrAlignment(near, alignTo, cursor, mmPerPixel, tolerancePx, permitted) : NONE;
    const closest = ranked[0].distancePx;
    const tied = ranked.filter(hit => hit.distancePx - closest <= 8 * Number.EPSILON * Math.max(1, closest, hit.distancePx));
    tied.sort((a, b) => targetKey(a.target) < targetKey(b.target) ? -1 : targetKey(a.target) > targetKey(b.target) ? 1 : 0);
    return tied.length > 1 ? Object.freeze({ kind: 'ambiguous', candidates: Object.freeze(tied) }) : Object.freeze({ kind: 'hit', candidate: ranked[0] });
  };
}

type Near = { readonly curve: Curve; readonly point: SketchPoint; readonly distancePx: number };
/** Where a guide from an acquired point crosses a nearby edge or axis, else the nearest position on one, else alignment with an acquired point. */
function curveOrAlignment(near: readonly Near[], alignTo: readonly SketchPoint[], cursor: SketchPoint, mmPerPixel: SketchPoint, tolerancePx: number,
  permitted: (kind: CadSketchSnapTarget['kind']) => boolean): CadSketchSnapResult {
  const candidates = near.filter(entry => permitted('axis' in entry.curve.owner ? 'on-axis' : 'on-entity')).sort((a, b) => a.distancePx - b.distancePx
    // An edge lying on an axis is the more specific target.
    || Number('axis' in a.curve.owner) - Number('axis' in b.curve.owner));
  const curveHit = (entry: Near, point: SketchPoint, distancePx: number, guide?: { readonly axis: 0 | 1; readonly source: SketchPoint }) => {
    const owner = entry.curve.owner, along = guide ? guide.axis === 0 ? { vertical: copyPoint(guide.source) } : { horizontal: copyPoint(guide.source) } : {};
    const target: CadSketchSnapTarget = 'axis' in owner ? { kind: 'on-axis', axis: owner.axis, ...along } : { kind: 'on-entity', entityId: owner.entityId, entityKind: owner.entityKind, ...along };
    return Object.freeze({ kind: 'hit' as const, candidate: Object.freeze({ target: Object.freeze(target), point: copyPoint(point), distancePx, entityIds: Object.freeze('entityId' in owner ? [owner.entityId] : []) }) });
  };
  if (candidates.length && permitted('aligned') && alignTo.length) {
    let crossing: { readonly entry: Near; readonly point: SketchPoint; readonly distancePx: number; readonly axis: 0 | 1; readonly source: SketchPoint } | null = null;
    for (const entry of candidates) for (const source of alignTo) for (const axis of [0, 1] as const) {
      // Axis 0 is the vertical guide through the source, axis 1 the horizontal one.
      const guide: Curve = { owner: entry.curve.owner, kind: 'line', start: copyPoint(source), end: axis === 0 ? [source[0], source[1] + 1] : [source[0] + 1, source[1]], bounded: false };
      for (const found of intersections(entry.curve, guide)) {
        const point: SketchPoint = axis === 0 ? [source[0], found[1]] : [found[0], source[1]];
        const distancePx = Math.hypot((point[0] - cursor[0]) / mmPerPixel[0], (point[1] - cursor[1]) / mmPerPixel[1]);
        // The source itself is already a point target; a guide only helps away from it.
        if (distancePx > tolerancePx || point[1 - axis] === source[1 - axis] || crossing && crossing.distancePx <= distancePx) continue;
        crossing = { entry, point, distancePx, axis, source };
      }
    }
    if (crossing) return curveHit(crossing.entry, crossing.point, crossing.distancePx, crossing);
  }
  if (candidates.length) return curveHit(candidates[0], candidates[0].point, candidates[0].distancePx);
  if (!permitted('aligned') || !alignTo.length) return NONE;
  // A guide is chosen by how far the pointer is from it, then by how close its source point is.
  const guide = (axis: 0 | 1) => alignTo.map(source => ({ source, offset: Math.abs(source[axis] - cursor[axis]) / mmPerPixel[axis],
    along: Math.abs(source[1 - axis] - cursor[1 - axis]) })).filter(entry => entry.offset <= tolerancePx && entry.along > 0)
    .sort((a, b) => a.offset - b.offset || a.along - b.along)[0];
  const vertical = guide(0), horizontal = guide(1);
  if (!vertical && !horizontal) return NONE;
  const point: SketchPoint = [vertical ? vertical.source[0] : cursor[0], horizontal ? horizontal.source[1] : cursor[1]];
  const target: CadSketchSnapTarget = { kind: 'aligned', ...(horizontal ? { horizontal: copyPoint(horizontal.source) } : {}), ...(vertical ? { vertical: copyPoint(vertical.source) } : {}) };
  return Object.freeze({ kind: 'hit', candidate: Object.freeze({ target: Object.freeze(target), point: copyPoint(point),
    distancePx: Math.hypot((point[0] - cursor[0]) / mmPerPixel[0], (point[1] - cursor[1]) / mmPerPixel[1]), entityIds: Object.freeze([]) }) });
}

/** A short name for a reference target, for the snap hint. */
export function cadSketchSnapTargetLabel(target: CadSketchSnapTarget): string {
  switch (target.kind) {
    case 'origin': return 'Origin';
    case 'intersection': return 'Intersection';
    case 'on-entity': case 'on-axis': {
      const on = target.kind === 'on-entity' ? `On ${target.entityKind}` : `On ${target.axis.toUpperCase()} axis`;
      return target.horizontal ? `${on} · horizontal with point` : target.vertical ? `${on} · vertical with point` : on;
    }
    case 'aligned': return target.horizontal && target.vertical ? 'Aligned with two points' : target.horizontal ? 'Horizontal with point' : 'Vertical with point';
    case 'profile-position': case 'draft-start': case 'midpoint': case 'endpoint': case 'center': case 'point': return `${target.kind[0].toUpperCase()}${target.kind.slice(1).replace('-', ' ')}`;
  }
}
/** The relation a fresh point placed on this target can keep, or null for a position only. */
export function cadSketchSnapRelation(target: CadSketchSnapTarget): string | null {
  return target.kind === 'origin' ? 'Fixed at origin' : target.kind === 'on-axis' ? `Fixed ${target.axis === 'x' ? 'Y' : 'X'} at 0`
    : target.kind === 'on-entity' && target.entityKind === 'line' ? 'Point on line' : 'pointId' in target ? 'Coincident' : null;
}
