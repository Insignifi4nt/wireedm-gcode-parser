# PR0: Scaffold events directory and barrel

## Summary
Create `src/core/events/` directory and an empty `index.js` barrel to house upcoming extracted modules.

## Motivation
Provide a stable location for extracted pieces (types, schemas, validator, bus, utils) while keeping existing imports stable via re-exports from `src/core/EventManager.js`.

## Changes
- Add `src/core/events/index.js` (comment-only barrel; exports added in later PRs).

## Acceptance Criteria
- Build continues to pass; no behavioral changes.
- No import paths changed elsewhere.

