import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

import { useAppRail } from '@/app/AppRailContext';
import { RailResizeHandle } from '@/components/ui/RailResizeHandle';
import { parseGCodeProgram } from '@/domain/editor/gcodeParser';
import {
  deleteBodyGroup,
  moveBodyGroup,
  moveSelectedLines,
  remapLineNumbersAfterDeletion,
  setStartAtLine
} from '@/domain/editor/gcodeLineOperations';
import { organizeGCodeStructure } from '@/domain/editor/gcodeStructure';
import { normalizeToISO } from '@/domain/editor/isoNormalizer';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import { evaluatePhysicalMachineFit } from '@/domain/machine-definition/machineFit';
import type { PostLibrary } from '@/domain/post-processor/postLibrary';
import type { ControllerArtifactResult } from '@/domain/wire-edm-job/controllerArtifact';
import {
  setManualCompensationIntent,
  type ManualCompensationSelection
} from '@/domain/compensation/intent';
import {
  derivePlannedRapidRoutes,
  mirrorPathDocument,
  mirrorPathElement,
  mirrorPathOperation,
  mirrorPathSegment,
  movePathOperation,
  movePathSegmentCenterTo,
  rotatePathDocument,
  rotatePathElement,
  rotatePathOperation,
  rotatePathSegment,
  setCircleOperationCenterPierceLeadIn,
  setGeometryLinkedInitialWirePosition,
  setManualInitialWirePosition,
  setPathOperationManualLeadIn,
  setPathOperationProgramStops,
  setPathOperationThreadingTransition,
  setPathOperationTransitions,
  setProjectThreadingDefault,
  setClosedOperationStartAtInferredPoint,
  setClosedOperationStartAtSegmentEndpoint,
  reversePathOperation,
  setPathOperationClassification,
  setPathOperationOrderStrategy,
  translatePathDocument,
  translatePathElement,
  translatePathOperation,
  translatePathSegment,
  type PathMirrorAxis
} from '@/domain/path-editor/pathDocumentOperations';
import {
  inferPathPoint,
  inferPerpendicularOperationOffset,
  reinferStoredPathPoint,
  type MagnetizedPathPoint,
  type MagnetizeMode,
  type PathPointInferenceMode
} from '@/domain/path-editor/pathPointInference';
import type {
  ContourClassification,
  OperationThreadingTransition,
  OperationProgramStop,
  OperationOrderStrategy,
  PathPlanningDocument
} from '@/domain/path-intel/types';
import { readOperationTransitions } from '@/domain/path-intel/operationTransitions';
import { orderedPathOperations } from '@/domain/path-intel/operationExecutionOrder';
import {
  deriveActiveMachiningOperations,
  setMachiningSpanParticipation,
  setPartialContourEntryReview,
  setPartialContourExitReview,
  setPartialContourCompensationSide
} from '@/domain/path-intel/machiningParticipation';
import {
  normalizeUpidPathElementSelection,
  upidPathElementIdForOperation
} from '@/domain/upid/projectRail';
import { buildUpidEditorTree, type UpidEditorTree } from '@/domain/upid/upidEditorTree';
import {
  createMeasurementPointPathSnapFromMagnetized,
  exportMeasurementPointsAsCsv,
  insertMeasurementPointsIntoText,
  type MeasurementPoint
} from '@/domain/editor/measurementPoints';

import { EditorCanvasPanel } from './EditorCanvasPanel';
import { EditorGuideDialog } from './EditorGuideDialog';
import { EditorHeaderBar, type EditorDocumentContext } from './EditorHeaderBar';
import { EditorInspectorPanel } from './EditorInspectorPanel';
import { EditorInitialWirePositionPanel } from './EditorInitialWirePositionPanel';
import { EditorEntryExitPanel } from './EditorEntryExitPanel';
import { EditorBetweenContoursPanel } from './EditorBetweenContoursPanel';
import {
  EditorContourSetupPanel,
  EditorGeometrySetupPanel,
  EditorSetStartPanel
} from './EditorWorkflowSetupPanels';
import { EditorProgramStopsPanel } from './EditorProgramStopsPanel';
import {
  resolveEditorProgramTreeAction,
  type EditorProgramTreeAction,
  type EditorProgramTreeExactTarget
} from './editorProgramTreeActions';
import { EditorMachiningParticipationPanel } from './EditorMachiningParticipationPanel';
import {
  EditorWorkflowMenuBar,
  type EditorWorkflowMenuGroup
} from './EditorWorkflowMenuBar';
import {
  EditorPathNavigatorPanel,
  type EditorPathElementRef
} from './EditorPathNavigatorPanel';
import { EditorProgramLinesPanel } from './EditorProgramLinesPanel';
import { EditorProgramTree, type EditorProgramTreeNode } from './EditorProgramTree';
import { EditorProgramTextPanel } from './EditorProgramTextPanel';
import { EditorStatusBar } from './EditorStatusBar';
import { EditorMeasurePanel } from './EditorMeasurePanel';
import { useEditorMeasurement } from './useEditorMeasurement';
import { EditorControllerArtifactDialog } from './EditorControllerArtifactDialog';
import { EditorExecutionDiagnostics } from './EditorExecutionDiagnostics';
import {
  clampEditorFloatingPanelGeometry,
  EditorPanelDockZone,
  EditorWorkspacePanelFrame,
  type EditorDockSide,
  type EditorFloatingPanelGeometry,
  type EditorPanelPlacement
} from './EditorWorkspacePanels';
import { EditorUpidRail, type EditorUpidRailMode } from './EditorUpidRail';
import { defaultEditorProgramTreeExpansion } from './editorProgramTreeState';
import {
  cloneEditorDraftState,
  createEditorDraftState,
  editorDraftPathDocument,
  editorDraftSignature,
  editorDraftText,
  type EditorDraftState
} from './editorDraftState';
import type { EditorGuideLanguage, EditorGuideTarget } from './editorGuideContent';
import {
  confirmBulkLineDelete,
  confirmGroupDelete,
  flattenStructureLines,
  formatBounds,
  readStoredGroupExpanded,
  readStoredGuideLanguage,
  readStoredLineMode,
  sanitizeLineText,
  selectLineRange,
  toggleLine,
  writeStoredGroupExpanded,
  writeStoredGuideLanguage,
  writeStoredLineMode
} from './editorLineState';
import {
  readPathDocumentBounds,
  readPathDocumentBoundsCenter,
  readPathSelectionBoundsCenter,
  resolvePathDragTarget
} from './pathSelectionGeometry';
import {
  readEditorWorkspaceRenderedPlacement,
  writeEditorWorkspaceLayout
} from './workspace/editorWorkspaceLayout';
import {
  evaluateEditorCommand,
  type EditorCommandDefinition
} from './commands/editorCommands';
import {
  createEditorToolSession,
  editorToolSessionReducer,
  type EditorToolSession
} from './commands/editorToolSession';
import { EditorWorkflowTransitionDialog } from './EditorWorkflowTransitionDialog';
import {
  createEditorWorkflowSession,
  dismissEditorWorkflowTransition,
  markEditorWorkflowDirty,
  requestEditorWorkflowTransition,
  resolveEditorWorkflowTransition,
  type EditorWorkflowSession,
  type EditorWorkflowTransition
} from './workflows/editorWorkflowSession';

import {
  EDITOR_COMMAND_REGISTRY,
  EDITOR_WORKFLOW_MENU_TITLES,
  EDITOR_WORKSPACE_PANEL_DESCRIPTIONS,
  EDITOR_WORKSPACE_PANEL_TITLES,
  INSPECTOR_WORKSPACE_PANEL_IDS,
  PATH_WORKSPACE_PANEL_IDS,
  SET_START_COMMAND,
  readInitialWorkspaceLayout,
  type EditorWorkspacePanelId
} from './workspace/editorWorkspaceCatalog';
import {
  findReadableFloatingPanelGeometry,
  floatingPanelGeometriesEqual,
  readFloatingPanelViewport
} from './workspace/editorFloatingPanelPlacement';

