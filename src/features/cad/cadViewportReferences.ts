import type { CadFeature, CadPlane, CadProfile, CadSketchFeature, CadSketchPlane } from '@/domain/cad/cadDocument';
import { inspectCadCurve, type CadBounds3 } from '@/domain/cad/cadCurve';
import { prepareCadDatumFrames, resolveCadSketchPlacement, resolveCadWorldDatum, cadFramePointToWorld, cadPrincipalFrame, type CadDatumFrameLookup, type CadResolvedFrame,
  type CadResolvedPlacement } from '@/domain/cad/cadDatumPlanes';
import { cadFrameEntityBounds } from '@/domain/cad/cadFrameBounds';
import { cadPlanePointToWorld } from '@/domain/cad/cadPlanes';
import { cadScalarParameterNames } from '@/domain/cad/cadParameters';
import { cadFeatureDependencies, cadFeatureProducesBody, cadSketchPlacedFrom, isAcceptedCadSketchSource } from '@/domain/cad/cadSchema';
import { readCadSketchGeometryParameters, sameCadSketchGeometryValues } from '@/domain/cad/cadSketchParameterReads';
import { cadProfileToEntities, resolveCadProfile, type CadAnalyticBoundary } from '@/domain/cad/cadSketchGeometry';
import { arcBounds, boundsFromPoints, emptyBounds, mergeBounds } from '@/domain/path-intel/segments';
import type { Bounds2 } from '@/domain/path-intel/types';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';

interface CadViewportReferenceGeometry {
  readonly referenceId: string;
  /** Display-only triangles for a datum glyph; never native geometry. */
  readonly planePatch?: readonly number[];
  readonly name: string;
  readonly construction: boolean;
  readonly positions: readonly number[];
  readonly bounds: CadBounds3;
  readonly labelPosition?: readonly [number, number, number];
}
export interface CadViewportFeatureReference extends CadViewportReferenceGeometry {
  readonly featureId: string;
  readonly featureKind: 'sketch' | 'curve' | 'datum-plane';
  readonly plane?: CadSketchPlane;
}
export interface CadViewportPrincipalPlaneReference extends CadViewportReferenceGeometry {
  readonly featureId: null;
  readonly featureKind: 'principal-plane';
  readonly plane: CadPlane;
}
export type CadViewportReference = CadViewportFeatureReference | CadViewportPrincipalPlaneReference;
interface ReferenceSource extends Omit<CadViewportFeatureReference, 'positions'> {
  readonly frame: CadResolvedFrame;
  readonly offset: number;
  readonly entities: readonly CadAnalyticBoundary[];
}

/** Exact domain bounds; sampled display vertices never determine Fit or dimensions. */
export function cadProfileReferenceGeometry(profile: CadProfile, parameters: Readonly<Record<string, number>>) {
  const entities = cadProfileToEntities(resolveCadProfile(profile, parameters)).map((entity): CadAnalyticBoundary => {
    if (entity.type === 'line' || entity.type === 'arc' || entity.type === 'circle') return entity;
    throw new Error('CAD outlines require analytic line, circle or arc geometry.');
  });
  const bounds = entities.reduce<Bounds2>((all, entity) => mergeBounds(all, entity.type === 'line' ? boundsFromPoints([entity.start, entity.end])
    : entity.type === 'arc' ? arcBounds(entity.center, entity.radius, entity.startAngle, entity.sweepRadians ?? entity.endAngle - entity.startAngle, entity.start, entity.end)
      : { minX: entity.center.x - entity.radius, maxX: entity.center.x + entity.radius, minY: entity.center.y - entity.radius, maxY: entity.center.y + entity.radius }), emptyBounds());
  return { entities, bounds };
}

function worldBounds(plane: CadPlane, offset: number, bounds: Bounds2): CadBounds3 {
  const a = cadPlanePointToWorld(plane, offset, [bounds.minX, bounds.minY]);
  const b = cadPlanePointToWorld(plane, offset, [bounds.maxX, bounds.maxY]);
  return Object.freeze({ min: Object.freeze([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])] satisfies [number, number, number]),
    max: Object.freeze([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] satisfies [number, number, number]) });
}

type PreparedSources = { readonly references: readonly CadViewportReference[] }
  | { readonly sources: readonly ReferenceSource[]; readonly remember?: (references: readonly CadViewportReference[]) => void };
