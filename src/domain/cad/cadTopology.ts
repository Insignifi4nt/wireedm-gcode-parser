import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadPoint3, CadScalar } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';

export const MAX_CAD_TOPOLOGY_PICKS = 64;
export const MAX_CAD_TOPOLOGY_PREDICATES = 8;
export const MAX_CAD_TOPOLOGY_PAGE = 100;

export type CadVector3 = readonly [number, number, number];
/** Directions are dimensionless, normalized numeric vectors in the world frame. */
export type CadUnitVector = CadVector3;
export type CadEdgePredicate =
  | { readonly kind: 'curve-type'; readonly value: 'line' | 'circle' }
  | { readonly kind: 'length'; readonly value: CadScalar }
  | { readonly kind: 'on-plane'; readonly normal: CadUnitVector; readonly offset: CadScalar }
  | { readonly kind: 'parallel'; readonly direction: CadUnitVector }
  | { readonly kind: 'line-endpoints'; readonly start: CadPoint3; readonly end: CadPoint3 }
  | { readonly kind: 'circle'; readonly center: CadPoint3; readonly axis: CadUnitVector; readonly radius: CadScalar }
  | { readonly kind: 'arc-points'; readonly start: CadPoint3; readonly end: CadPoint3; readonly midpoint: CadPoint3 };
export type CadFacePredicate =
  | { readonly kind: 'surface-type'; readonly value: 'plane' | 'cylinder' }
  | { readonly kind: 'plane'; readonly normal: CadUnitVector; readonly offset: CadScalar }
  | { readonly kind: 'area'; readonly value: number }
  | { readonly kind: 'centroid'; readonly point: CadPoint3 }
  | { readonly kind: 'cylinder'; readonly origin: CadPoint3; readonly axis: CadUnitVector; readonly radius: CadScalar };
export interface CadEdgeQuery { readonly kind: 'edges'; readonly predicates: readonly CadEdgePredicate[]; readonly expectedCount: number }
export interface CadFaceQuery { readonly kind: 'faces'; readonly predicates: readonly CadFacePredicate[]; readonly expectedCount: number }
/** Each query is AND; the selection is their distinct union. All counts are exact. */
export interface CadEdgeSelection { readonly queries: readonly CadEdgeQuery[]; readonly expectedCount: number }
export type ResolvedCadEdgePredicate =
  | { readonly kind: 'curve-type'; readonly value: 'line' | 'circle' }
  | { readonly kind: 'length'; readonly value: number }
  | { readonly kind: 'on-plane'; readonly normal: CadUnitVector; readonly offset: number }
  | { readonly kind: 'parallel'; readonly direction: CadUnitVector }
  | { readonly kind: 'line-endpoints'; readonly start: CadVector3; readonly end: CadVector3 }
  | { readonly kind: 'circle'; readonly center: CadVector3; readonly axis: CadUnitVector; readonly radius: number }
  | { readonly kind: 'arc-points'; readonly start: CadVector3; readonly end: CadVector3; readonly midpoint: CadVector3 };
export type ResolvedCadFacePredicate =
  | { readonly kind: 'surface-type'; readonly value: 'plane' | 'cylinder' }
  | { readonly kind: 'plane'; readonly normal: CadUnitVector; readonly offset: number }
  | { readonly kind: 'area'; readonly value: number }
  | { readonly kind: 'centroid'; readonly point: CadVector3 }
  | { readonly kind: 'cylinder'; readonly origin: CadVector3; readonly axis: CadUnitVector; readonly radius: number };
export interface ResolvedCadEdgeQuery { readonly kind: 'edges'; readonly predicates: readonly ResolvedCadEdgePredicate[]; readonly expectedCount: number }
export interface ResolvedCadFaceQuery { readonly kind: 'faces'; readonly predicates: readonly ResolvedCadFacePredicate[]; readonly expectedCount: number }
export interface ResolvedCadEdgeSelection { readonly queries: readonly ResolvedCadEdgeQuery[]; readonly expectedCount: number }

