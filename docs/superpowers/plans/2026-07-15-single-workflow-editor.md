# Single-Workflow Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every editor capability one canonical doorway and enforce exactly one saveable/discardable workflow panel at a time.

**Architecture:** Add a pure workflow lifecycle model and transition-warning component, then integrate one active workflow into `EditorPage`. Existing domain edit functions continue to produce immutable documents, but active workflow edits are provisional and bypass global history until workflow Save commits one opening snapshot. Existing panel components are regrouped by responsibility and rendered only for the active workflow; the quick toolbar, Panels selector, Path Actions hub, and duplicate global controls are removed.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, Vitest, existing shadcn-compatible primitives.

## Global Constraints

- Every capability has exactly one canonical doorway.
- Exactly one workflow panel may be visible at a time.
- Dirty close/switch warning actions are `Save` and `Discard`; the warning `X` stays in the current workflow.
- Workflow Save commits one labelled Undo transaction; Discard restores the opening document/selection with no Undo entry.
- Panel docking/floating/moving/resizing is layout-only.
- Header Undo/Redo is the sole global history surface; Header Save is the sole Path Project persistence surface; Cut Sequence is the sole Path Project reorder surface.
- Preserve all current domain, persistence, post, controller-safety, and local-first behavior.
- Preserve existing user/uncommitted files and stage only task-owned changes.

---

### Task 1: Pure workflow lifecycle and transition warning

**Files:**
- Create: `src/features/editor/workflows/editorWorkflowSession.ts`
- Create: `src/features/editor/workflows/editorWorkflowSession.test.ts`
- Create: `src/features/editor/EditorWorkflowTransitionDialog.tsx`
- Create: `src/features/editor/__tests__/EditorWorkflowTransitionDialog.test.tsx`

**Interfaces:**
- Produces `EditorWorkflowSession`, `EditorWorkflowTransitionRequest`, `createEditorWorkflowSession`, `markEditorWorkflowDirty`, `requestEditorWorkflowTransition`, `dismissEditorWorkflowTransition`, and `resolveEditorWorkflowTransition`.
- Produces `EditorWorkflowTransitionDialog` with `open`, `workflowLabel`, `nextWorkflowLabel`, `saveAvailability`, `onSave`, `onDiscard`, and `onDismiss` props.

- [ ] Write reducer/model tests proving clean close, dirty held close/switch, Save resolution, Discard resolution, disabled Save reason, and X/dismiss preserving the session.
- [ ] Run `npm test -- --run src/features/editor/workflows/editorWorkflowSession.test.ts` and verify failures occur because the lifecycle module does not exist.
- [ ] Implement the smallest pure lifecycle model that satisfies the tests.
- [ ] Run the focused lifecycle test and verify it passes.
- [ ] Write component tests proving the dialog renders only Save and Discard action buttons, exposes the disabled Save reason, and the X calls only `onDismiss`.
- [ ] Run `npm test -- --run src/features/editor/__tests__/EditorWorkflowTransitionDialog.test.tsx` and verify the component is missing.
- [ ] Implement the dialog with existing primitives and accessible labels.
- [ ] Run both focused test files and `npm run build`.
- [ ] Commit only Task 1 files with `feat: add editor workflow lifecycle`.

### Task 2: Integrate a singleton provisional workflow into EditorPage

