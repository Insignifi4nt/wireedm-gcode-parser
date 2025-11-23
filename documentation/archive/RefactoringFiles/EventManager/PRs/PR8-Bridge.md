# PR8: Bridge and Compatibility Layer

## Summary
Ensure `src/core/EventManager.js` re-exports `{ EventBus, EVENT_TYPES, EventUtils }` from new modules and retains default export if needed.

## Motivation
Keep existing imports stable while enabling new direct imports in future PRs.

## Scope
- In: Update `EventManager.js` to re-export modules; keep default export.
- In: Optionally add `core/events/index.js` barrel for future direct imports.
- Out: Avoid import churn across the codebase in this PR.

## Changes
- Re-export `{ EventBus, EVENT_TYPES, EventUtils }` from their respective files.
- Keep `export default EventManager;` for legacy usage.

## Acceptance Criteria
- Build passes; no runtime errors; all current imports continue working.

## Test Plan
- Run app and verify event flows (file load, drawer hover/click, viewport controls, status messages).
