# PR0: Scaffold Files

Status: Completed

## Summary
Create empty modules with JSDoc: `core/AppOrchestrator.js`, `core/ComponentInitializer.js`, `core/EventWiring.js`. Do not change `main.js` logic yet.

## Motivation
Lay down clear places for responsibilities before moving logic. Avoid large, risky diffs.

## Scope
- In: Add files with named exports and minimal JSDoc comments.
- Out: Any import changes in `main.js`.

## Acceptance Criteria
- Build passes; no runtime changes.
- No references to the new modules yet.

Implementation Notes
- Completed in commit b018841 (refactor(main,core): PR1 extract DOM build to ComponentInitializer; PR0 scaffold orchestration modules).
- Files added: `src/core/AppOrchestrator.js`, `src/core/ComponentInitializer.js`, `src/core/EventWiring.js` with initial JSDoc stubs.

Verification
- Verified build references and imports remained unchanged at this step.
