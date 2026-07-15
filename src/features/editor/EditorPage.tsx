import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

import { useAppRail } from '@/app/AppRailContext';
import { parseGCodeProgram } from '@/domain/editor/gcodeParser';
import {
  deleteBodyGroup,
  moveBodyGroup,
  moveSelectedLines,
  setStartAtLine
} from '@/domain/editor/gcodeLineOperations';
import { organizeGCodeStructure } from '@/domain/editor/gcodeStructure';
import { normalizeToISO } from '@/domain/editor/isoNormalizer';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import { evaluateMachineFit } from '@/domain/machine/machineFit';
import { deriveVerifiedRobofilPreviewTransitions } from '@/domain/editor/previewGeometry';
import {
  initializeProjectCompensationIntents,
  machineSnapshotAuthorizesAutomaticCompensation,
  setManualCompensationIntent,
  type ManualCompensationSelection
} from '@/domain/compensation/intent';
import {
  constructMagnetizedPoint,
  mirrorPathDocument,
  mirrorPathElement,
  mirrorPathOperation,
  mirrorPathSegment,
  movePathOperation,
  movePathSegmentCenterTo,
  previewClosedOperationStartNearPoint,
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
  setPlannedRapidDestinationPoint,
  setPlannedRapidSourcePoint,
  setClosedOperationStartAtSegmentEndpoint,
  reversePathOperation,
  setClosedOperationStartAtExistingPointNearPoint,
  setClosedOperationStartNearPoint,
  setPathOperationClassification,
  setPathOperationOrderStrategy,
  slideMagnetizedPointOnSegment,
  translatePathDocument,
  translatePathElement,
  translatePathOperation,
  translatePathSegment,
  type MagnetizedPathPoint,
  type MagnetizeMode,
  type PathMirrorAxis
} from '@/domain/path-editor/pathDocumentOperations';
import type {
  ContourClassification,
  OperationThreadingTransition,
  OperationProgramStop,
  OperationOrderStrategy,
  PathPlanningDocument
} from '@/domain/path-intel/types';
import { normalizeLegacyOperationTransitions } from '@/domain/path-intel/operationTransitions';
import {
  setMachiningSpanParticipation,
  setPartialContourEntryReview,
  setPartialContourCompensationSide
} from '@/domain/path-intel/machiningParticipation';
import {
  normalizeUpidPathElementSelection,
  summarizeUpidPathDocumentForEditor,
  upidPathElementIdForOperation,
  upidStartPreviewPointRole
} from '@/domain/upid/projectRail';
import { composeProjectUpidGCodeExport } from '@/domain/upid/projectUpid';
import {
  createMeasurementPointPathSnapFromMagnetized,
  exportMeasurementPointsAsCsv,
  exportMeasurementPointsAsGCode,
  exportMeasurementPointsAsISO,
  insertMeasurementPointsIntoText,
  type MeasurementPoint
} from '@/domain/editor/measurementPoints';

