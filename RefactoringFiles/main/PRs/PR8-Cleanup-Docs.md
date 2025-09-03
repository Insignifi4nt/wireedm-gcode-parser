# PR8: Cleanup and Documentation

## Summary
Remove dead code from `main.js` after migration. Ensure unsubscribe/cleanup paths exist and are documented. Align docs with final module responsibilities.

## Motivation
Finalize the split with a single source of truth and clear documentation.

## Scope
- In: Sweep for unused helpers, redundant listeners; ensure orchestrator destroy path is complete.
- In: Update `RefactoringFiles/main/00-scope.md` with final acceptance checklist.

## Acceptance Criteria
- No duplicate logic remains; build passes; no console warnings about missing listeners.

## Test Plan
- Full smoke across all flows; inspect EventBus stats (if available) for listener counts before/after destroy.

