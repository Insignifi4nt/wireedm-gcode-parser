# PR4: Toolbar Orchestration Cleanup

Status: Planned

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

