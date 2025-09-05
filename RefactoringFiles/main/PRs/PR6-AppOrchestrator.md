# PR6: Introduce AppOrchestrator

Status: Completed

## Summary
Add `core/AppOrchestrator.js` to own the lifecycle: DOM readiness, core boot (EventBus + Parser), DOM build, component initialization, event wiring, APP_READY emission, and destroy.

## Motivation
Establish a clear, testable lifecycle entrypoint separate from the raw `main.js` bootstrap.

## Scope
- In: `init()` performs sequential steps; receive cleanup from `wireAll()`; `destroy()` disposes components, unsubscribes, clears DOM.
- Out: Changing the app entry (still `src/main.js`).

## Acceptance Criteria
- Behavior parity; APP_READY payload unchanged.
- Build passes.

## Test Plan
- Start app; verify lifecycle and manual flows; call orchestrator.destroy() and confirm cleanup.

Implementation Notes
- Completed in commit 4fde1ca (refactor(core): PR4 implement AppOrchestrator to manage lifecycle).
- `src/core/AppOrchestrator.js` owns init/destroy, emits `APP_INIT/APP_READY/APP_DESTROY`, coordinates DOM build, component init, wiring attach/detach.

Verification
- Manual smoke confirmed lifecycle events, cleanup paths (eventIntegration, canvas, toolbar, sidebar, status, eventBus), and DOM teardown.
