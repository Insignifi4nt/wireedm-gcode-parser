import { useMemo } from 'react';
import type { CadDocument, CadSketchPlane } from '@/domain/cad/cadDocument';
import { cadPlacementOptions, cadPlacementValue } from './cadPlacementUi';
import { SelectField } from './CadFields';

export function CadPlacementField({ document, featureId, plane, onChange }: {
  document: Pick<CadDocument, 'features' | 'parameters'>; featureId: string; plane: CadSketchPlane; onChange(plane: CadSketchPlane): void;
}) {
  const options = useMemo(() => cadPlacementOptions(document, featureId, plane), [document, featureId, plane]);
  return <SelectField label="Reference plane" value={cadPlacementValue(plane)} options={options} onChange={value => {
    const option = options.find(entry => entry.value === value);
    if (option && !option.disabled) onChange(option.plane);
  }} />;
}
