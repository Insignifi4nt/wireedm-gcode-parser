# PR5: Extract DOMDelegation helpers

## Summary
Move DOM delegation handling (`delegate` and `_handleDelegatedEvent`) into `src/core/events/DOMDelegation.js` and re-export from EventManager.

## Motivation
Separate DOM concerns from the event bus core; make delegation optional/replaceable.

## Scope
- In: Add `DOMDelegation.js` encapsulating delegated listener registry and handler.
- In: Update `EventManager.js` to use and re-export delegation helpers.

## Acceptance Criteria
- Build passes; delegated events (e.g., drawer hover/click) still work.

## Test Plan
- Hover/click drawer lines to verify `drawer:line:*` events continue to emit correctly.

