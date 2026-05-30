# PR2: Extract ViewControls

Status: Completed

## Summary
Move zoom in/out/reset/fit handlers and zoom display updates into `components/toolbar/ViewControls.js`.

## Motivation
Viewport controls are cohesive; separating them reduces coupling and clarifies event flows.

## Scope
- In: Handlers for zoom-in/out, fit-to-screen; subscribe to `VIEWPORT_ZOOM_CHANGE` for display update.
- Out: DOM structure changes or different event semantics.

## Acceptance Criteria
- Behavior parity for zoom buttons and live zoom level display updates.

## Test Plan
- Click zoom buttons and fit; verify redraws and display updates; observe state re-emit path.

Implementation Notes
- Added `src/components/toolbar/ViewControls.js` to own zoom in/out/fit handlers and subscribe to `VIEWPORT_ZOOM_CHANGE` to update the zoom display.
- Updated `src/components/Toolbar.js` to instantiate `ViewControls` and removed direct bindings for zoom/fit and the zoom display subscription.
- Event emission semantics unchanged; payloads preserved.

Verification
- Manual checks: zoom in/out/reset via toolbar and fit-to-screen work; zoom display updates on re-emit; no duplicate listeners.
