# Geometry Lens Contour Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the persistent Geometry lens the sole user-facing home of the contour hierarchy and remove the duplicate `View > Contour Tree` entry.

**Architecture:** Keep `EditorPathNavigatorPanel` as the shared owner of contour-tree projection and interactions, but give it an explicit contour-tree-only presentation mode for the persistent rail. Retain the legacy internal `view.contours` command temporarily for existing targeted harness coverage while excluding it from user-facing menus; the Geometry lens must not require that workflow to be active.

**Tech Stack:** React, TypeScript, Vitest, Vite, `agent-browser`

## Global Constraints

- Preserve shared selection and hover projection between the contour tree, canvas, and inspector.
- Geometry lens shows containment/source geometry, while Program lens shows execution order.
- Path Summary, Transform, Cut Sequence, Endpoint Topology, and Diagnostics remain separate workflows.
- Remove `Contour Tree` from the View menu.
- Do not commit the changes.

---

### Task 1: Lock the Geometry-lens information architecture

**Files:**
- Modify: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes: the rendered `EditorPage` after a DXF import.
- Produces: regression coverage for the Geometry lens and View menu.

- [ ] **Step 1: Strengthen the Geometry-lens regression**

After selecting `[role="tab"][aria-label="Geometry lens"]`, assert that the visible geometry tabpanel contains `[data-upid-contour-tree]` and `[data-upid-segment-row]`, but does not contain `[data-upid-path-transform]`, `[data-upid-path-summary]`, `[data-upid-cut-sequence]`, `[data-upid-endpoint-topology-list]`, or `[data-upid-diagnostics-list]`.

- [ ] **Step 2: Add the View-menu regression**

Open `[data-editor-workflow-menu="View"]` and assert that no command with label `Contour Tree` or command id `view.contours` is rendered.

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
npm test -- --run src/__tests__/appDxfProjects.test.tsx -t "Geometry lens|removes Contour Tree"
```

Expected: the Geometry-lens exclusivity assertion and View-menu removal assertion fail.

### Task 2: Render only the contour tree in the persistent Geometry lens

**Files:**
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Test: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes: `EditorPathNavigatorPanelProps` and the existing contour-tree renderer.
- Produces: `presentation?: 'workspace' | 'contour-tree'`, defaulting to `workspace`.

- [ ] **Step 1: Add an explicit presentation prop**

Add:

```ts
presentation?: 'workspace' | 'contour-tree';
```

Default it to `workspace`. Build the existing contour-tree section once in a local `contourTreeContent` value.

- [ ] **Step 2: Return the focused rail presentation**

When `presentation === 'contour-tree'`, render only the scrollable rail container and `contourTreeContent`. Keep the existing workspace-panel composition unchanged for the default mode.

- [ ] **Step 3: Use focused presentation from `EditorPage`**

Replace the temporary wrapper bypass with:

```tsx
renderPathNavigatorPanel(pathDocumentDraft, 'contour-tree')
```

Pass `presentation="contour-tree"` and keep `renderWorkspacePanel` only for workspace presentation.

- [ ] **Step 4: Make hover assist rail-owned**

Allow `handleTogglePathHoverAssist` when the Geometry lens is active, while preserving legacy internal `view.contours` behavior used by focused harness tests.

- [ ] **Step 5: Hide the legacy command from workflow menus**

Filter `view.contours` out while building `editorWorkflowMenus`. Keep its internal command definition only for compatibility with existing targeted tests; no user-facing control may invoke it.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- --run src/__tests__/appDxfProjects.test.tsx src/features/editor/__tests__/EditorUpidRail.test.tsx
```

Expected: all tests pass.

### Task 3: Verify the real editor

**Files:**
- No production changes unless verification finds a scoped regression.

**Interfaces:**
- Consumes: the local Vite application and a repository DXF.
- Produces: browser evidence for the final behavior.

- [ ] **Step 1: Run the production build**

```bash
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 2: Verify with `agent-browser`**

Import `DXF-test-subjects/z18f25.dxf`, select Geometry, and verify:

- the contour tree begins at the top of the lens;
- segment rows are present;
- Path Summary and Transform are absent;
- View menu has no Contour Tree entry;
- tree selection still highlights canvas geometry;
- no browser errors occur.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: only scoped source, test, and plan changes; no commit.
