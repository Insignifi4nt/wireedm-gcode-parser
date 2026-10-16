import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { CadCurveFeature, CadDocument } from '@/domain/cad/cadDocument';
import { ScalarField } from './CadFields';
import { CadPlacementNormal } from './CadPlacementNormal';
import { CadPlacementField } from './CadPlacementField';

/** These fields and the canvas share one provisional feature; no empty Curve is saved. */
export function CadCurveCreationFields({ draft, document, onChange, onCancel }: {
  draft: CadCurveFeature; document: CadDocument; onChange(draft: CadCurveFeature): void; onCancel(): void;
}) {
  return <div className="cad-property-form">
    <div className="cad-property-title">Create curve</div>
    <label className="cad-field"><span>Name</span><Input value={draft.name} onChange={event => onChange({ ...draft, name: event.target.value })} /></label>
    <CadPlacementField features={document.features} featureId={draft.id} plane={draft.plane} onChange={plane => onChange({ ...draft, plane })} />
    <ScalarField label="Plane offset" value={draft.offset} parameters={document.parameters} onChange={offset => onChange({ ...draft, offset })} />
    <CadPlacementNormal plane={draft.plane} document={document} />
    <div className="cad-form-actions"><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </div>;
}
