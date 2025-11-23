# PR3: Extract EventValidator

## Summary
Move event data validation logic into `src/core/events/EventValidator.js` (depends on EventTypes + EventSchemas) and re-export from EventManager.

## Motivation
Isolate validation to make it testable and maintainable independently from the bus implementation.

## Scope
- In: Add `EventValidator.js` with current `validate` and `getSchema` behavior.
- In: Update `EventManager.js` to use and re-export EventValidator.

## Acceptance Criteria
- Build passes; validation messages and behavior identical.

## Test Plan
- Emit a set of events with valid/invalid payloads and confirm behavior matches current implementation.

