import type { CadFeature } from '@/domain/cad/cadDocument';
import { cadFeatureDependencies } from '@/domain/cad/cadFeatureInputs';

/** Solid features that consume sketches or curves as their own definition, like CATIA's Pad containing its Sketch. */
const ABSORBING_KINDS = new Set<CadFeature['kind']>(['extrude', 'pocket', 'revolve', 'loft', 'sweep']);
const ABSORBED_KINDS = new Set<CadFeature['kind']>(['sketch', 'curve']);

export interface CadFeatureTreeRelationships {
  readonly byId: ReadonlyMap<string, CadFeature>;
  /** Features that use each feature, in history order. */
  readonly downstream: ReadonlyMap<string, readonly CadFeature[]>;
  /** The feature a sketch or curve is nested under: its first solid consumer in history. */
  readonly owner: ReadonlyMap<string, CadFeature>;
  /** Sketches and curves nested under each feature, in history order. */
  readonly children: ReadonlyMap<string, readonly CadFeature[]>;
  /** Sketches and curves a feature also uses that are nested under an earlier consumer. */
  readonly shared: ReadonlyMap<string, readonly CadFeature[]>;
  /** History positions, 1-based, so nested rows keep their place in the build order. */
  readonly position: ReadonlyMap<string, number>;
}

/** The specification tree's structure, derived from the same dependency model as rebuild. Document data is never changed. */
export function cadFeatureTreeRelationships(features: readonly CadFeature[]): CadFeatureTreeRelationships {
  const byId = new Map(features.map(feature => [feature.id, feature]));
  const position = new Map(features.map((feature, index) => [feature.id, index + 1]));
  const downstream = new Map<string, CadFeature[]>(), owner = new Map<string, CadFeature>(), children = new Map<string, CadFeature[]>(), shared = new Map<string, CadFeature[]>();
  const add = (map: Map<string, CadFeature[]>, key: string, value: CadFeature) => { const list = map.get(key) ?? []; list.push(value); map.set(key, list); };
  for (const feature of features) {
    for (const id of new Set(cadFeatureDependencies(feature))) {
      const source = byId.get(id);
      add(downstream, id, feature);
      // Only an earlier sketch or curve can be absorbed; a broken forward reference stays visible at the top level.
      if (!source || !ABSORBING_KINDS.has(feature.kind) || !ABSORBED_KINDS.has(source.kind) || (position.get(id) ?? 0) > (position.get(feature.id) ?? 0)) continue;
      if (owner.has(id)) { add(shared, feature.id, source); continue; }
      owner.set(id, feature); add(children, feature.id, source);
    }
  }
  return { byId, downstream, owner, children, shared, position };
}
