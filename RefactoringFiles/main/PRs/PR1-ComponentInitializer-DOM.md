# PR1: Extract DOM Build to ComponentInitializer

## Summary
Move the HTML layout construction from `main.js` into `ComponentInitializer.buildAppDOM(appContainer)` returning references to key nodes.

## Motivation
Separate DOM concerns from orchestration; make element selection explicit and reusable.

## Scope
- In: Extract header/main/canvas/sidebar/status creation; preserve IDs/classes.
- In: Return `{ canvasElement, toolbarContainer, sidebarContainer, statusContainer }`.
- Out: Component instantiation.

## Acceptance Criteria
- App renders identical structure; selectors and CSS unaffected.
- Build passes.

## Test Plan
- Launch dev; verify canvas renders and containers exist by IDs; no behavior change.

