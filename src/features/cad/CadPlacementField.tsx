import { useMemo } from 'react';
import type { CadFeature, CadSketchPlane } from '@/domain/cad/cadDocument';
import { cadPlacementOptions, cadPlacementValue } from './cadPlacementUi';
import { SelectField } from './CadFields';

export function CadPlacementField({ features, featureId, plane, onChange }: {
  features: readonly CadFeature[]; featureId: string; plane: CadSketchPlane; onChange(plane: CadSketchPlane): void;
}) {
  const options = useMemo(() => cadPlacementOptions(features, featureId, plane), [features, featureId, plane]);
  return <SelectField label="Reference plane" value={cadPlacementValue(plane)} options={options} onChange={value => {
    const option = options.find(entry => entry.value === value);
    if (option && !option.disabled) onChange(option.plane);
  }} />;
}
