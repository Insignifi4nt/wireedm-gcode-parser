# PR4: Toolbar Orchestration Cleanup

Status: Completed

## Summary
Slim `Toolbar.js` to instantiate and delegate to FileControls, ViewControls, and ActionControls; centralize state updates after actions.

## Motivation
Keep Toolbar focused on composition and state, not on detailed handlers.

## Scope
- In: Wire submodules; expose same public API; ensure subscriptions/cleanup are managed centrally.
- Out: Changing external consumers of Toolbar.

## Acceptance Criteria
- Behavior parity; no duplicate or missing listeners; clean destroy path.

## Test Plan
- Full smoke across toolbar flows; inspect listener counts before/after destroy.

Implementation Notes
- `Toolbar.js` now composes `FileControls`, `ViewControls`, and `ActionControls` and delegates bindings to them in `_setupEventListeners()`.
- Centralized cleanup: `destroy()` calls each submodule’s `destroy()` and clears references; event subscriptions retained only for FILE_*, POINT_UPDATE, and EXPORT_SUCCESS state updates.
- Public API unchanged; DOM hooks unchanged.

Verification
- Smoke tests confirm no duplicate listeners and clean destroy behavior; state updates and labels continue to work.
