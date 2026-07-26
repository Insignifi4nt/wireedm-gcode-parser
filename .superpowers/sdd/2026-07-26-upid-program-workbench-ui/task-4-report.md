# Task 4 report — persistent UPID rail and conditional workspace layout

## RED evidence

Added the required layout migration and imported-path-project integration assertions first.

```text
npm test -- --run src/features/editor/workspace/editorWorkspaceLayout.test.ts src/__tests__/editorDensityCleanup.test.tsx

2 failed / 9 passed
- legacy `docked-left` placement remained left instead of floating
- imported path project did not render `role=tree` with `UPID program sequence`
```

## GREEN implementation

- Path projects register `EditorUpidRail` as persistent app-rail content. Program is the default lens and uses `buildUpidProgramTree`; Geometry mounts the existing contour navigator only while that lens is active.
- Tree action routing retains the explicit Task 3 target path. Operation selection updates the real operation selection.
- Legacy `docked-left` placements normalize to `floating`, retaining their remembered floating geometry; hidden and right-docked placements remain unchanged.
- Workflow placement controls are Float, Dock Right, and Close. The old left dock is no longer rendered or a drag target.
- The right dock mounts only for an active workflow normalized as `docked-right`; closing it removes dock chrome and restores a one-column main grid.
- App rail sizing is controlled by the persisted editor workspace layout through `AppRailContent.sizing`: 190–360px, default 260px desktop / 220px laptop.

## Verification

```text
npm test -- --run src/features/editor/workspace/editorWorkspaceLayout.test.ts src/__tests__/editorDensityCleanup.test.tsx
PASS 11 tests

npm test -- --run src/features/editor/workspace/editorWorkspaceLayout.test.ts src/__tests__/editorDensityCleanup.test.tsx src/__tests__/editorPathNativeDraft.test.tsx
PASS 91 tests

npm run build
PASS (Vite reports the pre-existing >500kB chunk-size advisory)

git diff --check
PASS
```

## Playwright / port discipline

Before each Playwright run, `lsof -nP -iTCP:3107 -sTCP:LISTEN` returned no listener. The final planned command passed:

```text
npx playwright test e2e/editor-workspace-panels.spec.ts --workers=1
1 passed (4.5s)
```

An initial browser run exposed stale test setup, not a product issue: onboarding intercepted a direct tree click. The focused spec now dismisses onboarding after import and exercises the visible tree Entry/Exit action. An obsolete symmetric-dock/panel-toolbar suite was replaced with the requested persistent-rail/right-dock journey because that toolbar and left-dock model are intentionally removed.

## Self-review

- DOM layout: no initial left or right empty dock placeholders; right dock appears only while Entry / Exit is right-docked and disappears on close.
- Migration: left-docked stored panels normalize to floating without changing floating geometry; hidden/right values are preserved.
- Selection/routing: operation-row selection targets the real operation; Entry/Exit tree action uses the typed atomic routing path.
- Non-path editor: the generic AppShell fallback rail and machine-program inspector path remain in place; focused native-draft tests pass.
- Diff hygiene: `git diff --check` passes.

## Commit

`refactor: make UPID rail the path workspace anchor` (final hash supplied in task handoff)
