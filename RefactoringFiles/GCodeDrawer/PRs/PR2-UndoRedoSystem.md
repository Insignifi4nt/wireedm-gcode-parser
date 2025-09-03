# PR2: Introduce UndoRedoSystem

## Summary
Create `UndoRedoSystem` to manage command history with size limits; migrate `_pushCommand`, `_undo`, `_redo` and related button state logic out of `GCodeDrawer.js`.

## Motivation
Undo/redo is a distinct concern. Moving it enables simpler editor/selection code and consistent history behavior.

## Scope
- In: Add `src/components/drawer/UndoRedoSystem.js`; update `GCodeDrawer.js` to use it.
- Out: No new command types; keep existing delete/insert/move/edit commands as-is.

## Changes
- `UndoRedoSystem` API: `push(cmd)`, `undo()`, `redo()`, `canUndo()`, `canRedo()`, `clear()`, `setMax(size)`.
- `GCodeDrawer.js` subscribes to system state to enable/disable toolbar buttons.

## API / Events
- No public API changes.
- No event changes.

## Acceptance Criteria
- Undo/redo sequences identical to current behavior, including selection preservation for move.
- History limit respected (default 50).
- Buttons reflect stack state accurately.

## Test Plan
- Create edit/delete/insert/move, then undo/redo through the stack.
- Verify move commands preserve selection post-parse (capture/restore).

## Risks & Mitigations
- Divergence in stack state vs. UI: derive UI state from `canUndo/canRedo` only.

