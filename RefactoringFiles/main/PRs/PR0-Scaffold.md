# PR0: Scaffold Files

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

