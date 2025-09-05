# PR2: Extract EventSchemas

## Summary
Move `EVENT_DATA_SCHEMAS` into `src/core/events/EventSchemas.js` and re-export from `src/core/EventManager.js`.

## Motivation
Decouple payload schema definitions from implementation, enabling focused validation updates and testing.

## Scope
- In: Add `EventSchemas.js` exporting `EVENT_DATA_SCHEMAS`.
- In: Update `EventManager.js` to import schemas from new module and re-export.
- Out: No schema shape changes.

## Acceptance Criteria
- Build passes; schema-based validation continues to work.

## Test Plan
- Trigger events with good/bad payloads and confirm validation logs behave as before.

