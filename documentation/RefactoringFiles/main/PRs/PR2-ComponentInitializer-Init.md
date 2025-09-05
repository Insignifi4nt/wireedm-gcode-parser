# PR2: Extract Component Instantiation to ComponentInitializer

Status: Completed

## Summary
Move creation of `Canvas`, `Toolbar`, `Sidebar`, `GCodeDrawer`, `StatusMessage`, and `EventIntegration` into `ComponentInitializer.initComponents(canvasElement)`.

## Motivation
Keep component creation cohesive and testable; avoid mixing with wiring logic.

## Scope
- In: Instantiate components with the same options; return an object with references.
- Out: Event wiring and window listeners.

## Acceptance Criteria
- Components initialize and display as before.
- Build passes; no behavior changes.

## Test Plan
- Verify Toolbar/Sidebar visible; Canvas renders; Drawer attaches; Status messages show.

Implementation Notes
- Completed in commit d27c443.
- Added `initAppComponents(domRefs)` to `src/core/ComponentInitializer.js` to instantiate `Canvas`, `Toolbar`, `Sidebar`, `GCodeDrawer`, `StatusMessage`, `EventIntegration`, and `GCodeParser`.
- Returned a cohesive components object to the orchestrator.

Verification
- Manual smoke confirmed component visibility and initialization parity.
