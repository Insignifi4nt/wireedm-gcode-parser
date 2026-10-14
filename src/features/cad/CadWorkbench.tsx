import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useOptionalAppRail } from '@/app/AppRailContext';
import { ArrowLeft, ArrowRight, Box, Check, ChevronDown, ChevronRight, Circle, Copy, Download, FilePlus2, FolderOpen, Layers, Loader2, MousePointer2, Move3D, PencilRuler, Pill, Plus, Redo2, RotateCw, Ruler, Save, Scissors, Spline, Square, Trash2, Undo2, Waypoints, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CadFeatureTree } from './CadFeatureTree';
import { CadCommandDock } from './CadCommandDock';
import type { CadBuildResult, CadCurveFeature, CadDocument, CadFeature, CadPathSegment, CadPlane, CadSketchPlane, CadProfile, CadSketchFeature, CadSketchProfile } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadTopologyPickSet, CadTopologyResolvePicksRequest, CadTopologyResolvePicksResult } from '@/domain/cad/cadTopology';
import { cadFeatureDependencies, cadFeatureProducesBody, cadVisibleBodyIds } from '@/domain/cad/cadSchema';
import { CadFeatureEditor, CadProfileEditor, featureLabels } from './CadFeatureEditor';
import { CadSketchProfilePanel, type CadSketchProfileCommand } from './CadSketchProfilePanel';
import { cadSketchDimensionQuantities, inspectCadSketchDimensions } from '@/domain/cad/cadSketchConstraints';
import { cadSketchSourceIssue, cadSketchSourceIssueMessage, pickCadSketchSource, type CadSketchSourcePurpose } from '@/domain/cad/cadSketchSources';
import { CadSketchCanvas, type CadSketchContextMenuRequest } from './CadSketchCanvas';
import { CadSketchMeasurements } from './CadSketchMeasurements';
import { CadViewport, type CadViewportContextMenuRequest } from './CadViewport';
import { CadContextMenu, type CadContextMenuItem } from './CadContextMenu';
import { CadTopologyInspector, type CadInspectTopology } from './CadTopologyInspector';
import { mergeTopologySelection, validateTopologySelection, type CadPickMode, type CadTopologyHit } from './cadTopologyPicking';
import type { SketchTool } from './cadSketchInteraction';
import { CAD_KERNEL_THIRD_PARTY } from './kernel/cadKernelNotices';
import { ToolError } from '@/features/webmcp/siteTools';
import { createCadWorkbenchViewportControls, type CadViewportBindings } from './cadWorkbenchViewport';
import type { CadRenderedViewControls, CadWorkbenchViewportControls } from './cadViewportControls';
import { CadPatternCommand } from './CadPatternCommand';
import { CadEdgeTreatmentCommand } from './CadEdgeTreatmentCommand';
import { CadPluginsPanel, type CadPluginCommands } from './CadPluginsPanel';
import { type CadPluginPackage } from '@/domain/cad/plugins/cadPlugins';
import { inspectCadParameters, type CadParameterUsage } from '@/domain/cad/cadParameters';
import { CadParametersPanel } from './CadParametersPanel';
import { initialCadLoftSketchIds, inspectCadLoftCandidates } from './cadLoftUi';
import { createCadSelectEscapeGuard } from './cadSelectEscape';
import { CadCurveCreationFields } from './CadCurveCreationFields';
import { CadCurveMeasurements } from './CadCurveMeasurements';
import { CAD_PRINCIPAL_PLANE_REFERENCES, cadReferenceFeatureIds, cadReferencePlanes, prepareCadViewportReferences, selectCadViewportReferences } from './cadViewportReferences';
import { cadPlacementLabel } from './cadPlacementUi';
import { initialCadSweepSourceIds, inspectCadSweepCandidates } from './cadSweepUi';
import { useCadNotifications, type CadNotificationState } from './useCadNotifications';
import { cadFeatureCandidateEdits, type CadFeaturePreviewCommand, type CadFeaturePreviewState } from './cadFeaturePreview';
import { useCadPreferences } from './cadPreferences';
import type { CadFeatureReferencePickCommand } from './cadFeatureReferencePicking';
import { cadUnobscuredFitArea, type CadFitAreaReader } from './cadFitArea';
const NO_MESHES: readonly CadBuildResult['meshes'][number][] = Object.freeze([]);
type CanvasMenu = { document: CadDocument; version: string; buildId: string | null } & (
  { kind: 'solid'; request: CadViewportContextMenuRequest } |
  { kind: 'sketch'; sketchId: string; request: CadSketchContextMenuRequest });
import './cad-workbench.css';
import './cad-plugins.css';

export interface CadWorkbenchProps extends CadPluginCommands {
  document: CadDocument;
  documentVersion: string;
  buildVersion: string | null;
  build: CadBuildResult | null;
  buildState: 'idle' | 'building' | 'ready' | 'error';
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  errorMessage?: string | null;
  onStatusMessage?: CadNotificationState['onStatusMessage'];
  storageBusy?: boolean;
  externalWorkflowOpen?: boolean;
  onEdit(edit: CadEdit): void;
  onEditMany(edits: readonly CadEdit[]): void;
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
  onOpenDxfExport?(): void;
  onRebuild?(): Promise<void>;
  onSectionForCam?(bodyId: string): void;
  onViewportControlsReady?(controls: CadWorkbenchViewportControls | null): void;
  onCaptureViewport?(): Promise<void>;
  onInspectTopology?: CadInspectTopology;
  onResolveSelection?(request: CadTopologyResolvePicksRequest, expectedVersion: string, signal: AbortSignal): Promise<CadTopologyResolvePicksResult>;
  featurePreview?: CadFeaturePreviewState;
  onFeaturePreview?(command: CadFeaturePreviewCommand): void;
}

