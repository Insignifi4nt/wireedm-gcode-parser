import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';
import type { CadSketchGraphControls } from './CadSketchGraphLayer';
import type { SketchPoint } from './cadSketchInteraction';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { CadSketchCommandForm, useCadSketchCommandSession, type CadSketchCommandSessionProps } from './useCadSketchCommandSession';

export interface CadSketchPlacementInteraction {
  readonly positionPick?: CadSketchGraphControls['positionPick'];
  readonly geometryPick?: CadSketchGraphControls['geometryPick'];
  readonly placement: NonNullable<CadSketchGraphControls['placement']>;
}

interface Props extends CadSketchCommandSessionProps {
  sketch: CadSketchFeature;
  selections: readonly CadSketchGraphSelection[];
  onPrepareEdits?: CadPrepareEdits;
  onInteractionChange(interaction: CadSketchPlacementInteraction | null): void;
  onAccepted(): void;
}

type Pair = readonly [string, string];
type Slot = 'anchor' | 'target';
const finite = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1e9;
const position = (values: Pair): SketchPoint | null =>
  values.every(value => value.trim() !== '' && finite(Number(value))) ? [Number(values[0]), Number(values[1])] : null;

/** A frozen selection, two borrowed positions, and one exact whole-detail preview. */
export function CadSketchPlacementEditor(props: Props) {
  const session = useCadSketchCommandSession(props, () => ({ sketch: props.sketch, selections: props.selections }),
    latest => latest.onInteractionChange(null));
  const { owner, setError, cancel } = session;
  const [anchorText, setAnchor] = useState<Pair>(['', '']), [targetText, setTarget] = useState<Pair>(['', '']);
  const [angleText, setAngle] = useState('0'), [picking, setPicking] = useState<Slot | null>('anchor');
  const pickOwner = useRef<object | null>(null);
  const anchor = useMemo(() => position(anchorText), [anchorText]), target = useMemo(() => position(targetText), [targetText]);
  const angle = Number(angleText), angleValid = angleText.trim() !== '' && finite(angle);
  /** Every user change invalidates the shown preview and error before the next prepared result. */
  const touch = () => { props.onPreviewDocument(null); setError(null); };

  const pick = useMemo(() => {
    if (!picking || !session.previewEnabled) return undefined;
    const token = {};
    return { token, label: picking === 'anchor' ? 'Choose the detail anchor' : 'Place the anchor', onCancel: cancel,
      onPick: (point: SketchPoint) => {
        if (pickOwner.current !== token || session.closed() || !point.every(finite)) return;
        touch();
        const text: Pair = [String(point[0]), String(point[1])];
        if (picking === 'anchor') { setAnchor(text); setPicking('target'); } else { setTarget(text); setPicking(null); }
      } };
  }, [picking, session.previewEnabled, owner, props.onPreviewDocument]);
  pickOwner.current = pick?.token ?? null;
  const geometryPick = useMemo(() => pick && {
    label: pick.label, eligibleEntityIds: [], eligiblePointIds: owner.sketch.graph?.points.map(point => point.id) ?? [], onCancel: cancel,
    onPick: (selection: CadSketchGraphSelection) => {
      const point = selection.kind === 'point' ? owner.sketch.graph?.points.find(candidate => candidate.id === selection.id) : undefined;
      if (point) pick.onPick([evaluateCadScalar(point.position[0], owner.document.parameters), evaluateCadScalar(point.position[1], owner.document.parameters)]);
    } }, [pick, owner]);
  const interaction = useMemo<CadSketchPlacementInteraction | null>(() => session.previewEnabled
    ? { positionPick: pick, geometryPick, placement: { anchor, target, angleDegrees: angleValid ? angle : 0 } } : null,
  [session.previewEnabled, pick, geometryPick, anchor, target, angleValid, angle]);
  useLayoutEffect(() => props.onInteractionChange(interaction), [interaction, props.onInteractionChange]);

  const edits = useMemo<readonly CadEdit[] | null>(() => picking || !anchor || !target || !angleValid ? null
    : [{ kind: 'place-sketch-geometry', sketchId: owner.sketch.id, selections: owner.selections, anchor, target, angleDegrees: angle }],
  [picking, anchor, target, angleValid, angle, owner]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, session.previewEnabled);
  const changed = prepared.kind === 'ready' && !Value.Equal(prepared.document, owner.document);
  useLayoutEffect(() => props.onPreviewDocument(prepared.kind === 'ready' ? prepared.document : null), [prepared, props.onPreviewDocument]);
  const repick = (slot: Slot) => { if (!session.closed()) { touch(); setPicking(slot); } };
  const disabled = props.interactionLocked || session.applying;

  return <CadSketchCommandForm label="Place and rotate" session={session} canApply={Boolean(edits) && changed}
    issue={session.error ?? (prepared.kind === 'error' ? prepared.message : null)}
    help="Choose a point on the detail, then where it should go. Rotation is counterclockwise in the sketch plane. Positions are used once; no joint or constraint is added. Existing formulas and constraints stay in force."
    status={<>{picking && <div role="status">{pick?.label}</div>}{prepared.kind === 'waiting' && <div role="status">Preparing preview…</div>}</>}
    onSubmit={() => { if (edits && prepared.kind === 'ready' && changed) session.submit(edits, prepared.document, props.onAccepted, 'The detail could not be placed.'); }}>
    {(['anchor', 'target'] as const).map(slot => {
      const values = slot === 'anchor' ? anchorText : targetText, set = slot === 'anchor' ? setAnchor : setTarget, label = slot === 'anchor' ? 'Anchor' : 'Target';
      return <div key={slot}>
        <div className="cad-sketch-profile-actions"><span>{label}</span>
          <Button type="button" aria-label={`Choose ${slot}`} aria-pressed={picking === slot} disabled={disabled} onClick={() => repick(slot)}>Pick in sketch</Button></div>
        <div className="cad-placement-row">{([0, 1] as const).map(axis => <label key={axis}><span>{axis ? 'Y' : 'X'}</span>
          <Input aria-label={`${label} ${axis ? 'Y' : 'X'}`} inputMode="decimal" value={values[axis]} disabled={disabled} onChange={event => {
            if (session.closed()) return;
            touch(); setPicking(null);
            set(current => axis ? [current[0], event.target.value] : [event.target.value, current[1]]);
          }} /></label>)}<small>mm</small></div>
      </div>;
    })}
    <label className="cad-field"><span>Rotation</span><span>°</span>
      <Input aria-label="Rotation" inputMode="decimal" value={angleText} disabled={disabled} onChange={event => { setError(null); setAngle(event.target.value); }} /></label>
    <Button type="button" disabled={!anchor || disabled} onClick={() => {
      if (session.closed() || !anchor) return;
      touch(); setTarget(anchorText); setPicking(null);
    }}>Rotate at anchor</Button>
  </CadSketchCommandForm>;
}
