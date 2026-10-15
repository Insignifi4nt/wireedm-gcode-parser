import type { CadPathSegment } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadAngle, evaluateCadScalar } from './cadExpression';
import type { DxfEntity, DxfPoint } from '@/domain/dxf/types';
import { createArcSegment, createLineSegment } from '@/domain/path-intel/segments';
import type { PathSegment } from '@/domain/path-intel/types';

export type ResolvedCadPathSegment =
  | { readonly kind: 'line'; readonly start: readonly [number, number]; readonly end: readonly [number, number] }
  | { readonly kind: 'arc'; readonly center: readonly [number, number]; readonly radius: number; readonly startAngle: number; readonly sweep: number };
export type CadOrderedCurveEntity = Extract<DxfEntity, { type: 'line' | 'arc' }>;

export function resolveCadPathSegments(segments: readonly CadPathSegment[], parameters: Readonly<Record<string, number>>): readonly ResolvedCadPathSegment[] {
  const e = (scalar: number | string) => evaluateCadScalar(scalar, parameters);
  return Object.freeze(segments.map((segment): ResolvedCadPathSegment => segment.kind === 'line'
    ? Object.freeze({ kind: segment.kind, start: Object.freeze([e(segment.start[0]), e(segment.start[1])] as const), end: Object.freeze([e(segment.end[0]), e(segment.end[1])] as const) })
    : Object.freeze({ kind: segment.kind, center: Object.freeze([e(segment.center[0]), e(segment.center[1])] as const), radius: e(segment.radius), startAngle: evaluateCadAngle(segment.startAngle, parameters), sweep: e(segment.sweep) })));
}

/** Prepare exact primitives in supplied order without closing or orienting a chain. */
export function cadAnalyticSegments(geometry: readonly ResolvedCadPathSegment[]) {
  const segments: PathSegment[] = geometry.map((segment, index) => {
    const source = { sourceEntityIndex: index, sourceEntityType: segment.kind, layer: null, exact: true };
    const id = `boundary_${index}`;
    if (segment.kind === 'line') return createLineSegment({ id, source, start: { x: segment.start[0], y: segment.start[1] }, end: { x: segment.end[0], y: segment.end[1] } });
    if (segment.radius <= 1e-7 || segment.radius > 1e6 || Math.abs(segment.sweep) > 360 || segment.sweep === 0) throw new CadError('invalid-profile', 'Path arcs need a positive radius and a nonzero sweep of at most one turn.');
    const angle = segment.startAngle * Math.PI / 180; const sweep = segment.sweep * Math.PI / 180;
    const center = { x: segment.center[0], y: segment.center[1] };
    const at = (value: number) => ({ x: center.x + segment.radius * Math.cos(value), y: center.y + segment.radius * Math.sin(value) });
    return createArcSegment({ id, source, center, radius: segment.radius, start: at(angle), end: at(angle + sweep), sweepRadians: sweep, clockwise: sweep < 0 });
  });
  const refs = segments.map(segment => ({ segmentId: segment.id, reversed: false }));
  const byId = new Map(segments.map(segment => [segment.id, segment]));
  return { segments, refs, byId };
}

export function cadOrderedCurveEntities(segments: readonly ResolvedCadPathSegment[], layer = 'CAD_CURVE'): readonly CadOrderedCurveEntity[] {
  return Object.freeze(segments.map((segment): CadOrderedCurveEntity => {
    if (segment.kind === 'line') return Object.freeze({ type: 'line', layer, start: Object.freeze({ x: segment.start[0], y: segment.start[1] }), end: Object.freeze({ x: segment.end[0], y: segment.end[1] }) });
    // Retain the explicit support and angles; atan2 of a world-space sampled
    // endpoint can lose angular precision when the radius is small far away.
    const startAngle = segment.startAngle * Math.PI / 180; const sweepRadians = segment.sweep * Math.PI / 180;
    const center = Object.freeze({ x: segment.center[0], y: segment.center[1] });
    const at = (angle: number) => Object.freeze({ x: center.x + segment.radius * Math.cos(angle), y: center.y + segment.radius * Math.sin(angle) });
    return Object.freeze({ type: 'arc', layer, center, radius: segment.radius, startAngle, endAngle: startAngle + sweepRadians,
      sweepRadians, clockwise: sweepRadians < 0, start: at(startAngle), end: at(startAngle + sweepRadians) });
  }));
}

/** Endpoint equality allows arithmetic roundoff, never a physical gap repair. */
export function cadPathClosureTolerance(points: readonly DxfPoint[]): number {
  let scale = 1;
  for (const point of points) scale = Math.max(scale, Math.abs(point.x), Math.abs(point.y));
  return Math.max(1e-12, 8 * Number.EPSILON * scale);
}
