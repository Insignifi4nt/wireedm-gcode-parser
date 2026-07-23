# Machining Transition Ownership Implementation Plan

Status: implemented and verified.

> **For Codex:** Execute this plan with the `superpowers:executing-plans` and `superpowers:test-driven-development` skills. Keep the approved design, implementation, and tests in the existing review commit by amending it once verification is complete.

**Goal:** Separate program origin, contour starts, cut entry/exit geometry, and between-contour travel so each concept has one authoritative model and one clear editor surface.

**Architecture:** `PathOperation.transitions` becomes the runtime source of truth for cut entry and exit geometry. Planned rapids are derived from the program origin, preceding operation exit, current operation entry, and threading state; they are never directly editable. The editor presents three distinct workflows—Contour Start, Entry / Exit, and Between Contours—with contextual prerequisites and pointer-to-contour perpendicular projection for nearest-point picking.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library.

---

## Task 1: Make operation transitions and planned rapids authoritative

**Files:**
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/path-intel/operationTransitions.ts`
- Modify: `src/domain/path-editor/pathDocumentOperations.ts`
- Modify: transition consumers found under `src/domain/`
- Test: `src/domain/path-editor/__tests__/pathDocumentOperations.test.ts`
- Test: relevant transition, compensation, threading, and postprocessor tests under `src/domain/**/__tests__/`

1. Add failing regression tests proving:
   - the first planned rapid is derived from reviewed initial wire to the first operation entry;
   - later planned rapids are derived from the preceding resolved exit to the next resolved entry;
   - planned rapid endpoints have no public mutator;
   - transition entry/exit data, rather than `overrides.leadIn`, drives geometry, validation, and output.
2. Run the focused tests and confirm the new assertions fail for the expected ownership violations.
3. Remove the planned-rapid endpoint mutation APIs and their editor-facing exports.
4. Migrate runtime transition consumers to `operation.transitions`; retain at most a single explicit document-load normalization boundary if stored documents require migration, without maintaining dual runtime state.
5. Run the focused domain tests, then the related postprocessor and compensation suites.

## Task 2: Correct Contour Start inference and workflow state

**Files:**
- Modify: `src/domain/path-editor/pathPointInference.ts`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/EditorWorkflowSetupPanels.tsx`
- Modify: `src/features/editor/EditorPreview.tsx`
- Test: `src/domain/path-editor/__tests__/pathPointInference.test.ts`
- Test: `src/features/editor/__tests__/EditorWorkflowSetupPanels.test.tsx`
- Test: `src/__tests__/editorPathNativeDraft.test.tsx`

1. Add failing tests proving:
   - cursor-nearest inference projects the pointer onto the hovered contour;
   - perpendicular inference locks to the hovered side and projects the applicable approach source onto it;
   - every inference mode previews the approach-source-to-candidate guide;
   - opening Contour Start or changing inference mode does not create an unsaved document change;
   - explicit picking only begins when the user selects the pick action;
   - each operation retains an automatic usable start when no explicit override is set.
2. Run the focused tests and verify the current initial-wire-dependent behavior and dirty workflow fail them.
3. Separate cursor-nearest and approach-perpendicular into accurately named Contour Start options.
4. Select midpoint/perpendicular candidates by the hovered side before calculating the exact snap point.
5. Change Contour Start copy and controls to explain automatic versus explicit starts and to initiate picking only from a clear action.
6. Run the focused inference and editor interaction tests.

## Task 3: Split cut transitions from between-contour travel

**Files:**
- Modify: `src/features/editor/EditorEntryExitPanel.tsx`
- Add or Modify: `src/features/editor/EditorBetweenContoursPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: relevant editor panel/configuration types
- Test: `src/features/editor/__tests__/EditorEntryExitPanel.test.tsx`
- Add or Modify: `src/features/editor/__tests__/EditorBetweenContoursPanel.test.tsx`
- Test: relevant workspace/menu tests under `src/features/editor/__tests__/`

1. Add failing component tests proving:
   - Entry / Exit contains only cut entry and cut exit configuration;
   - planned rapid geometry is read-only and appears under Between Contours;
   - threading/rethreading belongs to Between Contours and is shown only where relevant;
   - the first connection is identified as Program Start / G92, while later connections identify their preceding operation.
2. Run the focused component tests and confirm the existing mixed panel fails.
3. Remove editable rapid coordinate controls and their handlers from Entry / Exit.
4. Create the Between Contours panel using derived rapid routes and existing threading controls.
5. Update command/menu order to: Contour Setup, Contour Start, Cut Sequence, Program Start / G92, Entry / Exit, Between Contours, Participation, Stops.
6. Add concise status and prerequisite text so disabled actions point to the panel that resolves the prerequisite.
7. Run the focused panel and editor layout tests.

## Task 4: Align validation, postprocessing, and user steering

**Files:**
- Modify: transition-related validators and postprocessors under `src/domain/`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: relevant status/rail components under `src/features/editor/`
- Test: existing export, validation, and app integration suites

1. Add or update regression tests for:
   - no lead is required solely to export a valid contour;
   - a configured entry begins at its source, cuts to the contour start, and a configured exit cuts away from the contour;
   - later operations derive travel from the preceding resolved exit;
   - missing initial wire affects only Program Start / G92-specific setup and does not disable contour-start inference.
2. Run the focused suites and confirm any remaining coupling fails.
3. Update validation and status messages to name the owning workflow and the exact corrective action.
4. Ensure post output follows the canonical sequence: G92 once, threading/separation lifecycle, derived rapid to entry/start, compensation, cut entry, contour, cut exit.
5. Run all affected domain and integration tests.

## Task 5: Integrated verification and single-commit handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-machining-transition-ownership-design.md` only if implementation reveals an approved-design wording correction
- Modify: this plan only if actual file ownership differs materially

1. Run `npm test -- --run`.
2. Run `npm run build`.
3. Use the collaborative browser against the existing development server to verify:
   - Contour Start opens clean and explains automatic versus explicit selection;
   - every Contour Start mode shows its approach guide while hovering;
   - perpendicular locks to the hovered side and commits the true foot from the applicable approach source;
   - Entry / Exit has no rapid controls;
   - Between Contours shows derived travel and threading separately;
   - Program Start / G92 remains the only project-origin workflow.
4. Inspect `git diff --check`, `git status --short`, and the final diff for accidental compatibility duplication or unrelated edits.
5. Amend commit `92ee3cd` with the complete implementation and a message describing the ownership refactor.