interface PreparedSketchReferences {
  readonly values: readonly (number | undefined)[];
  readonly placement: CadResolvedPlacement;
  readonly references: readonly CadViewportReference[];
}
// An accepted sketch cannot change, so its references depend only on the values its profiles and graph read and on
// where it is placed. A sketch that a revision leaves unchanged keeps its reference objects, and the viewport its lines;
// so does one whose dimensions alone were moved, as it is held under the sketch whose geometry it keeps.
// Only the sketches of the last two preparations that kept any are held: enough for the viewport to switch between a
// preview and its document, while undo history never keeps sampled references alive.
let recentSketches = new Map<CadSketchFeature, PreparedSketchReferences>(), olderSketches = recentSketches;

/** Prepare once per immutable accepted revision; scene size never changes curve resolution. */
export function prepareCadViewportReferences(features: readonly CadFeature[], parameters: Readonly<Record<string, number>>): readonly CadViewportReference[] {
  const frames = prepareCadDatumFrames(features, parameters);
  const glyphs = features.flatMap(feature => feature.kind === 'datum-plane' && !feature.suppressed ? [cadDatumReference(feature, resolveCadWorldDatum(feature, parameters))] : []);
  const kept = new Map<CadSketchFeature, PreparedSketchReferences>();
  // Every source is found before any is placed in the world, so an input that cannot be placed fails as it always has.
  const prepared = features.map((feature): PreparedSources => {
    if (feature.suppressed) return { sources: [] };
    if (feature.kind === 'curve') {
      const result = inspectCadCurve(feature, parameters, frames);
      return { sources: result.eligible ? [{ referenceId: feature.id, featureId: feature.id, featureKind: 'curve', name: feature.name, construction: false,
        frame: resolveCadSketchPlacement(feature, parameters, frames).frame, offset: result.curve.offset, entities: result.curve.entities, bounds: result.curve.worldBounds }] : [] };
    }
    return feature.kind === 'sketch' ? prepareSketchSources(feature, parameters, frames, kept) : { sources: [] };
  });
  const references = Object.freeze([...glyphs, ...prepared.flatMap(item => {
    if ('references' in item) return item.references;
    const references = Object.freeze(item.sources.map(cadSourceReference));
    item.remember?.(references);
    return references;
  })]);
  if (kept.size) { olderSketches = recentSketches; recentSketches = kept; }
  return references;
}

function prepareSketchSources(feature: CadSketchFeature, parameters: Readonly<Record<string, number>>, frames: CadDatumFrameLookup,
  kept: Map<CadSketchFeature, PreparedSketchReferences>): PreparedSources {
  const place = () => resolveCadSketchPlacement(feature, parameters, frames);
  // Own data is read once for both the key and the geometry, and the offset reads only own data, so placing the sketch once
  // stands for each time its sources would place it. Other sketches, accessors and invalid values keep the ordinary path.
  const reads = isAcceptedCadSketchSource(feature) && cadScalarParameterNames(feature.offset).every(name => isOwnDataOrMissing(parameters, name))
    ? readCadSketchGeometryParameters(feature, parameters) : null;
  if (!reads) return { sources: cadSketchSources(feature, parameters, place) };
  let placement: CadResolvedPlacement;
  try { placement = place(); } catch { return { sources: cadSketchSources(feature, parameters, place) }; }
  const source = cadSketchPlacedFrom(feature);
  const previous = [recentSketches.get(source), olderSketches.get(source)]
    .find(entry => entry && sameCadSketchGeometryValues(reads.values, entry.values) && sameCadPlacement(placement, entry.placement));
  if (previous) {
    kept.set(source, previous);
    return { references: previous.references };
  }
  return { sources: cadSketchSources(feature, reads.environment, () => placement),
    remember: references => kept.set(source, { values: reads.values, placement, references }) };
}

