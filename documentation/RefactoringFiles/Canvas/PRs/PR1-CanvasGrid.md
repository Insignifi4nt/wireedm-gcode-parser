# PR1: Extract CanvasGrid

Status: Completed

## Summary
Move grid rendering (lines and labels) from `Canvas.js` into `components/canvas/CanvasGrid.js` and delegate calls.

## Motivation
Grid drawing is self-contained and frequently tweaked; isolating it reduces noise in `Canvas.js` and enables focused changes.

## Scope
- In: Add `CanvasGrid.js` exporting `drawGrid(ctx, viewport, opts)` and `drawGridLabels(ctx, viewport, opts)`.
- Out: Keep canvas transforms and DPI scaling intact; Canvas sets transform before calling grid.

## Changes
- Move `_renderGrid`, `_drawGridLines`, `_drawGridLabels` logic into module.
- `Canvas.js` imports and calls CanvasGrid; remove old private grid methods.

### Implementation Notes
- New file: `src/components/canvas/CanvasGrid.js` with named exports `drawGrid` and `drawGridLabels`.
- `Canvas.js` delegates grid rendering via `drawGrid(ctx, viewport, { gridSize, displayWidth, displayHeight, devicePixelRatio })`.
- Preserved screen-space widths via `cssToWorld = (px * DPR) / zoom` to keep visual parity across zoom/DPI.
- Labels rendered with a text-safe transform; bottom X labels use `displayHeight` for correct placement.

### Files Changed
- Added: `src/components/canvas/CanvasGrid.js`
- Updated: `src/components/Canvas.js` (import and delegate; removed old private grid methods)

## API / Events
- No public API changes; no event changes.

## Acceptance Criteria
- Grid lines/labels render as before; thresholds for labels/lines respected.
- Build passes; manual zoom/pan checks confirm parity.

Verification steps performed:
- Zoomed in/out to cross thresholds at 0.3/0.5 and verified label/line visibility.
- Panned across axes; major axes remain distinct; labels align with ticks.
- Confirmed no console errors on redraw/resize.

## Test Plan
- Toggle grid, zoom in/out to see minor/major lines and labels behave identically.
