import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CloseIcon, ConfirmIcon, FlipHorizontalIcon, LinearPatternIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadSketchLinearPattern } from '@/domain/cad/cadSketchGraph';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { CadScalarEditContext, ScalarField, type CadScalarValueDraft, type CadScalarEditContextValue } from './CadFields';
import { CadContextHelp } from './CadContextHelp';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';

export type CadSketchLinearPatternRequest = { readonly kind: 'create'; readonly seedEntityId: string } | { readonly kind: 'edit'; readonly relationId: string; readonly detach?: true };
export interface CadSketchLinearPatternInteraction {
  readonly relation: CadSketchLinearPattern;
  readonly detaching: boolean;
  onToggleInstance(index: number): void;
}
interface Props {
  document: CadDocument; documentVersion: string; sketch: CadSketchFeature; request: CadSketchLinearPatternRequest;
  interactionLocked: boolean;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument(document: CadDocument | null): void;
  onPendingChange(pending: boolean): void;
  onInteractionChange(interaction: CadSketchLinearPatternInteraction | null): void;
  onCancel(): void;
  onAccepted(result: { seedEntityId: string; relationId: string | null }): void;
}
function initialRelation(props: Props): CadSketchLinearPattern {
  if (props.request.kind === 'edit') {
    const id = props.request.relationId, relation = props.sketch.graph?.relations.find(r => r.id === id);
    if (relation?.kind !== 'linear-pattern') throw new Error('The selected sketch pattern is unavailable.');
    return relation;
  }
  const id = props.request.seedEntityId, seed = props.sketch.graph?.entities.find(e => e.id === id);
  if (seed?.kind !== 'circle') throw new Error('Choose a circle to repeat.');
  const prefix = 'pattern_' + crypto.randomUUID().replaceAll('-', '');
  return { id: prefix + '_owner', kind: 'linear-pattern', seed: { kind: 'circle', entityId: seed.id, centerPointId: seed.centerPointId },
    idPrefix: prefix, direction: '+x', count: 4, spacing: 3 * evaluateCadScalar(seed.radius, props.document.parameters), omittedInstances: [] };
}
/** A disposable owner edit; generated circles are ordinary graph geometry supplied by shared preparation. */
export function CadSketchLinearPatternEditor(props: Props) {
  const [owner] = useState(() => ({ document: props.document, version: props.documentVersion, sketch: props.sketch, relation: initialRelation(props), existing: props.request.kind === 'edit' }));
  const [draft, setDraft] = useState(owner.relation), [countText, setCountText] = useState(String(owner.relation.count));
  const [detaching, setDetaching] = useState(props.request.kind === 'edit' && props.request.detach === true), [error, setError] = useState<string | null>(null);
  const [parameterEdits, setParameterEdits] = useState<Readonly<Record<string, number>>>({});
  const [valueDraft, storeValueDraft] = useState<CadScalarValueDraft | null>(null), [scalarIssue, storeIssue] = useState<string | null>(null);
  const [bindingPending, storeBindingPending] = useState(false), [relationEdited, storeRelationEdited] = useState(false);
  const submission = useCadEditSubmission(), ended = useRef(false), submitted = useRef<CadDocument | null>(null);
  const callbacks = useRef({ ...props, applying: submission.applying }); callbacks.current = { ...props, applying: submission.applying };
  const sourceCurrent = props.document === owner.document && props.documentVersion === owner.version;
  const ownPublication = submission.applying && submitted.current !== null && Value.Equal(props.document, submitted.current);
  const cancel = useCallback(() => { if (!ended.current) { ended.current = true; submission.cancel(); callbacks.current.onCancel(); } }, [submission.cancel]);
  const current = () => !ended.current && !callbacks.current.applying && !callbacks.current.interactionLocked
    && callbacks.current.document === owner.document && callbacks.current.documentVersion === owner.version;
  useLayoutEffect(() => { if (props.interactionLocked || !sourceCurrent && !ownPublication) cancel(); }, [props.interactionLocked, sourceCurrent, ownPublication, cancel]);
  useLayoutEffect(() => { callbacks.current.onPendingChange(true); return () => {
    callbacks.current.onInteractionChange(null); callbacks.current.onPendingChange(false); callbacks.current.onPreviewDocument(null);
  }; }, []);
  const count = Number(countText), countInvalid = !countText.trim() || !Number.isInteger(count) || count < 1 || count > 32;
  const scalarPending = countInvalid || Boolean(scalarIssue) || bindingPending;
  const parameters = useMemo(() => ({ ...owner.document.parameters, ...parameterEdits }), [owner, parameterEdits]);
  const setValueDraft = useCallback((_key: string, value: CadScalarValueDraft | null) => { storeValueDraft(value); setError(null); }, []);
  const setIssue = useCallback((_key: string, issue: string | null) => storeIssue(issue), []);
  const setRelationPending = useCallback((_key: string, pending: boolean) => storeBindingPending(pending), []);
  const markRelationEdited = useCallback(() => storeRelationEdited(true), []);
  const changeParameter = useCallback((name: string, value: number) => {
    setError(null); setParameterEdits(previous => { const next = { ...previous }; if (value === owner.document.parameters[name]) delete next[name]; else next[name] = value; return next; });
  }, [owner]);
  const scalarContext: CadScalarEditContextValue = { parameters, acceptedScalars: { spacing: owner.relation.spacing }, relationEdits: relationEdited ? { spacing: true } : {},
    valueDrafts: valueDraft ? { spacing: valueDraft } : {}, setValueDraft, setIssue, setRelationPending, markRelationEdited, changeParameter };
  const local = useRef({ scalarPending, detaching }); local.current = { scalarPending, detaching };
  const onToggleInstance = useCallback((index: number) => {
    if (!current() || local.current.scalarPending || local.current.detaching || !Number.isInteger(index)) return;
    setError(null); setDraft(relation => index > 0 && index < relation.count ? { ...relation,
      omittedInstances: relation.omittedInstances.includes(index) ? relation.omittedInstances.filter(i => i !== index) : [...relation.omittedInstances, index].sort((a, b) => a - b) } : relation);
  }, [owner]);
  const interaction = useMemo<CadSketchLinearPatternInteraction | null>(() => sourceCurrent && !props.interactionLocked && !submission.applying && !scalarPending
    ? { relation: draft, detaching, onToggleInstance } : null, [sourceCurrent, props.interactionLocked, submission.applying, scalarPending, draft, detaching, onToggleInstance]);
  useLayoutEffect(() => { props.onInteractionChange(interaction); }, [interaction, props.onInteractionChange]);
  const edits = useMemo<readonly CadEdit[] | null>(() => scalarPending ? null : [
    ...Object.entries(parameterEdits).map(([name, value]): CadEdit => ({ kind: 'set-parameter', name, value })),
    ...(!owner.existing || !Value.Equal(draft, owner.relation) ? [{ kind: 'set-sketch-relation' as const, sketchId: owner.sketch.id, relation: draft }] : []),
    ...(detaching ? [{ kind: 'remove-sketch-relation' as const, sketchId: owner.sketch.id, relationId: draft.id }] : [])
  ], [scalarPending, parameterEdits, owner, draft, detaching]);
  const prepared = useCadPreparedPreview(owner.document, edits, props.onPrepareEdits, sourceCurrent && !props.interactionLocked && !submission.applying);
  useLayoutEffect(() => { props.onPreviewDocument(prepared.kind === 'ready' ? prepared.document : null); }, [prepared, props.onPreviewDocument]);
  const issue = countInvalid ? 'Count must be a whole number from 1 to 32, including the seed.' : error ?? (prepared.kind === 'error' ? prepared.message : null);
  return <form className="cad-property-form cad-sketch-profile-panel" aria-label="Sketch linear pattern" aria-busy={submission.applying || undefined}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); cancel(); } }}
    onSubmit={event => {
      event.preventDefault(); if (!current() || !edits || edits.length > 0 && prepared.kind !== 'ready') return;
      const result = { seedEntityId: draft.seed.entityId, relationId: detaching ? null : draft.id };
      if (!edits.length) { ended.current = true; callbacks.current.onAccepted(result); return; }
      if (prepared.kind !== 'ready') return;
      submitted.current = prepared.document;
      submission.submit(signal => props.onEditMany(edits, signal), () => { if (!ended.current) { ended.current = true; callbacks.current.onAccepted(result); } },
        cause => { submitted.current = null; setError(cause instanceof Error ? cause.message : 'The pattern could not be applied.'); });
    }}>
    <div className="cad-sketch-profile-heading"><LinearPatternIcon size={14} /><strong>Linear pattern</strong><CadContextHelp label="Sketch linear pattern">Repeat this circle along the sketch X or Y axis. Pitch is the distance between neighboring centers. Edit the seed to change every attached circle. Click a numbered occurrence in the preview to exclude or restore it. Exclusions survive count changes.</CadContextHelp></div>
    <fieldset className="cad-editor-fieldset" disabled={props.interactionLocked || submission.applying || detaching}>
      <label className="cad-field"><span>Count<CadContextHelp label="Pattern count">Total occurrences including the original seed, from 1 to 32. Reducing the count keeps omitted indexes for later increases. Dependent dimensions must be removed before their occurrence.</CadContextHelp></span>
        <Input aria-label="Count" type="number" min="1" max="32" step="1" value={countText} aria-invalid={countInvalid || undefined} onChange={event => {
          const text = event.target.value, next = Number(text); setCountText(text); setError(null);
          if (text.trim() && Number.isInteger(next) && next >= 1 && next <= 32) setDraft(relation => ({ ...relation, count: next }));
        }} /></label>
      <CadScalarEditContext.Provider value={scalarContext}><ScalarField fieldKey="spacing" label="Pitch" value={draft.spacing} parameters={parameters} onChange={spacing => { setError(null); setDraft(relation => ({ ...relation, spacing })); }} /></CadScalarEditContext.Provider>
      <div className="cad-sketch-profile-actions" role="group" aria-label="Pattern direction">
        {(['x', 'y'] as const).map(axis => <Button key={axis} type="button" aria-pressed={draft.direction.endsWith(axis)} onClick={() => { setError(null); setDraft(relation => ({ ...relation, direction: (relation.direction.startsWith('-') ? '-' : '+') + axis as CadSketchLinearPattern['direction'] })); }}>Local {axis.toUpperCase()}</Button>)}
        <Button type="button" aria-label="Reverse pattern direction" title="Reverse direction without changing the pitch relation" aria-pressed={draft.direction.startsWith('-')} onClick={() => { setError(null); setDraft(relation => ({ ...relation, direction: (relation.direction.startsWith('-') ? '+' : '-') + relation.direction.slice(1) as CadSketchLinearPattern['direction'] })); }}><FlipHorizontalIcon size={14} /></Button>
      </div>
    </fieldset>
    {owner.existing && <Button type="button" disabled={props.interactionLocked || submission.applying || scalarPending} onClick={() => { setDetaching(value => !value); setError(null); }}>{detaching ? 'Keep pattern linked' : 'Detach pattern'}</Button>}
    {detaching && <span role="status">Apply keeps these circles as independent geometry.</span>}
    {prepared.kind === 'waiting' && <span role="status">Preparing preview…</span>}
    {issue && <p className="cad-error" role="alert">{issue}</p>}
    <div className="cad-form-actions"><Button type="button" onClick={cancel}><CloseIcon size={13} /> Cancel</Button><Button variant="primary" type="submit"
      disabled={props.interactionLocked || submission.applying || !sourceCurrent || !edits || edits.length > 0 && prepared.kind !== 'ready'}><ConfirmIcon size={13} /> Apply</Button></div>
  </form>;
}
