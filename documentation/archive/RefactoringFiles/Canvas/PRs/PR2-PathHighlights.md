# PR2: Extract PathHighlights

Status: Completed

## Summary
Move path rendering and highlight drawing from `Canvas.js` into `components/canvas/PathHighlights.js` and delegate calls.

## Motivation
Path drawing and highlighting are cohesive; extracting them simplifies `Canvas.js` and clusters related logic.

## Scope
- In: Add `PathHighlights.js` exporting:
  - `renderPath(ctx, viewport, path, opts)`
  - `renderStartEnd(ctx, viewport, path, opts)`
- Out: Keep hover/persistent state on the Canvas instance; Canvas passes it into the module.

## Changes
- Added `src/components/canvas/PathHighlights.js` with linear/arc rendering, endpoint markers, and endpoint highlight markers.
- `Canvas.js` now imports and delegates from `_performRender`; removed old private methods.

## API / Events
- `setHoverHighlight` and `togglePersistentHighlight` remain on Canvas and update state; rendering delegated.

## Acceptance Criteria
- Path, start/end markers, and hover/persistent highlights render identically; screen-space stroke widths preserved.
- Build passes; manual checks confirm parity.

## Test Plan
- Hover and click (persistent highlight) flows via `main.js` behave as before.
