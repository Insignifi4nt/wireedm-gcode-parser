import type { CadFeature } from './cadDocument';

/** Typed references stay independent of schema/geometry initialization. */
function operandInputs(feature: CadFeature): { readonly sketchIds: readonly string[]; readonly curveIds: readonly string[]; readonly bodyIds: readonly string[] } {
  const curveIds: readonly string[] = [];
  switch (feature.kind) {
    case 'sketch': return { sketchIds: [...new Set(feature.graph?.relations.flatMap(relation => relation.kind === 'external-reference' ? [relation.sourceSketchId] : []) ?? [])], curveIds, bodyIds: [] };
    case 'datum-plane': case 'curve': case 'imported': return { sketchIds: [], curveIds, bodyIds: [] };
    case 'extrude': case 'revolve': return { sketchIds: [feature.sketchId], curveIds, bodyIds: feature.targetId === null ? [] : [feature.targetId] };
    case 'pocket': return { sketchIds: [feature.sketchId], curveIds, bodyIds: [feature.targetId] };
    case 'loft': return { sketchIds: feature.sketchIds, curveIds, bodyIds: feature.targetId === null ? [] : [feature.targetId] };
    case 'sweep': return { sketchIds: [feature.sketchId], curveIds: [feature.curveId], bodyIds: feature.targetId === null ? [] : [feature.targetId] };
    case 'fillet': case 'chamfer': case 'shell': return { sketchIds: [], curveIds, bodyIds: [feature.targetId] };
    case 'boolean': return { sketchIds: [], curveIds, bodyIds: [feature.targetId, feature.toolId] };
    case 'transform': case 'linear-pattern': case 'circular-pattern': case 'mirror': return { sketchIds: [], curveIds, bodyIds: [feature.sourceId] };
    default: { const exhaustive: never = feature; return exhaustive; }
  }
}
export function cadFeatureInputs(feature: CadFeature) {
  const datumIds: readonly string[] = (feature.kind === 'sketch' || feature.kind === 'curve') && typeof feature.plane !== 'string' ? [feature.plane.featureId] : [];
  return { ...operandInputs(feature), datumIds };
}
export function cadFeatureDependencies(feature: CadFeature): string[] {
  const inputs = cadFeatureInputs(feature);
  return [...inputs.sketchIds, ...inputs.curveIds, ...inputs.bodyIds, ...inputs.datumIds];
}
export type CadBodyFeature = Exclude<CadFeature, { readonly kind: 'datum-plane' | 'sketch' | 'curve' }>;
export function cadFeatureProducesBody(feature: CadFeature): feature is CadBodyFeature {
  switch (feature.kind) {
    case 'datum-plane': case 'sketch': case 'curve': return false;
    case 'imported': case 'extrude': case 'revolve': case 'loft': case 'sweep': case 'pocket': case 'fillet': case 'chamfer': case 'shell':
    case 'boolean': case 'transform': case 'linear-pattern': case 'circular-pattern': case 'mirror': return true;
    default: { const exhaustive: never = feature; return exhaustive; }
  }
}
export function cadConsumedBodyIds(feature: CadFeature): readonly string[] {
  return feature.suppressed || feature.kind === 'mirror' ? [] : cadFeatureInputs(feature).bodyIds;
}
export function cadVisibleBodyIds(features: readonly CadFeature[]): readonly string[] {
  const visible = new Set<string>();
  for (const feature of features) {
    cadConsumedBodyIds(feature).forEach(id => visible.delete(id));
    if (cadFeatureProducesBody(feature) && !feature.suppressed) visible.add(feature.id);
  }
  return [...visible];
}
