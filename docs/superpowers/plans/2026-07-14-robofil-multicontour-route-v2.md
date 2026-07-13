# Robofil Multi-Contour Route V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a versioned Robofil v2 multi-contour post, editable optimized travel, browser-agent controls, and verified Prisma test artifacts.

**Architecture:** Keep Robofil v1 immutable. Add a v2 operation-scoped lifecycle with structured G39/G40/G0 boundaries, separate planned and posted travel projections, and canonical rapid editing through document/operation starts. Use the real Prisma DXF as a placement and export acceptance fixture.

**Tech Stack:** React, TypeScript, Vite, Vitest, Playwright, browser-cache storage.

## Global Constraints

- Preserve browser-cache and one-off DXF imports without folder permissions.
- Preserve existing Robofil v1 output and project snapshots.
- Never emit G0 while compensation is active.
- Treat generated Prisma programs as test candidates requiring machine simulation.
- Keep X bounds `-32.500…32.500` and Y bounds `0.000…64.500`.
- Do not add feeds, `.CMD`, `.TEC`, thread/cut-wire codes, or U/V output.

---

### Task 1: Versioned Robofil v2 policy

**Files:**
- Modify: `src/domain/workbench/types.ts`
- Modify: `src/domain/machine/machineProfiles.ts`
- Modify: `src/domain/post/verifiedRobofilPostEnvelope.ts`
- Test: `src/domain/machine/__tests__/machineProfiles.test.ts`

**Interfaces:**
- Produces: `createCharmillesRobofil100V2CandidateProfile()` and `matchesRobofilV2PostEnvelope()`.

- [ ] Write failing tests proving v1 remains program-scoped and v2 is unverified, post-version 2, operation-scoped, and G39-cancelled.
- [ ] Run the focused test and confirm the expected missing-helper failures.
- [ ] Implement the minimal typed policy and normalization support.
- [ ] Run focused tests and commit the green change.

### Task 2: Robofil v2 structured multi-contour post

**Files:**
- Create: `src/domain/post/robofilV2Post.ts`
- Create: `src/domain/post/__tests__/robofilV2Post.test.ts`
- Modify: `src/domain/post/upidMachinePost.ts`
- Modify: `src/domain/compensation/validateCompensatedExport.ts`
- Modify: `src/domain/post/templateModalPolicy.ts`

**Interfaces:**
- Consumes: a currently verified v2 machine snapshot and validated `PathPlanningDocument`.
- Produces: `postRobofilV2(document, machine): UpidMachinePostResult`.

- [ ] Write failing tests for three compensated contours, `G39/G40/G0` boundaries, per-operation G41/G42 D0, atomic blocking, trace ranges, and no rapid under compensation.
- [ ] Run the tests and confirm v2 currently blocks as unsupported.
- [ ] Implement the v2 post as a focused state machine and route it by post version.
- [ ] Run focused post/compensation tests and commit.

### Task 3: Planned travel projection and route optimization

**Files:**
- Create: `src/domain/path-intel/plannedTravel.ts`
- Create: `src/domain/path-intel/__tests__/plannedTravel.test.ts`
- Modify: `src/domain/path-intel/planOperations.ts`
- Modify: `src/domain/editor/previewGeometry.ts`
- Test: `src/domain/editor/__tests__/previewGeometry.test.ts`

**Interfaces:**
- Produces: `derivePlannedTravels(document)` and deterministic route optimization helpers.

- [ ] Write failing tests that blocked Robofil posting still shows three Prisma planned rapids and that circle start candidates reduce route length.
- [ ] Run and confirm the rapid-suppression/route failures.
- [ ] Separate planned travel from posted transition overlays and implement constrained optimization.
- [ ] Run focused planning/preview tests and commit.

### Task 4: Canonical rapid editing API

**Files:**
- Modify: `src/domain/path-editor/pathDocumentOperations.ts`
- Test: `src/domain/path-editor/__tests__/pathDocumentOperations.test.ts`
- Modify: `src/domain/upid/projectRail.ts`

**Interfaces:**
- Produces: `setPlannedRapidStart(...)`, `setPlannedRapidEnd(...)`, and route-selection summaries.

- [ ] Write failing tests for first-source editing, destination editing, previous-closed-operation source editing, persistence, metrics, and undo-safe immutable documents.
- [ ] Run and confirm the missing API failures.
- [ ] Implement canonical edits by updating document/operation starts without duplicated travel state.
- [ ] Run focused domain tests and commit.

### Task 5: Browser-agent route controls

**Files:**
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorInspectorPanel.tsx`
- Modify: `src/features/editor/EditorPreview.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Test: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes: rapid-selection/editing callbacks.
- Produces: accessible exact-coordinate controls and optimize-route action.

- [ ] Write failing component tests for visible planned rapids under blocked v1, rapid exact-X/Y editing, stable accessible names/hooks, and reoptimization.
- [ ] Run and confirm the UI failures.
- [ ] Implement controls and draggable/selectable rapid endpoints while retaining ordinary contour dragging.
- [ ] Run focused component tests and commit.

### Task 6: Real Prisma acceptance and artifacts

**Files:**
- Create: `scripts/generate-prisma-robofil-v2-artifacts.mjs`
- Create: `artifacts/robofil-v2/prisma-fixa-1-cog/README.md`
- Modify: `e2e/compensated-gear-export.spec.ts` or create `e2e/prisma-robofil-v2.spec.ts`

**Interfaces:**
- Produces: deterministic `.iso` candidates and JSON manifest from the real DXF.

- [ ] Write a failing acceptance test for exact bounds, hole-center starts/leads, three operations, modal boundaries, and downloaded bytes.
- [ ] Run and confirm the current blocked/missing-artifact behavior.
- [ ] Implement the artifact generator and browser flow using production APIs.
- [ ] Generate recommended, reversed, source-order, v1-blocked, and generic comparison artifacts.
- [ ] Run the acceptance test and inspect all artifact bytes.
- [ ] Commit scripts, tests, and artifacts.

### Task 7: Integrated verification

**Files:**
- Modify only when a reproduced integration or browser-agent defect requires a test-first fix.

- [ ] Run focused machine/post/planning/editor tests.
- [ ] Run `npm test -- --run`.
- [ ] Run `npm run build`.
- [ ] Run the full Playwright suite.
- [ ] Start Vite and use browser automation to import the real Prisma DXF, place it, edit/optimize rapid travel, preview, and download.
- [ ] Check the error overlay, console, semantic controls, generated placement, and downloaded bytes.
- [ ] Run `git diff --check` and inspect `git status`/`git diff`.
- [ ] Commit any final verified fixes and prepare the artifact handoff.
