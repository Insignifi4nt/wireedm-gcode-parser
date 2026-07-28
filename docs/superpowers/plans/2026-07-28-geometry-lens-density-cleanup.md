# Geometry Lens Density Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the persistent Geometry lens a compact Program-style hierarchy with segment lists collapsed until requested or selected.

**Architecture:** Keep `EditorPathNavigatorPanel` as the sole contour-tree interaction owner. Add local cut-path disclosure state alongside the existing contour and segment-detail states, then restyle the contour and segment renderers without changing UPID data or selection contracts.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, Vite, `npx agent-browser`

## Global Constraints

- Preserve canvas/tree selection and hover projection.
- Preserve nested-contour hierarchy and endpoint detail disclosure.
- Geometry remains containment-oriented; Program remains execution-oriented.
- `View > Contour Tree` remains absent.
- Do not commit the changes.

---

### Task 1: Define the compact disclosure behavior

**Files:**
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`
- Modify: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes: the real `EditorPage` Geometry lens and existing UPID rectangle fixtures.
- Produces: behavior coverage for collapsed segment lists, explicit disclosure, automatic reveal, and compact options.

- [ ] **Step 1: Write the failing default-state regression**

In the Geometry-lens application test, assert that the contour row and a named `Expand cut path in Exterior 1` control are present, while `[data-upid-segment-stack]` and `[data-upid-segment-row]` are absent before disclosure.

- [ ] **Step 2: Write the failing interaction regressions**

Update the focused contour-tree tests to expand the cut path before interacting with segment rows. Assert that an endpoint selected from the canvas expands both the owning contour and cut path.

- [ ] **Step 3: Write the failing options regression**

Assert that the permanent named Expand/Collapse controls and hover checkbox are initially absent, open `button[aria-label="Geometry tree options"]`, and exercise the corresponding named actions inside the popover.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
npm test -- --run src/__tests__/appDxfProjects.test.tsx src/__tests__/editorPathNativeDraft.test.tsx -t "Geometry lens|contour tree|cut path|canvas endpoint"
```

Expected: assertions for the new cut-path control and options trigger fail because the existing implementation renders all segments and permanent controls.

### Task 2: Implement compact Geometry hierarchy

**Files:**
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Test: `src/__tests__/appDxfProjects.test.tsx`
- Test: `src/__tests__/editorPathNativeDraft.test.tsx`

**Interfaces:**
- Consumes: `UpidProjectRailTreeNode`, `expandedPathElementIds`, and `selectedPathElement`.
- Produces: local `expandedCutPathIds: Record<string, boolean>` and compact contour/cut-path/segment disclosures.

- [ ] **Step 1: Add independent cut-path state**

Add:

```ts
const [expandedCutPathIds, setExpandedCutPathIds] = useState<Record<string, boolean>>({});
```

Default each cut path to collapsed. When `selectedPathElement.segmentId` is present, find its owning `UpidOperationPathElement` and set that owner's cut path to expanded.

- [ ] **Step 2: Integrate expand/collapse all**

Update `setPathTreeExpanded` so each path element receives the requested contour expansion state and cut-path expansion state. Keep segment-detail state independent.

- [ ] **Step 3: Replace permanent controls with compact options**

Render a compact header with the root count, existing help icon, and `Geometry tree options`. The options popover contains named `Expand entire contour tree`, `Collapse entire contour tree`, and `Toggle canvas hover assist` controls and closes after an expand/collapse action.

- [ ] **Step 4: Restyle contour nodes**

Replace the bordered workbook card with a flat row using indentation, an ordinal, concise `name · role` text, diagnostic/status marks, and a leading disclosure control. Keep the existing data attributes and selection handler.

- [ ] **Step 5: Add the cut-path disclosure row**

Under an expanded contour, render:

```text
Cut path · N segments
```

Only render `[data-upid-segment-stack]` when this row is expanded.

- [ ] **Step 6: Restyle segment rows**

Use a flat indented row with disclosure, `S<n> · LINE|ARC`, optional arc direction/radius, and right-aligned length. Move coordinate spans out of the primary row while retaining them in the detail region and accessible title.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
npm test -- --run src/__tests__/appDxfProjects.test.tsx src/__tests__/editorPathNativeDraft.test.tsx -t "Geometry lens|contour tree|cut path|canvas endpoint"
```

Expected: all selected tests pass.

### Task 3: Verify integration and visual result

**Files:**
- No production changes unless verification finds a scoped regression.

**Interfaces:**
- Consumes: the complete repository and local Vite editor.
- Produces: automated and browser evidence that the cleanup is stable.

- [ ] **Step 1: Run all tests**

```bash
npm test -- --run
```

Expected: every Vitest file passes with zero failed tests.

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 3: Verify with `npx agent-browser`**

Import `DXF-test-subjects/z18f25.dxf` at 1280×720 and confirm the Geometry lens initially shows the contour and collapsed `Cut path · 72 segments` row without segment-row flooding. Expand the cut path, select a segment, collapse it, then select a canvas endpoint and confirm automatic reveal. Open the options popover and confirm all three controls.

- [ ] **Step 4: Inspect the final workspace**

```bash
git diff --check
git status --short
```

Expected: only scoped source, test, specification, and plan changes; no commit.
