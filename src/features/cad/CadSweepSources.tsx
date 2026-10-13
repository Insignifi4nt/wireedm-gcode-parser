import { useMemo } from 'react';
import type { CadDocument, CadSweepFeature } from '@/domain/cad/cadDocument';
import { inspectCadSweepInputs } from '@/domain/cad/cadSweep';
import { SelectField } from './CadFields';
import { inspectCadSweepCandidates } from './cadSweepUi';

export function CadSweepSources({ document, featureId, sketchId, curveId, onChange, applyError = null }: {
  document: CadDocument;
  featureId: string;
  sketchId: string;
  curveId: string;
  onChange(sources: Pick<CadSweepFeature, 'sketchId' | 'curveId'>): void;
  applyError?: string | null;
}) {
  const candidates = useMemo(() => inspectCadSweepCandidates(document, featureId), [document.features, document.parameters, featureId]);
  // This read-only check concerns the geometry pair. Name, operation and target
  // still pass through the full atomic feature validation when Apply is used.
  const inspection = useMemo(() => inspectCadSweepInputs({ id: 'sweep_preview', name: 'Sweep', kind: 'sweep', suppressed: false,
    sketchId, curveId, operation: 'new', targetId: null }, candidates.precedingFeatures, document.parameters), [candidates, document.parameters, sketchId, curveId]);
  const options = (sourceId: string, kind: 'Sketch' | 'Curve', entries: readonly { readonly id: string; readonly name: string; readonly eligible: boolean }[]) => {
    const existing = entries.map(entry => ({ value: entry.id, label: `${entry.name}${entry.eligible ? '' : ' (unavailable)'}`, disabled: !entry.eligible }));
    if (existing.some(entry => entry.value === sourceId)) return existing;
    return [{ value: sourceId, label: sourceId ? `${document.features.find(feature => feature.id === sourceId)?.name ?? kind} (unavailable)` : `Choose a ${kind.toLowerCase()}`, disabled: true }, ...existing];
  };
  const message = !sketchId || !curveId ? 'Choose a profile sketch and a Curve.' : !inspection.eligible ? inspection.message : null;
  return <>
    <SelectField label="Profile sketch" value={sketchId} options={options(sketchId, 'Sketch', candidates.sketches.map(candidate => ({ id: candidate.sketch.id, name: candidate.sketch.name, eligible: candidate.inspection.eligible })))}
      onChange={next => onChange({ sketchId: next, curveId })} />
    <SelectField label="Curve" value={curveId} options={options(curveId, 'Curve', candidates.curves.map(candidate => ({ id: candidate.curve.id, name: candidate.curve.name, eligible: candidate.inspection.eligible })))}
      onChange={next => onChange({ sketchId, curveId: next })} />
    {message && message !== applyError && <p className="cad-error" role="status">{message}</p>}
  </>;
}