function cadSketchSources(feature: CadSketchFeature, parameters: Readonly<Record<string, number>>, place: () => CadResolvedPlacement): ReferenceSource[] {
  const legacy = feature.profiles.flatMap<ReferenceSource>(profile => {
    try {
      const geometry = cadProfileReferenceGeometry(profile.geometry, parameters); const placement = place(); const offset = placement.offsetMm;
      if (!geometry.entities.length) return [];
      return [{ referenceId: `${feature.id}/${profile.id}`, featureId: feature.id, featureKind: 'sketch', name: feature.name, construction: profile.construction,
        frame: placement.frame, offset, entities: geometry.entities, bounds: typeof feature.plane === 'string' ? worldBounds(feature.plane, offset, geometry.bounds) : cadFrameEntityBounds(geometry.entities, placement.frame, offset) }];
    } catch { return []; } // Invalid sources retain their feature/editor diagnostics.
  });
  if (!feature.graph) return legacy;
  try {
    const graph = compileCadSketchGraph(feature.graph, parameters), construction = new Set(feature.graph.entities.filter(entity => entity.construction).map(entity => entity.id));
    const placement = place(), offset = placement.offsetMm;
    return [...legacy, ...graph.segments.map((segment): ReferenceSource => {
      const entities = [cadSketchGraphBoundary(segment)];
      return { referenceId: `${feature.id}/${segment.id}`, featureId: feature.id, featureKind: 'sketch', name: feature.name, construction: construction.has(segment.id),
        frame: placement.frame, offset, entities, bounds: typeof feature.plane === 'string' ? worldBounds(feature.plane, offset, segment.bounds) : cadFrameEntityBounds(entities, placement.frame, offset) };
    })];
  } catch { return legacy; }
}

const isOwnDataOrMissing = (parameters: Readonly<Record<string, number>>, name: string) => {
  const field = Object.getOwnPropertyDescriptor(parameters, name);
  return !field || 'value' in field;
};
const sameNumbers = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
function sameCadPlacement(left: CadResolvedPlacement, right: CadResolvedPlacement): boolean {
  return Object.is(left.offsetMm, right.offsetMm) && sameNumbers(left.frame.origin, right.frame.origin) && sameNumbers(left.frame.u, right.frame.u)
    && sameNumbers(left.frame.v, right.frame.v) && sameNumbers(left.frame.normal, right.frame.normal)
    && Object.is(left.frame.precision.angularUncertainty, right.frame.precision.angularUncertainty) && Object.is(left.frame.precision.originUncertaintyMm, right.frame.precision.originUncertaintyMm);
}

function cadSourceReference(source: ReferenceSource): CadViewportReference {
  const positions: number[] = [];
  const point = (value: { x: number; y: number }) => cadFramePointToWorld(source.frame, source.offset, [value.x, value.y]);
  for (const entity of source.entities) {
    if (entity.type === 'line') { positions.push(...point(entity.start), ...point(entity.end)); continue; }
    const startAngle = entity.type === 'circle' ? 0 : entity.startAngle;
    const sweep = entity.type === 'circle' ? 2 * Math.PI : entity.sweepRadians ?? entity.endAngle - entity.startAngle;
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 60)));
    const at = (index: number) => entity.type === 'arc' && index === 0 ? point(entity.start) : entity.type === 'arc' && index === steps ? point(entity.end)
      : point({ x: entity.center.x + entity.radius * Math.cos(startAngle + sweep * index / steps), y: entity.center.y + entity.radius * Math.sin(startAngle + sweep * index / steps) });
    let previous = at(0);
    for (let index = 1; index <= steps; index++) { const next = at(index); positions.push(...previous, ...next); previous = next; }
  }
  return Object.freeze({ referenceId: source.referenceId, featureId: source.featureId, featureKind: source.featureKind, name: source.name,
    construction: source.construction, positions: Object.freeze(positions), bounds: source.bounds });
}

/** Selection controls view-only source visibility; saved geometry is never rewritten. */
export function selectCadViewportReferences(prepared: readonly CadViewportReference[], features: readonly CadFeature[], selectedId: string | null): readonly CadViewportReference[] {
  const visibleSketches = new Set<string>(); const visibleDatums = new Set<string>(); const byId = new Map(features.map(feature => [feature.id, feature]));
  const selected = selectedId ? byId.get(selectedId) : undefined;
  if (!features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature))) {
    features.forEach(feature => { if (feature.kind === 'sketch' && !feature.suppressed) visibleSketches.add(feature.id); });
  }
  if (selected && !selected.suppressed) {
    const queue = [selected.id]; const visited = new Set<string>();
    while (queue.length) {
      const id = queue.pop(); if (!id || visited.has(id)) continue; visited.add(id);
      const feature = byId.get(id); if (!feature || feature.suppressed) continue;
      if (feature.kind === 'sketch') visibleSketches.add(feature.id);
      if (feature.kind === 'datum-plane') visibleDatums.add(feature.id);
      queue.push(...cadFeatureDependencies(feature));
    }
  }
  if (!prepared.some(reference => reference.featureKind !== 'datum-plane') && !features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature))) prepared.forEach(reference => { if (reference.featureId !== null) visibleDatums.add(reference.featureId); });
  return Object.freeze(prepared.filter(reference => reference.featureKind === 'curve' || reference.featureKind === 'sketch' && visibleSketches.has(reference.featureId) || reference.featureKind === 'datum-plane' && visibleDatums.has(reference.featureId)));
}

