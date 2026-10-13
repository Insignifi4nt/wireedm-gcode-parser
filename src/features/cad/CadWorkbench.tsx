import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useOptionalAppRail } from '@/app/AppRailContext';
import { RailResizeHandle } from '@/components/ui/RailResizeHandle';
import { ArrowLeft, ArrowRight, Box, ChevronDown, ChevronRight, Circle, CircleDot, Copy, CornerDownRight, Download, FilePlus2, FolderOpen, Layers, Loader2, Move3D, PencilRuler, Plus, Redo2, RotateCw, Save, Scissors, Settings2, Spline, Square, Trash2, Undo2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CadBuildResult, CadCurveFeature, CadDocument, CadFeature, CadPathSegment, CadPlane, CadProfile, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadTopologyPickSet, CadTopologyResolvePicksRequest, CadTopologyResolvePicksResult } from '@/domain/cad/cadTopology';
import { cadFeatureDependencies, cadFeatureProducesBody, cadVisibleBodyIds } from '@/domain/cad/cadSchema';
import { CadFeatureEditor, CadProfileEditor, featureLabels } from './CadFeatureEditor';
import { CadSketchCanvas } from './CadSketchCanvas';
import { CadSketchMeasurements } from './CadSketchMeasurements';
import { CadViewport, type CadViewportEmptyAction } from './CadViewport';
import { CadTopologyInspector, type CadInspectTopology } from './CadTopologyInspector';
import { mergeTopologySelection, validateTopologySelection, type CadPickMode, type CadTopologyHit } from './cadTopologyPicking';
import type { SketchTool } from './cadSketchInteraction';
import { CAD_KERNEL_THIRD_PARTY } from './kernel/cadKernelNotices';
import { ToolError } from '@/features/webmcp/siteTools';
import { createCadWorkbenchViewportControls, type CadViewportBindings } from './cadWorkbenchViewport';
import type { CadRenderedViewControls, CadWorkbenchViewportControls } from './cadViewportControls';
import { useCadPanelLayout } from './useCadPanelLayout';
import { CadPatternCommand } from './CadPatternCommand';
import { CAD_PANEL_LIMITS } from './cadPanelLayout';
import { initialCadLoftSketchIds, inspectCadLoftCandidates } from './cadLoftUi';
import { createCadSelectEscapeGuard } from './cadSelectEscape';
import { CadCurveCreationFields } from './CadCurveCreationFields';
import { CadCurveMeasurements } from './CadCurveMeasurements';
import { cadReferenceFeatureIds, prepareCadViewportReferences, selectCadViewportReferences } from './cadViewportReferences';
import { initialCadSweepSourceIds, inspectCadSweepCandidates } from './cadSweepUi';
const NO_MESHES: readonly CadBuildResult['meshes'][number][] = Object.freeze([]);
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
  onRebuild?(): Promise<void>;
  onSectionForCam?(bodyId: string): void;
  onViewportControlsReady?(controls: CadWorkbenchViewportControls | null): void;
  onCaptureViewport?(): Promise<void>;
  onInspectTopology?: CadInspectTopology;
  onResolveSelection?(request: CadTopologyResolvePicksRequest, expectedVersion: string, signal: AbortSignal): Promise<CadTopologyResolvePicksResult>;
}

const featureIcons: Record<CadFeature['kind'], LucideIcon> = {
  sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy,
};

function featureDraft(kind: CadFeature['kind'], document: CadDocument, selected: CadFeature | undefined, bodyIds: readonly string[], plane: CadPlane = 'XY'): CadFeature {
  const id = crypto.randomUUID();
  const sequence = document.features.filter((feature) => feature.kind === kind).length + 1;
  const base = { id, name: `${kind === 'extrude' ? 'Pad' : featureLabels[kind]} ${sequence}`, suppressed: false };
  const sketch = selected?.kind === 'sketch' ? selected : [...document.features].reverse().find((feature) => feature.kind === 'sketch' && !feature.suppressed);
  const body = selected && bodyIds.includes(selected.id) ? selected : [...document.features].reverse().find((feature) => bodyIds.includes(feature.id));
  switch (kind) {
    case 'sketch': return { ...base, kind, plane, offset: 0, profiles: [] };
    case 'curve': return { ...base, kind, plane, offset: 0, segments: [] };
    case 'imported': throw new Error('Use File > Import to add an external solid.');
    case 'extrude': if (!sketch) throw new Error('Create a sketch with a closed profile before adding a Pad.'); return { ...base, kind, sketchId: sketch.id, distance: 10, symmetric: false, operation: 'new', targetId: null };
    case 'pocket': if (!sketch || !body) throw new Error('Through-all Pocket requires a closed sketch and a target body.'); return { ...base, kind, sketchId: sketch.id, targetId: body.id, extent: { kind: 'through-all', direction: 'both' } };
    case 'revolve': if (!sketch) throw new Error('Create a sketch with a closed profile before adding a Revolve.'); return { ...base, kind, sketchId: sketch.id, angle: 360, axis: 'y', operation: 'new', targetId: null };
    case 'loft': return { ...base, kind, sketchIds: initialCadLoftSketchIds(inspectCadLoftCandidates(document), selected?.kind === 'sketch' ? selected.id : undefined), ruled: false, operation: 'new', targetId: null };
    case 'sweep': return { ...base, kind, ...initialCadSweepSourceIds(inspectCadSweepCandidates(document), selected?.id), operation: 'new', targetId: null };
    case 'fillet':
    case 'chamfer': if (!body) throw new Error('Create a solid body first.'); return { ...base, kind, targetId: body.id, radius: 1 };
    case 'shell': throw new Error('Pick one planar face before starting an inward shell.');
    case 'boolean': { const tool = [...document.features].reverse().find((feature) => bodyIds.includes(feature.id) && feature.id !== body?.id); if (!body || !tool) throw new Error('A boolean operation needs two independent solid bodies.'); return { ...base, kind, targetId: body.id, toolId: tool.id, operation: 'union' }; }
    case 'transform': if (!body) throw new Error('Create a solid body first.'); return { ...base, kind, sourceId: body.id, translation: [0, 0, 0], rotation: [0, 0, 0] };
    case 'linear-pattern': if (!body) throw new Error('Create a solid body first.'); return { ...base, kind, sourceId: body.id, count: 2, spacing: [30, 0, 0] };
    case 'circular-pattern': if (!body) throw new Error('Create a solid body first.'); return { ...base, kind, sourceId: body.id, count: 4, axis: 'z', center: [0, 0, 0], angle: 360 };
    case 'mirror': if (!body) throw new Error('Create a solid body first.'); return { ...base, kind, sourceId: body.id, plane: 'YZ' };
  }
}

