# PR1: Extract EventTypes

## Summary
Move EVENT_TYPES into `src/core/events/EventTypes.js` and re-export from `src/core/EventManager.js`.

## Motivation
Decouple constants from implementation; simplify imports and testing.

## Scope
- In: Add `EventTypes.js` exporting `EVENT_TYPES` (named export).
- In: Update `EventManager.js` to re-export `{ EVENT_TYPES }`.
- Out: No rename or value changes.

## Changes
- Add `src/core/events/EventTypes.js`.
- Update `src/core/EventManager.js` to re-export `EVENT_TYPES`.

## API / Events
- Unchanged; `{ EVENT_TYPES }` remains importable from `./core/EventManager.js`.

## Acceptance Criteria
- Build passes; all event types function identically.

## Test Plan
- Trigger representative events (FILE_*, VIEWPORT_*, POINT_*, STATUS_*, CANVAS_*); confirm listeners receive correct types.
