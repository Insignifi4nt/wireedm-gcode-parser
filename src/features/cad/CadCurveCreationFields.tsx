import type { CadCurveFeature, CadDocument, CadPlane } from '@/domain/cad/cadDocument';
import { ScalarField, SelectField } from './CadFields';

/** These fields and the canvas share one provisional feature; no empty Curve is saved. */
export function CadCurveCreationFields({ draft, parameters, onChange, onCancel }: {
  draft: CadCurveFeature; parameters: CadDocument['parameters']; onChange(draft: CadCurveFeature): void; onCancel(): void;
}) {
  return <div className="cad-property-form">
    <div className="cad-property-title">Create Curve</div>
    <label className="cad-field"><span>Name</span><input value={draft.name} onChange={event => onChange({ ...draft, name: event.target.value })} /></label>
    <SelectField label="Reference plane" value={draft.plane} options={(['XY', 'XZ', 'YZ'] satisfies CadPlane[]).map(value => ({ value, label: `${value} plane` }))} onChange={plane => onChange({ ...draft, plane })} />
    <ScalarField label="Plane offset" value={draft.offset} parameters={parameters} onChange={offset => onChange({ ...draft, offset })} />
    <div className="cad-form-actions"><button type="button" onClick={onCancel}>Cancel</button></div>
  </div>;
}
