import { userFacingMessage } from '@/lib/userMessage';
import { MenuItem, MenuSeparator, MenuSurface } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import type { CadPrepareEdits } from './useCadPreparedPreview';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { CAD_SKETCH_DATUMS, cadSketchDatumLabels, isCadSketchGraphSelected, reconcileCadSketchGraphSelection, toggleCadSketchGraphSelection, type CadSketchDatum, type CadSketchGeometryPick, cadSketchGraphSelectionsEqual } from './cadSketchGraphSelection';
import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { createCadFreshSketchDrawing, createCadFreshSketchGraph, type CadFreshSketchDrawing } from '@/domain/cad/cadFreshSketchGraph';
import { createCadPathDraftGraph } from './cadPathDraftGraph';
import { inspectCadSketchCornerTarget } from '@/domain/cad/cadSketchCornerTreatment';
import type { CadPathDraft } from './cadPathDrawing';
import { CadSketchRelationsPanel, type CadSketchRelationCommand } from './CadSketchRelationsPanel';
import type { CadSketchDimensionRelation } from './cadSketchGraphDimensionLayout';
import { CadSketchAreaRepairPanel } from './CadSketchAreaRepairPanel';
import { CadSketchOffsetEditor, cadSketchOffsetSource } from './CadSketchOffsetEditor';
import { CadSketchLinearPatternEditor, type CadSketchLinearPatternRequest, type CadSketchLinearPatternInteraction } from './CadSketchLinearPatternEditor';
import { cadSketchLinearPatternForSelection, cadSketchLinearPatternLockReason } from '@/domain/cad/cadSketchLinearPattern';
import { CadSketchMirrorEditor, type CadSketchMirrorInteraction } from './CadSketchMirrorEditor';
import { CadSketchPlacementEditor, type CadSketchPlacementInteraction } from './CadSketchPlacementEditor';
import { CadSketchProfileCopyEditor } from './CadSketchProfileCopyEditor';
import { CadSketchReferenceEditor, type CadSketchReferenceInteraction } from './CadSketchReferenceEditor';
import { cadSketchReferenceSources, cadSketchExternalReferenceLockReason } from '@/domain/cad/cadSketchExternalReferences';
import type { CadSketchProfileCopyRequest } from '@/domain/cad/cadSketchProfileCopy';
import { Value } from '@sinclair/typebox/value';
import type { CadSketchOffsetSource } from '@/domain/cad/cadSketchOffset';
import type { CadSketchAreaRepairInspection, CadSketchAreaRepairs } from './cadSketchEditDraft';
import { CadSketchConstraintStatus, type CadInspectSketchConstraints } from './CadSketchConstraintStatus';
import type { CadSketchConstraintFeedbackSubject } from './cadSketchConstraintFeedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useOptionalAppRail } from '@/app/AppRailContext';
import { AddIcon, ArrowLeft, BooleanIcon, CameraCaptureIcon, Check, ChevronDown, ChevronRight, CircleIcon, ClosedPathIcon, CloseIcon, CurveIcon, DatumPlaneIcon, Download, FilePlus2, FolderOpen, Loader2, LinkIcon, LoftIcon, MeasureIcon, ConstraintIcon, MirrorIcon, Move3dIcon, MoveIcon, OffsetIcon, PadPocketIcon, PencilRuler, PolylineIcon, RectangleIcon, Redo2, RefreshIcon, RevolveIcon, Save, SectionCamIcon, SelectIcon, SendCamIcon, ShellIcon, SketchIcon, SlotIcon, SweepIcon, Trash2, TrimIcon, Undo2, type WorkbenchIconComponent } from '@wire-edm/icons-react';

