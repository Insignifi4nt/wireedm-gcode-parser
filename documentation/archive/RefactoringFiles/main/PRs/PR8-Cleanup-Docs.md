# PR8: Cleanup and Documentation

Status: Completed

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

Implementation Notes
- Removed a duplicate `VIEWPORT_ZOOM_CHANGE` quick-listener in `src/core/EventWiring.js` to avoid double handling; consolidated zoom behavior in the viewport section.
- Aligned docs for main PR0–PR7 with actual commits and added Status markers.
- Updated master `RefactoringFiles/RefactoringPlan.md` and `NEXT_REFAC_PROMPT.txt` to reflect that main split is complete and to point next efforts to Toolbar.

Verification
- Manual smoke: zoom/fit/reset work; no duplicate redraws observed; detach function unsubscribes and removes window listener; destroy path leaves no listeners registered.
