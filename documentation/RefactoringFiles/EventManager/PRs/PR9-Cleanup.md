# PR9: Cleanup

## Summary
Remove duplicated code from `src/core/EventManager.js` once re-exports are in place; ensure single source of truth in `core/events/*`.

## Motivation
Finalize the split by removing dead code and leaving EventManager as a compatibility module (and/or thin orchestrator if needed).

## Scope
- In: Remove moved logic; keep re-exports.
- In: Ensure docs/comments mark default export as legacy until migrations finish.
- Out: No behavior changes.

## Acceptance Criteria
- Build passes; no import regressions; no duplicate definitions remain.

## Test Plan
- Full smoke across file load, viewport interactions, drawer highlights, and export flows.
