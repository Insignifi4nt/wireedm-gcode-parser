import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { Button } from '@/components/ui/button';
import { CloseIcon, ConfirmIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadScalar, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { inspectCadScalarValue } from '@/domain/cad/cadScalarValueIntent';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import type { CadSketchOffsetSource } from '@/domain/cad/cadSketchOffset';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { ScalarField } from './CadFields';
import { CadContextHelp } from './CadContextHelp';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';

/** A selected edge identifies its exact whole compiler cycle; points and multiple loops do not guess a source. */
export function cadSketchOffsetSource(sketch: CadSketchFeature, parameters: CadDocument['parameters'], selection: readonly CadSketchGraphSelection[], profileId: string | null): CadSketchOffsetSource | null {
  if (selection.length) {
    if (selection.length !== 1 || selection[0].kind !== 'entity' || !sketch.graph) return null;
    const id = selection[0].id;
    const cycles = compileCadSketchGraph(sketch.graph, parameters).cycles.filter(cycle => !cycle.construction && cycle.sourceRefs.some(ref => ref.entityId === id));
    return cycles.length === 1 ? { kind: 'graph-cycle', sourceRefs: cycles[0].sourceRefs } : null;
  }
  const profile = sketch.profiles.find(profile => profile.id === profileId);
  return profile && !profile.construction && profile.geometry.kind !== 'plugin' ? { kind: 'profile', profileId: profile.id } : null;
}

interface Props {
  document: CadDocument;
  documentVersion: string;
  sketch: CadSketchFeature;
  source: CadSketchOffsetSource;
  interactionLocked: boolean;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument(document: CadDocument | null): void;
  onPendingChange(pending: boolean): void;
  onCancel(): void;
  onAccepted(entityId: string): void;
}

/** One disposable scalar request, sharing the ordinary prepared edit and submission lifetimes. */
export function CadSketchOffsetEditor(props: Props) {
  const [owner] = useState(() => ({ document: props.document, version: props.documentVersion, sketch: props.sketch,
    source: props.source, idPrefix: `offset_${crypto.randomUUID().replaceAll('-', '')}` }));
  const [distance, setDistance] = useState<CadScalar>(1), [error, setError] = useState<string | null>(null);
  const submission = useCadEditSubmission(), ended = useRef(false), submitted = useRef<CadDocument | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const sourceCurrent = props.document === owner.document && props.documentVersion === owner.version;
  // A successful session publication may render before its promise's accepted callback.
  const ownPublication = submission.applying && submitted.current !== null && Value.Equal(props.document, submitted.current);
  const cancel = () => { if (!ended.current) { ended.current = true; submission.cancel(); callbacks.current.onCancel(); } };
  useLayoutEffect(() => { if (props.interactionLocked || !sourceCurrent && !ownPublication) cancel(); }, [props.interactionLocked, sourceCurrent, ownPublication]);
  useLayoutEffect(() => { callbacks.current.onPendingChange(true); form.current?.querySelector('input')?.select(); return () => {
    callbacks.current.onPendingChange(false); callbacks.current.onPreviewDocument(null);
  }; }, []);
  const quantity = useMemo(() => { try { return evaluateCadScalar(distance, owner.document.parameters); } catch { return null; } }, [distance, owner]);
  const edits = useMemo<readonly CadEdit[] | null>(() => quantity === 0 ? null : [{ kind: 'offset-sketch-loop', sketchId: owner.sketch.id,
    source: owner.source, distance, idPrefix: owner.idPrefix }], [owner, distance, quantity]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, sourceCurrent && !props.interactionLocked && !submission.applying);
  useLayoutEffect(() => { props.onPreviewDocument(prepared.kind === 'ready' ? prepared.document : null); }, [prepared, props.onPreviewDocument]);
  const issue = error ?? (prepared.kind === 'error' ? prepared.message : null);
  const flip = (inside: boolean) => {
    if (quantity !== null && quantity !== 0 && (quantity < 0) !== inside) {
      setDistance(inspectCadScalarValue(distance, owner.document.parameters).kind === 'literal' ? -quantity : `-(${distance})`);
      setError(null);
    }
  };
  return <form ref={form} className="cad-property-form cad-sketch-profile-panel" aria-label="Offset loop" aria-busy={submission.applying || undefined}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); cancel(); } }}
    onSubmit={event => {
      event.preventDefault();
      if (ended.current || !sourceCurrent || props.interactionLocked || submission.applying || !edits || prepared.kind !== 'ready') return;
      const candidate = prepared.document.features.find(feature => feature.kind === 'sketch' && feature.id === owner.sketch.id);
      const entity = candidate?.kind === 'sketch' ? candidate.graph?.entities.find(entity => !owner.sketch.graph?.entities.some(original => original.id === entity.id)) : null;
      if (!entity) return;
      submitted.current = prepared.document;
      submission.submit(signal => props.onEditMany(edits, signal), () => {
        if (ended.current) return;
        ended.current = true; callbacks.current.onAccepted(entity.id);
      }, cause => { submitted.current = null; setError(cause instanceof Error ? cause.message : 'The offset could not be applied.'); });
    }}>
    <div className="cad-sketch-profile-heading"><strong>Offset loop</strong><CadContextHelp label="Offset loop">Independent copy. No offset relation. Later changes to the source or distance parameter do not move the copy.</CadContextHelp></div>
    <fieldset className="cad-editor-fieldset" disabled={props.interactionLocked || submission.applying}>
      <ScalarField label="Offset distance" value={distance} parameters={owner.document.parameters} onChange={value => { setDistance(value); setError(null); }} />
      <div className="cad-sketch-profile-actions" role="group" aria-label="Offset side">
        <Button type="button" aria-pressed={quantity !== null && quantity < 0} onClick={() => flip(true)}>Inside</Button>
        <Button type="button" aria-pressed={quantity !== null && quantity > 0} onClick={() => flip(false)}>Outside</Button>
      </div>
    </fieldset>
    {issue && <p className="cad-error" role="alert">{issue}</p>}
    <div className="cad-form-actions"><Button type="button" onClick={cancel}><CloseIcon size={13} /> Cancel</Button>
      <Button variant="primary" type="submit" disabled={props.interactionLocked || submission.applying || !sourceCurrent || !edits || prepared.kind !== 'ready'}><ConfirmIcon size={13} /> Apply</Button></div>
  </form>;
}
