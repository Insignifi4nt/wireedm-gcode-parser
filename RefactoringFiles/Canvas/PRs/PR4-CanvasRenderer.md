# PR4: Extract CanvasRenderer

Status: Completed (phase 1: clear + world transform)

## Summary
Move clear/transform helpers from `Canvas.js` into `components/canvas/CanvasRenderer.js`.

## Motivation
Centralizing canvas context prep makes the render pipeline easier to follow and test.

## Scope
- In: Add `CanvasRenderer.js` with:
  - `clearCanvas(ctx, width, height)`
  - `applyWorldTransform(ctx, viewport, dpi)`
  - `applyTextTransform(ctx, viewport, dpi)` (added for future consolidation)
- Out: Keep resize/DPI config and viewport state in Canvas.

## Changes
- Added `src/components/canvas/CanvasRenderer.js`.
- Updated `Canvas.js` to use `clearCanvas` and `applyWorldTransform`; removed private equivalents.

## Acceptance Criteria
- Visual parity and performance parity; DPI behavior identical.

## Test Plan
- Verify grid/path/markers render as before; text not mirrored; zoom/pan accurate.
