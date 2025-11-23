# main.js Refactor Scope

Status: Completed (PR0–PR8)

## Goals
- Split `src/main.js` into smaller, cohesive modules without changing behavior.
- Improve readability, testability, and lifecycle clarity while preserving public behavior and DOM structure.

## Non-Goals (Phase 1)
- No UI/UX redesign, no event semantics changes, no renaming of DOM IDs/classes.
- No switching the app entrypoint (remains `src/main.js`).

## Constraints
- Keep imports stable for existing components; only `main.js` should change imports materially.
- Preserve `EventBus` flows and `EVENT_TYPES` usage; maintain drawer custom events (`drawer:*`).
- Keep DOM IDs/classes identical to avoid CSS/selector regressions.

## Moduleization Plan
- `core/AppOrchestrator.js` – App lifecycle (init/destroy), high-level state, orchestration.
- `core/ComponentInitializer.js` – DOM build + component instantiation.
- `core/EventWiring.js` – EventBus subscriptions and window listeners; returns cleanup.

## PR Sequence (expandable)
0. PR0: Scaffold files and JSDoc stubs (no wiring changes).
1. PR1: Extract DOM build to `ComponentInitializer.buildAppDOM()`.
2. PR2: Extract component instantiation to `ComponentInitializer.initComponents()`.
3. PR3: Extract core event wiring (file, canvas click->point add, points management).
4. PR4: Extract UI/viewport/status/grid/resize wiring.
5. PR5: Extract drawer workflows (`drawer:*`, reparse on edit).
6. PR6: Introduce `AppOrchestrator` and move orchestration inside; emit `APP_READY`.
7. PR7: Slim `src/main.js` to a bootstrap (init + destroy on unload).
8. PR8: Cleanup + docs sweep; verify unsubscribe/cleanup paths.
9+. Follow-ups if needed; unlimited PRs allowed to achieve clean code.

## Acceptance Criteria
- Behavior parity across file load, hover/click, points add/delete/clear, zoom/pan, status, export, resize, and drawer edit → reparse.
- `npm run build` passes after each PR; no duplicate listeners; performance unchanged.

Final Verification
- Confirmed parity for FILE_* workflows, drawer highlights/edits, viewport zoom/pan/reset/fit, status messages, export flows, resize.
- Verified single-source zoom handling and no duplicate listeners (PR8 cleanup).
- `destroy()` detaches integrations, unsubscribes EventBus, and clears DOM.

## Validation
- Manual smoke after each PR (as above). Keep `APP_READY` timing and payload unchanged.