export interface CadTopologyPick { readonly kind: 'edge' | 'face'; readonly key: string }
/** Ephemeral only: never persist these keys in a feature or attempt to rebind them. */
export interface CadTopologyPickSet {
  readonly documentVersion: string; readonly buildId: string; readonly bodyId: string; readonly picks: readonly CadTopologyPick[];
}
interface DescriptorBase { readonly key: string; readonly centroid: CadVector3; readonly bounds: { readonly min: CadVector3; readonly max: CadVector3 } }
export type CadTopologyDescriptor =
  | (DescriptorBase & { readonly kind: 'edge'; readonly curveType: 'line'; readonly length: number; readonly start: CadVector3; readonly end: CadVector3 })
  | (DescriptorBase & { readonly kind: 'edge'; readonly curveType: 'circle'; readonly length: number; readonly center: CadVector3; readonly axis: CadUnitVector; readonly radius: number; readonly start: CadVector3; readonly end: CadVector3; readonly midpoint: CadVector3; readonly closed: boolean })
  | (DescriptorBase & { readonly kind: 'edge'; readonly curveType: 'other'; readonly nativeType: string; readonly length: number })
  | (DescriptorBase & { readonly kind: 'face'; readonly surfaceType: 'plane'; readonly area: number; readonly normal: CadUnitVector; readonly offset: number })
  | (DescriptorBase & { readonly kind: 'face'; readonly surfaceType: 'cylinder'; readonly area: number; readonly origin: CadVector3; readonly axis: CadUnitVector; readonly radius: number })
  | (DescriptorBase & { readonly kind: 'face'; readonly surfaceType: 'other'; readonly nativeType: string; readonly area: number });
export type CadTopologyInspectRequest = {
  readonly bodyId: string; readonly expectedBuildId: string;
  readonly selection: { readonly kind: 'page'; readonly topology: 'edge' | 'face'; readonly offset: number; readonly limit: number }
    | { readonly kind: 'picks'; readonly picks: readonly CadTopologyPick[] };
};
export interface CadTopologyInspectResult {
  readonly bodyId: string; readonly buildId: string; readonly descriptors: readonly CadTopologyDescriptor[];
  readonly total: number; readonly nextOffset: number | null;
}
export interface CadTopologyResolvePicksRequest {
  readonly bodyId: string; readonly expectedBuildId: string; readonly purpose: 'fillet' | 'chamfer' | 'shell'; readonly picks: readonly CadTopologyPick[];
}
export type CadTopologyResolvePicksResult =
  | { readonly bodyId: string; readonly buildId: string; readonly purpose: 'fillet' | 'chamfer'; readonly selection: CadEdgeSelection }
  | { readonly bodyId: string; readonly buildId: string; readonly purpose: 'shell'; readonly opening: CadFaceQuery };

