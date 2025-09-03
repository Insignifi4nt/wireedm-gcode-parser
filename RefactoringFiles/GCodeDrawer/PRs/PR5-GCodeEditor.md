# PR5: Extract GCodeEditor

## Summary
Move line DOM construction, mapping, editing, event binding, renumbering, and debounced change emission into `GCodeEditor`.

## Motivation
This is the bulk of the component. Extracting it leaves `GCodeDrawer.js` as a thin orchestrator that wires modules and EventBus.

## Scope
- In: Add `src/components/drawer/GCodeEditor.js` and migrate logic from `GCodeDrawer.js`.
- Out: No changes to event names or the public API surface of `GCodeDrawer`.

## Changes
- API (editor → orchestrator callbacks):
  - `onHover(index)`, `onLeave()`, `onClick(index)` – forward to EventBus consumers.
  - `onEdited(text, { force })` – re-parse pipeline trigger.
- Expose helper methods used by orchestrator: `setContent(...)`, `getText()`, `insertLines(after, lines)`, `deleteLines(lineNums)`, `moveSelection(direction)`, `focusLine(n)`.

## API / Events
- `GCodeDrawer` retains: `setContent`, `insertPointsAt`, `getText`, `toggle`.
- Events unchanged.

## Acceptance Criteria
- Feature parity across: hover/click highlights, edits, sanitize, debounce, selection, move/delete/insert, undo/redo, keyboard shortcuts.
- Selection preservation after re-parse continues to work.

## Implementation Notes (Completed)
- Added `src/components/drawer/GCodeEditor.js` with line DOM, event binding, and command creation.
- Updated `src/components/GCodeDrawer.js` to instantiate the editor, delegate line rendering and command creation, and keep orchestration responsibilities.
- Toolbar (PR4), UndoRedoSystem (PR2), and MultiSelectHandler (PR3) remain integrated; events and API unchanged.

## Verification
- `npm run build` succeeds locally.
- Manual checks confirm parity for edit/paste sanitize, undo/redo, move/delete/insert, hover/click, and debounced content emission.

## Test Plan
- Repeat manual flows end-to-end with a sample G-code file.
- Verify `drawer:content:changed` triggers parse and `setContent` with `preserveHistory: true`.

## Risks & Mitigations
- Rebinding listeners: keep a single binding path inside editor; avoid duplicate handlers.
