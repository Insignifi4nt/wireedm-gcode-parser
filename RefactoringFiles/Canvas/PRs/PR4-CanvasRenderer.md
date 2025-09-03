# PR4: Extract CanvasRenderer

## Summary
Move clear/transform/orchestration helpers from `Canvas.js` into `components/canvas/CanvasRenderer.js`.

## Motivation
Centralizing canvas context prep makes the render pipeline easier to follow and test.

## Scope
- In: Add `CanvasRenderer.js` with:
  - `clearCanvas(ctx, dims)`
  - `applyWorldTransform(ctx, viewport, dpi)`
  - `applyTextTransform(ctx, viewport, dpi)`
  - Optional: `performRender(ctx, steps)` that composes supplied draw steps
- Out: Keep resize/DPI config and viewport state in Canvas.

## Changes
- Move `_clearCanvas`, `_applySimpleTransform`, `_applyTextTransform`.
- `Canvas.js` calls renderer utilities; `_performRender` becomes a simple sequence of calls.

## Acceptance Criteria
- Visual parity and performance parity; DPI behavior identical.

## Test Plan
- Verify grid/path/markers render as before; text not mirrored; zoom/pan accurate.