**Files:**
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/commands/editorCommands.ts`
- Modify: `src/features/editor/commands/editorCommands.test.ts`
- Modify: `src/features/editor/commands/editorToolSession.ts`
- Modify: `src/features/editor/workspace/editorWorkspaceLayout.ts`
- Modify: `src/features/editor/workspace/editorWorkspaceLayout.test.ts`
- Test: `src/__tests__/appDxfProjects.test.tsx`
- Test: `src/__tests__/editorPathNativeDraft.test.tsx`

**Interfaces:**
- Consumes Task 1 lifecycle types and dialog.
- Produces one `activeWorkflowSession`, an opening `EditorDraftSnapshot`, provisional `applyEditorDraftState` behavior, and Save/Discard transition resolvers.
- Produces `openEditorWorkflow(commandId)`, `requestCloseEditorWorkflow()`, and exactly-one-panel placement normalization.

- [ ] Add failing application tests: one menu command opens one panel; opening another clean workflow replaces it; dirty switch holds the second workflow behind the warning; X stays; Discard restores; Save commits one Undo entry after multiple edits.
- [ ] Run the two focused application test files and verify the new assertions fail against the multi-panel/direct-history implementation.
- [ ] Integrate the lifecycle with `EditorPage`, capture opening document/selection state, and make document mutations provisional while a mutating workflow owns them.
- [ ] Route workflow Save to one global history snapshot and workflow Discard to opening-snapshot restoration.
- [ ] Make layout state remember placement but normalize rendered placement so only the active panel is visible.
- [ ] Route panel close through the workflow transition request.
- [ ] Run the focused application, command, and layout tests; fix regressions without weakening the invariant.
- [ ] Run `npm run build`.
- [ ] Commit only Task 2-owned files with `feat: enforce one active editor workflow`.

### Task 3: Make menus the sole workflow launch surface

**Files:**
- Modify: `src/features/editor/EditorWorkflowMenuBar.tsx`
- Modify: `src/features/editor/__tests__/EditorWorkflowMenuBar.test.tsx`
- Modify: `src/features/editor/EditorHeaderBar.tsx`
- Modify: `src/features/editor/EditorWorkspacePanels.tsx`
- Modify: `src/features/editor/__tests__/EditorWorkspacePanels.test.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Test: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes Task 2 `openEditorWorkflow` behavior.
- Produces the canonical Geometry, Machining, Construction, View, Machine, and Export menus.
- Removes `EditorPanelToolbar`, quick panel icons, and the Panels selector from Path Project header composition.

- [ ] Add failing tests proving the quick icons and Panels selector are absent, Path Project header Export is absent, each canonical command opens its sole workflow, and no empty Project menu renders.
- [ ] Run focused menu/header/workspace tests and verify the old duplicate surfaces cause failures.
- [ ] Remove the duplicate toolbar/selector render path and route every retained menu command through the workflow lifecycle.
- [ ] Keep panel chrome layout controls only for the active panel.
- [ ] Update header composition so Path Project retains Back/identity/Undo/Redo/Save/Help while Export is menu-owned.
- [ ] Run focused tests and `npm run build`.
- [ ] Commit Task 3-owned files with `refactor: make workflows the sole editor entry points`.

### Task 4: Regroup Path Actions into dedicated responsibilities

**Files:**
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorEntryExitPanel.tsx`
- Modify: `src/features/editor/EditorInspectorPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/__tests__/EditorEntryExitPanel.test.tsx`
- Modify: `src/features/editor/__tests__/EditorWorkspacePanels.test.tsx`
- Modify: `src/__tests__/appDxfProjects.test.tsx`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`

**Interfaces:**
- Removes the `path-actions` capability hub.
- Produces dedicated Geometry Setup, Contour Setup, Cut Sequence, Entry/Exit & Rethreading, and Measurement & Construction workflow content.
- Makes each current Path Actions handler reachable from exactly one new home.

- [ ] Add failing tests for the control migration ledger: no panel-local Save/Export/Start/Pierce; planning controls only in Cut Sequence; role/compensation/reverse only in Contour Setup; Geometry Basis only in Geometry Setup; planned rapid/manual entry only in Entry/Exit; Perpendicular/Tangent only in Construction.
- [ ] Run focused component/application tests and verify old mixed controls fail the assertions.
- [ ] Refactor focused render sections without changing domain handler semantics.
- [ ] Remove the `path-actions` panel ID, default placement, menu command, title, and description after all controls have canonical homes.
- [ ] Run focused tests, then search actionable JSX and reconcile every result against `docs/superpowers/2026-07-15-editor-control-migration-ledger.md`.
- [ ] Run `npm run build`.
- [ ] Commit Task 4-owned files with `refactor: regroup editor controls by workflow`.

