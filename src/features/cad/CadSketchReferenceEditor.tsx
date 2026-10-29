import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { cadSketchReferenceSources } from '@/domain/cad/cadSketchExternalReferences';
import type { CadSketchGraphControls } from './CadSketchGraphLayer';
import { cadPreviewMarks, useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { CadSketchCommandForm, useCadSketchCommandSession, type CadSketchCommandSessionProps } from './useCadSketchCommandSession';

export type CadSketchReferenceInteraction = {
  readonly kind: 'source';
  readonly source: CadSketchFeature | null;
  readonly eligibleSketchIds: readonly string[];
  readonly pick: CadSketchGraphControls['geometryPick'];
  chooseSource(sketchId: string): void;
} | { readonly kind: 'preview' };

interface Props extends CadSketchCommandSessionProps {
  sketch: CadSketchFeature;
  onPrepareEdits?: CadPrepareEdits;
  onInteractionChange(interaction: CadSketchReferenceInteraction | null): void;
  onAccepted(entityId: string): void;
}

/** Borrows the existing tree/canvas picker while the actual target sketch stays pinned. */
export function CadSketchReferenceEditor(props: Props) {
  const session = useCadSketchCommandSession(props, () => ({ sketch: props.sketch, idPrefix: `use_${crypto.randomUUID().replaceAll('-', '')}` }),
    latest => latest.onInteractionChange(null));
  const { owner, setError, cancel } = session;
  const [sourceId, setSourceId] = useState<string | null>(null), [entityId, setEntityId] = useState<string | null>(null);
  const choice = useRef({ sourceId, entityId }); choice.current = { sourceId, entityId };
  const sources = useMemo(() => cadSketchReferenceSources(owner.document, owner.sketch.id), [owner]);
  const source = sources.find(sketch => sketch.id === sourceId) ?? null;
  const eligibleEntityIds = useMemo(() => source?.graph?.entities.filter(entity => entity.kind === 'line' || entity.kind === 'circle').map(entity => entity.id) ?? [], [source]);
  const interaction = useMemo<CadSketchReferenceInteraction | null>(() => !session.previewEnabled ? null
    : entityId !== null ? { kind: 'preview' } : {
      kind: 'source', source, eligibleSketchIds: sources.map(sketch => sketch.id),
      chooseSource: id => { if (!session.closed() && choice.current.entityId === null && sources.some(sketch => sketch.id === id)) { setSourceId(id); setError(null); } },
      pick: source ? { eligibleEntityIds, eligiblePointIds: [], label: 'Use as reference', onCancel: cancel,
        onPick: selection => {
          if (selection.kind !== 'entity' || session.closed() || choice.current.entityId !== null || choice.current.sourceId !== source.id || !eligibleEntityIds.includes(selection.id)) return;
          setEntityId(selection.id); setError(null);
        } } : undefined
    }, [session.previewEnabled, entityId, source, sources, eligibleEntityIds]);
  useLayoutEffect(() => { props.onInteractionChange(interaction); }, [interaction, props.onInteractionChange]);
  const edits = useMemo<readonly CadEdit[] | null>(() => !source || !entityId ? null : [{ kind: 'use-sketch-entity', sketchId: owner.sketch.id,
    sourceSketchId: source.id, sourceEntityId: entityId, idPrefix: owner.idPrefix }], [source, entityId, owner]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, session.previewEnabled);
  useLayoutEffect(() => { props.onPreviewDocument(prepared.kind === 'ready' ? prepared.document : session.applying ? session.submittedDocument : null, cadPreviewMarks(prepared)); }, [prepared, session.applying, props.onPreviewDocument]);
  return <CadSketchCommandForm label="Use reference" session={session} canApply={Boolean(edits) && prepared.kind === 'ready'}
    issue={session.error ?? (prepared.kind === 'error' ? prepared.message : null)}
    help="Linked construction geometry follows its preceding source. Choose a sketch in the tree, then a line or circle in the canvas. Projection uses the shared plane normal; this sketch keeps its own height. Detach explicitly before editing the reference itself."
    status={prepared.kind === 'waiting' && <div role="status">Preparing preview…</div>}
    onSubmit={() => { if (edits && prepared.kind === 'ready') session.submit(edits, prepared.document, () => props.onAccepted(`${owner.idPrefix}_e0`), 'The reference could not be added.'); }}>
    {entityId === null ? <div className="min-w-0 truncate" role="status">{source ? `Choose a line or circle in ${source.name}` : 'Choose a source sketch in the tree'}</div>
      : <div className="cad-sketch-profile-actions"><span className="min-w-0 truncate">{source?.name}</span><Button type="button" disabled={props.interactionLocked || session.applying}
        onClick={() => { props.onPreviewDocument(null); setEntityId(null); setSourceId(null); setError(null); }}>Change source</Button></div>}
  </CadSketchCommandForm>;
}
