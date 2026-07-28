# Segment Geometry Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic, duplicated segment details with a shared type-specific presentation for lines, arcs, and circles in both the Geometry tree and Inspector.

**Architecture:** A pure `segmentGeometryPresentation` builder will select semantic fields and point roles for each geometry kind. The Geometry tree and Inspector will render separate density-appropriate views from that shared model, while existing UPID selection and diagnostic APIs remain unchanged.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, Testing Library, Vite

## Global Constraints

- Preserve path geometry, DXF parsing, topology inference, and machining behavior.
- Preserve three-decimal coordinate and measurement precision.
- Preserve endpoint selection, hover, diagnostics, and accessibility behavior.
- Do not add dependencies.
- Create one final commit only; do not create incremental commits.

---

### Task 1: Shared type-specific presentation model

**Files:**
- Create: `src/features/editor/segmentGeometryPresentation.ts`
- Create: `src/__tests__/segmentGeometryPresentation.test.ts`

**Interfaces:**
- Consumes: `UpidSelectedPathSegmentGeometry` and `Point2`.
- Produces: `buildSegmentGeometryPresentation(input: SegmentGeometryPresentationInput): SegmentGeometryPresentation`.

- [ ] **Step 1: Write the failing line and arc presentation tests**

Assert literal fields: line length/start/end/deltas/heading and arc
radius/arc-length/direction-sweep/start/end/center.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run src/__tests__/segmentGeometryPresentation.test.ts`

Expected: FAIL because `segmentGeometryPresentation` does not exist.

- [ ] **Step 3: Implement the line and arc builder branches**

Create typed summary, point, derived, and advanced field collections without
formatting them into display strings prematurely.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --run src/__tests__/segmentGeometryPresentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing clean and exceptional circle tests**

Assert that a clean circle exposes `Center` and one selectable `Cut start`,
omits sweep/end duplication, and that an exceptional circle exposes selectable
`Start side` and `End side`.

- [ ] **Step 6: Run the focused test and verify RED**

Run: `npm test -- --run src/__tests__/segmentGeometryPresentation.test.ts`

Expected: FAIL because the circle policy is not implemented.

- [ ] **Step 7: Implement the circle builder branch**

Use `Circumference`, direction, center, and cut-start semantics. Gate raw
closure sides behind `showCircleClosureSides`.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run: `npm test -- --run src/__tests__/segmentGeometryPresentation.test.ts`

Expected: PASS.

### Task 2: Geometry-tree segment redesign

**Files:**
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`

**Interfaces:**
- Consumes: `buildSegmentGeometryPresentation`.
- Preserves: existing `EditorPathElementRef` selection and UPID diagnostic summaries.

- [ ] **Step 1: Write failing integration assertions for line, arc, and circle**

Assert type-specific row summaries, compact point labels, clean-circle single
cut-start selection, and absence of visible `From`, `To`, duplicate endpoint
labels, and `sweep 360`.

- [ ] **Step 2: Run the focused integration tests and verify RED**

Run: `npm test -- --run src/__tests__/editorPathNativeDraft.test.tsx`

Expected: FAIL on the new presentation assertions.

- [ ] **Step 3: Render the shared summary in segment rows**

Replace the generic geometry summary with type-specific compact measurements
while retaining existing data attributes used by tests and selection code.

- [ ] **Step 4: Replace verbose endpoint cards with compact point rows**

Render selectable start/end/cut-start rows and informational center rows.
Only show cluster metadata when it is non-clean; preserve hidden rich help and
diagnostic attributes.

- [ ] **Step 5: Detect exceptional circle closure**

Set `showCircleClosureSides` when coordinates differ or either endpoint role has
diagnostics, then render both raw sides.

- [ ] **Step 6: Run the focused integration tests and verify GREEN**

Run: `npm test -- --run src/__tests__/editorPathNativeDraft.test.tsx`

Expected: PASS.

### Task 3: Inspector information architecture

**Files:**
- Modify: `src/features/editor/EditorInspectorPanel.tsx`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`
- Modify if required by existing coverage: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes: `buildSegmentGeometryPresentation`.
- Preserves: previous/next selection callbacks and source provenance attributes.

- [ ] **Step 1: Write failing Inspector grouping assertions**

Assert `Geometry`, `Path`, and `Source` groups, type-specific labels, a collapsed
advanced disclosure, and no normal full-circle `End` or `Sweep 360` duplication.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run src/__tests__/editorPathNativeDraft.test.tsx src/__tests__/appDxfProjects.test.tsx`

Expected: FAIL on the new Inspector structure.

- [ ] **Step 3: Build the shared presentation for the selected segment**

Use the selected segment's geometry, oriented points, and length. Derive the
circle exception flag from selected diagnostics/coordinate closure.

- [ ] **Step 4: Split the Inspector into semantic groups**

Render geometry first, sequence/direction in `Path`, provenance in `Source`, and
angles/tangents inside a native collapsed `Advanced geometry` disclosure.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- --run src/__tests__/editorPathNativeDraft.test.tsx src/__tests__/appDxfProjects.test.tsx`

Expected: PASS.

### Task 4: Regression, design QA, and single delivery commit

**Files:**
- Modify if visual defects require it: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify if visual defects require it: `src/features/editor/EditorInspectorPanel.tsx`
- Create: `design-qa.md`

**Interfaces:**
- Verifies the completed UI and repository state.

- [ ] **Step 1: Run formatting and focused verification**

Run: `git diff --check`

Run: `npm test -- --run src/__tests__/segmentGeometryPresentation.test.ts src/__tests__/editorPathNativeDraft.test.tsx src/__tests__/appDxfProjects.test.tsx`

- [ ] **Step 2: Run the full automated verification**

Run: `npm test -- --run`

Run: `npm run build`

- [ ] **Step 3: Verify with the requested Vercel browser agent**

Use `npx agent-browser` against
`http://localhost:3000/wireedm-gcode-parser/`. Inspect line, arc, and circle
segment details plus the selected-segment Inspector; test segment/cut-start
selection and disclosures; capture screenshots and check browser errors.

- [ ] **Step 4: Record design QA**

Write `design-qa.md` with the tested viewport/states, visible findings, fixes,
and `final result: passed` only after the visual and interaction checks pass.

- [ ] **Step 5: Re-run verification after visual fixes**

Run all commands from Steps 1 and 2 again after any QA-driven changes.

- [ ] **Step 6: Create the one authorized commit**

Review `git status --short` and `git diff --stat`, stage the complete related
change set, and create one commit describing the Geometry segment-presentation
redesign.
