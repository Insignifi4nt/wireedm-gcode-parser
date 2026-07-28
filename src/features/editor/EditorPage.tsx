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
import { deriveUpidMachinePreviewTransitions } from '@/domain/editor/previewGeometry';
import {
  initializeProjectCompensationIntents,
  machineSnapshotAuthorizesAutomaticCompensation,
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
import { resolveSourceOperationTransitionOwnership } from '@/domain/path-intel/operationTransitionOwnership';
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
  setPartialContourCompensationSide
} from '@/domain/path-intel/machiningParticipation';
import {
  normalizeUpidPathElementSelection,
  summarizeUpidPathDocumentForEditor,
  upidPathElementIdForOperation
} from '@/domain/upid/projectRail';
import {
  buildUpidProgramTree,
  type UpidProgramTree,
  type UpidProgramTreeEditTarget,
  type UpidProgramTreeNode
} from '@/domain/upid/upidProgramTree';
import { composeProjectUpidGCodeExport } from '@/domain/upid/projectUpid';
import type { MachineProfile, WorkbenchProject } from '@/domain/workbench/types';
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
import { EditorProjectMachinePanel } from './EditorProjectMachinePanel';
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
import { EditorProgramTree } from './EditorProgramTree';
import { EditorProgramTextPanel } from './EditorProgramTextPanel';
import { EditorStatusBar } from './EditorStatusBar';
import { EditorUpidExportPreview } from './EditorUpidExportPreview';
import {
  clampEditorFloatingPanelGeometry,
  EDITOR_FLOATING_PANEL_GAP,
  EDITOR_FLOATING_PANEL_TOP,
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
  editorProjectDraftSignature,
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
  canvasMouseMode: 'select' | 'point';
  draft: EditorDraftState;
  historyLabel?: string;
  gridSnapEnabled: boolean;
  machineProfile: MachineProfile | null;
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

const SET_START_COMMAND: EditorCommandDefinition = {
  id: 'machining.set-start',
  label: 'Contour Start',
  menuPath: ['Machining', 'Contour Start'],
  scope: 'operation',
  toolWindowId: 'set-start',
  historyLabel: 'Set operation start',
  prerequisites: [{ kind: 'document' }, { kind: 'interaction-unlocked' }],
  session: { kind: 'set-start' },
  workflow: { kind: 'mutating' }
};

const REBASE_MACHINE_WORKFLOW_REVIEW_REASON =
  'Project machine settings changed upstream. Review and verify this machine draft again before saving.';

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
  | 'between-contours'
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
  'set-start': 'Contour Start',
  'path-transform': 'Transform',
  'endpoint-topology': 'Endpoint Topology',
  'path-diagnostics': 'Path Diagnostics',
  'cut-sequence': 'Cut Sequence',
  'contour-tree': 'Contour Tree',
  'initial-wire-position': 'Program Start / G92',
  'entry-exit': 'Entry / Exit',
  'between-contours': 'Between Contours',
  'program-stops': 'Program Stops',
  'machining-participation': 'Machining Participation',
  position: 'Position',
  statistics: 'Statistics',
  machine: 'Project Machine & Source Setup',
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
  'initial-wire-position': 'reviewed project G92 coordinates and first connection origin',
  'entry-exit': 'per-operation cutting entry and exit geometry',
  'between-contours': 'derived rapid travel and manual or automatic rethread policy',
  'program-stops': 'typed unconditional M00 events at operation boundaries or remaining cut distance',
  'machining-participation': 'source-preserving active cuts, inactive reference spans, and explicit open-path compensation side',
  position: 'cursor position and grid snap state',
  statistics: 'bounds, move counts, and selected geometry details',
  machine: 'project machine profile, source units, and machine fit checks',
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
  'between-contours',
  'machining-participation',
  'program-stops'
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
  'between-contours': { x: 670, y: 145, width: 390, height: 520 },
  'program-stops': { x: 680, y: 150, width: 370, height: 560 },
  'machining-participation': { x: 710, y: 170, width: 390, height: 600 },
  position: { x: 1020, y: 74, width: 300, height: 180 },
  statistics: { x: 990, y: 104, width: 360, height: 560 },
  machine: { x: 1040, y: 134, width: 320, height: 520 },
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
    ['machining.initial-wire', 'Program Start / G92', 'initial-wire-position'],
    ['machining.entry-exit', 'Entry / Exit', 'entry-exit'],
    ['machining.between-contours', 'Between Contours', 'between-contours'],
    ['machining.participation', 'Machining Participation', 'machining-participation'],
    ['machining.program-stops', 'Program Stops', 'program-stops']
  ] as const).map(([id, label, toolWindowId]) => ({
    id, label, menuPath: ['Machining', label] as const, scope: 'document' as const,
    toolWindowId, historyLabel: `Edit ${label}`, prerequisites: [{ kind: 'document' } as const],
    workflow: { kind: 'mutating' as const }
  })),
  {
    id: 'construction.measurement', label: 'Measurement & Construction',
    menuPath: ['Construction', 'Measurement & Construction'], scope: 'document',
    toolWindowId: 'measurement', historyLabel: 'Edit measurement and construction points',
    prerequisites: [{ kind: 'document' }], workflow: { kind: 'mutating' }
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
    id: 'machine.profile', label: 'Project Machine & Source Setup',
    menuPath: ['Machine', 'Project Machine & Source Setup'],
    scope: 'machine', toolWindowId: 'machine', historyLabel: 'Edit project machine setup',
    prerequisites: [{ kind: 'document' }, { kind: 'interaction-unlocked' }],
    workflow: { kind: 'mutating' }
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
    upidRailCollapsed: false,
    placements: createDefaultWorkspacePanelPlacements(model),
    dockOrders: createDefaultWorkspaceDockOrders(model),
    floatingGeometries: { ...DEFAULT_WORKSPACE_PANEL_GEOMETRY },
    dockWidths: { left: window.innerWidth >= 1280 ? 260 : 220, right: 420 }
  };
}

