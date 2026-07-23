# Reusable Path-Point Inference Implementation Plan

> **For Codex:** Follow test-driven development task by task and verify the complete branch before claiming completion.

**Goal:** Replace workflow-specific path projection with one typed inference engine and expose midpoint/perpendicular selection where it is useful.

**Architecture:** A pure domain module owns segment projection, midpoint, perpendicular, tangent, fallback, and candidate ranking. Editor workflow code consumes typed candidates and commits the previewed identity through narrow path-document operations.

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

---

### Task 1: Establish the shared inference contract

**Files:**
- Create: `src/domain/path-editor/pathPointInference.ts`
- Create: `src/domain/path-editor/__tests__/pathPointInference.test.ts`

1. Add failing tests for endpoint, nearest, midpoint, perpendicular, tangent, fallback, arc bounds, and operation filters.
2. Run the focused test and confirm the new behavior is absent.
3. Implement the typed candidate model and pure inference functions.
4. Run the focused test and confirm it passes.

### Task 2: Replace Construction geometry

**Files:**
- Modify: `src/domain/path-editor/pathDocumentOperations.ts`
- Modify: `src/domain/editor/measurementPoints.ts`
- Modify: `src/domain/path-editor/__tests__/pathDocumentOperations.test.ts`

1. Add regression assertions that Construction results retain relation, source, guide-relevant identity, and fallback behavior.
2. Remove the local projection and tangent implementations.
3. Route Construction and stored-snap sliding through the shared module.
4. Run focused domain tests.

### Task 3: Add Set Start inference modes

**Files:**
- Modify: `src/features/editor/EditorWorkflowSetupPanels.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/domain/path-editor/pathDocumentOperations.ts`
- Modify: `src/features/editor/__tests__/EditorWorkflowSetupPanels.test.tsx`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`

1. Add failing tests for mode selection, midpoint preview/commit, and perpendicular preview/commit from reviewed initial wire.
2. Add a typed Set Start mode control.
3. Build previews with the shared engine, scoped to the selected operation.
4. Commit the stored preview candidate through a segment-identity operation.
5. Render relation and guide feedback.
6. Run focused UI and integration tests.

### Task 4: Reuse perpendicular inference for Entry/Exit

**Files:**
- Modify: `src/features/editor/EditorEntryExitPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: relevant editor integration tests

1. Add failing tests for constrained entry and exit preview/commit.
2. Reuse the shared perpendicular candidate with operation start/end as source.
3. Commit the displayed candidate into the corresponding straight transition.
4. Run focused tests.

### Task 5: Verify and commit

1. Run all path-editor and editor workflow tests.
2. Run `npm test -- --run`.
3. Run `npm run build`.
4. Inspect the diff for duplicate projection/tangent implementations.
5. Commit the independently reviewable branch.
