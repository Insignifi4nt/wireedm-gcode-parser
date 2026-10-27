import { Input } from '@/components/ui/input';
import { useEffect, useRef } from 'react';
import type { CadDocument, CadFeature, CadScalar } from '@/domain/cad/cadDocument';
import type { CadPocketDirection, CadPocketFeature } from '@/domain/cad/cadPocket';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { CadPlacementNormal } from './CadPlacementNormal';
import { ScalarField, SelectField } from './CadFields';
import { cadSketchSupportsThroughAll } from '@/domain/cad/cadSketchSources';
import { CadSketchSourceField } from './CadSketchSourceField';
import { CadSketchRegionsField } from './CadSketchRegionsField';

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
export function CadExtrudeFields({ feature, initialFeature, revision, document, sketches, bodies, onChange }: {
  feature: ExtrudeFeature;
  initialFeature: ExtrudeFeature;
  /** Changes with each revision the form starts again from, also where it kept `initialFeature`'s object. */
  revision?: unknown;
  document: CadDocument;
  sketches: readonly Option[];
  bodies: readonly Option[];
  onChange(feature: ExtrudeFeature): void;
}) {
  const rememberedDistance = useRef<DistanceDraft | null>(initialFeature.kind === 'extrude' ? distanceDraft(initialFeature) : null);
  useEffect(() => { rememberedDistance.current = initialFeature.kind === 'extrude' ? distanceDraft(initialFeature) : null; }, [initialFeature, revision]);
  const operation = feature.kind === 'pocket' ? 'cut' : feature.operation;
  const base = { id: feature.id, name: feature.name, suppressed: feature.suppressed, sketchId: feature.sketchId,
    ...(feature.regionSelection ? { regionSelection: feature.regionSelection } : {}) };
  const targetId = feature.targetId ?? '';
  const sketch = document.features.find(entry => entry.id === feature.sketchId && entry.kind === 'sketch');
  const throughAllUnsupported = sketch?.kind === 'sketch' && !cadSketchSupportsThroughAll(sketch);
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
  const normal = sketch?.kind === 'sketch' && typeof sketch.plane !== 'string' ? ['Along plane normal (+n)', 'Opposite plane normal (−n)'] : sketch?.kind === 'sketch' && sketch.plane === 'XZ' ? ['−Y', '+Y'] : sketch?.kind === 'sketch' && sketch.plane === 'YZ' ? ['+X', '−X'] : ['+Z', '−Z'];
  const updateDistance = (values: Partial<DistanceDraft>) => {
    if (feature.kind !== 'extrude') return;
    rememberedDistance.current = { distance: feature.distance, symmetric: feature.symmetric, ...values };
    onChange({ ...feature, ...values });
  };
  const changeSource = (sketchId: string) => {
    if (sketchId === feature.sketchId) return;
    const next = { ...feature, sketchId };
    // Cell identities belong to their source sketch. Deliberate source replacement
    // starts with its whole sketch rather than reinterpreting coincident profile IDs.
    delete next.regionSelection;
    onChange(next);
  };
  const changeAreas = (regionSelection: ExtrudeFeature['regionSelection']) => {
    const next = { ...feature };
    if (regionSelection === undefined) delete next.regionSelection;
    else next.regionSelection = regionSelection;
    onChange(next);
  };
  return <>
    <CadSketchSourceField document={document} sketches={sketches} purpose={feature.kind} sketchId={feature.sketchId} onChange={changeSource} />
    <CadSketchRegionsField document={document} sketchId={feature.sketchId} selection={feature.regionSelection} onChange={changeAreas} />
    <SelectField label="Operation" value={operation} options={operationOptions} onChange={nextOperation => {
      if (feature.kind === 'pocket') { if (nextOperation !== 'cut') toDistance(nextOperation); }
      else onChange({ ...feature, operation: nextOperation, targetId: nextOperation === 'new' ? null : feature.targetId || bodies.at(-1)?.value || null });
    }} />
    {operation === 'cut' && <SelectField label="Extent" value={feature.kind === 'pocket' ? 'through-all' : 'distance'}
      description={throughAllUnsupported ? 'Through-all requires an XY, XZ or YZ sketch.' : undefined}
      options={[{ value: 'distance', label: 'Distance' }, { value: 'through-all', label: 'Through all', disabled: throughAllUnsupported }]}
      onChange={extent => { if (extent === 'through-all') toThroughAll(); else if (feature.kind === 'pocket') toDistance('cut'); }} />}
    {feature.kind === 'pocket'
      ? <SelectField label="Direction" value={feature.extent.direction} options={[
        { value: 'positive', label: `${normal[0]} from sketch` }, { value: 'negative', label: `${normal[1]} from sketch` }, { value: 'both', label: 'Both directions' },
      ]} onChange={direction => onChange({ ...feature, extent: { kind: 'through-all', direction } })} />
      : <><ScalarField fieldKey="distance" label="Length" value={feature.distance} parameters={document.parameters} onChange={(distance: CadScalar) => updateDistance({ distance })} />
        <label className="cad-check"><Input type="checkbox" checked={feature.symmetric} onChange={event => updateDistance({ symmetric: event.target.checked })} /> Symmetric about sketch plane</label></>}
    {sketch?.kind === 'sketch' && <CadPlacementNormal plane={sketch.plane} document={document} />}
    {operation !== 'new' && <SelectField reference label="Target body" value={targetId} options={availableOptions(bodies, targetId, 'Body')} onChange={value => onChange({ ...feature, targetId: value })} />}
  </>;
}