interface EditorPageProps {
  program: LoadedEditorProgram | null;
  machines: readonly MachineDefinition[];
  posts: PostLibrary;
  planningMachine: MachineDefinition | null;
  interactionLocked?: boolean;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  saveStatus: 'idle' | 'saving' | 'error';
  saveErrorMessage: string | null;
  onBackToDashboard: () => void;
  onDownloadEditorFile: (fileName: string, text: string) => void;
  onGenerateControllerArtifact: (selection: {
    readonly machineId: string;
  }) => Promise<ControllerArtifactResult>;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onReimportDxfUnits?: () => void | Promise<void>;
  onSaveEditorDraft: (draft: EditorSaveDraft) => void | Promise<void>;
  onStatusMessage?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

interface EditorDraftSnapshot {
  canvasMouseMode: 'select' | 'point';
  draft: EditorDraftState;
  historyLabel?: string;
  gridSnapEnabled: boolean;
  measurementPoints: MeasurementPoint[];
  pathClickMode: 'set-start' | MagnetizeMode | null;
  pathTargetXDraft: string;
  pathTargetYDraft: string;
  pathTranslateXDraft: string;
  pathTranslateYDraft: string;
  pointXDraft: string;
  pointYDraft: string;
  setStartInferenceMode: SetStartInferenceMode;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  selectedProgramExactTarget: EditorProgramTreeExactTarget | null;
  selectedProgramTreeKey: string | null;
}

type SetStartInferenceMode = Extract<
  PathPointInferenceMode,
  'endpoint' | 'nearest' | 'midpoint' | 'perpendicular'
>;

export function EditorPage({
  program,
  machines,
  posts,
  planningMachine,
  interactionLocked = false,
  importStatus,
  importErrorMessage,
  saveStatus,
  saveErrorMessage,
  onBackToDashboard,
  onDownloadEditorFile,
  onGenerateControllerArtifact,
  onImportProgramFile,
  onReimportDxfUnits,
  onSaveEditorDraft,
  onStatusMessage
}: EditorPageProps) {
  const planningPackage = useMemo(() => {
    const binding = planningMachine?.bindings.find(({ id }) => id === planningMachine.activeBindingId);
    if (!binding) return null;
    const installed = posts.installations.find(({ ref }) => ref.packageId === binding.post.packageId &&
      ref.version === binding.post.version && ref.contentHash === binding.post.contentHash);
    if (!installed) return null;
    return { name: installed.package.manifest.name,
      separationMechanisms: Array.isArray(installed.package.manifest.capabilities.wireSeparation)
        ? installed.package.manifest.capabilities.wireSeparation : [] };
  }, [planningMachine, posts]);
  const { closeCompactDrawerWithRailFocus, compactDrawer, compactModalHost, compactTransitionOverlay, isCompactViewport, isMiddleViewport, setCompactDrawer, setCompactTransitionOverlay, setHeaderContent, setRailContent } = useAppRail();
  const [initialWorkspaceLayout] = useState(() => readInitialWorkspaceLayout());
  const [draftState, setDraftState] = useState<EditorDraftState>(() => createEditorDraftState(program));
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const lastClickedLineRef = useRef<number | null>(null);
  const [pinnedLines, setPinnedLines] = useState<number[]>([]);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [previewCursorPoint, setPreviewCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false);
  const [canvasMouseMode, setCanvasMouseMode] = useState<'select' | 'point'>('select');
  const [guideHighlightTarget, setGuideHighlightTarget] = useState<EditorGuideTarget | null>(null);
  const [guideLanguage, setGuideLanguage] = useState<EditorGuideLanguage>(readStoredGuideLanguage);
  const [guideOpen, setGuideOpen] = useState(false);
  const [programLinesOpen, setProgramLinesOpen] = useState(true);
  const [pointXDraft, setPointXDraft] = useState('');
  const [pointYDraft, setPointYDraft] = useState('');
  const [pathTranslateXDraft, setPathTranslateXDraft] = useState('0');
  const [pathTranslateYDraft, setPathTranslateYDraft] = useState('0');
  const [pathTargetXDraft, setPathTargetXDraft] = useState('');
  const [pathTargetYDraft, setPathTargetYDraft] = useState('');
  const [lineMode, setLineMode] = useState<'select' | 'edit'>(readStoredLineMode);
  const [pathClickMode, setPathClickMode] = useState<'set-start' | MagnetizeMode | null>(null);
  const [entryExitCanvasPick, setEntryExitCanvasPick] = useState<{
    kind: 'entry' | 'exit';
    operationId: string;
  } | null>(null);
  const [activeToolSession, setActiveToolSession] = useState<EditorToolSession | null>(null);
  const [activeWorkflowSession, setActiveWorkflowSession] = useState<
    EditorWorkflowSession<EditorDraftSnapshot> | null
  >(null);
  const pendingWorkflowExitActionRef = useRef<null | ((unsavedAfterWorkflow: boolean) => void)>(null);
  const pendingProgramTreeSelectionRef = useRef<string | null>(null);
  const [workflowTransition, setWorkflowTransition] = useState<
    EditorWorkflowTransition<EditorDraftSnapshot> | null
  >(null);
  const isCompactViewportRef = useRef(isCompactViewport);
  isCompactViewportRef.current = isCompactViewport;
  const isMiddleViewportRef = useRef(isMiddleViewport);
  isMiddleViewportRef.current = isMiddleViewport;

  function updateWorkflowTransition(
    next: EditorWorkflowTransition<EditorDraftSnapshot> | null
  ) {
    setWorkflowTransition(next);
    setCompactTransitionOverlay(
      Boolean(
        (isCompactViewportRef.current || isMiddleViewportRef.current) &&
        next?.kind === 'held'
      )
    );
  }

  useLayoutEffect(() => {
    setCompactTransitionOverlay(
      Boolean(
        (isCompactViewport || isMiddleViewport) &&
        workflowTransition?.kind === 'held'
      )
    );
  }, [
    isCompactViewport,
    isMiddleViewport,
    setCompactTransitionOverlay,
    workflowTransition
  ]);

  useEffect(() => () => setCompactTransitionOverlay(false), [setCompactTransitionOverlay]);

  const [activeWorkflowPendingReasons, setActiveWorkflowPendingReasons] = useState<
    Record<string, string>
  >({});
  const [hoveredPathElement, setHoveredPathElement] = useState<EditorPathElementRef | null>(null);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [pathHoverAssistEnabled, setPathHoverAssistEnabled] = useState(false);
  const [setStartInferenceMode, setSetStartInferenceMode] =
    useState<SetStartInferenceMode>('endpoint');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedPathElement, setSelectedPathElement] = useState<EditorPathElementRef | null>(null);
  const [selectedPathOperationId, setSelectedPathOperationId] = useState<string | null>(null);
  const [selectedProgramExactTarget, setSelectedProgramExactTarget] =
    useState<EditorProgramTreeExactTarget | null>(null);
  const [selectedProgramTreeKey, setSelectedProgramTreeKey] = useState<string | null>(null);
  const selectedDiagnosticId = selectedProgramExactTarget?.kind === 'diagnostic'
    ? selectedProgramExactTarget.diagnosticId
    : null;
  const selectedMachiningSpanId = selectedProgramExactTarget?.kind === 'machining-span'
    ? selectedProgramExactTarget.spanId
    : null;
  const selectedProgramStopId = selectedProgramExactTarget?.kind === 'program-stop'
    ? selectedProgramExactTarget.stopId
    : null;
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const [upidRailMode, setUpidRailMode] = useState<EditorUpidRailMode>('program');
  const [expandedProgramTreeKeys, setExpandedProgramTreeKeys] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [upidRailWidth, setUpidRailWidth] = useState(initialWorkspaceLayout.dockWidths.left);
  const [upidRailCollapsed, setUpidRailCollapsed] = useState(
    initialWorkspaceLayout.upidRailCollapsed
  );
  const [inspectorRailCollapsed, setInspectorRailCollapsed] = useState(false);
  const [inspectorRailWidth, setInspectorRailWidth] = useState(
    initialWorkspaceLayout.dockWidths.right
  );
  const [workspacePanelPlacements, setWorkspacePanelPlacements] = useState<
    Record<EditorWorkspacePanelId, EditorPanelPlacement>
  >(() => initialWorkspaceLayout.placements as Record<EditorWorkspacePanelId, EditorPanelPlacement>);
  const [workspacePanelGeometries, setWorkspacePanelGeometries] = useState<
    Record<EditorWorkspacePanelId, EditorFloatingPanelGeometry>
  >(
    () =>
      initialWorkspaceLayout.floatingGeometries as Record<
        EditorWorkspacePanelId,
        EditorFloatingPanelGeometry
      >
  );
  const [workspaceDockOrders, setWorkspaceDockOrders] = useState<Record<EditorDockSide, EditorWorkspacePanelId[]>>(
    () =>
      initialWorkspaceLayout.dockOrders as Record<EditorDockSide, EditorWorkspacePanelId[]>
  );
  const [expandedPathElementIds, setExpandedPathElementIds] = useState<Record<string, boolean>>({});
  const [redoStack, setRedoStack] = useState<EditorDraftSnapshot[]>([]);
  const [undoStack, setUndoStack] = useState<EditorDraftSnapshot[]>([]);
  const draftText = editorDraftText(draftState);
  const interpreterProfile = draftState.model === 'gcode-text'
    ? draftState.interpreterProfile ?? 'neutral' : 'neutral';
  const pathDocumentDraft = editorDraftPathDocument(draftState);
  const measurementSegments = useMemo(() => pathDocumentDraft?.segments ?? [], [pathDocumentDraft]);
  const measurement = useEditorMeasurement(measurementSegments);
  const programTree = useMemo(
    () => pathDocumentDraft ? buildUpidEditorTree(pathDocumentDraft) : null,
    [pathDocumentDraft]
  );
  const savedDraftSignature = useMemo(() => editorDraftSignature(program?.model === 'upid-document' &&
    program.project.content.kind === 'upid-document'
      ? { model: 'upid-document', pathDocument: program.project.content.document as PathPlanningDocument }
      : createEditorDraftState(program)), [program]);
  const programIdentity = program ? `${program.model}:${program.filePath}` : 'empty';
  const lastProgramIdentityRef = useRef(programIdentity);
  const draftSignature = useMemo(() => editorDraftSignature(draftState), [draftState]);
  const isImporting = importStatus === 'importing';
  const isSaving = saveStatus === 'saving';
  const isEditorMutationLocked = interactionLocked || isImporting || isSaving;
  const draftProgram = useMemo<LoadedEditorProgram | null>(
    () => {
      if (!program || program.model === 'upid-document' || pathDocumentDraft) return null;

      return {
        filePath: program.filePath,
        model: 'gcode-text',
        text: draftText,
        interpreterProfile,
        parseResult: parseGCodeProgram(draftText, interpreterProfile),
        project: program.project
      };
    },
    [draftText, interpreterProfile, pathDocumentDraft, program]
  );
  const draftParseResult = draftProgram?.parseResult ?? null;
  const pathCount = draftParseResult?.path.length ?? 0;
  const rapidMoveCount = draftParseResult?.path.filter((point) => point.type === 'rapid').length ?? 0;
  const cuttingMoveCount = draftParseResult?.path.filter((point) => point.type === 'cut').length ?? 0;
  const arcMoveCount = draftParseResult?.path.filter((point) => point.type === 'arc').length ?? 0;
  const geometryBounds = useMemo(() => pathDocumentDraft ? readPathDocumentBounds(pathDocumentDraft) : null, [pathDocumentDraft]);
  const boundsText = pathDocumentDraft
    ? geometryBounds ? formatBounds(geometryBounds) : '-'
    : draftParseResult && pathCount > 0
      ? formatBounds(draftParseResult.bounds)
      : '-';
  const machineFit = useMemo(
    () => pathDocumentDraft
      ? evaluatePhysicalMachineFit({ document: pathDocumentDraft, machine: planningMachine })
      : null,
    [pathDocumentDraft, planningMachine]
  );
  const constructionPreview = useMemo(() => {
    if (
      !pathDocumentDraft ||
      !previewCursorPoint ||
      (pathClickMode !== 'perpendicular' && pathClickMode !== 'tangent')
    ) {
      return null;
    }

    const sourcePoint = measurementPoints.at(-1);
    if (!sourcePoint) return null;

    const magnetized = inferPathPoint(pathDocumentDraft, {
      mode: pathClickMode,
      sourcePoint,
      hintPoint: previewCursorPoint
    }) as MagnetizedPathPoint | null;
    if (!magnetized) return null;

    return {
      candidate: magnetized,
      mode: pathClickMode,
      operationId: magnetized.operationId,
      pathElementId: magnetized.pathElementId,
      relation: magnetized.relation,
      segmentId: magnetized.segmentId,
      sourcePoint,
      targetPoint: magnetized.point
    };
  }, [measurementPoints, pathClickMode, pathDocumentDraft, previewCursorPoint]);
  const entryExitInferencePreview = useMemo(() => {
    if (!pathDocumentDraft || !entryExitCanvasPick || !previewCursorPoint) return null;
    const inferred = inferPerpendicularOperationOffset(pathDocumentDraft, {
      endpoint: entryExitCanvasPick.kind,
      operationId: entryExitCanvasPick.operationId,
      hintPoint: previewCursorPoint
    });
    if (!inferred) return null;
    return {
      candidate: inferred,
      mode: 'perpendicular' as const,
      operationId: inferred.operationId,
      pathElementId: inferred.pathElementId,
      relation: inferred.relation,
      segmentId: inferred.segmentId,
      sourcePoint: inferred.sourcePoint,
      targetPoint: inferred.point
    };
  }, [entryExitCanvasPick, pathDocumentDraft, previewCursorPoint]);
  const startPreview = useMemo(() => {
    if (
      !pathDocumentDraft ||
      !selectedPathOperationId ||
      !previewCursorPoint ||
      pathClickMode !== 'set-start'
    ) {
      return null;
    }

    const approachSource = derivePlannedRapidRoutes(pathDocumentDraft).find(
      (route) => route.operationId === selectedPathOperationId
    )?.startPoint;
    if (!approachSource) return null;

    const preview = inferPathPoint(pathDocumentDraft, {
      mode: setStartInferenceMode,
      operationId: selectedPathOperationId,
      sourcePoint: approachSource,
      hintPoint: previewCursorPoint
    });
    if (!preview) return null;
    const atEndpoint = preview.endpointRole !== null;

    return {
      candidate: preview,
      operationId: preview.operationId,
      pathElementId: preview.pathElementId,
      point: preview.point,
      pointRole: preview.endpointRole,
      relation: atEndpoint ? 'existing-point' as const : 'new-split-point' as const,
      inferenceRelation: preview.relation,
      segmentId: preview.segmentId,
      sourcePoint: preview.guide?.from
    };
  }, [
    pathClickMode,
    pathDocumentDraft,
    setStartInferenceMode,
    previewCursorPoint,
    selectedPathOperationId
  ]);
  const editorHeaderTitle =
    program?.model === 'upid-document'
      ? program.project?.name ?? 'Path Project'
      : program?.filePath;
  const editorHeaderTooltip = program?.model === 'upid-document' ? program.filePath : undefined;
  const documentContext: EditorDocumentContext =
    program?.model === 'upid-document'
      ? 'path-project'
      : program?.model === 'gcode-text'
        ? 'machine-program'
        : 'empty-program';
  const editorFileName = program?.filePath.split('/').pop() ?? '-';
  const hasUnsavedChanges = Boolean(program && draftSignature !== savedDraftSignature);
  const activeMutatingWorkflow = activeWorkflowSession?.kind === 'mutating'
    ? activeWorkflowSession
    : null;
  const workflowTargetChangeBlocked = Boolean(
    activeMutatingWorkflow && (
      (
        Object.keys(activeWorkflowPendingReasons).length > 0 &&
        [
          'geometry.transform',
          'machining.entry-exit',
          'machining.participation',
          'machining.program-stops'
        ].includes(activeMutatingWorkflow.commandId)
      ) || (
        activeMutatingWorkflow.commandId === 'machining.entry-exit' &&
        entryExitCanvasPick !== null
      )
    )
  );
  const workflowProjectSaveBlockedReason = activeMutatingWorkflow
    ? `Save or discard ${activeMutatingWorkflow.label} before saving the project.`
    : null;
  const constructionHoveredPathElement = useMemo<EditorPathElementRef | null>(
    () =>
      constructionPreview && pathHoverAssistEnabled
        ? {
            operationId: constructionPreview.operationId,
            pathElementId: constructionPreview.pathElementId,
            segmentId: constructionPreview.segmentId
          }
        : null,
    [constructionPreview, pathHoverAssistEnabled]
  );
  const startHoveredPathElement = useMemo<EditorPathElementRef | null>(
    () =>
      startPreview && pathHoverAssistEnabled
        ? {
            operationId: startPreview.operationId,
            pathElementId: startPreview.pathElementId,
            pointRole: startPreview.pointRole ?? undefined,
            segmentId: startPreview.segmentId
          }
        : null,
    [pathHoverAssistEnabled, startPreview]
  );
  const activeHoveredPathElement =
    constructionHoveredPathElement ?? startHoveredPathElement ?? hoveredPathElement;
  const editorInteractionHint = readEditorInteractionHint();
  const structure = useMemo(
    () => (draftProgram ? organizeGCodeStructure(draftProgram.text.split(/\r?\n/), interpreterProfile) : null),
    [draftProgram, interpreterProfile]
  );
  const lineRows = useMemo(() => (structure ? flattenStructureLines(structure) : []), [structure]);
  const bodyGroups = structure?.body.contours ?? [];
  const isPathProject = Boolean(pathDocumentDraft);
  const hasActiveRightDock = Boolean(
    isPathProject &&
    !isCompactViewport &&
    !isMiddleViewport &&
    activeWorkflowSession &&
    readEditorWorkspaceRenderedPlacement(
      workspacePanelPlacements,
      activeWorkflowSession.panelId,
      activeWorkflowSession.panelId
    ) === 'docked-right'
  );
  const statusOperation = pathDocumentDraft?.plan.operations.find(
    (operation) => operation.id === (selectedPathElement?.operationId ?? selectedPathOperationId)
  );
  const statusSegmentIndex = statusOperation?.segmentRefs.findIndex(
    (ref) => ref.segmentId === selectedPathElement?.segmentId
  ) ?? -1;
  const statusFeature = selectedPathElement?.travelRole
    ? { 'rapid-in': 'Positioning', 'lead-in': 'Entry', 'lead-out': 'Exit' }[selectedPathElement.travelRole]
    : statusSegmentIndex >= 0
      ? `Segment ${statusSegmentIndex + 1}`
      : null;
  const editorSelectionSummary = statusOperation
    ? [statusOperation.displayName, statusFeature, selectedPathElement?.pointRole].filter(Boolean).join(' · ')
    : selectedLines.length > 0
      ? `${selectedLines.length} ${selectedLines.length === 1 ? 'line' : 'lines'}`
      : 'None';
  const diagnosticCount = pathDocumentDraft
    ? pathDocumentDraft.diagnostics.length + (programTree?.diagnostics.length ?? 0)
    : (draftParseResult?.errors.length ?? 0) + (draftParseResult?.warnings.length ?? 0);
  const exportAvailable = isPathProject
    ? Boolean(program?.project)
    : documentContext === 'machine-program' && draftText.trim() !== '';
  const editorWorkflowMenus = useMemo<EditorWorkflowMenuGroup[]>(() => {
    if (!pathDocumentDraft) return [];
    const visiblePanelIds = Object.entries(workspacePanelPlacements)
      .filter(([, placement]) => placement !== 'hidden')
      .map(([panelId]) => panelId);
    const context = {
      documentAvailable: true,
      interactionLocked: Boolean(isEditorMutationLocked),
      selectedOperationId: selectedPathOperationId,
      selectedPathElementId: selectedPathElement?.pathElementId ?? null,
      activeTool: activeToolSession
        ? { commandId: activeToolSession.commandId, label: activeToolSession.label }
        : null,
      visiblePanelIds
    };
    return EDITOR_WORKFLOW_MENU_TITLES.map((title) => ({
      title,
      commands: EDITOR_COMMAND_REGISTRY.commandsForMenu(title)
        .map((command) => {
          const availability = evaluateEditorCommand(command, context);
          return {
            ariaLabel: command.id === 'export.preview' ? 'Open UPID export preview' : undefined,
            id: command.id,
            label: command.label,
            description: command.id === 'export.preview'
              ? 'Review exact controller output, readiness, transitions, and diagnostics.'
              : command.toolWindowId
                ? EDITOR_WORKSPACE_PANEL_DESCRIPTIONS[command.toolWindowId as EditorWorkspacePanelId]
                : undefined,
            enabled: availability.enabled,
            disabledReason: availability.enabled ? undefined : availability.reason,
            onExecute: () => {
              if (command.toolWindowId) openEditorWorkflow(command.id);
            }
          };
        })
    }));
  }, [
    activeToolSession,
    activeWorkflowSession,
    isCompactViewport,
    isEditorMutationLocked,
    pathDocumentDraft,
    pathClickMode,
    selectedPathElement,
    selectedPathOperationId,
    selectedDiagnosticId,
    selectedMachiningSpanId,
    selectedProgramStopId,
    selectedProgramTreeKey,
    workspacePanelPlacements
  ]);
  const editorRailContent = useMemo(() => {
    if (!pathDocumentDraft || !programTree) return null;

    const selectedOperationOrdinal = selectedPathOperationId
      ? programTree.operations.findIndex((node) => node.operationId === selectedPathOperationId) + 1
      : null;
    const programContent = (
      <EditorProgramTree
        expandedTreeKeys={expandedProgramTreeKeys}
        onEdit={openEditorWorkflowForTarget}
        onExpandedTreeKeysChange={setExpandedProgramTreeKeys}
        onSelect={handleSelectProgramTreeItem}
        selectedTreeKey={selectedProgramTreeKey}
        tree={programTree}
      />
    );
    const geometryContent = upidRailMode === 'geometry'
      ? renderPathNavigatorPanel(pathDocumentDraft, 'contour-tree')
      : null;
    const railProps = {
      geometryContent,
      mode: upidRailMode,
      onCollapseChange: (collapsed: boolean) => {
        if (collapsed && (isCompactViewport || isMiddleViewport)) {
          closeCompactDrawerWithRailFocus();
          return;
        }
        if (!collapsed && isMiddleViewport) {
          setCompactDrawer('upid');
          return;
        }
        setUpidRailCollapsed(collapsed);
      },
      onModeChange: setUpidRailMode,
      programContent,
      selectedOperationOrdinal: selectedOperationOrdinal && selectedOperationOrdinal > 0
        ? selectedOperationOrdinal
        : null,
      status: programTree.status
    };

    return {
      collapsed: <EditorUpidRail {...railProps} collapsed />,
      expanded: <EditorUpidRail {...railProps} collapsed={false} />,
      hasActiveWorkflow: Boolean(activeWorkflowSession),
      isCollapsed: upidRailCollapsed,
      isPathProject: true,
      onCollapsedChange: setUpidRailCollapsed,
      replaceRailChrome: true,
      sizing: {
        maxWidth: 360,
        minWidth: 190,
        onWidthChange: setUpidRailWidth,
        width: upidRailWidth
      }
    };
  }, [
    activeWorkflowSession,
    closeCompactDrawerWithRailFocus,
    isCompactViewport,
    isMiddleViewport,
    isEditorMutationLocked,
    workflowTargetChangeBlocked,
    expandedPathElementIds,
    expandedProgramTreeKeys,
    pathDocumentDraft,
    pathHoverAssistEnabled,
    programTree,
    selectedPathElement,
    selectedPathOperationId,
    selectedDiagnosticId,
    selectedMachiningSpanId,
    selectedProgramStopId,
    selectedProgramTreeKey,
    activeHoveredPathElement,
    measurementPoints,
    upidRailMode,
    upidRailCollapsed,
    upidRailWidth
  ]);
  const editorHeaderContent = useMemo(
    () => (
      <EditorHeaderBar
        documentContext={documentContext}
        exportAvailable={exportAvailable}
        exportLabel={
          documentContext === 'machine-program'
              ? 'Export normalized ISO'
              : null
        }
        filePath={program?.filePath}
        guideHighlightTarget={guideHighlightTarget}
        hasUnsavedChanges={hasUnsavedChanges}
        importErrorMessage={importErrorMessage}
        interactionLocked={isEditorMutationLocked}
        isImporting={isImporting}
        isSaving={isSaving}
        interpreterProfile={documentContext === 'machine-program' ? interpreterProfile : undefined}
        onBackToDashboard={handleBackToDashboard}
        onExport={
          documentContext === 'machine-program'
              ? handleExportNormalizedISO
              : null
        }
        onImportProgramFile={handleImportProgramFile}
        onInterpreterProfileChange={(profile) => {
          if (draftState.model !== 'gcode-text') return;
          applyEditorDraftState({ ...draftState, interpreterProfile: profile });
          clearTransientLineState();
        }}
        onOpenGuide={() => setGuideOpen(true)}
        onRedo={handleRedoDraft}
        onSave={handleSaveClick}
        onUndo={handleUndoDraft}
        redoAvailable={!activeMutatingWorkflow && redoStack.length > 0}
        saveErrorMessage={saveErrorMessage}
        saveDisabledReason={workflowProjectSaveBlockedReason}
        title={editorHeaderTitle}
        titleTooltip={editorHeaderTooltip}
        undoAvailable={!activeMutatingWorkflow && undoStack.length > 0}
        workspaceControls={pathDocumentDraft ? (
          <EditorWorkflowMenuBar groups={editorWorkflowMenus} />
        ) : undefined}
      />
    ),
    [
      activeMutatingWorkflow,
      editorHeaderTitle,
      editorHeaderTooltip,
      documentContext,
      draftState,
      draftSignature,
      draftText,
      exportAvailable,
      editorWorkflowMenus,
      guideHighlightTarget,
      hasUnsavedChanges,
      importErrorMessage,
      isEditorMutationLocked,
      isImporting,
      isPathProject,
      isSaving,
      onBackToDashboard,
      onDownloadEditorFile,
      onImportProgramFile,
      onSaveEditorDraft,
      pathDocumentDraft,
      program?.filePath,
      redoStack,
      saveErrorMessage,
      workflowProjectSaveBlockedReason,
      selectedPathElement,
      selectedPathOperationId,
      selectedDiagnosticId,
      selectedMachiningSpanId,
      selectedProgramStopId,
      selectedProgramTreeKey,
      undoStack
    ]
  );

