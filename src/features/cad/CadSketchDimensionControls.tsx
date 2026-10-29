import { userFacingMessage } from '@/lib/userMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CloseIcon, ConfirmIcon, LinkIcon, LockedIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadProfile, CadScalar, CadSketchFeature, CadSketchProfile } from '@/domain/cad/cadDocument';
import { applyCadEdits, reduceCadEditIntents, type CadEdit } from '@/domain/cad/cadOperations';
import { needsCadSketchPreparation } from './cadEditPreparation';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { inspectCadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { inspectCadSketchDimensions, type CadSketchDimensionQuantity } from '@/domain/cad/cadSketchConstraints';
import { cadSketchDimensionAnnotation, type CadAnnotationPoint } from './cadSketchDimensionAnnotations';
import { formatCadQuantity } from './cadDisplayQuantity';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import { CadContextMenu, type CadContextMenuItem } from './CadContextMenu';
import { NO_SKETCH_DIMENSIONS, selectCadSketchDimension } from './cadSketchDimensionSelection';
import './cad-sketch-dimensions.css';

type Dimension = { name: 'radius' | 'width' | 'height' | 'length' | 'angle' | 'module' | 'teeth'; label: string; symbol: string; unit: string; scalar: CadScalar; scale: number; integer: boolean; enabled: boolean; quantity?: CadSketchDimensionQuantity; constraintId?: string | null };
type Binding = { kind: 'parameter'; name: string } | { kind: 'literal' } | { kind: 'expression'; expression: string };
export interface CadSketchDimensionControlsProps {
  document: CadDocument;
  sketch: CadSketchFeature;
  profile: CadSketchProfile;
  parameters: Readonly<Record<string, number>>;
  anchor: { x: number; y: number };
  project?(point: readonly [number, number]): CadAnnotationPoint;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPendingChange(pending: boolean): void;
  interactionLocked: boolean;
  cancelSignal: number;
  onInspectInput?(inputName: string | null): void;
  onConfigure?(inputName: string): void;
  /** Reports a refused removal made outside the editor, such as Delete on a selected chip. */
  onError?(message: string): void;
}
function bindingFor(scalar: CadScalar, parameters: Readonly<Record<string, number>>): Binding {
  if (typeof scalar === 'number' || scalar.trim() && Number.isFinite(Number(scalar))) return { kind: 'literal' };
  const expression = scalar.trim();
  return Object.hasOwn(parameters, expression) ? { kind: 'parameter', name: expression } : { kind: 'expression', expression };
}
function profileDimensions(profile: CadSketchProfile, parameters: Readonly<Record<string, number>>): Dimension[] {
  const geometry = profile.geometry;
  const dimension = (name: Dimension['name'], label: string, symbol: string, scalar: CadScalar, scale = 1): Dimension => ({ name, label, symbol, unit: 'mm', scalar, scale, integer: false, enabled: true });
  switch (geometry.kind) {
    case 'circle': case 'rectangle': case 'slot': return inspectCadSketchDimensions(profile, parameters).map(entry => ({ ...dimension(entry.field, entry.quantity[0].toUpperCase() + entry.quantity.slice(1), entry.quantity === 'diameter' ? 'Ø' : entry.quantity === 'radius' ? 'R' : '', entry.expression, entry.scale), unit: entry.units, quantity: entry.quantity, constraintId: entry.id }));
    case 'plugin': {
      if (geometry.package.id !== 'wireedm.spur-gear') return [];
      const inspection = inspectCadPluginProfile(geometry, parameters);
      return [dimension('module', 'Module', 'm', geometry.inputs.module), { ...dimension('teeth', 'Teeth', 'z', geometry.inputs.teeth), unit: '', integer: true }].map(entry => ({ ...entry, enabled: inspection.fields.find(field => field.name === entry.name)?.enabled ?? false }));
    }
    case 'polygon': case 'path': return [];
  }
}
function changeDimension(geometry: CadProfile, name: Dimension['name'], value: number): CadProfile {
  switch (geometry.kind) {
    case 'circle': if (name === 'radius') return { ...geometry, radius: value }; break;
    case 'rectangle': if (name === 'width' || name === 'height') return { ...geometry, [name]: value }; break;
    case 'slot': if (name === 'width' || name === 'length' || name === 'angle') return { ...geometry, [name]: value }; break;
    case 'plugin': if (name === 'module' || name === 'teeth') return { ...geometry, inputs: { ...geometry.inputs, [name]: value } }; break;
    case 'polygon': case 'path': break;
  }
  throw new Error('This dimension is no longer available on the selected profile.');
}
const valueText = formatCadQuantity;
const PROFILE_REFERENCE_REASON = 'Profile dimensions always drive their profile. Copy the outline to an editable sketch to measure it with a reference dimension.';
export function CadSketchDimensionControls({ document: cadDocument, sketch, profile, parameters, anchor, project, onEditMany, onPendingChange, interactionLocked, cancelSignal, onInspectInput, onConfigure, onError }: CadSketchDimensionControlsProps) {
  const arrowId = useId();
  const dimensions = useMemo(() => profileDimensions(profile, parameters), [profile, parameters]);
  const [editor, setEditor] = useState<{ name: Dimension['name']; value: string; error: string } | null>(null);
  const submission = useCadEditSubmission();
  const [placement, setPlacement] = useState(anchor);
  // Chips follow the canvas dimension rules: a click selects, Shift toggles, double-click or Enter edits and Delete removes.
  const [selection, setSelection] = useState<readonly string[]>(NO_SKETCH_DIMENSIONS);
  const [hovered, setHovered] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ name: Dimension['name']; x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null), editorDocument = useRef<CadDocument | null>(null), previous = useRef<HTMLElement | null>(null), pendingCallback = useRef(onPendingChange), previousCancel = useRef(cancelSignal);
  const previousProfile = useRef({ profileId: profile.id, sketchId: sketch.id });
  const close = () => { submission.cancel(); setEditor(null); editorDocument.current = null; onInspectInput?.(null); };
  const commit = (edits: readonly CadEdit[]) => submission.submit(signal => {
    if (editorDocument.current !== cadDocument) throw new Error('The part changed. Cancel and reopen this dimension.');
    return edits.length ? onEditMany(edits, signal) : undefined;
  }, close, error => setEditor(current => current ? { ...current, error: userFacingMessage(error, 'Unable to change this dimension.') } : current));
  const active = dimensions.find(dimension => dimension.name === editor?.name);
  const binding = active ? bindingFor(active.scalar, parameters) : null;
  const annotations = dimensions.map(dimension => ({ dimension, annotation: project && dimension.quantity ? cadSketchDimensionAnnotation(profile.geometry, parameters, dimension.quantity, project) : null }));
  const annotated = Boolean(project && profile.geometry.kind !== 'plugin');
  // A removal from a selected chip is pending like an open editor, so the workbench holds other edits until it settles.
  useLayoutEffect(() => { pendingCallback.current = onPendingChange; onPendingChange(editor !== null || submission.applying); if (!editor) { previous.current?.focus(); previous.current = null; } else root.current?.querySelector<HTMLInputElement>('.cad-dimension-edit input')?.focus(); }, [editor?.name, submission.applying, onPendingChange]);
  useEffect(() => () => pendingCallback.current(false), []);
  useEffect(() => { if (cancelSignal !== previousCancel.current) { previousCancel.current = cancelSignal; close(); } }, [cancelSignal]);
  useEffect(() => {
    if (previousProfile.current.profileId === profile.id && previousProfile.current.sketchId === sketch.id) return;
    previousProfile.current = { profileId: profile.id, sketchId: sketch.id };
    // A clean annotation must not erase inspection selected elsewhere. Only
    // an actual dimension editor needs cancellation when its owner changes.
    setSelection(NO_SKETCH_DIMENSIONS); setMenu(null);
    if (editor) close();
  }, [profile.id, sketch.id]);
  const candidate = useMemo(() => {
    if (!editor || !active || !binding || binding.kind === 'expression' || !active.enabled) return { edits: null, issue: null };
    try {
      if (editorDocument.current !== cadDocument) throw new Error('The part changed. Cancel and reopen this dimension.');
      const value = Number(editor.value);
      if (!editor.value.trim() || !Number.isFinite(value) || active.name !== 'angle' && value <= 0 || active.integer && !Number.isInteger(value)) throw new Error(active.name === 'angle' ? 'Enter a finite angle.' : `Enter a positive ${active.integer ? 'integer' : 'number'}.`);
      const scalarValue = value / active.scale;
      if (scalarValue === evaluateCadScalar(active.scalar, parameters)) return { edits: [], issue: null };
      const edit: CadEdit = binding.kind === 'parameter' ? { kind: 'set-parameter', name: binding.name, value: scalarValue }
        : active.constraintId ? { kind: 'set-sketch-dimension', sketchId: sketch.id, profileId: profile.id, dimensionId: active.constraintId, value }
        : { kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map(entry => entry.id === profile.id ? { ...entry, geometry: changeDimension(entry.geometry, active.name, scalarValue) } : entry) } };
      if (needsCadSketchPreparation(cadDocument, [edit])) reduceCadEditIntents(cadDocument, [edit]);
      else applyCadEdits(cadDocument, [edit]);
      return { edits: [edit], issue: null };
    } catch (error) { return { edits: null, issue: userFacingMessage(error, 'Invalid dimension.') }; }
  }, [editor?.value, editor?.name, active, binding, cadDocument, sketch, profile.id]);
  useLayoutEffect(() => {
    const place = () => {
      const element = root.current, host = element?.offsetParent;
      if (!element || !(host instanceof HTMLElement) || !host.clientWidth || !host.clientHeight) { setPlacement(current => current.x === anchor.x && current.y === anchor.y ? current : anchor); return; }
      const form = element.querySelector<HTMLElement>('.cad-dimension-edit');
      const width = annotated ? form?.offsetWidth || 225 : element.offsetWidth, height = annotated ? form?.offsetHeight || 140 : element.offsetHeight;
      const target = annotated ? annotations.find(entry => entry.dimension.name === editor?.name)?.annotation?.label ?? anchor : anchor;
      const x = Math.max(width / 2 + 8, Math.min(target.x, host.clientWidth - width / 2 - 8));
      const y = Math.max(8, Math.min(target.y + (annotated ? 16 : 0), host.clientHeight - height - 8));
      setPlacement(current => current.x === x && current.y === y ? current : { x, y });
    };
    place(); window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor.x, anchor.y, project, annotated, editor?.name, editor?.value, editor?.error, candidate.issue]);
  const selected = selection.filter(name => dimensions.some(dimension => dimension.name === name));
  const openEditor = (dimension: Dimension) => {
    if (interactionLocked || editor || submission.applying) return;
    let resolved: number; try { resolved = evaluateCadScalar(dimension.scalar, parameters) * dimension.scale; } catch { return; }
    editorDocument.current = cadDocument; previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenu(null); setEditor({ name: dimension.name, value: String(resolved), error: '' }); onInspectInput?.(dimension.name);
  };
  // Delete on a selected chip removes every selected driving dimension; on another chip it removes just that one.
  const removalTargets = (name: Dimension['name']) => (selected.includes(name) ? selected : [name])
    .flatMap(item => { const constraintId = dimensions.find(dimension => dimension.name === item)?.constraintId; return constraintId ? [constraintId] : []; });
  const remove = (name: Dimension['name']) => {
    const targets = removalTargets(name);
    if (interactionLocked || editor || submission.applying || !targets.length) return;
    submission.submit(signal => onEditMany(targets.map(dimensionId => ({ kind: 'remove-sketch-dimension' as const, sketchId: sketch.id, profileId: profile.id, dimensionId })), signal),
      () => setSelection(NO_SKETCH_DIMENSIONS), error => onError?.(userFacingMessage(error, 'Unable to remove this dimension.')));
  };
  const openMenu = (name: Dimension['name'], x: number, y: number) => {
    if (interactionLocked || editor || submission.applying) return;
    if (!selected.includes(name)) setSelection(selectCadSketchDimension(NO_SKETCH_DIMENSIONS, name));
    setMenu({ name, x, y });
  };
  const menuDimension = menu ? dimensions.find(dimension => dimension.name === menu.name) : undefined;
  const menuItems: CadContextMenuItem[] = [];
  if (menuDimension) {
    const targets = removalTargets(menuDimension.name), count = selected.includes(menuDimension.name) ? selected.length : 1;
    menuItems.push({ label: 'Edit value…', disabled: interactionLocked, onSelect: () => openEditor(menuDimension) },
      { label: 'Make reference', disabled: true, help: PROFILE_REFERENCE_REASON, onSelect: () => undefined }, { kind: 'separator' },
      { label: count > 1 ? `Delete ${count} dimensions` : 'Delete', danger: true, disabled: interactionLocked || !targets.length,
        help: targets.length ? undefined : menuDimension.quantity ? 'This size follows its linked expression, so there is no dimension to remove. Edit the expression instead.' : 'Profile parameters belong to the profile and cannot be removed.',
        onSelect: () => remove(menuDimension.name) });
  }
  if (!dimensions.length) return null;
  return <div ref={root} className={`cad-sketch-dimension-controls${annotated ? ' has-annotations' : ''}`} style={annotated ? undefined : { left: placement.x, top: placement.y }} aria-label={profile.geometry.kind === 'plugin' ? 'Profile parameters' : 'Sketch dimensions'} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape' && editor) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    {annotated && <svg className="cad-dimension-leaders" aria-hidden="true"><defs>{[arrowId, `${arrowId}-active`].map(id => <marker key={id} id={id} className={id === arrowId ? undefined : 'is-active'} viewBox="0 0 8 6" refX="0" refY="3" markerWidth="6" markerHeight="4.5" orient="auto-start-reverse"><path d="M 0 3 L 8 0 L 8 6 Z" /></marker>)}</defs>{annotations.map(({ dimension, annotation }) => {
      if (!annotation) return null;
      // The hovered, selected or edited chip highlights its own leader.
      const active = hovered === dimension.name || selected.includes(dimension.name) || editor?.name === dimension.name, arrow = `url(#${active ? `${arrowId}-active` : arrowId})`;
      return <g key={dimension.name} data-cad-dimension={dimension.quantity} className={active ? 'is-active' : undefined}>{annotation.extensions.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="cad-dimension-extension" />)}{annotation.arc ? <path d={annotation.arc} markerStart={arrow} markerEnd={arrow} /> : <line x1={annotation.line[0].x} y1={annotation.line[0].y} x2={annotation.line[1].x} y2={annotation.line[1].y} markerStart={dimension.quantity === 'radius' ? undefined : arrow} markerEnd={arrow} />}</g>;
    })}</svg>}
    <div className="cad-dimension-chips">{annotations.map(({ dimension, annotation }) => {
      const dimensionBinding = bindingFor(dimension.scalar, parameters);
      let resolved: number; try { resolved = evaluateCadScalar(dimension.scalar, parameters) * dimension.scale; } catch { return null; }
      const chipSelected = selected.includes(dimension.name);
      return <Button variant="outline" key={dimension.name} type="button" style={annotation ? { left: annotation.label.x, top: annotation.label.y } : undefined}
        aria-label={`Dimension ${dimension.label.toLowerCase()} ${valueText(resolved)}${dimension.unit ? ` ${dimension.unit}` : ''}, press Enter to edit`} aria-pressed={chipSelected} aria-expanded={editor?.name === dimension.name}
        disabled={interactionLocked || Boolean(editor && editor.name !== dimension.name)} title={`${dimension.label}: ${valueText(resolved)} ${dimension.unit}${dimensionBinding.kind === 'parameter' ? ` · linked to ${dimensionBinding.name}` : dimensionBinding.kind === 'expression' ? ` · ${dimensionBinding.expression} (linked expression)` : ''}`}
        onPointerEnter={() => setHovered(dimension.name)} onPointerLeave={() => setHovered(current => current === dimension.name ? null : current)}
        onClick={event => { if (!interactionLocked && !editor && event.detail <= 1) setSelection(current => selectCadSketchDimension(current, dimension.name, event.shiftKey)); }}
        onDoubleClick={() => openEditor(dimension)} onContextMenu={event => { event.preventDefault(); openMenu(dimension.name, event.clientX, event.clientY); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
          const menuKey = event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey;
          // Space keeps the native button click, which selects; the chip owns the rest so they never reach the profile behind it.
          if (event.key === 'Escape' ? !selected.length || editor : !menuKey && !['Enter', 'Delete', 'Backspace'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Enter') openEditor(dimension);
          else if (event.key === 'Escape') setSelection(NO_SKETCH_DIMENSIONS);
          else if (menuKey) { const box = event.currentTarget.getBoundingClientRect(); openMenu(dimension.name, box.left + box.width / 2, box.top + box.height / 2); }
          else remove(dimension.name);
        }}><span>{dimension.symbol}</span><strong>{valueText(resolved)}</strong>{dimension.unit && <small>{dimension.unit}</small>}{dimensionBinding.kind === 'parameter' ? <LinkIcon size={10} /> : dimensionBinding.kind === 'expression' || !dimension.enabled ? <LockedIcon size={10} /> : null}</Button>;
    })}</div>
    {editor && active && binding && <form className="cad-dimension-edit" aria-busy={submission.applying || undefined} style={annotated ? { left: placement.x, top: placement.y } : undefined} role="dialog" aria-label={`${active.label} dimension`} onSubmit={event => {
      event.preventDefault(); if (interactionLocked || submission.applying || !candidate.edits) return;
      commit(candidate.edits);
    }}>
      <header><strong>{active.label}</strong><Button type="button" aria-label="Close dimension editor" onClick={close}><CloseIcon size={12} /></Button></header>
      {binding.kind === 'expression' || !active.enabled ? <><p className="cad-dimension-link"><LockedIcon size={11} /> {binding.kind === 'expression' ? binding.expression : 'Controlled by the profile'}</p><p>This dimension follows its linked configuration. Edit the referenced parameters or profile to change it.</p>{onConfigure && <Button type="button" className="cad-dimension-configure" onClick={() => { close(); onConfigure(active.name); }}>Profile configuration</Button>}</> : <>
        <label><span>{active.label}</span><Input aria-label={`${active.label} value`} inputMode={active.integer ? 'numeric' : 'decimal'} value={editor.value} disabled={interactionLocked || submission.applying} spellCheck={false} aria-invalid={Boolean(candidate.issue) || undefined} onChange={event => setEditor({ ...editor, value: event.target.value, error: '' })} /><small>{active.unit}</small></label>
        {binding.kind === 'parameter' && <p className="cad-dimension-link"><LinkIcon size={11} /> Updates {binding.name}{active.scale !== 1 ? ` (${active.label.toLowerCase()} ÷ ${active.scale})` : ''}</p>}
        {(editor.error || candidate.issue) && <p className="cad-dimension-error" role="alert">{editor.error || candidate.issue}</p>}
        <footer>{active.constraintId && <Button type="button" title="Release this dimension without changing the contour" disabled={interactionLocked || submission.applying} onClick={() => commit([{ kind: 'remove-sketch-dimension', sketchId: sketch.id, profileId: profile.id, dimensionId: active.constraintId! }])}>Remove dimension</Button>}<Button type="button" onClick={close}>Cancel</Button><Button variant="primary" type="submit" className="cad-dimension-apply" disabled={interactionLocked || submission.applying || !candidate.edits}><ConfirmIcon size={11} /> Apply</Button></footer>
      </>}
    </form>}
    {menu && menuDimension && <CadContextMenu anchor={{ x: menu.x, y: menu.y }} title={menuDimension.label} items={menuItems} onClose={() => setMenu(null)} />}
  </div>;
}
