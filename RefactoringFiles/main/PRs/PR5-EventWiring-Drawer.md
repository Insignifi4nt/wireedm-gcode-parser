# PR5: Extract Drawer Workflows

Status: Completed

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

Implementation Notes
- Implemented as part of commit 65f241b (combined EventWiring extraction).
- Wired `drawer:line:*`, `drawer:insert:points`, and debounced `drawer:content:changed` → normalize → parse → set content (preserving history) → redraw.

Verification
- Hover/click highlights reflect in Canvas; edits re-parse and maintain mapping and undo stack.
