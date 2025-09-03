# PR3: Extract Core Event Wiring

## Summary
Move core EventBus subscriptions into `EventWiring.wireAll(context, state)`: file load workflow, canvas click → add point, and point management (add/delete/clear/get-clicked).

## Motivation
Centralize cross-component communication; provide a single cleanup function to remove listeners.

## Scope
- In: `FILE_LOAD_START/SUCCESS/ERROR`, `MOUSE_CLICK`, `POINT_ADD/DELETE/CLEAR_ALL/GET_CLICKED`.
- In: Maintain `POINT_UPDATE` emissions with same payloads.
- Out: Viewport/status/grid/export/resize/drawer workflows (next PRs).

## Acceptance Criteria
- Emissions and resulting UI updates mirror current behavior.
- Build passes; `wireAll()` returns cleanup that unsubscribes all registered handlers.

## Test Plan
- Load file: canvas path updates; success/error messages; mapping passed to drawer.
- Click canvas: adds points; `POINT_UPDATE` fires with correct counts.

