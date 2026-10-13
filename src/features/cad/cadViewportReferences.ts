import type { CadFeature, CadPlane, CadProfile } from '@/domain/cad/cadDocument';
import { inspectCadCurve, type CadBounds3 } from '@/domain/cad/cadCurve';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadPlanePointToWorld } from '@/domain/cad/cadPlanes';
import { cadFeatureDependencies, cadFeatureProducesBody } from '@/domain/cad/cadSchema';
import { cadProfileToEntities, resolveCadProfile, type CadAnalyticBoundary } from '@/domain/cad/cadSketchGeometry';
import { arcBounds, boundsFromPoints, emptyBounds, mergeBounds } from '@/domain/path-intel/segments';
import type { Bounds2 } from '@/domain/path-intel/types';

export interface CadViewportReference {
  readonly referenceId: string;
  readonly featureId: string;
  readonly featureKind: 'sketch' | 'curve';
  readonly name: string;
  readonly construction: boolean;
  readonly positions: readonly number[];
  readonly bounds: CadBounds3;
}
export const MAX_CAD_REFERENCE_DISPLAY_SEGMENTS = 32768;
const MAX_REFERENCE_FEATURE_IDS = 256;
interface ReferenceSource extends Omit<CadViewportReference, 'positions'> {
  readonly plane: CadPlane;
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
  const sources = features.flatMap<ReferenceSource>(feature => {
    if (feature.suppressed) return [];
    if (feature.kind === 'curve') {
      const result = inspectCadCurve(feature, parameters);
      return result.eligible ? [{ referenceId: feature.id, featureId: feature.id, featureKind: 'curve', name: feature.name, construction: false,
        plane: result.curve.plane, offset: result.curve.offset, entities: result.curve.entities, bounds: result.curve.worldBounds }] : [];
    }
    if (feature.kind !== 'sketch') return [];
    return feature.profiles.flatMap<ReferenceSource>(profile => {
      try {
        const geometry = cadProfileReferenceGeometry(profile.geometry, parameters); const offset = evaluateCadScalar(feature.offset, parameters);
        if (!geometry.entities.length) return [];
        return [{ referenceId: `${feature.id}/${profile.id}`, featureId: feature.id, featureKind: 'sketch', name: feature.name, construction: profile.construction,
          plane: feature.plane, offset, entities: geometry.entities, bounds: worldBounds(feature.plane, offset, geometry.bounds) }];
      } catch { return []; } // Invalid sources retain their feature/editor diagnostics.
    });
  });
  const edgeCount = sources.reduce((sum, source) => sum + source.entities.length, 0);
  if (edgeCount > MAX_CAD_REFERENCE_DISPLAY_SEGMENTS) throw new Error('CAD source geometry exceeds the reference display budget.');
  const perEdge = Math.max(1, Math.floor(MAX_CAD_REFERENCE_DISPLAY_SEGMENTS / Math.max(1, edgeCount)));
  return Object.freeze(sources.map(source => {
    const positions: number[] = [];
    const point = (value: { x: number; y: number }) => cadPlanePointToWorld(source.plane, source.offset, [value.x, value.y]);
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
  }));
}

/** Selection controls view-only source visibility; saved geometry is never rewritten. */
export function selectCadViewportReferences(prepared: readonly CadViewportReference[], features: readonly CadFeature[], selectedId: string | null): readonly CadViewportReference[] {
  const visibleSketches = new Set<string>(); const byId = new Map(features.map(feature => [feature.id, feature]));
  const selected = selectedId ? byId.get(selectedId) : undefined;
  if (!features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature))) {
    features.forEach(feature => { if (feature.kind === 'sketch' && !feature.suppressed) visibleSketches.add(feature.id); });
  } else if (selected && !selected.suppressed) {
    const queue = [selected.id]; const visited = new Set<string>();
    while (queue.length) {
      const id = queue.pop(); if (!id || visited.has(id)) continue; visited.add(id);
      const feature = byId.get(id); if (!feature || feature.suppressed) continue;
      if (feature.kind === 'sketch') visibleSketches.add(feature.id);
      else if (cadFeatureProducesBody(feature)) queue.push(...cadFeatureDependencies(feature));
    }
  }
  return Object.freeze(prepared.filter(reference => reference.featureKind === 'curve' || visibleSketches.has(reference.featureId)));
}

export function cadReferenceFeatureIds(references: readonly CadViewportReference[]): readonly string[] {
  const ids = [...new Set(references.map(reference => reference.featureId))].sort();
  if (ids.length > MAX_REFERENCE_FEATURE_IDS) throw new Error('CAD references exceed the document feature limit.');
  return Object.freeze(ids);
}