export function cadReferenceFeatureIds(references: readonly CadViewportReference[]): readonly string[] {
  const ids = [...new Set(references.flatMap(reference => reference.featureId === null ? [] : [reference.featureId]))].sort();
  return Object.freeze(ids);
}

/** Bounded view-only plane patch and local axes; authored geometry stays infinite. */
function cadPlaneGlyph(frame: CadResolvedFrame) {
  const at = (x: number, y: number, n = 0) => cadFramePointToWorld(frame, n, [x, y]);
  const corners = [at(-12.5, -12.5), at(12.5, -12.5), at(12.5, 12.5), at(-12.5, 12.5)];
  const positions: number[] = [];
  for (let index = 0; index < 4; index++) positions.push(...corners[index], ...corners[(index + 1) % 4]);
  for (const end of [at(10, 0), at(0, 10), at(0, 0, 10)]) positions.push(...frame.origin, ...end);
  positions.push(...at(0, 0, 10), ...at(2, 0, 7), ...at(0, 0, 10), ...at(-2, 0, 7));
  const all = [...corners, frame.origin, at(0, 0, 10)];
  const component = (axis: number, reducer: typeof Math.min) => reducer(...all.map(point => point[axis]));
  return Object.freeze({ labelPosition: Object.freeze(at(10, 10)),
    positions: Object.freeze(positions), planePatch: Object.freeze([...corners[0], ...corners[1], ...corners[2], ...corners[0], ...corners[2], ...corners[3]]),
    bounds: Object.freeze({ min: Object.freeze([component(0, Math.min), component(1, Math.min), component(2, Math.min)] as const), max: Object.freeze([component(0, Math.max), component(1, Math.max), component(2, Math.max)] as const) }) });
}

function cadDatumReference(feature: Extract<CadFeature, { kind: 'datum-plane' }>, frame: CadResolvedFrame): CadViewportFeatureReference {
  return Object.freeze({ ...cadPlaneGlyph(frame), referenceId: feature.id, featureId: feature.id, featureKind: 'datum-plane', name: feature.name, construction: false,
    plane: Object.freeze({ kind: 'datum-plane', featureId: feature.id }) });
}

/** World reference planes are display resources, never document feature IDs. */
export const CAD_PRINCIPAL_PLANE_REFERENCES: readonly CadViewportPrincipalPlaneReference[] = Object.freeze(
  (['XY', 'XZ', 'YZ'] as const).map(plane => Object.freeze({ ...cadPlaneGlyph(cadPrincipalFrame(plane)), referenceId: `principal:${plane}`,
    featureId: null, featureKind: 'principal-plane', plane, name: `${plane} plane`, construction: false })));

/** Principal-plane membership supplements feature IDs without duplicating datum IDs. */
export function cadReferencePlanes(references: readonly CadViewportReference[]): readonly CadPlane[] {
  return Object.freeze(references.flatMap(reference => reference.featureKind === 'principal-plane' ? [reference.plane] : []));
}

export function cadSameReferencePlane(a: CadSketchPlane | null, b: CadSketchPlane | null): boolean {
  return a === b || typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && a.featureId === b.featureId;
}

/** A plane hovered in the tree joins the design area so it can be found there; a datum keeps its feature identity. */
export function cadReferencesWithHoveredPlane(references: readonly CadViewportReference[], prepared: readonly CadViewportReference[], hovered: CadSketchPlane | null): readonly CadViewportReference[] {
  if (!hovered || references.some(reference => reference.plane && cadSameReferencePlane(reference.plane, hovered))) return references;
  const extra = typeof hovered === 'string' ? CAD_PRINCIPAL_PLANE_REFERENCES.find(reference => reference.plane === hovered)
    : prepared.find(reference => reference.featureKind === 'datum-plane' && reference.featureId === hovered.featureId);
  return extra ? Object.freeze([...references, extra]) : references;
}