function readInitialWorkspaceLayout(model: LoadedEditorProgram['model'] | undefined) {
  return readEditorWorkspaceLayout(createDefaultWorkspaceLayout(model), {
    width: window.innerWidth,
    height: window.innerHeight
  });
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
  const { closeCompactDrawerWithRailFocus, compactDrawer, compactModalHost, compactTransitionOverlay, isCompactViewport, isMiddleViewport, setCompactDrawer, setCompactTransitionOverlay, setHeaderContent, setRailContent } = useAppRail();
  const [initialWorkspaceLayout] = useState(() => readInitialWorkspaceLayout(program?.model));
  const [draftState, setDraftState] = useState<EditorDraftState>(() => createEditorDraftState(program));
  const [machineProfileDraft, setMachineProfileDraft] = useState<MachineProfile | null>(
    () => program?.project?.machine ? structuredClone(program.project.machine) : null
  );
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
  const pathDocumentDraft = editorDraftPathDocument(draftState);
  const draftProject = useMemo<WorkbenchProject | null>(
    () =>
      program?.project && machineProfileDraft
        ? {
            ...program.project,
            machine: machineProfileDraft
          }
        : program?.project ?? null,
    [machineProfileDraft, program?.project]
  );
  const programTree = useMemo(
    () => pathDocumentDraft && draftProject
      ? buildUpidProgramTree(pathDocumentDraft, draftProject.machine)
      : null,
    [draftProject, pathDocumentDraft]
  );
  const savedDraftSignature = useMemo(
    () => editorProjectDraftSignature(
      createEditorDraftState(program),
      program?.project?.machine ?? null
    ),
    [program]
  );
  const programIdentity = program ? `${program.model}:${program.filePath}` : 'empty';
  const lastProgramIdentityRef = useRef(programIdentity);
  const draftSignature = useMemo(
    () => editorProjectDraftSignature(draftState, machineProfileDraft),
    [draftState, machineProfileDraft]
  );
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
      draftProject
        ? evaluateMachineFit({
            document: pathDocumentDraft,
            profile: draftProject.machine
          })
        : null,
    [draftProject, pathDocumentDraft]
  );
  const upidExport = useMemo(() => {
    if (!exportPreviewOpen || !pathDocumentDraft || !draftProject) return null;

    const exportProgram = composeProjectUpidGCodeExport(draftProject, pathDocumentDraft);

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
  }, [draftProject, exportPreviewOpen, pathDocumentDraft]);
  const machinePreviewTransitions = useMemo(
    () =>
      pathDocumentDraft && draftProject
        ? deriveUpidMachinePreviewTransitions(pathDocumentDraft, draftProject.machine)
        : undefined,
    [draftProject, pathDocumentDraft]
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
  const editorFileName =
    program?.model === 'upid-document'
      ? 'UPID Project'
      : program?.filePath.split('/').pop() ?? '-';
  const hasUnsavedChanges = Boolean(program && draftSignature !== savedDraftSignature);
  const activeMutatingWorkflow = activeWorkflowSession?.kind === 'mutating'
    ? activeWorkflowSession
    : null;
  const entryExitPresentedOperationId =
    selectedPathOperationId ??
    (pathDocumentDraft
      ? orderedPathOperations(pathDocumentDraft.plan.operations)[0]?.id
      : undefined);
  const selectedOperationTransitionsAreGenerated = Boolean(
    pathDocumentDraft &&
    draftProject &&
    entryExitPresentedOperationId &&
    operationTransitionsAreGenerated(
      pathDocumentDraft,
      entryExitPresentedOperationId,
      draftProject.machine
    )
  );
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
    () => (draftProgram ? organizeGCodeStructure(draftProgram.text.split(/\r?\n/)) : null),
    [draftProgram]
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
      commands: EDITOR_COMMAND_REGISTRY.commandsForMenu(title)
        .filter((command) => command.id !== 'view.contours')
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
    const nextMachineProfile = program?.project?.machine
      ? structuredClone(program.project.machine)
      : null;
    const rebasesDirtyMachineWorkflow = Boolean(
      !identityChanged &&
      activeWorkflowSession?.kind === 'mutating' &&
      activeWorkflowSession.commandId === 'machine.profile' &&
      activeWorkflowSession.dirty
    );
    setDraftState((current) =>
      editorDraftSignature(current) === editorDraftSignature(nextDraft) ? current : nextDraft
    );
    setMachineProfileDraft((current) =>
      JSON.stringify(current) === JSON.stringify(nextMachineProfile)
        ? current
        : nextMachineProfile
    );

    if (!identityChanged) {
      setActiveWorkflowSession((current) => {
        if (current?.commandId !== 'machine.profile') return current;
        const rebasedOpeningSnapshot = {
          ...current.openingSnapshot,
          draft: cloneEditorDraftState(nextDraft),
          machineProfile: nextMachineProfile
            ? structuredClone(nextMachineProfile)
            : null
        };
        if (current.kind === 'mutating') {
          const rebasedSession = {
            ...current,
            openingSnapshot: rebasedOpeningSnapshot
          };
          return current.dirty
            ? markEditorWorkflowDirty(rebasedSession, {
                enabled: false,
                reason: REBASE_MACHINE_WORKFLOW_REVIEW_REASON
              })
            : rebasedSession;
        }
        return {
          ...current,
          openingSnapshot: rebasedOpeningSnapshot
        };
      });
      if (rebasesDirtyMachineWorkflow) {
        setActiveWorkflowPendingReasons((current) => ({
          ...current,
          'machine-profile-form': REBASE_MACHINE_WORKFLOW_REVIEW_REASON
        }));
      }
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
      if (event.defaultPrevented) return;

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
  }, [activeToolSession, activeWorkflowSession, canvasMouseMode, draftText, entryExitCanvasPick, isCompactViewport, isEditorMutationLocked, measurementPoints.length, pathClickMode, pathDocumentDraft, program, redoStack, selectedLines, undoStack]);

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
            ...(machineProfileDraft && JSON.stringify(machineProfileDraft) !==
              JSON.stringify(program.project?.machine)
              ? { machineProfile: machineProfileDraft }
              : {}),
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
    setSelectedProgramExactTarget(null);
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
    node: UpidProgramTreeNode | null
  ) {
    const operationId = node?.operationId ??
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

    setSelectedProgramExactTarget(exactTargetForProgramTreeEditTarget(node?.editTarget));
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
      if (
        draftProject &&
        operationTransitionsAreGenerated(
          pathDocumentDraft,
          operationId,
          draftProject.machine
        )
      ) {
        setEntryExitCanvasPick(null);
        return;
      }
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
      classification,
      machineProfileDraft ?? undefined
    );
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleSetGeometryBasis(basis: PathPlanningDocument['geometryBasis']) {
    if (!activeWorkflowOwns('geometry.setup') || !pathDocumentDraft || !draftProject || isEditorMutationLocked) return;
    if (basis === pathDocumentDraft.geometryBasis) return;

    const edited = basis === 'finished-contour' && machineSnapshotAuthorizesAutomaticCompensation(draftProject.machine)
      ? initializeProjectCompensationIntents(pathDocumentDraft, draftProject.machine)
      : { ...structuredClone(pathDocumentDraft), geometryBasis: basis };
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
    if (
      draftProject &&
      operationTransitionsAreGenerated(pathDocumentDraft, operationId, draftProject.machine)
    ) return;
    const edited = setCircleOperationCenterPierceLeadIn(pathDocumentDraft, operationId);
    if (!edited) {
      onStatusMessage?.('Circle-center entry requires one closed circular operation.', 'warning');
      return;
    }
    applyPathDocumentEdit(edited, { selectedPathElement, selectedPathOperationId: operationId });
  }

  function handleSetOperationManualEntry(
    operationId: string,
    point: { x: number; y: number }
  ) {
    if (!activeWorkflowOwns('machining.entry-exit') || !pathDocumentDraft || isEditorMutationLocked) return;
    if (
      draftProject &&
      operationTransitionsAreGenerated(pathDocumentDraft, operationId, draftProject.machine)
    ) return;
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
    if (
      draftProject &&
      operationTransitionsAreGenerated(pathDocumentDraft, operationId, draftProject.machine)
    ) return;
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
    if (
      draftProject &&
      operationTransitionsAreGenerated(pathDocumentDraft, operationId, draftProject.machine)
    ) return;
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
    if (
      draftProject &&
      operationTransitionsAreGenerated(pathDocumentDraft, operationId, draftProject.machine)
    ) return;
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

    const edited = selectedPathElement?.segmentId
      ? translatePathSegment(pathDocumentDraft, selectedPathElement.segmentId, delta)
      : selectedPathElement?.pathElementId
        ? translatePathElement(pathDocumentDraft, selectedPathElement.pathElementId, delta)
        : selectedPathOperationId
          ? translatePathOperation(pathDocumentDraft, selectedPathOperationId, delta)
          : null;

    if (edited) {
      clearActiveWorkflowPending(completedSource);
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleTranslatePathDocument(
    delta: { x: number; y: number },
    completedSource: 'transform-target' | 'transform-translate' = 'transform-translate'
  ) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;

    const edited = translatePathDocument(pathDocumentDraft, delta);
    if (edited) {
      clearActiveWorkflowPending(completedSource);
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
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

    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
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

    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement,
        selectedPathOperationId
      });
    }
  }

  function handleRotatePathDocument(angleDegrees: number) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;

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
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || isEditorMutationLocked) return;

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

    if (edited) {
      applyPathDocumentEdit(edited, {
        selectedPathElement: dragTarget,
        selectedPathOperationId: dragTarget.operationId
      });
    }
  }

  function handleMoveSelectedSegmentCenter(targetCenter: { x: number; y: number }) {
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || !selectedPathElement?.segmentId || isEditorMutationLocked) return;

    const edited = movePathSegmentCenterTo(pathDocumentDraft, selectedPathElement.segmentId, targetCenter);
    if (edited) {
      clearActiveWorkflowPending('transform-target');
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
    if (!activeWorkflowOwns('geometry.transform') || !pathDocumentDraft || !element.segmentId || isEditorMutationLocked) return;

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
      text: nextText
    });
    setSelectedPathOperationId(null);
    setSelectedPathElement(null);
    setSelectedProgramExactTarget(null);
    setSelectedProgramTreeKey(null);
    setPathClickMode(null);
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
      machineProfile: machineProfileDraft ? structuredClone(machineProfileDraft) : null,
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
    setMachineProfileDraft(
      snapshot.machineProfile ? structuredClone(snapshot.machineProfile) : null
    );
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
    if (!pathDocumentDraft) {
      return program
        ? 'Select program rows to inspect, edit, move, or pin geometry in the preview.'
        : 'Import a program or DXF file to begin.';
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

    if (selectedPathElement) {
      return activeWorkflowOwns('geometry.transform')
        ? 'Transform active / Drag selected geometry on the canvas or use the workflow fields for exact placement.'
        : 'Selection active / Open Geometry > Transform Geometry to move or drag the selected geometry.';
    }

    if (canvasMouseMode === 'point') {
      return 'Measurement & Construction / Click empty canvas space to place a point, or switch to Select.';
    }

    return 'Select mode / Click geometry to inspect it. Open Construction > Measurement & Construction to place points.';
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

  function handleUpdateProjectMachine(nextProject: WorkbenchProject) {
    if (
      !activeWorkflowOwns('machine.profile') ||
      isEditorMutationLocked ||
      !machineProfileDraft ||
      JSON.stringify(nextProject.machine) === JSON.stringify(machineProfileDraft)
    ) {
      return;
    }
    clearActiveWorkflowPending('machine-profile-form');
    setMachineProfileDraft(structuredClone(nextProject.machine));
    markActiveWorkflowDirty('machine.profile');
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

  function openEditorWorkflowForTarget(
    target: UpidProgramTreeEditTarget,
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
      pendingAction?.(
        editorProjectDraftSignature(
          resultingSnapshot.draft,
          resultingSnapshot.machineProfile
        ) !== savedDraftSignature
      );
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
      renderedPlacement === 'floating' && (isCompactViewport || isMiddleViewport)
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
        machineProfile={machineProfileDraft}
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
          machineProfile={machineProfileDraft}
          machineProfileEditor={
            draftProject && pathDocumentDraft ? (
              <EditorProjectMachinePanel
                disabled={
                  isEditorMutationLocked || !activeWorkflowOwns('machine.profile')
                }
                key={activeWorkflowOwns('machine.profile') ? 'machine-active' : 'machine-inactive'}
                onDraftChange={() => markActiveWorkflowPending(
                  'machine.profile',
                  'machine-profile-form',
                  'Review and verify valid project machine settings before saving.'
                )}
                onUpdateProject={handleUpdateProjectMachine}
                preserveDraftOnProjectChange={Boolean(
                  activeWorkflowSession?.kind === 'mutating' &&
                  activeWorkflowSession.commandId === 'machine.profile' &&
                  activeWorkflowSession.dirty
                )}
                project={draftProject}
              />
            ) : undefined
          }
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

  function showWorkspacePanel(panelId: EditorWorkspacePanelId) {
    if (panelId === 'contour-tree') {
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
        {pathDocumentDraft && draftProject &&
          renderWorkspacePanel(
            'contour-setup',
            'Contour Setup',
            <EditorContourSetupPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              machine={draftProject.machine}
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
            'Program Start / G92',
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
        {pathDocumentDraft && draftProject &&
          renderWorkspacePanel(
            'entry-exit',
            'Entry / Exit',
            <EditorEntryExitPanel
              canvasPickMode={entryExitCanvasPick?.kind ?? null}
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              machine={draftProject.machine}
              onCanvasPickModeChange={(mode, operationId) => {
                if (!activeWorkflowOwns('machining.entry-exit') || isEditorMutationLocked) return;
                if (
                  operationTransitionsAreGenerated(
                    pathDocumentDraft,
                    operationId,
                    draftProject.machine
                  )
                ) return;
                setEntryExitCanvasPick(mode ? { kind: mode, operationId } : null);
              }}
              onDraftChange={(source) => markActiveWorkflowPending(
                'machining.entry-exit', source,
                'Apply or correct the pending cut entry or exit coordinates before saving or changing the target contour.'
              )}
              onOpenContourStart={(operationId) =>
                openEditorWorkflowForTarget(
                  { kind: 'contour-start', operationId },
                  `${programTreeKeyForOperation(operationId)}:contour-start`
                )
              }
              onOpenMachiningParticipation={(operationId) =>
                openEditorWorkflowForTarget(
                  { kind: 'machining-participation', operationId },
                  `${programTreeKeyForOperation(operationId)}:cut-path`
                )
              }
              onOpenProjectMachine={() =>
                openEditorWorkflowForTarget({ kind: 'machine-setup' }, 'setup:machine')
              }
              onSelectOperation={handleSelectWorkflowOperation}
              onSetCircleCenterEntry={handleSetOperationCircleCenterEntry}
              onSetManualEntry={handleSetOperationManualEntry}
              onSetManualExit={handleSetOperationManualExit}
              onSetNoEntry={handleSetOperationNoEntry}
              onSetNoExit={handleSetOperationNoExit}
              selectedOperationId={selectedPathOperationId}
              targetChangeBlocked={workflowTargetChangeBlocked}
            />,
            { readOnly: selectedOperationTransitionsAreGenerated }
          )}
        {pathDocumentDraft && draftProject &&
          renderWorkspacePanel(
            'between-contours',
            'Between Contours',
            <EditorBetweenContoursPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              machine={draftProject.machine}
              onSelectOperation={handleSelectWorkflowOperation}
              onSetOperationThreading={handleSetOperationThreading}
              onSetProjectThreading={handleSetProjectThreading}
              selectedOperationId={selectedPathOperationId}
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
              onSetSpan={handleSetMachiningSpan}
              onSetWireSide={handleSetPartialContourCompensationSide}
              selectedOperationId={selectedPathOperationId}
              selectedSegmentId={selectedPathElement?.segmentId ?? null}
              selectedSpanId={selectedMachiningSpanId}
              targetChangeBlocked={workflowTargetChangeBlocked}
            />
          )}
        {pathDocumentDraft && draftProject &&
          renderWorkspacePanel(
            'program-stops',
            'Program Stops',
            <EditorProgramStopsPanel
              disabled={Boolean(isEditorMutationLocked)}
              document={pathDocumentDraft}
              machine={draftProject.machine}
              onDraftChange={() => markActiveWorkflowPending(
                'machining.program-stops', 'stop-form',
                'Add a valid program stop or discard its pending fields before saving or changing the target contour.'
              )}
              onSetStops={handleSetOperationProgramStops}
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
          authoritativeGeneratedOperationIds={
            machinePreviewTransitions?.authoritativeGeneratedOperationIds
          }
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
          postedTransitions={machinePreviewTransitions?.transitions}
          pathCount={pathCount}
          pinnedLines={pinnedLines}
          selectedPathElement={selectedPathElement}
          selectedLines={selectedLines}
          startPreview={startPreview}
        />

        {isPathProject ? (hasActiveRightDock ? (
          <>
            <div
              aria-label="Resize Workflow Dock"
              className="hidden cursor-col-resize bg-border/30 transition hover:bg-primary/40 lg:block"
              data-editor-inspector-resizer
              onPointerDown={handleInspectorRailResizeStart}
              role="separator"
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
        machineProfileName={machineProfileDraft?.name ?? null}
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

function findProgramTreeOperationId(
  tree: UpidProgramTree,
  treeKey: string
): string | null | undefined {
  if (treeKey === 'section:source' || treeKey === 'section:program') return null;
  const pending = [...tree.sourceSetup, ...tree.operations].map((node) => ({
    inheritedOperationId: null as string | null,
    node
  }));
  while (pending.length > 0) {
    const { inheritedOperationId, node } = pending.shift()!;
    const operationId = node.operationId ?? inheritedOperationId;
    if (node.treeKey === treeKey) return operationId;
    pending.unshift(...node.children.map((child) => ({
      inheritedOperationId: operationId,
      node: child
    })));
  }
  return undefined;
}

function exactTargetForProgramTreeEditTarget(
  target: UpidProgramTreeEditTarget | undefined
): EditorProgramTreeExactTarget | null {
  if (target?.kind === 'diagnostics' && target.diagnosticId) {
    return { diagnosticId: target.diagnosticId, kind: 'diagnostic' };
  }
  if (target?.kind === 'machining-participation' && target.spanId) {
    return target.operationId
      ? {
          kind: 'machining-span',
          operationId: target.operationId,
          spanId: target.spanId
        }
      : null;
  }
  if (target?.kind === 'program-stop') {
    return {
      kind: 'program-stop',
      operationId: target.operationId,
      stopId: target.stopId
    };
  }
  return null;
}

function reconcileProgramExactTarget(
  target: EditorProgramTreeExactTarget | null,
  document: PathPlanningDocument | null
): EditorProgramTreeExactTarget | null {
  if (!target || !document) return null;
  if (target.kind === 'diagnostic') {
    return [...document.diagnostics, ...document.plan.diagnostics].some(
      (diagnostic) => diagnostic.id === target.diagnosticId
    )
      ? target
      : null;
  }
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

function operationTransitionsAreGenerated(
  document: PathPlanningDocument,
  operationId: string,
  machine: MachineProfile
) {
  return resolveSourceOperationTransitionOwnership(
    document,
    operationId,
    machine
  ) === 'generated-explicit-linear';
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
