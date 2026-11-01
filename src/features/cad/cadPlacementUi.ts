import type { CadDocument, CadFeature, CadSketchPlane } from '@/domain/cad/cadDocument';
import { cadFeatureActive } from '@/domain/cad/features/cadFeatureActivity';

export function cadPlacementLabel(plane: CadSketchPlane, features: readonly CadFeature[]): string {
  return typeof plane === 'string' ? plane : features.find(feature => feature.id === plane.featureId)?.name ?? 'Unavailable plane';
}

export function cadPlacementValue(plane: CadSketchPlane): string {
  return typeof plane === 'string' ? plane : `datum:${plane.featureId}`;
}

/** Options carry the typed value; DOM strings never become unchecked references. */
export function cadPlacementOptions(document: Pick<CadDocument, 'features' | 'parameters'>, featureId: string, plane: CadSketchPlane) {
  const { features } = document, index = features.findIndex(feature => feature.id === featureId);
  const preceding = index < 0 ? features : features.slice(0, index);
  const options: { value: string; label: string; plane: CadSketchPlane; disabled?: boolean }[] =
    (['XY', 'XZ', 'YZ'] as const).map(value => ({ value, label: `${value} plane`, plane: value }));
  for (const feature of preceding) if (feature.kind === 'datum-plane' && cadFeatureActive(feature, document)) {
    options.push({ value: `datum:${feature.id}`, label: feature.name, plane: Object.freeze({ kind: 'datum-plane', featureId: feature.id }) });
  }
  const selected = cadPlacementValue(plane);
  if (!options.some(option => option.value === selected)) options.unshift({ value: selected, label: `${cadPlacementLabel(plane, features)} (unavailable)`, plane, disabled: true });
  return options;
}
