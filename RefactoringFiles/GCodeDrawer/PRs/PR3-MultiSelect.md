# PR3: Extract MultiSelectHandler

## Summary
Move selection state and rules (single/toggle/range, clear, restore) into `MultiSelectHandler` to simplify `GCodeDrawer` and decouple DOM from selection logic.

## Motivation
Selection semantics are independent from rendering. A small module makes it easier to test and reason about selection.

## Scope
- In: Add `src/components/drawer/MultiSelectHandler.js`; wire it in.
- Out: No change to how selection is visually applied; DOM updates remain in the orchestrator/editor.

## Changes
- API: `selectSingle(n)`, `toggle(n)`, `selectRange(a,b)`, `clear()`, `getSelection()`, `setSelection(set)`.
- `GCodeDrawer.js` calls handler to compute next selection; then applies classes and updates toolbar state.

## API / Events
- No public API changes.
- No event changes.

## Acceptance Criteria
- Selection behavior identical (including ctrl/cmd toggle, shift-range, Escape clears).
- Context toolbar visibility and counters correct.

## Test Plan
- Click single; ctrl-click toggles; shift-click range at bounds.
- Delete and move with multiple selection.

## Risks & Mitigations
- Visual-logic drift: keep a single `_updateSelectionVisuals` that maps handler state to DOM.

