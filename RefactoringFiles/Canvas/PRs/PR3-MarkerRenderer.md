# PR3: Extract MarkerRenderer

## Summary
Move clicked points and marker label rendering from `Canvas.js` into `components/canvas/MarkerRenderer.js`.

## Motivation
Point markers are independent of path/grid; extracting clarifies responsibilities and reduces Canvas size.

## Scope
- In: Add `MarkerRenderer.js` with:
  - `renderClickedPoints(ctx, points, viewport, opts)`
  - `renderMarker(ctx, worldPoint, viewport, opts)`
- Out: Keep points state on Canvas; rendering only.

## Changes
- Move `_renderClickedPoints` and `_renderMarker` logic.
- `Canvas.js` calls MarkerRenderer from `_performRender`.

## API / Events
- No public API changes.

## Acceptance Criteria
- Markers and labels render identically across zoom levels (screen-space sizing preserved).

## Test Plan
- Add/remove/clear points and verify visuals.

