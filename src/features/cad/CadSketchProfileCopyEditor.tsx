import { useLayoutEffect, useMemo } from 'react';
import type { CadDocument } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadSketchProfileCopyRequest } from '@/domain/cad/cadSketchProfileCopy';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { CadSketchCommandForm, useCadSketchCommandSession, type CadSketchCommandSessionProps } from './useCadSketchCommandSession';

interface Props extends CadSketchCommandSessionProps {
  request: CadSketchProfileCopyRequest;
  onPrepareEdits?: CadPrepareEdits;
  onAccepted(document: CadDocument): void;
}

/** The source profile is chosen by its existing context menu; this owner only previews the new sketch. */
export function CadSketchProfileCopyEditor(props: Props) {
  const session = useCadSketchCommandSession(props, () => ({ request: props.request }));
  const { owner } = session;
  const edits = useMemo<readonly CadEdit[]>(() => [{ kind: 'copy-sketch-profile', ...owner.request }], [owner]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, session.previewEnabled);
  useLayoutEffect(() => { props.onPreviewDocument(prepared.kind === 'ready' ? prepared.document : session.applying ? session.submittedDocument : null); }, [prepared, session.applying, props.onPreviewDocument]);
  return <CadSketchCommandForm label="Copy outline" session={session} canApply={prepared.kind === 'ready'}
    issue={session.error ?? (prepared.kind === 'error' ? prepared.message : null)}
    help="Creates one independent numeric outline in a new editable sketch. Source dimensions, plugin inputs and nested holes stay on the original. The existing plane is shared; the offset is copied at its current value. A shared datum still moves both sketches."
    status={prepared.kind === 'waiting' && <div role="status">Preparing preview…</div>}
    onSubmit={() => {
      if (prepared.kind !== 'ready') return;
      const candidate = prepared.document;
      session.submit(edits, candidate, () => props.onAccepted(candidate), 'The outline could not be copied.');
    }}>
    <span>{owner.request.name}</span>
  </CadSketchCommandForm>;
}
