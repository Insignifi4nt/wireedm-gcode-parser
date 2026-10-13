import { useEffect, useRef } from 'react';
import type { CadDocument, CadFeature, CadScalar } from '@/domain/cad/cadDocument';
import type { CadPocketDirection, CadPocketFeature } from '@/domain/cad/cadPocket';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { CadPlacementNormal } from './CadPlacementNormal';
import { ScalarField, SelectField } from './CadFields';

type DistanceFeature = Extract<CadFeature, { kind: 'extrude' }>;
type ExtrudeFeature = DistanceFeature | CadPocketFeature;
type Option = { readonly value: string; readonly label: string; readonly disabled?: boolean };
type DistanceDraft = Pick<DistanceFeature, 'distance' | 'symmetric'>;
const operationOptions = [
  { value: 'new', label: 'New body' }, { value: 'join', label: 'Join to body' }, { value: 'cut', label: 'Cut from body' },
] as const;

function distanceDraft(feature: ExtrudeFeature): DistanceDraft {
  return feature.kind === 'extrude' ? { distance: feature.distance, symmetric: feature.symmetric }
    : { distance: feature.extent.direction === 'negative' ? -10 : 10, symmetric: feature.extent.direction === 'both' };
}

/** Keep dormant form values locally; saved features contain only their active extent. */
export function CadExtrudeFields({ feature, initialFeature, document, sketches, bodies, onChange }: {
  feature: ExtrudeFeature;
  initialFeature: ExtrudeFeature;
  document: CadDocument;
  sketches: readonly Option[];
  bodies: readonly Option[];
  onChange(feature: ExtrudeFeature): void;
}) {
  const rememberedDistance = useRef<DistanceDraft | null>(initialFeature.kind === 'extrude' ? distanceDraft(initialFeature) : null);
  useEffect(() => { rememberedDistance.current = initialFeature.kind === 'extrude' ? distanceDraft(initialFeature) : null; }, [initialFeature]);
  const operation = feature.kind === 'pocket' ? 'cut' : feature.operation;
  const base = { id: feature.id, name: feature.name, suppressed: feature.suppressed, sketchId: feature.sketchId };
  const targetId = feature.targetId ?? '';
  const availableOptions = (options: readonly Option[], value: string, noun: string): readonly Option[] => options.some(option => option.value === value) ? options
    : [{ value, label: value ? `${document.features.find(entry => entry.id === value)?.name ?? noun} (unavailable)` : `Choose ${noun.toLowerCase()}`, disabled: true }, ...options];
  const toDistance = (nextOperation: DistanceFeature['operation']) => {
    // Until a distance is authored, derive its editable default from the current
    // Pocket direction rather than the earlier accepted feature's direction.
    const dimensions = rememberedDistance.current ?? distanceDraft(feature);
    rememberedDistance.current = dimensions;
    onChange({ ...base, kind: 'extrude', ...dimensions,
      operation: nextOperation, targetId: nextOperation === 'new' ? null : feature.targetId || bodies.at(-1)?.value || null });
  };
  const toThroughAll = () => {
    if (feature.kind !== 'extrude') return;
    rememberedDistance.current = { distance: feature.distance, symmetric: feature.symmetric };
    let direction: CadPocketDirection = feature.symmetric ? 'both' : 'positive';
    if (!feature.symmetric) {
      try { if (evaluateCadScalar(feature.distance, document.parameters) < 0) direction = 'negative'; }
      catch { /* The inactive distance expression remains a local draft. */ }
    }
    onChange({ ...base, kind: 'pocket', targetId: feature.targetId || bodies.at(-1)?.value || '', extent: { kind: 'through-all', direction } });
  };
  const sketch = document.features.find(entry => entry.id === feature.sketchId && entry.kind === 'sketch');
  const normal = sketch?.kind === 'sketch' && typeof sketch.plane !== 'string' ? ['Along plane normal (+n)', 'Opposite plane normal (−n)'] : sketch?.kind === 'sketch' && sketch.plane === 'XZ' ? ['−Y', '+Y'] : sketch?.kind === 'sketch' && sketch.plane === 'YZ' ? ['+X', '−X'] : ['+Z', '−Z'];
  const updateDistance = (values: Partial<DistanceDraft>) => {
    if (feature.kind !== 'extrude') return;
    rememberedDistance.current = { distance: feature.distance, symmetric: feature.symmetric, ...values };
    onChange({ ...feature, ...values });
  };
  return <>
    <SelectField label="Profile sketch" value={feature.sketchId} options={availableOptions(sketches, feature.sketchId, 'Sketch')} onChange={sketchId => onChange({ ...feature, sketchId })} />
    <SelectField label="Operation" value={operation} options={operationOptions} onChange={nextOperation => {
      if (feature.kind === 'pocket') { if (nextOperation !== 'cut') toDistance(nextOperation); }
      else onChange({ ...feature, operation: nextOperation, targetId: nextOperation === 'new' ? null : feature.targetId || bodies.at(-1)?.value || null });
    }} />
    {operation === 'cut' && <SelectField label="Extent" value={feature.kind === 'pocket' ? 'through-all' : 'distance'}
      options={[{ value: 'distance', label: 'Distance' }, { value: 'through-all', label: 'Through all' }]}
      onChange={extent => { if (extent === 'through-all') toThroughAll(); else if (feature.kind === 'pocket') toDistance('cut'); }} />}
    {feature.kind === 'pocket'
      ? <SelectField label="Direction" value={feature.extent.direction} options={[
        { value: 'positive', label: `${normal[0]} from sketch` }, { value: 'negative', label: `${normal[1]} from sketch` }, { value: 'both', label: 'Both directions' },
      ]} onChange={direction => onChange({ ...feature, extent: { kind: 'through-all', direction } })} />
      : <><ScalarField label="Length" value={feature.distance} parameters={document.parameters} onChange={(distance: CadScalar) => updateDistance({ distance })} />
        <label className="cad-check"><input type="checkbox" checked={feature.symmetric} onChange={event => updateDistance({ symmetric: event.target.checked })} /> Symmetric about sketch plane</label></>}
    {sketch?.kind === 'sketch' && <CadPlacementNormal plane={sketch.plane} document={document} />}
    {operation !== 'new' && <SelectField label="Target body" value={targetId} options={availableOptions(bodies, targetId, 'Body')} onChange={value => onChange({ ...feature, targetId: value })} />}
  </>;
}