export function CadWorkbench(props: CadWorkbenchProps) {
  const { document, build, buildState, dirty, canUndo, canRedo, storageBusy = false } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sketchId, setSketchId] = useState<string | null>(null);
  const [curveId, setCurveId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [newFeature, setNewFeature] = useState<CadFeature | null>(null);
  const [tool, setTool] = useState<SketchTool>('select');
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
  const shell = useOptionalAppRail();
  const [headerHost, setHeaderHost] = useState<HTMLDivElement | null>(null);
  const portalHost = useMemo(() => <div className="cad-shell-header" ref={setHeaderHost} />, []);
  const publishHeader = shell?.setHeaderContent;
  // Match the editor's passive header lifetime: all previous editor cleanups run
  // before this publication, so a departing editor cannot erase the CAD header.
  useEffect(() => {
    if (!publishHeader) return;
    publishHeader(portalHost);
    return () => publishHeader(null);
  }, [publishHeader, portalHost]);
  const [pickMode, setPickMode] = useState<CadPickMode>('body');
  const [pickedTopology, setPickedTopology] = useState<CadTopologyPickSet | null>(null);
  const [resolvingTopology, setResolvingTopology] = useState<'fillet' | 'chamfer' | 'shell' | null>(null);
  const topologyResolution = useRef<{ controller: AbortController; source: CadTopologyPickSet } | null>(null);
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
  const pendingOutsideDrawing = editorPending || parameterPending || namePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null;
  const pending = drawingPending || pendingOutsideDrawing;
  const locked = pending || storageBusy;
  const selected = document.features.find((feature) => feature.id === selectedId);
  const sketch = document.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === sketchId);
  const curve = document.features.find((feature): feature is CadCurveFeature => feature.kind === 'curve' && feature.id === curveId);
  const curveCreation = newFeature?.kind === 'curve' ? newFeature : null;
  const canvasReference = curveCreation ?? curve ?? sketch;
  const selectedCurve = selected?.kind === 'curve' ? selected : curve;
  const preparedReferences = useMemo(() => prepareCadViewportReferences(document.features, document.parameters), [document.features, document.parameters]);
  const references = useMemo(() => selectCadViewportReferences(preparedReferences, document.features, selectedId), [preparedReferences, document.features, selectedId]);
  const visibleReferenceIds = useMemo(() => cadReferenceFeatureIds(references), [references]);
  const hasActiveBodyFeatures = document.features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature));
  const displayedMeshes = hasActiveBodyFeatures ? build?.meshes ?? NO_MESHES : NO_MESHES;
  useEffect(() => { if (!hasActiveBodyFeatures) setPickMode('body'); }, [hasActiveBodyFeatures]);
  const selectedSketch = selected?.kind === 'sketch' ? selected : sketch;
  const profile = sketch?.profiles.find((entry) => entry.id === profileId);
  const hasSketch = document.features.some((feature) => feature.kind === 'sketch' && feature.profiles.some((entry) => !entry.construction));
  const visibleBodyIds = cadVisibleBodyIds(document.features);
  const currentBodyIds = buildState === 'ready' ? build?.meshes.map((mesh) => mesh.featureId).filter((id) => visibleBodyIds.includes(id)) ?? [] : [];
  const hasBody = currentBodyIds.length > 0;
  const hasSolid = hasActiveBodyFeatures && buildState === 'ready' && Boolean(displayedMeshes.length);
  const topologyReady = buildState === 'ready' && props.buildVersion === props.documentVersion && Boolean(build);
  const topologySelection = pickedTopology && !canvasReference && topologyReady && pickedTopology.documentVersion === props.documentVersion && pickedTopology.buildId === build?.buildId
    && currentBodyIds.includes(pickedTopology.bodyId) ? pickedTopology : null;
  const inspectorVisible = Boolean(selected || curve || profile || newFeature || resolvingTopology || topologySelection);
  const panels = useCadPanelLayout(inspectorVisible);
  const panelLayout = panels.layout;
  const panelColumns = panelLayout.kind === 'resizable'
    ? `${panelLayout.treeWidth}px ${CAD_PANEL_LIMITS.separatorWidth}px minmax(${CAD_PANEL_LIMITS.canvasMinimum}px, 1fr)${inspectorVisible ? ` ${CAD_PANEL_LIMITS.separatorWidth}px ${panelLayout.propertiesWidth}px` : ''}`
    : undefined;
  const topologySource = useRef({ documentVersion: props.documentVersion, buildId: build?.buildId ?? null, ready: topologyReady });
  topologySource.current = { documentVersion: props.documentVersion, buildId: build?.buildId ?? null, ready: topologyReady };
  useLayoutEffect(() => {
    if (pickedTopology && !topologySelection) setPickedTopology(null);
    const resolving = topologyResolution.current;
    if (resolving && (!topologyReady || resolving.source.documentVersion !== props.documentVersion || resolving.source.buildId !== build?.buildId)) {
      resolving.controller.abort(); topologyResolution.current = null; setResolvingTopology(null);
      setError('The solid changed during selection conversion. Select topology from the current build.');
    }
  }, [props.documentVersion, props.buildVersion, build?.buildId, buildState, sketchId, pickedTopology, topologySelection, topologyReady]);
  useEffect(() => () => topologyResolution.current?.controller.abort(), []);
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
    if (curveId && !document.features.some(feature => feature.kind === 'curve' && feature.id === curveId)) setCurveId(null);
    if (sketchId && !document.features.some((feature) => feature.id === sketchId && feature.kind === 'sketch')) { setSketchId(null); setProfileId(null); }
    else if (profileId && !sketch?.profiles.some((entry) => entry.id === profileId)) setProfileId(null);
  }, [document.id, document.features, selectedId, sketchId, curveId, profileId, sketch]);
  const cancel = useCallback(() => {
    topologyResolution.current?.controller.abort(); topologyResolution.current = null; setResolvingTopology(null);
    setPickedTopology(null);
    setCancelSignal((value) => value + 1); setNewFeature(null); setDrawingPending(false); setEditorPending(false); setParameterPending(false); setDeleteFeature(null); setFileMenu(false); setTool('select'); setError(null);
    setParameterName(''); setParameterValue(''); setNameDraft(document.name); setNamePending(false);
  }, [document.name]);
  const selectEscapeGuard = useMemo(() => createCadSelectEscapeGuard(window.document), []);
  const hotkeys = useRef({ pending, storageBusy, props, cancel, selectEscapeGuard });
  hotkeys.current = { pending, storageBusy, props, cancel, selectEscapeGuard };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      const current = hotkeys.current;
      const modifier = (event.ctrlKey || event.metaKey) && !event.altKey;
      // Save belongs to the app even while an unfinished edit blocks it. Never
      // let this shortcut open the browser's Save Page dialog or commit fields.
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!current.pending && !current.storageBusy) run(current.props.onSave);
        return;
      }
      if (target instanceof HTMLSelectElement && (event.key !== 'Escape' || !current.selectEscapeGuard(target))) return;
      if (event.key === 'Escape') { event.preventDefault(); current.cancel(); return; }
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))) return;
      if (!modifier || !['z', 'y'].includes(event.key.toLowerCase())) return;
      event.preventDefault();
      if (current.pending || current.storageBusy) return;
      if (event.key.toLowerCase() === 'z') { if (event.shiftKey ? current.props.canRedo : current.props.canUndo) run(event.shiftKey ? current.props.onRedo : current.props.onUndo); }
      else if (current.props.canRedo) run(current.props.onRedo);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const startTopologyFeature = async (purpose: 'fillet' | 'chamfer' | 'shell') => {
    const source = topologySelection;
    if (!source || !props.onResolveSelection) throw new Error(purpose === 'shell' ? 'Pick one planar face before starting an inward shell.' : 'Pick edges before starting this operation.');
    validateTopologySelection(source, { documentVersion: props.documentVersion, buildId: build?.buildId ?? null, meshes: build?.meshes ?? [], ready: topologyReady });
    const controller = new AbortController();
    topologyResolution.current = { controller, source }; setResolvingTopology(purpose); props.onWorkflowChange(true);
    try {
      const result = await props.onResolveSelection({ bodyId: source.bodyId, expectedBuildId: source.buildId, purpose, picks: source.picks }, source.documentVersion, controller.signal);
      controller.signal.throwIfAborted();
      const current = topologySource.current;
      if (topologyResolution.current?.controller !== controller || !current.ready || current.documentVersion !== source.documentVersion || current.buildId !== source.buildId
        || result.buildId !== source.buildId || result.bodyId !== source.bodyId || result.purpose !== purpose) throw new Error('The solid changed during selection conversion. Select topology again.');
      const base = { id: crypto.randomUUID(), name: `${featureLabels[purpose]} ${document.features.filter((feature) => feature.kind === purpose).length + 1}`, suppressed: false, targetId: result.bodyId };
      const feature: CadFeature = result.purpose === 'shell' ? { ...base, kind: 'shell', thickness: 1, opening: result.opening }
        : { ...base, kind: result.purpose, radius: 1, selection: result.selection };
      setNewFeature(feature); setSketchId(null); setProfileId(null); setEditorPending(false);
    } catch (cause) {
      if (!controller.signal.aborted && topologyResolution.current?.controller === controller) throw cause;
    } finally {
      if (topologyResolution.current?.controller === controller) { topologyResolution.current = null; setResolvingTopology(null); }
    }
  };
  const startFeature = (kind: CadFeature['kind'], plane?: CadPlane, source?: CadFeature) => run(() => {
    if (kind === 'shell' || (kind === 'fillet' || kind === 'chamfer') && topologySelection?.picks[0]?.kind === 'edge') return startTopologyFeature(kind);
    setNewFeature(featureDraft(kind, document, source ?? selected, currentBodyIds, plane)); setSketchId(null); setCurveId(null); if (kind === 'curve') setTool('path'); setProfileId(null); setEditorPending(false);
  });
  const choose = (id: string | null) => { if (locked) return; setPickedTopology(null); setSelectedId(id); setProfileId(null); if (id !== sketchId) setSketchId(null); if (id !== curveId) setCurveId(null); setTab('model'); setError(null); };
  const editSketch = (feature: CadSketchFeature) => { if (locked) return; setPickedTopology(null); setCurveId(null); setSketchId(feature.id); setSelectedId(feature.id); setProfileId(null); setTool('select'); setTab('model'); };
  const editCurve = (feature: CadCurveFeature) => { if (locked || feature.suppressed) return; setPickedTopology(null); setSketchId(null); setCurveId(feature.id); setSelectedId(feature.id); setProfileId(null); setTool('select'); setTab('model'); };
  const activeSketches = document.features.filter((feature): feature is CadSketchFeature => feature.kind === 'sketch' && !feature.suppressed);
  const hasMaterial = (feature: CadSketchFeature) => feature.profiles.some(profile => !profile.construction);
  const preferredSketch = selected?.kind === 'sketch' && !selected.suppressed ? selected : undefined;
  const profileSketch = preferredSketch && hasMaterial(preferredSketch) ? preferredSketch : [...activeSketches].reverse().find(hasMaterial);
  const emptySketch = preferredSketch ?? activeSketches.at(-1);
  const emptyAction: CadViewportEmptyAction | null = hasActiveBodyFeatures ? null
    : document.features.length === 0 ? { label: 'Create sketch', description: 'Create a sketch on a reference plane', onAction: () => startFeature('sketch') }
    : profileSketch ? { label: 'Pad sketch', description: `Create a solid from ${profileSketch.name}`, onAction: () => startFeature('extrude', undefined, profileSketch) }
    : emptySketch ? { label: 'Open sketch', description: `Open ${emptySketch.name} to draw a profile`, onAction: () => editSketch(emptySketch) }
    : null;
  const selectTopology = (incoming: CadTopologyPickSet | null, additive: boolean) => {
    if (locked) return;
    if (!incoming) { setPickedTopology(null); return; }
    validateTopologySelection(incoming, { documentVersion: props.documentVersion, buildId: build?.buildId ?? null, meshes: build?.meshes ?? [], ready: topologyReady });
    const next = mergeTopologySelection(topologySelection, incoming, additive);
    setPickedTopology(next.picks.length ? next : null); setPickMode(incoming.picks[0].kind); setSelectedId(incoming.bodyId);
    setSketchId(null); setCurveId(null); setProfileId(null); setTab('model'); setError(null);
  };
  const changePickMode = (mode: CadPickMode) => { if (locked) return; if (mode !== pickMode) setPickedTopology(null); setPickMode(mode); };
  const pickTopology = (hit: CadTopologyHit | null, additive: boolean) => run(() => {
    if (!hit) { selectTopology(null, false); return; }
    selectTopology({ documentVersion: props.documentVersion, buildId: build?.buildId ?? '', bodyId: hit.bodyId, picks: [hit.pick] }, additive);
  });
  const selectProfile = (id: string | null) => { if (!editorPending) setProfileId(id); };
  const applyFeature = (feature: CadFeature) => {
    props.onEdit({ kind: newFeature ? 'add-feature' : 'update-feature', feature });
    setPickedTopology(null);
    setNewFeature(null); setEditorPending(false); setSelectedId(feature.id); setError(null);
    if (feature.kind === 'sketch' && !sketch) { setSketchId(feature.id); setTool('rectangle'); }
  };
  const addProfile = (geometry: CadProfile) => {
    if (!sketch) throw new Error('Open a sketch before drawing.');
    const id = crypto.randomUUID();
    const next = { id, name: `${geometry.kind[0].toUpperCase()}${geometry.kind.slice(1)} ${sketch.profiles.length + 1}`, construction, geometry };
    props.onEdit({ kind: 'update-feature', feature: { ...sketch, profiles: [...sketch.profiles, next] } });
    setProfileId(id); setError(null);
  };
  const removeSelected = () => run(() => {
    if (sketch && profile) { props.onEdit({ kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.filter((entry) => entry.id !== profile.id) } }); setProfileId(null); return; }
    if (selected) setDeleteFeature(selected);
  });
  const finishSketch = () => { setSketchId(null); setProfileId(null); setTool('select'); };
  const finishCurve = () => { setCurveId(null); setTool('select'); };
  const addCurve = (segments: readonly CadPathSegment[]) => {
    if (!curveCreation) throw new Error('Start a new Curve before finishing its geometry.');
    props.onEdit({ kind: 'add-feature', feature: { ...curveCreation, segments } });
    setNewFeature(null); setSelectedId(curveCreation.id); setCurveId(curveCreation.id); setSketchId(null); setTool('select'); setDrawingPending(false); setEditorPending(false); setError(null);
  };
  viewportBindings.current = {
    document, documentVersion: props.documentVersion, dirty, selectedFeatureId: selected?.id ?? null, selectedProfileId: profile?.id ?? null,
    sketchId: sketch?.id ?? null, curveId: curve?.id ?? null, workflowOpen: pending, busy: storageBusy, buildVersion: props.buildVersion,
    buildState, visibleBodyIds: currentBodyIds, visibleReferenceIds, rendered: renderedControls.current,
    buildId: topologyReady ? build?.buildId ?? null : null, pickMode, topologySelection, meshes: build?.meshes ?? [],
    selectFeature: choose,
    editSketch: (id) => { const target = document.features.find((feature) => feature.kind === 'sketch' && feature.id === id); if (target?.kind === 'sketch') editSketch(target); },
    editCurve: (id) => { const target = document.features.find((feature) => feature.kind === 'curve' && feature.id === id); if (target?.kind === 'curve') editCurve(target); },
    selectProfile, finishSketch, finishCurve,
    selectTopology, setPickMode: changePickMode,
    updateView: (action) => flushSync(action),
  };
  const deletingIds = new Set(deleteFeature ? [deleteFeature.id] : []);
  for (const feature of document.features) if (cadFeatureDependencies(feature).some((id) => deletingIds.has(id))) deletingIds.add(feature.id);
  const dependentNames = document.features.filter((feature) => deletingIds.has(feature.id) && feature.id !== deleteFeature?.id).map((feature) => feature.name);
  const toolButton = (label: string, Icon: LucideIcon, action: () => void, disabled = false, active = false, hint?: string) => <button className={`cad-tool ${active ? 'is-active' : ''}`} title={hint ?? label} aria-label={label} disabled={disabled || storageBusy} aria-pressed={active} onClick={action}><Icon size={15} strokeWidth={1.5} /><span>{label}</span></button>;

  const header = <div className="cad-header" aria-label="CAD document commands" inert={deleteFeature ? true : undefined}>
      <button className="cad-back" aria-label="Workbench" title="Back to Workbench" onClick={() => run(props.onBack)} disabled={locked}><ArrowLeft size={14} /></button>
      <input className="cad-document-name" aria-label="Part name" value={nameDraft} disabled={drawingPending || editorPending || parameterPending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy} onChange={(event) => { setNameDraft(event.target.value); setNamePending(event.target.value !== document.name); }} onBlur={(event) => { if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute('data-cad-panel-resizer')) return; if (nameDraft !== document.name) run(() => { try { props.onEdit({ kind: 'rename-document', name: nameDraft }); } finally { setNamePending(false); } }); }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNameDraft(document.name); setNamePending(false); } }} />
      <span className={`cad-save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Unsaved' : ''}</span>
      <div className="cad-header-actions">
        <div className="cad-menu-anchor"><button disabled={locked} aria-haspopup="true" aria-expanded={fileMenu} aria-controls="cad-file-menu" onClick={() => setFileMenu(!fileMenu)}>File <ChevronDown size={12} /></button>{fileMenu && <><button className="cad-menu-scrim" aria-label="Close file menu" onClick={() => setFileMenu(false)} /><div className="cad-file-menu" id="cad-file-menu" aria-label="CAD document commands"><button onClick={() => run(props.onNewDocument)}><FilePlus2 size={14} /> New part</button><button onClick={() => run(props.onOpenDocument)}><FolderOpen size={14} /> Open saved part</button><button onClick={() => { setFileMenu(false); fileInput.current?.click(); }}><FolderOpen size={14} /> Import file</button>{props.onCaptureViewport && <button disabled={locked || (!canvasReference && (hasActiveBodyFeatures ? !hasSolid || props.buildVersion !== props.documentVersion : references.length === 0))} onClick={() => run(() => props.onCaptureViewport?.())}><Download size={14} /> Capture view PNG</button>}<span className="cad-menu-rule" />{props.onRebuild && <button disabled={locked} onClick={() => run(() => props.onRebuild?.())}><RotateCw size={14} /> Rebuild model</button>}<button onClick={() => run(props.onExportDocument)}><Download size={14} /> Download CAD document</button><button disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('step'))}><Download size={14} /> Export STEP</button><button disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('stl'))}><Download size={14} /> Export STL</button><button disabled={!selectedCurve && !selectedSketch?.profiles.length} onClick={() => { const reference = selectedCurve ?? selectedSketch; if (reference) run(() => props.onExportDxf(reference.id)); }}><Download size={14} /> {selectedCurve ? 'Export curve DXF' : 'Export sketch DXF'}</button><span className="cad-menu-rule" />{props.onSectionForCam && <button disabled={locked || !sectionBodyId || !hasSolid || props.buildVersion !== props.documentVersion || Boolean(build?.diagnostics.length)} title="Create CAM geometry from a planar section" onClick={() => sectionBodyId && run(() => props.onSectionForCam?.(sectionBodyId))}><Scissors size={14} /> Section for CAM</button>}<button disabled={locked || !selectedSketch?.profiles.some((entry) => !entry.construction)} onClick={() => selectedSketch && run(() => props.onSendToCam(selectedSketch.id))}><ArrowRight size={14} /> Send sketch to CAM</button></div></>}</div>
        <button aria-label="Undo" title="Undo · Ctrl+Z" disabled={!canUndo || locked} onClick={() => run(props.onUndo)}><Undo2 size={15} /></button><button aria-label="Redo" title="Redo · Ctrl+Shift+Z" disabled={!canRedo || locked} onClick={() => run(props.onRedo)}><Redo2 size={15} /></button>
        <button disabled={locked} onClick={() => run(props.onSave)}><Save size={14} /> {storageBusy ? 'Working…' : 'Save'}</button>

      </div>
      <input ref={fileInput} type="file" accept=".wireedm-cad,.json,.step,.stp,.stl,.dxf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) run(() => props.onImportDocument(file)); event.target.value = ''; }} />
    </div>;

  return <main className="cad-workbench" aria-label="Parametric CAD workbench">
    {publishHeader ? headerHost && createPortal(header, headerHost) : header}

    <div className="cad-toolbar" aria-label="CAD tools" inert={deleteFeature ? true : undefined}>
      <div className="cad-tool-group">{toolButton('Sketch', PencilRuler, () => startFeature('sketch'), locked)}{toolButton('Curve', Spline, () => startFeature('curve'), locked)}</div>
      {sketch ? <><div className="cad-tool-group">{toolButton('Select', CornerDownRight, () => setTool('select'), drawingPending || editorPending, tool === 'select')}{toolButton('Rectangle', Square, () => { setTool('rectangle'); setProfileId(null); }, drawingPending || editorPending, tool === 'rectangle')}{toolButton('Circle', Circle, () => { setTool('circle'); setProfileId(null); }, drawingPending || editorPending, tool === 'circle')}{toolButton('Slot', Square, () => { setTool('slot'); setProfileId(null); }, drawingPending || editorPending, tool === 'slot')}{toolButton('Polyline', PencilRuler, () => { setTool('polygon'); setProfileId(null); }, drawingPending || editorPending, tool === 'polygon')}{toolButton('Path', PencilRuler, () => { setTool('path'); setProfileId(null); }, drawingPending || editorPending, tool === 'path', 'Draw a closed path with lines and three-point arcs')}</div><div className="cad-sketch-options"><label><input type="checkbox" checked={construction} disabled={drawingPending || editorPending} onChange={(event) => setConstruction(event.target.checked)} /> Construction</label></div></> : curve || curveCreation ? null : <><div className="cad-tool-group">{toolButton('Pad / Pocket', Box, () => startFeature('extrude'), locked || !hasSketch)}{toolButton('Revolve', RotateCw, () => startFeature('revolve'), locked || !hasSketch)}{toolButton('Loft', Layers, () => startFeature('loft'), locked || document.features.filter(feature => feature.kind === 'sketch' && !feature.suppressed).length < 2, false, 'Loft through ordered sketch sections')}{toolButton('Sweep', Spline, () => startFeature('sweep'), locked || !activeSketches.some(hasMaterial) || !document.features.some(feature => feature.kind === 'curve' && !feature.suppressed), false, 'Sweep a profile along a reference Curve')}</div><div className="cad-tool-group">{toolButton('Fillet', CircleDot, () => startFeature('fillet'), locked || !hasBody)}{toolButton('Chamfer', Scissors, () => startFeature('chamfer'), locked || !hasBody)}{toolButton('Shell', Box, () => startFeature('shell'), locked || !topologyReady || !props.onResolveSelection || topologySelection?.picks[0]?.kind !== 'face')}{toolButton('Boolean', Layers, () => startFeature('boolean'), locked || currentBodyIds.length < 2)}</div><div className="cad-tool-group">{toolButton('Move', Move3D, () => startFeature('transform'), locked || !hasBody)}<CadPatternCommand disabled={locked || !hasBody} onChoose={kind => startFeature(kind)} />{toolButton('Mirror', Copy, () => startFeature('mirror'), locked || !hasBody)}</div></>}
      {curve && !curveCreation && <button className="cad-finish-sketch cad-primary" disabled={locked} onClick={finishCurve}>Finish curve editing</button>}
      {sketch && <button className="cad-finish-sketch cad-primary" disabled={locked} onClick={finishSketch}>Finish sketch</button>}
    </div>
    {(error || props.errorMessage) && <div className="cad-error-banner" role="alert"><span>{error || props.errorMessage}</span><button aria-label="Dismiss local error" onClick={() => setError(null)}><X size={13} /></button></div>}
    <div ref={panels.body} className={`cad-body${inspectorVisible ? '' : ' is-properties-collapsed'}`} style={{ gridTemplateColumns: panelColumns }} inert={deleteFeature ? true : undefined}>
      <aside className="cad-model-panel" data-cad-model-tree aria-label="Feature tree and parameters">
        <div className="cad-panel-tabs"><button aria-pressed={tab === 'model'} disabled={locked} onClick={() => setTab('model')}><Layers size={13} /> Model</button><button aria-pressed={tab === 'parameters'} disabled={locked} onClick={() => setTab('parameters')}><Settings2 size={13} /> Parameters</button></div>
        {tab === 'model' ? <><div className="cad-tree-section">REFERENCE PLANES</div><div className="cad-plane-list">{(['XY', 'XZ', 'YZ'] satisfies CadPlane[]).map((plane) => <button key={plane} disabled={locked} title={`Create sketch on ${plane}`} onClick={() => startFeature('sketch', plane)}><Square size={12} /><span>{plane}</span><Plus size={11} /></button>)}</div><div className="cad-tree-section">FEATURES <span>{document.features.length}</span></div><div className="cad-feature-list">{document.features.map((feature) => {
          const Icon = featureIcons[feature.kind];
          const diagnostic = build?.diagnostics.find((entry) => entry.featureId === feature.id);
          return <div key={feature.id} className="cad-feature-node"><button className={`cad-tree-row ${selectedId === feature.id ? 'is-selected' : ''} ${feature.suppressed ? 'is-suppressed' : ''} ${diagnostic ? 'has-error' : ''}`} disabled={locked} title={diagnostic?.message ?? `${featureLabels[feature.kind]} · ${feature.name}`} onClick={() => choose(feature.id)} onDoubleClick={() => { if (feature.kind === 'sketch') editSketch(feature); else if (feature.kind === 'curve') editCurve(feature); }}><ChevronRight size={11} /><Icon size={14} /><span>{feature.name}</span>{diagnostic && <span className="cad-tree-error">!</span>}{feature.suppressed && <span className="cad-tree-muted">off</span>}</button>{feature.kind === 'sketch' && selectedId === feature.id && feature.profiles.map((entry) => <button key={entry.id} className={`cad-tree-row cad-tree-profile ${entry.id === profileId ? 'is-selected' : ''}`} disabled={locked} title={entry.construction ? 'Construction profile' : 'Closed profile'} onClick={() => { editSketch(feature); setProfileId(entry.id); }}>{entry.geometry.kind === 'circle' ? <Circle size={12} /> : <Square size={12} />}<span>{entry.name}</span></button>)}</div>;
        })}{document.features.length === 0 && <div className="cad-tree-empty">No features yet.<br />Create a sketch to begin.</div>}</div></> : <div className="cad-parameters"><p>Named dimensions are shared by every feature. Expressions use + − × / and parentheses.</p>{Object.entries(document.parameters).map(([name, value]) => <div className="cad-parameter-row" key={name}><button disabled={locked} onClick={() => { setParameterName(name); setParameterValue(String(value)); }}><span>{name}</span><code>{value}</code></button><button disabled={locked} aria-label={`Remove parameter ${name}`} onClick={() => run(() => props.onEdit({ kind: 'remove-parameter', name }))}><X size={12} /></button></div>)}<fieldset className="cad-editor-fieldset" disabled={drawingPending || editorPending || newFeature !== null || resolvingTopology !== null || storageBusy || deleteFeature !== null}><form onSubmit={(event) => { event.preventDefault(); run(() => { props.onEdit({ kind: 'set-parameter', name: parameterName, value: Number(parameterValue) }); setParameterName(''); setParameterValue(''); setParameterPending(false); }); }}><div className="cad-field-section">Add or update parameter</div><label className="cad-field"><span>Name</span><input value={parameterName} placeholder="wallThickness" onChange={(event) => { setParameterName(event.target.value); setParameterPending(true); }} /></label><label className="cad-field"><span>Value</span><input type="number" step="any" value={parameterValue} placeholder="2.5" onChange={(event) => { setParameterValue(event.target.value); setParameterPending(true); }} /></label><button className="cad-primary" disabled={storageBusy || !parameterName.trim() || !parameterValue.trim()}><Plus size={13} /> Set parameter</button>{parameterPending && <button type="button" onClick={() => { setParameterPending(false); setParameterName(''); setParameterValue(''); }}>Cancel</button>}</form></fieldset></div>}
      </aside>
      {panelLayout.kind === 'resizable' && <RailResizeHandle label="Resize CAD model tree" side="left" className="cad-panel-resizer" data-cad-panel-resizer
        width={panelLayout.treeWidth} minWidth={CAD_PANEL_LIMITS.tree.minimum} maxWidth={panelLayout.treeMaximum} onWidthChange={panels.setTreeWidth} />}
      <section className="cad-center" aria-label="Modeling area">{canvasReference ? <CadSketchCanvas key={`${document.id}/${canvasReference.id}`} sketch={canvasReference} parameters={document.parameters} tool={tool} selectedProfileId={profileId} onSelectProfile={canvasReference.kind === 'curve' ? () => undefined : selectProfile} onAddProfile={addProfile} onAddCurve={addCurve} onCancelCurve={cancel} curveCreation={Boolean(curveCreation)} onPendingChange={setDrawingPending} onError={setError} cancelSignal={cancelSignal} interactionLocked={curveCreation ? editorPending || parameterPending || namePending || storageBusy || deleteFeature !== null || resolvingTopology !== null : pendingOutsideDrawing || storageBusy} viewLocked={curveCreation ? drawingPending || storageBusy : locked} onControlsReady={publishRenderedControls} /> : <CadViewport emptyAction={emptyAction} meshes={displayedMeshes} references={references} referenceVersion={props.documentVersion} selectedId={selectedId} onSelect={choose} interactionLocked={locked} onControlsReady={publishRenderedControls} pickMode={pickMode} topologySelection={topologySelection} pickingEnabled={topologyReady} onPickMode={props.onInspectTopology && props.onResolveSelection ? (mode) => run(() => viewportControls.apply({ kind: 'set-pick-mode', mode })) : undefined} onTopologyPick={pickTopology} />}
        {buildState === 'building' && <div className="cad-build-overlay" role="status"><Loader2 size={13} className="cad-spin" /> Building solid geometry…</div>}
        {build?.diagnostics.length ? <div className="cad-diagnostics" role="alert">{build.diagnostics.map((diagnostic, index) => <button key={`${diagnostic.code}-${index}`} disabled={locked} onClick={() => diagnostic.featureId && choose(diagnostic.featureId)}><span>!</span>{diagnostic.featureId ? `${document.features.find((entry) => entry.id === diagnostic.featureId)?.name ?? 'Feature'}: ` : ''}{diagnostic.message}</button>)}</div> : null}
        {document.features.length > 0 && <div className="cad-timeline" aria-label="Feature history"><span className="cad-timeline-label">HISTORY</span>{document.features.map((feature, index) => { const Icon = featureIcons[feature.kind]; return <button key={feature.id} className={selectedId === feature.id ? 'is-selected' : ''} disabled={locked} title={`${index + 1}. ${feature.name}${feature.suppressed ? ' · suppressed' : ''}`} aria-label={`Select ${feature.name} in history`} onClick={() => choose(feature.id)}><Icon size={16} /><small>{index + 1}</small></button>; })}</div>}
      </section>
      {inspectorVisible && <>{panelLayout.kind === 'resizable' && <RailResizeHandle label="Resize CAD properties" side="right" className="cad-panel-resizer" data-cad-panel-resizer
        width={panelLayout.propertiesWidth} minWidth={CAD_PANEL_LIMITS.properties.minimum} maxWidth={panelLayout.propertiesMaximum} onWidthChange={panels.setPropertiesWidth} />}
      <aside className="cad-properties" data-cad-properties aria-label="Feature properties"><div className="cad-panel-heading"><span>{newFeature ? 'NEW FEATURE' : profile ? 'PROFILE' : 'PROPERTIES'}</span>{(selected || profile) && !newFeature && <button aria-label="Delete selected feature or profile" disabled={locked} onClick={removeSelected}><Trash2 size={13} /></button>}</div>
        {resolvingTopology && <div className="cad-topology-resolving" role="status"><Loader2 size={14} className="cad-spin" /><span>Verifying {resolvingTopology === 'shell' ? 'opening face' : 'selected edges'}…</span><button onClick={cancel}>Cancel</button></div>}
        {!newFeature && !sketch && !resolvingTopology && props.onInspectTopology && topologyReady && build && (topologySelection?.bodyId ?? (selected && currentBodyIds.includes(selected.id) ? selected.id : null)) && <CadTopologyInspector key={`${props.documentVersion}-${build.buildId}-${topologySelection?.bodyId ?? selectedId}-${pickMode}`} bodyId={topologySelection?.bodyId ?? selectedId ?? ''} buildId={build.buildId} documentVersion={props.documentVersion} pickMode={pickMode} selection={topologySelection} locked={locked} onInspect={props.onInspectTopology} onSelect={(pick, additive) => pickTopology({ bodyId: topologySelection?.bodyId ?? selectedId ?? '', pick }, additive)} onClear={() => run(() => viewportControls.apply({ kind: 'clear-topology' }))} />}
        <fieldset className="cad-editor-fieldset" disabled={drawingPending && !curveCreation || parameterPending || namePending || storageBusy || resolvingTopology !== null}>{curveCreation ? <CadCurveCreationFields draft={curveCreation} parameters={document.parameters} onChange={setNewFeature} onCancel={cancel} /> : newFeature ? <CadFeatureEditor key={`${newFeature.id}-${cancelSignal}`} feature={newFeature} document={document} isNew currentBodyIds={currentBodyIds} onApply={applyFeature} onCancel={cancel} onPendingChange={setEditorPending} /> : profile && sketch ? <CadProfileEditor key={`${profile.id}-${cancelSignal}`} profile={profile} document={document} onApply={(next) => { props.onEdit({ kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map((entry) => entry.id === next.id ? next : entry) } }); setEditorPending(false); }} onCancel={cancel} onPendingChange={setEditorPending} /> : selected ? <><CadFeatureEditor key={`${selected.id}-${cancelSignal}`} feature={selected} document={document} isNew={false} onApply={applyFeature} onCancel={cancel} onPendingChange={setEditorPending} />{selected.kind === 'curve' && <div className="cad-context-actions">{!curve && <button disabled={locked || selected.suppressed} onClick={() => editCurve(selected)}><Spline size={13} /> Edit curve</button>}<button disabled={locked} onClick={() => run(() => props.onExportDxf(selected.id))}><Download size={13} /> Download DXF</button></div>}{selected.kind === 'sketch' && <div className="cad-context-actions"><button disabled={locked} onClick={() => editSketch(selected)}><PencilRuler size={13} /> Edit sketch</button><button disabled={locked || !selected.profiles.length} onClick={() => run(() => props.onExportDxf(selected.id))}><Download size={13} /> Download DXF</button></div>}<div className="cad-context-actions"><label className="cad-check"><input type="checkbox" disabled={locked} checked={selected.suppressed} onChange={(event) => run(() => props.onEdit({ kind: 'update-feature', feature: { ...selected, suppressed: event.target.checked } }))} /> Suppress feature</label></div>{displayedMeshes.filter((mesh) => mesh.featureId === selected.id).map((mesh) => <div className="cad-solid-info" key={mesh.featureId}><span>Solid volume</span><strong>{mesh.volume.toLocaleString(undefined, { maximumFractionDigits: 3 })} mm³</strong></div>)}</> : null}{selectedCurve && !newFeature && <CadCurveMeasurements curve={selectedCurve} parameters={document.parameters} />}{selectedSketch && !newFeature && <CadSketchMeasurements document={document} sketchId={selectedSketch.id} profileId={profileId} />}</fieldset>
      </aside></>}
    </div>
    <footer className="cad-statusbar" inert={deleteFeature ? true : undefined}><span className={`cad-status-dot ${buildState === 'error' ? 'has-error' : ''}`} /> <span>{canvasReference?.kind === 'curve' ? 'Curve' : sketch ? 'Sketch' : buildState === 'building' ? 'Rebuilding' : buildState === 'error' ? 'Feature needs attention' : 'Ready'}</span><span className="cad-status-selection">{topologySelection ? `${topologySelection.picks.length} ${topologySelection.picks[0].kind}${topologySelection.picks.length === 1 ? '' : 's'} · ${selected?.name ?? 'Body'}` : profile?.name ?? selected?.name ?? 'No selection'}</span><span>{buildState === 'ready' && build ? `${Math.round(build.durationMs)} ms` : ''}</span><a href={CAD_KERNEL_THIRD_PARTY.href} title={CAD_KERNEL_THIRD_PARTY.description} target="_blank" rel="noopener noreferrer">{CAD_KERNEL_THIRD_PARTY.label}</a><span>mm</span><span>{displayedMeshes.length} bodies</span></footer>
    {deleteFeature && <div className="cad-dialog-backdrop"><div ref={deleteDialog} className="cad-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="cad-delete-title"><h2 id="cad-delete-title">Delete {deleteFeature.name}?</h2>{dependentNames.length ? <><p>This also deletes {dependentNames.length} dependent feature{dependentNames.length === 1 ? '' : 's'}.</p><ul>{dependentNames.map((name) => <li key={name}>{name}</li>)}</ul></> : <p>You can restore this feature with Undo.</p>}<div className="cad-form-actions"><button onClick={() => setDeleteFeature(null)}>Cancel</button><button className="cad-danger" onClick={() => run(() => { props.onEdit({ kind: 'delete-feature', featureId: deleteFeature.id, cascade: dependentNames.length > 0 }); setDeleteFeature(null); setSelectedId(null); })}><Trash2 size={13} /> Delete{dependentNames.length ? ' with dependents' : ''}</button></div></div></div>}
  </main>;
}

export default CadWorkbench;
