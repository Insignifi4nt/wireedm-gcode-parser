# PR3: Extract Core Event Wiring

Status: Completed

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

Implementation Notes
- Completed in commit 65f241b (centralize event wiring in `src/core/EventWiring.js`).
- File workflow, canvas click → add point, and point add/delete/clear/get-clicked are wired with cleanup collection and a single detach function.

Verification
- Manual runs verified FILE_* and POINT_* flows; cleanup unsubscribes all handlers.