const strict = { additionalProperties: false };
const scalar = Type.Union([Type.Number({ minimum: -1e9, maximum: 1e9 }), Type.String({ minLength: 1, maxLength: 512 })]);
const point = Type.Tuple([scalar, scalar, scalar]);
const unitCoordinate = Type.Number({ minimum: -1, maximum: 1 });
const unit = Type.Tuple([unitCoordinate, unitCoordinate, unitCoordinate]);
const count = Type.Integer({ minimum: 1, maximum: MAX_CAD_TOPOLOGY_PICKS });
const identifier = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' });
const opaque = Type.String({ minLength: 1, maxLength: 128, pattern: '\\S' });
const area = Type.Number({ exclusiveMinimum: 0, maximum: 1e18 });
export const CadEdgePredicateSchema = Type.Union([
  Type.Object({ kind: Type.Literal('curve-type'), value: Type.Union([Type.Literal('line'), Type.Literal('circle')]) }, strict),
  Type.Object({ kind: Type.Literal('length'), value: scalar }, strict),
  Type.Object({ kind: Type.Literal('on-plane'), normal: unit, offset: scalar }, strict),
  Type.Object({ kind: Type.Literal('parallel'), direction: unit }, strict),
  Type.Object({ kind: Type.Literal('line-endpoints'), start: point, end: point }, strict),
  Type.Object({ kind: Type.Literal('circle'), center: point, axis: unit, radius: scalar }, strict),
  Type.Object({ kind: Type.Literal('arc-points'), start: point, end: point, midpoint: point }, strict)
]);
export const CadFacePredicateSchema = Type.Union([
  Type.Object({ kind: Type.Literal('surface-type'), value: Type.Union([Type.Literal('plane'), Type.Literal('cylinder')]) }, strict),
  Type.Object({ kind: Type.Literal('plane'), normal: unit, offset: scalar }, strict),
  Type.Object({ kind: Type.Literal('area'), value: area }, strict),
  Type.Object({ kind: Type.Literal('centroid'), point }, strict),
  Type.Object({ kind: Type.Literal('cylinder'), origin: point, axis: unit, radius: scalar }, strict)
]);
export const CadEdgeQuerySchema = Type.Object({ kind: Type.Literal('edges'), predicates: Type.Array(CadEdgePredicateSchema, { minItems: 1, maxItems: MAX_CAD_TOPOLOGY_PREDICATES }), expectedCount: count }, strict);
export const CadFaceQuerySchema = Type.Object({ kind: Type.Literal('faces'), predicates: Type.Array(CadFacePredicateSchema, { minItems: 1, maxItems: MAX_CAD_TOPOLOGY_PREDICATES }), expectedCount: count }, strict);
export const CadEdgeSelectionSchema = Type.Object({ queries: Type.Array(CadEdgeQuerySchema, { minItems: 1, maxItems: MAX_CAD_TOPOLOGY_PICKS }), expectedCount: count }, strict);
export const CadTopologyPickSchema = Type.Object({ kind: Type.Union([Type.Literal('edge'), Type.Literal('face')]), key: opaque }, strict);
const picks = Type.Array(CadTopologyPickSchema, { minItems: 1, maxItems: MAX_CAD_TOPOLOGY_PICKS });
export const CadTopologyPickSetSchema = Type.Object({ documentVersion: opaque, buildId: opaque, bodyId: identifier, picks }, strict);
export const CadTopologyInspectRequestSchema = Type.Object({ bodyId: identifier, expectedBuildId: opaque, selection: Type.Union([
  Type.Object({ kind: Type.Literal('page'), topology: Type.Union([Type.Literal('edge'), Type.Literal('face')]), offset: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), limit: Type.Integer({ minimum: 1, maximum: MAX_CAD_TOPOLOGY_PAGE }) }, strict),
  Type.Object({ kind: Type.Literal('picks'), picks }, strict)
]) }, strict);
export const CadTopologyResolvePicksRequestSchema = Type.Object({ bodyId: identifier, expectedBuildId: opaque, purpose: Type.Union([Type.Literal('fillet'), Type.Literal('chamfer'), Type.Literal('shell')]), picks }, strict);
const coordinate = Type.Number();
const numericPoint = Type.Tuple([coordinate, coordinate, coordinate]);
const bounds = Type.Object({ min: numericPoint, max: numericPoint }, strict);
const descriptorBase = { key: opaque, centroid: numericPoint, bounds };
const length = Type.Number({ minimum: 0, maximum: 1e12 });
const radius = Type.Number({ exclusiveMinimum: 0, maximum: 1e12 });
export const CadTopologyDescriptorSchema = Type.Union([
  Type.Object({ ...descriptorBase, kind: Type.Literal('edge'), curveType: Type.Literal('line'), length, start: numericPoint, end: numericPoint }, strict),
  Type.Object({ ...descriptorBase, kind: Type.Literal('edge'), curveType: Type.Literal('circle'), length, center: numericPoint, axis: unit, radius, start: numericPoint, end: numericPoint, midpoint: numericPoint, closed: Type.Boolean() }, strict),
  Type.Object({ ...descriptorBase, kind: Type.Literal('edge'), curveType: Type.Literal('other'), nativeType: Type.String({ minLength: 1, maxLength: 64 }), length }, strict),
  Type.Object({ ...descriptorBase, kind: Type.Literal('face'), surfaceType: Type.Literal('plane'), area, normal: unit, offset: coordinate }, strict),
  Type.Object({ ...descriptorBase, kind: Type.Literal('face'), surfaceType: Type.Literal('cylinder'), area, origin: numericPoint, axis: unit, radius }, strict),
  Type.Object({ ...descriptorBase, kind: Type.Literal('face'), surfaceType: Type.Literal('other'), nativeType: Type.String({ minLength: 1, maxLength: 64 }), area }, strict)
]);
export const CadTopologyInspectResultSchema = Type.Object({ bodyId: identifier, buildId: opaque, descriptors: Type.Array(CadTopologyDescriptorSchema, { maxItems: MAX_CAD_TOPOLOGY_PAGE }),
  total: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), nextOffset: Type.Union([Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), Type.Null()]) }, strict);
export const CadTopologyResolvePicksResultSchema = Type.Union([
  Type.Object({ bodyId: identifier, buildId: opaque, purpose: Type.Union([Type.Literal('fillet'), Type.Literal('chamfer')]), selection: CadEdgeSelectionSchema }, strict),
  Type.Object({ bodyId: identifier, buildId: opaque, purpose: Type.Literal('shell'), opening: CadFaceQuerySchema }, strict)
]);