import { EditorCanvasPanel } from './EditorCanvasPanel';
import { EditorGuideDialog } from './EditorGuideDialog';
import { EditorHeaderBar, type EditorDocumentContext } from './EditorHeaderBar';
import { EditorInspectorPanel } from './EditorInspectorPanel';
import { EditorInitialWirePositionPanel } from './EditorInitialWirePositionPanel';
import { EditorEntryExitPanel } from './EditorEntryExitPanel';
import {
  EditorContourSetupPanel,
  EditorGeometrySetupPanel,
  EditorSetStartPanel
} from './EditorWorkflowSetupPanels';
import { EditorProgramStopsPanel } from './EditorProgramStopsPanel';
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
import { EditorProgramTextPanel } from './EditorProgramTextPanel';
import { EditorStatusBar } from './EditorStatusBar';
import { EditorUpidExportPreview } from './EditorUpidExportPreview';
import {
  clampEditorFloatingPanelGeometry,
  EDITOR_FLOATING_PANEL_GAP,
  EDITOR_FLOATING_PANEL_TOP,
  EditorCollapsedDockZone,
  EditorPanelDockZone,
  EditorWorkspacePanelFrame,
  type EditorDockSide,
  type EditorFloatingPanelGeometry,
  type EditorPanelPlacement
} from './EditorWorkspacePanels';
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
  readPathDocumentBoundsCenter,
  readPathSelectionBoundsCenter,
  resolvePathDragTarget
} from './pathSelectionGeometry';
import {
  readEditorWorkspaceLayout,
  readEditorWorkspaceRenderedPlacement,
  writeEditorWorkspaceLayout,
  type EditorWorkspaceLayoutV1
} from './workspace/editorWorkspaceLayout';
import {
  createEditorCommandRegistry,
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

interface EditorPageProps {
  program: LoadedEditorProgram | null;
  interactionLocked?: boolean;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  saveStatus: 'idle' | 'saving' | 'error';
  saveErrorMessage: string | null;
  onBackToDashboard: () => void;
  onDownloadEditorFile: (fileName: string, text: string) => void;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onReimportDxfUnits?: () => void | Promise<void>;
  onSaveEditorDraft: (draft: EditorSaveDraft) => void | Promise<void>;
  onStatusMessage?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

interface EditorDraftSnapshot {
  draft: EditorDraftState;
  historyLabel?: string;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
}

const SET_START_COMMAND: EditorCommandDefinition = {
  id: 'machining.set-start',
  label: 'Set Start',
  menuPath: ['Machining', 'Operation', 'Set Start'],
  scope: 'operation',
  toolWindowId: 'set-start',
  historyLabel: 'Set operation start',
  prerequisites: [{ kind: 'document' }, { kind: 'interaction-unlocked' }],
  session: { kind: 'set-start' },
  workflow: { kind: 'mutating' }
};

type EditorWorkspacePanelId =
  | 'path-summary'
  | 'geometry-setup'
  | 'contour-setup'
  | 'set-start'
  | 'path-transform'
  | 'endpoint-topology'
  | 'path-diagnostics'
  | 'cut-sequence'
  | 'contour-tree'
  | 'initial-wire-position'
  | 'entry-exit'
  | 'program-stops'
  | 'machining-participation'
  | 'position'
  | 'statistics'
  | 'machine'
  | 'measurement';

const EDITOR_WORKSPACE_PANEL_TITLES: Record<EditorWorkspacePanelId, string> = {
  'path-summary': 'Path Summary',
  'geometry-setup': 'Geometry Setup',
  'contour-setup': 'Contour Setup',
  'set-start': 'Set Start',
  'path-transform': 'Transform',
  'endpoint-topology': 'Endpoint Topology',
  'path-diagnostics': 'Path Diagnostics',
  'cut-sequence': 'Cut Sequence',
  'contour-tree': 'Contour Tree',
  'initial-wire-position': 'Initial Wire Position',
  'entry-exit': 'Entry / Exit & Rethreading',
  'program-stops': 'Program Stops',
  'machining-participation': 'Machining Participation',
  position: 'Position',
  statistics: 'Statistics',
  machine: 'Machine',
  measurement: 'Measurement & Construction'
};

const EDITOR_WORKSPACE_PANEL_DESCRIPTIONS: Record<EditorWorkspacePanelId, string> = {
  'path-summary': 'project counts, topology, source, and planning state',
  'geometry-setup': 'document machining geometry basis',
  'contour-setup': 'contour direction, role, and compensation intent',
  'set-start': 'guided contour start-point selection',
  'path-transform': 'move, rotate, and mirror tools for document and selected geometry',
  'endpoint-topology': 'join map for endpoint joins, healed gaps, open ends, and ambiguous clusters',
  'path-diagnostics': 'warnings and linked rows for broken or risky path geometry',
  'cut-sequence': 'operation order, rapid moves, and cut direction',
  'contour-tree': 'nested contours, segments, endpoints, and canvas cross-highlighting',
  'initial-wire-position': 'reviewed project G92 coordinates and first route origin',
  'entry-exit': 'per-operation cut entry, exit, and manual or automatic rethread policy',
  'program-stops': 'typed unconditional M00 events at operation boundaries or remaining cut distance',
  'machining-participation': 'source-preserving active cuts, inactive reference spans, and explicit open-path compensation side',
  position: 'cursor position and grid snap state',
  statistics: 'bounds, move counts, and selected geometry details',
  machine: 'active Wire EDM profile and machine fit checks',
  measurement: 'manual points, perpendicular and tangent construction, and export actions'
};

const PATH_WORKSPACE_PANEL_IDS: EditorWorkspacePanelId[] = [
  'path-summary',
  'geometry-setup',
  'contour-setup',
  'set-start',
  'path-transform',
  'endpoint-topology',
  'path-diagnostics',
  'cut-sequence',
  'contour-tree',
  'initial-wire-position',
  'entry-exit',
  'program-stops',
  'machining-participation'
];

const INSPECTOR_WORKSPACE_PANEL_IDS: EditorWorkspacePanelId[] = [
  'position',
  'statistics',
  'machine',
  'measurement'
];

const DEFAULT_WORKSPACE_PANEL_GEOMETRY: Record<EditorWorkspacePanelId, EditorFloatingPanelGeometry> = {
  'path-summary': { x: 250, y: 74, width: 300, height: 220 },
  'geometry-setup': { x: 274, y: 104, width: 320, height: 260 },
  'contour-setup': { x: 286, y: 118, width: 340, height: 430 },
  'set-start': { x: 300, y: 132, width: 340, height: 340 },
  'path-transform': { x: 298, y: 134, width: 340, height: 430 },
  'endpoint-topology': { x: 812, y: 84, width: 360, height: 300 },
  'path-diagnostics': { x: 370, y: 224, width: 360, height: 260 },
  'cut-sequence': { x: 394, y: 254, width: 340, height: 340 },
  'contour-tree': { x: 418, y: 84, width: 380, height: 560 },
  'initial-wire-position': { x: 620, y: 110, width: 360, height: 430 },
  'entry-exit': { x: 650, y: 130, width: 390, height: 620 },
  'program-stops': { x: 680, y: 150, width: 370, height: 560 },
  'machining-participation': { x: 710, y: 170, width: 390, height: 600 },
  position: { x: 1020, y: 74, width: 300, height: 180 },
  statistics: { x: 990, y: 104, width: 360, height: 560 },
  machine: { x: 1040, y: 134, width: 300, height: 220 },
  measurement: { x: 250, y: 194, width: 340, height: 420 }
};

const EDITOR_WORKFLOW_MENU_TITLES: EditorWorkflowMenuGroup['title'][] = [
  'Geometry', 'Machining', 'Construction', 'View', 'Machine', 'Export'
];

const EDITOR_COMMAND_REGISTRY = createEditorCommandRegistry([
  {
    id: 'geometry.setup', label: 'Geometry Setup', menuPath: ['Geometry', 'Geometry Setup'],
    scope: 'document', toolWindowId: 'geometry-setup', historyLabel: 'Edit geometry setup',
    prerequisites: [{ kind: 'document' }], workflow: { kind: 'mutating' }
  },
  {
    id: 'geometry.transform', label: 'Transform Geometry', menuPath: ['Geometry', 'Transform Geometry'],
    scope: 'document', toolWindowId: 'path-transform', historyLabel: 'Transform geometry',
    prerequisites: [{ kind: 'document' }], workflow: { kind: 'mutating' }
  },
  {
    id: 'machining.contour-setup', label: 'Contour Setup', menuPath: ['Machining', 'Contour Setup'],
    scope: 'operation', toolWindowId: 'contour-setup', historyLabel: 'Edit contour setup',
    prerequisites: [{ kind: 'document' }], workflow: { kind: 'mutating' }
  },
  SET_START_COMMAND,
  ...([
    ['machining.sequence', 'Cut Sequence', 'cut-sequence'],
    ['machining.initial-wire', 'Initial Wire Position', 'initial-wire-position'],
    ['machining.entry-exit', 'Entry / Exit & Rethreading', 'entry-exit'],
    ['machining.program-stops', 'Program Stops', 'program-stops'],
    ['machining.participation', 'Machining Participation', 'machining-participation']
  ] as const).map(([id, label, toolWindowId]) => ({
    id, label, menuPath: ['Machining', label] as const, scope: 'document' as const,
    toolWindowId, historyLabel: `Edit ${label}`, prerequisites: [{ kind: 'document' } as const],
    workflow: { kind: 'mutating' as const }
  })),
  {
    id: 'construction.measurement', label: 'Measurement & Construction',
    menuPath: ['Construction', 'Measurement & Construction'], scope: 'document',
    toolWindowId: 'measurement', prerequisites: [{ kind: 'document' }],
    workflow: { kind: 'view' }
  },
  ...([
    ['view.contours', 'Contour Tree', 'contour-tree'],
    ['view.summary', 'Path Summary', 'path-summary'],
    ['view.endpoints', 'Endpoint Topology', 'endpoint-topology'],
    ['view.diagnostics', 'Path Diagnostics', 'path-diagnostics'],
    ['view.statistics', 'Statistics', 'statistics'],
    ['view.position', 'Position', 'position']
  ] as const).map(([id, label, toolWindowId]) => ({
    id, label, menuPath: ['View', label] as const, scope: 'view' as const,
    toolWindowId, prerequisites: [{ kind: 'document' } as const], workflow: { kind: 'view' as const }
  })),
  {
    id: 'machine.profile', label: 'Project Machine', menuPath: ['Machine', 'Project Machine'],
    scope: 'machine', toolWindowId: 'machine', historyLabel: 'Edit project machine',
    prerequisites: [{ kind: 'document' }], workflow: { kind: 'mutating' }
  },
  {
    id: 'export.preview', label: 'Controller Export',
    menuPath: ['Export', 'Controller Export'], scope: 'export', toolWindowId: 'controller-export',
    prerequisites: [{ kind: 'document' }, { kind: 'interaction-unlocked' }], workflow: { kind: 'view' }
  }
]);

function createDefaultPanelRecord<T>(valueFor: (id: EditorWorkspacePanelId) => T): Record<EditorWorkspacePanelId, T> {
  return [...PATH_WORKSPACE_PANEL_IDS, ...INSPECTOR_WORKSPACE_PANEL_IDS].reduce(
    (record, id) => {
      record[id] = valueFor(id);
      return record;
    },
    {} as Record<EditorWorkspacePanelId, T>
  );
}

const HIDDEN_WORKSPACE_PANEL_PLACEMENTS = createDefaultPanelRecord<EditorPanelPlacement>(() => 'hidden');
const PATH_DEFAULT_PLACEMENTS = createDefaultPanelRecord<EditorPanelPlacement>(() => 'hidden');
const PATH_DEFAULT_DOCK_ORDERS: Record<EditorDockSide, EditorWorkspacePanelId[]> = {
  left: [],
  right: []
};

function createDefaultWorkspacePanelPlacements(model: LoadedEditorProgram['model'] | undefined) {
  return {
    ...(model === 'upid-document' ? PATH_DEFAULT_PLACEMENTS : HIDDEN_WORKSPACE_PANEL_PLACEMENTS)
  };
}

function createDefaultWorkspaceDockOrders(model: LoadedEditorProgram['model'] | undefined) {
  return model === 'upid-document'
    ? {
        left: [...PATH_DEFAULT_DOCK_ORDERS.left],
        right: [...PATH_DEFAULT_DOCK_ORDERS.right]
      }
    : { left: [], right: [] };
}

function createDefaultWorkspaceLayout(
  model: LoadedEditorProgram['model'] | undefined
): EditorWorkspaceLayoutV1 {
  return {
    schemaVersion: 1,
    placements: createDefaultWorkspacePanelPlacements(model),
    dockOrders: createDefaultWorkspaceDockOrders(model),
    floatingGeometries: { ...DEFAULT_WORKSPACE_PANEL_GEOMETRY },
    dockWidths: { left: 360, right: 420 }
  };
}

function readInitialWorkspaceLayout(model: LoadedEditorProgram['model'] | undefined) {
  return readEditorWorkspaceLayout(createDefaultWorkspaceLayout(model), {
    width: window.innerWidth,
    height: window.innerHeight
  });
}

function handleEditorDragOver(event: DragEvent<HTMLDivElement>) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

function findReadableFloatingPanelGeometry(
  panelId: EditorWorkspacePanelId,
  requestedGeometry: EditorFloatingPanelGeometry,
  placements: Record<EditorWorkspacePanelId, EditorPanelPlacement>,
  geometries: Record<EditorWorkspacePanelId, EditorFloatingPanelGeometry>
) {
  const viewport = readFloatingPanelViewport();
  const existingPanels = Object.entries(placements)
    .filter(([id, placement]) => id !== panelId && placement === 'floating')
    .map(([id]) =>
      clampEditorFloatingPanelGeometry(geometries[id as EditorWorkspacePanelId], viewport)
    );
  const renderedPanels = readRenderedFloatingPanelGeometries(panelId, viewport);
  const baseGeometry = clampEditorFloatingPanelGeometry(requestedGeometry, viewport);

  const comparisonPanels = [...existingPanels, ...renderedPanels];

  if (!floatingPanelOverlapsAny(baseGeometry, comparisonPanels)) return baseGeometry;

  const candidateGeometries = createFloatingPanelCandidates(baseGeometry, comparisonPanels, viewport);
  const fullSizeCandidate = candidateGeometries.find(
    (candidate) => !floatingPanelOverlapsAny(candidate, comparisonPanels)
  );
  if (fullSizeCandidate) return fullSizeCandidate;

  for (const variant of createFloatingPanelFitVariants(baseGeometry, viewport)) {
    const fittedCandidate = createFloatingPanelCandidates(variant, comparisonPanels, viewport).find(
      (candidate) => !floatingPanelOverlapsAny(candidate, comparisonPanels)
    );
    if (fittedCandidate) return fittedCandidate;
  }

  return baseGeometry;
}

function readFloatingPanelViewport() {
  const left = EDITOR_FLOATING_PANEL_GAP;
  const width = Math.max(left + 280, window.innerWidth);
  const height = Math.max(EDITOR_FLOATING_PANEL_TOP + 220, window.innerHeight);

  return {
    height,
    left,
    top: EDITOR_FLOATING_PANEL_TOP,
    width
  };
}

function readRenderedFloatingPanelGeometries(
  panelId: EditorWorkspacePanelId,
  viewport: ReturnType<typeof readFloatingPanelViewport>
) {
  return [...document.querySelectorAll<HTMLElement>('[data-editor-floating-panel]')]
    .filter((element) => element.getAttribute('data-editor-floating-panel') !== panelId)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return clampEditorFloatingPanelGeometry(
        {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        },
        viewport
      );
    });
}

