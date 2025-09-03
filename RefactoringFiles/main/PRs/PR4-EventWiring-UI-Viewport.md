# PR4: Extract UI/Viewport/Status/Grid/Resize Wiring

## Summary
Move viewport control wiring, status messages, grid snap/visibility toggles, and window resize emission into `EventWiring.wireAll()`.

## Motivation
Consolidate UI state and viewport flows; ensure re-emission of stateful viewport data remains identical.

## Scope
- In: `VIEWPORT_ZOOM_CHANGE` (command + stateful), `VIEWPORT_FIT_TO_SCREEN`, `VIEWPORT_RESET`, `STATUS_SHOW`, `GRID_SNAP_TOGGLE` (including re-emit with `enabled`), `GRID_VISIBILITY_TOGGLE`, `UI_RESIZE` (window listener).
- Out: Drawer workflows (next PR).

## Acceptance Criteria
- Redraws and UI messages occur as before; grid toggles behave identically.
- Build passes; cleanup removes window listener and unsubscribes.

## Test Plan
- Verify zoom in/out/reset/fit cycles; grid snap toggle echoes state; grid visibility toggles; resize triggers canvas layout.

