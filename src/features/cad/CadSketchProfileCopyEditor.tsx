import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { Button } from '@/components/ui/button';
import { CloseIcon, ConfirmIcon } from '@wire-edm/icons-react';
import type { CadDocument } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadSketchProfileCopyRequest } from '@/domain/cad/cadSketchProfileCopy';
import { CadContextHelp } from './CadContextHelp';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';

interface Props {
  document: CadDocument;
  documentVersion: string;
  request: CadSketchProfileCopyRequest;
  interactionLocked: boolean;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument(document: CadDocument | null): void;
  onPendingChange(pending: boolean): void;
  onCancel(): void;
  onAccepted(document: CadDocument): void;
}

/** The source profile is chosen by its existing context menu; this owner only previews the new sketch. */
export function CadSketchProfileCopyEditor(props: Props) {
  const [owner] = useState(() => ({ document: props.document, version: props.documentVersion, request: props.request }));
  const [error, setError] = useState<string | null>(null);
  const submission = useCadEditSubmission(), ended = useRef(false), submitted = useRef<CadDocument | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const sourceCurrent = props.document === owner.document && props.documentVersion === owner.version;
  const ownPublication = submission.applying && submitted.current !== null && Value.Equal(props.document, submitted.current);
  const cancel = () => { if (!ended.current) { ended.current = true; submission.cancel(); callbacks.current.onCancel(); } };
  useLayoutEffect(() => { if (props.interactionLocked || !sourceCurrent && !ownPublication) cancel(); }, [props.interactionLocked, sourceCurrent, ownPublication]);
  useLayoutEffect(() => { callbacks.current.onPendingChange(true); return () => {
    callbacks.current.onPendingChange(false); callbacks.current.onPreviewDocument(null);
  }; }, []);
  const edits = useMemo<readonly CadEdit[]>(() => [{ kind: 'copy-sketch-profile', ...owner.request }], [owner]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, sourceCurrent && !props.interactionLocked && !submission.applying);
  useLayoutEffect(() => { props.onPreviewDocument(prepared.kind === 'ready' ? prepared.document : submission.applying ? submitted.current : null); }, [prepared, submission.applying, props.onPreviewDocument]);
  const issue = error ?? (prepared.kind === 'error' ? prepared.message : null);
  return <form className="cad-property-form cad-sketch-profile-panel" aria-label="Copy outline" aria-busy={submission.applying || undefined}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); cancel(); } }}
    onSubmit={event => {
      event.preventDefault();
      if (ended.current || !sourceCurrent || props.interactionLocked || submission.applying || prepared.kind !== 'ready') return;
      const candidate = prepared.document; submitted.current = candidate;
      submission.submit(signal => props.onEditMany(edits, signal), () => {
        if (ended.current) return;
        ended.current = true; callbacks.current.onAccepted(candidate);
      }, cause => { submitted.current = null; setError(cause instanceof Error ? cause.message : 'The outline could not be copied.'); });
    }}>
    <div className="cad-sketch-profile-heading"><strong>Copy outline</strong><CadContextHelp label="Copy outline">Creates one independent numeric outline in a new editable sketch. Source dimensions, plugin inputs and nested holes stay on the original. The existing plane is shared; the offset is copied at its current value. A shared datum still moves both sketches.</CadContextHelp></div>
    <span>{owner.request.name}</span>
    {prepared.kind === 'waiting' && <div role="status">Preparing preview…</div>}
    {issue && <p className="cad-error" role="alert">{issue}</p>}
    <div className="cad-form-actions"><Button type="button" onClick={cancel}><CloseIcon size={13} /> Cancel</Button>
      <Button variant="primary" type="submit" disabled={props.interactionLocked || submission.applying || !sourceCurrent || prepared.kind !== 'ready'}><ConfirmIcon size={13} /> Apply</Button></div>
  </form>;
}
