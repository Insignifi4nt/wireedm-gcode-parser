import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowLeft, ArrowRight, Box, ChevronDown, ChevronRight, Circle, CircleDot, Copy, CornerDownRight, Download, FilePlus2, FolderOpen, Layers, Loader2, Move3D, PencilRuler, Plus, Redo2, RotateCw, Save, Scissors, Settings2, Square, Trash2, Undo2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CadBuildResult, CadDocument, CadFeature, CadPlane, CadProfile, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { cadFeatureDependencies, cadVisibleBodyIds } from '@/domain/cad/cadSchema';
import { CadFeatureEditor, CadProfileEditor, featureLabels } from './CadFeatureEditor';
import { CadSketchCanvas } from './CadSketchCanvas';
import { CadSketchMeasurements } from './CadSketchMeasurements';
import { CadViewport } from './CadViewport';
import type { SketchTool } from './cadSketchInteraction';
import { CAD_KERNEL_THIRD_PARTY } from './kernel/cadKernelNotices';
import { ToolError } from '@/features/webmcp/siteTools';
import { createCadWorkbenchViewportControls, type CadViewportBindings } from './cadWorkbenchViewport';
import type { CadRenderedViewControls, CadWorkbenchViewportControls } from './cadViewportControls';
import './cad-workbench.css';

export interface CadWorkbenchProps {
  document: CadDocument;
  documentVersion: string;
  buildVersion: string | null;
  build: CadBuildResult | null;
  buildState: 'idle' | 'building' | 'ready' | 'error';
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  errorMessage?: string | null;
  storageBusy?: boolean;
  onEdit(edit: CadEdit): void;
  onUndo(): void;
  onRedo(): void;
  onBack(): void;
  onWorkflowChange(open: boolean): void;
  onSendToCam(sketchId: string): Promise<void>;
  onSave(): Promise<void>;
  onOpenDocument(): void;
  onNewDocument(): void;
  onImportDocument(file: File): Promise<void>;
  onExportDocument(): void;
  onExportSolid(format: 'step' | 'stl'): Promise<void>;
  onExportDxf(sketchId: string): Promise<void>;
  onSectionForCam?(bodyId: string): void;
  onViewportControlsReady?(controls: CadWorkbenchViewportControls | null): void;
  onCaptureViewport?(): Promise<void>;
}

const featureIcons: Record<CadFeature['kind'], LucideIcon> = {
  sketch: PencilRuler, extrude: Box, revolve: RotateCw, fillet: CircleDot, chamfer: Scissors, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, mirror: Copy,
};

function featureDraft(kind: CadFeature['kind'], document: CadDocument, selected: CadFeature | undefined, bodyIds: readonly string[], plane: CadPlane = 'XY'): CadFeature {
  const id = crypto.randomUUID();
  const sequence = document.features.filter((feature) => feature.kind === kind).length + 1;
  const base = { id, name: `${kind === 'extrude' ? 'Pad' : featureLabels[kind]} ${sequence}`, suppressed: false };
  const sketch = selected?.kind === 'sketch' ? selected : [...document.features].reverse().find((feature) => feature.kind === 'sketch' && !feature.suppressed);
  const body = selected && bodyIds.includes(selected.id) ? selected : [...document.features].reverse().find((feature) => bodyIds.includes(feature.id));
  switch (kind) {
    case 'sketch': return { ...base, kind, plane, offset: 0, profiles: [] };
    case 'extrude': if (!sketch) throw new Error('Create a sketch with a closed profile before adding a Pad.'); return { ...base, kind, sketchId: sketch.id, distance: 10, symmetric: false, operation: 'new', targetId: null };
    case 'revolve': if (!sketch) throw new Error('Create a sketch with a closed profile before adding a Revolve.'); return { ...base, kind, sketchId: sketch.id, angle: 360, axis: 'y', operation: 'new', targetId: null };
    case 'fillet':
    case 'chamfer': if (!body) throw new Error('Create a solid body first.'); return { ...base, kind, targetId: body.id, radius: 1 };
    case 'boolean': { const tool = [...document.features].reverse().find((feature) => bodyIds.includes(feature.id) && feature.id !== body?.id); if (!body || !tool) throw new Error('A boolean operation needs two independent solid bodies.'); return { ...base, kind, targetId: body.id, toolId: tool.id, operation: 'union' }; }
    case 'transform': if (!body) throw new Error('Create a solid body first.'); return { ...base, kind, sourceId: body.id, translation: [0, 0, 0], rotation: [0, 0, 0] };
    case 'linear-pattern': if (!body) throw new Error('Create a solid body first.'); return { ...base, kind, sourceId: body.id, count: 2, spacing: [30, 0, 0] };
    case 'mirror': if (!body) throw new Error('Create a solid body first.'); return { ...base, kind, sourceId: body.id, plane: 'YZ' };
  }
}

