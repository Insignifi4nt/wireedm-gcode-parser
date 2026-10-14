import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, CircleDot, Link2, Move, Ruler, X } from 'lucide-react';
import type { CadDocument, CadScalar, CadSketchFeature, CadSketchProfile } from '@/domain/cad/cadDocument';
import { applyCadEdits, type CadEdit } from '@/domain/cad/cadOperations';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { addCadSketchDimension, cadSketchDimensionQuantities, cadSketchDimensionScalar, inspectCadSketchDimensions, setCadSketchDimensionValue, type CadSketchDimensionQuantity } from '@/domain/cad/cadSketchConstraints';
import { formatCadQuantity } from './cadDisplayQuantity';
import { CadContextHelp } from './CadContextHelp';
import './cad-sketch-profile.css';

export type CadSketchProfileCommand = { readonly token: number; readonly documentId: string; readonly profileId: string; readonly kind: 'dimension' | 'move' | 'fillet' };
type Editor = { kind: 'dimension'; quantity: CadSketchDimensionQuantity; id: string; isNew: boolean; mode: 'value' | 'expression'; value: string; initial: string }
  | { kind: 'move'; x: string; y: string }
  | { kind: 'fillet'; mode: 'value' | 'expression'; value: string; initial: string };
const title = (quantity: string) => quantity[0].toUpperCase() + quantity.slice(1);
const scalarText = (text: string): CadScalar => text.trim() && Number.isFinite(Number(text)) ? Number(text) : text.trim();

