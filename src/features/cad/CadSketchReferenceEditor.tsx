import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { Button } from '@/components/ui/button';
import { CloseIcon, ConfirmIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { cadSketchReferenceSources } from '@/domain/cad/cadSketchExternalReferences';
import { CadContextHelp } from './CadContextHelp';
import type { CadSketchGraphControls } from './CadSketchGraphLayer';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';

export type CadSketchReferenceInteraction = {
  readonly kind: 'source';
  readonly source: CadSketchFeature | null;
  readonly eligibleSketchIds: readonly string[];
  readonly pick: CadSketchGraphControls['geometryPick'];
  chooseSource(sketchId: string): void;
} | { readonly kind: 'preview' };

interface Props {
  document: CadDocument;
  documentVersion: string;
  sketch: CadSketchFeature;
  interactionLocked: boolean;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument(document: CadDocument | null): void;
  onPendingChange(pending: boolean): void;
  onInteractionChange(interaction: CadSketchReferenceInteraction | null): void;
  onCancel(): void;
  onAccepted(entityId: string): void;
}

/** Borrows the existing tree/canvas picker while the actual target sketch stays pinned. */
export function CadSketchReferenceEditor(props: Props) {
  const [owner] = useState(() => ({ document: props.document, version: props.documentVersion, sketch: props.sketch,
    idPrefix: `use_${crypto.randomUUID().replaceAll('-', '')}` }));
  const [sourceId, setSourceId] = useState<string | null>(null), [entityId, setEntityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submission = useCadEditSubmission(), ended = useRef(false), submitted = useRef<CadDocument | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const choice = useRef({ sourceId, entityId }); choice.current = { sourceId, entityId };
  const sourceCurrent = props.document === owner.document && props.documentVersion === owner.version;
  const ownPublication = submission.applying && submitted.current !== null && Value.Equal(props.document, submitted.current);
  const cancel = () => { if (!ended.current) { ended.current = true; submission.cancel(); callbacks.current.onCancel(); } };
  const sources = useMemo(() => cadSketchReferenceSources(owner.document, owner.sketch.id), [owner]);
  const source = sources.find(sketch => sketch.id === sourceId) ?? null;
  const eligibleEntityIds = useMemo(() => source?.graph?.entities.filter(entity => entity.kind === 'line' || entity.kind === 'circle').map(entity => entity.id) ?? [], [source]);
  const current = () => !ended.current && !callbacks.current.interactionLocked && !submission.applying
    && callbacks.current.document === owner.document && callbacks.current.documentVersion === owner.version;
  useLayoutEffect(() => { if (props.interactionLocked || !sourceCurrent && !ownPublication) cancel(); }, [props.interactionLocked, sourceCurrent, ownPublication]);
  useLayoutEffect(() => { callbacks.current.onPendingChange(true); return () => {
    callbacks.current.onInteractionChange(null); callbacks.current.onPendingChange(false); callbacks.current.onPreviewDocument(null);
  }; }, []);
  const interaction = useMemo<CadSketchReferenceInteraction | null>(() => !sourceCurrent || props.interactionLocked || submission.applying ? null
    : entityId !== null ? { kind: 'preview' } : {
      kind: 'source', source, eligibleSketchIds: sources.map(sketch => sketch.id),
      chooseSource: id => { if (current() && choice.current.entityId === null && sources.some(sketch => sketch.id === id)) { setSourceId(id); setError(null); } },
      pick: source ? { eligibleEntityIds, eligiblePointIds: [], label: 'Use as reference', onCancel: cancel,
        onPick: selection => { if (selection.kind !== 'entity') return; const id = selection.id; if (current() && choice.current.entityId === null && choice.current.sourceId === source.id && eligibleEntityIds.includes(id)) { setEntityId(id); setError(null); } } } : undefined
    }, [sourceCurrent, props.interactionLocked, submission.applying, entityId, source, sources, eligibleEntityIds]);
  useLayoutEffect(() => { props.onInteractionChange(interaction); }, [interaction, props.onInteractionChange]);
  const edits = useMemo<readonly CadEdit[] | null>(() => !source || !entityId ? null : [{ kind: 'use-sketch-entity', sketchId: owner.sketch.id,
    sourceSketchId: source.id, sourceEntityId: entityId, idPrefix: owner.idPrefix }], [source, entityId, owner]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, sourceCurrent && !props.interactionLocked && !submission.applying);
  useLayoutEffect(() => { props.onPreviewDocument(prepared.kind === 'ready' ? prepared.document : submission.applying ? submitted.current : null); }, [prepared, submission.applying, props.onPreviewDocument]);
  const issue = error ?? (prepared.kind === 'error' ? prepared.message : null);
  return <form className="cad-property-form cad-sketch-profile-panel" aria-label="Use reference" aria-busy={submission.applying || undefined}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); cancel(); } }}
    onSubmit={event => {
      event.preventDefault();
      if (!current() || !edits || prepared.kind !== 'ready') return;
      submitted.current = prepared.document;
      submission.submit(signal => props.onEditMany(edits, signal), () => {
        if (ended.current) return;
        ended.current = true; callbacks.current.onAccepted(`${owner.idPrefix}_e0`);
      }, cause => { submitted.current = null; setError(cause instanceof Error ? cause.message : 'The reference could not be added.'); });
    }}>
    <div className="cad-sketch-profile-heading"><strong>Use reference</strong><CadContextHelp label="Use reference">Linked construction geometry follows its preceding source. Choose a sketch in the tree, then a line or circle in the canvas. Projection uses the shared plane normal; this sketch keeps its own height. Detach explicitly before editing the reference itself.</CadContextHelp></div>
    {entityId === null ? <div className="min-w-0 truncate" role="status">{source ? `Choose a line or circle in ${source.name}` : 'Choose a source sketch in the tree'}</div>
      : <div className="cad-sketch-profile-actions"><span className="min-w-0 truncate">{source?.name}</span><Button type="button" disabled={props.interactionLocked || submission.applying}
        onClick={() => { props.onPreviewDocument(null); setEntityId(null); setSourceId(null); setError(null); }}>Change source</Button></div>}
    {prepared.kind === 'waiting' && <div role="status">Preparing preview…</div>}
    {issue && <p className="cad-error" role="alert">{issue}</p>}
    <div className="cad-form-actions"><Button type="button" onClick={cancel}><CloseIcon size={13} /> Cancel</Button>
      <Button variant="primary" type="submit" disabled={props.interactionLocked || submission.applying || !sourceCurrent || prepared.kind !== 'ready'}><ConfirmIcon size={13} /> Apply</Button></div>
  </form>;
}