function createFloatingPanelCandidates(
  baseGeometry: EditorFloatingPanelGeometry,
  existingPanels: EditorFloatingPanelGeometry[],
  viewport: ReturnType<typeof readFloatingPanelViewport>
) {
  const maxX = Math.max(
    viewport.left,
    viewport.width - baseGeometry.width - EDITOR_FLOATING_PANEL_GAP
  );
  const maxY = Math.max(
    viewport.top,
    viewport.height - baseGeometry.height - EDITOR_FLOATING_PANEL_GAP
  );
  const xStops = new Set<number>([
    baseGeometry.x,
    viewport.left,
    maxX,
    ...existingPanels.flatMap((panel) => [
      panel.x + panel.width + EDITOR_FLOATING_PANEL_GAP,
      panel.x - baseGeometry.width - EDITOR_FLOATING_PANEL_GAP
    ])
  ]);
  const yStops = new Set<number>([
    baseGeometry.y,
    viewport.top,
    maxY,
    ...existingPanels.flatMap((panel) => [
      panel.y + panel.height + EDITOR_FLOATING_PANEL_GAP,
      panel.y - baseGeometry.height - EDITOR_FLOATING_PANEL_GAP
    ])
  ]);

  const candidates: EditorFloatingPanelGeometry[] = [];
  for (const y of [...yStops].sort((first, second) => first - second)) {
    for (const x of [...xStops].sort((first, second) => first - second)) {
      candidates.push(
        clampEditorFloatingPanelGeometry(
          {
            ...baseGeometry,
            x,
            y
          },
          viewport
        )
      );
    }
  }

  return candidates;
}

function createFloatingPanelFitVariants(
  baseGeometry: EditorFloatingPanelGeometry,
  viewport: ReturnType<typeof readFloatingPanelViewport>
) {
  const widths = [340, 320, 300, 280, 260].filter((width) => width < baseGeometry.width);

  return widths.map((width) =>
    clampEditorFloatingPanelGeometry(
      {
        ...baseGeometry,
        width
      },
      viewport
    )
  );
}

function floatingPanelOverlapsAny(
  geometry: EditorFloatingPanelGeometry,
  existingPanels: EditorFloatingPanelGeometry[]
) {
  return existingPanels.some((panel) => floatingPanelsOverlap(geometry, panel));
}

function floatingPanelsOverlap(
  first: EditorFloatingPanelGeometry,
  second: EditorFloatingPanelGeometry
) {
  return (
    first.x < second.x + second.width + EDITOR_FLOATING_PANEL_GAP &&
    first.x + first.width + EDITOR_FLOATING_PANEL_GAP > second.x &&
    first.y < second.y + second.height + EDITOR_FLOATING_PANEL_GAP &&
    first.y + first.height + EDITOR_FLOATING_PANEL_GAP > second.y
  );
}