function featureDraft(kind: CadFeature['kind'], document: CadDocument, selected: CadFeature | undefined, bodyIds: readonly string[], plane: CadSketchPlane = selected?.kind === 'datum-plane' && !selected.suppressed ? Object.freeze({ kind: 'datum-plane', featureId: selected.id }) : 'XY'): CadFeature {
  const id = crypto.randomUUID();
  const sequence = document.features.filter((feature) => feature.kind === kind).length + 1;
  const base = { id, name: `${kind === 'extrude' ? 'Pad' : featureLabels[kind]} ${sequence}`, suppressed: false };
  const sourceError = (purpose: CadSketchSourcePurpose, fallback: string) => selected?.kind === 'sketch' ? cadSketchSourceIssueMessage(selected, purpose) ?? fallback : fallback;
  const body = selected && bodyIds.includes(selected.id) ? selected : [...document.features].reverse().find((feature) => bodyIds.includes(feature.id));
  switch (kind) {
    case 'datum-plane': return { ...base, kind, definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 0], rotation: [0, 0, 0] } };
    case 'sketch': return { ...base, kind, plane, offset: 0, profiles: [] };
    case 'curve': return { ...base, kind, plane, offset: 0, segments: [] };
    case 'imported': throw new Error('Use File > Import to add an external solid.');
    case 'extrude': {
      const source = pickCadSketchSource({ features: document.features, selectedId: selected?.id ?? null, purpose: kind });
      if (!source) throw new Error(sourceError(kind, 'Create a sketch with closed material contours before adding a Pad.'));
      return { ...base, kind, sketchId: source.id, distance: 10, symmetric: false, operation: 'new', targetId: null };
    }
    case 'pocket': {
      const source = pickCadSketchSource({ features: document.features, selectedId: selected?.id ?? null, purpose: kind });
      if (!source || !body) throw new Error(sourceError(kind, 'Through-all Pocket requires a closed material sketch on XY, XZ or YZ and a target body.'));
      return { ...base, kind, sketchId: source.id, targetId: body.id, extent: { kind: 'through-all', direction: 'both' } };
    }
    case 'revolve': {
      const source = pickCadSketchSource({ features: document.features, selectedId: selected?.id ?? null, purpose: kind });
      if (!source) throw new Error(sourceError(kind, 'Create a sketch with closed material contours before adding a Revolve.'));
      return { ...base, kind, sketchId: source.id, angle: 360, axis: 'y', operation: 'new', targetId: null };
    }
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
  const { document, build, buildState, dirty, canUndo, canRedo, storageBusy = false, externalWorkflowOpen = false } = props;
  const getFitArea = useCallback<CadFitAreaReader>(viewport => {
    // Query current DOM only on Fit: panels never alter canvas layout or camera.
    const overlays = viewport.closest('.cad-workbench')?.querySelectorAll<HTMLElement>('[data-cad-properties], [data-cad-model-tree], [data-cad-command-dock]');
    const bounds = viewport.getBoundingClientRect();
    return cadUnobscuredFitArea({ left: bounds.left, top: bounds.top, width: viewport.clientWidth, height: viewport.clientHeight },
      [...overlays ?? []].filter(overlay => !overlay.hidden).map(overlay => overlay.getBoundingClientRect()));
  }, []);
  const preferences = useCadPreferences();
  const renderedPreferences = useRef({ navigationMode: preferences.navigationMode, onPartDimensionsVisible: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planeSelection, setPlaneSelection] = useState<{ documentId: string; plane: CadPlane } | null>(null);
  const [sketchPlaneRequest, setSketchPlaneRequest] = useState<{ document: CadDocument; version: string } | null>(null);
  const planeRequestOwner = useRef<typeof sketchPlaneRequest>(null);
  const [sketchId, setSketchId] = useState<string | null>(null);
  const [curveId, setCurveId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [newFeature, setNewFeature] = useState<CadFeature | null>(null);
  const [tool, setTool] = useState<SketchTool>('select');
  const [construction, setConstruction] = useState(false);
  const [tab, setTab] = useState<'model' | 'parameters'>('model');
  const [fileMenu, setFileMenu] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useCadNotifications({ document, documentVersion: props.documentVersion, build, buildVersion: props.buildVersion,
    buildState, errorMessage: error || props.errorMessage || null, onStatusMessage: props.onStatusMessage });
  const [drawingPending, setDrawingPending] = useState(false);
  const [editorPending, setEditorPending] = useState(false);
  const [parameterPending, setParameterPending] = useState(false);
  const [dimensionPending, setDimensionPending] = useState(false);
  const [treeMenuOpen, setTreeMenuOpen] = useState(false);
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenu | null>(null);
  const [referencePick, setReferencePick] = useState<{ command: Extract<CadFeatureReferencePickCommand, { kind: 'pick' }>; document: CadDocument; buildId: string | null } | null>(null);
  const pickEnvironment = useRef({ document, buildId: build?.buildId ?? null }); pickEnvironment.current = { document, buildId: build?.buildId ?? null };
  const requestReferencePick = useCallback((command: CadFeatureReferencePickCommand) => {
    setReferencePick(previous => command.kind === 'clear' ? previous?.command.owner === command.owner ? null : previous
      : previous?.command === command ? previous : { command, ...pickEnvironment.current });
  }, []);
  const [cancelSignal, setCancelSignal] = useState(0);
  const [deleteFeature, setDeleteFeature] = useState<CadFeature | null>(null);
  const [inspectedParameter, setInspectedParameter] = useState<string | null>(null);
  const [inspectedInput, setInspectedInput] = useState<{ profileId: string; inputName: string } | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [profilePreview, setProfilePreview] = useState<CadSketchProfile | null>(null);
  const [previewParameters, setPreviewParameters] = useState<CadDocument['parameters'] | null>(null);
  const [nameDraft, setNameDraft] = useState(document.name);
  const [namePending, setNamePending] = useState(false);
  const [treeRenamePending, setTreeRenamePending] = useState(false);
  const [profileCommand, setProfileCommand] = useState<CadSketchProfileCommand | null>(null);
  const profileCommandSequence = useRef(0);
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
  const sourceRenderedControls = useRef<CadRenderedViewControls | null>(null);
  const viewportBindings = useRef<CadViewportBindings | null>(null);
  const publishRenderedControls = useCallback((controls: CadRenderedViewControls | null, released?: CadRenderedViewControls) => {
    if (controls) {
      sourceRenderedControls.current = controls;
      renderedControls.current = { ...controls, getState: () => {
        const state = controls.getState();
        return Object.freeze({ ...state, navigationMode: renderedPreferences.current.navigationMode,
          onPartDimensionsVisible: state.mode === 'sketch' && renderedPreferences.current.onPartDimensionsVisible });
      } };
    } else if (!released || sourceRenderedControls.current === released) { sourceRenderedControls.current = null; renderedControls.current = null; }
  }, []);
  const viewportControls = useMemo(() => createCadWorkbenchViewportControls(() => {
    const bindings = viewportBindings.current;
    if (!bindings) throw new ToolError('VIEW_UNAVAILABLE', 'Wait for the CAD workspace to load.');
    return { ...bindings, rendered: renderedControls.current };
  }), []);
  const referencePickBlocked = drawingPending || pluginsOpen || parameterPending || dimensionPending || namePending || treeRenamePending || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || storageBusy || externalWorkflowOpen;
  const currentReferencePick = !referencePickBlocked && referencePick?.document === document && referencePick.command.expectedVersion === props.documentVersion && referencePick.buildId === (build?.buildId ?? null) ? referencePick.command : null;
  const currentSketchPlaneRequest = !referencePickBlocked && !editorPending && !newFeature && !currentReferencePick
    && sketchPlaneRequest?.document === document && sketchPlaneRequest.version === props.documentVersion ? sketchPlaneRequest : null;
  planeRequestOwner.current = currentSketchPlaneRequest;
  useLayoutEffect(() => { if (sketchPlaneRequest && !currentSketchPlaneRequest) setSketchPlaneRequest(null); }, [sketchPlaneRequest, currentSketchPlaneRequest]);
  useLayoutEffect(() => { if (referencePick && !currentReferencePick) { referencePick.command.onCancel(); setReferencePick(null); } }, [referencePick, currentReferencePick]);
  const canvasMenuBlocked = drawingPending || pluginsOpen || editorPending || parameterPending || dimensionPending || namePending || treeRenamePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || storageBusy || externalWorkflowOpen || Boolean(currentReferencePick);
  const currentCanvasMenu = !canvasMenuBlocked && canvasMenu?.document === document && canvasMenu.version === props.documentVersion && canvasMenu.buildId === (build?.buildId ?? null) ? canvasMenu : null;
  useLayoutEffect(() => { if (canvasMenu && !currentCanvasMenu) setCanvasMenu(null); }, [canvasMenu, currentCanvasMenu]);
  const pendingOutsideDrawing = pluginsOpen || editorPending || parameterPending || dimensionPending || namePending || treeRenamePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || Boolean(currentCanvasMenu) || Boolean(currentReferencePick) || Boolean(currentSketchPlaneRequest);
  const pending = drawingPending || pendingOutsideDrawing;
  const locked = pending || storageBusy || externalWorkflowOpen;
  const interactionState = useRef({ locked }); interactionState.current = { locked };
  const treeLocked = currentReferencePick || currentSketchPlaneRequest ? false : drawingPending || pluginsOpen || editorPending || parameterPending || dimensionPending || namePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy || externalWorkflowOpen || Boolean(currentCanvasMenu);
  const navigationLocked = drawingPending || pluginsOpen || treeRenamePending || externalWorkflowOpen || storageBusy || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || Boolean(currentCanvasMenu);
  const previewEnabled = !pluginsOpen && !treeRenamePending && !externalWorkflowOpen && !storageBusy && !treeMenuOpen && !currentCanvasMenu && !currentReferencePick;
  const selected = document.features.find((feature) => feature.id === selectedId);
  const selectedReferencePlane = useMemo<CadSketchPlane | null>(() => selected?.kind === 'datum-plane' && !selected.suppressed
    ? Object.freeze({ kind: 'datum-plane', featureId: selected.id }) : !selected && planeSelection?.documentId === document.id ? planeSelection.plane : null, [selected, planeSelection, document.id]);
  const principalPlanesVisible = typeof selectedReferencePlane === 'string';
  const sketch = document.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === sketchId);
  const curve = document.features.find((feature): feature is CadCurveFeature => feature.kind === 'curve' && feature.id === curveId);
  const curveCreation = newFeature?.kind === 'curve' ? newFeature : null;
  const canvasReference = curveCreation ?? curve ?? sketch;
  const selectedCurve = selected?.kind === 'curve' ? selected : curve;
  const ownedPreview = props.featurePreview && props.featurePreview.kind !== 'idle' && props.featurePreview.baseVersion === props.documentVersion
    && (editorPending || newFeature !== null) && props.featurePreview.featureId === (newFeature?.id ?? selectedId) ? props.featurePreview : null;
  const candidatePreview = currentReferencePick ? null : ownedPreview?.kind === 'ready' ? ownedPreview : ownedPreview?.lastValid ?? null;
  const displayedDocument = candidatePreview?.document ?? document;
  const displayedBuild = candidatePreview?.result ?? build;
  const preparedReferences = useMemo(() => prepareCadViewportReferences(displayedDocument.features, displayedDocument.parameters), [displayedDocument.features, displayedDocument.parameters]);
  const references = useMemo(() => currentReferencePick ? preparedReferences.filter(reference => reference.featureId !== null && currentReferencePick.eligibleIds.includes(reference.featureId))
    : currentSketchPlaneRequest ? [...CAD_PRINCIPAL_PLANE_REFERENCES, ...preparedReferences.filter(reference => reference.featureKind === 'datum-plane')]
      : [...(principalPlanesVisible ? CAD_PRINCIPAL_PLANE_REFERENCES : []), ...selectCadViewportReferences(preparedReferences, displayedDocument.features, selectedId)],
    [preparedReferences, displayedDocument.features, selectedId, currentReferencePick, currentSketchPlaneRequest, principalPlanesVisible]);
  const visibleReferenceIds = useMemo(() => cadReferenceFeatureIds(references), [references]);
  const visibleReferencePlanes = useMemo(() => cadReferencePlanes(references), [references]);
  const hasActiveBodyFeatures = document.features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature));
  const displayedMeshes = displayedDocument.features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature)) ? displayedBuild?.meshes ?? NO_MESHES : NO_MESHES;
  useEffect(() => { if (!hasActiveBodyFeatures) setPickMode('body'); }, [hasActiveBodyFeatures]);
  const selectedSketch = selected?.kind === 'sketch' ? selected : sketch;
  const profile = sketch?.profiles.find((entry) => entry.id === profileId);
  const measurementDocument = useMemo(() => !profilePreview && !previewParameters ? document : { ...document, parameters: previewParameters ?? document.parameters,
    features: document.features.map(feature => feature.kind === 'sketch' && feature.id === sketch?.id && profilePreview ? { ...feature, profiles: feature.profiles.map(entry => entry.id === profilePreview.id ? profilePreview : entry) } : feature) }, [document, sketch?.id, profilePreview, previewParameters]);
  const dimensionGeometry = profile?.geometry;
  renderedPreferences.current = { navigationMode: preferences.navigationMode, onPartDimensionsVisible: preferences.showOnPartDimensions
    && tool === 'select' && !profilePreview && Boolean(profile && (inspectCadSketchDimensions(profile, document.parameters).length || dimensionGeometry?.kind === 'plugin' && dimensionGeometry.package.id === 'wireedm.spur-gear')) };
  const parameterInspection = useMemo(() => inspectCadParameters(document), [document]);
  const parameterUsages = parameterInspection.parameters.find(parameter => parameter.name === inspectedParameter)?.usages.filter(usage => usage.active) ?? [];
  const highlightedProfiles = parameterUsages.filter(usage => usage.featureId === sketch?.id && usage.profileId).map(usage => usage.profileId).filter((id): id is string => typeof id === 'string');
  const gearUsage = parameterUsages.find(usage => usage.featureId === sketch?.id && usage.inputName && usage.profileId);
  const sketchInspection = inspectedParameter ? { profileIds: [...new Set(highlightedProfiles)],
    ...(gearUsage?.profileId && gearUsage.inputName ? { gear: { profileId: gearUsage.profileId, inputName: gearUsage.inputName } } : {}) }
    : inspectedInput && profile?.id === inspectedInput.profileId ? { profileIds: [profile.id], gear: inspectedInput } : undefined;
  const inspectInput = useCallback((name: string | null) => { setInspectedInput(name && profileId ? { profileId, inputName: name } : null); if (name) setInspectedParameter(null); }, [profileId]);
  useEffect(() => { setProfilePreview(null); setPreviewParameters(null); setInspectorCollapsed(false); }, [selectedId, sketchId, profileId]);
  const hasSketch = document.features.some((feature) => feature.kind === 'sketch' && cadSketchSourceIssue(feature, 'extrude') === null);
  const visibleBodyIds = cadVisibleBodyIds(document.features);
  const currentBodyIds = buildState === 'ready' ? build?.meshes.map((mesh) => mesh.featureId).filter((id) => visibleBodyIds.includes(id)) ?? [] : [];
  const hasBody = currentBodyIds.length > 0;
  const hasSolid = hasActiveBodyFeatures && buildState === 'ready' && Boolean(displayedMeshes.length);
  const topologyReady = buildState === 'ready' && props.buildVersion === props.documentVersion && Boolean(build);
  const topologySelection = pickedTopology && !canvasReference && topologyReady && pickedTopology.documentVersion === props.documentVersion && pickedTopology.buildId === build?.buildId
    && currentBodyIds.includes(pickedTopology.bodyId) ? pickedTopology : null;
  const inspectorVisible = Boolean(selected || sketch || curve || profile || newFeature || resolvingTopology || topologySelection);
  const floatingPluginInspector = profile?.geometry.kind === 'plugin';

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
    planeRequestOwner.current = null; setSketchPlaneRequest(null);
    setCanvasMenu(null);
    topologyResolution.current?.controller.abort(); topologyResolution.current = null; setResolvingTopology(null);
    setPickedTopology(null);
    setCancelSignal((value) => value + 1); setNewFeature(null); setDrawingPending(false); setEditorPending(false); setParameterPending(false); setDimensionPending(false); setTreeRenamePending(false); setDeleteFeature(null); setFileMenu(false); setTool('select'); setError(null);
    setInspectedParameter(null); setInspectedInput(null); setProfilePreview(null); setPreviewParameters(null); setProfileCommand(null); setNameDraft(document.name); setNamePending(false);
  }, [document.name]);
  const selectEscapeGuard = useMemo(() => createCadSelectEscapeGuard(window.document), []);
  const hotkeys = useRef({ pending, storageBusy, props, cancel, selectEscapeGuard, referencePick: currentReferencePick });
  hotkeys.current = { pending, storageBusy: storageBusy || externalWorkflowOpen, props, cancel, selectEscapeGuard, referencePick: currentReferencePick };
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
      if (event.key === 'Escape') { event.preventDefault(); if (current.referencePick) current.referencePick.onCancel(); else current.cancel(); return; }
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
  const startTopologyFeature = async (purpose: 'fillet' | 'chamfer' | 'shell', explicitSelection?: CadTopologyPickSet) => {
    const source = explicitSelection ?? topologySelection;
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
    if (kind === 'shell' || !source && (kind === 'fillet' || kind === 'chamfer') && topologySelection?.picks[0]?.kind === 'edge') return startTopologyFeature(kind);
    setNewFeature(featureDraft(kind, document, source ?? selected, currentBodyIds, plane)); setSketchId(null); setCurveId(null); if (kind === 'curve') setTool('path'); setProfileId(null); setEditorPending(false);
  });
  const createSketchOnPlane = (plane: CadSketchPlane) => {
    if (typeof plane !== 'string' && !document.features.some(feature => feature.id === plane.featureId && feature.kind === 'datum-plane' && !feature.suppressed)) return;
    const feature = featureDraft('sketch', document, undefined, currentBodyIds, plane);
    props.onEdit({ kind: 'add-feature', feature });
    setPlaneSelection(null); setPickedTopology(null); setSelectedId(feature.id); setSketchId(feature.id); setCurveId(null); setProfileId(null); setTool('rectangle'); setError(null);
  };
  const pickSketchPlane = (plane: CadSketchPlane) => {
    const owner = currentSketchPlaneRequest;
    if (!owner || planeRequestOwner.current !== owner) return;
    if (typeof plane !== 'string' && !document.features.some(feature => feature.id === plane.featureId && feature.kind === 'datum-plane' && !feature.suppressed)) return;
    // Consume synchronously before the edit: duplicate pointer releases and old
    // callbacks cannot insert a second sketch into the accepted revision.
    planeRequestOwner.current = null; setSketchPlaneRequest(null);
    run(() => createSketchOnPlane(plane));
  };
  const startSketch = () => {
    if (interactionState.current.locked) return;
    if (selectedReferencePlane) { run(() => createSketchOnPlane(selectedReferencePlane)); return; }
    setSelectedId(null); setProfileId(null); setPlaneSelection(null); setSketchPlaneRequest({ document, version: props.documentVersion }); setPickedTopology(null); setError(null);
  };
  const choose = (id: string | null) => { if (currentReferencePick) { if (id && currentReferencePick.eligibleIds.includes(id)) currentReferencePick.onSelect(id); return; }
    if (currentSketchPlaneRequest) { const target = document.features.find(feature => feature.id === id && feature.kind === 'datum-plane' && !feature.suppressed); if (target) pickSketchPlane({ kind: 'datum-plane', featureId: target.id }); return; }
    if (interactionState.current.locked) return; setPlaneSelection(null); setPickedTopology(null); setSelectedId(id); setProfileId(null); if (id !== sketchId) setSketchId(null); if (id !== curveId) setCurveId(null); setError(null); };
  const selectReferencePlane = (plane: CadSketchPlane | null) => {
    if (currentSketchPlaneRequest) { if (plane) pickSketchPlane(plane); return; }
    if (interactionState.current.locked) return;
    if (typeof plane === 'object' && plane !== null) { const target = document.features.find(feature => feature.id === plane.featureId && feature.kind === 'datum-plane' && !feature.suppressed); if (target) choose(target.id); return; }
    choose(null); setPlaneSelection(plane ? { documentId: document.id, plane } : null);
  };
  const editSketch = (feature: CadSketchFeature) => { if (interactionState.current.locked) return; setPickedTopology(null); setCurveId(null); setSketchId(feature.id); setSelectedId(feature.id); setProfileId(null); setTool('select');  };
  const editCurve = (feature: CadCurveFeature) => { if (interactionState.current.locked || feature.suppressed) return; setPickedTopology(null); setSketchId(null); setCurveId(feature.id); setSelectedId(feature.id); setProfileId(null); setTool('select');  };
  const openSolidMenu = (request: CadViewportContextMenuRequest) => {
    if (interactionState.current.locked || !request.target) return;
    if (request.target.kind === 'topology') {
      try { validateTopologySelection({ documentVersion: props.documentVersion, buildId: build?.buildId ?? '', bodyId: request.target.hit.bodyId, picks: [request.target.hit.pick] },
        { documentVersion: props.documentVersion, buildId: build?.buildId ?? null, meshes: build?.meshes ?? [], ready: topologyReady }); }
      catch { return; }
    } else {
      const featureId = request.target.featureId;
      if (!document.features.some(feature => feature.id === featureId && !feature.suppressed)) return;
    }
    setCanvasMenu({ kind: 'solid', document, version: props.documentVersion, buildId: build?.buildId ?? null, request });
  };
  const openSketchMenu = (request: CadSketchContextMenuRequest) => {
    if (interactionState.current.locked || !sketch || !request.profileId || !sketch.profiles.some(profile => profile.id === request.profileId)) return;
    setCanvasMenu({ kind: 'sketch', document, version: props.documentVersion, buildId: build?.buildId ?? null, sketchId: sketch.id, request });
  };
  const canvasMenuItems: CadContextMenuItem[] = [];
  let canvasMenuTitle = 'Model';
  if (currentCanvasMenu?.kind === 'solid') {
    const target = currentCanvasMenu.request.target;
    const id = target?.kind === 'topology' ? target.hit.bodyId : target?.kind === 'feature' ? target.featureId : null;
    const feature = document.features.find(feature => feature.id === id);
    if (feature) {
      canvasMenuTitle = feature.name;
      canvasMenuItems.push({ label: 'Configure feature', onSelect: () => choose(feature.id) });
      if (feature.kind === 'sketch') canvasMenuItems.push({ label: 'Edit sketch', onSelect: () => editSketch(feature) },
        { label: 'Pad sketch', disabled: cadSketchSourceIssue(feature, 'extrude') !== null, onSelect: () => startFeature('extrude', undefined, feature) },
        { label: 'Revolve sketch', disabled: cadSketchSourceIssue(feature, 'revolve') !== null, onSelect: () => startFeature('revolve', undefined, feature) });
      else if (feature.kind === 'curve') canvasMenuItems.push({ label: 'Edit curve', onSelect: () => editCurve(feature) });
      if (currentBodyIds.includes(feature.id)) {
        if (target?.kind === 'topology' && props.onResolveSelection) {
          const picks: CadTopologyPickSet = { bodyId: feature.id, buildId: build?.buildId ?? '', documentVersion: props.documentVersion, picks: [target.hit.pick] };
          if (target.hit.pick.kind === 'face') canvasMenuItems.push({ label: 'Shell from face', onSelect: () => run(() => startTopologyFeature('shell', picks)) });
          else for (const kind of ['fillet', 'chamfer'] as const) canvasMenuItems.push({ label: `${featureLabels[kind]} selected edge`, onSelect: () => run(() => startTopologyFeature(kind, picks)) });
        }
        canvasMenuItems.push({ kind: 'separator' }, ...(['transform', 'linear-pattern', 'circular-pattern', 'mirror'] as const).map(kind => ({ label: featureLabels[kind], onSelect: () => startFeature(kind, undefined, feature) })));
        if (props.onSectionForCam) canvasMenuItems.push({ label: 'Section for CAM', onSelect: () => run(() => props.onSectionForCam?.(feature.id)) });
      }
      canvasMenuItems.push({ kind: 'separator' }, { label: 'Suppress feature', onSelect: () => run(() => props.onEdit({ kind: 'update-feature', feature: { ...feature, suppressed: true } })) },
        { label: 'Delete feature', danger: true, onSelect: () => { setSelectedId(feature.id); setProfileId(null); setDeleteFeature(feature); } });
    }
  } else if (currentCanvasMenu?.kind === 'sketch') {
    const source = document.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === currentCanvasMenu.sketchId);
    const target = source?.profiles.find(profile => profile.id === currentCanvasMenu.request.profileId);
    if (source && target) {
      canvasMenuTitle = target.name;
      canvasMenuItems.push({ label: 'Configure profile', onSelect: () => { editSketch(source); setProfileId(target.id); setInspectorCollapsed(false); } },
        { label: 'Toggle construction', onSelect: () => run(() => props.onEdit({ kind: 'update-feature', feature: { ...source, profiles: source.profiles.map(profile => profile.id === target.id ? { ...profile, construction: !profile.construction } : profile) } })) },
        { kind: 'separator' }, { label: 'Delete profile', danger: true, onSelect: () => run(() => { props.onEdit({ kind: 'update-feature', feature: { ...source, profiles: source.profiles.filter(profile => profile.id !== target.id) } }); if (profileId === target.id) setProfileId(null); }) });
    }
  }
  const activeSketches = document.features.filter((feature): feature is CadSketchFeature => feature.kind === 'sketch' && !feature.suppressed);
  const hasMaterial = (feature: CadSketchFeature) => feature.profiles.some(profile => !profile.construction);
  const selectTopology = (incoming: CadTopologyPickSet | null, additive: boolean) => {
    if (locked) return;
    if (!incoming) { setPickedTopology(null); return; }
    validateTopologySelection(incoming, { documentVersion: props.documentVersion, buildId: build?.buildId ?? null, meshes: build?.meshes ?? [], ready: topologyReady });
    const next = mergeTopologySelection(topologySelection, incoming, additive);
    setPickedTopology(next.picks.length ? next : null); setPickMode(incoming.picks[0].kind); setSelectedId(incoming.bodyId);
    setSketchId(null); setCurveId(null); setProfileId(null);  setError(null);
  };
  const changePickMode = (mode: CadPickMode) => { if (locked) return; if (mode !== pickMode) setPickedTopology(null); setPickMode(mode); };
  const pickTopology = (hit: CadTopologyHit | null, additive: boolean) => run(() => {
    if (!hit) { selectTopology(null, false); return; }
    selectTopology({ documentVersion: props.documentVersion, buildId: build?.buildId ?? '', bodyId: hit.bodyId, picks: [hit.pick] }, additive);
  });
  const selectProfile = (id: string | null) => { if (!editorPending && !treeRenamePending) { setProfileId(id); setProfileCommand(null); } };
  const applyFeature = (feature: CadFeature, parameters: Readonly<Record<string, number>>) => {
    props.onEditMany(cadFeatureCandidateEdits({ feature, isNew: Boolean(newFeature), parameters }));
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
  const addPlugin = (plugin: CadPluginPackage) => run(() => {
    const target = sketch ?? selectedSketch ?? featureDraft('sketch', document, selected, currentBodyIds);
    if (target.kind !== 'sketch') throw new Error('Plugin profiles require a sketch.');
    const id = crypto.randomUUID();
    const edits: CadEdit[] = document.features.some(feature => feature.id === target.id) ? [] : [{ kind: 'add-feature', feature: target }];
    edits.push({ kind: 'add-plugin-profile', sketchId: target.id, profileId: id, name: plugin.name, package: plugin, groupId: `pg_${crypto.randomUUID()}` });
    props.onEditMany(edits);
    setPluginsOpen(false); setSketchId(target.id); setSelectedId(target.id); setProfileId(id); setTool('select');
  });
  const inspectParameterUsage = (usage: Pick<CadParameterUsage, 'featureId' | 'profileId' | 'inputName'>) => {
    const feature = document.features.find(feature => feature.id === usage.featureId);
    if (!feature || feature.suppressed) return;
    setSelectedId(feature.id); setCurveId(null); setPickedTopology(null);
    setInspectedInput(usage.profileId && usage.inputName ? { profileId: usage.profileId, inputName: usage.inputName } : null);
    if (feature.kind === 'sketch') { setSketchId(feature.id); setProfileId(usage.profileId ?? null); setTool('select'); }
    else { setSketchId(null); setProfileId(null); if (feature.kind === 'curve') setCurveId(feature.id); }
  };
  const inspectParameter = (name: string | null) => {
    setInspectedParameter(name); setInspectedInput(null);
    if (!name) return;
    const usages = parameterInspection.parameters.find(parameter => parameter.name === name)?.usages.filter(usage => usage.active) ?? [];
    const usage = usages.find(usage => usage.featureId === sketchId) ?? usages[0];
    if (usage) inspectParameterUsage(usage);
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
    sketchId: sketch?.id ?? null, curveId: curve?.id ?? null, selectedReferencePlane, awaitingSketchPlane: Boolean(currentSketchPlaneRequest), workflowOpen: pending || externalWorkflowOpen, busy: storageBusy, buildVersion: props.buildVersion,
    buildState, visibleBodyIds: currentBodyIds, visibleReferenceIds, visibleReferencePlanes, rendered: renderedControls.current,
    buildId: topologyReady ? build?.buildId ?? null : null, pickMode, topologySelection, meshes: build?.meshes ?? [],
    selectFeature: choose, selectReferencePlane,
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
  const beginProfileCommand = (kind: CadSketchProfileCommand['kind']) => {
    if (locked || !profile || profile.geometry.kind === 'plugin') return;
    setTool('select'); setInspectorCollapsed(false); setProfileCommand({ token: ++profileCommandSequence.current, documentId: document.id, profileId: profile.id, kind });
  };
  const exactProfileEditor = profile && sketch ? <CadProfileEditor key={`${profile.id}-${cancelSignal}`} profile={profile} document={document} onInspectInput={inspectInput} onPreviewProfile={setProfilePreview} onPreviewParameters={setPreviewParameters} onApply={(next, parameters) => {
    props.onEditMany([...Object.entries(parameters).map(([name, value]): CadEdit => ({ kind: 'set-parameter', name, value })), { kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map(entry => entry.id === next.id ? next : entry) } }]); setEditorPending(false);
  }} onCancel={cancel} onPendingChange={setEditorPending} /> : null;
  const selectedProfileEditor = profile && sketch && profile.geometry.kind !== 'plugin' ? <CadSketchProfilePanel key={`${profile.id}-${cancelSignal}`} document={document} sketch={sketch} profile={profile} command={profileCommand} onCommandConsumed={token => setProfileCommand(current => current?.token === token ? null : current)} otherEditorPending={editorPending} onEditMany={props.onEditMany} onPendingChange={setEditorPending} onPreviewProfile={setProfilePreview} onPreviewParameters={setPreviewParameters} interactionLocked={drawingPending || parameterPending || dimensionPending || namePending || treeRenamePending || storageBusy || resolvingTopology !== null || externalWorkflowOpen || pluginsOpen} cancelSignal={cancelSignal} exactGeometryEditor={profile.geometry.kind === 'polygon' || profile.geometry.kind === 'path' ? exactProfileEditor : undefined} /> : exactProfileEditor;
  const sketchDimensionAvailable = profile && cadSketchDimensionQuantities(profile.geometry).some(quantity => !inspectCadSketchDimensions(profile, document.parameters).some(dimension => dimension.field === (quantity === 'diameter' ? 'radius' : quantity)));
  const parameterContent = <CadParametersPanel key={`parameters-${externalWorkflowOpen}-${pluginsOpen}`} document={document} onEditMany={props.onEditMany} onInspectParameter={inspectParameter} onInspectUsage={inspectParameterUsage} onPendingChange={setParameterPending} interactionLocked={drawingPending || editorPending || dimensionPending || namePending || treeRenamePending || newFeature !== null || resolvingTopology !== null || storageBusy || deleteFeature !== null || externalWorkflowOpen || pluginsOpen || Boolean(currentSketchPlaneRequest || currentReferencePick)} cancelSignal={cancelSignal} />;
  const specificationTree = <CadFeatureTree parameterContent={parameterContent} selectionOnly={Boolean(currentReferencePick || currentSketchPlaneRequest)} allowPrincipalPlaneSelection={Boolean(currentSketchPlaneRequest)} selectableFeatureIds={currentReferencePick?.eligibleIds ?? (currentSketchPlaneRequest ? document.features.filter(feature => feature.kind === 'datum-plane' && !feature.suppressed).map(feature => feature.id) : undefined)} document={document} diagnostics={build?.diagnostics} selectedId={selectedId} selectedProfileId={profileId} locked={treeLocked} onRenamePendingChange={setTreeRenamePending} cancelSignal={cancelSignal} selectedReferencePlane={typeof selectedReferencePlane === 'string' ? selectedReferencePlane : null} onSelectReferencePlane={selectReferencePlane} onCreateSketch={plane => { if (!interactionState.current.locked) run(() => createSketchOnPlane(plane)); }} onRename={(feature, name, renamedProfileId) => {
    if (document.features.find(entry => entry.id === feature.id) !== feature) throw new Error('The part changed. Cancel and reopen the rename editor.');
    props.onEdit({ kind: 'update-feature', feature: renamedProfileId && feature.kind === 'sketch' ? { ...feature, profiles: feature.profiles.map(entry => entry.id === renamedProfileId ? { ...entry, name } : entry) } : { ...feature, name } });
  }} onContextMenuOpenChange={setTreeMenuOpen} onSuppress={(feature, suppressed) => run(() => props.onEdit({ kind: 'update-feature', feature: { ...feature, suppressed } }))} onDelete={feature => { setSelectedId(feature.id); setProfileId(null); setDeleteFeature(feature); }} onUpdateProfile={(source, next) => run(() => props.onEdit({ kind: 'update-feature', feature: { ...source, profiles: source.profiles.map(entry => entry.id === next.id ? next : entry) } }))} onDeleteProfile={(source, id) => run(() => { props.onEdit({ kind: 'update-feature', feature: { ...source, profiles: source.profiles.filter(entry => entry.id !== id) } }); if (profileId === id) setProfileId(null); })} highlightedFeatureIds={parameterUsages.map(usage => usage.featureId)} onSelect={choose} onEditSketch={editSketch} onEditCurve={editCurve} onSelectProfile={(feature, id) => { editSketch(feature); setProfileId(id); setProfileCommand(null); }} />;

  const header = <div className="cad-header" aria-label="CAD document commands" inert={deleteFeature || pluginsOpen || externalWorkflowOpen || currentCanvasMenu || treeMenuOpen ? true : undefined}>
      <button className="cad-back" aria-label="Workbench" title="Back to Workbench" onClick={() => run(props.onBack)} disabled={locked}><ArrowLeft size={14} /></button>
      <input className="cad-document-name" aria-label="Part name" value={nameDraft} disabled={drawingPending || editorPending || parameterPending || dimensionPending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy || Boolean(currentSketchPlaneRequest || currentReferencePick)} onChange={(event) => { setNameDraft(event.target.value); setNamePending(event.target.value !== document.name); }} onBlur={(event) => { if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute('data-cad-panel-resizer')) return; if (nameDraft !== document.name) run(() => { try { props.onEdit({ kind: 'rename-document', name: nameDraft }); } finally { setNamePending(false); } }); }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNameDraft(document.name); setNamePending(false); } }} />
      <span className={`cad-save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Unsaved' : ''}</span>
      {buildState === 'error' && <span className="cad-header-build-state" role="status">Feature needs attention</span>}
      <div className="cad-header-actions">
        <div className="cad-menu-anchor"><button disabled={locked} aria-haspopup="true" aria-expanded={fileMenu} aria-controls="cad-file-menu" onClick={() => setFileMenu(!fileMenu)}>File <ChevronDown size={12} /></button>{fileMenu && <><button className="cad-menu-scrim" aria-label="Close file menu" onClick={() => setFileMenu(false)} /><div className="cad-file-menu" id="cad-file-menu" aria-label="CAD document commands"><button onClick={() => run(props.onNewDocument)}><FilePlus2 size={14} /> New part</button><button onClick={() => run(props.onOpenDocument)}><FolderOpen size={14} /> Open saved part</button><button onClick={() => { setFileMenu(false); fileInput.current?.click(); }}><FolderOpen size={14} /> Import file</button>{props.onCaptureViewport && <button disabled={locked || (!canvasReference && (hasActiveBodyFeatures ? !hasSolid || props.buildVersion !== props.documentVersion : references.length === 0))} onClick={() => run(() => props.onCaptureViewport?.())}><Download size={14} /> Capture view PNG</button>}<span className="cad-menu-rule" />{props.onRebuild && <button disabled={locked} onClick={() => run(() => props.onRebuild?.())}><RotateCw size={14} /> Rebuild model</button>}<button onClick={() => run(props.onExportDocument)}><Download size={14} /> Download CAD document</button><button disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('step'))}><Download size={14} /> Export STEP</button><button disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('stl'))}><Download size={14} /> Export STL</button><button disabled={!document.features.some(feature => !feature.suppressed && (feature.kind === 'sketch' && feature.profiles.some(profile => !profile.construction) || feature.kind === 'curve')) && !hasSolid || !props.onOpenDxfExport} onClick={() => run(() => props.onOpenDxfExport?.())}><Download size={14} /> Export DXF</button><a href={CAD_KERNEL_THIRD_PARTY.href} aria-label={CAD_KERNEL_THIRD_PARTY.label} title={CAD_KERNEL_THIRD_PARTY.description} target="_blank" rel="noopener noreferrer">Geometry kernel licenses</a><span className="cad-menu-rule" />{props.onSectionForCam && <button disabled={locked || !sectionBodyId || !hasSolid || props.buildVersion !== props.documentVersion || Boolean(build?.diagnostics.length)} title="Create CAM geometry from a planar section" onClick={() => sectionBodyId && run(() => props.onSectionForCam?.(sectionBodyId))}><Scissors size={14} /> Section for CAM</button>}<button disabled={locked || !selectedSketch?.profiles.some((entry) => !entry.construction)} onClick={() => selectedSketch && run(() => props.onSendToCam(selectedSketch.id))}><ArrowRight size={14} /> Send sketch to CAM</button></div></>}</div>
        <button aria-label="Undo" title="Undo · Ctrl+Z" disabled={!canUndo || locked} onClick={() => run(props.onUndo)}><Undo2 size={15} /></button><button aria-label="Redo" title="Redo · Ctrl+Shift+Z" disabled={!canRedo || locked} onClick={() => run(props.onRedo)}><Redo2 size={15} /></button>
        <button disabled={locked} onClick={() => run(props.onSave)}><Save size={14} /> {storageBusy ? 'Working…' : 'Save'}</button>

      </div>
      <input ref={fileInput} type="file" accept=".wireedm-cad,.json,.step,.stp,.stl,.dxf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) run(() => props.onImportDocument(file)); event.target.value = ''; }} />
    </div>;

  const toolbar = <div className="cad-toolbar" aria-label="CAD tools" data-cad-tool-context={sketch ? 'sketch' : curve || curveCreation ? 'curve' : 'model'} inert={deleteFeature || pluginsOpen || externalWorkflowOpen || currentCanvasMenu || treeMenuOpen ? true : undefined}>
      {!canvasReference && <div className="cad-tool-group">{toolButton('Sketch', PencilRuler, startSketch, locked)}{toolButton('Plane', Square, () => startFeature('datum-plane'), locked)}{toolButton('Curve', Spline, () => startFeature('curve'), locked)}</div>}
      <div className="cad-tool-group">{toolButton('Plugins', Plus, () => setPluginsOpen(true), locked)}</div>
      {sketch ? <><div className="cad-tool-group">{toolButton('Select', MousePointer2, () => setTool('select'), locked, tool === 'select')}{toolButton('Rectangle', Square, () => { setTool('rectangle'); setProfileId(null); }, locked, tool === 'rectangle')}{toolButton('Circle', Circle, () => { setTool('circle'); setProfileId(null); }, locked, tool === 'circle')}{toolButton('Slot', Pill, () => { setTool('slot'); setProfileId(null); }, locked, tool === 'slot')}{toolButton('Polyline', Waypoints, () => { setTool('polygon'); setProfileId(null); }, locked, tool === 'polygon')}{toolButton('Path', Spline, () => { setTool('path'); setProfileId(null); }, locked, tool === 'path', 'Draw a closed path with lines and three-point arcs')}</div><div className="cad-tool-group">{toolButton('Dimension', Ruler, () => beginProfileCommand('dimension'), locked || !sketchDimensionAvailable)}{toolButton('Move profile', Move3D, () => beginProfileCommand('move'), locked || !profile || profile.geometry.kind === 'plugin')}<CadEdgeTreatmentCommand context="sketch" disabled={locked || profile?.geometry.kind !== 'rectangle'} onChoose={() => beginProfileCommand('fillet')} /></div><div className="cad-sketch-options"><label><input type="checkbox" checked={construction} disabled={locked} onChange={(event) => setConstruction(event.target.checked)} /> Construction</label></div></> : curve || curveCreation ? null : <><div className="cad-tool-group">{toolButton('Pad / Pocket', Box, () => startFeature('extrude'), locked || !hasSketch)}{toolButton('Revolve', RotateCw, () => startFeature('revolve'), locked || !hasSketch)}{toolButton('Loft', Layers, () => startFeature('loft'), locked || document.features.filter(feature => feature.kind === 'sketch' && !feature.suppressed).length < 2, false, 'Loft through ordered sketch sections')}{toolButton('Sweep', Spline, () => startFeature('sweep'), locked || !activeSketches.some(hasMaterial) || !document.features.some(feature => feature.kind === 'curve' && !feature.suppressed), false, 'Sweep a profile along a reference Curve')}</div><div className="cad-tool-group"><CadEdgeTreatmentCommand disabled={locked || !hasBody} onChoose={kind => startFeature(kind)} />{toolButton('Shell', Box, () => startFeature('shell'), locked || !topologyReady || !props.onResolveSelection || topologySelection?.picks[0]?.kind !== 'face')}{toolButton('Boolean', Layers, () => startFeature('boolean'), locked || currentBodyIds.length < 2)}</div><div className="cad-tool-group">{toolButton('Move', Move3D, () => startFeature('transform'), locked || !hasBody)}<CadPatternCommand disabled={locked || !hasBody} onChoose={kind => startFeature(kind)} />{toolButton('Mirror', Copy, () => startFeature('mirror'), locked || !hasBody)}</div></>}
    </div>;
  return <main className="cad-workbench" aria-label="Parametric CAD workbench">
    {publishHeader ? headerHost && createPortal(header, headerHost) : header}
    <div className="cad-body" inert={deleteFeature || pluginsOpen || externalWorkflowOpen || currentCanvasMenu || treeMenuOpen ? true : undefined}>
      <section className="cad-center" aria-label="Modeling area"><CadCommandDock toolbar={toolbar}>{canvasReference ? <CadSketchCanvas getFitArea={getFitArea} onContextMenu={openSketchMenu} navigationMode={preferences.navigationMode} dimensionControls={preferences.showOnPartDimensions ? { document, onEditMany: props.onEditMany, onPendingChange: setDimensionPending, interactionLocked: externalWorkflowOpen || pluginsOpen || editorPending || parameterPending || namePending || treeRenamePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy, onInspectInput: inspectInput, onConfigure: name => { setInspectorCollapsed(false); inspectInput(name); } } : undefined} previewProfile={profilePreview} inspection={sketchInspection} key={`${document.id}/${canvasReference.id}`} sketch={canvasReference} documentVersion={props.documentVersion} parameters={previewParameters ?? document.parameters} placementLabel={cadPlacementLabel(canvasReference.plane, document.features)} tool={tool} selectedProfileId={profileId} onSelectProfile={canvasReference.kind === 'curve' ? () => undefined : selectProfile} onAddProfile={addProfile} onTranslateProfile={(id, translation) => { if (!sketch) return; flushSync(() => setDrawingPending(false)); props.onEditMany([{ kind: 'translate-sketch-profiles', sketchId: sketch.id, profileIds: [id], translation }]); }} onAddCurve={addCurve} onCancelCurve={cancel} curveCreation={Boolean(curveCreation)} onPendingChange={setDrawingPending} onError={setError} cancelSignal={cancelSignal} interactionLocked={curveCreation ? editorPending || parameterPending || namePending || storageBusy || deleteFeature !== null || resolvingTopology !== null : pendingOutsideDrawing || storageBusy} viewLocked={navigationLocked} onControlsReady={publishRenderedControls} /> : <CadViewport getFitArea={getFitArea} onContextMenu={currentReferencePick || currentSketchPlaneRequest ? undefined : openSolidMenu} navigationMode={preferences.navigationMode} navigationLocked={navigationLocked} meshes={displayedMeshes} references={references} referenceVersion={candidatePreview?.candidateId ?? props.documentVersion} selectedId={newFeature?.id ?? selectedId} selectedReferencePlane={selectedReferencePlane} onSelect={choose} onSelectPlane={selectReferencePlane} planePickingOnly={Boolean(currentSketchPlaneRequest)} interactionLocked={locked && !currentReferencePick && !currentSketchPlaneRequest} onControlsReady={publishRenderedControls} pickMode={currentReferencePick || currentSketchPlaneRequest ? 'body' : pickMode} topologySelection={candidatePreview || currentReferencePick ? null : topologySelection} pickingEnabled={Boolean(currentReferencePick) || topologyReady && !candidatePreview} onPickMode={!currentReferencePick && !currentSketchPlaneRequest && props.onInspectTopology && props.onResolveSelection ? (mode) => run(() => viewportControls.apply({ kind: 'set-pick-mode', mode })) : undefined} onTopologyPick={currentReferencePick || currentSketchPlaneRequest ? undefined : pickTopology} />}
        {currentSketchPlaneRequest && <div className="cad-plane-request" role="status"><PencilRuler size={14} /><span>Select a plane in the design area</span><button aria-label="Cancel plane selection" onClick={cancel}>Cancel</button></div>}
        {buildState === 'building' && <div className="cad-build-overlay" role="status"><Loader2 size={13} className="cad-spin" /> Building solid geometry…</div>}
        <div className="cad-tree-overlay" data-cad-model-tree aria-label="Feature tree and parameters">{specificationTree}</div>
        </CadCommandDock>
      </section>
      {inspectorVisible && <aside key={`configuration-${externalWorkflowOpen}-${pluginsOpen}`} className={`cad-properties cad-floating-inspector${floatingPluginInspector ? ' cad-plugin-inspector' : ''}${inspectorCollapsed ? ' is-minimized' : ''}`} data-cad-properties aria-label="Feature properties"><div className="cad-panel-heading"><span>{sketch ? sketch.name : curve ? curve.name : newFeature ? 'NEW FEATURE' : profile ? 'CONFIGURATION' : 'PROPERTIES'}</span>{sketch && <button className="cad-panel-finish" aria-label="Finish sketch" title="Finish sketch" disabled={locked} onClick={finishSketch}><Check size={16} /></button>}{curve && !curveCreation && <button className="cad-panel-finish" aria-label="Finish curve editing" title="Finish curve editing" disabled={locked} onClick={finishCurve}><Check size={16} /></button>}<button aria-label={inspectorCollapsed ? 'Expand configuration' : 'Minimize configuration'} aria-expanded={!inspectorCollapsed} disabled={pending} onClick={() => setInspectorCollapsed(!inspectorCollapsed)}>{inspectorCollapsed ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>{(selected || profile) && !newFeature && <button aria-label="Delete selected feature or profile" disabled={locked} onClick={removeSelected}><Trash2 size={13} /></button>}</div>
        <div hidden={inspectorCollapsed}>
        {resolvingTopology && <div className="cad-topology-resolving" role="status"><Loader2 size={14} className="cad-spin" /><span>Verifying {resolvingTopology === 'shell' ? 'opening face' : 'selected edges'}…</span><button onClick={cancel}>Cancel</button></div>}
        {!newFeature && !sketch && !resolvingTopology && props.onInspectTopology && topologyReady && build && (topologySelection?.bodyId ?? (selected && currentBodyIds.includes(selected.id) ? selected.id : null)) && <CadTopologyInspector key={`${props.documentVersion}-${build.buildId}-${topologySelection?.bodyId ?? selectedId}-${pickMode}`} bodyId={topologySelection?.bodyId ?? selectedId ?? ''} buildId={build.buildId} documentVersion={props.documentVersion} pickMode={pickMode} selection={topologySelection} locked={locked} onInspect={props.onInspectTopology} onSelect={(pick, additive) => pickTopology({ bodyId: topologySelection?.bodyId ?? selectedId ?? '', pick }, additive)} onClear={() => run(() => viewportControls.apply({ kind: 'clear-topology' }))} />}
        <fieldset className="cad-editor-fieldset" disabled={drawingPending && !curveCreation || parameterPending || dimensionPending || namePending || treeRenamePending || storageBusy || resolvingTopology !== null}>{curveCreation ? <CadCurveCreationFields draft={curveCreation} document={document} onChange={setNewFeature} onCancel={cancel} /> : newFeature ? <CadFeatureEditor onReferencePick={requestReferencePick} key={`${newFeature.id}-${cancelSignal}`} feature={newFeature} document={document} documentVersion={props.documentVersion} onFeaturePreview={props.onFeaturePreview} featurePreview={props.featurePreview} previewEnabled={previewEnabled} isNew currentBodyIds={currentBodyIds} onApply={applyFeature} onCancel={cancel} onPendingChange={setEditorPending} /> : profile && sketch ? selectedProfileEditor : selected ? <><CadFeatureEditor onReferencePick={requestReferencePick} key={`${selected.id}-${cancelSignal}`} feature={selected} document={document} documentVersion={props.documentVersion} onFeaturePreview={props.onFeaturePreview} featurePreview={props.featurePreview} previewEnabled={previewEnabled} isNew={false} onApply={applyFeature} onCancel={cancel} onPendingChange={setEditorPending} />{selected.kind === 'curve' && <div className="cad-context-actions">{!curve && <button disabled={locked || selected.suppressed} onClick={() => editCurve(selected)}><Spline size={13} /> Edit curve</button>}</div>}{selected.kind === 'sketch' && <div className="cad-context-actions"><button disabled={locked} onClick={() => editSketch(selected)}><PencilRuler size={13} /> Edit sketch</button></div>}<div className="cad-context-actions"><label className="cad-check"><input type="checkbox" disabled={locked} checked={selected.suppressed} onChange={(event) => run(() => props.onEdit({ kind: 'update-feature', feature: { ...selected, suppressed: event.target.checked } }))} /> Suppress feature</label></div>{displayedMeshes.filter((mesh) => mesh.featureId === selected.id).map((mesh) => <div className="cad-solid-info" key={mesh.featureId}><span>Solid volume</span><strong>{mesh.volume.toLocaleString(undefined, { maximumFractionDigits: 3 })} mm³{mesh.solidCount !== undefined && mesh.solidCount > 1 ? ` · ${mesh.solidCount} solids` : ''}</strong></div>)}</> : null}{selectedCurve && !newFeature && <CadCurveMeasurements curve={selectedCurve} document={document} />}{selectedSketch && !newFeature && !floatingPluginInspector && <CadSketchMeasurements document={measurementDocument} sketchId={selectedSketch.id} profileId={profileId} />}</fieldset>
        </div>
      </aside>}
    </div>
    {deleteFeature && <div className="cad-dialog-backdrop"><div ref={deleteDialog} className="cad-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="cad-delete-title"><h2 id="cad-delete-title">Delete {deleteFeature.name}?</h2>{dependentNames.length ? <><p>This also deletes {dependentNames.length} dependent feature{dependentNames.length === 1 ? '' : 's'}.</p><ul>{dependentNames.map((name) => <li key={name}>{name}</li>)}</ul></> : <p>You can restore this feature with Undo.</p>}<div className="cad-form-actions"><button onClick={() => setDeleteFeature(null)}>Cancel</button><button className="cad-danger" onClick={() => run(() => { props.onEdit({ kind: 'delete-feature', featureId: deleteFeature.id, cascade: dependentNames.length > 0 }); setDeleteFeature(null); setSelectedId(null); })}><Trash2 size={13} /> Delete{dependentNames.length ? ' with dependents' : ''}</button></div></div></div>}
    {currentCanvasMenu && canvasMenuItems.length > 0 && <CadContextMenu anchor={{ x: currentCanvasMenu.request.clientX, y: currentCanvasMenu.request.clientY }} title={canvasMenuTitle} items={canvasMenuItems} onClose={() => setCanvasMenu(null)} />}
    {pluginsOpen && <CadPluginsPanel onClose={() => setPluginsOpen(false)} onAdd={addPlugin} onListPlugins={props.onListPlugins} onInstallPlugin={props.onInstallPlugin} />}
  </main>;
}

export default CadWorkbench;
