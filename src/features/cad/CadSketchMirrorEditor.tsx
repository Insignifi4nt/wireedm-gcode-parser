import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { Button } from '@/components/ui/button';
import { CloseIcon, ConfirmIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadSketchGraphControls } from './CadSketchGraphLayer';
import { CadContextHelp } from './CadContextHelp';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';

export type CadSketchMirrorInteraction = { readonly kind: 'choose-line'; readonly pick: NonNullable<CadSketchGraphControls['geometryPick']> }
  | { readonly kind: 'preview'; readonly axisLineId: string };

interface Props {
  document: CadDocument;
  documentVersion: string;
  sketch: CadSketchFeature;
  entityIds: readonly string[];
  interactionLocked: boolean;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument(document: CadDocument | null): void;
  onPendingChange(pending: boolean): void;
  onInteractionChange(interaction: CadSketchMirrorInteraction | null): void;
  onCancel(): void;
  onAccepted(entityIds: readonly string[]): void;
}

/** The source set stays frozen while the canvas lends this owner a line-only picker. */
export function CadSketchMirrorEditor(props: Props) {
  const [owner] = useState(() => ({ document: props.document, version: props.documentVersion, sketch: props.sketch,
    entityIds: props.entityIds, idPrefix: `mirror_${crypto.randomUUID().replaceAll('-', '')}` }));
  const [axis, setAxis] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const submission = useCadEditSubmission(), ended = useRef(false), submitted = useRef<CadDocument | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const sourceCurrent = props.document === owner.document && props.documentVersion === owner.version;
  const ownPublication = submission.applying && submitted.current !== null && Value.Equal(props.document, submitted.current);
  const cancel = () => { if (!ended.current) { ended.current = true; submission.cancel(); callbacks.current.onCancel(); } };
  useLayoutEffect(() => { if (props.interactionLocked || !sourceCurrent && !ownPublication) cancel(); }, [props.interactionLocked, sourceCurrent, ownPublication]);
  useLayoutEffect(() => { callbacks.current.onPendingChange(true); return () => {
    callbacks.current.onInteractionChange(null); callbacks.current.onPendingChange(false); callbacks.current.onPreviewDocument(null);
  }; }, []);
  const eligibleEntityIds = useMemo(() => owner.sketch.graph?.entities.filter(entity => entity.kind === 'line' && !owner.entityIds.includes(entity.id)).map(entity => entity.id) ?? [], [owner]);
  const pick = useMemo<CadSketchGraphControls['geometryPick']>(() => axis !== null || !sourceCurrent || props.interactionLocked || submission.applying ? undefined : ({
    eligibleEntityIds, eligiblePointIds: [], label: 'Use as mirror line', onCancel: cancel,
    onPick: selection => {
      if (selection.kind !== 'entity') return;
      const id = selection.id, latest = callbacks.current;
      if (ended.current || latest.interactionLocked || latest.document !== owner.document || latest.documentVersion !== owner.version || !eligibleEntityIds.includes(id)) return;
      setAxis(id); setError(null);
    }
  }), [axis, sourceCurrent, props.interactionLocked, submission.applying, eligibleEntityIds, owner]);
  const interaction = useMemo<CadSketchMirrorInteraction | null>(() => pick ? { kind: 'choose-line', pick }
    : axis === null ? null : { kind: 'preview', axisLineId: axis }, [pick, axis]);
  useLayoutEffect(() => { props.onInteractionChange(interaction); }, [interaction, props.onInteractionChange]);
  const edits = useMemo<readonly CadEdit[] | null>(() => axis === null ? null : [{ kind: 'mirror-sketch-geometry', sketchId: owner.sketch.id,
    entityIds: owner.entityIds, axisLineId: axis, idPrefix: owner.idPrefix }], [axis, owner]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, sourceCurrent && !props.interactionLocked && !submission.applying);
  useLayoutEffect(() => { props.onPreviewDocument(axis !== null && prepared.kind === 'ready' ? prepared.document : null); }, [axis, prepared, props.onPreviewDocument]);
  const issue = error ?? (prepared.kind === 'error' ? prepared.message : null);
  return <form className="cad-property-form cad-sketch-profile-panel" aria-label="Mirror copy" aria-busy={submission.applying || undefined}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); cancel(); } }}
    onSubmit={event => {
      event.preventDefault();
      if (ended.current || !sourceCurrent || props.interactionLocked || submission.applying || !edits || prepared.kind !== 'ready') return;
      const result = prepared.document.features.find(feature => feature.id === owner.sketch.id);
      const copied = result?.kind === 'sketch' ? result.graph?.entities.filter(entity => !owner.sketch.graph?.entities.some(source => source.id === entity.id)).map(entity => entity.id) : null;
      if (!copied?.length) return;
      submitted.current = prepared.document;
      submission.submit(signal => props.onEditMany(edits, signal), () => {
        if (ended.current) return;
        ended.current = true; callbacks.current.onAccepted(copied);
      }, cause => { submitted.current = null; setError(cause instanceof Error ? cause.message : 'The mirror copy could not be applied.'); });
    }}>
    <div className="cad-sketch-profile-heading"><strong>Mirror copy</strong><CadContextHelp label="Mirror copy">Independent geometry. Original dimensions and formulas stay on the source. Shared points and declared Coincident joints remain connected inside the copy.</CadContextHelp></div>
    {axis === null ? <div role="status">Choose a mirror line in the sketch</div> : <div className="cad-sketch-profile-actions">
      <span>Mirror line selected</span>
      <Button type="button" disabled={props.interactionLocked || submission.applying} onClick={() => {
        props.onPreviewDocument(null); setAxis(null); setError(null);
      }}>Change line</Button>
    </div>}
    {prepared.kind === 'waiting' && <div role="status">Preparing preview…</div>}
    {issue && <p className="cad-error" role="alert">{issue}</p>}
    <div className="cad-form-actions"><Button type="button" onClick={cancel}><CloseIcon size={13} /> Cancel</Button>
      <Button variant="primary" type="submit" disabled={props.interactionLocked || submission.applying || !sourceCurrent || !edits || prepared.kind !== 'ready'}><ConfirmIcon size={13} /> Apply</Button></div>
  </form>;
}
