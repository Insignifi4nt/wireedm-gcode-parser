# PR7: Extract EventHistory & Metrics

## Summary
Move event history tracking and simple metrics (listener count, event count) into `src/core/events/EventHistory.js` and re-export.

## Motivation
Keep observability decoupled from the core bus; enable optional instrumentation.

## Scope
- In: Add `EventHistory.js` to encapsulate `_recordEvent` and counters.
- In: Update `EventManager.js` to delegate history/metrics; re-export.

## Acceptance Criteria
- Build passes; history table/logs still available.

## Test Plan
- Trigger events and confirm history captures type, data, timestamp, listener count as before.

