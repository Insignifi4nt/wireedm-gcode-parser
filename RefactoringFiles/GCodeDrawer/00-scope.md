# GCodeDrawer Refactor Scope

## Goals
- Reduce file size and cognitive load by separating concerns.
- Preserve current behavior and event contracts during the first pass.
- Create composable modules: Editor, Selection, Toolbar, Undo/Redo.

## Non-Goals (Phase 1)
- No UI redesign or CSS class/name changes.
- No change to EventBus API or event names.
- No feature additions; parity only.

## Constraints
- Keep public API used by `src/main.js` stable:
  - `setContent({ text, mapping, preserveHistory })`
  - `insertPointsAt(atIndex, points)`
  - `getText()`
  - `toggle(force)`
- Keep emitted/listened events stable:
  - Emits: `drawer:line:hover`, `drawer:line:leave`, `drawer:line:click`, `drawer:insert:points`, `drawer:content:changed`
  - Listens: `drawer:toggle`

## Moduleization Plan
- `src/components/drawer/GCodeEditor.js` – line DOM, mapping, editing, debounced change.
- `src/components/drawer/MultiSelectHandler.js` – selection state and rules.
- `src/components/drawer/DrawerToolbar.js` – header/context toolbar and buttons.
- `src/components/drawer/UndoRedoSystem.js` – command stack with limits.
- Keep `src/components/GCodeDrawer.js` as thin orchestrator.

## PR Sequence
1. [x] PR1: Extract sanitization helpers to `utils/Sanitize.js` and wire in. (completed)
2. [x] PR2: Introduce `UndoRedoSystem` and migrate stack logic. (completed)
3. [x] PR3: Extract `MultiSelectHandler` and migrate selection operations. (completed)
4. [ ] PR4: Extract `DrawerToolbar` and wire callbacks.
5. [ ] PR5: Extract `GCodeEditor` and finish orchestration cleanup.

## Acceptance Criteria
- No behavioral regressions in hover/click, selection, move, delete, insert points, keyboard shortcuts, and undo/redo.
- `GCodeDrawer.js` reduced to orchestration (≤ ~250 lines).
- `npm run build` passes; no new console errors in `npm run dev`.
- Event contracts unchanged; public API remains stable.
