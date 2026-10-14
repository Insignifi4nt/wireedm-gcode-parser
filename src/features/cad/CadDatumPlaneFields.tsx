import type { CadDatumPlaneFeature, CadDocument, CadPoint3, CadScalar } from '@/domain/cad/cadDocument';
import { resolveCadWorldDatum } from '@/domain/cad/cadDatumPlanes';
import { ScalarField, SelectField } from './CadFields';
import { formatCadQuantity } from './cadDisplayQuantity';

export function CadDatumPlaneFields({ feature, parameters, onChange }: {
  feature: CadDatumPlaneFeature; parameters: CadDocument['parameters']; onChange(feature: CadDatumPlaneFeature): void;
}) {
  const { definition } = feature;
  const changeTuple = (field: 'origin' | 'rotation', index: number, value: CadScalar) => {
    const values: CadPoint3 = [index === 0 ? value : definition[field][0], index === 1 ? value : definition[field][1], index === 2 ? value : definition[field][2]];
    onChange({ ...feature, definition: { ...definition, [field]: values } });
  };
  let normal: string | null = null;
  try { normal = resolveCadWorldDatum(feature, parameters).normal.map(formatCadQuantity).join(', '); } catch { /* Apply reports invalid frame data. */ }
  return <>
    <SelectField label="Base plane" value={definition.basePlane} options={(['XY', 'XZ', 'YZ'] as const).map(value => ({ value, label: `${value} plane` }))} onChange={basePlane => onChange({ ...feature, definition: { ...definition, basePlane } })} />
    <div className="cad-field-section">Origin</div>
    {(['X', 'Y', 'Z'] as const).map((axis, index) => <ScalarField key={`origin.${axis}`} fieldKey={`definition.origin.${index}`} label={`Origin ${axis}`} value={definition.origin[index]} parameters={parameters} onChange={value => changeTuple('origin', index, value)} />)}
    <div className="cad-field-section" title="World X, then Y, then Z; origin stays fixed">Rotation</div>
    {(['X', 'Y', 'Z'] as const).map((axis, index) => <ScalarField key={`rotation.${axis}`} fieldKey={`definition.rotation.${index}`} label={`Around ${axis}`} unit="deg" value={definition.rotation[index]} parameters={parameters} onChange={value => changeTuple('rotation', index, value)} />)}
    {normal && <dl className="cad-topology-details"><dt>Normal +n</dt><dd>{normal}</dd></dl>}
  </>;
}
