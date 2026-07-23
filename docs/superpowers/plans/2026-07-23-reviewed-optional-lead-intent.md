# Reviewed Optional Lead Intent Implementation Plan

> **For Codex:** Execute test-first and verify the branch independently from the reusable inference branch.

**Goal:** Represent and post an explicit reviewed choice to omit entry and/or exit geometry for the Robofil v2 lifecycle.

**Architecture:** Extend the canonical transition union with `none`, update transition mutation/validation/serialization in place, gate the choice through the machine envelope, and have the v2 post consume the canonical decision.

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

---

### Task 1: Add typed no-transition intent

**Files:**
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/path-intel/operationTransitions.ts`
- Modify: `src/domain/path-editor/pathDocumentOperations.ts`
- Modify: domain tests

1. Add failing tests for reviewed none entry/exit and replacement of an existing lead.
2. Extend canonical types and transition helpers.
3. Make mutation, refresh, metrics, and coordinate validation understand point-free transitions.
4. Run focused domain tests.

### Task 2: Validate and post the Robofil v2 policy

**Files:**
- Modify: `src/domain/compensation/robofilV2LeadValidation.ts`
- Modify: `src/domain/post/upidMachinePost.ts`
- Modify: compensation and post tests

1. Add failing cases for missing and unreviewed decisions.
2. Add a ready case with reviewed no-entry/no-exit.
3. Remove the post's assumption that every v2 operation has a lead override.
4. Verify no fabricated lead-in or lead-out move is emitted.

### Task 3: Preserve portable UPID integrity

**Files:**
- Modify: `src/domain/upid/validateUpidDocument.ts`
- Modify: `src/domain/upid/portableUpidV1Shape.ts`
- Modify: UPID validation and portability tests

1. Add fixtures containing reviewed none intents.
2. Accept only the exact none shape and valid review values.
3. Verify portable round trips retain intent.

### Task 4: Expose reviewed choices in Entry/Exit

**Files:**
- Modify: `src/features/editor/EditorEntryExitPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: editor component/integration tests

1. Add failing tests for machine-gated controls.
2. Add no-entry/no-exit actions and explicit decision labels.
3. Route actions through the canonical transition mutation.
4. Verify geometric choices replace none and vice versa.

### Task 5: Verify and commit

1. Run focused compensation, post, UPID, and editor tests.
2. Run `npm test -- --run`.
3. Run `npm run build`.
4. Inspect for duplicate compatibility state.
5. Commit the branch.
