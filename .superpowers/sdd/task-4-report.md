# Task 4 Report: Regroup editor controls by workflow

## Status

Complete. The mixed `path-actions` capability hub and its `path-hover-assist` companion were removed from the production panel registry, command registry, default layout, titles, descriptions, and guide copy.

## Responsibility mapping implemented

- Geometry Basis -> `Geometry > Geometry Setup` / `geometry-setup`.
- Reverse, Contour Role, and Compensation -> `Machining > Contour Setup` / `contour-setup`.
- Set Start target, instructions, magnetic split option, and workflow-local repick -> `Machining > Set Start` / `set-start`.
- Planning strategy, reapply, and row ordering -> `Machining > Cut Sequence` / `cut-sequence`.
- Planned rapid source/destination, manual entry from destination, circle-center/manual entry, exit, and threading -> `Machining > Entry / Exit & Rethreading` / `entry-exit`.
- Perpendicular, Tangent, measurement authoring, and their consumed magnetic option -> `Construction > Measurement & Construction` / `measurement`.
- Passive canvas hover cross-highlighting -> `View > Contour Tree`; the former mixed Hover / Snap command and panel were removed.
- Project persistence remains Header Save; controller preview/download remains the Export workflow. The former panel-local Save and Export actions were removed.

The previous controller-compensation safety guard for circle-center entry, compensation review fields, exact rapid editing, and Set Start split/existing-point behavior remain covered.

## Review fixes

- Workflow-local fallback targets are now explicit mutation inputs. Contour Setup, Entry / Exit, and Set Start pass the operation ID they display rather than relying on a possibly null or stale parent selection.
- Set Start can open without a preselected operation and selects the first closed contour as its workflow target. Selecting another contour updates both the displayed target and the active canvas tool target.
- The Contour Tree no longer exposes `Set path start to this point`. Endpoint rows remain selection/navigation controls; Set Start plus the canvas is the sole mutation doorway.
- Existing-point provenance and export metadata coverage now performs the mutation through the canonical Set Start canvas workflow.
- Set Start endpoint interaction is scoped to the panel-selected contour. Other contours remain visible for context, but their endpoint handles are marked disabled, consume clicks without invoking canvas picking, and are rejected again by the mutation guard.

## TDD evidence

### RED

Command:

```text
npm test -- --run src/__tests__/appDxfProjects.test.tsx -t "regroups every former Path Actions control"
```

Expected failure observed:

```text
AssertionError: expected [ 'geometry.transform', … ] to include 'geometry.setup'
```

This proved the new control-responsibility test failed against the old mixed registry before production changes.

### GREEN: focused Task 4 suite

Command:

```text
npm test -- --run src/features/editor/__tests__/EditorEntryExitPanel.test.tsx src/features/editor/__tests__/EditorWorkspacePanels.test.tsx src/__tests__/appDxfProjects.test.tsx src/__tests__/editorPathNativeDraft.test.tsx
```

Result:

```text
Test Files  4 passed (4)
Tests       139 passed (139)
```

### RED: review regressions

Command:

```text
npm test -- --run src/features/editor/__tests__/EditorWorkflowSetupPanels.test.tsx src/features/editor/__tests__/EditorEntryExitPanel.test.tsx src/__tests__/appDxfProjects.test.tsx
```

Observed failures proved all three target-identity bugs: Contour Setup received a click event instead of `op_0001`, Set Start received a click event instead of `op_0001`, and planned rapid editing received only the point instead of the displayed operation ID.

### GREEN: review-focused suite

Command:

```text
npm test -- --run src/features/editor/__tests__/EditorWorkflowSetupPanels.test.tsx src/features/editor/__tests__/EditorEntryExitPanel.test.tsx src/__tests__/editorPathNativeDraft.test.tsx src/__tests__/appDxfProjects.test.tsx
```

Result:

```text
Test Files  4 passed (4)
Tests       136 passed (136)
```

### GREEN: cross-contour Set Start guard

Command:

```text
npm test -- --run src/__tests__/editorPathNativeDraft.test.tsx src/__tests__/editorPreviewControls.test.tsx src/__tests__/appDxfProjects.test.tsx
```

Result:

```text
Test Files  3 passed (3)
Tests       146 passed (146)
```

### GREEN: full regression suite

Command:

```text
npm test -- --run
```

Result:

```text
Test Files  79 passed (79)
Tests       1251 passed (1251)
```

### Build

Command:

```text
npm run build
```

Result: TypeScript and Vite build passed. Vite reported only the existing chunk-size advisory; the production bundle was emitted successfully.

## Search and ledger reconciliation

Production editor search returns no `path-actions`, `Path Actions`, `geometry.path-actions`, `construction.hover-assist`, `path-hover-assist`, `Save Path Plan`, or `Set path start from canvas` references.

Named actionable-control search finds each migrated control only in its canonical component:

- `EditorWorkflowSetupPanels.tsx`: Geometry Basis, Reverse, Contour Role, Compensation, Set Start magnetic option.
- `EditorPathNavigatorPanel.tsx`: planning strategy/reapply and Cut Sequence ordering.
- `EditorEntryExitPanel.tsx`: planned rapid/manual entry/circle-center entry/exit/threading.
- `EditorInspectorPanel.tsx`: Perpendicular/Tangent/measurement and construction magnetic option.

## Concerns / next boundary

- Task 5 still owns the complete canvas and inactive-hidden-handler ownership sweep. Task 4 removed the Contour Tree Set Start mutation doorway and intentionally does not redesign every hidden registry render or all canvas mutation guards.
- Measurement points remain editor-local workspace data, so the Measurement & Construction session is currently classified as a view workflow; document mutations are not introduced there.
- Existing Vite chunk-size advisory remains unrelated to this task.