### Task 5: Enforce workflow ownership for all mutations and canvas modes

**Files:**
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/EditorPreview.tsx`
- Modify: `src/features/editor/EditorCanvasPanel.tsx`
- Modify: `src/features/editor/EditorInitialWirePositionPanel.tsx`
- Modify: `src/features/editor/EditorEntryExitPanel.tsx`
- Modify: `src/features/editor/EditorMachiningParticipationPanel.tsx`
- Modify: `src/features/editor/EditorProgramStopsPanel.tsx`
- Modify: `src/features/editor/EditorInspectorPanel.tsx`
- Modify: relevant component tests under `src/features/editor/__tests__/`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`
- Modify: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes Task 2 provisional workflow boundary.
- Gates geometry drag/center movement to Transform, point placement to Construction, start picking to Set Start, and workflow panel mutations to their active command IDs.
- Produces Save/Cancel controls and validation-backed save availability for every mutating workflow.

- [ ] Add failing ownership tests showing canvas drag is inert outside Transform, point placement is inert outside Construction, endpoint start is inert outside Set Start, and hidden workflow handlers cannot mutate the document.
- [ ] Add failing dirty/save tests for Initial Wire Position, Entry/Exit, Program Stops, Participation, Cut Sequence, Contour Setup, Geometry Setup, Transform, and Construction.
- [ ] Run focused tests and verify they fail against direct handler access.
- [ ] Add workflow ownership guards and workflow-local Save/Cancel controls.
- [ ] Derive Save availability from each workflow's prerequisites/validation and surface concrete reasons in the transition warning.
- [ ] Run all focused workflow/component/application tests and `npm run build`.
- [ ] Commit Task 5-owned files with `feat: bind editor mutations to active workflows`.

### Task 6: Remove Machine Program and residual duplicates

**Files:**
- Modify: `src/features/editor/EditorProgramLinesPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: related Machine Program tests under `src/__tests__/`
- Modify: `docs/superpowers/2026-07-15-editor-control-migration-ledger.md`

**Interfaces:**
- Removes Program Lines Undo/Redo/Save/Export duplicates while retaining text-specific editing, ordering, normalization, pins, and Set Start.
- Completes every ledger row and marks completion checks.

- [ ] Add failing Machine Program tests proving Header is the only history/save/export surface and line-specific functions remain available.
- [ ] Run the focused tests and verify duplicated toolbar actions cause failures.
- [ ] Remove duplicate props/buttons and keep Machine Program-specific controls intact.
- [ ] Search all editor actionable JSX, update the ledger with final locations/dispositions, and fail the task if an unassigned control or duplicate doorway remains.
- [ ] Run focused tests and `npm run build`.
- [ ] Commit Task 6-owned files with `refactor: remove residual editor control duplication`.

### Task 7: Full verification and interaction acceptance

**Files:**
- Modify only files required to fix verified regressions.
- Test: relevant `src/**/__tests__/*.test.ts(x)` and existing e2e coverage when available.

**Interfaces:**
- Produces verified single-workflow interaction behavior without changing domain/post output.

- [ ] Run focused workflow tests together and record total passing files/tests.
- [ ] Run `npm test -- --run` and require zero failures.
- [ ] Run `npm run build` and require exit code 0.
- [ ] Run `git diff --check` and require no whitespace errors.
- [ ] Start the Vite app and verify at desktop widths that only one workflow panel can be visible, no quick icons/Panels selector render, Save/Discard/X behave correctly, and workflow switching never overlaps panels.
- [ ] Re-run controller-sensitive post, persistence, and portable-UPID focused suites after UI fixes.
- [ ] Request independent whole-branch review, resolve all Critical/Important findings, and rerun affected tests.
- [ ] Update the control migration ledger completion checks only after the final JSX/control audit passes.

