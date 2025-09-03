# PR1: Extract CanvasGrid

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

## API / Events
- No public API changes; no event changes.

## Acceptance Criteria
- Grid lines/labels render as before; thresholds for labels/lines respected.
- Build passes; manual zoom/pan checks confirm parity.

## Test Plan
- Toggle grid, zoom in/out to see minor/major lines and labels behave identically.

