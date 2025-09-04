# PR2: Extract ViewControls

Status: Planned

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