function frozenSnapshot<S extends TSchema>(schema: S, value: unknown): Static<S> {
  if (!isOwnJsonData(value)) throw new CadError('invalid-selector', 'Topology selectors must contain their own complete JSON data fields.');
  if (!Value.Check(schema, value)) throw new CadError('invalid-selector', 'Malformed CAD topology selector or request.');
  let snapshot: Static<S>;
  try { snapshot = structuredClone(value); }
  catch { throw new CadError('invalid-selector', 'Topology selectors must contain portable declarative data.'); }
  if (!Value.Check(schema, snapshot)) throw new CadError('invalid-selector', 'Topology selectors must contain their own complete JSON fields.');
  function freeze(item: unknown): void {
    if (!item || typeof item !== 'object') return;
    Object.values(item).forEach(freeze); Object.freeze(item);
  }
  freeze(snapshot); return snapshot;
}
function normalized(value: CadUnitVector): CadUnitVector {
  const norm = Math.hypot(...value);
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-10) throw new CadError('invalid-direction', 'Topology directions must be normalized nonzero vectors.');
  return [value[0] / norm, value[1] / norm, value[2] / norm];
}
function positive(value: CadScalar, parameters: Readonly<Record<string, number>>): number {
  const result = evaluateCadScalar(value, parameters);
  if (result <= 1e-7) throw new CadError('invalid-selector-dimension', 'Selector lengths and radii must be greater than kernel precision.');
  return result;
}
function resolvedPoint(value: CadPoint3, parameters: Readonly<Record<string, number>>): CadVector3 {
  return [evaluateCadScalar(value[0], parameters), evaluateCadScalar(value[1], parameters), evaluateCadScalar(value[2], parameters)];
}
export function resolveCadEdgeQuery(query: CadEdgeQuery, parameters: Readonly<Record<string, number>>): ResolvedCadEdgeQuery {
  return { kind: 'edges', expectedCount: query.expectedCount, predicates: query.predicates.map(predicate => {
    switch (predicate.kind) {
      case 'curve-type': return predicate;
      case 'length': return { kind: predicate.kind, value: positive(predicate.value, parameters) };
      case 'on-plane': return { kind: predicate.kind, normal: normalized(predicate.normal), offset: evaluateCadScalar(predicate.offset, parameters) };
      case 'parallel': return { kind: predicate.kind, direction: normalized(predicate.direction) };
      case 'line-endpoints': return { kind: predicate.kind, start: resolvedPoint(predicate.start, parameters), end: resolvedPoint(predicate.end, parameters) };
      case 'circle': return { kind: predicate.kind, center: resolvedPoint(predicate.center, parameters), axis: normalized(predicate.axis), radius: positive(predicate.radius, parameters) };
      case 'arc-points': return { kind: predicate.kind, start: resolvedPoint(predicate.start, parameters), end: resolvedPoint(predicate.end, parameters), midpoint: resolvedPoint(predicate.midpoint, parameters) };
      default: { const exhaustive: never = predicate; return exhaustive; }
    }
  }) };
}
export function resolveCadFaceQuery(query: CadFaceQuery, parameters: Readonly<Record<string, number>>): ResolvedCadFaceQuery {
  return { kind: 'faces', expectedCount: query.expectedCount, predicates: query.predicates.map(predicate => {
    switch (predicate.kind) {
      case 'surface-type': case 'area': return predicate;
      case 'plane': return { kind: predicate.kind, normal: normalized(predicate.normal), offset: evaluateCadScalar(predicate.offset, parameters) };
      case 'centroid': return { kind: predicate.kind, point: resolvedPoint(predicate.point, parameters) };
      case 'cylinder': return { kind: predicate.kind, origin: resolvedPoint(predicate.origin, parameters), axis: normalized(predicate.axis), radius: positive(predicate.radius, parameters) };
      default: { const exhaustive: never = predicate; return exhaustive; }
    }
  }) };
}
export function resolveCadEdgeSelection(selection: CadEdgeSelection, parameters: Readonly<Record<string, number>>): ResolvedCadEdgeSelection {
  return { expectedCount: selection.expectedCount, queries: selection.queries.map(query => resolveCadEdgeQuery(query, parameters)) };
}
export function parseCadEdgeQuery(value: unknown, parameters: Readonly<Record<string, number>> = {}): CadEdgeQuery {
  const query = frozenSnapshot(CadEdgeQuerySchema, value); resolveCadEdgeQuery(query, parameters); return query;
}
export function parseCadFaceQuery(value: unknown, parameters: Readonly<Record<string, number>> = {}): CadFaceQuery {
  const query = frozenSnapshot(CadFaceQuerySchema, value); resolveCadFaceQuery(query, parameters); return query;
}
export function parseCadEdgeSelection(value: unknown, parameters: Readonly<Record<string, number>> = {}): CadEdgeSelection {
  const selection = frozenSnapshot(CadEdgeSelectionSchema, value); resolveCadEdgeSelection(selection, parameters); return selection;
}
export function validateCadShellOpening(query: CadFaceQuery, parameters: Readonly<Record<string, number>>): void {
  resolveCadFaceQuery(query, parameters);
  if (query.expectedCount !== 1 || !query.predicates.some(predicate => predicate.kind === 'plane' || predicate.kind === 'surface-type' && predicate.value === 'plane')
    || query.predicates.some(predicate => predicate.kind === 'cylinder' || predicate.kind === 'surface-type' && predicate.value === 'cylinder')) {
    throw new CadError('invalid-shell-opening', 'Inward shell requires exactly one face explicitly constrained to a planar surface.');
  }
}
function validatePicks(picks: readonly CadTopologyPick[]): void {
  if (new Set(picks.map(pick => `${pick.kind}:${pick.key}`)).size !== picks.length) throw new CadError('duplicate-pick', 'Select each topology element only once.');
}
export function parseCadTopologyPickSet(value: unknown): CadTopologyPickSet {
  const result = frozenSnapshot(CadTopologyPickSetSchema, value); validatePicks(result.picks); return result;
}
export function parseCadTopologyInspectRequest(value: unknown): CadTopologyInspectRequest {
  const result = frozenSnapshot(CadTopologyInspectRequestSchema, value);
  if (result.selection.kind === 'picks') validatePicks(result.selection.picks);
  return result;
}
export function parseCadTopologyResolvePicksRequest(value: unknown): CadTopologyResolvePicksRequest {
  const result = frozenSnapshot(CadTopologyResolvePicksRequestSchema, value); validatePicks(result.picks);
  if (result.purpose === 'shell' ? result.picks.length !== 1 || result.picks[0].kind !== 'face' : result.picks.some(pick => pick.kind !== 'edge')) {
    throw new CadError('invalid-pick-kind', 'Select edges for fillet/chamfer, or one planar face for inward shell.');
  }
  return result;
}
/** Worker data must be own JSON fields; never evaluate accessors during a guard. */
function isOwnJsonData(value: unknown): boolean {
  let remaining = 20_000;
  function visit(item: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 16) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item !== 'object') return false;
    const prototype: unknown = Object.getPrototypeOf(item);
    const array = Array.isArray(item);
    if (array ? prototype !== Array.prototype || item.length > remaining : prototype !== Object.prototype && prototype !== null) return false;
    const fields = Object.getOwnPropertyDescriptors(item);
    const names = Reflect.ownKeys(fields);
    if (names.length > remaining || array && names.length !== item.length + 1) return false;
    for (const name of names) {
      if (typeof name !== 'string') return false;
      if (array && name === 'length') continue;
      const field = fields[name];
      if (!field.enumerable || !('value' in field) || !visit(field.value, depth + 1)) return false;
    }
    return true;
  }
  return visit(value, 0);
}
export function isCadTopologyInspectResult(value: unknown): value is CadTopologyInspectResult {
  try {
    if (!isOwnJsonData(value) || !Value.Check(CadTopologyInspectResultSchema, value) || value.descriptors.length > value.total
      || value.nextOffset !== null && value.nextOffset >= value.total
      || new Set(value.descriptors.map(descriptor => `${descriptor.kind}:${descriptor.key}`)).size !== value.descriptors.length) return false;
    for (const descriptor of value.descriptors) {
      if (descriptor.bounds.min.some((coordinate, axis) => coordinate > descriptor.bounds.max[axis])) return false;
      if (descriptor.kind === 'face' && descriptor.surfaceType === 'plane') normalized(descriptor.normal);
      if (descriptor.kind === 'face' && descriptor.surfaceType === 'cylinder' || descriptor.kind === 'edge' && descriptor.curveType === 'circle') normalized(descriptor.axis);
    }
    return true;
  } catch { return false; }
}
export function isCadTopologyResolvePicksResult(value: unknown): value is CadTopologyResolvePicksResult {
  try {
    if (!isOwnJsonData(value) || !Value.Check(CadTopologyResolvePicksResultSchema, value)) return false;
    if (value.purpose === 'shell') validateCadShellOpening(value.opening, {});
    else resolveCadEdgeSelection(value.selection, {});
    return true;
  } catch { return false; }
}
