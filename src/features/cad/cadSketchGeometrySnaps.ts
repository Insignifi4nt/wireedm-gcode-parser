import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchEntityPointIds } from '@/domain/cad/cadSketchGraphReferences';
import { resolveCadSketchGraphJoints } from '@/domain/cad/cadSketchGraphJoints';
import { pointOnArcAtParameter } from '@/domain/path-intel/segments';
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
  | { readonly kind: 'draft-start' };
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
}
const NONE: CadSketchSnapResult = Object.freeze({ kind: 'none' });
function copyPoint(point: SketchPoint): SketchPoint { return Object.freeze([point[0], point[1]] satisfies [number, number]); }
function targetKey(target: CadSketchSnapTarget): string {
  return target.kind === 'profile-position' ? `profile-position:${target.profileId}:${target.location.kind}:${'boundaryIndex' in target.location ? target.location.boundaryIndex : ''}`
    : target.kind === 'draft-start' ? 'draft-start' : target.kind === 'midpoint' ? `midpoint:${target.entityId}` : `${target.kind}:${target.pointId}`;
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
  for (const segment of source?.segments ?? []) {
    const entity = entities.get(segment.id);
    if (!entity || segment.kind === 'circle') continue;
    const point = segment.kind === 'line' ? { x: segment.start.x + (segment.end.x - segment.start.x) / 2, y: segment.start.y + (segment.end.y - segment.start.y) / 2 }
      : pointOnArcAtParameter(segment, { segmentId: segment.id, reversed: false }, .5);
    candidates.push({ kind: 'midpoint', entityId: entity.id, point: copyPoint([point.x, point.y]), pointIds: [...cadSketchEntityPointIds(entity)] });
  }
  return ({ cursor, mmPerPixel, tolerancePx = 6, excludePointIds = [], excludeEntityIds = [], kinds, draftStart }) => {
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
    const pointPositions = new Map<number, Set<number>>();
    for (const hit of hits) if ('pointId' in hit.target) {
      const ys = pointPositions.get(hit.point[0]) ?? new Set<number>();
      ys.add(hit.point[1]); pointPositions.set(hit.point[0], ys);
    }
    // An exact owned point supersedes a position-only midpoint, never another point ID.
    const ranked = hits.filter(hit => hit.target.kind !== 'midpoint' || !pointPositions.get(hit.point[0])?.has(hit.point[1]));
    ranked.sort((a, b) => a.distancePx - b.distancePx || (targetKey(a.target) < targetKey(b.target) ? -1 : targetKey(a.target) > targetKey(b.target) ? 1 : 0));
    if (!ranked.length) return NONE;
    const closest = ranked[0].distancePx;
    const tied = ranked.filter(hit => hit.distancePx - closest <= 8 * Number.EPSILON * Math.max(1, closest, hit.distancePx));
    tied.sort((a, b) => targetKey(a.target) < targetKey(b.target) ? -1 : targetKey(a.target) > targetKey(b.target) ? 1 : 0);
    return tied.length > 1 ? Object.freeze({ kind: 'ambiguous', candidates: Object.freeze(tied) }) : Object.freeze({ kind: 'hit', candidate: ranked[0] });
  };
}