  useEffect(() => {
    const identityChanged = lastProgramIdentityRef.current !== programIdentity;
    lastProgramIdentityRef.current = programIdentity;
    const nextDraft = createEditorDraftState(program);
    setDraftState((current) =>
      editorDraftSignature(current) === editorDraftSignature(nextDraft) ? current : nextDraft
    );

    if (!identityChanged) {
      const nextPathDocument = editorDraftPathDocument(nextDraft);
      if (!nextPathDocument) return;
      if (!selectedPathOperationId && !selectedPathElement) return;

      const normalizedSelection = normalizeUpidPathElementSelection(
        nextPathDocument,
        selectedPathOperationId,
        selectedPathElement
      );
      setSelectedPathElement(normalizedSelection);
      setSelectedPathOperationId(normalizedSelection?.operationId ?? null);
      return;
    }

    setSelectedPathOperationId(null);
    setSelectedPathElement(null);
    setSelectedProgramExactTarget(null);
    setSelectedProgramTreeKey(null);
    setHoveredPathElement(null);
    setPreviewCursorPoint(null);
    setMeasurementPoints([]);
    setPointXDraft('');
    setPointYDraft('');
    setPathTranslateXDraft('0');
    setPathTranslateYDraft('0');
    setPathTargetXDraft('');
    setPathTargetYDraft('');
    setExpandedGroups({});
    setExpandedPathElementIds({});
    setExportPreviewOpen(false);
    setActiveWorkflowSession(null);
    setActiveToolSession(null);
    setActiveWorkflowPendingReasons({});
    updateWorkflowTransition(null);
    pendingWorkflowExitActionRef.current = null;
    pendingProgramTreeSelectionRef.current = null;
    setEntryExitCanvasPick(null);
    setPathClickMode(null);
    setCanvasMouseMode('select');
    setRedoStack([]);
    setUndoStack([]);
    clearTransientLineState();
  }, [programIdentity, savedDraftSignature]);

  useEffect(() => {
    setInspectorRailCollapsed(false);
    setProgramLinesOpen(true);

  }, [program?.filePath, program?.model]);

  useEffect(() => {
    if (programTree) setExpandedProgramTreeKeys(defaultEditorProgramTreeExpansion(programTree));
  }, [programIdentity]);

  useEffect(() => {
    const reconciledExactTarget = reconcileProgramExactTarget(
      selectedProgramExactTarget,
      pathDocumentDraft
    );
    if (!sameProgramExactTarget(selectedProgramExactTarget, reconciledExactTarget)) {
      setSelectedProgramExactTarget(reconciledExactTarget);
    }
  }, [pathDocumentDraft, selectedProgramExactTarget]);

  useEffect(() => {
    if (!programTree || !selectedProgramTreeKey) return;

    const selectedTreeOperationId = findProgramTreeOperationId(
      programTree,
      selectedProgramTreeKey
    );
    const operationTreeKey = selectedPathOperationId
      ? programTree.operations.find(
          (node) => node.operationId === selectedPathOperationId
        )?.treeKey ?? null
      : null;
    if (selectedTreeOperationId === undefined) {
      setSelectedProgramTreeKey(operationTreeKey);
      return;
    }
    if (
      selectedPathOperationId &&
      selectedTreeOperationId !== selectedPathOperationId
    ) {
      setSelectedProgramTreeKey(operationTreeKey);
    } else if (!selectedPathOperationId && selectedTreeOperationId) {
      setSelectedProgramTreeKey(null);
    }
  }, [programTree, selectedPathOperationId, selectedProgramTreeKey]);

