# PR6: Introduce AppOrchestrator

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