import { CadFeatureTree } from './CadFeatureTree';
import { CadCommandDock } from './CadCommandDock';
import type { CadBuildResult, CadCurveFeature, CadDocument, CadFeature, CadPathSegment, CadPlane, CadSketchPlane, CadProfile, CadSketchFeature, CadSketchProfile } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadTopologyPickSet, CadTopologyResolvePicksRequest, CadTopologyResolvePicksResult } from '@/domain/cad/cadTopology';
import { cadFeatureDependencies, cadFeatureProducesBody, cadVisibleBodyIds } from '@/domain/cad/cadSchema';
import { CadFeatureEditor, CadProfileEditor, featureLabels } from './CadFeatureEditor';
import { CadSketchProfilePanel, type CadSketchProfileCommand } from './CadSketchProfilePanel';
import { cadSketchDimensionQuantities, inspectCadSketchDimensions } from '@/domain/cad/cadSketchConstraints';
import { cadSketchSourceAvailability, cadSketchSourceIssue, cadSketchSourceIssueMessage, pickCadSketchSource, type CadSketchSourcePurpose } from '@/domain/cad/cadSketchSources';
import { CadSketchCanvas, type CadSketchContextMenuRequest } from './CadSketchCanvas';
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
import { CadToolbarMenu } from './CadToolbarMenu';
import { CAD_SKETCH_CONSTRAINT_TOOLS, cadSketchConstraintChoices, cadSketchConstraintStep, cadSketchConstraintToolHelp, cadSketchConstraintToolLabels, type CadSketchConstraintChoice, type CadSketchConstraintPick, type CadSketchConstraintTool } from './cadSketchConstraintTool';
import { cadSketchRelationPlacement } from '@/domain/cad/cadSketchRelationPlacement';
import { CadEdgeTreatmentCommand } from './CadEdgeTreatmentCommand';
import { CadPluginsPanel, type CadPluginCommands } from './CadPluginsPanel';
import { type CadPluginPackage } from '@/domain/cad/plugins/cadPlugins';
import { inspectCadParameters, type CadParameterUsage } from '@/domain/cad/cadParameters';
import { CadParametersPanel, type CadParametersPanelControls } from './CadParametersPanel';
import { CadInspectorTitle, CadInspectorTitleContext, type CadInspectorTitleHost } from './CadInspectorTitle';
import { initialCadLoftSketchIds, inspectCadLoftCandidates } from './cadLoftUi';
import { createCadSelectEscapeGuard } from './cadSelectEscape';
import { CadCurveCreationFields } from './CadCurveCreationFields';
import { CAD_PRINCIPAL_PLANE_REFERENCES, cadReferenceFeatureIds, cadReferencePlanes, prepareCadViewportReferences, selectCadViewportReferences } from './cadViewportReferences';
import { cadPlacementLabel } from './cadPlacementUi';
import { cadPropertySummary } from './cadPropertySummary';
import { initialCadSweepSourceIds, inspectCadSweepCandidates } from './cadSweepUi';
import { useCadNotifications, type CadNotificationState } from './useCadNotifications';
import { cadFeatureCandidateEdits, type CadFeaturePreviewCommand, type CadFeaturePreviewState } from './cadFeaturePreview';
import { useCadPreferences } from './cadPreferences';
import type { CadFeatureReferencePickCommand } from './cadFeatureReferencePicking';
import { useCadFeatureTopologyPick, type CadFeatureInputPicking } from './useCadFeatureTopologyPick';
import type { CadExtrudeDepthControl } from './cadExtrudeDepthInteraction';
import { cadUnobscuredFitArea, type CadFitAreaReader } from './cadFitArea';
const NO_MESHES: readonly CadBuildResult['meshes'][number][] = Object.freeze([]);
const NO_SKETCH_SELECTIONS: readonly CadSketchGraphSelection[] = Object.freeze([]);
const NO_SKETCH_DATUMS: readonly CadSketchDatum[] = Object.freeze([]);
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
  sketchAnalysisReady?: boolean;
  onBeginSketchEdit?(sketchId: string): void;
  sketchEdit?: { readonly sketchId: string; inspectAreaRepairs(): CadSketchAreaRepairInspection | null; finish(signal?: AbortSignal, repairs?: CadSketchAreaRepairs): CadEditCompletion; cancel(): void };
  onEdit(edit: CadEdit, signal?: AbortSignal): CadEditCompletion;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPrepareEdits?: CadPrepareEdits;
  onInspectSketchConstraints?: CadInspectSketchConstraints;
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
  featureInputPicking?: CadFeatureInputPicking;
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
  /** Selecting keeps a feature highlighted; only an explicit open shows its editor. */
  const [openFeatureId, setOpenFeatureId] = useState<string | null>(null);
  const [planeSelection, setPlaneSelection] = useState<{ documentId: string; plane: CadSketchPlane } | null>(null);
  /** A plane pick either creates a sketch or, with `replaceSketchId`, moves that sketch onto the picked plane. */
  const [sketchPlaneRequest, setSketchPlaneRequest] = useState<{ document: CadDocument; version: string; replaceSketchId?: string } | null>(null);
  /** Read-only measurements open on request from a context menu, never from a plain selection; `selection` follows the selected feature. */
  const [properties, setProperties] = useState<{ readonly kind: 'body' | 'selection' } | null>(null);
  const planeRequestOwner = useRef<typeof sketchPlaneRequest>(null);
  const [sketchId, setSketchId] = useState<string | null>(null);
  const [curveId, setCurveId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [graphPick, setGraphPick] = useState<{ sketchId: string; selections: readonly CadSketchGraphSelection[]; datums?: readonly CadSketchDatum[] } | null>(null);
  const [dimensionPickRequest, setDimensionPickRequest] = useState<{ readonly document: CadDocument; readonly version: string; readonly sketchId: string; readonly previousTool: SketchTool; readonly previousGraphPick: typeof graphPick; readonly previousProfileId: string | null; readonly eligibleEntityIds: readonly string[]; readonly eligiblePointIds: readonly string[]; readonly firstPointId: string | null; readonly firstLineId: string | null; readonly firstDatum: CadSketchDatum | null } | null>(null);
  const [graphRelationCommand, setGraphRelationCommand] = useState<(CadSketchRelationCommand & { token: string }) | null>(null);
  const [offsetCommand, setOffsetCommand] = useState<{ sketchId: string; source: CadSketchOffsetSource; token: string } | null>(null);
  const [mirrorCommand, setMirrorCommand] = useState<{ sketchId: string; entityIds: readonly string[]; token: string } | null>(null);
  const [patternCommand, setPatternCommand] = useState<{ sketchId: string; request: CadSketchLinearPatternRequest; token: string } | null>(null);
  const [patternInteraction, setPatternInteraction] = useState<CadSketchLinearPatternInteraction | null>(null);
  const [mirrorInteraction, setMirrorInteraction] = useState<CadSketchMirrorInteraction | null>(null);
  const [placementCommand, setPlacementCommand] = useState<{sketchId:string;selections:readonly CadSketchGraphSelection[];token:string}|null>(null);
  const [placementInteraction, setPlacementInteraction] = useState<CadSketchPlacementInteraction|null>(null);
  const [sketchReferenceCommand, setSketchReferenceCommand] = useState<{ sketchId: string; token: string } | null>(null);
  const [sketchReferenceInteraction, setSketchReferenceInteraction] = useState<CadSketchReferenceInteraction | null>(null);
  const [profileCopyCommand, setProfileCopyCommand] = useState<{ request: CadSketchProfileCopyRequest; token: string } | null>(null);
  const [profileCopyPreview, setProfileCopyPreview] = useState<CadDocument | null>(null);
  const [profileCopyAccepted, setProfileCopyAccepted] = useState<{ document: CadDocument; sketchId: string } | null>(null);
  const [relationInspection, setRelationInspection] = useState<{ sketchId: string; relation: CadSketchGraphRelation } | null>(null);
  const [diagnosticInspection, setDiagnosticInspection] = useState<{ document: CadDocument; sketchId: string; subject: CadSketchConstraintFeedbackSubject } | null>(null);
  const [sketchFreedom, setSketchFreedom] = useState<{ document: CadDocument; version: string; sketchId: string; value: number | null } | null>(null);
  const [newFeature, setNewFeature] = useState<CadFeature | null>(null);
  const [tool, setTool] = useState<SketchTool>('select');
  /** A positional constraint tool stays active across commits; its picks belong to the document they were made on. */
  const [constraintToolRequest, setConstraintToolRequest] = useState<{ readonly sketchId: string; readonly tool: CadSketchConstraintTool; readonly document: CadDocument; readonly picks: readonly CadSketchConstraintPick[] } | null>(null);
  const [construction, setConstruction] = useState(false);
  const [fileMenu, setFileMenu] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useCadNotifications({ document, documentVersion: props.documentVersion, build, buildVersion: props.buildVersion,
    buildState, errorMessage: error || props.errorMessage || null, onStatusMessage: props.onStatusMessage });
  const [drawingPending, setDrawingPending] = useState(false);
  const [editorPending, setEditorPending] = useState(false);
  const [areaRepair, setAreaRepair] = useState<{ document: CadDocument; inspection: CadSketchAreaRepairInspection } | null>(null);
  const [areaRepairReady, setAreaRepairReady] = useState(false), areaRepairFormId = useId();
  const currentAreaRepair = areaRepair?.document === document && areaRepair.inspection.localVersion === props.documentVersion && props.sketchEdit ? areaRepair.inspection : null;
  useLayoutEffect(() => { if (areaRepair && !currentAreaRepair) setAreaRepair(null); }, [areaRepair, currentAreaRepair]);
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
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [titleClaims, setTitleClaims] = useState(0);
  const titleHost = useMemo<CadInspectorTitleHost>(() => ({ slot: titleSlot, claim: () => { setTitleClaims(count => count + 1); return () => setTitleClaims(count => count - 1); } }), [titleSlot]);
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
  const [pickMode, setPickMode] = useState<CadPickMode>('auto');
  const [pickedTopology, setPickedTopology] = useState<CadTopologyPickSet | null>(null);
  const [resolvingTopology, setResolvingTopology] = useState<'fillet' | 'chamfer' | 'shell' | null>(null);
  const topologyResolution = useRef<{ controller: AbortController; source: CadTopologyPickSet } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const parameterControls = useRef<CadParametersPanelControls>(null);
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
  const dimensionPickBlocked = commandSubmission.applying || editorPending || parameterPending || dimensionPending || namePending || treeRenamePending || pluginsOpen || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || storageBusy || externalWorkflowOpen;
  const currentDimensionPick = !dimensionPickBlocked && dimensionPickRequest?.document === document && dimensionPickRequest.version === props.documentVersion && dimensionPickRequest.sketchId === sketchId ? dimensionPickRequest : null;
  const dimensionPickOwner = useRef(currentDimensionPick); dimensionPickOwner.current = currentDimensionPick;
  useLayoutEffect(() => { if (dimensionPickRequest && !currentDimensionPick) setDimensionPickRequest(null); }, [dimensionPickRequest, currentDimensionPick]);
  const referenceContextBlocked = drawingPending || pluginsOpen || parameterPending || dimensionPending || namePending || treeRenamePending || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || externalWorkflowOpen;
  const referencePickBlocked = referenceContextBlocked || storageBusy;
  const currentOwnedPick = !referencePickBlocked && referencePick?.document === document && referencePick.command.expectedVersion === props.documentVersion
    && (referencePick.command.kind === 'pick-regions' || referencePick.command.kind === 'pick-topology' || referencePick.buildId === (build?.buildId ?? null)) ? referencePick.command : null;
  const currentReferencePick = currentOwnedPick?.kind === 'pick' ? currentOwnedPick : null;
  const currentRegionPick = currentOwnedPick?.kind === 'pick-regions' ? currentOwnedPick : null;
  const currentTopologyPick = currentOwnedPick?.kind === 'pick-topology' ? currentOwnedPick : null;
  const inputPicker = useCadFeatureTopologyPick(currentTopologyPick, document, props.documentVersion, props.featureInputPicking);
  const regionReferenceIds = useMemo(() => currentRegionPick ? [currentRegionPick.sketchId] : [], [currentRegionPick?.sketchId]);
  const currentSketchPlaneRequest = !referencePickBlocked && !editorPending && !newFeature && !currentOwnedPick
    && sketchPlaneRequest?.document === document && sketchPlaneRequest.version === props.documentVersion ? sketchPlaneRequest : null;
  planeRequestOwner.current = currentSketchPlaneRequest;
  useLayoutEffect(() => { if (sketchPlaneRequest && !currentSketchPlaneRequest) setSketchPlaneRequest(null); }, [sketchPlaneRequest, currentSketchPlaneRequest]);
  useLayoutEffect(() => { if (referencePick && !currentOwnedPick) { referencePick.command.onCancel(); setReferencePick(null); } }, [referencePick, currentOwnedPick]);
  const canvasMenuBlocked = Boolean(currentDimensionPick) || drawingPending || pluginsOpen || editorPending || parameterPending || dimensionPending || namePending || treeRenamePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || storageBusy || externalWorkflowOpen || Boolean(currentOwnedPick);
  const currentCanvasMenu = !canvasMenuBlocked && canvasMenu?.document === document && canvasMenu.version === props.documentVersion && canvasMenu.buildId === (build?.buildId ?? null) ? canvasMenu : null;
  useLayoutEffect(() => { if (canvasMenu && !currentCanvasMenu) setCanvasMenu(null); }, [canvasMenu, currentCanvasMenu]);
  const pendingOtherCommands = commandSubmission.applying || pluginsOpen || parameterPending || dimensionPending || namePending || treeRenamePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || Boolean(currentCanvasMenu) || Boolean(currentOwnedPick) || Boolean(currentSketchPlaneRequest) || Boolean(currentAreaRepair);
  const pendingOutsideDrawing = editorPending || pendingOtherCommands || Boolean(currentDimensionPick);
  const pending = drawingPending || pendingOutsideDrawing;
  // Menu commands run after their menu closes, from a closure rendered while it was open.
  const latestPending = useRef(pending);
  latestPending.current = pending;
  const locked = pending || storageBusy || externalWorkflowOpen;
  /** Profile and offset editors yield to any other command, rename, storage or plugin workflow. */
  const sketchEditorLocked = commandSubmission.applying || drawingPending || parameterPending || dimensionPending || namePending || treeRenamePending || storageBusy || resolvingTopology !== null || externalWorkflowOpen || pluginsOpen;
  const interactionState = useRef({ locked, document, version: props.documentVersion, sketchId }); interactionState.current = { locked, document, version: props.documentVersion, sketchId };
  const currentSketchReferencePick = !pendingOtherCommands && !storageBusy && !externalWorkflowOpen && sketchReferenceCommand?.sketchId === sketchId && sketchReferenceInteraction?.kind === 'source' ? sketchReferenceInteraction : null;
  const treeLocked = Boolean(currentDimensionPick) || commandSubmission.applying || (currentReferencePick || currentSketchPlaneRequest || currentSketchReferencePick ? false : drawingPending || pluginsOpen || editorPending || parameterPending || dimensionPending || namePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy || externalWorkflowOpen || Boolean(currentCanvasMenu));
  const navigationLocked = commandSubmission.applying || drawingPending || pluginsOpen || treeRenamePending || externalWorkflowOpen || storageBusy || deleteFeature !== null || resolvingTopology !== null || treeMenuOpen || Boolean(currentCanvasMenu);
  const previewEnabled = !pluginsOpen && !treeRenamePending && !externalWorkflowOpen && !storageBusy && !treeMenuOpen && !currentCanvasMenu && !currentReferencePick && !currentTopologyPick;
  const selected = document.features.find((feature) => feature.id === selectedId);
  const selectedReferencePlane = useMemo<CadSketchPlane | null>(() => selected?.kind === 'datum-plane' && !selected.suppressed
    ? Object.freeze({ kind: 'datum-plane', featureId: selected.id }) : !selected && planeSelection?.documentId === document.id ? planeSelection.plane : null, [selected, planeSelection, document.id]);
  const principalPlanesVisible = typeof selectedReferencePlane === 'string';
  const sketch = document.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === sketchId);
  const graphSelections = useMemo(() => graphPick?.sketchId === sketch?.id ? reconcileCadSketchGraphSelection(sketch?.graph, graphPick?.selections ?? NO_SKETCH_SELECTIONS) : NO_SKETCH_SELECTIONS, [graphPick, sketch]);
  useLayoutEffect(() => {
    if (!graphPick || graphPick.selections === graphSelections) return;
    setGraphPick(current => current === graphPick ? graphSelections.length || current.datums?.length ? { ...current, selections: graphSelections } : null : current);
  }, [graphPick, graphSelections]);
  const graphDatums = graphPick?.sketchId === sketch?.id ? graphPick?.datums ?? NO_SKETCH_DATUMS : NO_SKETCH_DATUMS;
  const graphSelection = graphSelections.length === 1 ? graphSelections[0] : null;
  const graphPointPair = graphSelections.length === 2 && graphSelections.every(selection => selection.kind === 'point');
  const graphEntities = sketch?.graph?.entities.filter(entity => isCadSketchGraphSelected(graphSelections, { kind: 'entity', id: entity.id })) ?? [];
  const graphLinePair = graphSelections.length === 2 && graphEntities.length === 2 && graphEntities.every(entity => entity.kind === 'line');
  const selectedGraphEntity = graphSelection?.kind === 'entity' ? sketch?.graph?.entities.find(entity => entity.id === graphSelection.id) : null;
  const graphForReferences = sketch?.graph;
  const graphEditLock = graphForReferences ? graphSelections.map(atom => cadSketchLinearPatternLockReason(graphForReferences, atom) ?? cadSketchExternalReferenceLockReason(graphForReferences, atom)).find(Boolean) ?? null : null;
  const selectedPattern = graphForReferences && graphSelection ? cadSketchLinearPatternForSelection(graphForReferences, graphSelection) : null;
  const patternConstructionLocked = Boolean(graphForReferences && graphSelections.some(atom => cadSketchLinearPatternForSelection(graphForReferences, atom)));
  const sketchCornerAvailable = useMemo(() => {
    if (graphSelection?.kind !== 'point' || !sketch?.graph) return false;
    try { inspectCadSketchCornerTarget(sketch.graph, graphSelection.id, document.parameters); return true; } catch { return false; }
  }, [graphSelection, sketch, document.parameters]);
  const selectGraphSet = useCallback((selections: readonly CadSketchGraphSelection[], datums: readonly CadSketchDatum[] = NO_SKETCH_DATUMS) => {
    // Source controls and accepted creation callbacks supply known IDs; agent input is validated
    // at the viewport boundary. A creation callback can precede this render's graph update.
    setGraphPick(sketchId && (selections.length || datums.length) ? { sketchId, selections, datums } : null);
    setGraphRelationCommand(null);
    if (selections.length || datums.length) { setProfileId(null); setProfileCommand(null); }
  }, [sketchId]);
  const selectGraph = useCallback((selection: CadSketchGraphSelection | null, additive = false) => {
    selectGraphSet(selection ? additive ? toggleCadSketchGraphSelection(graphSelections, selection) : [selection] : NO_SKETCH_SELECTIONS, selection && additive ? graphDatums : NO_SKETCH_DATUMS);
  }, [graphSelections, graphDatums, selectGraphSet]);
  // The plane origin and axes join the selection like sketch points and edges, so a constraint can take them as operands.
  const selectDatum = useCallback((datum: CadSketchDatum, additive: boolean) => {
    selectGraphSet(additive ? graphSelections : NO_SKETCH_SELECTIONS, additive ? graphDatums.includes(datum) ? graphDatums.filter(item => item !== datum) : [...graphDatums, datum] : [datum]);
  }, [graphSelections, graphDatums, selectGraphSet]);
  const cancelDimensionPick = useCallback(() => {
    const request = dimensionPickOwner.current; dimensionPickOwner.current = null; setDimensionPickRequest(null);
    if (!request || request.document !== interactionState.current.document || request.version !== interactionState.current.version || request.sketchId !== interactionState.current.sketchId) return;
    setTool(request.previousTool); setGraphPick(request.previousGraphPick); setProfileId(request.previousProfileId);
  }, []);
  const inspectRelation = useCallback((relation: CadSketchGraphRelation | null) => setRelationInspection(relation && sketchId ? { sketchId, relation } : null), [sketchId]);
  const inspectedRelation = graphSelections.length > 0 && relationInspection && relationInspection.sketchId === sketch?.id ? relationInspection.relation : null;
  const inspectConstraintSubject = useCallback((subject: CadSketchConstraintFeedbackSubject | null) => setDiagnosticInspection(subject && sketchId ? { document, sketchId, subject } : null), [document, sketchId]);
  const inspectedDiagnostic = graphSelections.length > 0 && diagnosticInspection?.document === document && diagnosticInspection.sketchId === sketch?.id ? diagnosticInspection.subject : null;
  const publishSketchFreedom = useCallback((value: number | null) => {
    if (sketchId) setSketchFreedom({ document, version: props.documentVersion, sketchId, value });
  }, [document, props.documentVersion, sketchId]);
  const graphFreedom = sketchFreedom?.document === document && sketchFreedom.version === props.documentVersion && sketchFreedom.sketchId === sketch?.id ? sketchFreedom.value : null;
  const configureGraphRelation = useCallback((relation: CadSketchDimensionRelation) => {
    if (interactionState.current.locked || !sketch?.graph?.relations.some(item => item.id === relation.id)) return;
    if (relation.kind === 'reference-dimension') {
      const measurement = relation.measurement;
      if (measurement.kind === 'point-distance') selectGraphSet(measurement.pointIds.map(id => ({ kind:'point', id })));
      else selectGraph({ kind:'entity', id:measurement.entityId });
    } else if (relation.kind === 'distance') {
      const entity = sketch.graph.entities.find(item => item.kind === 'line' && relation.pointIds.includes(item.startPointId) && relation.pointIds.includes(item.endPointId));
      if (entity) selectGraph({ kind: 'entity', id: entity.id });
      else selectGraphSet(relation.pointIds.map(id => ({ kind: 'point', id })));
    } else if (relation.kind === 'axis-distance') selectGraphSet(relation.pointIds.map(id => ({ kind: 'point', id })));
    else if (relation.kind === 'line-angle') selectGraphSet(relation.rays.map(ray => ({ kind: 'entity', id: ray.lineId })));
    else selectGraph({ kind: 'entity', id: relation.kind === 'radial-size' ? relation.entityId : relation.kind === 'fillet-corner' ? relation.arcId : relation.chamferId });
    setGraphRelationCommand({ kind: 'inspect', relationId: relation.id, token: crypto.randomUUID() }); setInspectorCollapsed(false);
  }, [sketch, selectGraph, selectGraphSet]);
  useEffect(() => setGraphPick(null), [document.id, sketchId]);
  const curve = document.features.find((feature): feature is CadCurveFeature => feature.kind === 'curve' && feature.id === curveId);
  const curveCreation = newFeature?.kind === 'curve' ? newFeature : null;
  const canvasReference = curveCreation ?? curve ?? sketch;
  const preparedSketchDocument = (editorPending || drawingPending) && sketchPreview?.source === document ? sketchPreview.document : null;
  const preparedSketch = preparedSketchDocument?.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === sketch?.id);
  const depthVisualEligible = !pluginsOpen && !treeRenamePending && !externalWorkflowOpen && !treeMenuOpen && !currentCanvasMenu && !currentReferencePick;
  const currentDepthControl = preferences.showDepthHandles === true && !canvasReference && !currentOwnedPick && !currentSketchPlaneRequest
    && !referenceContextBlocked && depthVisualEligible && depthInteraction?.document === document
    && depthInteraction.control.baseVersion === props.documentVersion && depthInteraction.control.featureId === (newFeature?.id ?? selectedId)
    ? depthInteraction.control : null;
  const ownedPreview = props.featurePreview && props.featurePreview.kind !== 'idle' && props.featurePreview.baseVersion === props.documentVersion
    && (editorPending || newFeature !== null) && props.featurePreview.featureId === (newFeature?.id ?? selectedId) ? props.featurePreview : null;
  const candidatePreview = currentReferencePick || currentTopologyPick ? null : ownedPreview?.kind === 'ready' ? ownedPreview : ownedPreview?.lastValid ?? null;
  const displayedDocument = candidatePreview?.document ?? document;
  const displayedBuild = candidatePreview?.result ?? build;
  const preparedReferences = useMemo(() => prepareCadViewportReferences(displayedDocument.features, displayedDocument.parameters), [displayedDocument.features, displayedDocument.parameters]);
  const references = useMemo(() => currentTopologyPick ? [] : currentRegionPick ? preparedReferences.filter(reference => reference.featureId === currentRegionPick.sketchId && !reference.construction) : currentReferencePick ? preparedReferences.filter(reference => reference.featureId !== null && currentReferencePick.eligibleIds.includes(reference.featureId))
    : currentSketchPlaneRequest ? [...CAD_PRINCIPAL_PLANE_REFERENCES, ...preparedReferences.filter(reference => reference.featureKind === 'datum-plane')]
      : [...(principalPlanesVisible ? CAD_PRINCIPAL_PLANE_REFERENCES : []), ...selectCadViewportReferences(preparedReferences, displayedDocument.features, selectedId)],
    [preparedReferences, displayedDocument.features, selectedId, currentReferencePick, currentRegionPick, currentTopologyPick, currentSketchPlaneRequest, principalPlanesVisible]);
  const visibleReferenceIds = useMemo(() => cadReferenceFeatureIds(references), [references]);
  const visibleReferencePlanes = useMemo(() => cadReferencePlanes(references), [references]);
  const hasActiveBodyFeatures = document.features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature));
  const displayedMeshes = currentTopologyPick ? inputPicker.meshes : displayedDocument.features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature)) ? displayedBuild?.meshes ?? NO_MESHES : NO_MESHES;
  useEffect(() => { if (!hasActiveBodyFeatures) setPickMode('auto'); }, [hasActiveBodyFeatures]);
  const selectedSketch = selected?.kind === 'sketch' ? selected : sketch;
  const profile = sketch?.profiles.find((entry) => entry.id === profileId);
  const offsetSource = useMemo(() => sketch ? cadSketchOffsetSource(sketch, document.parameters, graphSelections, profileId) : null, [sketch, document.parameters, graphSelections, profileId]);
  const currentOffset = offsetCommand?.sketchId === sketch?.id ? offsetCommand : null;
  const currentPattern = patternCommand?.sketchId === sketch?.id ? patternCommand : null;
  useLayoutEffect(() => { if (patternCommand && !currentPattern) setPatternCommand(null); }, [patternCommand, currentPattern]);
  const currentMirror = mirrorCommand?.sketchId === sketch?.id ? mirrorCommand : null;
  const currentPlacement = placementCommand?.sketchId === sketch?.id ? placementCommand : null;
  const placementPositionPick = currentPlacement ? placementInteraction?.positionPick : undefined;
  useLayoutEffect(() => { if(placementCommand && !currentPlacement) setPlacementCommand(null); },[placementCommand,currentPlacement]);
  const currentSketchReference = sketchReferenceCommand?.sketchId === sketch?.id ? sketchReferenceCommand : null;
  const referenceSources = useMemo(() => sketch ? cadSketchReferenceSources(document, sketch.id) : [], [document, sketch]);
  useLayoutEffect(() => { if (sketchReferenceCommand && !currentSketchReference) setSketchReferenceCommand(null); }, [sketchReferenceCommand, currentSketchReference]);
  const copiedPreview = profileCopyCommand && profileCopyPreview?.features.find(feature => feature.kind === 'sketch' && feature.id === profileCopyCommand.request.newSketchId);
  const mirrorAxisPick = currentMirror && mirrorInteraction?.kind === 'choose-line' ? mirrorInteraction.pick : undefined;
  useLayoutEffect(() => { if (offsetCommand && !currentOffset) setOffsetCommand(null); }, [offsetCommand, currentOffset]);
  useLayoutEffect(() => { if (mirrorCommand && !currentMirror) setMirrorCommand(null); }, [mirrorCommand, currentMirror]);
  const dimensionGeometry = profile?.geometry;
  renderedPreferences.current = { navigationMode: preferences.navigationMode, onPartDimensionsVisible: preferences.showOnPartDimensions
    && tool === 'select' && (Boolean(sketch?.graph?.relations.some(relation => relation.kind === 'distance'))
      || !profilePreview && !preparedSketch && Boolean(profile && (inspectCadSketchDimensions(profile, document.parameters).length || dimensionGeometry?.kind === 'plugin' && dimensionGeometry.package.id === 'wireedm.spur-gear'))) };
  const parameterInspection = useMemo(() => inspectCadParameters(document), [document]);
  const parameterUsages = parameterInspection.parameters.find(parameter => parameter.name === inspectedParameter)?.usages.filter(usage => usage.active) ?? [];
  const highlightedProfiles = parameterUsages.filter(usage => usage.featureId === sketch?.id && usage.profileId).map(usage => usage.profileId).filter((id): id is string => typeof id === 'string');
  const gearUsage = parameterUsages.find(usage => usage.featureId === sketch?.id && usage.inputName && usage.profileId);
  const sketchInspection = currentOffset?.source.kind === 'profile' ? { profileIds: [currentOffset.source.profileId] } : inspectedParameter ? { profileIds: [...new Set(highlightedProfiles)],
    ...(gearUsage?.profileId && gearUsage.inputName ? { gear: { profileId: gearUsage.profileId, inputName: gearUsage.inputName } } : {}) }
    : inspectedInput && profile?.id === inspectedInput.profileId ? { profileIds: [profile.id], gear: inspectedInput } : undefined;
  const inspectInput = useCallback((name: string | null) => { setInspectedInput(name && profileId ? { profileId, inputName: name } : null); if (name) setInspectedParameter(null); }, [profileId]);
  useEffect(() => { setProfilePreview(null); setPreviewParameters(null); setSketchPreview(null); setInspectorCollapsed(false); }, [selectedId, sketchId, profileId]);
  const hasPadSketch = document.features.some(feature => feature.kind === 'sketch' && cadSketchSourceAvailability(feature, 'extrude', document.parameters).kind !== 'unavailable');
  const hasRevolveSketch = document.features.some(feature => feature.kind === 'sketch' && cadSketchSourceIssue(feature, 'revolve', document.parameters) === null);
  const visibleBodyIds = cadVisibleBodyIds(document.features);
  const currentBodyIds = buildState === 'ready' ? build?.meshes.map((mesh) => mesh.featureId).filter((id) => visibleBodyIds.includes(id)) ?? [] : [];
  const hasBody = currentBodyIds.length > 0;
  const hasSolid = hasActiveBodyFeatures && buildState === 'ready' && Boolean(displayedMeshes.length);
  const topologyReady = buildState === 'ready' && props.buildVersion === props.documentVersion && Boolean(build);
  const topologySelection = pickedTopology && !canvasReference && topologyReady && pickedTopology.documentVersion === props.documentVersion && pickedTopology.buildId === build?.buildId
    && currentBodyIds.includes(pickedTopology.bodyId) ? pickedTopology : null;
  const propertiesFeature = properties?.kind === 'selection' ? selected : undefined;
  const currentProperties = properties?.kind === 'body' || propertiesFeature ? properties : null;
  // Selecting only highlights. The panel belongs to an open editor, an active command or an explicit Properties request.
  const featureEditorOpen = Boolean(selected && openFeatureId === selected.id && !sketch);
  const inspectorVisible = Boolean(profileCopyCommand || featureEditorOpen || sketch || curve || newFeature || resolvingTopology || currentProperties);
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
    try { Promise.resolve(action()).catch((cause: unknown) => setError(userFacingMessage(cause, 'The operation could not be completed.'))); }
    catch (cause) { setError(userFacingMessage(cause, 'The operation could not be completed.')); }
  };
  const submitEdit = (apply: (signal: AbortSignal) => CadEditCompletion, accepted: () => void = () => undefined) => {
    props.onWorkflowChange(true);
    setError(null); setFileMenu(false);
    commandSubmission.submit(apply, accepted, cause => {
      // A synchronous rejection can batch applying true→false without a pending-effect change.
      props.onWorkflowChange(latestPending.current);
      setError(userFacingMessage(cause, 'The edit could not be completed.'));
    });
  };
  const deleteProfile = (source: CadSketchFeature, id: string) => submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: {
    ...source, profiles: source.profiles.filter(profile => profile.id !== id)
  } }, signal), () => setProfileId(current => current === id ? null : current));
  const applyCanvasEdits = (edits: readonly CadEdit[], signal?: AbortSignal) => {
    props.onWorkflowChange(true);
    const received = (result: Awaited<CadEditCompletion>) => {
      if (!signal?.aborted && result?.document === document && interactionState.current.document === document
        && interactionState.current.version === props.documentVersion && interactionState.current.sketchId === sketchId
        && edits.length === 1 && edits[0].kind === 'move-sketch-point' && edits[0].sketchId === sketchId) {
        props.onStatusMessage?.('This move is constrained by the sketch dimensions and relations.', 'info');
      }
      return result;
    };
    const completion = props.onEditMany(edits, signal);
    return completion && 'then' in completion ? completion.then(received) : received(completion);
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
    if (dimensionPickOwner.current) { cancelDimensionPick(); return; }
    commandSubmission.cancel(); setConstraintToolRequest(null);
    planeRequestOwner.current = null; setSketchPlaneRequest(null);
    setCanvasMenu(null); setAreaRepair(null); setOffsetCommand(null); setMirrorCommand(null); setMirrorInteraction(null); setPlacementCommand(null); setPlacementInteraction(null); setPatternCommand(null); setPatternInteraction(null);
    setProfileCopyCommand(null); setProfileCopyPreview(null); setProfileCopyAccepted(null);
    setSketchReferenceCommand(null); setSketchReferenceInteraction(null);
    topologyResolution.current?.controller.abort(); topologyResolution.current = null; setResolvingTopology(null);
    setPickedTopology(null);
    setCancelSignal((value) => value + 1); setNewFeature(null); setDrawingPending(false); setEditorPending(false); setParameterPending(false); setDimensionPending(false); setTreeRenamePending(false); setDeleteFeature(null); setFileMenu(false); setTool('select'); setError(null);
    setInspectedParameter(null); setInspectedInput(null); setProfilePreview(null); setPreviewParameters(null); setProfileCommand(null); setNameDraft(document.name); setNamePending(false);
  }, [document.name, commandSubmission.cancel, cancelDimensionPick]);
  /** Cancel and the close control leave an open feature editor; the selection stays. */
  const closeFeatureEditor = () => { cancel(); setOpenFeatureId(null); };
  // Escape first discards an editor draft, then a second Escape closes the clean editor, then a third clears the part selection.
  const escape = () => {
    const idle = !pending && !featureEditorOpen && !currentProperties && !newFeature && !sketch && !curve && !currentOwnedPick && !currentSketchPlaneRequest && !resolvingTopology && !deleteFeature && !currentCanvasMenu;
    if (!pending) setOpenFeatureId(null);
    cancel(); setProperties(null);
    if (idle) { setSelectedId(null); setProfileId(null); setPlaneSelection(null); }
  };
  const selectEscapeGuard = useMemo(() => createCadSelectEscapeGuard(window.document), []);
  /** Delete on a selected part feature asks before deleting, like the menu entry; sketch geometry keeps its own Delete. */
  const deleteSelected = () => {
    if (!selected || sketch || curve || featureEditorOpen || newFeature || interactionState.current.locked) return false;
    setProfileId(null); setDeleteFeature(selected); return true;
  };
  const hotkeys = useRef({ pending, storageBusy, props, escape, deleteSelected, selectEscapeGuard, referencePick: currentOwnedPick });
  hotkeys.current = { pending, storageBusy: storageBusy || externalWorkflowOpen, props, escape, deleteSelected, selectEscapeGuard, referencePick: currentOwnedPick };
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
        if (!current.pending && !current.storageBusy && !current.props.sketchEdit) run(current.props.onSave);
        return;
      }
      if (target instanceof HTMLSelectElement && (event.key !== 'Escape' || !current.selectEscapeGuard(target))) return;
      if (event.key === 'Escape') { event.preventDefault(); if (current.referencePick) current.referencePick.onCancel(); else current.escape(); return; }
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))) return;
      if (event.key === 'Delete' && !modifier && !current.pending && !current.storageBusy && current.deleteSelected()) { event.preventDefault(); return; }
      if (!modifier && !event.altKey && !event.shiftKey && /^[a-z]$/i.test(event.key) && !current.pending && !current.storageBusy) {
        const tool = window.document.querySelector<HTMLButtonElement>(`.cad-command-primary-tools:not([hidden]) button[aria-keyshortcuts="${event.key.toUpperCase()}"]`);
        if (tool && !tool.disabled && !tool.closest('[inert]')) { event.preventDefault(); tool.click(); }
        return;
      }
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
    setProperties(null); setNewFeature(featureDraft(kind, document, source ?? selected, currentBodyIds, plane)); setSketchId(null); setCurveId(null); if (kind === 'curve') setTool('path'); setProfileId(null); setEditorPending(false);
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
    if (owner.replaceSketchId) { const replaceId = owner.replaceSketchId; run(() => moveSketchToPlane(replaceId, plane)); return; }
    run(() => createSketchOnPlane(plane));
  };
  /** Change sketch plane: the sketch lies on the picked plane, so a former plane offset is cleared. */
  const moveSketchToPlane = (sketchId: string, plane: CadSketchPlane) => {
    const index = document.features.findIndex(feature => feature.id === sketchId), source = document.features[index];
    if (source?.kind !== 'sketch') return;
    if (typeof plane !== 'string' && document.features.findIndex(feature => feature.id === plane.featureId) > index) throw new Error(`Choose a plane defined before ${source.name}.`);
    submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...source, plane, offset: 0 } }, signal), () => { setSelectedId(source.id); setPlaneSelection(null); });
  };
  const beginChangeSketchPlane = (feature: CadSketchFeature) => {
    if (interactionState.current.locked) return;
    setOpenFeatureId(null); setProperties(null); setSelectedId(feature.id); setProfileId(null); setPlaneSelection(null); setPickedTopology(null); setError(null);
    setSketchPlaneRequest({ document, version: props.documentVersion, replaceSketchId: feature.id });
  };
  const openProperties = (target: { readonly kind: 'body' } | { readonly kind: 'feature'; readonly featureId: string }) => {
    if (interactionState.current.locked) return;
    setOpenFeatureId(null); setProperties({ kind: target.kind === 'body' ? 'body' : 'selection' }); setInspectorCollapsed(false);
    if (target.kind === 'feature') { setSelectedId(target.featureId); setProfileId(null); }
  };
  const startSketch = () => {
    if (interactionState.current.locked) return;
    if (selectedReferencePlane) { run(() => createSketchOnPlane(selectedReferencePlane)); return; }
    setSelectedId(null); setProfileId(null); setPlaneSelection(null); setSketchPlaneRequest({ document, version: props.documentVersion }); setPickedTopology(null); setError(null);
  };
  const choose = (id: string | null) => { if (currentTopologyPick) return; if (currentSketchReferencePick) { if (id) currentSketchReferencePick.chooseSource(id); return; } if (currentRegionPick) return; if (currentReferencePick) { if (id && currentReferencePick.eligibleIds.includes(id)) currentReferencePick.onSelect(id); return; }
    if (currentSketchPlaneRequest) { const target = document.features.find(feature => feature.id === id && feature.kind === 'datum-plane' && !feature.suppressed); if (target) pickSketchPlane({ kind: 'datum-plane', featureId: target.id }); return; }
    if (interactionState.current.locked || props.sketchEdit && id !== props.sketchEdit.sketchId) return; setGraphPick(null); setGraphRelationCommand(null); setPlaneSelection(null); setPickedTopology(null); setSelectedId(id); setProfileId(null); if (!id) setProperties(current => current?.kind === 'selection' ? null : current); if (id !== sketchId) setSketchId(null); if (id !== curveId) setCurveId(null); if (id !== openFeatureId) setOpenFeatureId(null); setError(null); return true; };
  const openFeatureEditor = (feature: CadFeature) => { if (choose(feature.id)) setOpenFeatureId(feature.id); };
  /** Double-click intent: sketches and curves open their geometry editors, other features their settings. */
  const configureFeature = (feature: CadFeature) => {
    if (feature.kind === 'sketch') editSketch(feature); else if (feature.kind === 'curve') editCurve(feature); else openFeatureEditor(feature);
  };
  const selectReferencePlane = (plane: CadSketchPlane | null) => {
    if (currentSketchPlaneRequest) { if (plane) pickSketchPlane(plane); return; }
    if (interactionState.current.locked) return;
    if (typeof plane === 'object' && plane !== null) { const target = document.features.find(feature => feature.id === plane.featureId && feature.kind === 'datum-plane' && !feature.suppressed); if (target) choose(target.id); return; }
    choose(null); setPlaneSelection(plane ? { documentId: document.id, plane } : null);
  };
  const editSketch = (feature: CadSketchFeature, owned = true) => {
    if (interactionState.current.locked) return;
    try { if (owned) props.onBeginSketchEdit?.(feature.id); }
    catch (cause) { setError(userFacingMessage(cause, 'Unable to open this sketch edit.')); return; }
    setGraphPick(null); setGraphRelationCommand(null); setPickedTopology(null); setCurveId(null); setSketchId(feature.id); setSelectedId(feature.id); setProfileId(null); setTool('select'); setProperties(null);
  };
  const beginProfileCopy = (source: CadSketchFeature, id: string) => {
    const latest = interactionState.current;
    if (latest.locked || props.sketchEdit || latest.document !== document || latest.version !== props.documentVersion
      || latest.document.features.find(feature => feature.id === source.id) !== source || source.suppressed) return;
    const outline = source.profiles.find(profile => profile.id === id); if (!outline) return;
    setProfileCopyPreview(null); setProfileCopyAccepted(null); setInspectorCollapsed(false); setError(null);
    setProfileCopyCommand({ token: crypto.randomUUID(), request: { sourceSketchId: source.id, profileId: id,
      newSketchId: `sketch_${crypto.randomUUID()}`, name: `${outline.name.slice(0, 155)} copy`, idPrefix: `copy_${crypto.randomUUID().replaceAll('-', '')}` } });
  };
  // The copy editor releases pending in layout cleanup; only then may the normal entry assert a closed workflow.
  useEffect(() => {
    if (!profileCopyAccepted || profileCopyCommand || pending) return;
    const accepted = profileCopyAccepted; setProfileCopyAccepted(null);
    if (storageBusy || externalWorkflowOpen || !Value.Equal(document, accepted.document)) return;
    const target = document.features.find(feature => feature.id === accepted.sketchId);
    if (target?.kind === 'sketch') editSketch(target);
  }, [profileCopyAccepted, profileCopyCommand, pending, document, storageBusy, externalWorkflowOpen]);
  const editCurve = (feature: CadCurveFeature) => { if (interactionState.current.locked || feature.suppressed) return; setPickedTopology(null); setSketchId(null); setCurveId(feature.id); setSelectedId(feature.id); setProfileId(null); setTool('select'); setProperties(null); };
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
  let canvasMenuTitle = 'Body';
  if (currentCanvasMenu?.kind === 'solid') {
    const target = currentCanvasMenu.request.target;
    const id = target?.kind === 'topology' ? target.hit.bodyId : target?.kind === 'feature' ? target.featureId : null;
    const feature = document.features.find(feature => feature.id === id);
    if (feature) {
      canvasMenuTitle = feature.name;
      if (feature.kind !== 'sketch') canvasMenuItems.push({ label: 'Edit feature', onSelect: () => openFeatureEditor(feature) });
      if (feature.kind === 'sketch') canvasMenuItems.push({ label: 'Edit sketch', onSelect: () => editSketch(feature) }, { label: 'Change sketch plane', help: 'Click the new plane in the design area.', onSelect: () => beginChangeSketchPlane(feature) },
        { label: 'Pad sketch', disabled: cadSketchSourceAvailability(feature, 'extrude', document.parameters).kind === 'unavailable', onSelect: () => startFeature('extrude', undefined, feature) },
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
      canvasMenuItems.push({ kind: 'separator' }, { label: 'Properties', onSelect: () => openProperties({ kind: 'feature', featureId: feature.id }) }, { label: 'Suppress feature', onSelect: () => submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...feature, suppressed: true } }, signal)) },
        { label: 'Delete feature', danger: true, onSelect: () => { setSelectedId(feature.id); setProfileId(null); setDeleteFeature(feature); } });
    }
  } else if (currentCanvasMenu?.kind === 'sketch') {
    const source = document.features.find((feature): feature is CadSketchFeature => feature.kind === 'sketch' && feature.id === currentCanvasMenu.sketchId);
    const target = source?.profiles.find(profile => profile.id === currentCanvasMenu.request.profileId);
    if (source && target) {
      canvasMenuTitle = target.name;
      canvasMenuItems.push({ label: 'Copy outline to editable sketch', disabled: Boolean(props.sketchEdit), help: props.sketchEdit ? 'Finish or cancel sketch edits before copying an outline.' : undefined, onSelect: () => beginProfileCopy(source, target.id) });
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
    setPickedTopology(next.picks.length ? next : null); setSelectedId(incoming.bodyId);
    if (pickMode !== 'auto') setPickMode(incoming.picks[0].kind);
    setSketchId(null); setCurveId(null); setProfileId(null);  setError(null);
  };
  const changePickMode = (mode: CadPickMode) => { if (locked) return; if (mode !== pickMode) setPickedTopology(null); setPickMode(mode); };
  const pickTopology = (hit: CadTopologyHit | null, additive: boolean) => run(() => {
    // A click on empty space clears the part selection like it does in body picking; an open editor keeps its feature.
    if (!hit) { selectTopology(null, false); if (!featureEditorOpen && !newFeature) { setSelectedId(null); setPlaneSelection(null); setProperties(current => current?.kind === 'selection' ? null : current); } return; }
    selectTopology({ documentVersion: props.documentVersion, buildId: build?.buildId ?? '', bodyId: hit.bodyId, picks: [hit.pick] }, additive);
  });
  const selectProfile = (id: string | null) => { if (!editorPending && !treeRenamePending) { setGraphPick(null); setProfileId(id); setProfileCommand(null); } };
  const applyFeature = async (feature: CadFeature, parameters: Readonly<Record<string, number>>, signal?: AbortSignal) => {
    await props.onEditMany(cadFeatureCandidateEdits({ feature, isNew: Boolean(newFeature), parameters }), signal);
    signal?.throwIfAborted();
    setPickedTopology(null);
    setNewFeature(null); setEditorPending(false); setSelectedId(feature.id); setOpenFeatureId(null); setError(null);
    if (feature.kind === 'sketch' && newFeature && !sketch) { setSketchId(feature.id); setTool('rectangle'); }
  };
  const addSketchGraph = (graph: CadSketchGraph, signal?: AbortSignal) => {
    if (!sketch) throw new Error('Open a sketch before drawing.');
    props.onWorkflowChange(true);
    return afterCadEdit(props.onEdit({ kind: 'append-sketch-entities', sketchId: sketch.id, geometry: graph }, signal), () => {
      selectGraph({ kind: 'entity', id: graph.entities[0].id }); setError(null);
    }, signal);
  };
  const addPath = (draft: CadPathDraft, closed: boolean, signal?: AbortSignal) =>
    addSketchGraph(createCadPathDraftGraph({ draft, closed, construction, createId: () => crypto.randomUUID(), existingGraph: sketch?.graph, parameters: document.parameters }), signal);
  const addFreshSketch = (drawing: CadFreshSketchDrawing, signal?: AbortSignal) => {
    if (!sketch) throw new Error('Open a sketch before drawing.');
    const created = createCadFreshSketchDrawing({ drawing, construction, createId: () => crypto.randomUUID(), existingGraph: sketch.graph, parameters: document.parameters });
    return addSketchGraph(created.geometry, signal);
  };
  const addProfile = (geometry: CadProfile, signal?: AbortSignal) => {
    if (!sketch) throw new Error('Open a sketch before drawing.');
    if (geometry.kind === 'circle' || geometry.kind === 'polygon' || geometry.kind === 'rectangle' && geometry.cornerRadius === 0) {
      return addSketchGraph(createCadFreshSketchGraph({ geometry, construction, createId: () => crypto.randomUUID() }), signal);
    }
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
    } catch (cause) { setError(userFacingMessage(cause, 'Unable to add this plugin.')); }
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
  const deleteSketchGeometry = (selection: CadSketchGraphSelection) => {
    if (!sketch || interactionState.current.locked) return;
    const selections = isCadSketchGraphSelected(graphSelections, selection) ? graphSelections : [selection];
    const owners = sketch.graph && selections.map(atom => cadSketchLinearPatternForSelection(sketch.graph!, atom));
    if (owners?.some(Boolean)) {
      const owner = owners[0];
      if (!owner || owners.some(item => !item || item.relation.id !== owner.relation.id || item.index === 0)) {
        setError('Detach the pattern before deleting its seed or combining pattern and independent selections.'); return;
      }
      const omittedInstances = [...new Set([...owner.relation.omittedInstances, ...owners.map(item => item!.index)])].sort((a,b)=>a-b);
      submitEdit(signal => props.onEdit({kind:'set-sketch-relation',sketchId:sketch.id,relation:{...owner.relation,omittedInstances}},signal),()=>selectGraph(null)); return;
    }
    submitEdit(signal => props.onEdit({ kind: 'delete-sketch-elements', sketchId: sketch.id,
      pointIds: selections.filter(item => item.kind === 'point').map(item => item.id), entityIds: selections.filter(item => item.kind === 'entity').map(item => item.id), relationIds: [], cascade: true }, signal), () => selectGraph(null));
  };
  const removeSelected = () => {
    if (graphSelections.length) { deleteSketchGeometry(graphSelections[0]); return; }
    if (sketch && profile) { submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.filter((entry) => entry.id !== profile.id) } }, signal), () => setProfileId(current => current === profile.id ? null : current)); return; }
    if (selected) setDeleteFeature(selected);
  };
  const closeSketchView = () => { setOffsetCommand(null); setAreaRepair(null); setSketchId(null); setProfileId(null); setGraphPick(null); setGraphRelationCommand(null); setTool('select'); };
  // The form can disappear when Finish releases its draft. Keep navigation with the stable workspace;
  // the authoritative finish operation already guards cancellation before committing the part.
  const finishSketchWithAreas = (repairs: CadSketchAreaRepairs, signal: AbortSignal) =>
    afterCadEdit(props.sketchEdit!.finish(signal, repairs), closeSketchView);
  const finishSketch = () => {
    if (props.sketchEdit) {
      try {
        const inspection = props.sketchEdit.inspectAreaRepairs();
        if (inspection) { setAreaRepairReady(false); setAreaRepair({ document, inspection }); setTool('select'); setGraphPick(null); setProfileId(null); setInspectorCollapsed(false); return; }
      } catch (cause) { setError(userFacingMessage(cause, 'Correct the sketch before choosing replacement areas.')); return; }
      submitEdit(signal => props.sketchEdit!.finish(signal), closeSketchView);
    }
    else closeSketchView();
  };
  const cancelSketchEdit = () => { cancel(); props.sketchEdit?.cancel(); closeSketchView(); };
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
    selectedSketchGeometrySet: graphSelections,
    sketchId: sketch?.id ?? null, curveId: curve?.id ?? null, selectedReferencePlane, awaitingSketchPlane: Boolean(currentSketchPlaneRequest), workflowOpen: pending || externalWorkflowOpen, busy: storageBusy, buildVersion: props.buildVersion,
    buildState, visibleBodyIds: currentBodyIds, visibleReferenceIds, visibleReferencePlanes, rendered: renderedControls.current,
    buildId: topologyReady ? build?.buildId ?? null : null, pickMode, topologySelection, meshes: build?.meshes ?? [],
    selectFeature: choose, selectReferencePlane,
    // Agent view navigation does not claim an exclusive human draft. Agent edits stay full-part atomic batches.
    editSketch: (id) => { const target = document.features.find((feature) => feature.kind === 'sketch' && feature.id === id); if (target?.kind === 'sketch') editSketch(target, false); },
    editCurve: (id) => { const target = document.features.find((feature) => feature.kind === 'curve' && feature.id === id); if (target?.kind === 'curve') editCurve(target); },
    selectProfile, selectSketchGeometrySet: selectGraphSet, finishSketch, finishCurve,
    selectTopology, setPickMode: changePickMode,
    updateView: (action) => flushSync(action),
  };
  const deletingIds = new Set(deleteFeature ? [deleteFeature.id] : []);
  for (const feature of document.features) if (cadFeatureDependencies(feature).some((id) => deletingIds.has(id))) deletingIds.add(feature.id);
  const dependentNames = document.features.filter((feature) => deletingIds.has(feature.id) && feature.id !== deleteFeature?.id).map((feature) => feature.name);
  /** A shortcut presses the visible tool itself, so it keeps every disabled and workflow guard. */
  const toolButton = (label: string, Icon: WorkbenchIconComponent, action: () => void, disabled = false, active = false, hint?: string, shortcut?: string) => <Button className={`cad-tool ${active ? 'is-active' : ''}`} title={`${hint ?? label}${shortcut ? ` (${shortcut})` : ''}`} aria-label={label} aria-keyshortcuts={shortcut} disabled={disabled || storageBusy} aria-pressed={active} onClick={action}><Icon size={15} /><span>{label}</span></Button>;
  const beginProfileCommand = (kind: CadSketchProfileCommand['kind']) => {
    if (locked || !profile || profile.geometry.kind === 'plugin') return;
    setTool('select'); setInspectorCollapsed(false); setProfileCommand({ token: ++profileCommandSequence.current, documentId: document.id, profileId: profile.id, kind });
  };
  const openGraphMove = (selections: readonly CadSketchGraphSelection[]) => {
    selectGraphSet(selections);
    setTool('select'); setGraphRelationCommand({ kind: 'move', token: crypto.randomUUID() }); setInspectorCollapsed(false);
  };
  const beginSketchMove = () => {
    if (locked) return;
    if (!graphSelections.length) { beginProfileCommand('move'); return; }
    openGraphMove(graphSelections);
  };
  const beginSketchPlacement = () => {
    if (!sketch?.graph || !graphSelections.length || pendingOtherCommands || drawingPending || storageBusy || externalWorkflowOpen) return;
    setTool('select'); setGraphRelationCommand(null); setPlacementInteraction(null);
    setPlacementCommand({sketchId:sketch.id,selections:graphSelections,token:crypto.randomUUID()}); setInspectorCollapsed(false);
  };
  const exactProfileEditor = profile && sketch ? <CadProfileEditor onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} key={`${profile.id}-${cancelSignal}`} profile={profile} document={document} onInspectInput={inspectInput} onPreviewProfile={setProfilePreview} onPreviewParameters={setPreviewParameters} onApply={async (next, parameters, signal) => {
    await props.onEditMany([...Object.entries(parameters).map(([name, value]): CadEdit => ({ kind: 'set-parameter', name, value })), { kind: 'update-feature', feature: { ...sketch, profiles: sketch.profiles.map(entry => entry.id === next.id ? next : entry) } }], signal); signal?.throwIfAborted(); setEditorPending(false);
  }} onCancel={cancel} onPendingChange={setEditorPending} /> : null;
  const selectedProfileEditor = profile && sketch && profile.geometry.kind !== 'plugin' ? <CadSketchProfilePanel key={`${profile.id}-${cancelSignal}`} document={document} sketch={sketch} profile={profile} command={profileCommand} onCommandConsumed={token => setProfileCommand(current => current?.token === token ? null : current)} otherEditorPending={editorPending} onEditMany={props.onEditMany} onPendingChange={setEditorPending} onPreviewProfile={setProfilePreview} onPreviewParameters={setPreviewParameters} onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} interactionLocked={sketchEditorLocked} cancelSignal={cancelSignal} exactGeometryEditor={profile.geometry.kind === 'polygon' || profile.geometry.kind === 'path' ? exactProfileEditor : undefined} /> : exactProfileEditor;
  const propertyRows = useMemo(() => currentProperties ? cadPropertySummary(document, currentProperties.kind === 'body' || !propertiesFeature ? { kind: 'body' } : { kind: 'feature', feature: propertiesFeature }, displayedMeshes, feature => cadPlacementLabel(feature.plane, document.features)) : [], [currentProperties, propertiesFeature, document, displayedMeshes]);
  const propertiesView = currentProperties && <div className="cad-property-form cad-properties-summary">
    {currentProperties.kind === 'body' || !propertiesFeature ? <>
      <CadInspectorTitle>Part<small>{document.name}</small></CadInspectorTitle>
      {/* The part is renamed here, as in CATIA's part Properties; Enter or leaving the field saves, Escape restores. */}
      <label className="cad-field"><span>Name</span><Input className="cad-document-name" aria-label="Part name" value={nameDraft} disabled={Boolean(props.sketchEdit || currentDimensionPick) || commandSubmission.applying || drawingPending || editorPending || parameterPending || dimensionPending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy || Boolean(currentSketchPlaneRequest || currentReferencePick)} onChange={(event) => { setNameDraft(event.target.value); setNamePending(event.target.value !== document.name); }} onBlur={(event) => { if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute('data-cad-panel-resizer')) return; if (nameDraft !== document.name) submitEdit(signal => props.onEdit({ kind: 'rename-document', name: nameDraft }, signal), () => setNamePending(false)); }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); commandSubmission.cancel(); setNameDraft(document.name); setNamePending(false); } }} /></label>
    </> : <CadInspectorTitle>{propertiesFeature.name}<small>{featureLabels[propertiesFeature.kind]}</small></CadInspectorTitle>}
    <dl className="cad-properties-list">{propertyRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
  </div>;
  const sketchDimensionAvailable = profile && cadSketchDimensionQuantities(profile.geometry).some(quantity => !inspectCadSketchDimensions(profile, document.parameters).some(dimension => dimension.field === (quantity === 'diameter' ? 'radius' : quantity)));
  const circleSourceDriven = selectedGraphEntity?.kind === 'circle' && typeof selectedGraphEntity.radius === 'string'
    && !sketch?.graph?.relations.some(relation => relation.kind === 'radial-size' && relation.entityId === selectedGraphEntity.id);
  const patternDimensionLocked = Boolean(sketch?.graph && graphSelection?.kind === 'entity' && cadSketchLinearPatternLockReason(sketch.graph, graphSelection));
  const graphDimensionAvailable = graphLinePair || Boolean(selectedGraphEntity && !circleSourceDriven && !graphEditLock);
  const dimensionPickTargets = useMemo(() => {
    const graph = sketch?.graph;
    return { entityIds: graph?.entities.filter(entity => !cadSketchLinearPatternLockReason(graph, { kind: 'entity', id: entity.id }) && !cadSketchExternalReferenceLockReason(graph, { kind: 'entity', id: entity.id })
      && !(entity.kind === 'circle' && typeof entity.radius === 'string' && !graph.relations.some(relation => relation.kind === 'radial-size' && relation.entityId === entity.id))).map(entity => entity.id) ?? [],
      // Driven/reference points can anchor a free partner or a passive measurement; a lone point still measures from the origin or an axis.
      pointIds: graph?.points.map(point => point.id) ?? [] };
  }, [sketch]);
  const canPickDimension = Boolean(dimensionPickTargets.entityIds.length || dimensionPickTargets.pointIds.length);
  const openGraphDimension = (selections: readonly CadSketchGraphSelection[]) => {
    const entities = sketch?.graph?.entities.filter(entity => isCadSketchGraphSelected(selections, { kind: 'entity', id: entity.id })) ?? [];
    const entity = selections.length === 1 && selections[0].kind === 'entity' ? entities[0] : undefined;
    const kind = selections.length === 2 && selections.every(atom => atom.kind === 'point') ? 'point-dimensions'
      : selections.length === 2 && entities.length === 2 && entities.every(entity => entity.kind === 'line') ? 'line-angle'
      : entity ? entity.kind === 'line' ? 'length' : 'radial-size' : null;
    if (!kind) return false;
    selectGraphSet(selections); setTool('select'); setGraphRelationCommand({ kind, token: crypto.randomUUID() }); setInspectorCollapsed(false); return true;
  };
  /** The tool waits for enough geometry: a second point, or after a line either a second line for an angle or a confirm for its length. */
  const openDimensionPick = (first: CadSketchGraphSelection | null, previousGraphPick = graphPick) => {
    if (!sketch) return;
    const firstPointId = first?.kind === 'point' ? first.id : null, firstLineId = first?.kind === 'entity' ? first.id : null;
    props.onWorkflowChange(true); setTool('select'); setGraphRelationCommand(null); setInspectorCollapsed(false);
    setGraphPick(first ? { sketchId: sketch.id, selections: [first] } : null); setProfileId(null);
    setDimensionPickRequest(Object.freeze({ document, version: props.documentVersion, sketchId: sketch.id, previousTool: tool, previousGraphPick, previousProfileId: profileId,
      eligibleEntityIds: Object.freeze(dimensionPickTargets.entityIds), eligiblePointIds: Object.freeze(dimensionPickTargets.pointIds), firstPointId, firstLineId, firstDatum: null }));
  };
  const beginSketchDimension = () => {
    if (locked || patternDimensionLocked || !sketch) return;
    if (!graphLinePair && !graphPointPair && !graphDimensionAvailable && !sketchDimensionAvailable) {
      if (!canPickDimension) return;
      openDimensionPick(graphSelection?.kind === 'point' && dimensionPickTargets.pointIds.includes(graphSelection.id) ? graphSelection : null); return;
    }
    if (graphSelections.length === 1 && selectedGraphEntity?.kind === 'line' && graphSelection && dimensionPickTargets.entityIds.includes(graphSelection.id)) { openDimensionPick(graphSelection); return; }
    if (openGraphDimension(graphSelections)) return;
    if (!selectedGraphEntity) { beginProfileCommand('dimension'); return; }
  };
  const graphContextMenu = (selections: readonly CadSketchGraphSelection[]): readonly CadContextMenuItem[] => {
    const graph = sketch?.graph;
    if (!graph || !sketch || !selections.length) return [];
    const sourceSketchId = sketch.id;
    const entityAtoms = selections.filter(atom => atom.kind === 'entity');
    const entities = graph.entities.filter(entity => isCadSketchGraphSelected(entityAtoms, { kind: 'entity', id: entity.id }));
    const dimensionAllowed = selections.length === 1 ? selections[0].kind === 'point' ? dimensionPickTargets.pointIds.includes(selections[0].id)
      : dimensionPickTargets.entityIds.includes(selections[0].id) : selections.length === 2 && (selections.every(atom => atom.kind === 'point')
        || entities.length === 2 && entities.every(entity => entity.kind === 'line' && !cadSketchLinearPatternLockReason(graph, { kind: 'entity', id: entity.id })));
    const moveLock = selections.map(atom => cadSketchLinearPatternLockReason(graph, atom) ?? cadSketchExternalReferenceLockReason(graph, atom)).find(Boolean);
    const act = (action: () => void) => {
      const current = interactionState.current;
      if (current.locked || current.document !== document || current.version !== props.documentVersion || current.sketchId !== sourceSketchId) return;
      action();
    };
    const scopeHelp = selections.length === 1 ? `Use this ${selections[0].kind === 'point' ? 'point' : 'edge'}.` : `Use the ${selections.length} selected points and edges.`;
    return [
      { label: 'Dimension', disabled: !dimensionAllowed, help: dimensionAllowed ? scopeHelp : 'Choose one eligible edge, two points or two lines. Linked and generated edges retain their owners.', onSelect: () => act(() => {
        if (!dimensionAllowed) return;
        if (selections.length === 1 && selections[0].kind === 'point') {
          selectGraphSet(selections); openDimensionPick(selections[0], { sketchId: sourceSketchId, selections });
        } else openGraphDimension(selections);
      }) },
      { label: 'Constraints and dimensions', help: `${scopeHelp} List, edit or remove what constrains it.`, onSelect: () => act(() => { selectGraphSet(selections); setGraphRelationCommand({ kind: 'relations', token: crypto.randomUUID() }); setInspectorCollapsed(false); }) },
      { label: 'Move selection', disabled: Boolean(moveLock), help: moveLock ?? `${scopeHelp} Keep existing dimensions and relations.`, onSelect: () => act(() => { if (!moveLock) openGraphMove(selections); }) },
      ...constraintMenuItems(graph, sourceSketchId, cadSketchGraphSelectionsEqual(selections, graphSelections) ? constraintSelection : selections, act),
    ];
  };
  const dimensionGeometryPick = useMemo<CadSketchGeometryPick | undefined>(() => {
    if (!currentDimensionPick) return undefined;
    const request = currentDimensionPick;
    const entities = request.document.features.find((feature): feature is CadSketchFeature => feature.id === request.sketchId && feature.kind === 'sketch')?.graph?.entities ?? [];
    const isLine = (id: string) => entities.some(entity => entity.id === id && entity.kind === 'line');
    const owns = () => {
      const current = interactionState.current;
      return dimensionPickOwner.current === request && current.document === request.document && current.version === request.version && current.sketchId === request.sketchId;
    };
    const finish = (selections: readonly CadSketchGraphSelection[], command: CadSketchRelationCommand) => {
      dimensionPickOwner.current = null; setDimensionPickRequest(null); selectGraphSet(selections);
      setGraphRelationCommand({ ...command, token: crypto.randomUUID() }); setInspectorCollapsed(false);
    };
    const { firstPointId, firstLineId, firstDatum } = request;
    // A point pairs with the sketch origin or an axis in either order; lines and curves take sketch geometry only.
    return {
      eligibleEntityIds: firstPointId !== null || firstDatum !== null ? [] : firstLineId !== null ? request.eligibleEntityIds.filter(isLine) : request.eligibleEntityIds,
      eligiblePointIds: firstLineId !== null ? [] : request.eligiblePointIds.filter(id => id !== firstPointId),
      eligibleDatums: firstLineId !== null || firstDatum !== null ? [] : CAD_SKETCH_DATUMS,
      pickedDatums: firstDatum ? [firstDatum] : [],
      label: firstLineId !== null ? 'Choose a second line for an angle, or empty space for the length' : firstDatum !== null ? `Choose a point to dimension from the ${cadSketchDatumLabels[firstDatum].toLowerCase()}`
        : firstPointId !== null ? 'Choose the second point, the origin or an axis' : 'Choose a line, curve, point, the origin or an axis',
      onPickDatum: datum => {
        if (!owns() || firstLineId !== null || firstDatum !== null) return;
        if (firstPointId !== null) { finish([{ kind: 'point', id: firstPointId }], { kind: 'datum-distance', datum }); return; }
        const next = Object.freeze({ ...request, firstDatum: datum });
        dimensionPickOwner.current = next; setDimensionPickRequest(next);
      },
      onCancel: () => { if (dimensionPickOwner.current === request) cancelDimensionPick(); },
      onConfirm: firstLineId === null ? undefined : () => { if (owns()) finish([{ kind: 'entity', id: firstLineId }], { kind: 'length' }); },
      onPick: selection => {
        if (!owns()) return;
        if (selection.kind === 'point') {
          if (firstLineId !== null || !request.eligiblePointIds.includes(selection.id) || selection.id === firstPointId) return;
          if (firstDatum !== null) { finish([selection], { kind: 'datum-distance', datum: firstDatum }); return; }
          if (firstPointId === null) {
            const next = Object.freeze({ ...request, firstPointId: selection.id });
            dimensionPickOwner.current = next; setDimensionPickRequest(next); selectGraph(selection); return;
          }
          finish([{ kind: 'point', id: firstPointId }, selection], { kind: 'point-dimensions' }); return;
        }
        if (firstPointId !== null || firstDatum !== null || !request.eligibleEntityIds.includes(selection.id)) return;
        if (firstLineId !== null) {
          if (selection.id === firstLineId) finish([selection], { kind: 'length' });
          else if (isLine(selection.id)) finish([{ kind: 'entity', id: firstLineId }, selection], { kind: 'line-angle' });
          return;
        }
        if (!entities.some(entity => entity.id === selection.id)) return;
        if (isLine(selection.id)) {
          const next = Object.freeze({ ...request, firstLineId: selection.id });
          dimensionPickOwner.current = next; setDimensionPickRequest(next); selectGraph(selection); return;
        }
        finish([selection], { kind: 'radial-size' });
      }
    };
  }, [currentDimensionPick, cancelDimensionPick, selectGraph, selectGraphSet]);
  const currentConstraintTool = sketch?.graph && constraintToolRequest?.sketchId === sketch.id && tool === 'select' && !currentDimensionPick ? constraintToolRequest : null;
  useLayoutEffect(() => { if (constraintToolRequest && !currentConstraintTool) setConstraintToolRequest(null); }, [constraintToolRequest, currentConstraintTool]);
  // New positional relations first carry a free shape onto their target, as CATIA does, so the solver only has to hold it there.
  const constraintEdits = (graph: CadSketchGraph, sourceSketchId: string, relations: readonly CadSketchGraphRelation[]): readonly CadEdit[] => {
    const placement = cadSketchRelationPlacement(graph, relations);
    return [...placement ? [{ kind: 'translate-sketch-geometry' as const, sketchId: sourceSketchId, ...placement }] : [],
      ...relations.map(relation => ({ kind: 'set-sketch-relation' as const, sketchId: sourceSketchId, relation }))];
  };
  // Selection first, as in CATIA's Constraint Definition dialog: the menu lists what fits the selected geometry and plane references.
  const constraintSelection = useMemo<readonly CadSketchConstraintPick[]>(() => [...graphSelections, ...graphDatums.map(id => ({ kind: 'datum' as const, id }))], [graphSelections, graphDatums]);
  const constraintChoices = useMemo(() => sketch?.graph && !currentConstraintTool && tool === 'select'
    ? cadSketchConstraintChoices(sketch.graph, constraintSelection, () => crypto.randomUUID()) : [], [sketch, currentConstraintTool, tool, constraintSelection]);
  const toggleConstraint = (graph: CadSketchGraph, sourceSketchId: string, choice: CadSketchConstraintChoice) => {
    if (choice.state === 'blocked') return;
    const edits = choice.state === 'available' ? constraintEdits(graph, sourceSketchId, choice.relations)
      : choice.relationIds.map(relationId => ({ kind: 'remove-sketch-relation' as const, sketchId: sourceSketchId, relationId }));
    submitEdit(signal => applyCanvasEdits(edits, signal));
  };
  const constraintChoiceHelp = (choice: CadSketchConstraintChoice) => choice.state === 'blocked' ? choice.reason
    : choice.state === 'applied' ? 'Already applied. Choose it to remove the constraint.' : cadSketchConstraintToolHelp[choice.tool];
  const constraintMenuItems = (graph: CadSketchGraph, sourceSketchId: string, picks: readonly CadSketchConstraintPick[], act: (action: () => void) => void): readonly CadContextMenuItem[] => {
    const choices = cadSketchConstraintChoices(graph, picks, () => crypto.randomUUID()).filter(choice => choice.state !== 'blocked');
    return choices.length ? [{ kind: 'separator' }, ...choices.map(choice => ({ label: choice.state === 'applied' ? `Remove ${cadSketchConstraintToolLabels[choice.tool].toLowerCase()}` : cadSketchConstraintToolLabels[choice.tool],
      help: constraintChoiceHelp(choice), onSelect: () => act(() => toggleConstraint(graph, sourceSketchId, choice)) }))] : [];
  };
  const beginConstraintTool = (kind: CadSketchConstraintTool) => {
    if (locked || !sketch?.graph) return;
    if (dimensionPickOwner.current) cancelDimensionPick();
    setTool('select'); setGraphRelationCommand(null); setProfileId(null); selectGraphSet(NO_SKETCH_SELECTIONS); setError(null);
    setConstraintToolRequest({ sketchId: sketch.id, tool: kind, document, picks: [] });
  };
  const constraintGeometryPick = useMemo<CadSketchGeometryPick | undefined>(() => {
    const graph = sketch?.graph;
    if (!currentConstraintTool || !graph || commandSubmission.applying) return undefined;
    const request = currentConstraintTool, picks: readonly CadSketchConstraintPick[] = request.document === document ? request.picks : NO_SKETCH_SELECTIONS;
    const step = cadSketchConstraintStep(graph, request.tool, picks, () => crypto.randomUUID());
    if (step.status !== 'more') return undefined;
    const restart = () => { setConstraintToolRequest({ ...request, document, picks: [] }); selectGraphSet(NO_SKETCH_SELECTIONS); };
    const pick = (operand: CadSketchConstraintPick) => {
      const current = interactionState.current;
      if (current.locked || current.document !== document || current.sketchId !== request.sketchId) return;
      const next = [...picks, operand], result = cadSketchConstraintStep(graph, request.tool, next, () => crypto.randomUUID());
      if (result.status === 'more') {
        setConstraintToolRequest({ ...request, document, picks: next });
        selectGraphSet(next.filter((item): item is CadSketchGraphSelection => item.kind !== 'datum')); setError(null); return;
      }
      if (result.status === 'invalid') { restart(); setError(result.reason); return; }
      const sourceSketchId = request.sketchId;
      restart();
      // The tool stays active; the next pick starts a new constraint on the updated sketch.
      const edits = constraintEdits(graph, sourceSketchId, result.relations);
      submitEdit(signal => applyCanvasEdits(edits, signal));
    };
    return {
      eligibleEntityIds: step.entityIds, eligiblePointIds: step.pointIds, eligibleDatums: step.datums,
      pickedDatums: picks.flatMap(item => item.kind === 'datum' ? [item.id] : []),
      label: `${cadSketchConstraintToolLabels[request.tool]} · ${step.prompt}`,
      onCancel: () => { setConstraintToolRequest(null); selectGraphSet(NO_SKETCH_SELECTIONS); },
      onPick: pick, onPickDatum: datum => pick({ kind: 'datum', id: datum })
    };
  }, [currentConstraintTool, sketch, document, commandSubmission.applying, selectGraphSet]);
  const beginSketchOffset = () => {
    if (locked || !offsetSource || !sketch) return;
    setTool('select'); setGraphRelationCommand(null); setOffsetCommand({ sketchId: sketch.id, source: offsetSource, token: crypto.randomUUID() }); setInspectorCollapsed(false);
  };
  const mirrorSourceIds = graphSelections.length && graphEntities.length === graphSelections.length ? graphEntities.map(entity => entity.id) : [];
  const canMirrorSketch = mirrorSourceIds.length > 0 && mirrorSourceIds.length <= 64 && sketch?.graph?.entities.some(entity => entity.kind === 'line' && !mirrorSourceIds.includes(entity.id));
  const beginSketchMirror = () => {
    if (locked || !canMirrorSketch || !sketch) return;
    setTool('select'); setGraphRelationCommand(null); setMirrorInteraction(null);
    setMirrorCommand({ sketchId: sketch.id, entityIds: mirrorSourceIds, token: crypto.randomUUID() }); setInspectorCollapsed(false);
  };
  const editSketchPattern = (relationId: string, detach?: true) => {
    if (interactionState.current.locked || !sketch?.graph?.relations.some(relation => relation.id === relationId && relation.kind === 'linear-pattern')) return;
    setTool('select'); setGraphRelationCommand(null); setPatternInteraction(null);
    setPatternCommand({sketchId:sketch.id,request:{kind:'edit',relationId,...(detach ? {detach} : {})},token:crypto.randomUUID()}); setInspectorCollapsed(false);
  };
  const canPatternSketch = Boolean(selectedPattern || selectedGraphEntity?.kind === 'circle' && !selectedGraphEntity.construction && !graphEditLock);
  const beginSketchPattern = () => {
    if (locked || !sketch || !canPatternSketch) return;
    if (selectedPattern) { editSketchPattern(selectedPattern.relation.id); return; }
    if (selectedGraphEntity?.kind !== 'circle') return;
    setTool('select'); setGraphRelationCommand(null); setPatternInteraction(null);
    setPatternCommand({sketchId:sketch.id,request:{kind:'create',seedEntityId:selectedGraphEntity.id},token:crypto.randomUUID()}); setInspectorCollapsed(false);
  };
  const beginSketchReference = () => {
    if (locked || !sketch || !referenceSources.length) return;
    setTool('select'); setGraphRelationCommand(null); setSketchReferenceInteraction(null);
    setSketchReferenceCommand({ sketchId: sketch.id, token: crypto.randomUUID() }); setInspectorCollapsed(false);
  };
  const beginSketchCorner = (kind: 'fillet' | 'chamfer') => {
    if (locked) return;
    if (graphSelection?.kind !== 'point') { if (kind === 'fillet') beginProfileCommand('fillet'); return; }
    setTool('select'); setGraphRelationCommand({ kind, token: crypto.randomUUID() }); setInspectorCollapsed(false);
  };
  const acceptSketchCorner = (entityId: string, relationId: string) => {
    selectGraph({ kind: 'entity', id: entityId }); setGraphRelationCommand({ kind: 'inspect', relationId, token: crypto.randomUUID() });
  };
  const changeConstruction = (value: boolean) => {
    if (interactionState.current.locked || patternConstructionLocked) return;
    if (tool === 'select' && graphSelections.length) {
      if (sketch && graphEntities.length === graphSelections.length)
        submitEdit(signal => props.onEdit({ kind: 'set-sketch-construction', sketchId: sketch.id, entityIds: graphEntities.map(entity => entity.id), construction: value }, signal));
      return;
    }
    if (tool === 'select' && sketch && profile) {
      submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...sketch,
        profiles: sketch.profiles.map(entry => entry.id === profile.id ? { ...entry, construction: value } : entry)
      } }, signal));
      return;
    }
    setConstruction(value);
  };
  const parameterMenu = [
    { label: 'New parameter', help: 'A named value that dimensions can use in expressions. Editing it updates every linked dimension.', onSelect: () => parameterControls.current?.create('parameter') },
    { label: 'New group', help: 'A folder for organising parameters. Removing a group keeps its values.', onSelect: () => parameterControls.current?.create('group') },
  ];
  const parameterContent = <CadParametersPanel controls={parameterControls} key={`parameters-${externalWorkflowOpen}-${pluginsOpen}`} document={document} onEditMany={props.onEditMany} onInspectParameter={inspectParameter} onInspectUsage={inspectParameterUsage} onPendingChange={setParameterPending} interactionLocked={Boolean(props.sketchEdit || currentDimensionPick) || commandSubmission.applying || drawingPending || editorPending || dimensionPending || namePending || treeRenamePending || newFeature !== null || resolvingTopology !== null || storageBusy || deleteFeature !== null || externalWorkflowOpen || pluginsOpen || Boolean(currentSketchPlaneRequest || currentReferencePick)} cancelSignal={cancelSignal} />;
  const specificationTree = <CadFeatureTree parameterContent={parameterContent} parameterMenu={parameterMenu} selectionOnly={Boolean(props.sketchEdit || currentReferencePick || currentSketchPlaneRequest || currentSketchReferencePick)} allowPrincipalPlaneSelection={Boolean(currentSketchPlaneRequest)} selectableFeatureIds={currentSketchReferencePick ? currentSketchReferencePick.eligibleSketchIds : props.sketchEdit ? [props.sketchEdit.sketchId] : currentReferencePick?.eligibleIds ?? (currentSketchPlaneRequest ? document.features.filter(feature => feature.kind === 'datum-plane' && !feature.suppressed).map(feature => feature.id) : undefined)} document={document} diagnostics={build?.diagnostics} selectedId={selectedId} selectedProfileId={profileId} locked={treeLocked} onRenamePendingChange={setTreeRenamePending} cancelSignal={cancelSignal} selectedReferencePlane={typeof selectedReferencePlane === 'string' ? selectedReferencePlane : null} onSelectReferencePlane={selectReferencePlane} onCreateSketch={plane => { if (!interactionState.current.locked) run(() => createSketchOnPlane(plane)); }} onRename={(feature, name, renamedProfileId, signal) => {
    if (document.features.find(entry => entry.id === feature.id) !== feature) throw new Error('The part changed. Cancel and reopen the rename editor.');
    return props.onEdit({ kind: 'update-feature', feature: renamedProfileId && feature.kind === 'sketch' ? { ...feature, profiles: feature.profiles.map(entry => entry.id === renamedProfileId ? { ...entry, name } : entry) } : { ...feature, name } }, signal);
  }} onContextMenuOpenChange={setTreeMenuOpen} onProperties={id => openProperties(id ? { kind: 'feature', featureId: id } : { kind: 'body' })} onChangeSketchPlane={beginChangeSketchPlane} onSuppress={(feature, suppressed) => submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...feature, suppressed } }, signal))} onDelete={feature => { setSelectedId(feature.id); setProfileId(null); setDeleteFeature(feature); }} onUpdateProfile={(source, next) => submitEdit(signal => props.onEdit({ kind: 'update-feature', feature: { ...source, profiles: source.profiles.map(entry => entry.id === next.id ? next : entry) } }, signal))} onDeleteProfile={deleteProfile} onCopyProfile={props.sketchEdit ? undefined : beginProfileCopy} highlightedFeatureIds={parameterUsages.map(usage => usage.featureId)} onSelect={choose} onConfigure={configureFeature} onEditSketch={editSketch} onEditCurve={editCurve} onSelectProfile={(feature, id) => { editSketch(feature); setProfileId(id); setProfileCommand(null); }} />;

  const header = <div className="cad-header" aria-label="CAD document commands" inert={deleteFeature || pluginsOpen || externalWorkflowOpen || currentCanvasMenu || treeMenuOpen ? true : undefined}>
      <Button className="cad-back" aria-label="Workbench" title="Back to Workbench" onClick={() => run(props.onBack)} disabled={locked || Boolean(props.sketchEdit)}><ArrowLeft size={14} /></Button>
      <span className={`cad-save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Unsaved' : ''}</span>
      {buildState === 'error' && <span className="cad-header-build-state" role="status">Feature needs attention</span>}
      <div className="cad-header-actions">
        <div className="cad-menu-anchor"><Button ref={fileMenuTrigger} disabled={locked || Boolean(props.sketchEdit)} aria-haspopup="menu" aria-expanded={fileMenu} aria-controls="cad-file-menu" onClick={() => setFileMenu(!fileMenu)}>File <ChevronDown size={12} /></Button>{fileMenu && <><Button variant="scrim" tabIndex={-1} className="cad-menu-scrim" aria-label="Close file menu" onClick={() => setFileMenu(false)} /><MenuSurface ref={fileMenuPanel} onKeyDown={event => {
          if (event.key !== 'Tab' || event.nativeEvent.isComposing) return;
          event.preventDefault(); event.stopPropagation();
          const trigger = fileMenuTrigger.current, toolbar = trigger?.closest('.cad-header-actions');
          const controls = [...toolbar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []]
            .filter(control => !fileMenuPanel.current?.contains(control) && !control.classList.contains('cad-menu-scrim'));
          const index = controls.findIndex(control => control === trigger);
          setFileMenu(false); (controls[index + (event.shiftKey ? -1 : 1)] ?? trigger)?.focus();
        }} onDismiss={() => { setFileMenu(false); fileMenuTrigger.current?.focus(); }} className="cad-file-menu" id="cad-file-menu" aria-label="CAD document commands"><MenuItem onClick={() => run(props.onNewDocument)}><FilePlus2 size={14} /> New part</MenuItem><MenuItem onClick={() => run(props.onOpenDocument)}><FolderOpen size={14} /> Open saved part</MenuItem><MenuItem onClick={() => { setFileMenu(false); fileInput.current?.click(); }}><FolderOpen size={14} /> Import file</MenuItem>{props.onCaptureViewport && <MenuItem disabled={locked || (!canvasReference && (hasActiveBodyFeatures ? !hasSolid || props.buildVersion !== props.documentVersion : references.length === 0))} onClick={() => run(() => props.onCaptureViewport?.())}><CameraCaptureIcon size={14} /> Capture view PNG</MenuItem>}<MenuSeparator />{props.onRebuild && <MenuItem disabled={locked} onClick={() => run(() => props.onRebuild?.())}><RefreshIcon size={14} /> Rebuild model</MenuItem>}<MenuItem onClick={() => run(props.onExportDocument)}><Download size={14} /> Download CAD document</MenuItem><MenuItem disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('step'))}><Download size={14} /> Export STEP</MenuItem><MenuItem disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('stl'))}><Download size={14} /> Export STL</MenuItem><MenuItem disabled={!document.features.some(feature => !feature.suppressed && (feature.kind === 'sketch' && hasMaterial(feature) || feature.kind === 'curve')) && !hasSolid || !props.onOpenDxfExport} onClick={() => run(() => props.onOpenDxfExport?.())}><Download size={14} /> Export DXF</MenuItem><Tooltip content={CAD_KERNEL_THIRD_PARTY.description}><MenuItem asChild><a href={CAD_KERNEL_THIRD_PARTY.href} aria-label={CAD_KERNEL_THIRD_PARTY.label}  target="_blank" rel="noopener noreferrer">Geometry kernel licenses</a></MenuItem></Tooltip><MenuSeparator />{props.onSectionForCam && <MenuItem disabled={locked || !sectionBodyId || !hasSolid || props.buildVersion !== props.documentVersion || Boolean(build?.diagnostics.length)} title="Create CAM geometry from a planar section" onClick={() => sectionBodyId && run(() => props.onSectionForCam?.(sectionBodyId))}><SectionCamIcon size={14} /> Section for CAM</MenuItem>}<MenuItem disabled={locked || (!selectedSketch || !hasMaterial(selectedSketch))} onClick={() => selectedSketch && run(() => props.onSendToCam(selectedSketch.id))}><SendCamIcon size={14} /> Send sketch to CAM</MenuItem></MenuSurface></>}</div>
        <Button aria-label="Undo" title="Undo · Ctrl+Z" disabled={!canUndo || locked} onClick={() => run(props.onUndo)}><Undo2 size={15} /></Button><Button aria-label="Redo" title="Redo · Ctrl+Shift+Z" disabled={!canRedo || locked} onClick={() => run(props.onRedo)}><Redo2 size={15} /></Button>
        <Button disabled={locked || Boolean(props.sketchEdit)} onClick={() => run(props.onSave)}><Save size={14} /> {storageBusy ? 'Working…' : 'Save'}</Button>

      </div>
      <Input ref={fileInput} type="file" accept=".wireedm-cad,.json,.step,.stp,.stl,.dxf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) run(() => props.onImportDocument(file)); event.target.value = ''; }} />
    </div>;

  const toolbar = <div className="cad-toolbar" aria-label="CAD tools" data-cad-tool-context={sketch ? 'sketch' : curve || curveCreation ? 'curve' : 'model'} inert={deleteFeature || pluginsOpen || externalWorkflowOpen || currentCanvasMenu || treeMenuOpen ? true : undefined}>
      {!canvasReference && <div className="cad-tool-group">{toolButton('Sketch', SketchIcon, startSketch, locked)}{toolButton('Plane', DatumPlaneIcon, () => startFeature('datum-plane'), locked)}{toolButton('Curve', CurveIcon, () => startFeature('curve'), locked)}</div>}
      <div className="cad-tool-group">{toolButton('Plugins', AddIcon, () => setPluginsOpen(true), locked || Boolean(props.sketchEdit))}</div>
      {sketch ? <><div className="cad-tool-group">{toolButton('Select', SelectIcon, () => setTool('select'), locked, tool === 'select', undefined, 'S')}{toolButton('Rectangle', RectangleIcon, () => { setTool('rectangle'); setProfileId(null); setGraphPick(null); }, locked, tool === 'rectangle', undefined, 'R')}{toolButton('Circle', CircleIcon, () => { setTool('circle'); setProfileId(null); setGraphPick(null); }, locked, tool === 'circle', undefined, 'C')}{toolButton('Slot', SlotIcon, () => { setTool('slot'); setProfileId(null); setGraphPick(null); }, locked, tool === 'slot', undefined, 'O')}{toolButton('Polyline', PolylineIcon, () => { setTool('polygon'); setProfileId(null); setGraphPick(null); }, locked, tool === 'polygon', undefined, 'L')}{toolButton('Path', ClosedPathIcon, () => { setTool('path'); setProfileId(null); setGraphPick(null); }, locked, tool === 'path', 'Draw an open or closed path with lines and three-point arcs', 'P')}{toolButton('Trim', TrimIcon, () => { setTool('trim'); setProfileId(null); setGraphPick(null); }, locked || !sketch.graph, tool === 'trim', sketch.graph ? 'Click edge pieces to remove them up to the nearest crossing edge' : 'Trim needs a sketch drawn with connected edges', 'T')}</div><div className="cad-tool-group">{toolButton('Dimension', MeasureIcon, beginSketchDimension, locked || patternDimensionLocked || !sketchDimensionAvailable && !graphDimensionAvailable && !graphPointPair && !canPickDimension, Boolean(currentDimensionPick), circleSourceDriven && !canPickDimension ? 'Radius already follows an expression. Edit or release it with fx.' : 'Add or edit a driving sketch dimension', 'D')}<CadToolbarMenu label="Constrain" menuLabel="Constraint tools" title="Constrain the selected geometry, or choose a constraint and then pick the geometry it asks for." icon={<ConstraintIcon size={15} strokeWidth={1.5} />} disabled={locked || !sketch.graph} pressed={Boolean(currentConstraintTool)}
        items={[...constraintChoices.length && sketch.graph ? [{ kind: 'label' as const, key: 'selection', label: 'For the selection' }, ...constraintChoices.map(choice => ({ key: `selection-${choice.tool}`, label: cadSketchConstraintToolLabels[choice.tool],
          checked: choice.state === 'applied', disabled: choice.state === 'blocked', title: constraintChoiceHelp(choice), onSelect: () => { if (!locked && sketch.graph) toggleConstraint(sketch.graph, sketch.id, choice); } })),
          { kind: 'separator' as const, key: 'tools-separator' }, { kind: 'label' as const, key: 'tools', label: 'Choose, then pick' }] : [],
          ...CAD_SKETCH_CONSTRAINT_TOOLS.map(kind => ({ key: kind, label: cadSketchConstraintToolLabels[kind], title: cadSketchConstraintToolHelp[kind], onSelect: () => beginConstraintTool(kind) }))]} />{toolButton(graphSelections.length ? 'Move selection' : 'Move profile', MoveIcon, beginSketchMove, locked || Boolean(graphEditLock) || !graphSelections.length && (!profile || profile.geometry.kind === 'plugin'), false, graphEditLock ?? 'Move selected geometry without releasing dimensions')}{toolButton('Offset loop', OffsetIcon, beginSketchOffset, locked || !offsetSource, Boolean(currentOffset), 'Create an independent copy of one closed nonconstruction loop')}{toolButton('Mirror copy', MirrorIcon, beginSketchMirror, locked || !canMirrorSketch, Boolean(currentMirror), 'Mirror selected edges, then choose a line in the sketch. The copy is independent.', 'M')}<CadPatternCommand context="sketch" disabled={locked || !canPatternSketch} onChoose={beginSketchPattern} />{toolButton('Use reference', LinkIcon, beginSketchReference, locked || !referenceSources.length, Boolean(currentSketchReference), 'Use a linked line or circle from an earlier sketch on this plane')}<CadEdgeTreatmentCommand context="sketch" disabled={locked || profile?.geometry.kind !== 'rectangle' && !sketchCornerAvailable} chamferAvailable={sketchCornerAvailable} onChoose={beginSketchCorner} /></div><div className="cad-sketch-options"><label><Input type="checkbox" checked={tool === 'select' && graphSelections.length ? graphEntities.length === graphSelections.length && graphEntities.every(entity => entity.construction) : tool === 'select' && profile ? profile.construction : construction} disabled={locked || Boolean(graphEditLock) || patternConstructionLocked || tool === 'select' && graphSelections.some(selection => selection.kind === 'point')} onChange={(event) => changeConstruction(event.target.checked)} /> Construction</label></div></> : curve || curveCreation ? null : <><div className="cad-tool-group">{toolButton('Pad / Pocket', PadPocketIcon, () => startFeature('extrude'), locked || !hasPadSketch, false, undefined, 'E')}{toolButton('Revolve', RevolveIcon, () => startFeature('revolve'), locked || !hasRevolveSketch)}{toolButton('Loft', LoftIcon, () => startFeature('loft'), locked || document.features.filter(feature => feature.kind === 'sketch' && !feature.suppressed).length < 2, false, 'Loft through ordered sketch sections')}{toolButton('Sweep', SweepIcon, () => startFeature('sweep'), locked || !activeSketches.some(hasMaterial) || !document.features.some(feature => feature.kind === 'curve' && !feature.suppressed), false, 'Sweep a profile along a reference Curve')}</div><div className="cad-tool-group"><CadEdgeTreatmentCommand disabled={locked || !hasBody} onChoose={kind => startFeature(kind)} />{toolButton('Shell', ShellIcon, () => startFeature('shell'), locked || !topologyReady || !props.onResolveSelection || topologySelection?.picks[0]?.kind !== 'face')}{toolButton('Boolean', BooleanIcon, () => startFeature('boolean'), locked || currentBodyIds.length < 2)}</div><div className="cad-tool-group">{toolButton('Move', Move3dIcon, () => startFeature('transform'), locked || !hasBody)}<CadPatternCommand disabled={locked || !hasBody} onChoose={kind => startFeature(kind)} />{toolButton('Mirror', MirrorIcon, () => startFeature('mirror'), locked || !hasBody)}</div></>}
    </div>;
  // The model view stays mounted under a sketch surface so leaving the sketch keeps its camera and graphics context.
  const sketchSurface = Boolean(currentSketchReferencePick?.source || copiedPreview?.kind === 'sketch' && profileCopyPreview || canvasReference && !currentRegionPick);
  return <main className="cad-workbench" aria-label="Parametric CAD workbench">
    {publishHeader ? headerHost && createPortal(header, headerHost) : header}
    <div className="cad-body" inert={deleteFeature || pluginsOpen || externalWorkflowOpen || currentCanvasMenu || treeMenuOpen ? true : undefined}>
      <section className="cad-center" aria-label="Modeling area"><CadCommandDock toolbar={toolbar}>{currentSketchReferencePick?.source ? <CadSketchCanvas
          key={`use-source/${currentSketchReferencePick.source.id}`} sketch={currentSketchReferencePick.source} parameters={document.parameters} documentVersion={props.documentVersion}
          placementLabel={cadPlacementLabel(currentSketchReferencePick.source.plane, document.features)} tool="select" selectedProfileId={null}
          onSelectProfile={() => undefined} onAddProfile={addProfile} onPendingChange={setDrawingPending} onError={setError}
          cancelSignal={cancelSignal} interactionLocked={pendingOtherCommands || storageBusy || externalWorkflowOpen}
          onControlsReady={publishRenderedControls} getFitArea={getFitArea} navigationMode={preferences.navigationMode}
          graphControls={{ document, selection: [], geometryPick: currentSketchReferencePick.pick, onSelect: () => undefined, onEditMany: props.onEditMany }} /> : copiedPreview?.kind === 'sketch' && profileCopyPreview ? <CadSketchCanvas
          key={copiedPreview.id} sketch={copiedPreview} parameters={profileCopyPreview.parameters} documentVersion={props.documentVersion}
          placementLabel={cadPlacementLabel(copiedPreview.plane, profileCopyPreview.features)} tool="select" selectedProfileId={null}
          onSelectProfile={selectProfile} onAddProfile={addProfile} onPendingChange={setDrawingPending} onError={setError}
          cancelSignal={cancelSignal} interactionLocked onControlsReady={publishRenderedControls} getFitArea={getFitArea} navigationMode={preferences.navigationMode}
          graphControls={{ document: profileCopyPreview, selection: [], onSelect: selectGraph, onEditMany: props.onEditMany }} /> : canvasReference && !currentRegionPick ? <CadSketchCanvas getFitArea={getFitArea} graphContextMenu={graphContextMenu} onContextMenu={openSketchMenu} navigationMode={preferences.navigationMode} dimensionControls={preferences.showOnPartDimensions ? { document, onEditMany: props.onEditMany, onPendingChange: setDimensionPending, interactionLocked: Boolean(currentDimensionPick) || commandSubmission.applying || externalWorkflowOpen || pluginsOpen || editorPending || parameterPending || namePending || treeRenamePending || newFeature !== null || deleteFeature !== null || resolvingTopology !== null || storageBusy, onInspectInput: inspectInput, onConfigure: name => { setInspectorCollapsed(false); inspectInput(name); } } : undefined} previewProfile={profilePreview} previewSketch={preparedSketch} graphControls={sketch ? { document, selection: graphSelections, patternInteraction: currentPattern ? patternInteraction ?? undefined : undefined, onEditPattern: editSketchPattern, geometryPick: currentPlacement ? placementInteraction?.geometryPick : mirrorAxisPick ?? dimensionGeometryPick ?? constraintGeometryPick, positionPick: placementPositionPick, placement: currentPlacement ? placementInteraction?.placement : undefined, relation: inspectedRelation, inspection: currentMirror && mirrorInteraction?.kind === 'preview' ? { pointIds: [], entityIds: [mirrorInteraction.axisLineId] } : currentOffset?.source.kind === 'graph-cycle' ? { pointIds: [], entityIds: currentOffset.source.sourceRefs.map(ref => ref.entityId) } : inspectedDiagnostic, degreesOfFreedom: graphFreedom, showDimensions: preferences.showOnPartDimensions, onSelect: selectGraph, onSelectSet: selectGraphSet, datumSelection: graphDatums, onSelectDatum: selectDatum, onDelete: deleteSketchGeometry, onConfigureRelation: configureGraphRelation, onEditMany: applyCanvasEdits, onPrepareEdits: props.onPrepareEdits, onPreviewDocument: publishSketchPreview } : undefined} inspection={sketchInspection} key={`${document.id}/${canvasReference.id}`} sketch={canvasReference} documentVersion={props.documentVersion} parameters={preparedSketchDocument?.parameters ?? previewParameters ?? document.parameters} placementLabel={cadPlacementLabel(canvasReference.plane, document.features)} tool={tool} selectedProfileId={profileId} onSelectProfile={canvasReference.kind === 'curve' ? () => undefined : selectProfile} onAddProfile={addProfile} onAddFreshSketch={addFreshSketch} onAddPath={addPath} onTranslateProfile={(id, translation, signal) => { if (!sketch) return; return applyCanvasEdits([{ kind: 'translate-sketch-profiles', sketchId: sketch.id, profileIds: [id], translation }], signal); }} onMoveHandle={(id, handle, translation, signal) => { if (!sketch) return; return applyCanvasEdits([{ kind: 'move-sketch-handle', sketchId: sketch.id, profileId: id, handle, translation }], signal); }} onAddCurve={addCurve} onCancelCurve={cancel} curveCreation={Boolean(curveCreation)} onPendingChange={setDrawingPending} onError={setError} cancelSignal={cancelSignal} interactionLocked={curveCreation ? commandSubmission.applying || editorPending || parameterPending || namePending || storageBusy || deleteFeature !== null || resolvingTopology !== null : pendingOtherCommands || editorPending && !mirrorAxisPick && !placementPositionPick || storageBusy || externalWorkflowOpen} viewLocked={navigationLocked} onControlsReady={publishRenderedControls} /> : null}<CadViewport hidden={sketchSurface} key={document.id} depthControl={currentDepthControl} busyInputLocked={storageBusy} regionSelection={currentRegionPick} sourceReferencePickIds={currentRegionPick ? regionReferenceIds : currentReferencePick?.eligibleIds} getFitArea={getFitArea} onContextMenu={currentOwnedPick || currentSketchPlaneRequest ? undefined : openSolidMenu} navigationMode={preferences.navigationMode} navigationLocked={navigationLocked} meshes={currentAreaRepair && currentRegionPick ? NO_MESHES : displayedMeshes} references={references} referenceVersion={currentTopologyPick ? inputPicker.source?.inputToken ?? null : candidatePreview?.candidateId ?? props.documentVersion} selectedId={currentTopologyPick ? currentTopologyPick.request.bodyId : newFeature?.id ?? selectedId} selectedReferencePlane={selectedReferencePlane} onSelect={choose} onSelectPlane={selectReferencePlane} planePickingOnly={Boolean(currentSketchPlaneRequest)} interactionLocked={currentTopologyPick ? inputPicker.busy : locked && !currentOwnedPick && !currentSketchPlaneRequest} onControlsReady={publishRenderedControls} pickMode={currentTopologyPick ? inputPicker.mode : currentOwnedPick || currentSketchPlaneRequest ? 'body' : pickMode} topologySelection={currentTopologyPick ? inputPicker.selection : candidatePreview || currentOwnedPick ? null : topologySelection} pickingEnabled={currentTopologyPick ? Boolean(inputPicker.source) && !inputPicker.busy : Boolean(currentOwnedPick) || topologyReady && !candidatePreview} onTopologyPick={currentTopologyPick ? inputPicker.pick : currentOwnedPick || currentSketchPlaneRequest ? undefined : pickTopology} />
        {currentSketchPlaneRequest && <div className="cad-plane-request" role="status"><PencilRuler size={14} /><span>{currentSketchPlaneRequest.replaceSketchId ? `Click the new plane for ${document.features.find(feature => feature.id === currentSketchPlaneRequest.replaceSketchId)?.name ?? 'the sketch'}` : 'Select a plane in the design area'}</span><Button aria-label="Cancel plane selection" onClick={cancel}>Cancel</Button></div>}
        {buildState === 'building' && <div className="cad-build-overlay" role="status"><Loader2 size={13} className="cad-spin" /> Building solid geometry…</div>}
        <div className="cad-tree-overlay" data-cad-model-tree aria-label="Feature tree and parameters">{specificationTree}</div>
        </CadCommandDock>
      </section>
      {inspectorVisible && <aside key={`configuration-${externalWorkflowOpen}-${pluginsOpen}`} className={`cad-properties cad-floating-inspector${floatingPluginInspector ? ' cad-plugin-inspector' : ''}${inspectorCollapsed ? ' is-minimized' : ''}`} data-cad-properties aria-label="Feature properties"><CadInspectorTitleContext.Provider value={titleHost}><div className="cad-panel-heading"><span className="cad-panel-title">{titleClaims > 0 && !inspectorCollapsed ? null : currentTopologyPick ? currentTopologyPick.purpose === 'shell' ? 'Choose opening' : 'Choose edges' : currentRegionPick ? 'Choose areas' : sketch ? sketch.name : curve ? curve.name : newFeature ? 'New feature' : currentProperties ? 'Properties' : profile ? 'Configuration' : selected?.name ?? 'Properties'}<span ref={setTitleSlot} className="cad-panel-title-slot" hidden={inspectorCollapsed} /></span>{sketch && !currentAreaRepair && <CadSketchConstraintStatus document={document} sketch={sketch} version={props.documentVersion} inspect={props.onInspectSketchConstraints} onFreedom={publishSketchFreedom} enabled={props.sketchAnalysisReady !== false && !pending && !storageBusy && !externalWorkflowOpen} />}{currentTopologyPick ? <><Button variant="primary" className="cad-panel-finish" type="button" aria-label="Use topology selection" disabled={inputPicker.busy || !inputPicker.selection?.picks.length} onClick={() => { void inputPicker.finish(); }}><Check size={16} /></Button><Button type="button" aria-label="Cancel topology selection" onClick={currentTopologyPick.onCancel}><CloseIcon size={13} /></Button></> : currentRegionPick ? <><Button variant="primary" className="cad-panel-finish" aria-label="Finish area selection" title="Keep these areas" type="button" onClick={event => { event.preventDefault(); currentRegionPick.onFinish(); }}><Check size={16} /></Button><Button aria-label="Cancel area selection" title="Restore previous area choice" type="button" onClick={event => { event.preventDefault(); currentRegionPick.onCancel(); }}><CloseIcon size={13} /></Button></> : <>{sketch && (currentAreaRepair ? <Button variant="primary" className="cad-panel-finish" type="submit" form={areaRepairFormId} aria-label="Finish sketch" title="Finish sketch with replacement areas" disabled={!areaRepairReady || storageBusy || externalWorkflowOpen}><Check size={16} /></Button> : <Button variant="primary" className="cad-panel-finish" aria-label="Finish sketch" title="Finish sketch" disabled={locked} onClick={finishSketch}><Check size={14} /><span>Finish</span></Button>)}{props.sketchEdit && <Button aria-label="Cancel sketch edits" title="Discard sketch edits" disabled={storageBusy} onClick={cancelSketchEdit}><CloseIcon size={13} /></Button>}{curve && !curveCreation && <Button variant="primary" className="cad-panel-finish" aria-label="Finish curve editing" title="Finish curve editing" disabled={locked} onClick={finishCurve}><Check size={14} /><span>Finish</span></Button>}{currentProperties && !featureEditorOpen && !sketch && !curve && !newFeature && <Button aria-label="Close properties" title="Close properties (Esc)" onClick={() => setProperties(null)}><CloseIcon size={13} /></Button>}{featureEditorOpen && !curve && !newFeature && <Button aria-label="Close feature editor" title="Close editor (Esc)" disabled={commandSubmission.applying} onClick={closeFeatureEditor}><CloseIcon size={13} /></Button>}<Button aria-label={inspectorCollapsed ? 'Expand configuration' : 'Minimize configuration'} aria-expanded={!inspectorCollapsed} disabled={pending} onClick={() => setInspectorCollapsed(!inspectorCollapsed)}>{inspectorCollapsed ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</Button>{(sketch ? graphSelections.length > 0 || profile : featureEditorOpen) && !newFeature && <Button aria-label={graphSelections.length > 1 ? 'Delete selected geometry' : graphSelection ? `Delete selected ${graphSelection.kind === 'point' ? 'point and attached geometry' : 'edge'}` : 'Delete selected feature or profile'} disabled={locked || Boolean(props.sketchEdit && !graphSelections.length && !profile)} onClick={removeSelected}><Trash2 size={13} /></Button>}</>}</div>
        {currentRegionPick && <div className="cad-region-pick-hint" role="status">Click an area · Shift adds or removes</div>}
        {currentTopologyPick && <div className="cad-property-form">
          <div className="cad-region-pick-hint" role="status">{!inputPicker.source ? inputPicker.busy ? 'Showing feature input…' : 'Feature input unavailable' : inputPicker.busy ? 'Checking selection…' : inputPicker.mode === 'face' ? 'Pick one planar face to open' : 'Pick edges · Ctrl or Command adds or removes'}</div>
          {inputPicker.error && <p className="cad-error" role="alert">{inputPicker.error}</p>}
          {inputPicker.source && <CadTopologyInspector bodyId={inputPicker.source.bodyId} buildId={inputPicker.source.result.buildId} documentVersion={props.documentVersion}
            pickMode={inputPicker.mode} selection={inputPicker.selection} locked={inputPicker.busy} onInspect={inputPicker.inspect}
            onSelect={(pick, additive) => inputPicker.pick({ bodyId: currentTopologyPick.request.bodyId, pick }, additive)} onClear={() => inputPicker.pick(null, false)} />}
        </div>}
        <div hidden={inspectorCollapsed}>
        {resolvingTopology && <div className="cad-topology-resolving" role="status"><Loader2 size={14} className="cad-spin" /><span>Verifying {resolvingTopology === 'shell' ? 'opening face' : 'selected edges'}…</span><Button onClick={cancel}>Cancel</Button></div>}
        {currentProperties && !featureEditorOpen && !currentTopologyPick && !newFeature && !sketch && !resolvingTopology && props.onInspectTopology && topologyReady && build && (topologySelection?.bodyId ?? (selected && currentBodyIds.includes(selected.id) ? selected.id : null)) && <CadTopologyInspector key={`${props.documentVersion}-${build.buildId}-${topologySelection?.bodyId ?? selectedId}-${pickMode}`} bodyId={topologySelection?.bodyId ?? selectedId ?? ''} buildId={build.buildId} documentVersion={props.documentVersion} pickMode={pickMode === 'auto' ? topologySelection?.picks[0]?.kind ?? 'body' : pickMode} selection={topologySelection} locked={locked} onInspect={props.onInspectTopology} onSelect={(pick, additive) => pickTopology({ bodyId: topologySelection?.bodyId ?? selectedId ?? '', pick }, additive)} onClear={() => run(() => viewportControls.apply({ kind: 'clear-topology' }))} />}
        <fieldset className="cad-editor-fieldset" disabled={commandSubmission.applying || drawingPending && !curveCreation || parameterPending || dimensionPending || namePending || treeRenamePending || storageBusy || resolvingTopology !== null}>{curveCreation ? <CadCurveCreationFields draft={curveCreation} document={document} onChange={setNewFeature} onCancel={cancel} /> : newFeature ? <CadFeatureEditor onDepthInteractionReady={publishDepthInteraction} onReferencePick={requestReferencePick} key={`${newFeature.id}-${cancelSignal}`} feature={newFeature} document={document} documentVersion={props.documentVersion} onFeaturePreview={props.onFeaturePreview} featurePreview={props.featurePreview} previewEnabled={previewEnabled} isNew currentBodyIds={currentBodyIds} onApply={applyFeature} onCancel={cancel} onPendingChange={setEditorPending} /> : currentAreaRepair ? <CadSketchAreaRepairPanel key={currentAreaRepair.localVersion} formId={areaRepairFormId} document={document} documentVersion={props.documentVersion} inspection={currentAreaRepair} interactionLocked={storageBusy || externalWorkflowOpen || commandSubmission.applying} onReferencePick={requestReferencePick} onReadyChange={setAreaRepairReady} onFinish={finishSketchWithAreas} onCancel={() => setAreaRepair(null)} /> : currentDimensionPick ? <div className="cad-property-form"><div className="cad-property-title">Dimension</div><span role="status">{dimensionGeometryPick?.label}</span><div className="cad-form-actions"><Button onClick={cancelDimensionPick}>Cancel</Button></div></div> : profileCopyCommand ? <CadSketchProfileCopyEditor key={profileCopyCommand.token} document={document} documentVersion={props.documentVersion}
          request={profileCopyCommand.request} onEditMany={props.onEditMany} onPrepareEdits={props.onPrepareEdits}
          onPreviewDocument={setProfileCopyPreview} onPendingChange={setEditorPending}
          interactionLocked={pendingOtherCommands || drawingPending || storageBusy || externalWorkflowOpen || Boolean(props.sketchEdit)}
          onCancel={() => { setProfileCopyCommand(null); setProfileCopyPreview(null); }}
          onAccepted={candidate => { setProfileCopyAccepted({ document: candidate, sketchId: profileCopyCommand.request.newSketchId }); setProfileCopyCommand(null); }} /> : currentSketchReference && sketch ? <CadSketchReferenceEditor key={currentSketchReference.token} document={document} documentVersion={props.documentVersion} sketch={sketch}
          onEditMany={props.onEditMany} onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} onPendingChange={setEditorPending}
          onInteractionChange={setSketchReferenceInteraction} onCancel={() => setSketchReferenceCommand(null)}
          onAccepted={entityId => { selectGraph({ kind: 'entity', id: entityId }); setSketchReferenceCommand(null); }}
          interactionLocked={pendingOtherCommands || drawingPending && !currentSketchReferencePick || storageBusy || externalWorkflowOpen} /> : currentPattern && sketch ? <CadSketchLinearPatternEditor key={currentPattern.token} document={document} documentVersion={props.documentVersion} sketch={sketch} request={currentPattern.request}
            onEditMany={props.onEditMany} onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} onPendingChange={setEditorPending} onInteractionChange={setPatternInteraction}
            onCancel={() => setPatternCommand(null)} onAccepted={({seedEntityId}) => { selectGraph({kind:'entity',id:seedEntityId}); setPatternCommand(null); }}
            interactionLocked={pendingOtherCommands || drawingPending || storageBusy || externalWorkflowOpen} /> : currentPlacement && sketch ? <CadSketchPlacementEditor key={currentPlacement.token} document={document} documentVersion={props.documentVersion} sketch={sketch} selections={currentPlacement.selections} onEditMany={props.onEditMany} onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} onPendingChange={setEditorPending} onInteractionChange={setPlacementInteraction} onCancel={() => setPlacementCommand(null)} onAccepted={() => setPlacementCommand(null)} interactionLocked={pendingOtherCommands || drawingPending && !placementPositionPick || storageBusy || externalWorkflowOpen} /> : currentMirror && sketch ? <CadSketchMirrorEditor key={currentMirror.token} document={document} documentVersion={props.documentVersion} sketch={sketch} entityIds={currentMirror.entityIds} onEditMany={props.onEditMany} onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} onPendingChange={setEditorPending} onInteractionChange={setMirrorInteraction} onCancel={() => setMirrorCommand(null)} onAccepted={entityIds => { selectGraphSet(entityIds.map(id => ({ kind: 'entity', id }))); setMirrorCommand(null); }} interactionLocked={pendingOtherCommands || drawingPending && !mirrorAxisPick || storageBusy || externalWorkflowOpen} /> : currentOffset && sketch ? <CadSketchOffsetEditor key={currentOffset.token} document={document} documentVersion={props.documentVersion} sketch={sketch} source={currentOffset.source} onEditMany={props.onEditMany} onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} onPendingChange={setEditorPending} onCancel={() => setOffsetCommand(null)} onAccepted={entityId => { selectGraph({ kind: 'entity', id: entityId }); setOffsetCommand(null); }} interactionLocked={sketchEditorLocked} /> : graphSelections.length > 0 && sketch && graphRelationCommand ? <CadSketchRelationsPanel key={graphRelationCommand?.token} initialCommand={graphRelationCommand ?? undefined} dimensionOnly onPlaceGeometry={beginSketchPlacement} onEditPattern={editSketchPattern} onSelectPatternSeed={id => selectGraph({kind:'entity',id})} document={document} sketch={sketch} selection={graphSelections} onEditMany={props.onEditMany} onPendingChange={setEditorPending} onPrepareEdits={props.onPrepareEdits} onPreviewDocument={publishSketchPreview} onInspectRelation={inspectRelation} onInspectSubject={inspectConstraintSubject} onCornerAccepted={acceptSketchCorner} interactionLocked={commandSubmission.applying || drawingPending || parameterPending || dimensionPending || namePending || treeRenamePending || storageBusy || externalWorkflowOpen || pluginsOpen} cancelSignal={cancelSignal} /> : profile && sketch ? selectedProfileEditor : selected && (featureEditorOpen || curve?.id === selected.id || sketch?.id === selected.id && !graphSelections.length && !currentProperties) ? <CadFeatureEditor topologyPickingEnabled={Boolean(props.featureInputPicking)} onDepthInteractionReady={publishDepthInteraction} onReferencePick={requestReferencePick} key={`${selected.id}-${cancelSignal}`} feature={selected} document={document} documentVersion={props.documentVersion} onFeaturePreview={props.onFeaturePreview} featurePreview={props.featurePreview} previewEnabled={previewEnabled} isNew={false} onApply={applyFeature} onCancel={closeFeatureEditor} onPendingChange={setEditorPending} /> : currentProperties ? propertiesView : null}</fieldset>
        </div>
      </CadInspectorTitleContext.Provider></aside>}
    </div>
    {deleteFeature && <div className="cad-dialog-backdrop"><div ref={deleteDialog} className="cad-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="cad-delete-title"><h2 id="cad-delete-title">Delete {deleteFeature.name}?</h2>{dependentNames.length ? <><p>This also deletes {dependentNames.length} dependent feature{dependentNames.length === 1 ? '' : 's'}.</p><ul>{dependentNames.map((name) => <li key={name}>{name}</li>)}</ul></> : <p>You can restore this feature with Undo.</p>}<div className="cad-form-actions"><Button onClick={() => { commandSubmission.cancel(); setDeleteFeature(null); }}>Cancel</Button><Button variant="danger" className="cad-danger" disabled={commandSubmission.applying} onClick={() => submitEdit(signal => props.onEdit({ kind: 'delete-feature', featureId: deleteFeature.id, cascade: dependentNames.length > 0 }, signal), () => { setDeleteFeature(null); setSelectedId(current => current === deleteFeature.id ? null : current); })}><Trash2 size={13} /> Delete{dependentNames.length ? ' with dependents' : ''}</Button></div></div></div>}
    {currentCanvasMenu && canvasMenuItems.length > 0 && <CadContextMenu anchor={{ x: currentCanvasMenu.request.clientX, y: currentCanvasMenu.request.clientY }} title={canvasMenuTitle} items={canvasMenuItems} onClose={() => setCanvasMenu(null)} />}
    {pluginsOpen && <CadPluginsPanel onClose={() => { commandSubmission.cancel(); setPluginsOpen(false); }} onAdd={addPlugin} onListPlugins={props.onListPlugins} onInstallPlugin={props.onInstallPlugin} />}
  </main>;
}

export default CadWorkbench;
