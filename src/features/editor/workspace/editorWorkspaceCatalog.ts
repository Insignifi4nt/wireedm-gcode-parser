import { createEditorCommandRegistry, type EditorCommandDefinition } from '../commands/editorCommands';
import type { EditorWorkflowMenuGroup } from '../EditorWorkflowMenuBar';
import type { EditorFloatingPanelGeometry } from '../EditorWorkspacePanels';
import { readEditorWorkspaceLayout, type EditorWorkspaceLayoutV1 } from './editorWorkspaceLayout';

export const SET_START_COMMAND: EditorCommandDefinition = {
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

export type EditorWorkspacePanelId =
  | 'geometry-setup'
  | 'contour-setup'
  | 'set-start'
  | 'path-transform'
  | 'endpoint-topology'
  | 'path-diagnostics'
  | 'cut-sequence'
  | 'initial-wire-position'
  | 'entry-exit'
  | 'between-contours'
  | 'program-stops'
  | 'machining-participation'
  | 'statistics'
  | 'machine'
  | 'measurement'
  | 'measure';

export const EDITOR_WORKSPACE_PANEL_TITLES: Record<EditorWorkspacePanelId, string> = {
  measure: 'Measure',
  'geometry-setup': 'Geometry Setup',
  'contour-setup': 'Contour Setup',
  'set-start': 'Contour Start',
  'path-transform': 'Transform',
  'endpoint-topology': 'Endpoint Topology',
  'path-diagnostics': 'Path Diagnostics',
  'cut-sequence': 'Cut Sequence',
  'initial-wire-position': 'Initial wire position',
  'entry-exit': 'Entry / Exit',
  'between-contours': 'Between Contours',
  'program-stops': 'Program Stops',
  'machining-participation': 'Machining Participation',
  statistics: 'Statistics',
  machine: 'Source & Machine Setup',
  measurement: 'Construction points'
};

export const EDITOR_WORKSPACE_PANEL_DESCRIPTIONS: Record<EditorWorkspacePanelId, string> = {
  measure: 'distance, coordinates and geometry dimensions with magnetic point picking',
  'geometry-setup': 'document machining geometry basis',
  'contour-setup': 'contour direction, role, and compensation intent',
  'set-start': 'guided contour start-point selection',
  'path-transform': 'move, rotate, and mirror tools for document and selected geometry',
  'endpoint-topology': 'join map for endpoint joins, healed gaps, open ends, and ambiguous clusters',
  'path-diagnostics': 'warnings and linked rows for broken or risky path geometry',
  'cut-sequence': 'operation order, rapid moves, and cut direction',
  'initial-wire-position': 'reviewed initial wire coordinates and first connection origin',
  'entry-exit': 'per-operation cutting entry and exit geometry',
  'between-contours': 'derived rapid travel and manual or automatic rethread policy',
  'program-stops': 'typed unconditional stop events at operation boundaries or remaining cut distance',
  'machining-participation': 'source-preserving active cuts, inactive reference spans, and explicit open-path compensation side',
  statistics: 'project dimensions, source, topology and selected geometry',
  machine: 'source unit review and planning-machine span checks',
  measurement: 'manual points, perpendicular and tangent construction, and export actions'
};

export const PATH_WORKSPACE_PANEL_IDS: EditorWorkspacePanelId[] = [
  'geometry-setup',
  'contour-setup',
  'set-start',
  'path-transform',
  'endpoint-topology',
  'path-diagnostics',
  'cut-sequence',
  'initial-wire-position',
  'entry-exit',
  'between-contours',
  'machining-participation',
  'program-stops'
];

export const INSPECTOR_WORKSPACE_PANEL_IDS: EditorWorkspacePanelId[] = [
  'measure',
  'statistics',
  'machine',
  'measurement'
];

const DEFAULT_WORKSPACE_PANEL_GEOMETRY: Record<EditorWorkspacePanelId, EditorFloatingPanelGeometry> = {
  measure: { x: 820, y: 90, width: 320, height: 420 },
  'geometry-setup': { x: 274, y: 104, width: 320, height: 260 },
  'contour-setup': { x: 286, y: 118, width: 340, height: 430 },
  'set-start': { x: 300, y: 132, width: 340, height: 340 },
  'path-transform': { x: 298, y: 134, width: 340, height: 430 },
  'endpoint-topology': { x: 812, y: 84, width: 360, height: 300 },
  'path-diagnostics': { x: 370, y: 224, width: 360, height: 260 },
  'cut-sequence': { x: 394, y: 254, width: 340, height: 340 },
  'initial-wire-position': { x: 620, y: 110, width: 360, height: 430 },
  'entry-exit': { x: 650, y: 130, width: 390, height: 620 },
  'between-contours': { x: 670, y: 145, width: 390, height: 520 },
  'program-stops': { x: 680, y: 150, width: 370, height: 560 },
  'machining-participation': { x: 710, y: 170, width: 390, height: 600 },
  statistics: { x: 990, y: 104, width: 360, height: 560 },
  machine: { x: 1040, y: 134, width: 340, height: 390 },
  measurement: { x: 250, y: 194, width: 340, height: 420 }
};

export const EDITOR_WORKFLOW_MENU_TITLES: EditorWorkflowMenuGroup['title'][] = [
  'Geometry', 'Machining', 'Construction', 'View', 'Machine', 'Export'
];

export const EDITOR_COMMAND_REGISTRY = createEditorCommandRegistry([
  {
    id: 'inspect.measure', label: 'Measure', menuPath: ['Construction', 'Measure'],
    scope: 'view', toolWindowId: 'measure', prerequisites: [{ kind: 'document' }],
    workflow: { kind: 'view' }
  },
  {
    id: 'geometry.setup', label: 'Geometry Setup', menuPath: ['Geometry', 'Geometry Setup'],
    scope: 'document', toolWindowId: 'geometry-setup', historyLabel: 'Edit geometry setup',
    prerequisites: [{ kind: 'document' }], workflow: { kind: 'mutating' }
  },
  {
    id: 'geometry.source-setup', label: 'Source & Machine Setup', menuPath: ['Geometry', 'Source & Machine Setup'],
    scope: 'view', toolWindowId: 'machine', prerequisites: [{ kind: 'document' }],
    workflow: { kind: 'view' }
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
    ['machining.initial-wire', 'Initial wire position', 'initial-wire-position'],
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
    id: 'construction.measurement', label: 'Construction points',
    menuPath: ['Construction', 'Construction points'], scope: 'document',
    toolWindowId: 'measurement', historyLabel: 'Edit measurement and construction points',
    prerequisites: [{ kind: 'document' }], workflow: { kind: 'mutating' }
  },
  ...([
    ['view.endpoints', 'Endpoint Topology', 'endpoint-topology'],
    ['view.diagnostics', 'Path Diagnostics', 'path-diagnostics'],
    ['view.statistics', 'Statistics', 'statistics']
  ] as const).map(([id, label, toolWindowId]) => ({
    id, label, menuPath: ['View', label] as const, scope: 'view' as const,
    toolWindowId, prerequisites: [{ kind: 'document' } as const], workflow: { kind: 'view' as const }
  })),
  {
    id: 'export.preview', label: 'Controller Export',
    menuPath: ['Export', 'Controller Export'], scope: 'export', toolWindowId: 'controller-export',
    prerequisites: [{ kind: 'document' }, { kind: 'interaction-unlocked' }], workflow: { kind: 'view' }
  }
]);

export function readInitialWorkspaceLayout() {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const defaults: EditorWorkspaceLayoutV1 = {
    schemaVersion: 1,
    upidRailCollapsed: false,
    placements: Object.fromEntries(
      [...PATH_WORKSPACE_PANEL_IDS, ...INSPECTOR_WORKSPACE_PANEL_IDS].map((id) => [id, 'hidden' as const])
    ),
    dockOrders: { left: [], right: [] },
    floatingGeometries: { ...DEFAULT_WORKSPACE_PANEL_GEOMETRY },
    dockWidths: { left: viewport.width >= 1280 ? 260 : 220, right: 420 }
  };
  return readEditorWorkspaceLayout(defaults, viewport);
}
