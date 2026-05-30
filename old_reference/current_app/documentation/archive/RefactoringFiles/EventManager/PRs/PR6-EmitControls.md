# PR6: Extract EmitControls

## Summary
Move emission control helpers (debounce, rateLimit, deduplicate) into `src/core/events/EmitControls.js` and re-export from `src/core/EventManager.js`.

## Motivation
Reduce EventManager size, isolate concerns, and make testing of helpers independent.

## Scope
- In: Add `EmitControls.js` with debounce, rateLimit, deduplicate.
- In: Update `EventManager.js` to re-export `EmitControls` (namespace or named functions).
- Out: No signature changes to helpers.

## Changes
- Add `src/core/events/EmitControls.js`.
- Update `src/core/EventManager.js` to re-export `EmitControls`.

## API / Events
- Unchanged; `{ EmitControls }` becomes available via `./core/EventManager.js`.

## Acceptance Criteria
- Build passes; existing imports in Mouse/Touch/Keyboard handlers continue to work.

## Test Plan
- Interact with canvas (mouse move/click, pan/zoom keys); verify emissions behave with debouncing/rate limits when applied.