  useEffect(() => {
    const pendingReason = Object.values(activeWorkflowPendingReasons)[0];
    setActiveWorkflowSession((current) =>
      current?.kind === 'mutating' && current.dirty
        ? markEditorWorkflowDirty(
            current,
            pendingReason ? { enabled: false, reason: pendingReason } : { enabled: true }
          )
        : current
    );
  }, [activeWorkflowPendingReasons, draftSignature]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      writeEditorWorkspaceLayout({
        schemaVersion: 1,
        upidRailCollapsed,
        placements: workspacePanelPlacements,
        dockOrders: workspaceDockOrders,
        floatingGeometries: workspacePanelGeometries,
        dockWidths: { left: upidRailWidth, right: inspectorRailWidth }
      });
    }, 200);

    return () => window.clearTimeout(timeoutId);
  }, [
    inspectorRailWidth,
    upidRailCollapsed,
    upidRailWidth,
    workspaceDockOrders,
    workspacePanelGeometries,
    workspacePanelPlacements
  ]);

  useEffect(() => {
    function clampFloatingPanelsToViewport() {
      const viewport = readFloatingPanelViewport();
      setWorkspacePanelGeometries((current) => {
        let next = current;

        for (const panelId of [...PATH_WORKSPACE_PANEL_IDS, ...INSPECTOR_WORKSPACE_PANEL_IDS]) {
          if (workspacePanelPlacements[panelId] !== 'floating') continue;
          const clamped = clampEditorFloatingPanelGeometry(current[panelId], viewport);
          if (floatingPanelGeometriesEqual(clamped, current[panelId])) continue;

          if (next === current) next = { ...current };
          next[panelId] = clamped;
        }

        return next;
      });
    }

    window.addEventListener('resize', clampFloatingPanelsToViewport);
    return () => window.removeEventListener('resize', clampFloatingPanelsToViewport);
  }, [workspacePanelPlacements]);

  useEffect(() => {
    setRailContent(editorRailContent);
    return () => setRailContent(null);
  }, [editorRailContent, setRailContent]);

  useEffect(() => {
    if (!activeWorkflowSession && compactDrawer === 'workflow') setCompactDrawer(null);
  }, [activeWorkflowSession, compactDrawer, setCompactDrawer]);

  useEffect(() => {
    setHeaderContent(editorHeaderContent);
    return () => setHeaderContent(null);
  }, [editorHeaderContent, setHeaderContent]);

  useEffect(() => {
    if (!hasUnsavedChanges && !activeWorkflowSession?.dirty) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeWorkflowSession?.dirty, hasUnsavedChanges]);

  function setLastClickedLine(lineNumber: number | null) {
    lastClickedLineRef.current = lineNumber;
  }

  useEffect(() => {
    if (!guideHighlightTarget) return;
    const target = document.querySelector(`[data-guide-target="${guideHighlightTarget}"]`);
    if (!(target instanceof HTMLElement)) return;

    const frame = globalThis.requestAnimationFrame?.(() => {
      target.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
    });
    const timeout = window.setTimeout(() => setGuideHighlightTarget(null), 3000);

    return () => {
      if (typeof frame === 'number') globalThis.cancelAnimationFrame?.(frame);
      window.clearTimeout(timeout);
    };
  }, [guideHighlightTarget, activeWorkflowSession?.panelId, inspectorRailCollapsed, programLinesOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || exportPreviewOpen || guideOpen) return;
      if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"][aria-modal="true"]')) return;

      if (event.key === 'Escape') {
        if (activeWorkflowOwns('machining.entry-exit') && entryExitCanvasPick) {
          setEntryExitCanvasPick(null);
          return;
        }
        if (activeToolSession) {
          const nextSession = editorToolSessionReducer(activeToolSession, { type: 'escape' });
          if (nextSession.status === 'active') {
            setActiveToolSession(nextSession);
          } else {
            setActiveToolSession(null);
            setPathClickMode(null);
            requestCloseEditorWorkflow();
          }
          return;
        }
        if (
          activeWorkflowOwns('construction.measurement') &&
          (pathClickMode === 'perpendicular' || pathClickMode === 'tangent')
        ) {
          setPathClickMode(null);
          clearActiveWorkflowPending('construction-mode');
          markActiveWorkflowDirty('construction.measurement');
          return;
        }
        if (activeWorkflowOwns('construction.measurement') && canvasMouseMode === 'point') {
          setCanvasMouseMode('select');
          markActiveWorkflowDirty('construction.measurement');
          return;
        }
        if (activeWorkflowSession) {
          requestCloseEditorWorkflow();
          return;
        }
        setHoveredLine(null);
        setLastClickedLine(null);
        setSelectedLines([]);
        setSelectedPathElement(null);
        setSelectedPathOperationId(null);
        setSelectedProgramExactTarget(null);
        setSelectedProgramTreeKey(null);
        setPathClickMode(null);
        return;
      }

      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      if (isEditorMutationLocked) return;

      const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
      const isRedo =
        (event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey));
      const isClearPoints =
        event.altKey &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.code === 'KeyC';

      if (isUndo) {
        event.preventDefault();
        handleUndoDraft();
      } else if (isRedo) {
        event.preventDefault();
        handleRedoDraft();
      } else if (isClearPoints && measurementPoints.length > 0) {
        event.preventDefault();
        handleClearMeasurementPoints();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLines.length > 0) {
        event.preventDefault();
        if (pathDocumentDraft) {
          clearSelectedLines();
        } else {
          handleDeleteSelectedLines();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeToolSession, activeWorkflowSession, canvasMouseMode, draftText, entryExitCanvasPick, exportPreviewOpen, guideOpen, isCompactViewport, isEditorMutationLocked, measurementPoints.length, pathClickMode, pathDocumentDraft, program, redoStack, selectedLines, undoStack]);

  function handleBackToDashboard() {
    if (isEditorMutationLocked) return;
    runAfterActiveWorkflowResolved((unsavedAfterWorkflow) => {
      if (unsavedAfterWorkflow && !window.confirm('Discard unsaved changes?')) return;
      onBackToDashboard();
    });
  }

  function handleImportProgramFile(file: File) {
    if (isEditorMutationLocked) return;
    runAfterActiveWorkflowResolved((unsavedAfterWorkflow) => {
      if (unsavedAfterWorkflow && !window.confirm('Discard unsaved changes?')) return;
      void onImportProgramFile(file);
    });
  }

  async function handleSaveClick() {
    if (
      !program ||
      !hasUnsavedChanges ||
      isEditorMutationLocked ||
      activeWorkflowSession?.kind === 'mutating'
    ) return;
    await onSaveEditorDraft(
      pathDocumentDraft
        ? {
            model: 'upid-document',
            pathDocument: pathDocumentDraft
          }
        : {
            model: 'gcode-text',
            text: draftText,
            interpreterProfile
          }
    );
  }

  function handleNormalizeDraft() {
    if (!program || isEditorMutationLocked) return;
    replaceGCodeDraftText(normalizeToISO(draftText, { crlf: false }));
  }

  function handleExportNormalizedISO() {
    if (!program || isEditorMutationLocked || draftText.trim() === '') return;

    const dateStamp = new Date().toISOString().slice(0, 10);
    onDownloadEditorFile(`normalized-${dateStamp}.iso`, normalizeToISO(draftText));
  }

  function handleLineClick(lineNumber: number, event: MouseEvent<HTMLButtonElement>) {
    if (event.shiftKey && lastClickedLineRef.current !== null) {
      setSelectedLines(selectLineRange(lineRows, lastClickedLineRef.current, lineNumber));
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedLines((current) => toggleLine(current, lineNumber));
    } else {
      setSelectedLines([lineNumber]);
    }

    setLastClickedLine(lineNumber);
  }

  function handleTogglePin(lineNumber: number) {
    setPinnedLines((current) => toggleLine(current, lineNumber));
  }

  function handleTogglePathHoverAssist() {
    setPathHoverAssistEnabled((current) => {
      if (current) {
        setHoveredPathElement(null);
      }
      return !current;
    });
  }

  function handleSelectPathElement(element: EditorPathElementRef) {
    if (workflowTargetChangeBlocked) {
      onStatusMessage?.(
        'Apply or discard the pending workflow form before changing its target.',
        'warning'
      );
      return false;
    }
    setSelectedPathOperationId(element.operationId);
    setSelectedPathElement(element);
    setSelectedProgramExactTarget(element.machiningSpanId && element.operationId
      ? { kind: 'machining-span', operationId: element.operationId, spanId: element.machiningSpanId }
      : null);
    setSelectedProgramTreeKey(programTreeKeyForOperation(element.operationId));
    return true;
  }

  function handleSelectWorkflowOperation(operationId: string) {
    if (workflowTargetChangeBlocked && operationId !== selectedPathOperationId) {
      onStatusMessage?.(
        'Apply or discard the pending workflow form before changing its target contour.',
        'warning'
      );
      return;
    }
    setSelectedPathOperationId(operationId);
    setSelectedPathElement(null);
    setSelectedProgramExactTarget(null);
    setSelectedProgramTreeKey(programTreeKeyForOperation(operationId));
  }

  function handleSelectPathOperation(operationId: string) {
    return handleSelectPathElement({
      operationId,
      pathElementId: pathDocumentDraft
        ? upidPathElementIdForOperation(pathDocumentDraft, operationId)
        : null,
      segmentId: null
    });
  }

  function handleSelectProgramTreeItem(
    treeKey: string,
    node: EditorProgramTreeNode | null
  ) {
    const operationId = node && 'operationId' in node ? node.operationId :
      (programTree ? findProgramTreeOperationId(programTree, treeKey) : null) ??
      null;
    if (
      activeWorkflowSession?.dirty &&
      treeKey !== selectedProgramTreeKey
    ) {
      onStatusMessage?.(
        `Save or discard ${activeWorkflowSession.label} before changing the program-tree target.`,
        'warning'
      );
      return;
    }

    if (operationId) {
      if (!handleSelectPathOperation(operationId)) return;
    } else {
      if (workflowTargetChangeBlocked) {
        onStatusMessage?.(
          'Apply or discard the pending workflow form before changing its target.',
          'warning'
        );
        return;
      }
      setSelectedPathOperationId(null);
      setSelectedPathElement(null);
    }

    setSelectedProgramExactTarget(exactTargetForProgramTreeNode(node));
    setSelectedProgramTreeKey(treeKey);
  }

  function isGroupExpanded(groupId: string) {
    return expandedGroups[groupId] ?? readStoredGroupExpanded(groupId);
  }

  function handleToggleGroup(groupId: string) {
    const nextExpanded = !isGroupExpanded(groupId);
    setExpandedGroups((current) => ({ ...current, [groupId]: nextExpanded }));
    writeStoredGroupExpanded(groupId, nextExpanded);
  }

  function handleDeleteSelectedLines() {
    if (!program || pathDocumentDraft || selectedLines.length === 0 || isEditorMutationLocked) return;
    if (selectedLines.length > 3 && !confirmBulkLineDelete(selectedLines.length)) return;

    const linesToDelete = new Set(selectedLines);
    const nextText = draftText
      .split(/\r?\n/)
      .filter((_, index) => !linesToDelete.has(index + 1))
      .join('\n');

    replaceGCodeDraftText(nextText);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines((current) => remapLineNumbersAfterDeletion(current, linesToDelete));
    setSelectedLines([]);
  }

  function handleMoveSelectedLines(direction: -1 | 1) {
    if (!program || pathDocumentDraft || selectedLines.length === 0 || isEditorMutationLocked) return;

    const result = moveSelectedLines(draftText, selectedLines, direction);
    if (!result) return;

    replaceGCodeDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines(result.movedLineNumbers);
  }

  function handleSetLineMode(mode: 'select' | 'edit') {
    setLineMode(mode);
    writeStoredLineMode(mode);
    setHoveredLine(null);
    if (mode === 'edit') {
      setLastClickedLine(null);
      setSelectedLines([]);
    }
  }

  function handleLineEditCommit(lineNumber: number, nextText: string) {
    if (!program || isEditorMutationLocked) return;

    const sanitizedText = sanitizeLineText(nextText);
    const lines = draftText.split(/\r?\n/);
    if (lineNumber < 1 || lineNumber > lines.length || lines[lineNumber - 1] === sanitizedText) return;

    lines[lineNumber - 1] = sanitizedText;
    replaceGCodeDraftText(lines.join('\n'));
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines([]);
  }

  function handleMoveGroup(groupId: string, direction: -1 | 1) {
    if (!structure || !program || isEditorMutationLocked) return;

    const result = moveBodyGroup(draftText, structure, groupId, direction);
    if (!result) return;

    replaceGCodeDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines(result.movedLineNumbers);
  }

  function handleDeleteGroup(groupId: string) {
    if (!structure || !program || isEditorMutationLocked) return;

    const group = structure.body.contours?.find((candidate) => candidate.id === groupId);
    if (group && group.lines.length > 3 && !confirmGroupDelete(group.id, group.lines.length)) return;

    const result = deleteBodyGroup(draftText, structure, groupId);
    if (!result) return;

    const deletedLines = new Set(result.deletedLineNumbers);
    replaceGCodeDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines((current) => remapLineNumbersAfterDeletion(current, deletedLines));
    setSelectedLines([]);
  }

  function handleSetStartHere() {
    if (!program || isEditorMutationLocked) return;
    if (selectedLines.length !== 1) {
      onStatusMessage?.('Select exactly one motion line in the body to set as start.', 'warning');
      return;
    }

    const result = setStartAtLine(draftText, selectedLines[0], { interpreterProfile });
    if (!result) {
      onStatusMessage?.(
        'Choose a body motion line. Set start requires absolute XY, incremental arc centres and one coordinate unit system.',
        'warning'
      );
      return;
    }

    replaceGCodeDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(result.newStartLine);
    setPinnedLines([]);
    setSelectedLines([result.newStartLine]);
  }

  function handleGuideLanguageChange(language: EditorGuideLanguage) {
    setGuideLanguage(language);
    writeStoredGuideLanguage(language);
  }

  function handleGuideHighlight(target: EditorGuideTarget) {
    setGuideOpen(false);
    setGuideHighlightTarget(target);
    if (pathDocumentDraft) {
      if (target === 'grid-snap' || target === 'measurement-points') {
        openEditorWorkflow('construction.measurement');
      }
    } else if (target !== 'preview' && target !== 'import-program') {
      setInspectorRailCollapsed(false);
      setProgramLinesOpen(true);
    }
  }

  function handleAddMeasurementPoint() {
    if (pathDocumentDraft && !activeWorkflowOwns('construction.measurement')) return;
    if (pointXDraft.trim() === '' || pointYDraft.trim() === '') return;

    const x = Number(pointXDraft);
    const y = Number(pointYDraft);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    addMeasurementPoint(x, y);
    setPointXDraft('');
    setPointYDraft('');
  }

  function addMeasurementPoint(x: number, y: number) {
    if (pathDocumentDraft && !activeWorkflowOwns('construction.measurement')) return;
    if (pathDocumentDraft) {
      clearActiveWorkflowPending('measurement-input');
      markActiveWorkflowDirty('construction.measurement');
    }
    setMeasurementPoints((current) => [
      ...current,
      {
        id: nextMeasurementPointId(current.length),
        x,
        y
      }
    ]);
  }

  function addPathConstructionPoint(magnetized: MagnetizedPathPoint) {
    if (!activeWorkflowOwns('construction.measurement')) return;
    clearActiveWorkflowPending('construction-mode');
    markActiveWorkflowDirty('construction.measurement');
    setMeasurementPoints((current) => [
      ...current,
      {
        id: nextMeasurementPointId(current.length),
        pathSnap: createMeasurementPointPathSnapFromMagnetized(magnetized),
        x: magnetized.point.x,
        y: magnetized.point.y
      }
    ]);
  }

  function handlePreviewPointClick(point: { x: number; y: number }) {
    if (isEditorMutationLocked) return;

    if (entryExitCanvasPick) {
      if (!activeWorkflowOwns('machining.entry-exit') || !pathDocumentDraft) return;
      const { kind, operationId } = entryExitCanvasPick;
      const inferred = entryExitInferencePreview?.candidate;
      if (!inferred || inferred.operationId !== operationId) return;
      setEntryExitCanvasPick(null);
      if (kind === 'entry') {
        handleSetOperationManualEntry(operationId, inferred.point);
      } else {
        handleSetOperationManualExit(operationId, inferred.point);
      }
      return;
    }

    if (!pathClickMode || !pathDocumentDraft) {
      if (
        canvasMouseMode === 'point' &&
        (!pathDocumentDraft || activeWorkflowOwns('construction.measurement'))
      ) addMeasurementPoint(point.x, point.y);
      return;
    }

    if (pathClickMode === 'set-start') {
      if (!activeWorkflowOwns(SET_START_COMMAND.id)) return;
      if (!selectedPathOperationId) return;

      const inferred = startPreview?.candidate;
      const edited =
        inferred?.operationId === selectedPathOperationId
          ? setClosedOperationStartAtInferredPoint(pathDocumentDraft, inferred)
          : null;
      if (!edited) {
        onStatusMessage?.('Choose a closed path operation before setting the start.', 'warning');
        setPathClickMode(null);
        return;
      }
      applyPathDocumentEdit(edited);
      if (activeToolSession?.commandId === SET_START_COMMAND.id) {
        const withPoint = editorToolSessionReducer(activeToolSession, {
          type: 'advance',
          provisional: { point }
        });
        editorToolSessionReducer(withPoint, { type: 'apply' });
        setActiveToolSession(null);
      }
      setPathClickMode(null);
      onStatusMessage?.('Path start updated.', 'success');
      return;
    }

    if (!activeWorkflowOwns('construction.measurement')) return;

    const magnetized = constructionPreview?.candidate as MagnetizedPathPoint | undefined;
    if (!magnetized) {
      setPathClickMode(null);
      clearActiveWorkflowPending('construction-mode');
      onStatusMessage?.('No construction point was found. Add a reference point and try again.', 'warning');
      return;
    }

    addPathConstructionPoint(magnetized);
    setPathClickMode(null);
  }

  function handleSetPathStartFromElement(element: EditorPathElementRef) {
    if (
      !activeWorkflowOwns(SET_START_COMMAND.id) ||
      !pathDocumentDraft ||
      !element.operationId ||
      element.operationId !== selectedPathOperationId ||
      !element.segmentId ||
      (element.pointRole !== 'start' && element.pointRole !== 'end') ||
      isEditorMutationLocked
    ) {
      return;
    }

    const edited = setClosedOperationStartAtSegmentEndpoint(
      pathDocumentDraft,
      element.operationId,
      element.segmentId,
      element.pointRole
    );
    if (!edited) return;

    applyPathDocumentEdit(edited, {
      selectedPathElement: element,
      selectedPathOperationId: element.operationId
    });
    if (activeToolSession?.commandId === SET_START_COMMAND.id) {
      const withPoint = editorToolSessionReducer(activeToolSession, {
        type: 'advance',
        provisional: { element }
      });
      editorToolSessionReducer(withPoint, { type: 'apply' });
      setActiveToolSession(null);
    }
    setPathClickMode(null);
    onStatusMessage?.('Path start updated.', 'success');
  }

  function handleSetManualInitialWirePosition(point: { x: number; y: number }) {
    if (!activeWorkflowOwns('machining.initial-wire') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setManualInitialWirePosition(pathDocumentDraft, point);
    if (!edited) {
      onStatusMessage?.('Initial wire coordinates must be finite numbers.', 'warning');
      return;
    }
    applyPathDocumentEdit(edited, { completedPendingSources: ['initial-input'] });
    onStatusMessage?.('Initial Wire Position reviewed and updated.', 'success');
  }

  function handleSetGeometryLinkedInitialWirePosition(segmentId: string) {
    if (!activeWorkflowOwns('machining.initial-wire') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setGeometryLinkedInitialWirePosition(pathDocumentDraft, segmentId);
    if (!edited) {
      onStatusMessage?.('Choose an available circle center for Initial Wire Position.', 'warning');
      return;
    }
    applyPathDocumentEdit(edited, { completedPendingSources: ['initial-input'] });
    onStatusMessage?.('Initial Wire Position linked to the circle center.', 'success');
  }

  function handleMeasurementPointMove(pointId: string, point: { x: number; y: number }) {
    if (pathDocumentDraft && !activeWorkflowOwns('construction.measurement')) return;
    if (pathDocumentDraft) markActiveWorkflowDirty('construction.measurement');
    setMeasurementPoints((current) =>
      current.map((measurementPoint) => {
        if (measurementPoint.id !== pointId) return measurementPoint;
        if (!measurementPoint.pathSnap || !pathDocumentDraft) {
          return { ...measurementPoint, x: point.x, y: point.y };
        }

        const magnetized = reinferStoredPathPoint(
          pathDocumentDraft,
          measurementPoint.pathSnap,
          point
        );
        if (!magnetized) return measurementPoint;

        return {
          ...measurementPoint,
          pathSnap: createMeasurementPointPathSnapFromMagnetized(magnetized, {
            sourcePoint: measurementPoint.pathSnap.sourcePoint
          }),
          x: magnetized.point.x,
          y: magnetized.point.y
        };
      })
    );
  }

  function handleClearMeasurementPoints() {
    if (pathDocumentDraft && !activeWorkflowOwns('construction.measurement')) return;
    if (measurementPoints.length === 0) return;
    if (pathDocumentDraft) markActiveWorkflowDirty('construction.measurement');
    setMeasurementPoints([]);
  }

  function handleDeleteMeasurementPoint(pointId: string) {
    if (pathDocumentDraft && !activeWorkflowOwns('construction.measurement')) return;
    if (!measurementPoints.some((point) => point.id === pointId)) return;
    if (pathDocumentDraft) markActiveWorkflowDirty('construction.measurement');
    setMeasurementPoints((current) => current.filter((point) => point.id !== pointId));
  }

  function handleMovePathOperation(direction: -1 | 1, operationId = selectedPathOperationId ?? undefined) {
    if (!activeWorkflowOwns('machining.sequence') || !pathDocumentDraft || !operationId || isEditorMutationLocked) return;
    const edited = movePathOperation(pathDocumentDraft, operationId, direction);
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleReversePathOperation(operationId: string) {
    if (!activeWorkflowOwns('machining.contour-setup') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = reversePathOperation(pathDocumentDraft, operationId);
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleSetPathOperationClassification(
    operationId: string,
    classification: ContourClassification
  ) {
    if (!activeWorkflowOwns('machining.contour-setup') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationClassification(
      pathDocumentDraft,
      operationId,
      classification
    );
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleSetGeometryBasis(basis: PathPlanningDocument['geometryBasis']) {
    if (!activeWorkflowOwns('geometry.setup') || !pathDocumentDraft || isEditorMutationLocked) return;
    if (basis === pathDocumentDraft.geometryBasis) return;

    const edited = { ...structuredClone(pathDocumentDraft), geometryBasis: basis };
    applyPathDocumentEdit(edited);
  }

  function handleSetManualCompensation(
    operationId: string,
    selection: ManualCompensationSelection
  ) {
    if (!activeWorkflowOwns('machining.contour-setup') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setManualCompensationIntent(pathDocumentDraft, operationId, selection);
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleSetOperationCircleCenterEntry(operationId: string) {
    if (!activeWorkflowOwns('machining.entry-exit') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setCircleOperationCenterPierceLeadIn(pathDocumentDraft, operationId);
    if (!edited) {
      onStatusMessage?.('Circle-center entry requires one closed circular operation.', 'warning');
      return;
    }
    applyPathDocumentEdit(edited, { completedPendingSources: ['entry'], selectedPathElement, selectedPathOperationId: operationId });
  }

  function handleSetOperationManualEntry(
    operationId: string,
    point: { x: number; y: number }
  ) {
    if (!activeWorkflowOwns('machining.entry-exit') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationManualLeadIn(pathDocumentDraft, operationId, point);
    if (edited) {
      applyPathDocumentEdit(edited, {
        completedPendingSources: ['entry'], selectedPathElement,
        selectedPathOperationId: operationId
      });
    }
  }

  function handleSetOperationManualExit(operationId: string, point: { x: number; y: number }) {
    if (!activeWorkflowOwns('machining.entry-exit') || !pathDocumentDraft || isEditorMutationLocked) return;
    const operation = pathDocumentDraft.plan.operations.find(
      (candidate) => candidate.id === operationId
    );
    if (!operation) return;
    const edited = setPathOperationTransitions(pathDocumentDraft, operationId, {
      ...readOperationTransitions(operation),
      exit: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { ...operation.endPoint },
        to: point,
        review: 'reviewed'
      }
    });
    if (edited) {
      applyPathDocumentEdit(edited, {
        completedPendingSources: ['exit'], selectedPathElement, selectedPathOperationId: operationId
      });
    }
  }

  function handleSetOperationNoEntry(operationId: string) {
    if (!activeWorkflowOwns('machining.entry-exit') || !pathDocumentDraft || isEditorMutationLocked) return;
    const operation = pathDocumentDraft.plan.operations.find(
      (candidate) => candidate.id === operationId
    );
    if (!operation) return;
    const edited = setPathOperationTransitions(pathDocumentDraft, operationId, {
      ...readOperationTransitions(operation),
      entry: { strategy: 'none', review: 'reviewed' }
    });
    if (edited) {
      applyPathDocumentEdit(edited, {
        completedPendingSources: ['entry'],
        selectedPathElement,
        selectedPathOperationId: operationId
      });
    }
  }

  function handleSetOperationNoExit(operationId: string) {
    if (!activeWorkflowOwns('machining.entry-exit') || !pathDocumentDraft || isEditorMutationLocked) return;
    const operation = pathDocumentDraft.plan.operations.find(
      (candidate) => candidate.id === operationId
    );
    if (!operation) return;
    const edited = setPathOperationTransitions(pathDocumentDraft, operationId, {
      ...readOperationTransitions(operation),
      exit: { strategy: 'none', review: 'reviewed' }
    });
    if (edited) {
      applyPathDocumentEdit(edited, {
        completedPendingSources: ['exit'],
        selectedPathElement,
        selectedPathOperationId: operationId
      });
    }
  }

  function handleSetProjectThreading(
    transition: Omit<OperationThreadingTransition, 'source'>
  ) {
    if (!activeWorkflowOwns('machining.between-contours') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setProjectThreadingDefault(pathDocumentDraft, transition);
    if (edited) applyPathDocumentEdit(edited);
  }

  function handleSetOperationThreading(
    operationId: string,
    transition: Omit<OperationThreadingTransition, 'source'> | null
  ) {
    if (!activeWorkflowOwns('machining.between-contours') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationThreadingTransition(
      pathDocumentDraft,
      operationId,
      transition
    );
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId: operationId
      });
    }
  }

  function handleSetOperationProgramStops(
    operationId: string,
    stops: OperationProgramStop[],
    completeForm = false
  ) {
    if (!activeWorkflowOwns('machining.program-stops') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationProgramStops(pathDocumentDraft, operationId, stops);
    if (edited) {
      applyPathDocumentEdit(edited, {
        completedPendingSources: completeForm ? ['stop-form'] : undefined,
        selectedPathElement,
        selectedPathOperationId: operationId
      });
    }
  }

  function handleSetMachiningSpan(
    input: Parameters<typeof setMachiningSpanParticipation>[1],
    completeForm = false
  ) {
    if (!activeWorkflowOwns('machining.participation') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setMachiningSpanParticipation(pathDocumentDraft, input);
    if (edited) {
      applyPathDocumentEdit(edited, {
        completedPendingSources: completeForm ? ['span-form'] : undefined,
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleSetPartialContourCompensationSide(
    sourceOperationId: string,
    wireSide: 'left' | 'right' | null
  ) {
    if (!activeWorkflowOwns('machining.participation') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPartialContourCompensationSide(
      pathDocumentDraft,
      sourceOperationId,
      wireSide
    );
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId: sourceOperationId
      });
    }
  }

  function handleSetPartialContourEntryReview(
    sourceOperationId: string,
    reviewed: boolean
  ) {
    if (!activeWorkflowOwns('machining.participation') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPartialContourEntryReview(
      pathDocumentDraft,
      sourceOperationId,
      reviewed
    );
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId: sourceOperationId
      });
    }
  }

  function handleSetPartialContourExitReview(
    sourceOperationId: string,
    reviewed: boolean
  ) {
    if (!activeWorkflowOwns('machining.participation') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPartialContourExitReview(
      pathDocumentDraft,
      sourceOperationId,
      reviewed
    );
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId: sourceOperationId
      });
    }
  }

  function handleSetPathOperationOrderStrategy(strategy: OperationOrderStrategy) {
    if (!activeWorkflowOwns('machining.sequence') || !pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationOrderStrategy(pathDocumentDraft, strategy);
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleTranslatePathSelection(
    delta: { x: number; y: number },
    completedSource: 'transform-target' | 'transform-translate' = 'transform-translate'
  ) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;
    if (delta.x === 0 && delta.y === 0) return;

    const edited = selectedPathElement?.segmentId
      ? translatePathSegment(pathDocumentDraft, selectedPathElement.segmentId, delta)
      : selectedPathElement?.pathElementId
        ? translatePathElement(pathDocumentDraft, selectedPathElement.pathElementId, delta)
        : selectedPathOperationId
          ? translatePathOperation(pathDocumentDraft, selectedPathOperationId, delta)
          : null;

    applyPathTransform(edited, { completedPendingSources: [completedSource] });
  }

  function handleTranslatePathDocument(
    delta: { x: number; y: number },
    completedSource: 'transform-target' | 'transform-translate' = 'transform-translate'
  ) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;
    if (delta.x === 0 && delta.y === 0) return;

    const edited = translatePathDocument(pathDocumentDraft, delta);
    applyPathTransform(edited, { completedPendingSources: [completedSource] });
  }

  function handleRotatePathSelection(angleDegrees: number) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;

    const origin = readPathSelectionBoundsCenter(
      pathDocumentDraft,
      selectedPathElement,
      selectedPathOperationId
    );
    if (!origin) return;

    const edited = selectedPathElement?.segmentId
      ? rotatePathSegment(pathDocumentDraft, selectedPathElement.segmentId, angleDegrees, origin)
      : selectedPathElement?.pathElementId
        ? rotatePathElement(pathDocumentDraft, selectedPathElement.pathElementId, angleDegrees, origin)
        : selectedPathOperationId
          ? rotatePathOperation(pathDocumentDraft, selectedPathOperationId, angleDegrees, origin)
          : null;

    applyPathTransform(edited);
  }

  function handleMirrorPathSelection(axis: PathMirrorAxis) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;

    const origin = readPathSelectionBoundsCenter(
      pathDocumentDraft,
      selectedPathElement,
      selectedPathOperationId
    );
    if (!origin) return;

    const edited = selectedPathElement?.segmentId
      ? mirrorPathSegment(pathDocumentDraft, selectedPathElement.segmentId, axis, origin)
      : selectedPathElement?.pathElementId
        ? mirrorPathElement(pathDocumentDraft, selectedPathElement.pathElementId, axis, origin)
        : selectedPathOperationId
          ? mirrorPathOperation(pathDocumentDraft, selectedPathOperationId, axis, origin)
          : null;

    applyPathTransform(edited);
  }

  function handleRotatePathDocument(angleDegrees: number) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;

    const origin = readPathDocumentBoundsCenter(pathDocumentDraft);
    if (!origin) return;

    const edited = rotatePathDocument(pathDocumentDraft, angleDegrees, origin);
    applyPathTransform(edited);
  }

  function handleMirrorPathDocument(axis: PathMirrorAxis) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;

    const origin = readPathDocumentBoundsCenter(pathDocumentDraft);
    if (!origin) return;

    const edited = mirrorPathDocument(pathDocumentDraft, axis, origin);
    applyPathTransform(edited);
  }

  function handleMovePathSelectionCenter(targetCenter: { x: number; y: number }) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;

    const selectionCenter = readPathSelectionBoundsCenter(
      pathDocumentDraft,
      selectedPathElement,
      selectedPathOperationId
    );
    if (!selectionCenter) return;

    handleTranslatePathSelection(
      {
        x: targetCenter.x - selectionCenter.x,
        y: targetCenter.y - selectionCenter.y
      },
      'transform-target'
    );
  }

  function handleDragPathElement(element: EditorPathElementRef, delta: { x: number; y: number }) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked || (delta.x === 0 && delta.y === 0)) return;

    const dragTarget = resolvePathDragTarget(selectedPathElement, element);
    const edited =
      dragTarget.segmentId
        ? translatePathSegment(pathDocumentDraft, dragTarget.segmentId, delta)
        : dragTarget.pathElementId
          ? translatePathElement(pathDocumentDraft, dragTarget.pathElementId, delta)
          : dragTarget.operationId
            ? translatePathOperation(pathDocumentDraft, dragTarget.operationId, delta)
            : null;

    applyPathTransform(edited, {
      selectedPathElement: dragTarget,
      selectedPathOperationId: dragTarget.operationId
    });
  }

  function handleMoveSelectedSegmentCenter(targetCenter: { x: number; y: number }) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || !selectedPathElement?.segmentId || isEditorMutationLocked) return;

    const edited = movePathSegmentCenterTo(pathDocumentDraft, selectedPathElement.segmentId, targetCenter);
    applyPathTransform(edited, { completedPendingSources: ['transform-target'] });
  }

  function handleMovePathSegmentCenter(
    element: EditorPathElementRef,
    targetCenter: { x: number; y: number }
  ) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || !element.segmentId || isEditorMutationLocked) return;

    const edited = movePathSegmentCenterTo(pathDocumentDraft, element.segmentId, targetCenter);
    applyPathTransform(edited, {
      selectedPathElement: {
        operationId: element.operationId,
        pathElementId: element.pathElementId ?? null,
        segmentId: element.segmentId
      },
      selectedPathOperationId: element.operationId
    });
  }

  function applyPathTransform(
    nextDocument: PathPlanningDocument | null,
    options: Parameters<typeof applyPathDocumentEdit>[1] = {}
  ) {
    if (!nextDocument) {
      onStatusMessage?.(
        'Cannot apply transform. Check the coordinates, or move the whole contour to preserve its machining decisions.',
        'warning'
      );
      return;
    }
    applyPathDocumentEdit(nextDocument, options);
  }

  function applyPathDocumentEdit(
    nextDocument: PathPlanningDocument,
    options: {
      completedPendingSources?: string[];
      selectedPathElement?: EditorPathElementRef | null;
      selectedPathOperationId?: string | null;
    } = {}
  ) {
    if (!program?.project) return;
    options.completedPendingSources?.forEach(clearActiveWorkflowPending);

    replaceUpidDraftDocument(nextDocument, {
      selectedPathElement: Object.hasOwn(options, 'selectedPathElement')
        ? options.selectedPathElement
        : selectedPathElement,
      selectedPathOperationId: options.selectedPathOperationId ?? selectedPathOperationId
    });
  }

  function handleInsertMeasurementPoints() {
    if (!program || pathDocumentDraft || measurementPoints.length === 0 || isEditorMutationLocked) return;

    const result = insertMeasurementPointsIntoText(draftText, measurementPoints, {
      insertAfterLine: selectedLines.length > 0 ? Math.min(...selectedLines) : undefined,
      interpreterProfile
    });
    replaceGCodeDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines(result.insertedLineNumbers);
  }

  function handleExportMeasurementPoints(format: 'csv') {
    if (measurementPoints.length === 0) return;

    const dateStamp = new Date().toISOString().slice(0, 10);
    onDownloadEditorFile(
      `measurement-points-${dateStamp}.${format}`,
      exportMeasurementPointsAsCsv(measurementPoints)
    );
  }

  function replaceGCodeDraftText(nextText: string) {
    if (draftState.model !== 'gcode-text' || nextText === draftState.text) return;
    applyEditorDraftState({
      model: 'gcode-text',
      text: nextText,
      interpreterProfile
    });
  }

  function replaceUpidDraftDocument(
    nextDocument: PathPlanningDocument,
    options: {
      selectedPathElement?: EditorPathElementRef | null;
      selectedPathOperationId?: string | null;
    } = {}
  ) {
    applyEditorDraftState(
      {
        model: 'upid-document',
        pathDocument: nextDocument
      },
      options
    );
  }

  function applyEditorDraftState(
    nextDraft: EditorDraftState,
    options: {
      selectedPathElement?: EditorPathElementRef | null;
      selectedPathOperationId?: string | null;
    } = {}
  ) {
    if (isEditorMutationLocked) return;

    const clonedDraft = cloneEditorDraftState(nextDraft);
    const nextPathDocument = editorDraftPathDocument(clonedDraft);
    const candidateSelectedPathOperationId = nextPathDocument
      ? options.selectedPathOperationId ?? selectedPathOperationId
      : null;
    const candidateSelectedPathElement = Object.hasOwn(options, 'selectedPathElement')
      ? options.selectedPathElement ?? null
      : selectedPathElement;
    const nextSelectedPathElement = nextPathDocument
      ? normalizeUpidPathElementSelection(
          nextPathDocument,
          candidateSelectedPathOperationId,
          candidateSelectedPathElement
        )
      : null;
    const nextSelectedPathOperationId = candidateSelectedPathOperationId === null && candidateSelectedPathElement === null
      ? null
      : nextSelectedPathElement?.operationId ??
        (nextPathDocument?.plan.operations.some((operation) => operation.id === candidateSelectedPathOperationId)
          ? candidateSelectedPathOperationId : null);
    const nextProgramExactTarget = reconcileProgramExactTarget(
      selectedProgramExactTarget,
      nextPathDocument
    );
    const exactTargetRemoved = Boolean(
      selectedProgramExactTarget && !nextProgramExactTarget
    );

    if (activeWorkflowSession?.kind === 'mutating') {
      setActiveWorkflowSession((current) =>
        current?.kind === 'mutating'
          ? markEditorWorkflowDirty(current, { enabled: true })
          : current
      );
    } else {
      setUndoStack((current) => [...current, currentDraftSnapshot()]);
      setRedoStack([]);
    }
    setDraftState(clonedDraft);
    setSelectedPathOperationId(nextSelectedPathOperationId);
    setSelectedPathElement(nextSelectedPathElement);
    setSelectedProgramExactTarget(nextProgramExactTarget);
    if (exactTargetRemoved) {
      setSelectedProgramTreeKey(programTreeKeyForOperation(nextSelectedPathOperationId));
    }
    if (!nextPathDocument) setPathClickMode(null);
  }

  function handleUndoDraft() {
    if (isEditorMutationLocked || activeWorkflowSession?.kind === 'mutating') return;
    const previous = undoStack.at(-1);
    if (previous === undefined) return;

    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [currentDraftSnapshot(), ...current]);
    restoreDraftSnapshot(previous);
    clearTransientLineState();
  }

  function handleRedoDraft() {
    if (isEditorMutationLocked || activeWorkflowSession?.kind === 'mutating') return;
    const next = redoStack[0];
    if (next === undefined) return;

    setRedoStack((current) => current.slice(1));
    setUndoStack((current) => [...current, currentDraftSnapshot()]);
    restoreDraftSnapshot(next);
    clearTransientLineState();
  }

  function handleDraftTextChange(nextText: string) {
    if (
      isEditorMutationLocked ||
      draftState.model !== 'gcode-text' ||
      nextText === draftState.text
    ) {
      return;
    }
    setUndoStack((current) => [...current, currentDraftSnapshot()]);
    setRedoStack([]);
    setDraftState({
      model: 'gcode-text',
      text: nextText,
      interpreterProfile
    });
    setSelectedPathOperationId(null);
    setSelectedPathElement(null);
    setSelectedProgramExactTarget(null);
    setSelectedProgramTreeKey(null);
    setPathClickMode(null);
    // Arbitrary text edits have no reliable row correspondence.
    clearTransientLineState();
  }

  function currentDraftSnapshot(historyLabel?: string): EditorDraftSnapshot {
    const reconciledExactTarget = reconcileProgramExactTarget(
      selectedProgramExactTarget,
      pathDocumentDraft
    );
    return {
      canvasMouseMode,
      draft: cloneEditorDraftState(draftState),
      gridSnapEnabled,
      historyLabel,
      measurementPoints: structuredClone(measurementPoints),
      pathClickMode,
      pathTargetXDraft,
      pathTargetYDraft,
      pathTranslateXDraft,
      pathTranslateYDraft,
      pointXDraft,
      pointYDraft,
      setStartInferenceMode,
      selectedPathElement,
      selectedPathOperationId,
      selectedProgramExactTarget: reconciledExactTarget,
      selectedProgramTreeKey: selectedProgramExactTarget && !reconciledExactTarget
        ? programTreeKeyForOperation(selectedPathOperationId)
        : selectedProgramTreeKey
    };
  }

  function snapshotForProgramTreeAction(
    snapshot: EditorDraftSnapshot,
    action: Pick<
      EditorProgramTreeAction,
      'exactTarget' | 'operationId'
    >,
    selectedTreeKey: string | null
  ): EditorDraftSnapshot {
    const document = editorDraftPathDocument(snapshot.draft);
    const selectedPathOperationId = action.operationId ??
      (
        selectedTreeKey && programTree
          ? findProgramTreeOperationId(programTree, selectedTreeKey)
          : null
      ) ??
      null;
    return {
      ...snapshot,
      selectedProgramExactTarget: action.exactTarget,
      selectedPathOperationId,
      selectedProgramTreeKey: selectedTreeKey,
      selectedPathElement: document && selectedPathOperationId
        ? {
            operationId: selectedPathOperationId,
            pathElementId: upidPathElementIdForOperation(document, selectedPathOperationId),
            segmentId: null
          }
        : null
    };
  }

  function restoreDraftSnapshot(snapshot: EditorDraftSnapshot) {
    const restoredDraft = cloneEditorDraftState(snapshot.draft);
    const restoredPathDocument = editorDraftPathDocument(restoredDraft);
    setDraftState(restoredDraft);
    setCanvasMouseMode(snapshot.canvasMouseMode);
    setGridSnapEnabled(snapshot.gridSnapEnabled);
    setMeasurementPoints(structuredClone(snapshot.measurementPoints));
    setPathTargetXDraft(snapshot.pathTargetXDraft);
    setPathTargetYDraft(snapshot.pathTargetYDraft);
    setPathTranslateXDraft(snapshot.pathTranslateXDraft);
    setPathTranslateYDraft(snapshot.pathTranslateYDraft);
    setPointXDraft(snapshot.pointXDraft);
    setPointYDraft(snapshot.pointYDraft);
    setSetStartInferenceMode(snapshot.setStartInferenceMode);
    const restoredOperationId = restoredPathDocument ? snapshot.selectedPathOperationId : null;
    const restoredExactTarget = reconcileProgramExactTarget(
      snapshot.selectedProgramExactTarget,
      restoredPathDocument
    );
    setSelectedPathOperationId(restoredOperationId);
    setSelectedProgramExactTarget(restoredExactTarget);
    setSelectedProgramTreeKey(
      snapshot.selectedProgramExactTarget && !restoredExactTarget
        ? programTreeKeyForOperation(restoredOperationId)
        : snapshot.selectedProgramTreeKey
    );
    setSelectedPathElement(
      restoredPathDocument && (snapshot.selectedPathElement || restoredOperationId)
        ? normalizeUpidPathElementSelection(
            restoredPathDocument,
            restoredOperationId,
            snapshot.selectedPathElement
          )
        : null
    );
    setPathClickMode(snapshot.pathClickMode);
  }

  function clearTransientLineState() {
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines([]);
  }

  function clearSelectedLines() {
    setHoveredLine(null);
    setLastClickedLine(null);
    setSelectedLines([]);
  }

  function renderProgramTextPanel() {
    return (
      <EditorProgramTextPanel
        draftText={draftText}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={isEditorMutationLocked}
        onDraftTextChange={handleDraftTextChange}
        program={program}
      />
    );
  }

  function readEditorInteractionHint() {
    if (activeWorkflowOwns('inspect.measure')) return null;
    if (!pathDocumentDraft) {
      return null;
    }

    if (entryExitCanvasPick) {
      const pointRole = entryExitCanvasPick.kind === 'entry' ? 'entry' : 'exit';
      return `Entry / Exit / Pick ${pointRole}: click one canvas point for the locked operation, or press Escape to cancel picking.`;
    }

    if (pathClickMode === 'set-start') {
      if (!selectedPathOperationId) {
        return 'Contour Start: choose a closed contour, then start explicit point picking.';
      }

      return `Contour Start: hover the contour to preview a ${setStartInferenceMode} candidate, then click to apply that exact point.`;
    }

    if (pathClickMode === 'perpendicular' || pathClickMode === 'tangent') {
      const relation = pathClickMode === 'perpendicular' ? 'Perpendicular' : 'Tangent';
      if (measurementPoints.length === 0) {
        return `${relation} mode / Step 1: add a measurement point first; it becomes the source point for the construction.`;
      }

      return `${relation} mode / Step 2: select the target contour or segment to add the construction point from the latest measurement point.`;
    }

    if (selectedPathElement && activeWorkflowOwns('geometry.transform')) {
      return 'Drag selected geometry, or enter exact values in Transform.';
    }

    if (canvasMouseMode === 'point') {
      return 'Construction points / Click empty canvas space to place a point, or switch to Select.';
    }

    return null;
  }

  function activeWorkflowOwns(commandId: string) {
    return activeWorkflowSession?.commandId === commandId;
  }

  function markActiveWorkflowDirty(
    commandId: string,
    saveAvailability: { enabled: true } | { enabled: false; reason: string } = { enabled: true }
  ) {
    setActiveWorkflowSession((current) =>
      current?.kind === 'mutating' && current.commandId === commandId
        ? markEditorWorkflowDirty(current, saveAvailability)
        : current
    );
  }

  function markActiveWorkflowPending(commandId: string, source: string, reason: string) {
    if (!activeWorkflowOwns(commandId)) return;
    setActiveWorkflowPendingReasons((current) => ({ ...current, [source]: reason }));
    markActiveWorkflowDirty(commandId, { enabled: false, reason });
  }

  function clearActiveWorkflowPending(source: string) {
    setActiveWorkflowPendingReasons((current) => {
      if (!Object.hasOwn(current, source)) return current;
      const next = { ...current };
      delete next[source];
      return next;
    });
  }

  function readWorkflowSaveUnavailableReason(commandId: string) {
    switch (commandId) {
      case SET_START_COMMAND.id:
        return 'No explicit contour-start change to save; the automatic start remains active.';
      case 'construction.measurement':
        return 'Add, move, or remove a measurement or construction point before saving.';
      case 'machining.initial-wire':
        return 'Review and apply an initial wire position before saving.';
      default:
        return 'Make a valid change in this workflow before saving.';
    }
  }

  function runAfterActiveWorkflowResolved(action: (unsavedAfterWorkflow: boolean) => void) {
    if (!activeWorkflowSession) {
      action(hasUnsavedChanges);
      return;
    }

    const transition = requestEditorWorkflowTransition(activeWorkflowSession, { kind: 'close' });
    if (transition.kind === 'held') {
      pendingWorkflowExitActionRef.current = action;
      updateWorkflowTransition(transition);
      return;
    }

    if (transition.kind === 'resolved') {
      pendingWorkflowExitActionRef.current = action;
      completeEditorWorkflowTransition(transition);
    }
  }

  function saveActiveEditorWorkflow() {
    if (
      !activeWorkflowSession ||
      activeWorkflowSession.kind !== 'mutating' ||
      !activeWorkflowSession.dirty ||
      !activeWorkflowSession.saveAvailability.enabled
    ) return;

    const requested = requestEditorWorkflowTransition(activeWorkflowSession, { kind: 'close' });
    if (requested.kind !== 'held') return;
    const resolved = resolveEditorWorkflowTransition(requested, 'save');
    if (resolved.kind === 'resolved') completeEditorWorkflowTransition(resolved);
  }

  function openEditorWorkflow(commandId: string) {
    pendingProgramTreeSelectionRef.current = null;
    const command = EDITOR_COMMAND_REGISTRY.get(commandId);
    if (!command?.toolWindowId || !command.workflow) return;

    if (activeWorkflowSession?.commandId === commandId) {
      openActiveWorkflowInCompactDrawer();
      focusWorkspacePanel(command.toolWindowId as EditorWorkspacePanelId);
      return;
    }

    requestEditorWorkflowOpen(command);
  }

  function openStatusDiagnostics() {
    if (pathDocumentDraft) {
      openEditorWorkflow('view.diagnostics');
      return;
    }
    setInspectorRailCollapsed(false);
    window.requestAnimationFrame(() => {
      const issues = document.querySelector<HTMLElement>('[data-editor-parse-issues]');
      const stats = issues?.closest('details');
      if (stats) stats.open = true;
      issues?.scrollIntoView({ block: 'nearest' });
      issues?.focus({ preventScroll: true });
    });
  }

  function openEditorWorkflowForTarget(
    target: EditorProgramTreeNode,
    treeKey: string
  ) {
    requestProgramTreeWorkflowTransition(
      resolveEditorProgramTreeAction(target),
      treeKey
    );
  }

  function requestProgramTreeWorkflowTransition(
    action: EditorProgramTreeAction,
    treeKey: string
  ) {
    pendingProgramTreeSelectionRef.current = null;
    if (!canOpenProgramTreeAction(action)) return;
    const command = EDITOR_COMMAND_REGISTRY.get(action.commandId);
    if (!command?.toolWindowId || !command.workflow) return;
    pendingProgramTreeSelectionRef.current = treeKey;
    requestEditorWorkflowOpen(command, action);
  }

  function canOpenProgramTreeAction(action: EditorProgramTreeAction) {
    if (action.commandId !== SET_START_COMMAND.id) return true;
    const operation = pathDocumentDraft?.plan.operations.find(
      (candidate) => candidate.id === action.operationId
    );
    if (operation?.closed) return true;
    onStatusMessage?.('Contour Start is available only for closed contours.', 'warning');
    return false;
  }

  function requestEditorWorkflowOpen(
    command: EditorCommandDefinition,
    action?: EditorProgramTreeAction
  ) {
    if (!action && activeWorkflowSession?.commandId === command.id) {
      openActiveWorkflowInCompactDrawer();
      focusWorkspacePanel(command.toolWindowId as EditorWorkspacePanelId);
      return;
    }

    if (activeWorkflowSession) {
      const transition = requestEditorWorkflowTransition(activeWorkflowSession, {
        commandId: command.id,
        kind: 'open',
        ...(action ? {
          target: {
            exactTarget: action.exactTarget,
            operationId: action.operationId
          }
        } : {})
      });
      if (transition.kind === 'held') {
        updateWorkflowTransition(transition);
        return;
      }
      if (transition.kind === 'resolved') completeEditorWorkflowTransition(transition);
      return;
    }

    const openingSnapshot = action
      ? snapshotForProgramTreeAction(
          currentDraftSnapshot(),
          action,
          pendingProgramTreeSelectionRef.current
        )
      : currentDraftSnapshot();
    pendingProgramTreeSelectionRef.current = null;
    activateEditorWorkflow(command, openingSnapshot);
  }

  function openEditorWorkflowForPanel(panelId: EditorWorkspacePanelId) {
    const command = EDITOR_COMMAND_REGISTRY.all().find(
      (candidate) => candidate.toolWindowId === panelId && candidate.workflow
    );
    if (command) openEditorWorkflow(command.id);
  }

  function activateEditorWorkflow(
    command: EditorCommandDefinition,
    openingSnapshot: EditorDraftSnapshot = currentDraftSnapshot()
  ) {
    if (!command.toolWindowId || !command.workflow) return;
    const availability = evaluateEditorCommand(command, {
      activeTool: null,
      documentAvailable: Boolean(editorDraftPathDocument(openingSnapshot.draft)),
      interactionLocked: Boolean(isEditorMutationLocked),
      selectedOperationId: openingSnapshot.selectedPathOperationId,
      selectedPathElementId: openingSnapshot.selectedPathElement?.pathElementId ?? null,
      visiblePanelIds: []
    });
    if (!availability.enabled) {
      setActiveWorkflowSession(null);
      updateWorkflowTransition(null);
      onStatusMessage?.(availability.reason, 'warning');
      return;
    }
    setSelectedPathOperationId(openingSnapshot.selectedPathOperationId);
    setSelectedPathElement(openingSnapshot.selectedPathElement);
    setSelectedProgramExactTarget(openingSnapshot.selectedProgramExactTarget);
    setSelectedProgramTreeKey(openingSnapshot.selectedProgramTreeKey);
    const panelId = command.toolWindowId as EditorWorkspacePanelId;
    const session = command.workflow.kind === 'mutating'
      ? createEditorWorkflowSession({
          commandId: command.id,
          historyLabel: command.historyLabel!,
          kind: 'mutating' as const,
          label: command.label,
          openingSnapshot,
          panelId,
          saveAvailability: {
            enabled: false as const,
            reason: readWorkflowSaveUnavailableReason(command.id)
          }
        })
      : createEditorWorkflowSession({
          commandId: command.id,
          historyLabel: null,
          kind: 'view' as const,
          label: command.label,
          openingSnapshot,
          panelId,
          saveAvailability: { enabled: true as const }
        });

    setActiveWorkflowSession(session);
    if (command.id === 'inspect.measure') measurement.clear();
    openActiveWorkflowInCompactDrawer();
    setEntryExitCanvasPick(null);
    setActiveWorkflowPendingReasons({});
    updateWorkflowTransition(null);
    setExportPreviewOpen(command.id === 'export.preview');
    if (command.id === SET_START_COMMAND.id) {
      const openingDocument = editorDraftPathDocument(openingSnapshot.draft);
      const operationId = openingDocument?.plan.operations.find(
        (operation) => operation.id === openingSnapshot.selectedPathOperationId && operation.closed
      )?.id ?? openingDocument?.plan.operations.find((operation) => operation.closed)?.id ?? null;
      if (operationId) {
        setSelectedPathOperationId(operationId);
        setSelectedPathElement(null);
        setSelectedProgramExactTarget(null);
        setSelectedProgramTreeKey(programTreeKeyForOperation(operationId));
      }
    }
    window.requestAnimationFrame(() => focusWorkspacePanel(panelId));
  }

  function requestCloseEditorWorkflow() {
    if (!activeWorkflowSession) return;
    const transition = requestEditorWorkflowTransition(activeWorkflowSession, { kind: 'close' });
    if (transition.kind === 'held') {
      updateWorkflowTransition(transition);
      return;
    }
    if (transition.kind === 'resolved') completeEditorWorkflowTransition(transition);
  }

  function openActiveWorkflowInCompactDrawer() {
    if (isCompactViewportRef.current) {
      setCompactDrawer('workflow');
      return;
    }
    if (isMiddleViewportRef.current) setCompactDrawer(null);
  }

  function dismissWorkflowTransition() {
    if (!workflowTransition) return;
    dismissEditorWorkflowTransition(workflowTransition);
    pendingWorkflowExitActionRef.current = null;
    pendingProgramTreeSelectionRef.current = null;
    updateWorkflowTransition(null);
  }

  function resolveWorkflowTransition(resolution: 'save' | 'discard') {
    if (!workflowTransition) return;
    const resolved = resolveEditorWorkflowTransition(workflowTransition, resolution);
    if (resolved.kind !== 'resolved') return;
    completeEditorWorkflowTransition(resolved);
  }

  function completeEditorWorkflowTransition(
    transition: Extract<EditorWorkflowTransition<EditorDraftSnapshot>, { kind: 'resolved' }>
  ) {
    const { request, resolution, session } = transition;
    const nextOpeningSnapshot = resolution === 'discard'
      ? session.openingSnapshot
      : currentDraftSnapshot();

    if (resolution === 'save' && session.kind === 'mutating') {
      const openingSnapshot = sameProgramExactTarget(
        session.openingSnapshot.selectedProgramExactTarget,
        selectedProgramExactTarget
      )
        ? session.openingSnapshot
        : {
            ...session.openingSnapshot,
            selectedProgramExactTarget: null,
            selectedProgramTreeKey: programTreeKeyForOperation(
              session.openingSnapshot.selectedPathOperationId
            )
          };
      setUndoStack((current) => [
        ...current,
        { ...openingSnapshot, historyLabel: session.historyLabel }
      ]);
      setRedoStack([]);
    } else if (resolution === 'discard') {
      restoreDraftSnapshot(session.openingSnapshot);
    }

    setActiveToolSession(null);
    setEntryExitCanvasPick(null);
    setPathClickMode(null);
    updateWorkflowTransition(null);
    setActiveWorkflowPendingReasons({});
    setExportPreviewOpen(false);
    if (request.kind === 'close') {
      pendingProgramTreeSelectionRef.current = null;
      setActiveWorkflowSession(null);
      const pendingAction = pendingWorkflowExitActionRef.current;
      pendingWorkflowExitActionRef.current = null;
      const resultingSnapshot = resolution === 'discard'
        ? session.openingSnapshot
        : currentDraftSnapshot();
      pendingAction?.(editorDraftSignature(resultingSnapshot.draft) !== savedDraftSignature);
      return;
    }

    const nextCommand = EDITOR_COMMAND_REGISTRY.get(request.commandId);
    if (!nextCommand) {
      pendingProgramTreeSelectionRef.current = null;
      setActiveWorkflowSession(null);
      return;
    }
    const openingSnapshot = request.target
      ? snapshotForProgramTreeAction(
          nextOpeningSnapshot,
          request.target,
          pendingProgramTreeSelectionRef.current
        )
      : nextOpeningSnapshot;
    pendingProgramTreeSelectionRef.current = null;
    activateEditorWorkflow(nextCommand, openingSnapshot);
  }

  function readWorkspacePanelRenderedPlacement(panelId: EditorWorkspacePanelId) {
    if (
      (isCompactViewport || isMiddleViewport) &&
      panelId === activeWorkflowSession?.panelId
    ) {
      return 'floating';
    }
    return readEditorWorkspaceRenderedPlacement(
      workspacePanelPlacements,
      panelId,
      activeWorkflowSession?.panelId ?? null
    );
  }

  function focusWorkspacePanel(panelId: EditorWorkspacePanelId) {
    const panel = document.querySelector<HTMLElement>(
      `[data-editor-workspace-panel="${panelId}"]`
    );
    panel?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    panel?.focus?.({ preventScroll: true });
  }

  function renderWorkspacePanel(
    id: string,
    title: string,
    children: ReactNode,
    options: { fill?: boolean; readOnly?: boolean } = {}
  ) {
    const panelId = id as EditorWorkspacePanelId;
    const renderedPlacement = readWorkspacePanelRenderedPlacement(panelId);
    const renderedGeometry =
      renderedPlacement === 'floating'
        ? clampEditorFloatingPanelGeometry(
            workspacePanelGeometries[panelId],
            readFloatingPanelViewport()
          )
        : workspacePanelGeometries[panelId];
    const ownedMutatingWorkflow =
      activeWorkflowSession?.kind === 'mutating' && activeWorkflowSession.panelId === panelId
        ? activeWorkflowSession
        : null;
    const panelChildren = (
      <>
        {panelId === 'path-diagnostics' && programTree && (
          <EditorExecutionDiagnostics diagnostics={programTree.diagnostics} onResolve={openEditorWorkflowForTarget} />
        )}
        {children}
        {ownedMutatingWorkflow && (
          <div className="mt-3 border-t border-border pt-2" data-editor-workflow-actions={ownedMutatingWorkflow.commandId}>
            {options.readOnly && !ownedMutatingWorkflow.dirty ? (
              <button
                aria-label={`Close ${ownedMutatingWorkflow.label} workflow`}
                className="h-7 w-full border border-border px-2 text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
                onClick={requestCloseEditorWorkflow}
                type="button"
              >
                Close
              </button>
            ) : (
              <>
                {!ownedMutatingWorkflow.saveAvailability.enabled && (
                  <p className="mb-1 text-[10px] leading-4 text-amber-300" data-editor-workflow-save-reason>
                    {ownedMutatingWorkflow.saveAvailability.reason}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-1">
                  <button
                    aria-label={`Cancel ${ownedMutatingWorkflow.label} workflow`}
                    className="h-7 border border-border px-2 text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
                    onClick={requestCloseEditorWorkflow}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    aria-label={`Save ${ownedMutatingWorkflow.label} workflow`}
                    className="h-7 border border-primary bg-primary px-2 text-[10px] text-primary-foreground outline-none disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!ownedMutatingWorkflow.saveAvailability.enabled}
                    onClick={saveActiveEditorWorkflow}
                    title={
                      ownedMutatingWorkflow.saveAvailability.enabled
                        ? `Save ${ownedMutatingWorkflow.label}`
                        : ownedMutatingWorkflow.saveAvailability.reason
                    }
                    type="button"
                  >
                    Save
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </>
    );

    if (renderedPlacement === 'hidden') {
      return null;
    }

    return (
      <EditorWorkspacePanelFrame
        dockOrder={readWorkspacePanelDockOrder(panelId)}
        fill={options.fill}
        geometry={renderedGeometry}
        id={id}
        onDock={(side) => dockWorkspacePanel(panelId, side)}
        onDragEnd={(point) => handleWorkspacePanelDragEnd(panelId, point)}
        onFloat={() => floatWorkspacePanel(panelId)}
        onFloatFromDock={(point) => floatWorkspacePanelFromDock(panelId, point)}
        onGeometryChange={(geometry) => setWorkspacePanelGeometry(panelId, geometry)}
        onHide={requestCloseEditorWorkflow}
        compactDrawerOpen={
          isCompactViewport && activeWorkflowSession?.panelId === panelId && compactDrawer === 'workflow'
        }
        compactTransitionOverlay={compactTransitionOverlay}
        compactModalHost={compactModalHost}
        isCompactWorkflow={isCompactViewport && activeWorkflowSession?.panelId === panelId}
        onCloseCompactDrawer={() => {
          setCompactDrawer(null);
          window.requestAnimationFrame(() => {
            document.querySelector<HTMLButtonElement>('[aria-label="Open active workflow"]')?.focus();
          });
        }}
        placement={renderedPlacement}
        title={title}
      >
        {panelChildren}
      </EditorWorkspacePanelFrame>
    );
  }

  function renderPathNavigatorPanel(
    pathDocument: PathPlanningDocument,
    presentation: 'workspace' | 'contour-tree' = 'workspace'
  ) {
    return (
      <EditorPathNavigatorPanel
        expandedPathElementIds={expandedPathElementIds}
        hoveredPathElement={activeHoveredPathElement}
        hoverAssistEnabled={pathHoverAssistEnabled}
        isSaving={isEditorMutationLocked}
        key={programIdentity}
        latestMeasurementPoint={measurementPoints.at(-1) ?? null}
        measurementPoints={measurementPoints}
        onExpandedPathElementIdsChange={setExpandedPathElementIds}
        onHoverPathElement={setHoveredPathElement}
        onMirrorPathDocument={handleMirrorPathDocument}
        onMirrorPathSelection={handleMirrorPathSelection}
        onMovePathSelectionCenter={handleMovePathSelectionCenter}
        onMoveSelectedSegmentCenter={handleMoveSelectedSegmentCenter}
        onMovePathOperation={handleMovePathOperation}
        onOpenWorkspacePanel={showWorkspacePanel}
        onRotatePathDocument={handleRotatePathDocument}
        onRotatePathSelection={handleRotatePathSelection}
        onSelectPathElement={handleSelectPathElement}
        onPathTargetXDraftChange={setPathTargetXDraft}
        onPathTargetYDraftChange={setPathTargetYDraft}
        onSetPathOperationOrderStrategy={handleSetPathOperationOrderStrategy}
        onTranslatePathDocument={handleTranslatePathDocument}
        onTranslatePathSelection={handleTranslatePathSelection}
        onToggleHoverAssist={handleTogglePathHoverAssist}
        pathDocument={pathDocument}
        pathTargetXDraft={pathTargetXDraft}
        pathTargetYDraft={pathTargetYDraft}
        pathTranslateXDraft={pathTranslateXDraft}
        pathTranslateYDraft={pathTranslateYDraft}
        presentation={presentation}
        {...(presentation === 'workspace' ? { renderWorkspacePanel } : {})}
        selectedDiagnosticId={selectedDiagnosticId}
        selectedPathElement={selectedPathElement}
        selectedPathOperationId={selectedPathOperationId}
        onPathTranslateXDraftChange={setPathTranslateXDraft}
        onPathTranslateYDraftChange={setPathTranslateYDraft}
        onTransformDraftChange={(source) => {
          markActiveWorkflowPending(
            'geometry.transform',
            source === 'target' ? 'transform-target' : 'transform-translate',
            'Apply or correct the pending transform coordinates before saving or changing the target.'
          );
        }}
        transformTargetChangeBlocked={workflowTargetChangeBlocked}
      />
    );
  }

  function handleActivatePathClickMode(mode: MagnetizeMode | null) {
    if (!activeWorkflowOwns('construction.measurement')) return;
    if (mode === null) {
      setPathClickMode((current) => current === 'set-start' ? current : null);
      clearActiveWorkflowPending('construction-mode');
      markActiveWorkflowDirty('construction.measurement');
      return;
    }

    if (activeToolSession) {
      onStatusMessage?.(
        `Finish or cancel ${activeToolSession.label} before starting construction.`,
        'warning'
      );
      return;
    }
    setPathClickMode(mode);
    markActiveWorkflowPending(
      'construction.measurement',
      'construction-mode',
      'Place the construction point or exit the active construction mode before saving.'
    );
  }

  function handleSetStartOperationTarget(operationId: string) {
    if (!activeWorkflowOwns(SET_START_COMMAND.id) || isEditorMutationLocked) return;
    setSelectedPathOperationId(operationId);
    setSelectedPathElement(null);
    setSelectedProgramExactTarget(null);
    setSelectedProgramTreeKey(programTreeKeyForOperation(operationId));
    setActiveToolSession(
      createEditorToolSession({
        commandId: SET_START_COMMAND.id,
        label: SET_START_COMMAND.label,
        historyLabel: SET_START_COMMAND.historyLabel!,
        target: { kind: 'operation', id: operationId },
        steps: ['pick-point']
      })
    );
    setPathClickMode('set-start');
  }

  function handleSelectSetStartOperation(operationId: string) {
    if (!activeWorkflowOwns(SET_START_COMMAND.id) || isEditorMutationLocked) return;
    setSelectedPathOperationId(operationId);
    setSelectedPathElement(null);
    setSelectedProgramExactTarget(null);
    setSelectedProgramTreeKey(programTreeKeyForOperation(operationId));
    setActiveToolSession(null);
    setPathClickMode(null);
  }

  function handleSetCanvasMouseMode(mode: 'select' | 'point') {
    if (pathDocumentDraft && !activeWorkflowOwns('construction.measurement')) return;
    if (canvasMouseMode === mode) return;
    if (pathDocumentDraft) markActiveWorkflowDirty('construction.measurement');
    setCanvasMouseMode(mode);
  }

  function handleToggleConstructionGridSnap() {
    if (pathDocumentDraft && !activeWorkflowOwns('construction.measurement')) return;
    if (pathDocumentDraft) markActiveWorkflowDirty('construction.measurement');
    setGridSnapEnabled((current) => !current);
  }

  function handleSetStartInferenceMode(mode: SetStartInferenceMode) {
    if (!activeWorkflowOwns(SET_START_COMMAND.id)) return;
    setSetStartInferenceMode(mode);
  }

  function renderInspectorPanelContent() {
    return (
      <div
        className={`h-full min-h-0 overflow-hidden ${
          isPathProject ? '' : 'grid lg:grid-rows-[minmax(0,1fr)_minmax(0,42vh)]'
        }`}
      >
        {pathDocumentDraft && renderWorkspacePanel('measure', 'Measure', (
          <EditorMeasurePanel measurement={measurement} document={pathDocumentDraft} />
        ))}
        {!pathDocumentDraft && (
          <div
            className="grid min-h-0 gap-2 overflow-hidden p-2 lg:grid-rows-[minmax(0,1fr)_auto]"
            data-editor-side-code-panel
          >
            <EditorProgramLinesPanel
              bodyGroups={bodyGroups}
              guideHighlightTarget={guideHighlightTarget}
              isGroupExpanded={isGroupExpanded}
              isSaving={isEditorMutationLocked}
              lineMode={lineMode}
              lineRows={lineRows}
              onClearPins={() => setPinnedLines([])}
              onClearSelectedLines={clearSelectedLines}
              onDeleteGroup={handleDeleteGroup}
              onDeleteSelectedLines={handleDeleteSelectedLines}
              onHoverLineChange={setHoveredLine}
              onLineClick={handleLineClick}
              onLineEditCommit={handleLineEditCommit}
              onMoveGroup={handleMoveGroup}
              onMoveSelectedLines={handleMoveSelectedLines}
              onNormalizeDraft={handleNormalizeDraft}
              onSetLineMode={handleSetLineMode}
              onSetStartHere={handleSetStartHere}
              onToggleGroup={handleToggleGroup}
              onTogglePin={handleTogglePin}
              onToggleProgramLinesOpen={() => setProgramLinesOpen((current) => !current)}
              pinnedLines={pinnedLines}
              program={program}
              programLinesOpen={programLinesOpen}
              selectedLines={selectedLines}
              structure={structure}
            />
            {renderProgramTextPanel()}
          </div>
        )}
        <EditorInspectorPanel
          arcMoveCount={arcMoveCount}
          boundsText={boundsText}
          canvasMouseMode={canvasMouseMode}
          cuttingMoveCount={cuttingMoveCount}
          canInsertMeasurementPoints={!isPathProject}
          draftProgram={draftProgram}
          editorFileName={editorFileName}
          fullHeight={isPathProject}
          gridSnapEnabled={gridSnapEnabled}
          guideHighlightTarget={guideHighlightTarget}
          isSaving={isEditorMutationLocked}
          measurementPoints={measurementPoints}
          machineFit={machineFit}
          planningMachine={planningMachine}
          canReimportDxfUnits={Boolean(pathDocumentDraft && onReimportDxfUnits && !hasUnsavedChanges)}
          reimportDxfUnitsDisabledReason={
            hasUnsavedChanges ? 'Save or undo path changes before re-importing DXF units.' : null
          }
          onAddMeasurementPoint={handleAddMeasurementPoint}
          onActivatePathConstructionMode={(mode) => handleActivatePathClickMode(mode)}
          onClearMeasurementPoints={handleClearMeasurementPoints}
          onDeleteMeasurementPoint={handleDeleteMeasurementPoint}
          onExportMeasurementPoints={handleExportMeasurementPoints}
          onHoverPathElement={setHoveredPathElement}
          onInsertMeasurementPoints={handleInsertMeasurementPoints}
          onReimportDxfUnits={
            onReimportDxfUnits
              ? () => runAfterActiveWorkflowResolved((unsavedAfterWorkflow) => {
                  if (unsavedAfterWorkflow && !window.confirm('Discard unsaved changes?')) return;
                  void onReimportDxfUnits();
                })
              : undefined
          }
          onPointXDraftChange={(value) => {
            setPointXDraft(value);
            if (pathDocumentDraft) markActiveWorkflowPending(
              'construction.measurement',
              'measurement-input',
              'Add a valid point or clear the pending point coordinates before saving.'
            );
          }}
          onPointYDraftChange={(value) => {
            setPointYDraft(value);
            if (pathDocumentDraft) markActiveWorkflowPending(
              'construction.measurement',
              'measurement-input',
              'Add a valid point or clear the pending point coordinates before saving.'
            );
          }}
          onSelectPathElement={handleSelectPathElement}
          onSetCanvasMouseMode={handleSetCanvasMouseMode}
          onToggleGridSnap={handleToggleConstructionGridSnap}
          pathCount={pathCount}
          pathConstructionMode={pathClickMode === 'set-start' ? null : pathClickMode}
          pathDocument={pathDocumentDraft}
          pointXDraft={pointXDraft}
          pointYDraft={pointYDraft}
          program={program}
          rapidMoveCount={rapidMoveCount}
          renderWorkspacePanel={isPathProject ? renderWorkspacePanel : undefined}
          selectedPathElement={selectedPathElement}
          selectedPathOperationId={selectedPathOperationId}
          structure={isPathProject ? null : structure}
        />
      </div>
    );
  }

  function setWorkspacePanelGeometry(
    panelId: EditorWorkspacePanelId,
    geometry: EditorFloatingPanelGeometry
  ) {
    setWorkspacePanelGeometries((current) => {
      const clamped = clampEditorFloatingPanelGeometry(geometry, readFloatingPanelViewport());
      if (floatingPanelGeometriesEqual(current[panelId], clamped)) return current;

      return {
        ...current,
        [panelId]: clamped
      };
    });
  }

  function renderEditorDockZone(side: EditorDockSide) {
    return (
      <EditorPanelDockZone
        panelCount={readWorkspaceDockPanelCount(side)}
        side={side}
        title="Workflow Dock"
        onDropPanel={(panelId, dockSide, point) =>
          dockWorkspacePanel(panelId as EditorWorkspacePanelId, dockSide, point)
        }
      />
    );
  }

  function readWorkspaceDockPanelCount(side: EditorDockSide) {
    return workspaceDockOrders[side].filter(
      (panelId) => readWorkspacePanelRenderedPlacement(panelId) === `docked-${side}`
    ).length;
  }

  function readWorkspacePanelDockOrder(panelId: EditorWorkspacePanelId) {
    const placement = readWorkspacePanelRenderedPlacement(panelId);
    if (placement !== 'docked-left' && placement !== 'docked-right') return 0;

    const side = placement === 'docked-left' ? 'left' : 'right';
    const order = workspaceDockOrders[side].indexOf(panelId);
    return order >= 0 ? order : workspaceDockOrders[side].length;
  }

  function handleWorkspacePanelDragEnd(
    panelId: EditorWorkspacePanelId,
    point: { x: number; y: number }
  ) {
    const side = findWorkspaceDockSide(point);
    if (!side) return;
    dockWorkspacePanel(panelId, side, point);
  }

  function findWorkspaceDockSide(point: { x: number; y: number }): EditorDockSide | null {
    for (const side of ['right'] as const) {
      const dockZone = document.querySelector(`[data-editor-panel-dock-zone="${side}"]`);
      const rect = dockZone?.getBoundingClientRect();
      if (
        rect &&
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      ) {
        return side;
      }
    }

    return null;
  }

  function dockWorkspacePanel(
    panelId: EditorWorkspacePanelId,
    side: EditorDockSide,
    point?: { x: number; y: number }
  ) {
    if (side === 'left') {
      floatWorkspacePanel(panelId);
      return;
    }
    setInspectorRailCollapsed(false);
    setWorkspacePanelPlacements((current) => ({
      ...current,
      [panelId]: `docked-${side}`
    }));
    setWorkspaceDockOrders((current) => {
      const withoutPanel = {
        left: current.left.filter((id) => id !== panelId),
        right: current.right.filter((id) => id !== panelId)
      };
      const nextSideOrder = [...withoutPanel[side]];
      const insertAt = point
        ? findWorkspaceDockInsertIndex(side, panelId, point.y, nextSideOrder)
        : nextSideOrder.length;
      nextSideOrder.splice(insertAt, 0, panelId);

      return {
        ...withoutPanel,
        [side]: nextSideOrder
      };
    });
  }

  function findWorkspaceDockInsertIndex(
    side: EditorDockSide,
    panelId: EditorWorkspacePanelId,
    y: number,
    fallbackOrder: EditorWorkspacePanelId[]
  ) {
    const dockedPanels = [
      ...document.querySelectorAll<HTMLElement>(
        `[data-editor-workspace-panel-side="${side}"][data-editor-workspace-panel-placement="docked-${side}"]`
      )
    ].filter((element) => element.getAttribute('data-editor-workspace-panel') !== panelId);

    if (dockedPanels.length === 0) return fallbackOrder.length;

    const sortedPanels = dockedPanels.sort(
      (first, second) => first.getBoundingClientRect().top - second.getBoundingClientRect().top
    );
    const insertBefore = sortedPanels.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });

    return insertBefore >= 0 ? insertBefore : sortedPanels.length;
  }

  function floatWorkspacePanelFromDock(
    panelId: EditorWorkspacePanelId,
    point: { x: number; y: number }
  ) {
    setWorkspacePanelGeometry(panelId, {
      ...workspacePanelGeometries[panelId],
      x: Math.max(6, point.x - 24),
      y: Math.max(42, point.y - 14)
    });
    setWorkspacePanelPlacements((current) => ({
      ...current,
      [panelId]: 'floating'
    }));
    setWorkspaceDockOrders((current) => ({
      left: current.left.filter((id) => id !== panelId),
      right: current.right.filter((id) => id !== panelId)
    }));
  }

  function floatWorkspacePanel(panelId: EditorWorkspacePanelId) {
    setWorkspacePanelGeometries((current) => ({
      ...current,
      [panelId]: findReadableFloatingPanelGeometry(
        panelId,
        current[panelId],
        workspacePanelPlacements,
        current
      )
    }));
    setWorkspacePanelPlacements((current) => ({
      ...current,
      [panelId]: 'floating'
    }));
    setWorkspaceDockOrders((current) => ({
      left: current.left.filter((id) => id !== panelId),
      right: current.right.filter((id) => id !== panelId)
    }));
  }

  function showWorkspacePanel(panelId: EditorWorkspacePanelId | 'geometry-rail') {
    if (panelId === 'geometry-rail') {
      setUpidRailMode('geometry');
      if (isCompactViewport || isMiddleViewport) {
        setCompactDrawer('upid');
      } else {
        setUpidRailCollapsed(false);
      }
      return;
    }
    openEditorWorkflowForPanel(panelId);
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-editor-layout="canvas-first"
    >
      <EditorGuideDialog
        context={isPathProject ? 'path' : 'program'}
        language={guideLanguage}
        onClose={() => setGuideOpen(false)}
        onHighlight={handleGuideHighlight}
        onLanguageChange={handleGuideLanguageChange}
        open={guideOpen}
      />
      {activeWorkflowSession && (() => {
        const transitionDialog = <EditorWorkflowTransitionDialog
          nextWorkflowLabel={
            workflowTransition?.kind === 'held' && workflowTransition.request.kind === 'open'
              ? EDITOR_COMMAND_REGISTRY.get(workflowTransition.request.commandId)?.label ?? null
              : null
          }
          onDiscard={() => resolveWorkflowTransition('discard')}
          onDismiss={dismissWorkflowTransition}
          onSave={() => resolveWorkflowTransition('save')}
          open={workflowTransition?.kind === 'held'}
          saveAvailability={activeWorkflowSession.saveAvailability}
          workflowLabel={activeWorkflowSession.label}
        />;
        return (isCompactViewport || isMiddleViewport) && compactModalHost
          ? createPortal(transitionDialog, compactModalHost)
          : transitionDialog;
      })()}
      <div data-editor-floating-layer />
      <div className="hidden" data-editor-workspace-panel-registry>
        {pathDocumentDraft && renderPathNavigatorPanel(pathDocumentDraft)}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'geometry-setup',
            'Geometry Setup',
            <EditorGeometrySetupPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              onSetGeometryBasis={handleSetGeometryBasis}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'contour-setup',
            'Contour Setup',
            <EditorContourSetupPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              onReverse={handleReversePathOperation}
              onSelectOperation={(operationId) => {
                setSelectedPathOperationId(operationId);
                setSelectedPathElement(null);
                setSelectedProgramExactTarget(null);
                setSelectedProgramTreeKey(programTreeKeyForOperation(operationId));
              }}
              onSetClassification={handleSetPathOperationClassification}
              onSetCompensation={handleSetManualCompensation}
              selectedOperationId={selectedPathOperationId}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'set-start',
            'Contour Start',
            <EditorSetStartPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              inferenceMode={setStartInferenceMode}
              onInferenceModeChange={handleSetStartInferenceMode}
              onPickStart={handleSetStartOperationTarget}
              onSelectOperation={handleSelectSetStartOperation}
              selectedOperationId={selectedPathOperationId}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'initial-wire-position',
            'Initial wire position',
            <EditorInitialWirePositionPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              onDraftChange={() => markActiveWorkflowPending(
                'machining.initial-wire', 'initial-input',
                'Review and apply valid initial wire coordinates before saving.'
              )}
              onSetGeometryLinked={handleSetGeometryLinkedInitialWirePosition}
              onSetManual={handleSetManualInitialWirePosition}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'entry-exit',
            'Entry / Exit',
            <EditorEntryExitPanel
              canvasPickMode={entryExitCanvasPick?.kind ?? null}
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              onCanvasPickModeChange={(mode, operationId) => {
                if (!activeWorkflowOwns('machining.entry-exit') || isEditorMutationLocked) return;
                setEntryExitCanvasPick(mode ? { kind: mode, operationId } : null);
              }}
              onDraftChange={(source) => markActiveWorkflowPending(
                'machining.entry-exit', source,
                'Apply or correct the pending cut entry or exit coordinates before saving or changing the target contour.'
              )}
              onSelectOperation={handleSelectWorkflowOperation}
              onSetCircleCenterEntry={handleSetOperationCircleCenterEntry}
              onSetManualEntry={handleSetOperationManualEntry}
              onSetManualExit={handleSetOperationManualExit}
              onSetNoEntry={handleSetOperationNoEntry}
              onSetNoExit={handleSetOperationNoExit}
              selectedOperationId={selectedPathOperationId}
              targetChangeBlocked={workflowTargetChangeBlocked}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'between-contours',
            'Between Contours',
            <EditorBetweenContoursPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              onSelectOperation={handleSelectWorkflowOperation}
              onSetOperationThreading={handleSetOperationThreading}
              onSetProjectThreading={handleSetProjectThreading}
              selectedOperationId={selectedPathOperationId}
              selectedPackage={planningPackage}
              targetChangeBlocked={workflowTargetChangeBlocked}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'machining-participation',
            'Machining Participation',
            <EditorMachiningParticipationPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              onDraftChange={() => markActiveWorkflowPending(
                'machining.participation', 'span-form',
                'Apply a valid machining span or discard its pending range before saving or changing the target contour.'
              )}
              onSetEntryReview={handleSetPartialContourEntryReview}
              onSetExitReview={handleSetPartialContourExitReview}
              onSetSpan={handleSetMachiningSpan}
              onSetWireSide={handleSetPartialContourCompensationSide}
              selectedOperationId={selectedPathOperationId}
              selectedSegmentId={selectedPathElement?.segmentId ?? null}
              selectedSpanId={selectedMachiningSpanId}
              targetChangeBlocked={workflowTargetChangeBlocked}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'program-stops',
            'Program Stops',
            <EditorProgramStopsPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              onDraftChange={() => markActiveWorkflowPending(
                'machining.program-stops', 'stop-form',
                'Apply or add the program stop, or discard its pending fields before saving or changing the target contour or stop.'
              )}
              onSetStops={handleSetOperationProgramStops}
              targetChangeBlocked={workflowTargetChangeBlocked}
              onSelectStop={(operationId, stopId) => {
                if (workflowTargetChangeBlocked) return;
                setSelectedPathOperationId(operationId);
                setSelectedPathElement({ operationId, segmentId: null });
                setSelectedProgramExactTarget(stopId ? { kind: 'program-stop', operationId, stopId } : null);
                setSelectedProgramTreeKey(null);
              }}
              selectedOperationId={selectedPathOperationId}
              selectedStopId={selectedProgramStopId}
            />
          )}
        {isPathProject && renderInspectorPanelContent()}
      </div>
      <section
        className={`grid min-h-0 flex-1 grid-cols-1 gap-y-2 overflow-hidden p-2 lg:grid-rows-[minmax(0,1fr)] ${
          isPathProject
            ? 'grid-rows-[minmax(0,1fr)]'
            : 'grid-rows-[minmax(360px,1fr)_minmax(320px,45vh)]'
        }`}
        data-editor-main-grid
        data-has-active-right-dock={hasActiveRightDock ? 'true' : 'false'}
        data-inspector-collapsed={inspectorRailCollapsed ? 'true' : 'false'}
        data-is-path-project={isPathProject ? 'true' : 'false'}
        style={{ '--editor-inspector-width': `${inspectorRailWidth}px` } as CSSProperties}
      >
        <EditorCanvasPanel
          canvasMouseMode={canvasMouseMode}
          constructionPreview={constructionPreview ?? entryExitInferencePreview}
          draftProgram={draftProgram}
          gridSnapEnabled={
            !pathDocumentDraft || activeWorkflowOwns('construction.measurement')
              ? gridSnapEnabled
              : false
          }
          guideHighlightTarget={guideHighlightTarget}
          guideOpen={guideOpen}
          hoveredLine={hoveredLine}
          interactionHint={editorInteractionHint}
          hoveredPathElement={activeHoveredPathElement}
          measurementPoints={measurementPoints}
          onCursorPointChange={setPreviewCursorPoint}
          measurement={activeWorkflowOwns('inspect.measure') ? measurement : undefined}
          onMeasurementPointMove={
            activeWorkflowOwns('construction.measurement') ? handleMeasurementPointMove : undefined
          }
          onPathEndpointClick={
            activeWorkflowOwns(SET_START_COMMAND.id) && pathClickMode === 'set-start'
              ? handleSetPathStartFromElement
              : undefined
          }
          onPathElementDrag={
            activeWorkflowOwns('geometry.transform') && !pathClickMode
              ? handleDragPathElement
              : undefined
          }
          onPathElementClick={!pathClickMode && !entryExitCanvasPick ? handleSelectPathElement : undefined}
          onPathElementHover={pathHoverAssistEnabled ? setHoveredPathElement : undefined}
          onPathSegmentCenterMove={
            activeWorkflowOwns('geometry.transform') && !pathClickMode
              ? handleMovePathSegmentCenter
              : undefined
          }
          pathEndpointActionOperationId={
            activeWorkflowOwns(SET_START_COMMAND.id) && pathClickMode === 'set-start'
              ? selectedPathOperationId
              : null
          }
          onPreviewPointClick={
            (
              !pathDocumentDraft ||
              activeWorkflowOwns(SET_START_COMMAND.id) ||
              activeWorkflowOwns('construction.measurement') ||
              (activeWorkflowOwns('machining.entry-exit') && entryExitCanvasPick !== null)
            )
              ? handlePreviewPointClick
              : undefined
          }
          onSetCanvasMouseMode={
            !pathDocumentDraft || activeWorkflowOwns('construction.measurement')
              ? handleSetCanvasMouseMode
              : undefined
          }
          pathDocument={pathDocumentDraft}
          pathCount={isPathProject ? undefined : pathCount}
          pinnedLines={pinnedLines}
          selectedPathElement={selectedPathElement}
          selectedLines={selectedLines}
          startPreview={startPreview}
        />

        {isPathProject ? (hasActiveRightDock ? (
          <>
            <RailResizeHandle
              label="Resize Workflow Dock"
              className="hidden lg:block"
              data-editor-inspector-resizer
              side="right" width={inspectorRailWidth} minWidth={280} maxWidth={560}
              onWidthChange={setInspectorRailWidth}
            />
            {renderEditorDockZone('right')}
          </>
        ) : null) : inspectorRailCollapsed ? (
          <div
            className="hidden min-h-0 border border-border bg-card/95 lg:flex lg:flex-col lg:items-center lg:gap-3 lg:py-2"
            data-editor-inspector-collapsed
          >
            <button
              aria-label="Expand Inspector Rail"
              className="flex size-7 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
              onClick={() => setInspectorRailCollapsed(false)}
              title="Expand Inspector Rail"
              type="button"
            >
              <PanelRightOpen className="size-3.5" />
            </button>
            <div className="rotate-180 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground [writing-mode:vertical-rl]">
              Inspector
            </div>
          </div>
        ) : (
          <>
            <RailResizeHandle
              label="Resize Inspector Rail"
              className="hidden lg:block"
              data-editor-inspector-resizer
              side="right" width={inspectorRailWidth} minWidth={280} maxWidth={560}
              onWidthChange={setInspectorRailWidth}
            />
            <aside
              className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/95 text-[10px]"
              data-editor-inspector-panel
              data-editor-inspector-rail
            >
              <div className="flex h-7 shrink-0 items-center justify-end border-b border-border px-1">
                <button
                  aria-label="Collapse Inspector Rail"
                  className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
                  onClick={() => setInspectorRailCollapsed(true)}
                  title="Collapse Inspector Rail"
                  type="button"
                >
                  <PanelRightClose className="size-3.5" />
                </button>
              </div>
              {renderInspectorPanelContent()}
            </aside>
          </>
        )}
      </section>
      <EditorStatusBar
        coordinateUnits={pathDocumentDraft ? 'mm' : draftParseResult?.coordinateUnits ?? null}
        diagnosticCount={diagnosticCount}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={isSaving}
        machineFit={machineFit}
        onOpenDiagnostics={openStatusDiagnostics}
        previewCursorPoint={previewCursorPoint}
        selectionSummary={editorSelectionSummary}
      />
      {exportPreviewOpen && pathDocumentDraft && (
        <EditorControllerArtifactDialog
          defaultMachineId={planningMachine?.id ?? null}
          hasUnsavedChanges={hasUnsavedChanges}
          machines={machines}
          posts={posts}
          onClose={() => {
            if (activeWorkflowSession?.commandId === 'export.preview') {
              requestCloseEditorWorkflow();
            } else {
              setExportPreviewOpen(false);
            }
          }}
          onDownload={onDownloadEditorFile}
          onGenerateControllerArtifact={onGenerateControllerArtifact}
        />
      )}
    </div>
  );
}

function findProgramTreeOperationId(
  tree: UpidEditorTree,
  treeKey: string
): string | null | undefined {
  if (treeKey === 'section:source' || treeKey === 'section:program') return null;
  if (tree.sourceSetup.some((node) => node.treeKey === treeKey)) return null;
  const operation = tree.operations.find(
    (node) => node.treeKey === treeKey || node.children.some((child) => child.treeKey === treeKey)
  );
  if (operation) return operation.operationId;
  if (tree.status === 'ready' && tree.programEvents.some((node) => node.treeKey === treeKey)) return null;
  if (tree.status !== 'ready') {
    const diagnostic = tree.diagnostics.find((node) => node.treeKey === treeKey);
    if (diagnostic) return diagnostic.operationId;
  }
  return undefined;
}

function exactTargetForProgramTreeNode(
  node: EditorProgramTreeNode | null
): EditorProgramTreeExactTarget | null {
  if (node?.kind === 'diagnostic') {
    return { diagnosticId: node.treeKey, kind: 'diagnostic' };
  }
  if (node?.kind === 'event' && node.eventKind === 'program-stop') {
    const source = node.sourceTrace.find((candidate) => candidate.kind === 'program-stop');
    if (source?.kind !== 'program-stop') return null;
    return {
      kind: 'program-stop',
      operationId: source.operationId,
      stopId: source.stopId
    };
  }
  return null;
}

function reconcileProgramExactTarget(
  target: EditorProgramTreeExactTarget | null,
  document: PathPlanningDocument | null
): EditorProgramTreeExactTarget | null {
  if (!target || !document) return null;
  if (target.kind === 'diagnostic') return target;
  if (target.kind === 'program-stop') {
    return document.plan.operations.find(
      (operation) => operation.id === target.operationId
    )?.programStops?.some((stop) => stop.id === target.stopId)
      ? target
      : null;
  }
  const sourceOperation = document.plan.operations.find(
    (operation) => operation.id === target.operationId
  );
  const sourceSegmentIds = new Set(
    sourceOperation?.segmentRefs.map((reference) => reference.segmentId) ?? []
  );
  if (document.machiningParticipation?.spans.some(
    (span) => span.id === target.spanId && sourceSegmentIds.has(span.sourceSegmentId)
  )) {
    return target;
  }
  const derived = deriveActiveMachiningOperations(document);
  return derived.status === 'ready' && derived.operations.some(
    (operation) =>
      operation.machiningIntent?.sourceOperationId === target.operationId &&
      operation.machiningIntent.spanIds.includes(target.spanId)
  )
    ? target
    : null;
}

function sameProgramExactTarget(
  left: EditorProgramTreeExactTarget | null,
  right: EditorProgramTreeExactTarget | null
) {
  if (left?.kind !== right?.kind) return false;
  if (!left || !right) return true;
  if (left.kind === 'diagnostic' && right.kind === 'diagnostic') {
    return left.diagnosticId === right.diagnosticId;
  }
  if (left.kind === 'machining-span' && right.kind === 'machining-span') {
    return left.operationId === right.operationId && left.spanId === right.spanId;
  }
  return left.kind === 'program-stop' &&
    right.kind === 'program-stop' &&
    left.operationId === right.operationId &&
    left.stopId === right.stopId;
}

function programTreeKeyForOperation(operationId: string | null) {
  return operationId ? `operation:${encodeURIComponent(operationId)}` : null;
}

function nextMeasurementPointId(currentLength: number) {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${currentLength}`;
}

function formatCoordinateDraft(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
