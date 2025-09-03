# Canvas Refactor Scope

## Goals
- Reduce file size and cognitive load by separating concerns while preserving behavior and the public API used by `src/main.js`.
- Extract self-contained rendering responsibilities into focused modules.
- Maintain performance (throttling, minimal reflow) and visual parity.

## Non-Goals (Phase 1)
- No renaming of public methods used by `main.js`.
- No EventBus or external wiring changes.
- No visual design changes; keep classes/colors/thresholds as-is.

## Constraints
- Keep public API stable: `init`, `redraw`, `setGCodePath`, `setClickedPoints`, `addClickedPoint`, `clearClickedPoints`, `setHoverHighlight`, `togglePersistentHighlight`, `fitToContent`, `getViewportState`, `getViewport`, `setHighDPIEnabled`, `getHighDPIStatus`.
- Preserve canvas transforms, DPI scaling, and viewport coordinate math.

## Moduleization Plan
- `components/canvas/CanvasGrid.js` – grid lines and labels.
- `components/canvas/PathHighlights.js` – path rendering, start/end markers, hover/persistent highlights.
- `components/canvas/MarkerRenderer.js` – clicked points + marker labels.
- `components/canvas/CanvasRenderer.js` – clear, transforms, render orchestration helpers.

## PR Sequence
1. PR1: Extract `CanvasGrid` and delegate grid rendering.
2. PR2: Extract `PathHighlights` and delegate path/highlight rendering.
3. PR3: Extract `MarkerRenderer` and delegate clicked points/labels rendering.
4. PR4: Extract `CanvasRenderer` (clear/transform/render helpers) and delegate.
5. PR5: Cleanup duplicate methods; Canvas becomes an orchestrator.

## Progress
- PR1 completed: Grid lines and labels extracted to `components/canvas/CanvasGrid.js`; `Canvas.js` now delegates grid rendering.
- PR2 completed: Path + highlights extracted to `components/canvas/PathHighlights.js`; `Canvas.js` delegates path and start/end rendering.

## Acceptance Criteria
- Parity: grid, path, start/end markers, hover/persistent highlight, clicked points/labels render identically.
- Resize/DPI: coordinate math and DPI behavior unchanged; redraw throttling intact.
- Public API unchanged; `npm run build` passes; no new console errors.
