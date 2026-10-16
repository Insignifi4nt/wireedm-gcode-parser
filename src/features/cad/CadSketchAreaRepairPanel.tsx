import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CloseIcon, SelectIcon } from '@wire-edm/icons-react';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { prepareCadDatumFrames, resolveCadSketchPlacement } from '@/domain/cad/cadDatumPlanes';
import type { CadSketchCellReference } from '@/domain/cad/cadSketchRegionSelection';
import { CadContextHelp } from './CadContextHelp';
import type { CadFeatureReferencePickCommand, CadFeatureRegionPickCommand } from './cadFeatureReferencePicking';
import type { CadSketchAreaRepairInspection, CadSketchAreaRepairs } from './cadSketchEditDraft';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import './cad-sketch-regions.css';

export interface CadSketchAreaRepairPanelProps {
  readonly formId: string;
  readonly document: CadDocument;
  readonly documentVersion: string;
  readonly inspection: CadSketchAreaRepairInspection;
  readonly interactionLocked: boolean;
  onReferencePick(command: CadFeatureReferencePickCommand): void;
  onReadyChange(ready: boolean): void;
  onFinish(repairs: CadSketchAreaRepairs, signal: AbortSignal): CadEditCompletion;
  onCancel(): void;
}

/** Explicit replacements remain a disposable final-choice form, never a second part history. */
export function CadSketchAreaRepairPanel({ formId, document, documentVersion, inspection, interactionLocked, onReferencePick, onReadyChange, onFinish, onCancel }: CadSketchAreaRepairPanelProps) {
  const submission = useCadEditSubmission(), [owner] = useState(() => crypto.randomUUID());
  const [choices, setChoices] = useState<Readonly<Record<string, readonly CadSketchCellReference[]>>>({});
  const [picker, setPicker] = useState<CadFeatureRegionPickCommand | null>(null), [error, setError] = useState<string | null>(null);
  const pickToken = useRef<symbol | null>(null);
  const focus = useRef<HTMLElement | null>(null), callbacks = useRef({ onReferencePick, onReadyChange }); callbacks.current = { onReferencePick, onReadyChange };
  const placement = useMemo(() => {
    const sketch = document.features.find(feature => feature.id === inspection.sketchId);
    if (sketch?.kind !== 'sketch') throw new Error('The edited sketch is unavailable.');
    return resolveCadSketchPlacement(sketch, document.parameters, prepareCadDatumFrames(document.features, document.parameters));
  }, [document, inspection.sketchId]);
  const ready = inspection.consumers.every(({ feature }) => choices[feature.id]?.length) && !picker && !submission.applying && !interactionLocked;
  useLayoutEffect(() => { onReadyChange(ready); }, [ready, onReadyChange]);
  useLayoutEffect(() => { onReferencePick(picker ?? { kind: 'clear', owner }); }, [picker, owner, onReferencePick]);
  useLayoutEffect(() => {
    if (!picker && focus.current) { focus.current.focus(); focus.current = null; }
  }, [picker]);
  useLayoutEffect(() => () => { pickToken.current = null; callbacks.current.onReferencePick({ kind: 'clear', owner }); callbacks.current.onReadyChange(false); }, [owner]);
  const begin = (featureId: string) => {
    if (interactionLocked || submission.applying || pickToken.current) return;
    const token = Symbol('consumer-area-pick'); pickToken.current = token;
    const previous = choices[featureId] ?? [];
    focus.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    const end = (restore: boolean) => {
      if (pickToken.current !== token) return;
      if (restore) setChoices(current => ({ ...current, [featureId]: previous }));
      pickToken.current = null; setPicker(null);
    };
    setError(null);
    const command: CadFeatureRegionPickCommand = { kind: 'pick-regions', owner, expectedVersion: documentVersion, label: 'Replacement areas',
      sketchId: inspection.sketchId, cells: inspection.cells, placement, selection: previous,
      onSelect(selection) {
        if (pickToken.current !== token) return;
        try {
          if (selection.length) inspection.cells.resolve(selection);
          setChoices(current => ({ ...current, [featureId]: selection }));
          setPicker(current => current ? { ...current, selection } : null);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Choose current closed areas.'); }
      }, onFinish: () => end(false), onCancel: () => end(true) };
    setPicker(command);
  };
  return <form id={formId} className="cad-property-form" aria-label="Update dependent sketch areas" aria-busy={submission.applying || undefined}
    onKeyDown={event => { if (picker && event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); picker.onCancel(); } }}
    onSubmit={event => {
      event.preventDefault(); if (!ready) return; setError(null);
      const repairs = { localVersion: inspection.localVersion, selections: inspection.consumers.map(({ feature }) => ({ featureId: feature.id, selection: choices[feature.id] })) };
      submission.submit(signal => onFinish(repairs, signal), () => undefined, cause => setError(cause instanceof Error ? cause.message : 'Unable to finish this sketch.'));
    }}>
    <div className="cad-property-title">Update areas <CadContextHelp label="Dependent sketch areas">The boundary changed. Choose the new closed areas for each dependent feature. Finish accepts the sketch and these explicit choices as one part edit. Back to sketch keeps your geometry editable.</CadContextHelp></div>
    <fieldset className="cad-feature-fields" disabled={interactionLocked || submission.applying || Boolean(picker)}>
      <ul className="cad-consumer-area-list">{inspection.consumers.map(({ feature, issue }) => <li key={feature.id}>
        <span>{feature.name}<CadContextHelp label={`${feature.name} areas`}>{issue}</CadContextHelp></span>
        <Button type="button" className="cad-area-choice" aria-label={`Choose areas for ${feature.name}`} disabled={!inspection.cells.cells.length} onClick={() => begin(feature.id)}>
          <SelectIcon size={13} /><span>{choices[feature.id]?.length ? `${choices[feature.id].length} ${choices[feature.id].length === 1 ? 'area' : 'areas'}` : 'Choose areas'}</span>
        </Button>
      </li>)}</ul>
    </fieldset>
    {!inspection.cells.cells.length && <p className="cad-error" role="alert">Close a material boundary before choosing replacement areas.</p>}
    {error && <p className="cad-error" role="alert">{error}</p>}
    <div className="cad-form-actions"><Button type="button" disabled={submission.applying} onClick={onCancel}><CloseIcon size={13} /> Back to sketch</Button></div>
  </form>;
}
