import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CadDocument, CadScalar, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { inspectCadScalarValue } from '@/domain/cad/cadScalarValueIntent';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import type { CadSketchOffsetSource } from '@/domain/cad/cadSketchOffset';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { ScalarField } from './CadFields';
import { cadPreviewMarks, useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { CadSketchCommandForm, useCadSketchCommandSession, type CadSketchCommandSessionProps } from './useCadSketchCommandSession';

/** A selected edge identifies its exact whole compiler cycle; points and multiple loops do not guess a source. */
export function cadSketchOffsetSource(sketch: CadSketchFeature, parameters: CadDocument['parameters'], selection: readonly CadSketchGraphSelection[], profileId: string | null): CadSketchOffsetSource | null {
  if (selection.length) {
    if (selection.some(item => item.kind !== 'entity') || !sketch.graph) return null;
    // One edge names its loop, and so do several edges of the same loop, as a finished Offset or Mirror leaves the whole copy selected.
    const ids = selection.map(item => item.id);
    const cycles = compileCadSketchGraph(sketch.graph, parameters).cycles.filter(cycle => !cycle.construction && ids.every(id => cycle.sourceRefs.some(ref => ref.entityId === id)));
    return cycles.length === 1 ? { kind: 'graph-cycle', sourceRefs: cycles[0].sourceRefs } : null;
  }
  const profile = sketch.profiles.find(profile => profile.id === profileId);
  return profile && !profile.construction && profile.geometry.kind !== 'plugin' ? { kind: 'profile', profileId: profile.id } : null;
}

interface Props extends CadSketchCommandSessionProps {
  sketch: CadSketchFeature;
  source: CadSketchOffsetSource;
  onPrepareEdits?: CadPrepareEdits;
  onAccepted(entityIds: readonly string[]): void;
}

/** One disposable scalar request, sharing the ordinary prepared edit and submission lifetimes. */
export function CadSketchOffsetEditor(props: Props) {
  const session = useCadSketchCommandSession(props, () => ({ sketch: props.sketch, source: props.source, idPrefix: `offset_${crypto.randomUUID().replaceAll('-', '')}` }));
  const { owner, setError } = session;
  const [distance, setDistance] = useState<CadScalar>(1);
  const form = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => { form.current?.querySelector('input')?.select(); }, []);
  const quantity = useMemo(() => { try { return evaluateCadScalar(distance, owner.document.parameters); } catch { return null; } }, [distance, owner]);
  const edits = useMemo<readonly CadEdit[] | null>(() => quantity === 0 ? null : [{ kind: 'offset-sketch-loop', sketchId: owner.sketch.id,
    source: owner.source, distance, idPrefix: owner.idPrefix }], [owner, distance, quantity]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, session.previewEnabled);
  useLayoutEffect(() => { props.onPreviewDocument(prepared.kind === 'ready' ? prepared.document : null, cadPreviewMarks(prepared)); }, [prepared, props.onPreviewDocument]);
  const flip = (inside: boolean) => {
    if (quantity !== null && quantity !== 0 && (quantity < 0) !== inside) {
      setDistance(inspectCadScalarValue(distance, owner.document.parameters).kind === 'literal' ? -quantity : `-(${distance})`);
      setError(null);
    }
  };
  return <CadSketchCommandForm label="Offset loop" formRef={form} session={session} canApply={Boolean(edits) && prepared.kind === 'ready'}
    issue={session.error ?? (prepared.kind === 'error' ? prepared.message : null)}
    help="Independent copy. No offset relation. Later changes to the source or distance parameter do not move the copy."
    onSubmit={() => {
      if (!edits || prepared.kind !== 'ready') return;
      const candidate = prepared.document.features.find(feature => feature.kind === 'sketch' && feature.id === owner.sketch.id);
      // The whole copied loop is selected, as Mirror selects its whole copy.
      const copied = candidate?.kind === 'sketch' ? candidate.graph?.entities.filter(entity => !owner.sketch.graph?.entities.some(original => original.id === entity.id)).map(entity => entity.id) : null;
      if (copied?.length) session.submit(edits, prepared.document, () => props.onAccepted(copied), 'The offset could not be applied.');
    }}>
    <fieldset className="cad-editor-fieldset" disabled={props.interactionLocked || session.applying}>
      <ScalarField label="Offset distance" value={distance} parameters={owner.document.parameters} onChange={value => { setDistance(value); setError(null); }} />
      <div className="cad-sketch-profile-actions" role="group" aria-label="Offset side">
        <Button type="button" aria-pressed={quantity !== null && quantity < 0} onClick={() => flip(true)}>Inside</Button>
        <Button type="button" aria-pressed={quantity !== null && quantity > 0} onClick={() => flip(false)}>Outside</Button>
      </div>
    </fieldset>
  </CadSketchCommandForm>;
}
