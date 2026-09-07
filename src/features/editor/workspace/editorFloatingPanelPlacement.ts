import {
  clampEditorFloatingPanelGeometry,
  EDITOR_FLOATING_PANEL_GAP,
  EDITOR_FLOATING_PANEL_TOP,
  type EditorFloatingPanelGeometry,
  type EditorPanelPlacement
} from '../EditorWorkspacePanels';
import type { EditorWorkspacePanelId } from './editorWorkspaceCatalog';

export function findReadableFloatingPanelGeometry(
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

export function readFloatingPanelViewport() {
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

export function floatingPanelGeometriesEqual(
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

