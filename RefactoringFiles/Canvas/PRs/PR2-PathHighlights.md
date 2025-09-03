# PR2: Extract PathHighlights

## Summary
Move path rendering and highlight logic from `Canvas.js` into `components/canvas/PathHighlights.js` and delegate calls.

## Motivation
Path drawing and highlighting are cohesive; extracting them simplifies `Canvas.js` and clusters related logic.

## Scope
- In: Add `PathHighlights.js` with:
  - `renderPath(ctx, path, styles)`
  - `renderEndpoints(ctx, path, styles)`
  - `renderHighlights(ctx, path, hover, persist, styles)`
- Out: Keep hover/persistent state on the Canvas instance; Canvas passes it into the module.

## Changes
- Move `_renderGCodePath`, `_renderStartEndPoints`, and highlight drawing.
- `Canvas.js` delegates from `_performRender` to PathHighlights.

## API / Events
- `setHoverHighlight` and `togglePersistentHighlight` remain on Canvas and update state; rendering delegated.

## Acceptance Criteria
- Path, start/end markers, hover and persistent highlights render identically.
- Build passes; manual checks confirm parity.

## Test Plan
- Hover and click (persistent highlight) flows via `main.js` behave as before.

