import { useLayoutEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadSketchGraphControls } from './CadSketchGraphLayer';
import { cadPreviewMarks, useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { CadSketchCommandForm, useCadSketchCommandSession, type CadSketchCommandSessionProps } from './useCadSketchCommandSession';

export type CadSketchMirrorInteraction = { readonly kind: 'choose-line'; readonly pick: NonNullable<CadSketchGraphControls['geometryPick']> }
  | { readonly kind: 'preview'; readonly axisLineId: string };

interface Props extends CadSketchCommandSessionProps {
  sketch: CadSketchFeature;
  entityIds: readonly string[];
  onPrepareEdits?: CadPrepareEdits;
  onInteractionChange(interaction: CadSketchMirrorInteraction | null): void;
  onAccepted(entityIds: readonly string[]): void;
}

/** The source set stays frozen while the canvas lends this owner a line-only picker. */
export function CadSketchMirrorEditor(props: Props) {
  const session = useCadSketchCommandSession(props, () => ({ sketch: props.sketch, entityIds: props.entityIds,
    idPrefix: `mirror_${crypto.randomUUID().replaceAll('-', '')}` }), latest => latest.onInteractionChange(null));
  const { owner, setError, cancel } = session;
  const [axis, setAxis] = useState<string | null>(null);
  const eligibleEntityIds = useMemo(() => owner.sketch.graph?.entities.filter(entity => entity.kind === 'line' && !owner.entityIds.includes(entity.id)).map(entity => entity.id) ?? [], [owner]);
  const pick = useMemo<CadSketchGraphControls['geometryPick']>(() => axis !== null || !session.previewEnabled ? undefined : ({
    eligibleEntityIds, eligiblePointIds: [], label: 'Use as mirror line', onCancel: cancel,
    onPick: selection => {
      if (selection.kind !== 'entity' || !eligibleEntityIds.includes(selection.id)) return;
      if (session.closed()) return;
      setAxis(selection.id); setError(null);
    }
  }), [axis, session.previewEnabled, eligibleEntityIds, owner]);
  const interaction = useMemo<CadSketchMirrorInteraction | null>(() => pick ? { kind: 'choose-line', pick }
    : axis === null ? null : { kind: 'preview', axisLineId: axis }, [pick, axis]);
  useLayoutEffect(() => { props.onInteractionChange(interaction); }, [interaction, props.onInteractionChange]);
  const edits = useMemo<readonly CadEdit[] | null>(() => axis === null ? null : [{ kind: 'mirror-sketch-geometry', sketchId: owner.sketch.id,
    entityIds: owner.entityIds, axisLineId: axis, idPrefix: owner.idPrefix }], [axis, owner]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, session.previewEnabled);
  useLayoutEffect(() => { props.onPreviewDocument(axis !== null && prepared.kind === 'ready' ? prepared.document : null, axis !== null ? cadPreviewMarks(prepared) : null); }, [axis, prepared, props.onPreviewDocument]);
  return <CadSketchCommandForm label="Mirror copy" session={session} canApply={Boolean(edits) && prepared.kind === 'ready'}
    issue={session.error ?? (prepared.kind === 'error' ? prepared.message : null)}
    help="Independent geometry. Original dimensions and formulas stay on the source. Shared points and declared Coincident joints remain connected inside the copy."
    status={prepared.kind === 'waiting' && <div role="status">Preparing preview…</div>}
    onSubmit={() => {
      if (!edits || prepared.kind !== 'ready') return;
      const result = prepared.document.features.find(feature => feature.id === owner.sketch.id);
      const copied = result?.kind === 'sketch' ? result.graph?.entities.filter(entity => !owner.sketch.graph?.entities.some(source => source.id === entity.id)).map(entity => entity.id) : null;
      if (copied?.length) session.submit(edits, prepared.document, () => props.onAccepted(copied), 'The mirror copy could not be applied.');
    }}>
    {axis === null ? <div role="status">Choose a mirror line in the sketch</div> : <div className="cad-sketch-profile-actions">
      <span>Mirror line selected</span>
      <Button type="button" disabled={props.interactionLocked || session.applying} onClick={() => {
        props.onPreviewDocument(null); setAxis(null); setError(null);
      }}>Change line</Button>
    </div>}
  </CadSketchCommandForm>;
}
