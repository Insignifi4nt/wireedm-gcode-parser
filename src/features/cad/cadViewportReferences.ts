import type { CadFeature, CadPlane, CadProfile, CadSketchPlane } from '@/domain/cad/cadDocument';
import { inspectCadCurve, type CadBounds3 } from '@/domain/cad/cadCurve';
import { prepareCadDatumFrames, resolveCadSketchPlacement, resolveCadWorldDatum, cadFramePointToWorld, cadPrincipalFrame, type CadResolvedFrame } from '@/domain/cad/cadDatumPlanes';
import { cadFrameEntityBounds } from '@/domain/cad/cadFrameBounds';
import { cadPlanePointToWorld } from '@/domain/cad/cadPlanes';
import { cadFeatureDependencies, cadFeatureProducesBody } from '@/domain/cad/cadSchema';
import { cadProfileToEntities, resolveCadProfile, type CadAnalyticBoundary } from '@/domain/cad/cadSketchGeometry';
import { arcBounds, boundsFromPoints, emptyBounds, mergeBounds } from '@/domain/path-intel/segments';
import type { Bounds2 } from '@/domain/path-intel/types';

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
export const MAX_CAD_REFERENCE_DISPLAY_SEGMENTS = 32768;
const MAX_REFERENCE_FEATURE_IDS = 256;
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

/** Prepare once per immutable accepted revision; all sources share one display budget. */
export function prepareCadViewportReferences(features: readonly CadFeature[], parameters: Readonly<Record<string, number>>): readonly CadViewportReference[] {
  const frames = prepareCadDatumFrames(features, parameters);
  const glyphs = features.flatMap(feature => feature.kind === 'datum-plane' && !feature.suppressed ? [cadDatumReference(feature, resolveCadWorldDatum(feature, parameters))] : []);
  const sources = features.flatMap<ReferenceSource>(feature => {
    if (feature.suppressed) return [];
    if (feature.kind === 'curve') {
      const result = inspectCadCurve(feature, parameters, frames);
      return result.eligible ? [{ referenceId: feature.id, featureId: feature.id, featureKind: 'curve', name: feature.name, construction: false,
        frame: resolveCadSketchPlacement(feature, parameters, frames).frame, offset: result.curve.offset, entities: result.curve.entities, bounds: result.curve.worldBounds }] : [];
    }
    if (feature.kind !== 'sketch') return [];
    return feature.profiles.flatMap<ReferenceSource>(profile => {
      try {
        const geometry = cadProfileReferenceGeometry(profile.geometry, parameters); const placement = resolveCadSketchPlacement(feature, parameters, frames); const offset = placement.offsetMm;
        if (!geometry.entities.length) return [];
        return [{ referenceId: `${feature.id}/${profile.id}`, featureId: feature.id, featureKind: 'sketch', name: feature.name, construction: profile.construction,
          frame: placement.frame, offset, entities: geometry.entities, bounds: typeof feature.plane === 'string' ? worldBounds(feature.plane, offset, geometry.bounds) : cadFrameEntityBounds(geometry.entities, placement.frame, offset) }];
      } catch { return []; } // Invalid sources retain their feature/editor diagnostics.
    });
  });
  const edgeCount = sources.reduce((sum, source) => sum + source.entities.length, 0);
  const contourBudget = MAX_CAD_REFERENCE_DISPLAY_SEGMENTS - glyphs.reduce((sum, glyph) => sum + glyph.positions.length / 6, 0);
  if (edgeCount > contourBudget) throw new Error('CAD source geometry exceeds the reference display budget.');
  const perEdge = Math.max(1, Math.floor(contourBudget / Math.max(1, edgeCount)));
  return Object.freeze([...glyphs, ...sources.map(source => {
    const positions: number[] = [];
    const point = (value: { x: number; y: number }) => cadFramePointToWorld(source.frame, source.offset, [value.x, value.y]);
    for (const entity of source.entities) {
      if (entity.type === 'line') { positions.push(...point(entity.start), ...point(entity.end)); continue; }
      const startAngle = entity.type === 'circle' ? 0 : entity.startAngle;
      const sweep = entity.type === 'circle' ? 2 * Math.PI : entity.sweepRadians ?? entity.endAngle - entity.startAngle;
      const steps = Math.min(perEdge, Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 60))));
      const at = (index: number) => entity.type === 'arc' && index === 0 ? point(entity.start) : entity.type === 'arc' && index === steps ? point(entity.end)
        : point({ x: entity.center.x + entity.radius * Math.cos(startAngle + sweep * index / steps), y: entity.center.y + entity.radius * Math.sin(startAngle + sweep * index / steps) });
      let previous = at(0);
      for (let index = 1; index <= steps; index++) { const next = at(index); positions.push(...previous, ...next); previous = next; }
    }
    return Object.freeze({ referenceId: source.referenceId, featureId: source.featureId, featureKind: source.featureKind, name: source.name,
      construction: source.construction, positions: Object.freeze(positions), bounds: source.bounds });
  })]);
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
  if (ids.length > MAX_REFERENCE_FEATURE_IDS) throw new Error('CAD references exceed the document feature limit.');
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
