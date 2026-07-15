import {
  clampEditorFloatingPanelGeometry,
  type EditorDockSide,
  type EditorFloatingPanelGeometry,
  type EditorPanelPlacement
} from '../EditorWorkspacePanels';

export const EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY = 'wire-edm.editor-workspace-layout.v1';

export interface EditorWorkspaceLayoutViewport {
  width: number;
  height: number;
}

export interface EditorWorkspaceLayoutV1 {
  schemaVersion: 1;
  placements: Record<string, EditorPanelPlacement>;
  dockOrders: Record<EditorDockSide, string[]>;
  floatingGeometries: Record<string, EditorFloatingPanelGeometry>;
  dockWidths: Record<EditorDockSide, number>;
}

export function readEditorWorkspaceLayout(
  defaults: EditorWorkspaceLayoutV1,
  viewport: EditorWorkspaceLayoutViewport,
  storage: Pick<Storage, 'getItem'> = localStorage
): EditorWorkspaceLayoutV1 {
  try {
    const stored = storage.getItem(EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY);
    if (!stored) return defaults;
    return normalizeEditorWorkspaceLayout(JSON.parse(stored), defaults, viewport);
  } catch {
    return defaults;
  }
}

export function writeEditorWorkspaceLayout(
  layout: EditorWorkspaceLayoutV1,
  storage: Pick<Storage, 'setItem'> = localStorage
) {
  storage.setItem(EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

export function readEditorWorkspaceRenderedPlacement(
  placements: Readonly<Record<string, EditorPanelPlacement>>,
  panelId: string,
  activePanelId: string | null
): EditorPanelPlacement {
  if (panelId !== activePanelId) return 'hidden';
  const rememberedPlacement = placements[panelId];
  return rememberedPlacement === 'hidden' || rememberedPlacement === undefined
    ? 'floating'
    : rememberedPlacement;
}

export function normalizeEditorWorkspaceLayout(
  candidate: unknown,
  defaults: EditorWorkspaceLayoutV1,
  viewport: EditorWorkspaceLayoutViewport
): EditorWorkspaceLayoutV1 {
  if (!isRecord(candidate) || candidate.schemaVersion !== 1) return defaults;

  const panelIds = Object.keys(defaults.placements);
  const candidatePlacements = isRecord(candidate.placements) ? candidate.placements : {};
  const placements = Object.fromEntries(
    panelIds.map((panelId) => {
      const placement = candidatePlacements[panelId];
      return [panelId, isPanelPlacement(placement) ? placement : defaults.placements[panelId]];
    })
  );

  const candidateGeometry = isRecord(candidate.floatingGeometries)
    ? candidate.floatingGeometries
    : {};
  const floatingGeometries = Object.fromEntries(
    panelIds.map((panelId) => {
      const geometry = readGeometry(candidateGeometry[panelId]) ?? defaults.floatingGeometries[panelId];
      return [
        panelId,
        clampEditorFloatingPanelGeometry(geometry, {
          height: viewport.height,
          width: viewport.width,
          left: 6,
          top: 42
        })
      ];
    })
  );

  const candidateOrders = isRecord(candidate.dockOrders) ? candidate.dockOrders : {};
  const used = new Set<string>();
  const dockOrders = {
    left: normalizeDockOrder('left', candidateOrders.left, placements, panelIds, used),
    right: normalizeDockOrder('right', candidateOrders.right, placements, panelIds, used)
  };

  const candidateWidths = isRecord(candidate.dockWidths) ? candidate.dockWidths : {};
  const dockWidths = {
    left: clampDockWidth(candidateWidths.left, defaults.dockWidths.left, viewport.width),
    right: clampDockWidth(candidateWidths.right, defaults.dockWidths.right, viewport.width)
  };

  return { schemaVersion: 1, placements, dockOrders, floatingGeometries, dockWidths };
}

function normalizeDockOrder(
  side: EditorDockSide,
  value: unknown,
  placements: Record<string, EditorPanelPlacement>,
  panelIds: readonly string[],
  used: Set<string>
) {
  if (!Array.isArray(value)) return [];
  const known = new Set(panelIds);
  const result: string[] = [];
  for (const panelId of value) {
    if (
      typeof panelId !== 'string' ||
      !known.has(panelId) ||
      used.has(panelId) ||
      placements[panelId] !== `docked-${side}`
    ) {
      continue;
    }
    used.add(panelId);
    result.push(panelId);
  }
  return result;
}

function clampDockWidth(value: unknown, fallback: number, viewportWidth: number) {
  const width = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(240, width), Math.max(240, viewportWidth - 200));
}

function readGeometry(value: unknown): EditorFloatingPanelGeometry | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((number) => typeof number === 'number' && Number.isFinite(number))) {
    return null;
  }
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function isPanelPlacement(value: unknown): value is EditorPanelPlacement {
  return value === 'floating' || value === 'hidden' || value === 'docked-left' || value === 'docked-right';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