/** Compact authoring intent for ordinary contours. Generator profiles keep their configuration editor. */
export function CadSketchProfilePanel({ document: cadDocument, sketch, profile, onEditMany, onPendingChange, onPreviewProfile, onPreviewParameters, interactionLocked, otherEditorPending = false, cancelSignal, command, onCommandConsumed, exactGeometryEditor }: {
  document: CadDocument; sketch: CadSketchFeature; profile: CadSketchProfile;
  onEditMany(edits: readonly CadEdit[]): void; onPendingChange(pending: boolean): void;
  onPreviewProfile?(profile: CadSketchProfile | null): void; onPreviewParameters?(parameters: CadDocument['parameters'] | null): void;
  interactionLocked: boolean; otherEditorPending?: boolean; cancelSignal: number; command?: CadSketchProfileCommand | null; onCommandConsumed?(token: number): void; exactGeometryEditor?: ReactNode;
}) {
  const [editor, setEditor] = useState<Editor | null>(null), [error, setError] = useState<string | null>(null);
  const captured = useRef<CadDocument | null>(null), previousCommand = useRef(0), previousCancel = useRef(cancelSignal), pendingCallback = useRef(onPendingChange);
  const input = useRef<HTMLInputElement>(null);
  const blocked = interactionLocked || otherEditorPending && !editor;
  const dimensions = useMemo(() => inspectCadSketchDimensions(profile, cadDocument.parameters), [profile, cadDocument.parameters]);
  const available = cadSketchDimensionQuantities(profile.geometry).filter(quantity => !dimensions.some(dimension => dimension.field === (quantity === 'diameter' ? 'radius' : quantity)));
  const close = () => { setEditor(null); setError(null); captured.current = null; };
  const dimensionEditor = (quantity: CadSketchDimensionQuantity): Extract<Editor, { kind: 'dimension' }> => {
    const dimension = dimensions.find(entry => entry.field === (quantity === 'diameter' ? 'radius' : quantity));
    const selected = dimension?.quantity ?? quantity;
    const value = String(evaluateCadScalar(cadSketchDimensionScalar(profile, selected), cadDocument.parameters) * (selected === 'diameter' ? 2 : 1));
    return { kind: 'dimension', quantity: selected, id: dimension?.id ?? crypto.randomUUID(), isNew: !dimension, mode: 'value', value, initial: value };
  };
  const begin = (kind: CadSketchProfileCommand['kind']) => {
    if (blocked || editor) return;
    let next: Editor;
    if (kind === 'dimension') { if (!available[0]) return; next = dimensionEditor(available[0]); }
    else if (kind === 'fillet') {
      if (profile.geometry.kind !== 'rectangle') return;
      const value = String(evaluateCadScalar(profile.geometry.cornerRadius, cadDocument.parameters)); next = { kind, mode: 'value', value, initial: value };
    } else next = { kind, x: '0', y: '0' };
    captured.current = cadDocument; setError(null); setEditor(next);
  };
  useLayoutEffect(() => { pendingCallback.current = onPendingChange; onPendingChange(editor !== null); if (editor) input.current?.focus(); }, [editor?.kind, onPendingChange]);
  useEffect(() => () => pendingCallback.current(false), []);
  useEffect(() => { if (previousCancel.current !== cancelSignal) { previousCancel.current = cancelSignal; close(); } }, [cancelSignal]);
  useEffect(() => { if (command && command.documentId === cadDocument.id && command.profileId === profile.id && previousCommand.current !== command.token) { previousCommand.current = command.token; begin(command.kind); onCommandConsumed?.(command.token); } }, [command]);
  const candidate = useMemo(() => {
    if (!editor) return { edits: null, document: null, issue: null };
    try {
      if (captured.current !== cadDocument) throw new Error('The part changed. Cancel and reopen this edit.');
      const edits: CadEdit[] = [];
      const changedScalar = (scalar: CadScalar, text: string, scale: number, literalEdit: CadEdit) => {
        if (typeof scalar === 'string' && !Number.isFinite(Number(scalar))) {
          if (!Object.hasOwn(cadDocument.parameters, scalar.trim())) throw new Error('This value follows an expression. Edit its linked parameters.');
          const value = evaluateCadScalar(scalarText(text), cadDocument.parameters) / scale;
          edits.push({ kind: 'set-parameter', name: scalar.trim(), value });
        } else edits.push(literalEdit);
      };
      if (editor.kind === 'move') {
        const dx = Number(editor.x), dy = Number(editor.y);
        if (!editor.x.trim() || !editor.y.trim() || !Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Enter finite movement distances.');
        if (dx || dy) edits.push({ kind: 'translate-sketch-profiles', sketchId: sketch.id, profileIds: [profile.id], translation: [dx, dy] });
      } else if (editor.kind === 'dimension') {
        if (editor.isNew) edits.push({ kind: 'add-sketch-dimension', sketchId: sketch.id, profileId: profile.id, constraint: { id: editor.id, kind: 'dimension', quantity: editor.quantity } });
        if (editor.value !== editor.initial) {
          const scalar = cadSketchDimensionScalar(profile, editor.quantity), value = scalarText(editor.value);
          if (editor.mode === 'expression') {
            const constrained = profile.constraints?.some(constraint => constraint.id === editor.id) ? profile : addCadSketchDimension({ profile, constraint: { id: editor.id, kind: 'dimension', quantity: editor.quantity } });
            const nextProfile = setCadSketchDimensionValue({ profile: constrained, quantity: editor.quantity, value });
            edits.push({ kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map(entry => entry.id === profile.id ? nextProfile : entry) } });
          } else if (typeof value !== 'number' || value !== Number(editor.initial)) {
            if (profile.constraints?.some(constraint => constraint.id === editor.id) || editor.isNew) edits.push({ kind: 'set-sketch-dimension', sketchId: sketch.id, profileId: profile.id, dimensionId: editor.id, value });
            else changedScalar(scalar, editor.value, editor.quantity === 'diameter' ? 2 : 1, { kind: 'set-sketch-dimension', sketchId: sketch.id, profileId: profile.id, dimensionId: editor.id, value });
          }
        }
      } else if (profile.geometry.kind === 'rectangle' && editor.value !== editor.initial) {
        const value = scalarText(editor.value);
        if (editor.mode === 'expression' || typeof value !== 'number' || value !== Number(editor.initial)) {
          const nextProfile = { ...profile, geometry: { ...profile.geometry, cornerRadius: value } };
          const edit: CadEdit = { kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map(entry => entry.id === profile.id ? nextProfile : entry) } };
          if (editor.mode === 'expression') edits.push(edit);
          else changedScalar(profile.geometry.cornerRadius, editor.value, 1, edit);
        }
      }
      const next = edits.length ? applyCadEdits(cadDocument, edits) : cadDocument;
      return { edits, document: next, issue: null };
    } catch (cause) { return { edits: null, document: null, issue: cause instanceof Error ? cause.message : 'Invalid sketch edit.' }; }
  }, [editor, cadDocument, sketch, profile]);
  useLayoutEffect(() => {
    const nextSketch = candidate.document?.features.find(entry => entry.id === sketch.id), nextProfile = nextSketch?.kind === 'sketch' ? nextSketch.profiles.find(entry => entry.id === profile.id) : null;
    const preview = Boolean(editor && candidate.edits?.length && nextProfile);
    onPreviewProfile?.(preview ? nextProfile ?? null : null); onPreviewParameters?.(preview ? candidate.document?.parameters ?? null : null);
    return () => { onPreviewProfile?.(null); onPreviewParameters?.(null); };
  }, [candidate.document, candidate.edits, editor !== null, profile.id, sketch.id, onPreviewProfile, onPreviewParameters]);
  const commit = (edits: readonly CadEdit[]) => { if (edits.length) onEditMany(edits); close(); };
  const activeExpression = editor?.kind === 'dimension' ? cadSketchDimensionScalar(profile, editor.quantity) : editor?.kind === 'fillet' && profile.geometry.kind === 'rectangle' ? profile.geometry.cornerRadius : null;
  const expressionDriven = typeof activeExpression === 'string' && !Number.isFinite(Number(activeExpression));
  const compoundDriven = expressionDriven && !Object.hasOwn(cadDocument.parameters, activeExpression.trim());
  const unlink = () => {
    if (interactionLocked || !editor || editor.kind === 'move') return;
    try {
      if (captured.current !== cadDocument) throw new Error('The part changed. Cancel and reopen this edit.');
      let next: CadSketchProfile;
      if (editor.kind === 'dimension') {
        const quantity = editor.quantity, value = evaluateCadScalar(cadSketchDimensionScalar(profile, quantity), cadDocument.parameters) * (quantity === 'diameter' ? 2 : 1);
        const constrained = profile.constraints?.some(constraint => constraint.id === editor.id) ? profile : addCadSketchDimension({ profile, constraint: { id: editor.id, kind: 'dimension', quantity } });
        next = setCadSketchDimensionValue({ profile: constrained, quantity, value });
      } else {
        if (profile.geometry.kind !== 'rectangle') return;
        next = { ...profile, geometry: { ...profile.geometry, cornerRadius: evaluateCadScalar(profile.geometry.cornerRadius, cadDocument.parameters) } };
      }
      commit([{ kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map(entry => entry.id === profile.id ? next : entry) } }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to unlink this expression.'); }
  };
  const remove = (id: string) => { if (blocked || editor) return; try { onEditMany([{ kind: 'remove-sketch-dimension', sketchId: sketch.id, profileId: profile.id, dimensionId: id }]); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to remove this dimension.'); } };
  return <div className="cad-sketch-profile-panel" onKeyDown={event => { if (event.key === 'Escape' && editor) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <div className="cad-sketch-profile-heading"><strong>{profile.name}</strong><span>{dimensions.length ? `${dimensions.length} driving ${dimensions.length === 1 ? 'dimension' : 'dimensions'}` : 'Free geometry'}</span><CadContextHelp label="Sketch constraints">Dimensions fix the selected size or angle. Placement stays movable unless its coordinates follow an expression. Add a dimension from the tool dock or this panel, then edit its annotation on the sketch.</CadContextHelp></div>
    {!editor && <>
      <div className="cad-sketch-profile-actions"><button type="button" aria-label="Add dimension" title="Constrain a size or angle" disabled={blocked || !available.length} onClick={() => begin('dimension')}><Ruler size={14} /> Dimension</button><button type="button" aria-label="Move profile" title="Move the contour without changing its dimensions" disabled={blocked} onClick={() => begin('move')}><Move size={14} /> Move</button>{profile.geometry.kind === 'rectangle' && <button type="button" aria-label="Sketch fillet" title="Round all four corners" disabled={blocked} onClick={() => begin('fillet')}><CircleDot size={14} /> Fillet</button>}</div>
      {dimensions.length > 0 && <ul className="cad-sketch-constraint-list" aria-label="Driving dimensions">{dimensions.map(dimension => <li key={dimension.field}><button type="button" aria-label={`Configure ${title(dimension.quantity)} dimension`} disabled={blocked} onClick={() => { captured.current = cadDocument; setEditor(dimensionEditor(dimension.quantity)); }}>{title(dimension.quantity)}<span>{formatCadQuantity(dimension.value)} {dimension.units === 'deg' ? '°' : 'mm'}</span>{dimension.source === 'expression' || typeof dimension.expression === 'string' && !Number.isFinite(Number(dimension.expression)) ? <Link2 size={11} /> : null}</button>{dimension.id && <button type="button" aria-label={`Remove ${title(dimension.quantity)} dimension`} title="Release the dimension and retain the shape" disabled={blocked} onClick={() => remove(dimension.id!)}><X size={12} /></button>}</li>)}</ul>}
      <label className="cad-check"><input type="checkbox" checked={profile.construction} disabled={blocked} onChange={event => { try { onEditMany([{ kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map(entry => entry.id === profile.id ? { ...entry, construction: event.target.checked } : entry) } }]); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to change construction geometry.'); } }} /> Construction</label>
      {exactGeometryEditor && <details className="cad-plugin-disclosure"><summary>Exact geometry</summary>{exactGeometryEditor}</details>}
    </>}
    {editor && <form className="cad-sketch-intent-editor" aria-label={editor.kind === 'dimension' ? 'Driving dimension' : editor.kind === 'move' ? 'Move contour' : 'Sketch fillet'} onSubmit={event => { event.preventDefault(); if (interactionLocked || !candidate.edits) return; try { commit(candidate.edits); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to apply this sketch edit.'); } }}>
      {editor.kind === 'dimension' ? <><label><span>Dimension</span>{editor.isNew ? <select aria-label="Dimension quantity" value={editor.quantity} disabled={interactionLocked} onChange={event => { const quantity = available.find(entry => entry === event.target.value); if (quantity) setEditor({ ...dimensionEditor(quantity), id: editor.id }); }}>{available.map(quantity => <option key={quantity} value={quantity}>{title(quantity)}</option>)}</select> : <strong>{title(editor.quantity)}</strong>}</label><label><span>{editor.mode === 'expression' ? 'Expression' : 'Value'}</span><input ref={input} aria-label={editor.mode === 'expression' ? 'Dimension expression' : 'Dimension value'} disabled={interactionLocked || editor.mode === 'value' && compoundDriven} spellCheck={false} value={editor.value} onChange={event => { setError(null); setEditor({ ...editor, value: event.target.value }); }} /><small>{editor.quantity === 'angle' ? '°' : 'mm'}</small></label></>
        : editor.kind === 'move' ? <div className="cad-placement-row"><label><span>ΔX</span><input ref={input} aria-label="Move X" value={editor.x} disabled={interactionLocked} onChange={event => setEditor({ ...editor, x: event.target.value })} /></label><label><span>ΔY</span><input aria-label="Move Y" value={editor.y} disabled={interactionLocked} onChange={event => setEditor({ ...editor, y: event.target.value })} /></label><small>mm</small></div>
        : <label><span>Radius <CadContextHelp label="Sketch fillet radius">One tangent radius rounds all four corners of this rectangle. It cannot exceed half the smaller side. This contour operation is separate from the generating cutter radius of a gear.</CadContextHelp></span><input ref={input} aria-label={editor.mode === 'expression' ? 'Fillet expression' : 'Fillet radius'} disabled={interactionLocked || editor.mode === 'value' && compoundDriven} value={editor.value} spellCheck={false} onChange={event => setEditor({ ...editor, value: event.target.value })} /><small>mm</small></label>}
      {editor.kind !== 'move' && (editor.kind === 'fillet' || !editor.isNew) && <div className="cad-sketch-relation"><button type="button" disabled={interactionLocked} onClick={() => { if (activeExpression === null) return; const value = editor.kind === 'dimension' && editor.quantity === 'diameter' ? '(' + activeExpression + ') * 2' : String(activeExpression); setError(null); setEditor({ ...editor, mode: 'expression', value, initial: value }); }}>Edit expression</button>{expressionDriven && <button type="button" disabled={interactionLocked} onClick={unlink}>Unlink expression</button>}<CadContextHelp label="Sketch relation">Value editing retains a shared parameter link. Edit expression explicitly changes this contour's relation. Unlink freezes its exact current value. Dimensions stay visible; the shared parameter and other contours remain unchanged.</CadContextHelp></div>}
      {(error || candidate.issue) && <p className="cad-error" role="alert">{error || candidate.issue}</p>}
      <div className="cad-form-actions"><button type="button" onClick={close}>Cancel</button><button type="submit" className="cad-primary" disabled={interactionLocked || !candidate.edits}><Check size={13} /> Apply</button></div>
    </form>}
    {!editor && error && <p className="cad-error" role="alert">{error}</p>}
  </div>;
}
