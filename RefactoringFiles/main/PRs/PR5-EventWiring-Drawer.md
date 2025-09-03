# PR5: Extract Drawer Workflows

## Summary
Move `drawer:*` events and re-parse-on-edit logic into `EventWiring.wireAll()`.

## Motivation
Keep editor ↔ canvas synchronization centralized and consistent.

## Scope
- In: `drawer:line:hover`, `drawer:line:leave`, `drawer:line:click`, `drawer:insert:points`, `drawer:content:changed` (normalize → parse → update canvas and drawer mapping; preserve undo history).

## Acceptance Criteria
- Hover/click highlights reflect in Canvas; inserts work; edits re-parse and keep mapping.
- Build passes.

## Test Plan
- Hover/click lines; insert clicked points; modify drawer text and observe live canvas/mapping updates.