export function CadWorkbench(props: CadWorkbenchProps) {
  const { document, build, buildState, dirty, canUndo, canRedo, storageBusy = false } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sketchId, setSketchId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [newFeature, setNewFeature] = useState<CadFeature | null>(null);
  const [tool, setTool] = useState<SketchTool>('select');
  const [profileRole, setProfileRole] = useState<'outer' | 'hole'>('outer');
  const [construction, setConstruction] = useState(false);
  const [tab, setTab] = useState<'model' | 'parameters'>('model');
  const [fileMenu, setFileMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawingPending, setDrawingPending] = useState(false);
  const [editorPending, setEditorPending] = useState(false);
  const [parameterPending, setParameterPending] = useState(false);
  const [cancelSignal, setCancelSignal] = useState(0);
  const [deleteFeature, setDeleteFeature] = useState<CadFeature | null>(null);
  const [parameterName, setParameterName] = useState('');
  const [parameterValue, setParameterValue] = useState('');
  const [nameDraft, setNameDraft] = useState(document.name);
  const [namePending, setNamePending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const deleteDialog = useRef<HTMLDivElement>(null);
  const renderedControls = useRef<CadRenderedViewControls | null>(null);
  const viewportBindings = useRef<CadViewportBindings | null>(null);
  const publishRenderedControls = useCallback((controls: CadRenderedViewControls | null, released?: CadRenderedViewControls) => {
    if (controls) renderedControls.current = controls;
    else if (!released || renderedControls.current === released) renderedControls.current = null;
  }, []);
  const viewportControls = useMemo(() => createCadWorkbenchViewportControls(() => {
    const bindings = viewportBindings.current;
    if (!bindings) throw new ToolError('VIEW_UNAVAILABLE', 'Wait for the CAD workspace to load.');
    return { ...bindings, rendered: renderedControls.current };
  }), []);
  const pending = drawingPending || editorPending || parameterPending || namePending || newFeature !== null || deleteFeature !== null;
  const locked = pending || storageBusy;
  const selected = document.features.find((feature) => feature.id === selectedId);
  const sketch = document.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === sketchId);
  const selectedSketch = selected?.kind === 'sketch' ? selected : sketch;
  const profile = sketch?.profiles.find((entry) => entry.id === profileId);
  const hasSketch = document.features.some((feature) => feature.kind === 'sketch' && feature.profiles.some((entry) => !entry.construction));
  const visibleBodyIds = cadVisibleBodyIds(document.features);
  const currentBodyIds = buildState === 'ready' ? build?.meshes.map((mesh) => mesh.featureId).filter((id) => visibleBodyIds.includes(id)) ?? [] : [];
  const hasBody = currentBodyIds.length > 0;
  const hasSolid = buildState === 'ready' && Boolean(build?.meshes.length);
  const sectionBodyId = selected && currentBodyIds.includes(selected.id) ? selected.id : currentBodyIds.at(-1);
  const run = (action: () => void | Promise<void>) => {
    setError(null); setFileMenu(false);
    try { Promise.resolve(action()).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The operation could not be completed.')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The operation could not be completed.'); }
  };
  useLayoutEffect(() => { props.onWorkflowChange(pending); }, [pending, props.onWorkflowChange]);
  useLayoutEffect(() => {
    props.onViewportControlsReady?.(viewportControls);
    return () => props.onViewportControlsReady?.(null);
  }, [props.onViewportControlsReady, viewportControls]);
  const workflowCallback = useRef(props.onWorkflowChange);
  workflowCallback.current = props.onWorkflowChange;
  useEffect(() => () => workflowCallback.current(false), []);
  useEffect(() => { setNameDraft(document.name); }, [document.name]);
  useEffect(() => {
    const dialog = deleteDialog.current;
    if (!deleteFeature || !dialog) return;
    const previous = window.document.activeElement;
    const buttons = () => [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    buttons()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDeleteFeature(null); }
      else if (event.key === 'Tab') {
        const entries = buttons();
        const first = entries[0], last = entries.at(-1);
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    dialog.addEventListener('keydown', onKey);
    return () => { dialog.removeEventListener('keydown', onKey); if (previous instanceof HTMLElement) previous.focus(); };
  }, [deleteFeature]);
  useEffect(() => {
    if (selectedId && !document.features.some((feature) => feature.id === selectedId)) setSelectedId(null);
    if (sketchId && !document.features.some((feature) => feature.id === sketchId && feature.kind === 'sketch')) { setSketchId(null); setProfileId(null); }
    else if (profileId && !sketch?.profiles.some((entry) => entry.id === profileId)) setProfileId(null);
  }, [document.id, document.features, selectedId, sketchId, profileId, sketch]);
  const cancel = useCallback(() => {
    setCancelSignal((value) => value + 1); setNewFeature(null); setDrawingPending(false); setEditorPending(false); setParameterPending(false); setDeleteFeature(null); setFileMenu(false); setTool('select'); setError(null);
    setParameterName(''); setParameterValue(''); setNameDraft(document.name); setNamePending(false);
  }, [document.name]);
  const hotkeys = useRef({ pending, storageBusy, props, cancel });
  hotkeys.current = { pending, storageBusy, props, cancel };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const current = hotkeys.current;
      if (event.key === 'Escape') { event.preventDefault(); current.cancel(); return; }
      if (current.pending || current.storageBusy || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey ? current.props.canRedo : current.props.canUndo) run(event.shiftKey ? current.props.onRedo : current.props.onUndo); }
      else if (event.key.toLowerCase() === 'y') { event.preventDefault(); if (current.props.canRedo) run(current.props.onRedo); }
      else if (event.key.toLowerCase() === 's') { event.preventDefault(); run(current.props.onSave); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const startFeature = (kind: CadFeature['kind'], plane?: CadPlane) => run(() => { setNewFeature(featureDraft(kind, document, selected, currentBodyIds, plane)); setSketchId(null); setProfileId(null); setEditorPending(false); });
  const choose = (id: string | null) => { if (locked) return; setSelectedId(id); setProfileId(null); if (id !== sketchId) setSketchId(null); setTab('model'); setError(null); };
  const editSketch = (feature: CadSketchFeature) => { if (locked) return; setSketchId(feature.id); setSelectedId(feature.id); setProfileId(null); setTool('select'); setTab('model'); };
  const selectProfile = (id: string | null) => { if (!editorPending) setProfileId(id); };
  const applyFeature = (feature: CadFeature) => {
    props.onEdit({ kind: newFeature ? 'add-feature' : 'update-feature', feature });
    setNewFeature(null); setEditorPending(false); setSelectedId(feature.id); setError(null);
    if (feature.kind === 'sketch' && !sketch) { setSketchId(feature.id); setTool('rectangle'); }
  };
  const addProfile = (geometry: CadProfile) => {
    if (!sketch) throw new Error('Open a sketch before drawing.');
    const id = crypto.randomUUID();
    const next = { id, name: `${geometry.kind[0].toUpperCase()}${geometry.kind.slice(1)} ${sketch.profiles.length + 1}`, construction, role: profileRole, geometry };
    props.onEdit({ kind: 'update-feature', feature: { ...sketch, profiles: [...sketch.profiles, next] } });
    setProfileId(id); setError(null);
  };
  const removeSelected = () => run(() => {
    if (sketch && profile) { props.onEdit({ kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.filter((entry) => entry.id !== profile.id) } }); setProfileId(null); return; }
    if (selected) setDeleteFeature(selected);
  });
  const finishSketch = () => { setSketchId(null); setProfileId(null); setTool('select'); };
  viewportBindings.current = {
    document, documentVersion: props.documentVersion, dirty, selectedFeatureId: selected?.id ?? null, selectedProfileId: profile?.id ?? null,
    sketchId: sketch?.id ?? null, workflowOpen: pending, busy: storageBusy, buildVersion: props.buildVersion,
    buildState, visibleBodyIds: currentBodyIds, rendered: renderedControls.current,
    selectFeature: choose,
    editSketch: (id) => { const target = document.features.find((feature) => feature.kind === 'sketch' && feature.id === id); if (target?.kind === 'sketch') editSketch(target); },
    selectProfile, finishSketch,
    updateView: (action) => flushSync(action),
  };
  const deletingIds = new Set(deleteFeature ? [deleteFeature.id] : []);
  for (const feature of document.features) if (cadFeatureDependencies(feature).some((id) => deletingIds.has(id))) deletingIds.add(feature.id);
  const dependentNames = document.features.filter((feature) => deletingIds.has(feature.id) && feature.id !== deleteFeature?.id).map((feature) => feature.name);
  const toolButton = (label: string, Icon: LucideIcon, action: () => void, disabled = false, active = false, hint?: string) => <button className={`cad-tool ${active ? 'is-active' : ''}`} title={hint ?? label} aria-label={label} disabled={disabled || storageBusy} aria-pressed={active} onClick={action}><Icon size={19} strokeWidth={1.5} /><span>{label}</span></button>;

  return <main className="cad-workbench" aria-label="Parametric CAD workbench">
    <header className="cad-header" inert={deleteFeature ? true : undefined}>
      <button className="cad-back" onClick={() => run(props.onBack)} disabled={locked}><ArrowLeft size={14} /> Workbench</button>
      <span className="cad-product">WIRE EDM <span>/ CAD</span></span>
      <span className="cad-header-divider" />
      <input className="cad-document-name" aria-label="Part name" value={nameDraft} disabled={drawingPending || editorPending || parameterPending || newFeature !== null || deleteFeature !== null || storageBusy} onChange={(event) => { setNameDraft(event.target.value); setNamePending(event.target.value !== document.name); }} onBlur={() => { if (nameDraft !== document.name) run(() => { try { props.onEdit({ kind: 'rename-document', name: nameDraft }); } finally { setNamePending(false); } }); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setNameDraft(document.name); setNamePending(false); event.currentTarget.blur(); } }} />
      <span className={`cad-save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Unsaved' : 'Saved'}</span>
      <div className="cad-header-actions">
        <div className="cad-menu-anchor"><button disabled={locked} aria-haspopup="true" aria-expanded={fileMenu} aria-controls="cad-file-menu" onClick={() => setFileMenu(!fileMenu)}>File <ChevronDown size={12} /></button>{fileMenu && <><button className="cad-menu-scrim" aria-label="Close file menu" onClick={() => setFileMenu(false)} /><div className="cad-file-menu" id="cad-file-menu" aria-label="CAD document commands"><button onClick={() => run(props.onNewDocument)}><FilePlus2 size={14} /> New part</button><button onClick={() => run(props.onOpenDocument)}><FolderOpen size={14} /> Open saved part</button><button onClick={() => { setFileMenu(false); fileInput.current?.click(); }}><FolderOpen size={14} /> Import CAD document</button>{props.onCaptureViewport && <button disabled={locked || (!sketch && (!hasSolid || props.buildVersion !== props.documentVersion))} onClick={() => run(() => props.onCaptureViewport?.())}><Download size={14} /> Capture view PNG</button>}<span className="cad-menu-rule" /><button onClick={() => run(props.onExportDocument)}><Download size={14} /> Download CAD document</button><button disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('step'))}><Download size={14} /> Export STEP</button><button disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('stl'))}><Download size={14} /> Export STL</button><button disabled={!selectedSketch?.profiles.length} onClick={() => selectedSketch && run(() => props.onExportDxf(selectedSketch.id))}><Download size={14} /> Export sketch DXF</button></div></>}</div>
        <button aria-label="Undo" title="Undo · Ctrl+Z" disabled={!canUndo || locked} onClick={() => run(props.onUndo)}><Undo2 size={15} /></button><button aria-label="Redo" title="Redo · Ctrl+Shift+Z" disabled={!canRedo || locked} onClick={() => run(props.onRedo)}><Redo2 size={15} /></button>
        <button disabled={locked} onClick={() => run(props.onSave)}><Save size={14} /> {storageBusy ? 'Working…' : 'Save'}</button>
        {props.onSectionForCam && <button disabled={locked || !sectionBodyId || !hasSolid || Boolean(build?.diagnostics.length)} title="Create CAM geometry from a planar section of the current solid" onClick={() => sectionBodyId && run(() => props.onSectionForCam?.(sectionBodyId))}><Scissors size={14} /> Section for CAM</button>}<button className="cad-primary" disabled={locked || !selectedSketch?.profiles.some((entry) => !entry.construction)} title="Create a CAM project from the selected planar sketch" onClick={() => selectedSketch && run(() => props.onSendToCam(selectedSketch.id))}>Send sketch to CAM <ArrowRight size={14} /></button>
      </div>
      <input ref={fileInput} type="file" accept=".wireedm-cad,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) run(() => props.onImportDocument(file)); event.target.value = ''; }} />
    </header>
    <div className="cad-toolbar" aria-label="CAD tools" inert={deleteFeature ? true : undefined}>
      <div className="cad-tool-group">{toolButton('Sketch', PencilRuler, () => startFeature('sketch'), locked)}<span className="cad-tool-group-label">CREATE</span></div>
      {sketch ? <><div className="cad-tool-group">{toolButton('Select', CornerDownRight, () => setTool('select'), drawingPending || editorPending, tool === 'select')}{toolButton('Rectangle', Square, () => { setTool('rectangle'); setProfileId(null); }, drawingPending || editorPending, tool === 'rectangle')}{toolButton('Circle', Circle, () => { setTool('circle'); setProfileId(null); }, drawingPending || editorPending, tool === 'circle')}{toolButton('Slot', Square, () => { setTool('slot'); setProfileId(null); }, drawingPending || editorPending, tool === 'slot')}{toolButton('Polyline', PencilRuler, () => { setTool('polygon'); setProfileId(null); }, drawingPending || editorPending, tool === 'polygon')}<span className="cad-tool-group-label">DRAW CLOSED PROFILES</span></div><div className="cad-sketch-options"><label><input type="checkbox" checked={profileRole === 'hole'} disabled={drawingPending || editorPending} onChange={(event) => setProfileRole(event.target.checked ? 'hole' : 'outer')} /> Hole</label><label><input type="checkbox" checked={construction} disabled={drawingPending || editorPending} onChange={(event) => setConstruction(event.target.checked)} /> Construction</label></div></> : <><div className="cad-tool-group">{toolButton('Pad / Pocket', Box, () => startFeature('extrude'), locked || !hasSketch)}{toolButton('Revolve', RotateCw, () => startFeature('revolve'), locked || !hasSketch)}<span className="cad-tool-group-label">SOLID</span></div><div className="cad-tool-group">{toolButton('Fillet', CircleDot, () => startFeature('fillet'), locked || !hasBody)}{toolButton('Chamfer', Scissors, () => startFeature('chamfer'), locked || !hasBody)}{toolButton('Boolean', Layers, () => startFeature('boolean'), locked || currentBodyIds.length < 2)}<span className="cad-tool-group-label">MODIFY</span></div><div className="cad-tool-group">{toolButton('Move', Move3D, () => startFeature('transform'), locked || !hasBody)}{toolButton('Pattern', Copy, () => startFeature('linear-pattern'), locked || !hasBody)}{toolButton('Mirror', Copy, () => startFeature('mirror'), locked || !hasBody)}<span className="cad-tool-group-label">TRANSFORM</span></div></>}
      <div className="cad-toolbar-tail"><span>PARAMETRIC</span><strong>mm</strong></div>
    </div>
    {(error || props.errorMessage) && <div className="cad-error-banner" role="alert"><span>{error || props.errorMessage}</span><button aria-label="Dismiss local error" onClick={() => setError(null)}><X size={13} /></button></div>}
    <div className="cad-body" inert={deleteFeature ? true : undefined}>
      <aside className="cad-model-panel" aria-label="Feature tree and parameters">
        <div className="cad-panel-tabs"><button aria-pressed={tab === 'model'} disabled={locked} onClick={() => setTab('model')}><Layers size={13} /> Model</button><button aria-pressed={tab === 'parameters'} disabled={locked} onClick={() => setTab('parameters')}><Settings2 size={13} /> Parameters</button></div>
        {tab === 'model' ? <><div className="cad-tree-root"><Box size={15} /><strong>{document.name}</strong></div><div className="cad-tree-section">REFERENCE PLANES</div><div className="cad-plane-list">{(['XY', 'XZ', 'YZ'] satisfies CadPlane[]).map((plane) => <button key={plane} disabled={locked} title={`Create sketch on ${plane}`} onClick={() => startFeature('sketch', plane)}><Square size={12} /><span>{plane}</span><Plus size={11} /></button>)}</div><div className="cad-tree-section">FEATURES <span>{document.features.length}</span></div><div className="cad-feature-list">{document.features.map((feature) => {
          const Icon = featureIcons[feature.kind];
          const diagnostic = build?.diagnostics.find((entry) => entry.featureId === feature.id);
          return <div key={feature.id} className="cad-feature-node"><button className={`cad-tree-row ${selectedId === feature.id ? 'is-selected' : ''} ${feature.suppressed ? 'is-suppressed' : ''} ${diagnostic ? 'has-error' : ''}`} disabled={locked} title={diagnostic?.message ?? `${featureLabels[feature.kind]} · ${feature.name}`} onClick={() => choose(feature.id)} onDoubleClick={() => { if (feature.kind === 'sketch') editSketch(feature); }}><ChevronRight size={11} /><Icon size={14} /><span>{feature.name}</span>{diagnostic && <span className="cad-tree-error">!</span>}{feature.suppressed && <span className="cad-tree-muted">off</span>}</button>{feature.kind === 'sketch' && selectedId === feature.id && feature.profiles.map((entry) => <button key={entry.id} className={`cad-tree-row cad-tree-profile ${entry.id === profileId ? 'is-selected' : ''}`} disabled={locked} title={`${entry.role}${entry.construction ? ' · construction' : ''}`} onClick={() => { editSketch(feature); setProfileId(entry.id); }}>{entry.geometry.kind === 'circle' ? <Circle size={12} /> : <Square size={12} />}<span>{entry.name}</span>{entry.role === 'hole' && <span className="cad-tree-muted">hole</span>}</button>)}</div>;
        })}{document.features.length === 0 && <div className="cad-tree-empty">No features yet.<br />Create a sketch to begin.</div>}</div><div className="cad-tree-footer"><span>{build?.meshes.length ?? 0} solid bodies</span><span>Local document</span></div></> : <div className="cad-parameters"><p>Named dimensions are shared by every feature. Expressions use + − × / and parentheses.</p>{Object.entries(document.parameters).map(([name, value]) => <div className="cad-parameter-row" key={name}><button disabled={locked} onClick={() => { setParameterName(name); setParameterValue(String(value)); }}><span>{name}</span><code>{value}</code></button><button disabled={locked} aria-label={`Remove parameter ${name}`} onClick={() => run(() => props.onEdit({ kind: 'remove-parameter', name }))}><X size={12} /></button></div>)}<fieldset className="cad-editor-fieldset" disabled={drawingPending || editorPending || newFeature !== null || storageBusy || deleteFeature !== null}><form onSubmit={(event) => { event.preventDefault(); run(() => { props.onEdit({ kind: 'set-parameter', name: parameterName, value: Number(parameterValue) }); setParameterName(''); setParameterValue(''); setParameterPending(false); }); }}><div className="cad-field-section">Add or update parameter</div><label className="cad-field"><span>Name</span><input value={parameterName} placeholder="wallThickness" onChange={(event) => { setParameterName(event.target.value); setParameterPending(true); }} /></label><label className="cad-field"><span>Value</span><input type="number" step="any" value={parameterValue} placeholder="2.5" onChange={(event) => { setParameterValue(event.target.value); setParameterPending(true); }} /></label><button className="cad-primary" disabled={storageBusy || !parameterName.trim() || !parameterValue.trim()}><Plus size={13} /> Set parameter</button>{parameterPending && <button type="button" onClick={() => { setParameterPending(false); setParameterName(''); setParameterValue(''); }}>Cancel</button>}</form></fieldset></div>}
      </aside>
      <section className="cad-center" aria-label="Modeling area">{sketch ? <CadSketchCanvas key={sketch.id} sketch={sketch} parameters={document.parameters} tool={tool} selectedProfileId={profileId} onSelectProfile={selectProfile} onAddProfile={addProfile} onPendingChange={setDrawingPending} onError={setError} onFinish={finishSketch} cancelSignal={cancelSignal} interactionLocked={editorPending || storageBusy} viewLocked={locked} onControlsReady={publishRenderedControls} /> : <CadViewport meshes={build?.meshes ?? []} selectedId={selectedId} onSelect={choose} interactionLocked={locked} onControlsReady={publishRenderedControls} />}
        {buildState === 'building' && <div className="cad-build-overlay" role="status"><Loader2 size={13} className="cad-spin" /> Building solid geometry…</div>}
        {build?.diagnostics.length ? <div className="cad-diagnostics" role="alert">{build.diagnostics.map((diagnostic, index) => <button key={`${diagnostic.code}-${index}`} disabled={locked} onClick={() => diagnostic.featureId && choose(diagnostic.featureId)}><span>!</span>{diagnostic.featureId ? `${document.features.find((entry) => entry.id === diagnostic.featureId)?.name ?? 'Feature'}: ` : ''}{diagnostic.message}</button>)}</div> : null}
        <div className="cad-timeline" aria-label="Feature history"><span className="cad-timeline-label">HISTORY</span>{document.features.map((feature, index) => { const Icon = featureIcons[feature.kind]; return <button key={feature.id} className={selectedId === feature.id ? 'is-selected' : ''} disabled={locked} title={`${index + 1}. ${feature.name}${feature.suppressed ? ' · suppressed' : ''}`} aria-label={`Select ${feature.name} in history`} onClick={() => choose(feature.id)}><Icon size={16} /><small>{index + 1}</small></button>; })}{document.features.length === 0 && <span className="cad-timeline-empty">Your modeling steps appear here</span>}</div>
      </section>
      <aside className="cad-properties" aria-label="Feature properties"><div className="cad-panel-heading"><span>{newFeature ? 'NEW FEATURE' : profile ? 'PROFILE' : 'PROPERTIES'}</span>{(selected || profile) && !newFeature && <button aria-label="Delete selected feature or profile" disabled={locked} onClick={removeSelected}><Trash2 size={13} /></button>}</div>
        <fieldset className="cad-editor-fieldset" disabled={drawingPending || parameterPending || namePending || storageBusy}>{newFeature ? <CadFeatureEditor key={`${newFeature.id}-${cancelSignal}`} feature={newFeature} document={document} isNew currentBodyIds={currentBodyIds} onApply={applyFeature} onCancel={cancel} onPendingChange={setEditorPending} /> : profile && sketch ? <CadProfileEditor key={`${profile.id}-${cancelSignal}`} profile={profile} document={document} onApply={(next) => { props.onEdit({ kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map((entry) => entry.id === next.id ? next : entry) } }); setEditorPending(false); }} onCancel={cancel} onPendingChange={setEditorPending} /> : selected ? <><CadFeatureEditor key={`${selected.id}-${cancelSignal}`} feature={selected} document={document} isNew={false} onApply={applyFeature} onCancel={cancel} onPendingChange={setEditorPending} />{selected.kind === 'sketch' && <div className="cad-context-actions"><button disabled={locked} onClick={() => editSketch(selected)}><PencilRuler size={13} /> Edit sketch</button><button disabled={locked || !selected.profiles.length} onClick={() => run(() => props.onExportDxf(selected.id))}><Download size={13} /> Download DXF</button></div>}<div className="cad-context-actions"><label className="cad-check"><input type="checkbox" disabled={locked} checked={selected.suppressed} onChange={(event) => run(() => props.onEdit({ kind: 'update-feature', feature: { ...selected, suppressed: event.target.checked } }))} /> Suppress feature</label></div>{build?.meshes.filter((mesh) => mesh.featureId === selected.id).map((mesh) => <div className="cad-solid-info" key={mesh.featureId}><span>Solid volume</span><strong>{mesh.volume.toLocaleString(undefined, { maximumFractionDigits: 3 })} mm³</strong></div>)}</> : <div className="cad-inspector-empty"><PencilRuler size={24} strokeWidth={1} /><strong>{sketch ? 'Draw a closed profile' : 'Select a feature'}</strong><p>{sketch ? 'Click in the canvas to draw. Select a profile to change its dimensions, role or construction state.' : 'Select a feature in the tree or on the model to edit its dimensions and dependencies.'}</p><div className="cad-shortcut"><kbd>Ctrl Z</kbd><span>Undo</span><kbd>Ctrl S</kbd><span>Save part</span><kbd>Esc</kbd><span>Cancel current tool</span></div></div>}{selectedSketch && !newFeature && <CadSketchMeasurements document={document} sketchId={selectedSketch.id} profileId={profileId} />}</fieldset>
      </aside>
    </div>
    <footer className="cad-statusbar" inert={deleteFeature ? true : undefined}><span className={`cad-status-dot ${buildState === 'error' ? 'has-error' : ''}`} /> <span>{sketch ? `Editing ${sketch.name}` : buildState === 'building' ? 'Rebuilding' : buildState === 'error' ? 'Feature needs attention' : 'Ready'}</span><span className="cad-status-selection">{profile?.name ?? selected?.name ?? 'No selection'}</span><span>{buildState === 'ready' && build ? `${Math.round(build.durationMs)} ms` : ''}</span><a href={CAD_KERNEL_THIRD_PARTY.href} title={CAD_KERNEL_THIRD_PARTY.description} target="_blank" rel="noopener noreferrer">{CAD_KERNEL_THIRD_PARTY.label}</a><span>mm</span><span>{dirty ? 'Unsaved changes' : 'Document saved'}</span></footer>
    {deleteFeature && <div className="cad-dialog-backdrop"><div ref={deleteDialog} className="cad-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="cad-delete-title"><h2 id="cad-delete-title">Delete {deleteFeature.name}?</h2>{dependentNames.length ? <><p>This also deletes {dependentNames.length} dependent feature{dependentNames.length === 1 ? '' : 's'}.</p><ul>{dependentNames.map((name) => <li key={name}>{name}</li>)}</ul></> : <p>You can restore this feature with Undo.</p>}<div className="cad-form-actions"><button onClick={() => setDeleteFeature(null)}>Cancel</button><button className="cad-danger" onClick={() => run(() => { props.onEdit({ kind: 'delete-feature', featureId: deleteFeature.id, cascade: dependentNames.length > 0 }); setDeleteFeature(null); setSelectedId(null); })}><Trash2 size={13} /> Delete{dependentNames.length ? ' with dependents' : ''}</button></div></div></div>}
  </main>;
}

export default CadWorkbench;
