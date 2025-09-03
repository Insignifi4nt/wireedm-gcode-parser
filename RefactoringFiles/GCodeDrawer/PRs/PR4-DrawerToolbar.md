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
- Buttons trigger the same actions as before; disabled/enabled states match logic.
- Context toolbar shows/hides based on selection count.

## Test Plan
- Verify all toolbar actions including bulk delete confirmation.
- Toggle drawer open/close; keyboard shortcuts remain functional.

## Risks & Mitigations
- Wiring mistakes: centralize toolbar state updates in one place after each operation.

