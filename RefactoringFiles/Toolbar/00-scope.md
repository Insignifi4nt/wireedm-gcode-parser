# Toolbar.js Refactor Scope

## Goals
- Split `src/components/Toolbar.js` into cohesive submodules without changing behavior.
- Keep Toolbar as a thin orchestrator delegating to focused controls.

## Non-Goals (Phase 1)
- No visual or CSS changes; keep DOM hooks and classes identical.
- No event semantics changes; preserve EventBus flows.

## Constraints
- Keep public API stable: `new Toolbar(container, options)`, `init()`, `destroy()`, `getState()`, `updateOptions()`.
- Retain current dataset attributes (e.g., `data-toolbar` selectors).

## Moduleization Plan
- `components/toolbar/FileControls.js` — File I/O (input, drag/drop hooks), delegates to `FileHandler`.
- `components/toolbar/ViewControls.js` — Zoom in/out/reset/fit and zoom display updates.
- `components/toolbar/ActionControls.js` — Clear points, export ISO and normalize-to-ISO.

## PR Sequence
0. PR0: Scaffold submodules with JSDoc stubs; no behavior change.
1. PR1: Extract FileControls wiring and handlers.
2. PR2: Extract ViewControls wiring and handlers.
3. PR3: Extract ActionControls wiring and handlers.
4. PR4: Cleanup + docs sweep; verify button states and event subscriptions.

## Acceptance Criteria
- Behavior parity for file load, zoom controls, clear/export, drawer toggle, and normalize-to-ISO.
- `npm run build` passes; no duplicate listeners; button states update identically.

## Validation
- Manual smoke across Toolbar flows; verify EventBus emissions and UI states.

