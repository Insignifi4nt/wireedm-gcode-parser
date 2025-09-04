# PR0: Scaffold Toolbar Submodules

Status: Planned

## Summary
Add empty submodules with JSDoc stubs: `components/toolbar/FileControls.js`, `ViewControls.js`, `ActionControls.js`. No behavior changes.

## Motivation
Lay down clear module boundaries before migrating logic; minimize risk and diff size.

## Scope
- In: Create files with named exports and minimal methods (`init()`, `destroy()`), no external imports wired yet.
- Out: Toolbar refactor or DOM changes.

## Acceptance Criteria
- Build passes; Toolbar continues to function without referencing new modules.

## Test Plan
- None (no functional change). Confirm files exist and import cleanly if referenced.