function floatingPanelGeometriesEqual(
  first: EditorFloatingPanelGeometry,
  second: EditorFloatingPanelGeometry
) {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

export function EditorPage({
  program,
  interactionLocked = false,
  importStatus,
  importErrorMessage,
  saveStatus,
  saveErrorMessage,
  onBackToDashboard,
  onDownloadEditorFile,
  onImportProgramFile,
  onReimportDxfUnits,
  onSaveEditorDraft,
  onStatusMessage
}: EditorPageProps) {
  const { setHeaderContent, setRailCollapsed, setRailContent } = useAppRail();
  const [initialWorkspaceLayout] = useState(() => readInitialWorkspaceLayout(program?.model));
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
  const [activeToolSession, setActiveToolSession] = useState<EditorToolSession | null>(null);
  const [activeWorkflowSession, setActiveWorkflowSession] = useState<
    EditorWorkflowSession<EditorDraftSnapshot> | null
  >(null);
  const [workflowTransition, setWorkflowTransition] = useState<
    EditorWorkflowTransition<EditorDraftSnapshot> | null
  >(null);
  const [hoveredPathElement, setHoveredPathElement] = useState<EditorPathElementRef | null>(null);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [pathHoverAssistEnabled, setPathHoverAssistEnabled] = useState(false);
  const [pathMagneticSnapEnabled, setPathMagneticSnapEnabled] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedPathElement, setSelectedPathElement] = useState<EditorPathElementRef | null>(null);
  const [selectedPathOperationId, setSelectedPathOperationId] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
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
  const pathDocumentDraft = editorDraftPathDocument(draftState);
  const savedDraftSignature = useMemo(
    () => editorDraftSignature(createEditorDraftState(program)),
    [program]
  );
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
        parseResult: parseGCodeProgram(draftText),
        project: program.project
      };
    },
    [draftText, pathDocumentDraft, program]
  );
  const draftParseResult = draftProgram?.parseResult ?? null;
  const pathDocumentStats = useMemo(
    () => (pathDocumentDraft ? summarizeUpidPathDocumentForEditor(pathDocumentDraft) : null),
    [pathDocumentDraft]
  );
  const pathCount = pathDocumentStats?.pathCount ?? draftParseResult?.path.length ?? 0;
  const rapidMoveCount =
    pathDocumentStats?.rapidMoveCount ??
    draftParseResult?.path.filter((point) => point.type === 'rapid').length ??
    0;
  const cuttingMoveCount =
    pathDocumentStats?.cuttingMoveCount ??
    draftParseResult?.path.filter((point) => point.type === 'cut').length ??
    0;
  const arcMoveCount =
    pathDocumentStats?.arcMoveCount ??
    draftParseResult?.path.filter((point) => point.type === 'arc').length ??
    0;
  const boundsText = pathDocumentStats
    ? formatBounds(pathDocumentStats.bounds)
    : draftParseResult && pathCount > 0
      ? formatBounds(draftParseResult.bounds)
      : '-';
  const dxfUnitSummary = pathDocumentDraft?.source.appliedUnits
    ? `${pathDocumentDraft.source.appliedUnits.label} ×${formatUnitScale(
        pathDocumentDraft.source.appliedUnits.scaleToMillimeters
      )}`
    : null;
  const machineFit = useMemo(
    () =>
      program
        ? evaluateMachineFit({
            document: pathDocumentDraft,
            profile: program.project?.machine
          })
        : null,
    [pathDocumentDraft, program]
  );
  const upidExport = useMemo(() => {
    if (!exportPreviewOpen || !pathDocumentDraft || !program?.project) return null;

    const exportProgram = composeProjectUpidGCodeExport(program.project, pathDocumentDraft);

    return {
      blockingDiagnostics: exportProgram.blockingDiagnostics,
      body: exportProgram.body,
      canDownload: exportProgram.canDownload,
      diagnostics: exportProgram.diagnostics,
      documentTrace: exportProgram.documentTrace,
      fileName: exportProgram.fileName,
      machineName: exportProgram.machineName,
      operationCount: exportProgram.summary.operationCount,
      pathDocument: exportProgram.pathDocument,
      planning: exportProgram.planning,
      programBlocks: exportProgram.programBlocks,
      programLines: exportProgram.program.lines,
      programText: exportProgram.program.text,
      postMetrics: exportProgram.post.metrics,
      postedOperations: exportProgram.programOperations
    };
  }, [exportPreviewOpen, pathDocumentDraft, program?.project]);
  const postedPreviewTransitions = useMemo(
    () =>
      pathDocumentDraft && program?.project
        ? deriveVerifiedRobofilPreviewTransitions(pathDocumentDraft, program.project.machine)
        : undefined,
    [pathDocumentDraft, program?.project]
  );
  const constructionPreview = useMemo(() => {
    if (
      !pathDocumentDraft ||
      !pathMagneticSnapEnabled ||
      !previewCursorPoint ||
      (pathClickMode !== 'perpendicular' && pathClickMode !== 'tangent')
    ) {
      return null;
    }

    const sourcePoint = measurementPoints.at(-1);
    if (!sourcePoint) return null;

    const magnetized = constructMagnetizedPoint(
      pathDocumentDraft,
      sourcePoint,
      previewCursorPoint,
      pathClickMode
    );
    if (!magnetized) return null;

    return {
      mode: pathClickMode,
      operationId: magnetized.operationId,
      pathElementId: magnetized.pathElementId,
      relation: magnetized.relation,
      segmentId: magnetized.segmentId,
      sourcePoint,
      targetPoint: magnetized.point
    };
  }, [measurementPoints, pathClickMode, pathDocumentDraft, pathMagneticSnapEnabled, previewCursorPoint]);
  const startPreview = useMemo(() => {
    if (
      !pathDocumentDraft ||
      !selectedPathOperationId ||
      !previewCursorPoint ||
      pathClickMode !== 'set-start'
    ) {
      return null;
    }

    const preview = previewClosedOperationStartNearPoint(
      pathDocumentDraft,
      selectedPathOperationId,
      previewCursorPoint,
      pathMagneticSnapEnabled
    );
    if (!preview) return null;

    return {
      operationId: preview.operationId,
      pathElementId: preview.pathElementId,
      point: preview.point,
      pointRole: upidStartPreviewPointRole(pathDocumentDraft, preview),
      relation: preview.relation,
      segmentId: preview.segmentId
    };
  }, [
    pathClickMode,
    pathDocumentDraft,
    pathMagneticSnapEnabled,
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
  const editorFileName =
    program?.model === 'upid-document'
      ? 'UPID Project'
      : program?.filePath.split('/').pop() ?? '-';
  const hasUnsavedChanges = Boolean(program && draftSignature !== savedDraftSignature);
  const activeMutatingWorkflow = activeWorkflowSession?.kind === 'mutating'
    ? activeWorkflowSession
    : null;
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
    () => (draftProgram ? organizeGCodeStructure(draftProgram.text.split(/\r?\n/)) : null),
    [draftProgram]
  );
  const lineRows = useMemo(() => (structure ? flattenStructureLines(structure) : []), [structure]);
  const bodyGroups = structure?.body.contours ?? [];
  const isPathProject = Boolean(pathDocumentDraft);
  const editorSelectionSummary = selectedPathElement?.segmentId
    ? `Segment ${selectedPathElement.segmentId}`
    : selectedPathOperationId
      ? `Operation ${selectedPathOperationId}`
      : selectedLines.length > 0
        ? `${selectedLines.length} ${selectedLines.length === 1 ? 'line' : 'lines'}`
        : 'None';
  const diagnosticCount = pathDocumentDraft
    ? pathDocumentDraft.diagnostics.length
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
      commands: EDITOR_COMMAND_REGISTRY.commandsForMenu(title).map((command) => {
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
    isEditorMutationLocked,
    pathDocumentDraft,
    pathClickMode,
    selectedPathElement,
    selectedPathOperationId,
    workspacePanelPlacements
  ]);
  const editorRailContent = useMemo(
    () =>
      pathDocumentDraft
        ? {
            collapsed: (
              <EditorCollapsedDockZone
                onExpand={() => setRailCollapsed(false)}
                panelCount={readWorkspaceDockPanelCount('left')}
                registerDockZone={false}
                side="left"
                title="Panel Dock"
              />
            ),
            expanded: renderEditorDockZone('left'),
            replaceRailChrome: true
          }
        : null,
    [
      pathDocumentDraft,
      workspacePanelPlacements,
      workspaceDockOrders
    ]
  );
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
        onBackToDashboard={handleBackToDashboard}
        onExport={
          documentContext === 'machine-program'
              ? handleExportNormalizedISO
              : null
        }
        onImportProgramFile={handleImportProgramFile}
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
      undoStack
    ]
  );

  useEffect(() => {
    const identityChanged = lastProgramIdentityRef.current !== programIdentity;
    lastProgramIdentityRef.current = programIdentity;
    const nextDraft = createEditorDraftState(program);
    setDraftState((current) =>
      editorDraftSignature(current) === savedDraftSignature ? current : nextDraft
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
    setHoveredPathElement(null);
    setExportPreviewOpen(false);
    setActiveWorkflowSession(null);
    setWorkflowTransition(null);
    setPathClickMode(null);
    setCanvasMouseMode('select');
    setRedoStack([]);
    setUndoStack([]);
    clearTransientLineState();
  }, [programIdentity, savedDraftSignature]);

  useEffect(() => {
    setInspectorRailCollapsed(false);
    setProgramLinesOpen(true);

    if (program?.model === 'upid-document') setRailCollapsed(false);
  }, [program?.filePath, program?.model]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      writeEditorWorkspaceLayout({
        schemaVersion: 1,
        placements: workspacePanelPlacements,
        dockOrders: workspaceDockOrders,
        floatingGeometries: workspacePanelGeometries,
        dockWidths: { left: initialWorkspaceLayout.dockWidths.left, right: inspectorRailWidth }
      });
    }, 200);

    return () => window.clearTimeout(timeoutId);
  }, [
    initialWorkspaceLayout.dockWidths.left,
    inspectorRailWidth,
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
    setHeaderContent(editorHeaderContent);
    return () => setHeaderContent(null);
  }, [editorHeaderContent, setHeaderContent]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  function setLastClickedLine(lineNumber: number | null) {
    lastClickedLineRef.current = lineNumber;
  }

  useEffect(() => {
    if (!guideHighlightTarget) return;

    const frame = globalThis.requestAnimationFrame?.(() => {
      const target = document.querySelector(`[data-guide-target="${guideHighlightTarget}"]`);
      if (target instanceof HTMLElement) {
        target.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
      }
    });
    const timeout = window.setTimeout(() => setGuideHighlightTarget(null), 3000);

    return () => {
      if (typeof frame === 'number') globalThis.cancelAnimationFrame?.(frame);
      window.clearTimeout(timeout);
    };
  }, [guideHighlightTarget]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (activeToolSession) {
          const nextSession = editorToolSessionReducer(activeToolSession, { type: 'escape' });
          setActiveToolSession(nextSession.status === 'active' ? nextSession : null);
          if (nextSession.status !== 'active') setPathClickMode(null);
          return;
        }
        setHoveredLine(null);
        setLastClickedLine(null);
        setSelectedLines([]);
        setSelectedPathElement(null);
        setSelectedPathOperationId(null);
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
        setMeasurementPoints([]);
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
  }, [activeToolSession, activeWorkflowSession, draftText, isEditorMutationLocked, measurementPoints.length, pathDocumentDraft, program, redoStack, selectedLines, undoStack]);

  function handleBackToDashboard() {
    if (isEditorMutationLocked) return;
    if (!confirmDiscardUnsavedChanges()) return;
    onBackToDashboard();
  }

  async function handleImportProgramFile(file: File) {
    if (isEditorMutationLocked) return;
    if (!confirmDiscardUnsavedChanges()) return;
    await onImportProgramFile(file);
  }

  function confirmDiscardUnsavedChanges() {
    return !hasUnsavedChanges || window.confirm('Discard unsaved changes?');
  }

  async function handleEditorDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file || isEditorMutationLocked) return;

    await handleImportProgramFile(file);
  }

  function handleInspectorRailResizeStart(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorRailWidth;

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const nextWidth = Math.min(560, Math.max(280, startWidth - (moveEvent.clientX - startX)));
      setInspectorRailWidth(nextWidth);
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
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
            text: draftText
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
        setPathMagneticSnapEnabled(false);
      }
      return !current;
    });
  }

  function handleSelectPathElement(element: EditorPathElementRef) {
    setSelectedPathOperationId(element.operationId);
    setSelectedPathElement(element);
  }

  function handleSelectPathOperation(operationId: string) {
    handleSelectPathElement({
      operationId,
      pathElementId: pathDocumentDraft
        ? upidPathElementIdForOperation(pathDocumentDraft, operationId)
        : null,
      segmentId: null
    });
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
    setPinnedLines((current) => current.filter((line) => !linesToDelete.has(line)));
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
    setPinnedLines((current) => current.filter((line) => !deletedLines.has(line)));
    setSelectedLines([]);
  }

  function handleSetStartHere() {
    if (!program || isEditorMutationLocked) return;
    if (selectedLines.length !== 1) {
      onStatusMessage?.('Select exactly one motion line in the body to set as start.', 'warning');
      return;
    }

    const result = setStartAtLine(draftText, selectedLines[0]);
    if (!result) {
      onStatusMessage?.(
        'Invalid selection: choose a motion line (G0/G1/G2/G3) within the body.',
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
  }

  function handleAddMeasurementPoint() {
    if (pointXDraft.trim() === '' || pointYDraft.trim() === '') return;

    const x = Number(pointXDraft);
    const y = Number(pointYDraft);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    addMeasurementPoint(x, y);
    setPointXDraft('');
    setPointYDraft('');
  }

  function addMeasurementPoint(x: number, y: number) {
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

    if (!pathClickMode || !pathDocumentDraft) {
      if (canvasMouseMode === 'point') addMeasurementPoint(point.x, point.y);
      return;
    }

    if (pathClickMode === 'set-start') {
      if (!selectedPathOperationId) return;

      const edited = pathMagneticSnapEnabled
        ? setClosedOperationStartNearPoint(pathDocumentDraft, selectedPathOperationId, point)
        : setClosedOperationStartAtExistingPointNearPoint(pathDocumentDraft, selectedPathOperationId, point);
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

    const sourcePoint = measurementPoints.at(-1) ?? point;
    const magnetized = constructMagnetizedPoint(pathDocumentDraft, sourcePoint, point, pathClickMode);
    if (!magnetized) {
      setPathClickMode(null);
      return;
    }

    addPathConstructionPoint(magnetized);
    setPathClickMode(null);
  }

  function handleSetPathStartFromElement(element: EditorPathElementRef) {
    if (
      !pathDocumentDraft ||
      !element.operationId ||
      !element.segmentId ||
      !element.pointRole ||
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
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setManualInitialWirePosition(pathDocumentDraft, point);
    if (!edited) {
      onStatusMessage?.('Initial wire coordinates must be finite numbers.', 'warning');
      return;
    }
    applyPathDocumentEdit(edited);
    onStatusMessage?.('Initial Wire Position reviewed and updated.', 'success');
  }

  function handleSetGeometryLinkedInitialWirePosition(segmentId: string) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setGeometryLinkedInitialWirePosition(pathDocumentDraft, segmentId);
    if (!edited) {
      onStatusMessage?.('Choose an available circle center for Initial Wire Position.', 'warning');
      return;
    }
    applyPathDocumentEdit(edited);
    onStatusMessage?.('Initial Wire Position linked to the circle center.', 'success');
  }

  function handleMeasurementPointMove(pointId: string, point: { x: number; y: number }) {
    setMeasurementPoints((current) =>
      current.map((measurementPoint) => {
        if (measurementPoint.id !== pointId) return measurementPoint;
        if (!measurementPoint.pathSnap || !pathDocumentDraft) {
          return { ...measurementPoint, x: point.x, y: point.y };
        }

        const magnetized = slideMagnetizedPointOnSegment(
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

  function handleMovePathOperation(direction: -1 | 1, operationId = selectedPathOperationId ?? undefined) {
    if (!pathDocumentDraft || !operationId || isEditorMutationLocked) return;
    const edited = movePathOperation(pathDocumentDraft, operationId, direction);
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleSetPlannedRapidSourcePoint(
    operationId: string,
    point: { x: number; y: number }
  ) {
    if (!pathDocumentDraft || !operationId || isEditorMutationLocked) return;
    const edited = setPlannedRapidSourcePoint(pathDocumentDraft, operationId, point);
    if (edited) applyPathDocumentEdit(edited, { selectedPathElement, selectedPathOperationId: operationId });
  }

  function handleSetPlannedRapidDestinationPoint(
    operationId: string,
    point: { x: number; y: number }
  ) {
    if (!pathDocumentDraft || !operationId || isEditorMutationLocked) return;
    const edited = setPlannedRapidDestinationPoint(pathDocumentDraft, operationId, point);
    if (edited) applyPathDocumentEdit(edited, { selectedPathElement, selectedPathOperationId: operationId });
  }

  function handleReversePathOperation(operationId: string) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = reversePathOperation(pathDocumentDraft, operationId);
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleSetPathOperationClassification(
    operationId: string,
    classification: ContourClassification
  ) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationClassification(
      pathDocumentDraft,
      operationId,
      classification,
      program?.project?.machine
    );
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleSetGeometryBasis(basis: PathPlanningDocument['geometryBasis']) {
    if (!pathDocumentDraft || !program?.project || isEditorMutationLocked) return;
    if (basis === pathDocumentDraft.geometryBasis) return;

    const edited = basis === 'finished-contour' && machineSnapshotAuthorizesAutomaticCompensation(program.project.machine)
      ? initializeProjectCompensationIntents(pathDocumentDraft, program.project.machine)
      : { ...structuredClone(pathDocumentDraft), geometryBasis: basis };
    applyPathDocumentEdit(edited);
  }

  function handleSetManualCompensation(
    operationId: string,
    selection: ManualCompensationSelection
  ) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setManualCompensationIntent(pathDocumentDraft, operationId, selection);
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleSetOperationCircleCenterEntry(operationId: string) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setCircleOperationCenterPierceLeadIn(pathDocumentDraft, operationId);
    if (!edited) {
      onStatusMessage?.('Circle-center entry requires one closed circular operation.', 'warning');
      return;
    }
    applyPathDocumentEdit(edited, { selectedPathElement, selectedPathOperationId: operationId });
  }

  function handleSetOperationManualEntry(operationId: string, point: { x: number; y: number }) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationManualLeadIn(pathDocumentDraft, operationId, point);
    if (edited) {
      applyPathDocumentEdit(edited, { selectedPathElement, selectedPathOperationId: operationId });
    }
  }

  function handleSetOperationManualExit(operationId: string, point: { x: number; y: number }) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const operation = pathDocumentDraft.plan.operations.find(
      (candidate) => candidate.id === operationId
    );
    if (!operation) return;
    const edited = setPathOperationTransitions(pathDocumentDraft, operationId, {
      ...normalizeLegacyOperationTransitions(operation),
      exit: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { ...operation.endPoint },
        to: point,
        review: 'reviewed'
      }
    });
    if (edited) {
      applyPathDocumentEdit(edited, { selectedPathElement, selectedPathOperationId: operationId });
    }
  }

  function handleSetProjectThreading(
    transition: Omit<OperationThreadingTransition, 'source'>
  ) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setProjectThreadingDefault(pathDocumentDraft, transition);
    if (edited) applyPathDocumentEdit(edited);
  }

  function handleSetOperationThreading(
    operationId: string,
    transition: Omit<OperationThreadingTransition, 'source'> | null
  ) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationThreadingTransition(
      pathDocumentDraft,
      operationId,
      transition
    );
    if (edited) {
      applyPathDocumentEdit(edited, { selectedPathElement, selectedPathOperationId: operationId });
    }
  }

  function handleSetOperationProgramStops(
    operationId: string,
    stops: OperationProgramStop[]
  ) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationProgramStops(pathDocumentDraft, operationId, stops);
    if (edited) {
      applyPathDocumentEdit(edited, { selectedPathElement, selectedPathOperationId: operationId });
    }
  }

  function handleSetMachiningSpan(input: Parameters<typeof setMachiningSpanParticipation>[1]) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setMachiningSpanParticipation(pathDocumentDraft, input);
    if (edited) {
      applyPathDocumentEdit(edited, { selectedPathElement, selectedPathOperationId });
    }
  }

  function handleSetPartialContourCompensationSide(
    sourceOperationId: string,
    wireSide: 'left' | 'right' | null
  ) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
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
    if (!pathDocumentDraft || isEditorMutationLocked) return;
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

  function handleSetPathOperationOrderStrategy(strategy: OperationOrderStrategy) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;
    const edited = setPathOperationOrderStrategy(pathDocumentDraft, strategy);
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleTranslatePathSelection(delta: { x: number; y: number }) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;

    const edited = selectedPathElement?.segmentId
      ? translatePathSegment(pathDocumentDraft, selectedPathElement.segmentId, delta)
      : selectedPathElement?.pathElementId
        ? translatePathElement(pathDocumentDraft, selectedPathElement.pathElementId, delta)
        : selectedPathOperationId
          ? translatePathOperation(pathDocumentDraft, selectedPathOperationId, delta)
          : null;

    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleTranslatePathDocument(delta: { x: number; y: number }) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;

    const edited = translatePathDocument(pathDocumentDraft, delta);
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleRotatePathSelection(angleDegrees: number) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;

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

    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleMirrorPathSelection(axis: PathMirrorAxis) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;

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

    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleRotatePathDocument(angleDegrees: number) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;

    const origin = readPathDocumentBoundsCenter(pathDocumentDraft);
    if (!origin) return;

    const edited = rotatePathDocument(pathDocumentDraft, angleDegrees, origin);
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleMirrorPathDocument(axis: PathMirrorAxis) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;

    const origin = readPathDocumentBoundsCenter(pathDocumentDraft);
    if (!origin) return;

    const edited = mirrorPathDocument(pathDocumentDraft, axis, origin);
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleMovePathSelectionCenter(targetCenter: { x: number; y: number }) {
    if (!pathDocumentDraft || isEditorMutationLocked) return;

    const selectionCenter = readPathSelectionBoundsCenter(
      pathDocumentDraft,
      selectedPathElement,
      selectedPathOperationId
    );
    if (!selectionCenter) return;

    handleTranslatePathSelection({
      x: targetCenter.x - selectionCenter.x,
      y: targetCenter.y - selectionCenter.y
    });
  }

  function handleDragPathElement(element: EditorPathElementRef, delta: { x: number; y: number }) {
    if (!pathDocumentDraft || isEditorMutationLocked || (delta.x === 0 && delta.y === 0)) return;

    const dragTarget = resolvePathDragTarget(selectedPathElement, element);
    const edited =
      dragTarget.segmentId
        ? translatePathSegment(pathDocumentDraft, dragTarget.segmentId, delta)
        : dragTarget.pathElementId
          ? translatePathElement(pathDocumentDraft, dragTarget.pathElementId, delta)
          : dragTarget.operationId
            ? translatePathOperation(pathDocumentDraft, dragTarget.operationId, delta)
            : null;

    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement: dragTarget,
        selectedPathOperationId: dragTarget.operationId
      });
    }
  }

  function handleMoveSelectedSegmentCenter(targetCenter: { x: number; y: number }) {
    if (!pathDocumentDraft || !selectedPathElement?.segmentId || isEditorMutationLocked) return;

    const edited = movePathSegmentCenterTo(pathDocumentDraft, selectedPathElement.segmentId, targetCenter);
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleMovePathSegmentCenter(
    element: EditorPathElementRef,
    targetCenter: { x: number; y: number }
  ) {
    if (!pathDocumentDraft || !element.segmentId || isEditorMutationLocked) return;

    const edited = movePathSegmentCenterTo(pathDocumentDraft, element.segmentId, targetCenter);
    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement: {
          operationId: element.operationId,
          pathElementId: element.pathElementId ?? null,
          segmentId: element.segmentId
        },
        selectedPathOperationId: element.operationId
      });
    }
  }

  function applyPathDocumentEdit(
    nextDocument: PathPlanningDocument,
    options: {
      selectedPathElement?: EditorPathElementRef | null;
      selectedPathOperationId?: string | null;
    } = {}
  ) {
    if (!program?.project) return;

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
      insertAfterLine: selectedLines.length > 0 ? Math.min(...selectedLines) : undefined
    });
    replaceGCodeDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines(result.insertedLineNumbers);
  }

  function handleExportMeasurementPoints(format: 'csv' | 'gcode' | 'iso') {
    if (measurementPoints.length === 0) return;

    const dateStamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      onDownloadEditorFile(
        `measurement-points-${dateStamp}.csv`,
        exportMeasurementPointsAsCsv(measurementPoints)
      );
      return;
    }

    if (format === 'iso') {
      onDownloadEditorFile(
        `measurement-points-${dateStamp}.iso`,
        exportMeasurementPointsAsISO(measurementPoints)
      );
      return;
    }

    onDownloadEditorFile(
      `measurement-points-${dateStamp}.gcode`,
      exportMeasurementPointsAsGCode(measurementPoints)
    );
  }

  function replaceGCodeDraftText(nextText: string) {
    if (draftState.model !== 'gcode-text' || nextText === draftState.text) return;
    applyEditorDraftState({
      model: 'gcode-text',
      text: nextText
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
    const nextSelectedPathOperationId = nextPathDocument
      ? options.selectedPathOperationId ?? selectedPathOperationId
      : null;
    const candidateSelectedPathElement = Object.hasOwn(options, 'selectedPathElement')
      ? options.selectedPathElement ?? null
      : selectedPathElement;
    const nextSelectedPathElement = nextPathDocument
      ? normalizeUpidPathElementSelection(
          nextPathDocument,
          nextSelectedPathOperationId,
          candidateSelectedPathElement
        )
      : null;

    if (activeWorkflowSession?.kind === 'mutating') {
      setActiveWorkflowSession((current) =>
        current?.kind === 'mutating' ? markEditorWorkflowDirty(current) : current
      );
    } else {
      setUndoStack((current) => [...current, currentDraftSnapshot()]);
      setRedoStack([]);
    }
    setDraftState(clonedDraft);
    setSelectedPathOperationId(nextSelectedPathOperationId);
    setSelectedPathElement(nextSelectedPathElement);
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
      text: nextText
    });
    setSelectedPathOperationId(null);
    setSelectedPathElement(null);
    setPathClickMode(null);
  }

  function currentDraftSnapshot(historyLabel?: string): EditorDraftSnapshot {
    return {
      draft: cloneEditorDraftState(draftState),
      historyLabel,
      selectedPathElement,
      selectedPathOperationId
    };
  }

  function restoreDraftSnapshot(snapshot: EditorDraftSnapshot) {
    const restoredDraft = cloneEditorDraftState(snapshot.draft);
    const restoredPathDocument = editorDraftPathDocument(restoredDraft);
    setDraftState(restoredDraft);
    const restoredOperationId = restoredPathDocument ? snapshot.selectedPathOperationId : null;
    setSelectedPathOperationId(restoredOperationId);
    setSelectedPathElement(
      restoredPathDocument && (snapshot.selectedPathElement || restoredOperationId)
        ? normalizeUpidPathElementSelection(
            restoredPathDocument,
            restoredOperationId,
            snapshot.selectedPathElement
          )
        : null
    );
    setPathClickMode(null);
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
    if (!pathDocumentDraft) {
      return program
        ? 'Select program rows to inspect, edit, move, or pin geometry in the preview.'
        : 'Import a program or DXF file to begin.';
    }

    if (pathClickMode === 'set-start') {
      if (!selectedPathOperationId) {
        return 'Start mode / Step 1: select a closed contour in the Contour Tree or canvas before choosing the start point.';
      }

      return pathMagneticSnapEnabled
        ? 'Start mode / Step 2: click the contour near the desired start. Magnetic mode can split a segment at the clicked point.'
        : 'Start mode / Step 2: click an existing endpoint on the canvas or in the Contour Tree.';
    }

    if (pathClickMode === 'perpendicular' || pathClickMode === 'tangent') {
      const relation = pathClickMode === 'perpendicular' ? 'Perpendicular' : 'Tangent';
      if (measurementPoints.length === 0) {
        return `${relation} mode / Step 1: add a measurement point first; it becomes the source point for the construction.`;
      }

      return `${relation} mode / Step 2: select the target contour or segment to add the construction point from the latest measurement point.`;
    }

    if (selectedPathElement) {
      return 'Selection active / Next: drag selected geometry on the canvas, or use Transform for exact moves. Move Center to Origin sends the selection center to X0 Y0.';
    }

    if (canvasMouseMode === 'point') {
      return 'Point mode / Step 1: click empty canvas space to place measurement points. Switch to Select to inspect geometry.';
    }

    return 'Select mode / Next: click a contour, segment, endpoint, or diagnostic. Use Point mode to place measurement points.';
  }

  function openEditorWorkflow(commandId: string) {
    const command = EDITOR_COMMAND_REGISTRY.get(commandId);
    if (!command?.toolWindowId || !command.workflow) return;

    if (activeWorkflowSession?.commandId === commandId) {
      focusWorkspacePanel(command.toolWindowId as EditorWorkspacePanelId);
      return;
    }

    if (activeWorkflowSession) {
      const transition = requestEditorWorkflowTransition(activeWorkflowSession, {
        commandId,
        kind: 'open'
      });
      if (transition.kind === 'held') {
        setWorkflowTransition(transition);
        return;
      }
      if (transition.kind === 'resolved') completeEditorWorkflowTransition(transition);
      return;
    }

    activateEditorWorkflow(command);
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
      setWorkflowTransition(null);
      onStatusMessage?.(availability.reason, 'warning');
      return;
    }
    const panelId = command.toolWindowId as EditorWorkspacePanelId;
    const session = command.workflow.kind === 'mutating'
      ? createEditorWorkflowSession({
          commandId: command.id,
          historyLabel: command.historyLabel!,
          kind: 'mutating' as const,
          label: command.label,
          openingSnapshot,
          panelId,
          saveAvailability: { enabled: true as const }
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
    setWorkflowTransition(null);
    setExportPreviewOpen(command.id === 'export.preview');
    if (command.id === SET_START_COMMAND.id) {
      const openingDocument = editorDraftPathDocument(openingSnapshot.draft);
      const operationId = openingDocument?.plan.operations.find(
        (operation) => operation.id === openingSnapshot.selectedPathOperationId && operation.closed
      )?.id ?? openingDocument?.plan.operations.find((operation) => operation.closed)?.id ?? null;
      if (operationId) {
        setSelectedPathOperationId(operationId);
        setSelectedPathElement(null);
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
    }
    window.requestAnimationFrame(() => focusWorkspacePanel(panelId));
  }

  function requestCloseEditorWorkflow() {
    if (!activeWorkflowSession) return;
    const transition = requestEditorWorkflowTransition(activeWorkflowSession, { kind: 'close' });
    if (transition.kind === 'held') {
      setWorkflowTransition(transition);
      return;
    }
    if (transition.kind === 'resolved') completeEditorWorkflowTransition(transition);
  }

  function dismissWorkflowTransition() {
    if (!workflowTransition) return;
    dismissEditorWorkflowTransition(workflowTransition);
    setWorkflowTransition(null);
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
      setUndoStack((current) => [
        ...current,
        { ...session.openingSnapshot, historyLabel: session.historyLabel }
      ]);
      setRedoStack([]);
    } else if (resolution === 'discard') {
      restoreDraftSnapshot(session.openingSnapshot);
    }

    setActiveToolSession(null);
    setPathClickMode(null);
    setWorkflowTransition(null);
    setExportPreviewOpen(false);
    if (request.kind === 'close') {
      setActiveWorkflowSession(null);
      return;
    }

    const nextCommand = EDITOR_COMMAND_REGISTRY.get(request.commandId);
    if (!nextCommand) {
      setActiveWorkflowSession(null);
      return;
    }
    activateEditorWorkflow(nextCommand, nextOpeningSnapshot);
  }

  function readWorkspacePanelRenderedPlacement(panelId: EditorWorkspacePanelId) {
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
    options: { fill?: boolean } = {}
  ) {
    const panelId = id as EditorWorkspacePanelId;
    const renderedPlacement = readWorkspacePanelRenderedPlacement(panelId);

    if (renderedPlacement === 'hidden') {
      return (
        <div aria-hidden="true" className="hidden" data-editor-inactive-workflow-panel={id}>
          {children}
        </div>
      );
    }

    return (
      <EditorWorkspacePanelFrame
        dockOrder={readWorkspacePanelDockOrder(panelId)}
        fill={options.fill}
        geometry={workspacePanelGeometries[panelId]}
        id={id}
        onDock={(side) => dockWorkspacePanel(panelId, side)}
        onDragEnd={(point) => handleWorkspacePanelDragEnd(panelId, point)}
        onFloat={() => floatWorkspacePanel(panelId)}
        onFloatFromDock={(point) => floatWorkspacePanelFromDock(panelId, point)}
        onGeometryChange={(geometry) => setWorkspacePanelGeometry(panelId, geometry)}
        onHide={requestCloseEditorWorkflow}
        placement={renderedPlacement}
        title={title}
      >
        {children}
      </EditorWorkspacePanelFrame>
    );
  }

  function renderPathNavigatorPanel(pathDocument: PathPlanningDocument) {
    return (
      <EditorPathNavigatorPanel
        expandedPathElementIds={expandedPathElementIds}
        hoveredPathElement={activeHoveredPathElement}
        hoverAssistEnabled={pathHoverAssistEnabled}
        isSaving={isEditorMutationLocked}
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
        onOpenWorkspacePanels={showWorkspacePanels}
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
        renderWorkspacePanel={renderWorkspacePanel}
        selectedPathElement={selectedPathElement}
        selectedPathOperationId={selectedPathOperationId}
        onPathTranslateXDraftChange={setPathTranslateXDraft}
        onPathTranslateYDraftChange={setPathTranslateYDraft}
      />
    );
  }

  function handleActivatePathClickMode(mode: MagnetizeMode | null) {
    if (mode === null) {
      setPathClickMode((current) => current === 'set-start' ? current : null);
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
  }

  function handleSetStartOperationTarget(operationId: string) {
    if (isEditorMutationLocked) return;
    setSelectedPathOperationId(operationId);
    setSelectedPathElement(null);
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

  function renderInspectorPanelContent() {
    return (
      <div
        className={`min-h-0 overflow-hidden ${
          isPathProject ? '' : 'grid lg:grid-rows-[minmax(0,1fr)_auto]'
        }`}
      >
        {!pathDocumentDraft && (
          <div
            className="grid min-h-0 gap-2 overflow-hidden p-2 lg:grid-rows-[minmax(260px,1fr)_auto]"
            data-editor-side-code-panel
          >
            <EditorProgramLinesPanel
              bodyGroups={bodyGroups}
              draftText={draftText}
              guideHighlightTarget={guideHighlightTarget}
              hasUnsavedChanges={hasUnsavedChanges}
              isGroupExpanded={isGroupExpanded}
              isSaving={isEditorMutationLocked}
              lineMode={lineMode}
              lineRows={lineRows}
              onClearPins={() => setPinnedLines([])}
              onClearSelectedLines={clearSelectedLines}
              onDeleteGroup={handleDeleteGroup}
              onDeleteSelectedLines={handleDeleteSelectedLines}
              onExportNormalizedISO={handleExportNormalizedISO}
              onHoverLineChange={setHoveredLine}
              onLineClick={handleLineClick}
              onLineEditCommit={handleLineEditCommit}
              onMoveGroup={handleMoveGroup}
              onMoveSelectedLines={handleMoveSelectedLines}
              onNormalizeDraft={handleNormalizeDraft}
              onRedoDraft={handleRedoDraft}
              onSaveClick={handleSaveClick}
              onSetLineMode={handleSetLineMode}
              onSetStartHere={handleSetStartHere}
              onToggleGroup={handleToggleGroup}
              onTogglePin={handleTogglePin}
              onToggleProgramLinesOpen={() => setProgramLinesOpen((current) => !current)}
              onUndoDraft={handleUndoDraft}
              pinnedLines={pinnedLines}
              program={program}
              programLinesOpen={programLinesOpen}
              redoAvailable={redoStack.length > 0}
              selectedLines={selectedLines}
              structure={structure}
              undoAvailable={undoStack.length > 0}
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
          machineProfile={program?.project?.machine ?? null}
          canReimportDxfUnits={Boolean(pathDocumentDraft && onReimportDxfUnits && !hasUnsavedChanges)}
          reimportDxfUnitsDisabledReason={
            hasUnsavedChanges ? 'Save or undo path changes before re-importing DXF units.' : null
          }
          onAddMeasurementPoint={handleAddMeasurementPoint}
          onActivatePathConstructionMode={(mode) => handleActivatePathClickMode(mode)}
          onClearMeasurementPoints={() => setMeasurementPoints([])}
          onDeleteMeasurementPoint={(pointId) =>
            setMeasurementPoints((current) =>
              current.filter((measurementPoint) => measurementPoint.id !== pointId)
            )
          }
          onExportMeasurementPoints={handleExportMeasurementPoints}
          onHoverPathElement={setHoveredPathElement}
          onInsertMeasurementPoints={handleInsertMeasurementPoints}
          onReimportDxfUnits={onReimportDxfUnits}
          onPointXDraftChange={setPointXDraft}
          onPointYDraftChange={setPointYDraft}
          onSelectPathElement={handleSelectPathElement}
          onSetCanvasMouseMode={setCanvasMouseMode}
          onToggleGridSnap={() => setGridSnapEnabled((current) => !current)}
          onTogglePathMagneticSnap={() => setPathMagneticSnapEnabled((current) => !current)}
          pathCount={pathCount}
          pathConstructionMode={pathClickMode === 'set-start' ? null : pathClickMode}
          pathDocument={pathDocumentDraft}
          pathMagneticSnapEnabled={pathMagneticSnapEnabled}
          pointXDraft={pointXDraft}
          pointYDraft={pointYDraft}
          previewCursorPoint={previewCursorPoint}
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
        collapsed={side === 'right' ? inspectorRailCollapsed : false}
        panelCount={readWorkspaceDockPanelCount(side)}
        side={side}
        title={side === 'left' ? 'Panel Dock' : 'Inspector Dock'}
        onDropPanel={(panelId, dockSide, point) =>
          dockWorkspacePanel(panelId as EditorWorkspacePanelId, dockSide, point)
        }
        onToggleCollapsed={
          side === 'right'
            ? () => setInspectorRailCollapsed((current) => !current)
            : () => setRailCollapsed(true)
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
    for (const side of ['left', 'right'] as const) {
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
    if (side === 'left') setRailCollapsed(false);
    else setInspectorRailCollapsed(false);
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

  function showWorkspacePanel(panelId: EditorWorkspacePanelId) {
    openEditorWorkflowForPanel(panelId);
  }

  function showWorkspacePanels(panelIds: EditorWorkspacePanelId[]) {
    const panelId = panelIds.at(-1);
    if (panelId) openEditorWorkflowForPanel(panelId);
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-editor-drop-zone="true"
      data-editor-layout="canvas-first"
      onDragOver={handleEditorDragOver}
      onDrop={handleEditorDrop}
    >
      <EditorGuideDialog
        language={guideLanguage}
        onClose={() => setGuideOpen(false)}
        onHighlight={handleGuideHighlight}
        onLanguageChange={handleGuideLanguageChange}
        open={guideOpen}
      />
      {activeWorkflowSession && (
        <EditorWorkflowTransitionDialog
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
        />
      )}
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
        {pathDocumentDraft && program?.project &&
          renderWorkspacePanel(
            'contour-setup',
            'Contour Setup',
            <EditorContourSetupPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              machine={program.project.machine}
              onReverse={handleReversePathOperation}
              onSelectOperation={(operationId) => {
                setSelectedPathOperationId(operationId);
                setSelectedPathElement(null);
              }}
              onSetClassification={handleSetPathOperationClassification}
              onSetCompensation={handleSetManualCompensation}
              selectedOperationId={selectedPathOperationId}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'set-start',
            'Set Start',
            <EditorSetStartPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              magneticSnapEnabled={pathMagneticSnapEnabled}
              onPickStart={handleSetStartOperationTarget}
              onSelectOperation={handleSetStartOperationTarget}
              onToggleMagneticSnap={() => setPathMagneticSnapEnabled((current) => !current)}
              selectedOperationId={selectedPathOperationId}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'initial-wire-position',
            'Initial Wire Position',
            <EditorInitialWirePositionPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              onSetGeometryLinked={handleSetGeometryLinkedInitialWirePosition}
              onSetManual={handleSetManualInitialWirePosition}
            />
          )}
        {pathDocumentDraft && program?.project &&
          renderWorkspacePanel(
            'entry-exit',
            'Entry / Exit & Rethreading',
            <EditorEntryExitPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              machine={program.project.machine}
              onSelectOperation={(operationId) => {
                setSelectedPathOperationId(operationId);
                setSelectedPathElement(null);
              }}
              onSetCircleCenterEntry={handleSetOperationCircleCenterEntry}
              onSetManualEntry={handleSetOperationManualEntry}
              onSetManualExit={handleSetOperationManualExit}
              onSetPlannedRapidDestination={handleSetPlannedRapidDestinationPoint}
              onSetPlannedRapidSource={handleSetPlannedRapidSourcePoint}
              onSetOperationThreading={handleSetOperationThreading}
              onSetProjectThreading={handleSetProjectThreading}
              selectedOperationId={selectedPathOperationId}
            />
          )}
        {pathDocumentDraft &&
          renderWorkspacePanel(
            'machining-participation',
            'Machining Participation',
            <EditorMachiningParticipationPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              onSetEntryReview={handleSetPartialContourEntryReview}
              onSetSpan={handleSetMachiningSpan}
              onSetWireSide={handleSetPartialContourCompensationSide}
              selectedOperationId={selectedPathOperationId}
              selectedSegmentId={selectedPathElement?.segmentId ?? null}
            />
          )}
        {pathDocumentDraft && program?.project &&
          renderWorkspacePanel(
            'program-stops',
            'Program Stops',
            <EditorProgramStopsPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              machine={program.project.machine}
              onSetStops={handleSetOperationProgramStops}
              selectedOperationId={selectedPathOperationId}
            />
          )}
        {isPathProject && renderInspectorPanelContent()}
      </div>
      <section
        className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(360px,1fr)_minmax(320px,45vh)] gap-y-2 overflow-hidden p-2 lg:grid-rows-[minmax(0,1fr)]"
        data-editor-main-grid
        data-inspector-collapsed={inspectorRailCollapsed ? 'true' : 'false'}
        style={{ '--editor-inspector-width': `${inspectorRailWidth}px` } as CSSProperties}
      >
        <EditorCanvasPanel
          canvasMouseMode={canvasMouseMode}
          constructionPreview={constructionPreview}
          draftProgram={draftProgram}
          gridSnapEnabled={gridSnapEnabled}
          guideHighlightTarget={guideHighlightTarget}
          guideOpen={guideOpen}
          hoveredLine={hoveredLine}
          interactionHint={editorInteractionHint}
          hoveredPathElement={activeHoveredPathElement}
          measurementPoints={measurementPoints}
          onCursorPointChange={setPreviewCursorPoint}
          onMeasurementPointMove={handleMeasurementPointMove}
          onPathEndpointClick={pathClickMode === 'set-start' ? handleSetPathStartFromElement : undefined}
          onPathElementDrag={!pathClickMode ? handleDragPathElement : undefined}
          onPathElementClick={!pathClickMode ? handleSelectPathElement : undefined}
          onPathElementHover={pathHoverAssistEnabled ? setHoveredPathElement : undefined}
          onPathSegmentCenterMove={!pathClickMode ? handleMovePathSegmentCenter : undefined}
          onPreviewPointClick={handlePreviewPointClick}
          onSetCanvasMouseMode={setCanvasMouseMode}
          pathDocument={pathDocumentDraft}
          postedTransitions={postedPreviewTransitions}
          pathCount={pathCount}
          pinnedLines={pinnedLines}
          selectedPathElement={selectedPathElement}
          selectedLines={selectedLines}
          startPreview={startPreview}
        />

        {isPathProject ? (
          <>
            {!inspectorRailCollapsed && (
              <div
                aria-label="Resize Inspector Dock"
                className="hidden cursor-col-resize bg-border/30 transition hover:bg-primary/40 lg:block"
                data-editor-inspector-resizer
                onPointerDown={handleInspectorRailResizeStart}
                role="separator"
              />
            )}
            {renderEditorDockZone('right')}
          </>
        ) : inspectorRailCollapsed ? (
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
            <div
              aria-label="Resize Inspector Rail"
              className="hidden cursor-col-resize bg-border/30 transition hover:bg-primary/40 lg:block"
              data-editor-inspector-resizer
              onPointerDown={handleInspectorRailResizeStart}
              role="separator"
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
        contourCount={pathDocumentDraft?.contours.length ?? null}
        documentContext={documentContext}
        diagnosticCount={diagnosticCount}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={isSaving}
        machineFitStatus={machineFit?.status ?? null}
        machineProfileName={program?.project?.machine.name ?? null}
        moveCount={pathCount}
        operationCount={pathDocumentDraft?.plan.operations.length ?? null}
        programLineCount={draftParseResult?.stats.totalLines ?? null}
        previewCursorPoint={previewCursorPoint}
        segmentCount={pathDocumentDraft?.segments.length ?? null}
        selectionSummary={editorSelectionSummary}
        unitSummary={dxfUnitSummary}
      />
      {exportPreviewOpen && upidExport && (
        <EditorUpidExportPreview
          blockingDiagnostics={upidExport.blockingDiagnostics}
          canDownload={upidExport.canDownload}
          fileName={upidExport.fileName}
          diagnostics={upidExport.diagnostics}
          documentTrace={upidExport.documentTrace}
          machineName={upidExport.machineName}
          onClose={() => {
            if (activeWorkflowSession?.commandId === 'export.preview') {
              requestCloseEditorWorkflow();
            } else {
              setExportPreviewOpen(false);
            }
          }}
          onDownload={() => {
            if (!upidExport.canDownload || upidExport.blockingDiagnostics.length > 0) return;
            onDownloadEditorFile(upidExport.fileName, upidExport.programText);
          }}
          onHoverPathElement={setHoveredPathElement}
          onSelectPathElement={handleSelectPathElement}
          operationCount={upidExport.operationCount}
          pathDocument={upidExport.pathDocument}
          planning={upidExport.planning}
          postMetrics={upidExport.postMetrics}
          postedOperations={upidExport.postedOperations}
          programBlocks={upidExport.programBlocks}
          programLines={upidExport.programLines}
        />
      )}
    </div>
  );
}

function nextMeasurementPointId(currentLength: number) {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${currentLength}`;
}

function formatCoordinateDraft(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatUnitScale(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}
