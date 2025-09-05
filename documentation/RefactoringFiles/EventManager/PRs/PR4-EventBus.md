# PR4: Extract EventBus

## Summary
Move the EventBus singleton and wrapper helpers into `src/core/events/EventBus.js` and re-export from `src/core/EventManager.js` for compatibility.

## Motivation
Clarify responsibilities and enable incremental migration without breaking imports.

## Scope
- In: Add `EventBus.js` (singleton, on/once/off/emit/delegate; internal instance of EventManager).
- In: Update `EventManager.js` to import and re-export `{ EventBus }`.
- Out: Do not change call sites yet; ensure re-exports keep current imports working.

## Changes
- Add `src/core/events/EventBus.js`.
- Update `src/core/EventManager.js` to re-export `EventBus`.

## API / Events
- Public API unchanged. `{ EventBus }` remains importable from `./core/EventManager.js`.

## Acceptance Criteria
- Build passes; app interacts with events identically (mouse, keyboard, toolbar, drawer).

## Test Plan
- Smoke test: file load emits FILE_*; toolbar emits VIEWPORT_*; drawer emits `drawer:*`; ensure listeners fire.
