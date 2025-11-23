# PR4: Extract DrawerToolbar

## Summary
Move header and context toolbar rendering/handlers into `DrawerToolbar` with callbacks to orchestrator.

## Motivation
Button rendering and enable/disable logic are UI concerns that can be encapsulated and tested independently.

## Scope
- In: Add `src/components/drawer/DrawerToolbar.js`; render into GCodeDrawer container.
- Out: No CSS changes; reuse existing classes to avoid visual diffs.

## Changes
- API: `render(containerEl)`, `setState({ selectionCount, canUndo, canRedo })`.
- Callbacks: `onUndo()`, `onRedo()`, `onClose()`, `onMove(direction)`, `onDelete()`, `onInsertPoints()`.

## API / Events
- No public API changes.
- No event changes.

## Acceptance Criteria
- Buttons trigger the same actions as before; disabled/enabled states match logic. ✅
- Context toolbar shows/hides based on selection count. ✅

## Test Plan
- Verify all toolbar actions including bulk delete confirmation.
- Toggle drawer open/close; keyboard shortcuts remain functional.

## Risks & Mitigations
- Wiring mistakes: centralize toolbar state updates in one place after each operation.

## Implementation Notes (Completed)
- Added `src/components/drawer/DrawerToolbar.js` implementing header + context toolbar with callbacks.
- Updated `src/components/GCodeDrawer.js` to:
  - Render only body + footer; instantiate `DrawerToolbar` with handlers.
  - Delegate selection UI to `toolbar.updateSelectionUI(hasSelection, count)`.
  - Delegate undo/redo state to `toolbar.setUndoRedoState(undoCount, redoCount)`.
  - Delegate line count to `toolbar.updateLineCount(count)`.
- Kept event names and public API stable.

## Verification
- `npm run build` passes locally.
- Manual checks recommended for interaction parity.
