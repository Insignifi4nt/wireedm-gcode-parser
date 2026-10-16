import { MenuItem, MenuSeparator, MenuSurface } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import type { CadPrepareEdits } from './useCadPreparedPreview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useOptionalAppRail } from '@/app/AppRailContext';
import { AddIcon, ArrowLeft, BooleanIcon, CameraCaptureIcon, Check, ChevronDown, ChevronRight, CircleIcon, ClosedPathIcon, CloseIcon, CurveIcon, DatumPlaneIcon, Download, FilePlus2, FolderOpen, Loader2, LoftIcon, MeasureIcon, MirrorIcon, Move3dIcon, MoveIcon, PadPocketIcon, PencilRuler, PolylineIcon, RectangleIcon, Redo2, RefreshIcon, RevolveIcon, Save, SectionCamIcon, SelectIcon, SendCamIcon, ShellIcon, SketchIcon, SlotIcon, Spline, SweepIcon, Trash2, Undo2, type WorkbenchIconComponent } from '@wire-edm/icons-react';

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
import type { CadExtrudeDepthControl } from './cadExtrudeDepthInteraction';
import { cadUnobscuredFitArea, type CadFitAreaReader } from './cadFitArea';
import { formatCadLocalizedQuantity } from './cadDisplayQuantity';
const NO_MESHES: readonly CadBuildResult['meshes'][number][] = Object.freeze([]);
function afterCadEdit(completion: CadEditCompletion, accepted: () => void, signal?: AbortSignal): CadEditCompletion {
  const finish = (result: Awaited<CadEditCompletion>) => { signal?.throwIfAborted(); accepted(); return result; };
  return completion && 'then' in completion ? completion.then(finish) : finish(completion);
}
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
  onEdit(edit: CadEdit, signal?: AbortSignal): CadEditCompletion;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPrepareEdits?: CadPrepareEdits;
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
  const base = { id, name: `${kind === 'extrude' ? 'Extrude' : featureLabels[kind]} ${sequence}`, suppressed: false };
  const sourceError = (purpose: CadSketchSourcePurpose, fallback: string) => selected?.kind === 'sketch' ? cadSketchSourceIssueMessage(selected, purpose, document.parameters) ?? fallback : fallback;
  const body = selected && bodyIds.includes(selected.id) ? selected : [...document.features].reverse().find((feature) => bodyIds.includes(feature.id));
  switch (kind) {
    case 'datum-plane': return { ...base, kind, definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 0], rotation: [0, 0, 0] } };
    case 'sketch': return { ...base, kind, plane, offset: 0, profiles: [] };
    case 'curve': return { ...base, kind, plane, offset: 0, segments: [] };
    case 'imported': throw new Error('Use File > Import to add an external solid.');
    case 'extrude': {
      const source = pickCadSketchSource({ features: document.features, selectedId: selected?.id ?? null, purpose: kind, parameters: document.parameters });
      if (!source) throw new Error(sourceError(kind, 'Create a sketch with closed material contours before adding a Pad.'));
      return { ...base, kind, sketchId: source.id, distance: 10, symmetric: false, operation: 'new', targetId: null };
    }
    case 'pocket': {
      const source = pickCadSketchSource({ features: document.features, selectedId: selected?.id ?? null, purpose: kind, parameters: document.parameters });
      if (!source || !body) throw new Error(sourceError(kind, 'Through-all Pocket requires a closed material sketch on XY, XZ or YZ and a target body.'));
      return { ...base, kind, sketchId: source.id, targetId: body.id, extent: { kind: 'through-all', direction: 'both' } };
    }
    case 'revolve': {
      const source = pickCadSketchSource({ features: document.features, selectedId: selected?.id ?? null, purpose: kind, parameters: document.parameters });
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
  const commandSubmission = useCadEditSubmission();
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
  const [planeSelection, setPlaneSelection] = useState<{ documentId: string; plane: CadSketchPlane } | null>(null);
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
  const [referencePick, setReferencePick] = useState<{ command: Exclude<CadFeatureReferencePickCommand, { kind: 'clear' }>; document: CadDocument; buildId: string | null } | null>(null);
  const [depthInteraction, setDepthInteraction] = useState<{ control: CadExtrudeDepthControl; document: CadDocument } | null>(null);
  const depthDocument = useRef(document); depthDocument.current = document;
  const publishDepthInteraction = useCallback((control: CadExtrudeDepthControl | null, released?: CadExtrudeDepthControl) => {
    setDepthInteraction(previous => control ? previous?.control === control && previous.document === depthDocument.current ? previous
      : { control, document: depthDocument.current } : !released || previous?.control === released ? null : previous);
  }, []);
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
  const [sketchPreview, setSketchPreview] = useState<{ source: CadDocument; document: CadDocument } | null>(null);
  const publishSketchPreview = useCallback((candidate: CadDocument | null) => setSketchPreview(candidate ? { source: document, document: candidate } : null), [document]);
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
  const fileMenuTrigger = useRef<HTMLButtonElement>(null);
  const fileMenuPanel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (fileMenu) fileMenuPanel.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [fileMenu]);
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
  const referenceContextBlocked = drawingPending || pluginsOpen || parameterPending || dimensionPending || namePending || treeRenamePending || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || externalWorkflowOpen;
  const referencePickBlocked = referenceContextBlocked || storageBusy;
  const currentOwnedPick = !referencePickBlocked && referencePick?.document === document && referencePick.command.expectedVersion === props.documentVersion
    && (referencePick.command.kind === 'pick-regions' || referencePick.buildId === (build?.buildId ?? null)) ? referencePick.command : null;
  const currentReferencePick = currentOwnedPick?.kind === 'pick' ? currentOwnedPick : null;
  const currentRegionPick = currentOwnedPick?.kind === 'pick-regions' ? currentOwnedPick : null;
  const regionReferenceIds = useMemo(() => currentRegionPick ? [currentRegionPick.sketchId] : [], [currentRegionPick?.sketchId]);
  const currentSketchPlaneRequest = !referencePickBlocked && !editorPending && !newFeature && !currentOwnedPick
    && sketchPlaneRequest?.document === document && sketchPlaneRequest.version === props.documentVersion ? sketchPlaneRequest : null;
  planeRequestOwner.current = currentSketchPlaneRequest;
  useLayoutEffect(() => { if (sketchPlaneRequest && !currentSketchPlaneRequest) setSketchPlaneRequest(null); }, [sketchPlaneRequest, currentSketchPlaneRequest]);
  useLayoutEffect(() => { if (referencePick && !currentOwnedPick) { referencePick.command.onCancel(); setReferencePick(null); } }, [referencePick, currentOwnedPick]);
  const canvasMenuBlocked = drawingPending || pluginsOpen || editorPending || parameterPending || dimensionPending || namePending || treeRenamePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || storageBusy || externalWorkflowOpen || Boolean(currentOwnedPick);
  const currentCanvasMenu = !canvasMenuBlocked && canvasMenu?.document === document && canvasMenu.version === props.documentVersion && canvasMenu.buildId === (build?.buildId ?? null) ? canvasMenu : null;
  useLayoutEffect(() => { if (canvasMenu && !currentCanvasMenu) setCanvasMenu(null); }, [canvasMenu, currentCanvasMenu]);
  const pendingOutsideDrawing = commandSubmission.applying || pluginsOpen || editorPending || parameterPending || dimensionPending || namePending || treeRenamePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || Boolean(currentCanvasMenu) || Boolean(currentOwnedPick) || Boolean(currentSketchPlaneRequest);
  const pending = drawingPending || pendingOutsideDrawing;
  const locked = pending || storageBusy || externalWorkflowOpen;
  const interactionState = useRef({ locked }); interactionState.current = { locked };
  const treeLocked = commandSubmission.applying || (currentReferencePick || currentSketchPlaneRequest ? false : drawingPending || pluginsOpen || editorPending || parameterPending || dimensionPending || namePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy || externalWorkflowOpen || Boolean(currentCanvasMenu));
  const navigationLocked = commandSubmission.applying || drawingPending || pluginsOpen || treeRenamePending || externalWorkflowOpen || storageBusy || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || Boolean(currentCanvasMenu);
  const previewEnabled = !pluginsOpen && !treeRenamePending && !externalWorkflowOpen && !storageBusy && !treeMenuOpen && !currentCanvasMenu && !currentReferencePick;
  const selected = document.features.find((feature) => feature.id === selectedId);
  const selectedReferencePlane = useMemo<CadSketchPlane | null>(() => selected?.kind === 'datum-plane' && !selected.suppressed
    ? Object.freeze({ kind: 'datum-plane', featureId: selected.id }) : !selected && planeSelection?.documentId === document.id ? planeSelection.plane : null, [selected, planeSelection, document.id]);
  const principalPlanesVisible = typeof selectedReferencePlane === 'string';
  const sketch = document.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === sketchId);
  const curve = document.features.find((feature): feature is CadCurveFeature => feature.kind === 'curve' && feature.id === curveId);
  const curveCreation = newFeature?.kind === 'curve' ? newFeature : null;
  const canvasReference = curveCreation ?? curve ?? sketch;
  const preparedSketchDocument = editorPending && sketchPreview?.source === document ? sketchPreview.document : null;
  const preparedSketch = preparedSketchDocument?.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === sketch?.id);
  const depthVisualEligible = !pluginsOpen && !treeRenamePending && !externalWorkflowOpen && !treeMenuOpen && !currentCanvasMenu && !currentReferencePick;
  const currentDepthControl = preferences.showDepthHandles === true && !canvasReference && !currentOwnedPick && !currentSketchPlaneRequest
    && !referenceContextBlocked && depthVisualEligible && depthInteraction?.document === document
    && depthInteraction.control.baseVersion === props.documentVersion && depthInteraction.control.featureId === (newFeature?.id ?? selectedId)
    ? depthInteraction.control : null;
  const selectedCurve = selected?.kind === 'curve' ? selected : curve;
  const ownedPreview = props.featurePreview && props.featurePreview.kind !== 'idle' && props.featurePreview.baseVersion === props.documentVersion
    && (editorPending || newFeature !== null) && props.featurePreview.featureId === (newFeature?.id ?? selectedId) ? props.featurePreview : null;
  const candidatePreview = currentReferencePick ? null : ownedPreview?.kind === 'ready' ? ownedPreview : ownedPreview?.lastValid ?? null;
  const displayedDocument = candidatePreview?.document ?? document;
  const displayedBuild = candidatePreview?.result ?? build;
  const preparedReferences = useMemo(() => prepareCadViewportReferences(displayedDocument.features, displayedDocument.parameters), [displayedDocument.features, displayedDocument.parameters]);
  const references = useMemo(() => currentRegionPick ? preparedReferences.filter(reference => reference.featureId === currentRegionPick.sketchId && !reference.construction) : currentReferencePick ? preparedReferences.filter(reference => reference.featureId !== null && currentReferencePick.eligibleIds.includes(reference.featureId))
    : currentSketchPlaneRequest ? [...CAD_PRINCIPAL_PLANE_REFERENCES, ...preparedReferences.filter(reference => reference.featureKind === 'datum-plane')]
      : [...(principalPlanesVisible ? CAD_PRINCIPAL_PLANE_REFERENCES : []), ...selectCadViewportReferences(preparedReferences, displayedDocument.features, selectedId)],
    [preparedReferences, displayedDocument.features, selectedId, currentReferencePick, currentRegionPick, currentSketchPlaneRequest, principalPlanesVisible]);
  const visibleReferenceIds = useMemo(() => cadReferenceFeatureIds(references), [references]);
  const visibleReferencePlanes = useMemo(() => cadReferencePlanes(references), [references]);
  const hasActiveBodyFeatures = document.features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature));
  const displayedMeshes = displayedDocument.features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature)) ? displayedBuild?.meshes ?? NO_MESHES : NO_MESHES;
  useEffect(() => { if (!hasActiveBodyFeatures) setPickMode('body'); }, [hasActiveBodyFeatures]);
  const selectedSketch = selected?.kind === 'sketch' ? selected : sketch;
  const profile = sketch?.profiles.find((entry) => entry.id === profileId);
  const measurementDocument = useMemo(() => preparedSketchDocument ?? (!profilePreview && !previewParameters ? document : { ...document, parameters: previewParameters ?? document.parameters,
    features: document.features.map(feature => feature.kind === 'sketch' && feature.id === sketch?.id && profilePreview ? { ...feature, profiles: feature.profiles.map(entry => entry.id === profilePreview.id ? profilePreview : entry) } : feature) }), [document, sketch?.id, profilePreview, previewParameters, preparedSketchDocument]);
  const dimensionGeometry = profile?.geometry;
  renderedPreferences.current = { navigationMode: preferences.navigationMode, onPartDimensionsVisible: preferences.showOnPartDimensions
    && tool === 'select' && !profilePreview && !preparedSketch && Boolean(profile && (inspectCadSketchDimensions(profile, document.parameters).length || dimensionGeometry?.kind === 'plugin' && dimensionGeometry.package.id === 'wireedm.spur-gear')) };
  const parameterInspection = useMemo(() => inspectCadParameters(document), [document]);
  const parameterUsages = parameterInspection.parameters.find(parameter => parameter.name === inspectedParameter)?.usages.filter(usage => usage.active) ?? [];
  const highlightedProfiles = parameterUsages.filter(usage => usage.featureId === sketch?.id && usage.profileId).map(usage => usage.profileId).filter((id): id is string => typeof id === 'string');
  const gearUsage = parameterUsages.find(usage => usage.featureId === sketch?.id && usage.inputName && usage.profileId);
  const sketchInspection = inspectedParameter ? { profileIds: [...new Set(highlightedProfiles)],
    ...(gearUsage?.profileId && gearUsage.inputName ? { gear: { profileId: gearUsage.profileId, inputName: gearUsage.inputName } } : {}) }
    : inspectedInput && profile?.id === inspectedInput.profileId ? { profileIds: [profile.id], gear: inspectedInput } : undefined;
  const inspectInput = useCallback((name: string | null) => { setInspectedInput(name && profileId ? { profileId, inputName: name } : null); if (name) setInspectedParameter(null); }, [profileId]);
  useEffect(() => { setProfilePreview(null); setPreviewParameters(null); setSketchPreview(null); setInspectorCollapsed(false); }, [selectedId, sketchId, profileId]);
  const hasSketch = document.features.some((feature) => feature.kind === 'sketch' && cadSketchSourceIssue(feature, 'extrude', document.parameters) === null);
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
  const run = (action: () => CadEditCompletion) => {
    setError(null); setFileMenu(false);
    try { Promise.resolve(action()).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The operation could not be completed.')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The operation could not be completed.'); }
  };
  const submitEdit = (apply: (signal: AbortSignal) => CadEditCompletion, accepted: () => void = () => undefined) => {
    props.onWorkflowChange(true);
    setError(null); setFileMenu(false);
    commandSubmission.submit(apply, accepted, cause => {
      // A synchronous rejection can batch applying true→false without a pending-effect change.
      props.onWorkflowChange(pending);
      setError(cause instanceof Error ? cause.message : 'The edit could not be completed.');
    });
  };
  const deleteProfile = (source: CadSketchFeature, id: string) => submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: {
    ...source, profiles: source.profiles.filter(profile => profile.id !== id)
  } }, signal), () => setProfileId(current => current === id ? null : current));
  const applyCanvasEdits = (edits: readonly CadEdit[], signal?: AbortSignal) => {
    props.onWorkflowChange(true);
    return props.onEditMany(edits, signal);
  };
  useEffect(() => commandSubmission.cancel(), [document.id, commandSubmission.cancel]);
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
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); commandSubmission.cancel(); setDeleteFeature(null); }
      else if (event.key === 'Tab') {
        const entries = buttons();
        const first = entries[0], last = entries.at(-1);
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    dialog.addEventListener('keydown', onKey);
    return () => { dialog.removeEventListener('keydown', onKey); if (previous instanceof HTMLElement) previous.focus(); };
  }, [deleteFeature, commandSubmission.cancel]);
  useEffect(() => {
    if (selectedId && !document.features.some((feature) => feature.id === selectedId)) setSelectedId(null);
    if (curveId && !document.features.some(feature => feature.kind === 'curve' && feature.id === curveId)) setCurveId(null);
    if (sketchId && !document.features.some((feature) => feature.id === sketchId && feature.kind === 'sketch')) { setSketchId(null); setProfileId(null); }
    else if (profileId && !sketch?.profiles.some((entry) => entry.id === profileId)) setProfileId(null);
  }, [document.id, document.features, selectedId, sketchId, curveId, profileId, sketch]);
  const cancel = useCallback(() => {
    commandSubmission.cancel();
    planeRequestOwner.current = null; setSketchPlaneRequest(null);
    setCanvasMenu(null);
    topologyResolution.current?.controller.abort(); topologyResolution.current = null; setResolvingTopology(null);
    setPickedTopology(null);
    setCancelSignal((value) => value + 1); setNewFeature(null); setDrawingPending(false); setEditorPending(false); setParameterPending(false); setDimensionPending(false); setTreeRenamePending(false); setDeleteFeature(null); setFileMenu(false); setTool('select'); setError(null);
    setInspectedParameter(null); setInspectedInput(null); setProfilePreview(null); setPreviewParameters(null); setProfileCommand(null); setNameDraft(document.name); setNamePending(false);
  }, [document.name, commandSubmission.cancel]);
  const selectEscapeGuard = useMemo(() => createCadSelectEscapeGuard(window.document), []);
  const hotkeys = useRef({ pending, storageBusy, props, cancel, selectEscapeGuard, referencePick: currentOwnedPick });
  hotkeys.current = { pending, storageBusy: storageBusy || externalWorkflowOpen, props, cancel, selectEscapeGuard, referencePick: currentOwnedPick };
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
    if (!source && (kind === 'fillet' || kind === 'chamfer') && topologySelection?.picks.some(pick => pick.kind !== 'edge')) {
      throw new Error('Pick edges for Fillet / Chamfer, or select the body in the tree to treat all its edges.');
    }
    if (kind === 'shell' || !source && (kind === 'fillet' || kind === 'chamfer') && topologySelection?.picks[0]?.kind === 'edge') return startTopologyFeature(kind);
    setNewFeature(featureDraft(kind, document, source ?? selected, currentBodyIds, plane)); setSketchId(null); setCurveId(null); if (kind === 'curve') setTool('path'); setProfileId(null); setEditorPending(false);
  });
  const createSketchOnPlane = (plane: CadSketchPlane) => {
    if (typeof plane !== 'string' && !document.features.some(feature => feature.id === plane.featureId && feature.kind === 'datum-plane' && !feature.suppressed)) return;
    const feature = featureDraft('sketch', document, undefined, currentBodyIds, plane);
    setPlaneSelection({ documentId: document.id, plane });
    submitEdit(signal => props.onEdit({ kind: 'add-feature', feature }, signal), () => {
      setPlaneSelection(null); setPickedTopology(null); setSelectedId(feature.id); setSketchId(feature.id); setCurveId(null); setProfileId(null); setTool('rectangle'); setError(null);
    });
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
  const choose = (id: string | null) => { if (currentRegionPick) return; if (currentReferencePick) { if (id && currentReferencePick.eligibleIds.includes(id)) currentReferencePick.onSelect(id); return; }
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
        { label: 'Pad sketch', disabled: cadSketchSourceIssue(feature, 'extrude', document.parameters) !== null, onSelect: () => startFeature('extrude', undefined, feature) },
        { label: 'Revolve sketch', disabled: cadSketchSourceIssue(feature, 'revolve', document.parameters) !== null, onSelect: () => startFeature('revolve', undefined, feature) });
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
      canvasMenuItems.push({ kind: 'separator' }, { label: 'Suppress feature', onSelect: () => submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...feature, suppressed: true } }, signal)) },
        { label: 'Delete feature', danger: true, onSelect: () => { setSelectedId(feature.id); setProfileId(null); setDeleteFeature(feature); } });
    }
  } else if (currentCanvasMenu?.kind === 'sketch') {
    const source = document.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === currentCanvasMenu.sketchId);
    const target = source?.profiles.find(profile => profile.id === currentCanvasMenu.request.profileId);
    if (source && target) {
      canvasMenuTitle = target.name;
      canvasMenuItems.push({ label: 'Configure profile', onSelect: () => { editSketch(source); setProfileId(target.id); setInspectorCollapsed(false); } },
        { label: 'Toggle construction', onSelect: () => submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...source, profiles: source.profiles.map(profile => profile.id === target.id ? { ...profile, construction: !profile.construction } : profile) } }, signal)) },
        { kind: 'separator' }, { label: 'Delete profile', danger: true, onSelect: () => deleteProfile(source, target.id) });
    }
  }
  const activeSketches = document.features.filter((feature): feature is CadSketchFeature => feature.kind === 'sketch' && !feature.suppressed);
  const hasMaterial = (feature: CadSketchFeature) => cadSketchSourceIssue(feature, 'extrude', document.parameters) === null;
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
  const applyFeature = async (feature: CadFeature, parameters: Readonly<Record<string, number>>, signal?: AbortSignal) => {
    await props.onEditMany(cadFeatureCandidateEdits({ feature, isNew: Boolean(newFeature), parameters }), signal);
    signal?.throwIfAborted();
    setPickedTopology(null);
    setNewFeature(null); setEditorPending(false); setSelectedId(feature.id); setError(null);
    if (feature.kind === 'sketch' && !sketch) { setSketchId(feature.id); setTool('rectangle'); }
  };
  const addProfile = (geometry: CadProfile, signal?: AbortSignal) => {
    if (!sketch) throw new Error('Open a sketch before drawing.');
    const id = crypto.randomUUID();
    const next = { id, name: `${geometry.kind[0].toUpperCase()}${geometry.kind.slice(1)} ${sketch.profiles.length + 1}`, construction, geometry };
    props.onWorkflowChange(true);
    return afterCadEdit(props.onEdit({ kind: 'update-feature', feature: { ...sketch, profiles: [...sketch.profiles, next] } }, signal), () => { setProfileId(id); setError(null); }, signal);
  };
  const addPlugin = (plugin: CadPluginPackage) => {
    try {
      const target = sketch ?? selectedSketch ?? featureDraft('sketch', document, selected, currentBodyIds);
      if (target.kind !== 'sketch') throw new Error('Plugin profiles require a sketch.');
      const id = crypto.randomUUID();
      const edits: CadEdit[] = document.features.some(feature => feature.id === target.id) ? [] : [{ kind: 'add-feature', feature: target }];
      edits.push({ kind: 'add-plugin-profile', sketchId: target.id, profileId: id, name: plugin.name, package: plugin, groupId: `pg_${crypto.randomUUID()}` });
      submitEdit(signal => props.onEditMany(edits, signal), () => {
        setPluginsOpen(false); setSketchId(target.id); setSelectedId(target.id); setProfileId(id); setTool('select');
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to add this plugin.'); }
  };
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
  };
  const removeSelected = () => {
    if (sketch && profile) { submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.filter((entry) => entry.id !== profile.id) } }, signal), () => setProfileId(current => current === profile.id ? null : current)); return; }
    if (selected) setDeleteFeature(selected);
  };
  const finishSketch = () => { setSketchId(null); setProfileId(null); setTool('select'); };
  const finishCurve = () => { setCurveId(null); setTool('select'); };
  const addCurve = (segments: readonly CadPathSegment[], signal?: AbortSignal) => {
    if (!curveCreation) throw new Error('Start a new Curve before finishing its geometry.');
    props.onWorkflowChange(true);
    return afterCadEdit(props.onEdit({ kind: 'add-feature', feature: { ...curveCreation, segments } }, signal), () => {
      setNewFeature(null); setSelectedId(curveCreation.id); setCurveId(curveCreation.id); setSketchId(null); setTool('select'); setDrawingPending(false); setEditorPending(false); setError(null);
    }, signal);
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
  const toolButton = (label: string, Icon: WorkbenchIconComponent, action: () => void, disabled = false, active = false, hint?: string) => <Button className={`cad-tool ${active ? 'is-active' : ''}`} title={hint ?? label} aria-label={label} disabled={disabled || storageBusy} aria-pressed={active} onClick={action}><Icon size={15} /><span>{label}</span></Button>;
  const beginProfileCommand = (kind: CadSketchProfileCommand['kind']) => {
    if (locked || !profile || profile.geometry.kind === 'plugin') return;
    setTool('select'); setInspectorCollapsed(false); setProfileCommand({ token: ++profileCommandSequence.current, documentId: document.id, profileId: profile.id, kind });
  };
  const exactProfileEditor = profile && sketch ? <CadProfileEditor onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} key={`${profile.id}-${cancelSignal}`} profile={profile} document={document} onInspectInput={inspectInput} onPreviewProfile={setProfilePreview} onPreviewParameters={setPreviewParameters} onApply={async (next, parameters, signal) => {
    await props.onEditMany([...Object.entries(parameters).map(([name, value]): CadEdit => ({ kind: 'set-parameter', name, value })), { kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map(entry => entry.id === next.id ? next : entry) } }], signal); signal?.throwIfAborted(); setEditorPending(false);
  }} onCancel={cancel} onPendingChange={setEditorPending} /> : null;
  const selectedProfileEditor = profile && sketch && profile.geometry.kind !== 'plugin' ? <CadSketchProfilePanel key={`${profile.id}-${cancelSignal}`} document={document} sketch={sketch} profile={profile} command={profileCommand} onCommandConsumed={token => setProfileCommand(current => current?.token === token ? null : current)} otherEditorPending={editorPending} onEditMany={props.onEditMany} onPendingChange={setEditorPending} onPreviewProfile={setProfilePreview} onPreviewParameters={setPreviewParameters} onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} interactionLocked={commandSubmission.applying || drawingPending || parameterPending || dimensionPending || namePending || treeRenamePending || storageBusy || resolvingTopology !== null || externalWorkflowOpen || pluginsOpen} cancelSignal={cancelSignal} exactGeometryEditor={profile.geometry.kind === 'polygon' || profile.geometry.kind === 'path' ? exactProfileEditor : undefined} /> : exactProfileEditor;
  const sketchDimensionAvailable = profile && cadSketchDimensionQuantities(profile.geometry).some(quantity => !inspectCadSketchDimensions(profile, document.parameters).some(dimension => dimension.field === (quantity === 'diameter' ? 'radius' : quantity)));
  const parameterContent = <CadParametersPanel key={`parameters-${externalWorkflowOpen}-${pluginsOpen}`} document={document} onEditMany={props.onEditMany} onInspectParameter={inspectParameter} onInspectUsage={inspectParameterUsage} onPendingChange={setParameterPending} interactionLocked={commandSubmission.applying || drawingPending || editorPending || dimensionPending || namePending || treeRenamePending || newFeature !== null || resolvingTopology !== null || storageBusy || deleteFeature !== null || externalWorkflowOpen || pluginsOpen || Boolean(currentSketchPlaneRequest || currentReferencePick)} cancelSignal={cancelSignal} />;
  const specificationTree = <CadFeatureTree parameterContent={parameterContent} selectionOnly={Boolean(currentReferencePick || currentSketchPlaneRequest)} allowPrincipalPlaneSelection={Boolean(currentSketchPlaneRequest)} selectableFeatureIds={currentReferencePick?.eligibleIds ?? (currentSketchPlaneRequest ? document.features.filter(feature => feature.kind === 'datum-plane' && !feature.suppressed).map(feature => feature.id) : undefined)} document={document} diagnostics={build?.diagnostics} selectedId={selectedId} selectedProfileId={profileId} locked={treeLocked} onRenamePendingChange={setTreeRenamePending} cancelSignal={cancelSignal} selectedReferencePlane={typeof selectedReferencePlane === 'string' ? selectedReferencePlane : null} onSelectReferencePlane={selectReferencePlane} onCreateSketch={plane => { if (!interactionState.current.locked) run(() => createSketchOnPlane(plane)); }} onRename={(feature, name, renamedProfileId, signal) => {
    if (document.features.find(entry => entry.id === feature.id) !== feature) throw new Error('The part changed. Cancel and reopen the rename editor.');
    return props.onEdit({ kind: 'update-feature', feature: renamedProfileId && feature.kind === 'sketch' ? { ...feature, profiles: feature.profiles.map(entry => entry.id === renamedProfileId ? { ...entry, name } : entry) } : { ...feature, name } }, signal);
  }} onContextMenuOpenChange={setTreeMenuOpen} onSuppress={(feature, suppressed) => submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...feature, suppressed } }, signal))} onDelete={feature => { setSelectedId(feature.id); setProfileId(null); setDeleteFeature(feature); }} onUpdateProfile={(source, next) => submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...source, profiles: source.profiles.map(entry => entry.id === next.id ? next : entry) } }, signal))} onDeleteProfile={deleteProfile} highlightedFeatureIds={parameterUsages.map(usage => usage.featureId)} onSelect={choose} onEditSketch={editSketch} onEditCurve={editCurve} onSelectProfile={(feature, id) => { editSketch(feature); setProfileId(id); setProfileCommand(null); }} />;

  const header = <div className="cad-header" aria-label="CAD document commands" inert={deleteFeature || pluginsOpen || externalWorkflowOpen || currentCanvasMenu || treeMenuOpen ? true : undefined}>
      <Button className="cad-back" aria-label="Workbench" title="Back to Workbench" onClick={() => run(props.onBack)} disabled={locked}><ArrowLeft size={14} /></Button>
      <Input className="cad-document-name" aria-label="Part name" value={nameDraft} disabled={commandSubmission.applying || drawingPending || editorPending || parameterPending || dimensionPending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy || Boolean(currentSketchPlaneRequest || currentReferencePick)} onChange={(event) => { setNameDraft(event.target.value); setNamePending(event.target.value !== document.name); }} onBlur={(event) => { if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute('data-cad-panel-resizer')) return; if (nameDraft !== document.name) submitEdit(signal => props.onEdit({ kind: 'rename-document', name: nameDraft }, signal), () => setNamePending(false)); }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); commandSubmission.cancel(); setNameDraft(document.name); setNamePending(false); } }} />
      <span className={`cad-save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Unsaved' : ''}</span>
      {buildState === 'error' && <span className="cad-header-build-state" role="status">Feature needs attention</span>}
      <div className="cad-header-actions">
        <div className="cad-menu-anchor"><Button ref={fileMenuTrigger} disabled={locked} aria-haspopup="menu" aria-expanded={fileMenu} aria-controls="cad-file-menu" onClick={() => setFileMenu(!fileMenu)}>File <ChevronDown size={12} /></Button>{fileMenu && <><Button variant="scrim" tabIndex={-1} className="cad-menu-scrim" aria-label="Close file menu" onClick={() => setFileMenu(false)} /><MenuSurface ref={fileMenuPanel} onKeyDown={event => {
          if (event.key !== 'Tab' || event.nativeEvent.isComposing) return;
          event.preventDefault(); event.stopPropagation();
          const trigger = fileMenuTrigger.current, toolbar = trigger?.closest('.cad-header-actions');
          const controls = [...toolbar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []]
            .filter(control => !fileMenuPanel.current?.contains(control) && !control.classList.contains('cad-menu-scrim'));
          const index = controls.findIndex(control => control === trigger);
          setFileMenu(false); (controls[index + (event.shiftKey ? -1 : 1)] ?? trigger)?.focus();
        }} onDismiss={() => { setFileMenu(false); fileMenuTrigger.current?.focus(); }} className="cad-file-menu" id="cad-file-menu" aria-label="CAD document commands"><MenuItem onClick={() => run(props.onNewDocument)}><FilePlus2 size={14} /> New part</MenuItem><MenuItem onClick={() => run(props.onOpenDocument)}><FolderOpen size={14} /> Open saved part</MenuItem><MenuItem onClick={() => { setFileMenu(false); fileInput.current?.click(); }}><FolderOpen size={14} /> Import file</MenuItem>{props.onCaptureViewport && <MenuItem disabled={locked || (!canvasReference && (hasActiveBodyFeatures ? !hasSolid || props.buildVersion !== props.documentVersion : references.length === 0))} onClick={() => run(() => props.onCaptureViewport?.())}><CameraCaptureIcon size={14} /> Capture view PNG</MenuItem>}<MenuSeparator />{props.onRebuild && <MenuItem disabled={locked} onClick={() => run(() => props.onRebuild?.())}><RefreshIcon size={14} /> Rebuild model</MenuItem>}<MenuItem onClick={() => run(props.onExportDocument)}><Download size={14} /> Download CAD document</MenuItem><MenuItem disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('step'))}><Download size={14} /> Export STEP</MenuItem><MenuItem disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('stl'))}><Download size={14} /> Export STL</MenuItem><MenuItem disabled={!document.features.some(feature => !feature.suppressed && (feature.kind === 'sketch' && hasMaterial(feature) || feature.kind === 'curve')) && !hasSolid || !props.onOpenDxfExport} onClick={() => run(() => props.onOpenDxfExport?.())}><Download size={14} /> Export DXF</MenuItem><Tooltip content={CAD_KERNEL_THIRD_PARTY.description}><MenuItem asChild><a href={CAD_KERNEL_THIRD_PARTY.href} aria-label={CAD_KERNEL_THIRD_PARTY.label}  target="_blank" rel="noopener noreferrer">Geometry kernel licenses</a></MenuItem></Tooltip><MenuSeparator />{props.onSectionForCam && <MenuItem disabled={locked || !sectionBodyId || !hasSolid || props.buildVersion !== props.documentVersion || Boolean(build?.diagnostics.length)} title="Create CAM geometry from a planar section" onClick={() => sectionBodyId && run(() => props.onSectionForCam?.(sectionBodyId))}><SectionCamIcon size={14} /> Section for CAM</MenuItem>}<MenuItem disabled={locked || (!selectedSketch || !hasMaterial(selectedSketch))} onClick={() => selectedSketch && run(() => props.onSendToCam(selectedSketch.id))}><SendCamIcon size={14} /> Send sketch to CAM</MenuItem></MenuSurface></>}</div>
        <Button aria-label="Undo" title="Undo · Ctrl+Z" disabled={!canUndo || locked} onClick={() => run(props.onUndo)}><Undo2 size={15} /></Button><Button aria-label="Redo" title="Redo · Ctrl+Shift+Z" disabled={!canRedo || locked} onClick={() => run(props.onRedo)}><Redo2 size={15} /></Button>
        <Button disabled={locked} onClick={() => run(props.onSave)}><Save size={14} /> {storageBusy ? 'Working…' : 'Save'}</Button>

      </div>
      <Input ref={fileInput} type="file" accept=".wireedm-cad,.json,.step,.stp,.stl,.dxf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) run(() => props.onImportDocument(file)); event.target.value = ''; }} />
    </div>;

  const toolbar = <div className="cad-toolbar" aria-label="CAD tools" data-cad-tool-context={sketch ? 'sketch' : curve || curveCreation ? 'curve' : 'model'} inert={deleteFeature || pluginsOpen || externalWorkflowOpen || currentCanvasMenu || treeMenuOpen ? true : undefined}>
      {!canvasReference && <div className="cad-tool-group">{toolButton('Sketch', SketchIcon, startSketch, locked)}{toolButton('Plane', DatumPlaneIcon, () => startFeature('datum-plane'), locked)}{toolButton('Curve', CurveIcon, () => startFeature('curve'), locked)}</div>}
      <div className="cad-tool-group">{toolButton('Plugins', AddIcon, () => setPluginsOpen(true), locked)}</div>
      {sketch ? <><div className="cad-tool-group">{toolButton('Select', SelectIcon, () => setTool('select'), locked, tool === 'select')}{toolButton('Rectangle', RectangleIcon, () => { setTool('rectangle'); setProfileId(null); }, locked, tool === 'rectangle')}{toolButton('Circle', CircleIcon, () => { setTool('circle'); setProfileId(null); }, locked, tool === 'circle')}{toolButton('Slot', SlotIcon, () => { setTool('slot'); setProfileId(null); }, locked, tool === 'slot')}{toolButton('Polyline', PolylineIcon, () => { setTool('polygon'); setProfileId(null); }, locked, tool === 'polygon')}{toolButton('Path', ClosedPathIcon, () => { setTool('path'); setProfileId(null); }, locked, tool === 'path', 'Draw a closed path with lines and three-point arcs')}</div><div className="cad-tool-group">{toolButton('Dimension', MeasureIcon, () => beginProfileCommand('dimension'), locked || !sketchDimensionAvailable)}{toolButton('Move profile', MoveIcon, () => beginProfileCommand('move'), locked || !profile || profile.geometry.kind === 'plugin')}<CadEdgeTreatmentCommand context="sketch" disabled={locked || profile?.geometry.kind !== 'rectangle'} onChoose={() => beginProfileCommand('fillet')} /></div><div className="cad-sketch-options"><label><Input type="checkbox" checked={construction} disabled={locked} onChange={(event) => setConstruction(event.target.checked)} /> Construction</label></div></> : curve || curveCreation ? null : <><div className="cad-tool-group">{toolButton('Pad / Pocket', PadPocketIcon, () => startFeature('extrude'), locked || !hasSketch)}{toolButton('Revolve', RevolveIcon, () => startFeature('revolve'), locked || !hasSketch)}{toolButton('Loft', LoftIcon, () => startFeature('loft'), locked || document.features.filter(feature => feature.kind === 'sketch' && !feature.suppressed).length < 2, false, 'Loft through ordered sketch sections')}{toolButton('Sweep', SweepIcon, () => startFeature('sweep'), locked || !activeSketches.some(hasMaterial) || !document.features.some(feature => feature.kind === 'curve' && !feature.suppressed), false, 'Sweep a profile along a reference Curve')}</div><div className="cad-tool-group"><CadEdgeTreatmentCommand disabled={locked || !hasBody} onChoose={kind => startFeature(kind)} />{toolButton('Shell', ShellIcon, () => startFeature('shell'), locked || !topologyReady || !props.onResolveSelection || topologySelection?.picks[0]?.kind !== 'face')}{toolButton('Boolean', BooleanIcon, () => startFeature('boolean'), locked || currentBodyIds.length < 2)}</div><div className="cad-tool-group">{toolButton('Move', Move3dIcon, () => startFeature('transform'), locked || !hasBody)}<CadPatternCommand disabled={locked || !hasBody} onChoose={kind => startFeature(kind)} />{toolButton('Mirror', MirrorIcon, () => startFeature('mirror'), locked || !hasBody)}</div></>}
    </div>;
  return <main className="cad-workbench" aria-label="Parametric CAD workbench">
    {publishHeader ? headerHost && createPortal(header, headerHost) : header}
    <div className="cad-body" inert={deleteFeature || pluginsOpen || externalWorkflowOpen || currentCanvasMenu || treeMenuOpen ? true : undefined}>
      <section className="cad-center" aria-label="Modeling area"><CadCommandDock toolbar={toolbar}>{canvasReference ? <CadSketchCanvas getFitArea={getFitArea} onContextMenu={openSketchMenu} navigationMode={preferences.navigationMode} dimensionControls={preferences.showOnPartDimensions ? { document, onEditMany: props.onEditMany, onPendingChange: setDimensionPending, interactionLocked: commandSubmission.applying || externalWorkflowOpen || pluginsOpen || editorPending || parameterPending || namePending || treeRenamePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy, onInspectInput: inspectInput, onConfigure: name => { setInspectorCollapsed(false); inspectInput(name); } } : undefined} previewProfile={profilePreview} previewSketch={preparedSketch} inspection={sketchInspection} key={`${document.id}/${canvasReference.id}`} sketch={canvasReference} documentVersion={props.documentVersion} parameters={preparedSketchDocument?.parameters ?? previewParameters ?? document.parameters} placementLabel={cadPlacementLabel(canvasReference.plane, document.features)} tool={tool} selectedProfileId={profileId} onSelectProfile={canvasReference.kind === 'curve' ? () => undefined : selectProfile} onAddProfile={addProfile} onTranslateProfile={(id, translation, signal) => { if (!sketch) return; return applyCanvasEdits([{ kind: 'translate-sketch-profiles', sketchId: sketch.id, profileIds: [id], translation }], signal); }} onMoveHandle={(id, handle, translation, signal) => { if (!sketch) return; return applyCanvasEdits([{ kind: 'move-sketch-handle', sketchId: sketch.id, profileId: id, handle, translation }], signal); }} onAddCurve={addCurve} onCancelCurve={cancel} curveCreation={Boolean(curveCreation)} onPendingChange={setDrawingPending} onError={setError} cancelSignal={cancelSignal} interactionLocked={curveCreation ? commandSubmission.applying || editorPending || parameterPending || namePending || storageBusy || deleteFeature !== null || resolvingTopology !== null : pendingOutsideDrawing || storageBusy} viewLocked={navigationLocked} onControlsReady={publishRenderedControls} /> : <CadViewport key={document.id} depthControl={currentDepthControl} busyInputLocked={storageBusy} regionSelection={currentRegionPick} sourceReferencePickIds={currentRegionPick ? regionReferenceIds : currentReferencePick?.eligibleIds} getFitArea={getFitArea} onContextMenu={currentOwnedPick || currentSketchPlaneRequest ? undefined : openSolidMenu} navigationMode={preferences.navigationMode} navigationLocked={navigationLocked} meshes={displayedMeshes} references={references} referenceVersion={candidatePreview?.candidateId ?? props.documentVersion} selectedId={newFeature?.id ?? selectedId} selectedReferencePlane={selectedReferencePlane} onSelect={choose} onSelectPlane={selectReferencePlane} planePickingOnly={Boolean(currentSketchPlaneRequest)} interactionLocked={locked && !currentOwnedPick && !currentSketchPlaneRequest} onControlsReady={publishRenderedControls} pickMode={currentOwnedPick || currentSketchPlaneRequest ? 'body' : pickMode} topologySelection={candidatePreview || currentOwnedPick ? null : topologySelection} pickingEnabled={Boolean(currentOwnedPick) || topologyReady && !candidatePreview} onPickMode={!currentOwnedPick && !currentSketchPlaneRequest && props.onInspectTopology && props.onResolveSelection ? (mode) => run(() => viewportControls.apply({ kind: 'set-pick-mode', mode })) : undefined} onTopologyPick={currentOwnedPick || currentSketchPlaneRequest ? undefined : pickTopology} />}
        {currentSketchPlaneRequest && <div className="cad-plane-request" role="status"><PencilRuler size={14} /><span>Select a plane in the design area</span><Button aria-label="Cancel plane selection" onClick={cancel}>Cancel</Button></div>}
        {buildState === 'building' && <div className="cad-build-overlay" role="status"><Loader2 size={13} className="cad-spin" /> Building solid geometry…</div>}
        <div className="cad-tree-overlay" data-cad-model-tree aria-label="Feature tree and parameters">{specificationTree}</div>
        </CadCommandDock>
      </section>
      {inspectorVisible && <aside key={`configuration-${externalWorkflowOpen}-${pluginsOpen}`} className={`cad-properties cad-floating-inspector${floatingPluginInspector ? ' cad-plugin-inspector' : ''}${inspectorCollapsed ? ' is-minimized' : ''}`} data-cad-properties aria-label="Feature properties"><div className="cad-panel-heading"><span>{currentRegionPick ? 'Choose areas' : sketch ? sketch.name : curve ? curve.name : newFeature ? 'New feature' : profile ? 'Configuration' : 'Properties'}</span>{currentRegionPick ? <><Button variant="primary" className="cad-panel-finish" aria-label="Finish area selection" title="Keep these areas" onClick={currentRegionPick.onFinish}><Check size={16} /></Button><Button aria-label="Cancel area selection" title="Restore previous area choice" onClick={currentRegionPick.onCancel}><CloseIcon size={13} /></Button></> : <>{sketch && <Button variant="primary" className="cad-panel-finish" aria-label="Finish sketch" title="Finish sketch" disabled={locked} onClick={finishSketch}><Check size={16} /></Button>}{curve && !curveCreation && <Button variant="primary" className="cad-panel-finish" aria-label="Finish curve editing" title="Finish curve editing" disabled={locked} onClick={finishCurve}><Check size={16} /></Button>}<Button aria-label={inspectorCollapsed ? 'Expand configuration' : 'Minimize configuration'} aria-expanded={!inspectorCollapsed} disabled={pending} onClick={() => setInspectorCollapsed(!inspectorCollapsed)}>{inspectorCollapsed ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</Button>{(selected || profile) && !newFeature && <Button aria-label="Delete selected feature or profile" disabled={locked} onClick={removeSelected}><Trash2 size={13} /></Button>}</>}</div>
        {currentRegionPick && <div className="cad-region-pick-hint" role="status">Click an area · Shift adds or removes</div>}
        <div hidden={inspectorCollapsed}>
        {resolvingTopology && <div className="cad-topology-resolving" role="status"><Loader2 size={14} className="cad-spin" /><span>Verifying {resolvingTopology === 'shell' ? 'opening face' : 'selected edges'}…</span><Button onClick={cancel}>Cancel</Button></div>}
        {!newFeature && !sketch && !resolvingTopology && props.onInspectTopology && topologyReady && build && (topologySelection?.bodyId ?? (selected && currentBodyIds.includes(selected.id) ? selected.id : null)) && <CadTopologyInspector key={`${props.documentVersion}-${build.buildId}-${topologySelection?.bodyId ?? selectedId}-${pickMode}`} bodyId={topologySelection?.bodyId ?? selectedId ?? ''} buildId={build.buildId} documentVersion={props.documentVersion} pickMode={pickMode} selection={topologySelection} locked={locked} onInspect={props.onInspectTopology} onSelect={(pick, additive) => pickTopology({ bodyId: topologySelection?.bodyId ?? selectedId ?? '', pick }, additive)} onClear={() => run(() => viewportControls.apply({ kind: 'clear-topology' }))} />}
        <fieldset className="cad-editor-fieldset" disabled={commandSubmission.applying || drawingPending && !curveCreation || parameterPending || dimensionPending || namePending || treeRenamePending || storageBusy || resolvingTopology !== null}>{curveCreation ? <CadCurveCreationFields draft={curveCreation} document={document} onChange={setNewFeature} onCancel={cancel} /> : newFeature ? <CadFeatureEditor onDepthInteractionReady={publishDepthInteraction} onReferencePick={requestReferencePick} key={`${newFeature.id}-${cancelSignal}`} feature={newFeature} document={document} documentVersion={props.documentVersion} onFeaturePreview={props.onFeaturePreview} featurePreview={props.featurePreview} previewEnabled={previewEnabled} isNew currentBodyIds={currentBodyIds} onApply={applyFeature} onCancel={cancel} onPendingChange={setEditorPending} /> : profile && sketch ? selectedProfileEditor : selected ? <><CadFeatureEditor onDepthInteractionReady={publishDepthInteraction} onReferencePick={requestReferencePick} key={`${selected.id}-${cancelSignal}`} feature={selected} document={document} documentVersion={props.documentVersion} onFeaturePreview={props.onFeaturePreview} featurePreview={props.featurePreview} previewEnabled={previewEnabled} isNew={false} onApply={applyFeature} onCancel={cancel} onPendingChange={setEditorPending} />{selected.kind === 'curve' && <div className="cad-context-actions">{!curve && <Button disabled={locked || selected.suppressed} onClick={() => editCurve(selected)}><Spline size={13} /> Edit curve</Button>}</div>}{selected.kind === 'sketch' && <div className="cad-context-actions"><Button disabled={locked} onClick={() => editSketch(selected)}><PencilRuler size={13} /> Edit sketch</Button></div>}<div className="cad-context-actions"><label className="cad-check"><Input type="checkbox" disabled={locked} checked={selected.suppressed} onChange={(event) => { const suppressed = event.target.checked; submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...selected, suppressed } }, signal)); }} /> Suppress feature</label></div>{displayedMeshes.filter((mesh) => mesh.featureId === selected.id).map((mesh) => <div className="cad-solid-info" key={mesh.featureId}><span>Solid volume</span><strong>{formatCadLocalizedQuantity(mesh.volume, 3)} mm³{mesh.solidCount !== undefined && mesh.solidCount > 1 ? ` · ${mesh.solidCount} solids` : ''}</strong></div>)}</> : null}{selectedCurve && !newFeature && <CadCurveMeasurements curve={selectedCurve} document={document} />}{selectedSketch && !newFeature && !floatingPluginInspector && <CadSketchMeasurements document={measurementDocument} sketchId={selectedSketch.id} profileId={profileId} />}</fieldset>
        </div>
      </aside>}
    </div>
    {deleteFeature && <div className="cad-dialog-backdrop"><div ref={deleteDialog} className="cad-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="cad-delete-title"><h2 id="cad-delete-title">Delete {deleteFeature.name}?</h2>{dependentNames.length ? <><p>This also deletes {dependentNames.length} dependent feature{dependentNames.length === 1 ? '' : 's'}.</p><ul>{dependentNames.map((name) => <li key={name}>{name}</li>)}</ul></> : <p>You can restore this feature with Undo.</p>}<div className="cad-form-actions"><Button onClick={() => { commandSubmission.cancel(); setDeleteFeature(null); }}>Cancel</Button><Button variant="danger" className="cad-danger" disabled={commandSubmission.applying} onClick={() => submitEdit(signal => props.onEdit({ kind: 'delete-feature', featureId: deleteFeature.id, cascade: dependentNames.length > 0 }, signal), () => { setDeleteFeature(null); setSelectedId(current => current === deleteFeature.id ? null : current); })}><Trash2 size={13} /> Delete{dependentNames.length ? ' with dependents' : ''}</Button></div></div></div>}
    {currentCanvasMenu && canvasMenuItems.length > 0 && <CadContextMenu anchor={{ x: currentCanvasMenu.request.clientX, y: currentCanvasMenu.request.clientY }} title={canvasMenuTitle} items={canvasMenuItems} onClose={() => setCanvasMenu(null)} />}
    {pluginsOpen && <CadPluginsPanel onClose={() => { commandSubmission.cancel(); setPluginsOpen(false); }} onAdd={addPlugin} onListPlugins={props.onListPlugins} onInstallPlugin={props.onInstallPlugin} />}
  </main>;
}

export default CadWorkbench;
