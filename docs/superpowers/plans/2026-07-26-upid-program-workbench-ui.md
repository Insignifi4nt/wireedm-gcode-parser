# UPID Program Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace empty path-editor docks with an execution-accurate persistent UPID rail, connect its nodes to existing workflows, and polish the current workbench UI without changing its identity or machining semantics.

**Architecture:** A pure `buildUpidProgramTree(document, machine)` projection translates UPID and machine-policy state into typed setup, operation, and action nodes. Focused React components render that projection as an accessible persistent rail; `EditorPage` owns selection and atomically routes typed edit targets into the existing single-workflow session model. Existing floating panels remain the default, a right dock renders only when occupied, and compact widths use explicit drawers rather than hiding editor content.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Vitest/jsdom, Playwright, localStorage/browser-cache storage.

## Global Constraints

- Preserve the current dark workbench styling and the workflow categories **Geometry, Machining, Construction, View, Machine, Export** in that order.
- Do not add machining, controller, post-processing, geometry, feed-generation, or placeholder UI capability.
- Browser-cache and one-off imports must work when directory APIs are unavailable.
- External `.gcode`, `.nc`, `.iso`, and `.txt` files keep the current cleanup/display pipeline.
- Output extension remains a file-writing choice and does not alter generated text by itself.
- Program order is `plan.operations[].orderIndex`; geometric containment must never be presented as execution nesting.
- Source & Setup stays distinct from Program Sequence.
- Exactly one workflow may be active; existing Save / Discard / Cancel and one-history-entry behavior remains authoritative.
- Primary editor controls and tree labels use 11–12px text; 9–10px is reserved for metadata, status bars, and uppercase section labels.
- A path project must not render empty left or right dock placeholders.
- At 1024×720 the rail, canvas, essential header controls, and active workflow remain usable without page overflow.
- Below 768px the rail and workflow content use explicit drawers and are not removed with `display: none`.
- All production behavior is implemented test-first.

---

## File Structure

### New domain files

- `src/domain/upid/upidProgramTree.ts` — pure UPID/machine-to-program-tree projection and typed edit targets.
- `src/domain/upid/__tests__/upidProgramTree.test.ts` — execution order, status, stop placement, and partial-machining projection.

### New editor files

- `src/features/editor/EditorUpidRail.tsx` — persistent rail chrome, Program/Geometry lenses, compact state, resize/collapse controls.
- `src/features/editor/EditorProgramTree.tsx` — accessible program tree rendering and keyboard interaction.
- `src/features/editor/editorProgramTreeState.ts` — pure expansion/selection state helpers.
- `src/features/editor/__tests__/EditorUpidRail.test.tsx` — rail modes and compact behavior.
- `src/features/editor/__tests__/EditorProgramTree.test.tsx` — ARIA tree, collapse, selection, edit-target activation.
- `src/features/editor/editorProgramTreeActions.ts` — typed edit-target-to-command/selection routing.
- `src/features/editor/editorProgramTreeActions.test.ts` — deterministic command and selection mapping.

### Existing files with focused changes

- `src/features/editor/EditorPage.tsx` — build projection, register persistent rail, route atomic targets, render conditional right dock.
- `src/features/editor/EditorProgramStopsPanel.tsx` — focus and edit a selected existing stop.
- `src/features/editor/__tests__/EditorProgramStopsPanel.test.tsx` — selected-stop and update coverage.
- `src/features/editor/EditorWorkflowMenuBar.tsx` — compact menu rows, footer description, keyboard/outside-close behavior.
- `src/features/editor/__tests__/EditorWorkflowMenuBar.test.tsx` — compact menu behavior and accessibility.
- `src/features/editor/EditorWorkspacePanels.tsx` — remove left placement from active controls and avoid empty dock chrome.
- `src/features/editor/workspace/editorWorkspaceLayout.ts` — migrate legacy `docked-left` panels to floating.
- `src/features/editor/workspace/editorWorkspaceLayout.test.ts` — layout migration coverage.
- `src/app/AppShell.tsx` — persistent rail width/collapse affordances and compact overlay hook.
- `src/features/dashboard/ProjectListPanel.tsx` — responsive metadata/action stacking.
- `src/index.css` — editor grid, drawer, typography, and narrow-dashboard rules.
- `src/__tests__/editorPathNativeDraft.test.tsx` — tree-to-workflow integration and dirty transition regression.
- `src/__tests__/editorDensityCleanup.test.tsx` — workbench-density expectations.
- `e2e/editor-layout.spec.ts` — no-empty-dock, rail sizing, menu geometry, compact drawer.
- `e2e/editor-workspace-panels.spec.ts` — legacy placement and active-right-dock behavior.
- `e2e/editor-upid-program-tree.spec.ts` — import/edit/save/reload and dirty-switch journeys.

---

### Task 1: Pure UPID Program-Tree Projection

**Files:**
- Create: `src/domain/upid/upidProgramTree.ts`
- Create: `src/domain/upid/__tests__/upidProgramTree.test.ts`

**Interfaces:**
- Consumes: `PathPlanningDocument`, `MachineProfile`, existing transition/stop/participation/compensation resolvers.
- Produces:

```ts
export type UpidProgramTreeStatus =
  | 'ready'
  | 'review-required'
  | 'blocked'
  | 'inactive';

export type UpidProgramTreeEditTarget =
  | { kind: 'path-summary' }
  | { kind: 'geometry-setup' }
  | { kind: 'machine-setup' }
  | { kind: 'initial-wire' }
  | { kind: 'threading-default' }
  | { kind: 'operation'; operationId: string }
  | { kind: 'cut-sequence'; operationId: string }
  | { kind: 'contour-start'; operationId: string }
  | { kind: 'incoming-connection'; operationId: string }
  | { kind: 'entry-exit'; operationId: string }
  | { kind: 'machining-participation'; operationId: string; spanId?: string }
  | { kind: 'program-stop'; operationId: string; stopId: string }
  | { kind: 'diagnostics'; diagnosticId?: string };

export interface UpidProgramTreeNode {
  treeKey: string;
  kind: 'setup' | 'operation' | 'phase' | 'stop' | 'span';
  label: string;
  detail?: string;
  status: UpidProgramTreeStatus;
  statusReason?: string;
  operationId?: string;
  pathElementId?: string;
  editTarget?: UpidProgramTreeEditTarget;
  children: UpidProgramTreeNode[];
}

export interface UpidProgramTree {
  status: UpidProgramTreeStatus;
  sourceSetup: UpidProgramTreeNode[];
  operations: UpidProgramTreeNode[];
}

export function buildUpidProgramTree(
  document: PathPlanningDocument,
  machine: MachineProfile
): UpidProgramTree;
```

- [ ] **Step 1: Write failing projection tests**

Create rectangle fixtures that generate `Hole 1` before `Exterior 1`, then add entry/exit, all four stop placements, and a second-operation threading override.

```ts
const tree = buildUpidProgramTree(document, createDefaultMachineProfile());
expect(tree.operations.map((node) => node.label)).toEqual([
  '01 · Hole 1',
  '02 · Exterior 1'
]);
expect(tree.sourceSetup.map((node) => node.editTarget?.kind)).toEqual([
  'path-summary',
  'geometry-setup',
  'machine-setup',
  'initial-wire',
  'threading-default'
]);
expect(tree.operations[0].children.map((node) => node.label)).toEqual([
  'Incoming connection',
  'M00 · Before entry',
  'Entry / lead-in',
  'Cut path',
  'M00 · After contour',
  'Exit / lead-out',
  'M00 · After exit'
]);
expect(
  tree.operations[0].children
    .find((node) => node.label === 'Cut path')
    ?.children.map((node) => node.editTarget)
).toContainEqual({
  kind: 'program-stop',
  operationId: document.plan.operations[0].id,
  stopId: 'stop-before-end'
});
```

Add separate tests for disabled stops, unsupported machine stop policy, partial machining source-operation links, review-required entry/exit, and rolled-up diagnostic severity.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- --run src/domain/upid/__tests__/upidProgramTree.test.ts
```

Expected: FAIL because `@/domain/upid/upidProgramTree` does not exist.

- [ ] **Step 3: Implement the typed projection**

Implement small private builders:

```ts
function buildSourceSetupNodes(
  document: PathPlanningDocument,
  machine: MachineProfile
): UpidProgramTreeNode[];

function buildOperationNode(
  document: PathPlanningDocument,
  machine: MachineProfile,
  operation: PathOperation
): UpidProgramTreeNode;

function rollUpStatus(nodes: readonly UpidProgramTreeNode[]): UpidProgramTreeStatus;
```

Sort operations by `orderIndex`. Put `before-operation-end` stops inside Cut Path sorted by resolved distance from cut start; put the other stop placements around Entry/Cut/Exit in execution order. Keep disabled stops visible with `inactive` status. Resolve machine-policy failures into `blocked` nodes without throwing.

- [ ] **Step 4: Run focused domain tests**

Run:

```bash
npm test -- --run src/domain/upid/__tests__/upidProgramTree.test.ts
```

Expected: all program-tree tests PASS with no warnings.

- [ ] **Step 5: Run neighboring domain regressions**

Run:

```bash
npm test -- --run src/domain/path-intel/__tests__/programStops.test.ts src/domain/path-intel/__tests__/threadingTransitions.test.ts src/domain/upid/__tests__/projectRail.test.ts
```

Expected: all selected suites PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/upid/upidProgramTree.ts src/domain/upid/__tests__/upidProgramTree.test.ts
git commit -m "feat: project UPID program execution tree"
```

---

### Task 2: Accessible Persistent-Rail Components

**Files:**
- Create: `src/features/editor/EditorProgramTree.tsx`
- Create: `src/features/editor/EditorUpidRail.tsx`
- Create: `src/features/editor/editorProgramTreeState.ts`
- Create: `src/features/editor/__tests__/EditorProgramTree.test.tsx`
- Create: `src/features/editor/__tests__/EditorUpidRail.test.tsx`

**Interfaces:**
- Consumes: `UpidProgramTree`, `UpidProgramTreeNode`, `UpidProgramTreeEditTarget`.
- Produces:

```ts
export type EditorUpidRailMode = 'program' | 'geometry';

export interface EditorProgramTreeProps {
  tree: UpidProgramTree;
  selectedTreeKey: string | null;
  expandedTreeKeys: ReadonlySet<string>;
  onExpandedTreeKeysChange: (keys: ReadonlySet<string>) => void;
  onSelect: (node: UpidProgramTreeNode) => void;
  onEdit: (target: UpidProgramTreeEditTarget) => void;
}

export interface EditorUpidRailProps {
  collapsed: boolean;
  geometryContent: ReactNode;
  mode: EditorUpidRailMode;
  onCollapseChange: (collapsed: boolean) => void;
  onModeChange: (mode: EditorUpidRailMode) => void;
  programContent: ReactNode;
  selectedOperationOrdinal: number | null;
  status: UpidProgramTreeStatus;
}
```

- [ ] **Step 1: Write failing state and component tests**

Cover:

```ts
expect(defaultEditorProgramTreeExpansion(tree)).toEqual(
  new Set(['section:program', tree.operations[0].treeKey])
);
expect(pruneEditorProgramTreeExpansion(previous, nextTree)).not.toContain('removed-op');
```

Render the tree and assert:

```ts
expect(container.querySelector('[role="tree"]')).not.toBeNull();
expect(container.querySelector('[aria-level="1"]')).not.toBeNull();
expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
```

Simulate ArrowDown/ArrowRight/ArrowLeft, Space selection, and Enter edit activation. Render the compact rail and verify that it exposes expand, lens, status, and selected-operation ordinal controls.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- --run src/features/editor/__tests__/EditorProgramTree.test.tsx src/features/editor/__tests__/EditorUpidRail.test.tsx
```

Expected: FAIL because the component/state modules do not exist.

- [ ] **Step 3: Implement pure expansion helpers**

Implement:

```ts
export function defaultEditorProgramTreeExpansion(
  tree: UpidProgramTree
): ReadonlySet<string>;

export function revealEditorProgramTreeNode(
  tree: UpidProgramTree,
  expanded: ReadonlySet<string>,
  treeKey: string
): ReadonlySet<string>;

export function pruneEditorProgramTreeExpansion(
  expanded: ReadonlySet<string>,
  tree: UpidProgramTree
): ReadonlySet<string>;
```

Do not persist operation expansion across reloads.

- [ ] **Step 4: Implement semantic components**

Use `<button>` for each row's interactive surface inside semantic tree items. Keep the operation row's click/Space behavior as selection; invoke its edit target on Enter or its compact edit affordance. Editable child actions invoke `onEdit` on click/Enter. Apply stable `treeKey` React keys.

The rail renders Program/Geometry tabs, Source & Setup and Program Sequence headers through its supplied program content, and a 36px compact strip when collapsed.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- --run src/features/editor/__tests__/EditorProgramTree.test.tsx src/features/editor/__tests__/EditorUpidRail.test.tsx
```

Expected: all component tests PASS.

- [ ] **Step 6: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/editor/EditorProgramTree.tsx src/features/editor/EditorUpidRail.tsx src/features/editor/editorProgramTreeState.ts src/features/editor/__tests__/EditorProgramTree.test.tsx src/features/editor/__tests__/EditorUpidRail.test.tsx
git commit -m "feat: add accessible UPID program rail"
```

---

### Task 3: Atomic Tree-to-Workflow Routing

**Files:**
- Create: `src/features/editor/editorProgramTreeActions.ts`
- Create: `src/features/editor/editorProgramTreeActions.test.ts`
- Modify: `src/features/editor/EditorProgramStopsPanel.tsx`
- Create: `src/features/editor/__tests__/EditorProgramStopsPanel.test.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`

**Interfaces:**
- Consumes: `UpidProgramTreeEditTarget` from Task 1.
- Produces:

```ts
export interface EditorProgramTreeAction {
  commandId:
    | 'view.summary'
    | 'geometry.setup'
    | 'machine.profile'
    | 'machining.initial-wire'
    | 'machining.between-contours'
    | 'machining.contour-setup'
    | 'machining.sequence'
    | 'machining.set-start'
    | 'machining.entry-exit'
    | 'machining.participation'
    | 'machining.program-stops'
    | 'view.diagnostics';
  operationId: string | null;
  stopId: string | null;
}

export function resolveEditorProgramTreeAction(
  target: UpidProgramTreeEditTarget
): EditorProgramTreeAction;
```

- [ ] **Step 1: Write failing routing tests**

Assert every edit-target variant maps to one existing command and carries its explicit operation/stop identity:

```ts
expect(resolveEditorProgramTreeAction({
  kind: 'program-stop',
  operationId: 'op_2',
  stopId: 'stop-3'
})).toEqual({
  commandId: 'machining.program-stops',
  operationId: 'op_2',
  stopId: 'stop-3'
});
```

- [ ] **Step 2: Write failing integration tests**

In `editorPathNativeDraft.test.tsx`, import a multi-operation UPID project, click Entry / lead-in under the second operation, and assert:

```ts
expect(screen.getByRole('heading', { name: /entry.*exit/i })).toBeTruthy();
expect(
  (screen.getByLabelText('Entry and exit operation') as HTMLSelectElement).value
).toBe(secondOperationId);
```

Start a dirty first-operation workflow, invoke the second-operation tree action, choose Cancel, and assert the original operation and panel remain active.

Add a selected-stop panel test that verifies `selectedStopId="stop-2"` marks/focuses that row and editing its placement/reason/note emits an updated `OperationProgramStop[]`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm test -- --run src/features/editor/editorProgramTreeActions.test.ts src/features/editor/__tests__/EditorProgramStopsPanel.test.tsx src/__tests__/editorPathNativeDraft.test.tsx
```

Expected: routing module is missing and tree integration assertions FAIL.

- [ ] **Step 4: Implement target routing**

Implement `resolveEditorProgramTreeAction()` as an exhaustive `switch` with a `never` guard. Do not derive commands from labels.

In `EditorPage`, add:

```ts
function openEditorWorkflowForTarget(target: UpidProgramTreeEditTarget) {
  const action = resolveEditorProgramTreeAction(target);
  requestProgramTreeWorkflowTransition(action);
}
```

The transition request carries `operationId` and `stopId` until resolved. Apply the explicit selection before creating the new workflow session. Cancel leaves the existing workflow and selection untouched.

- [ ] **Step 5: Make existing stops directly editable**

Add `selectedStopId?: string | null` to `EditorProgramStopsPanel`. Render the selected stop as an inline edit form with Placement, Remaining cut, Reason, Note, Enabled, Apply, and Remove controls. `Apply` replaces only the matching stop in `onSetStops`.

Use:

```ts
function replaceStop(
  stops: readonly OperationProgramStop[],
  stopId: string,
  replacement: OperationProgramStop
) {
  return stops.map((stop) => stop.id === stopId ? replacement : stop);
}
```

Keep Add stop behavior intact.

- [ ] **Step 6: Run focused routing and integration tests**

Run:

```bash
npm test -- --run src/features/editor/editorProgramTreeActions.test.ts src/features/editor/__tests__/EditorProgramStopsPanel.test.tsx src/__tests__/editorPathNativeDraft.test.tsx
```

Expected: all selected suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/editor/editorProgramTreeActions.ts src/features/editor/editorProgramTreeActions.test.ts src/features/editor/EditorProgramStopsPanel.tsx src/features/editor/__tests__/EditorProgramStopsPanel.test.tsx src/features/editor/EditorPage.tsx src/__tests__/editorPathNativeDraft.test.tsx
git commit -m "feat: open editor workflows from program actions"
```

---

### Task 4: Persistent Rail and Conditional Workspace Layout

**Files:**
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/EditorWorkspacePanels.tsx`
- Modify: `src/features/editor/workspace/editorWorkspaceLayout.ts`
- Modify: `src/features/editor/workspace/editorWorkspaceLayout.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Modify: `src/__tests__/editorDensityCleanup.test.tsx`
- Modify: `e2e/editor-workspace-panels.spec.ts`

**Interfaces:**
- Consumes: `buildUpidProgramTree`, `EditorUpidRail`, `EditorProgramTree`, and atomic routing from Tasks 1–3.
- Produces: persistent path-project rail; floating-by-default active workflow; right dock only while occupied.

- [ ] **Step 1: Write failing layout migration tests**

Add:

```ts
expect(
  normalizeEditorWorkspaceLayout(
    layoutWith({ 'entry-exit': 'docked-left' }),
    defaults,
    viewport
  ).placements['entry-exit']
).toBe('floating');
```

Also assert hidden and `docked-right` placements remain unchanged.

- [ ] **Step 2: Write failing app/layout integration tests**

Assert a newly imported path project has:

```ts
expect(screen.getByRole('tree', { name: 'UPID program sequence' })).toBeTruthy();
expect(document.querySelector('[data-editor-empty-dock]')).toBeNull();
expect(document.querySelector('[data-editor-panel-dock-zone="right"]')).toBeNull();
```

Open and dock Entry / Exit right; assert the right dock appears. Close it; assert the dock disappears and canvas returns to one-column layout.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npm test -- --run src/features/editor/workspace/editorWorkspaceLayout.test.ts src/__tests__/editorDensityCleanup.test.tsx
```

Expected: left placements remain left and persistent tree assertions FAIL.

- [ ] **Step 4: Integrate the persistent rail**

In `EditorPage`:

```ts
const programTree = useMemo(
  () => pathDocumentDraft
    ? buildUpidProgramTree(pathDocumentDraft, activeMachineProfile)
    : null,
  [activeMachineProfile, pathDocumentDraft]
);
```

Register `EditorUpidRail` as `AppRailContent.expanded` and its compact strip as `collapsed`. Program mode renders `EditorProgramTree`; Geometry mode renders the existing Contour Tree content. Preserve document selection between lenses.

- [ ] **Step 5: Remove empty dock chrome**

Stop using the app rail as `renderEditorDockZone('left')`. Remove left placement controls from active workflow panels. Render `renderEditorDockZone('right')` only when the active panel's normalized placement is `docked-right`.

Normalize legacy `docked-left` to `floating` while keeping remembered floating geometry.

- [ ] **Step 6: Add grid and width rules**

Update `index.css`:

```css
[data-editor-main-grid][data-has-active-right-dock="false"] {
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 1024px) {
  [data-editor-main-grid][data-has-active-right-dock="true"] {
    grid-template-columns: minmax(480px, 1fr) 4px var(--editor-inspector-width);
  }
}
```

Keep the rail width range at 190–360px and defaults at 260px desktop / 220px laptop.

- [ ] **Step 7: Run focused unit/integration tests**

Run:

```bash
npm test -- --run src/features/editor/workspace/editorWorkspaceLayout.test.ts src/__tests__/editorDensityCleanup.test.tsx src/__tests__/editorPathNativeDraft.test.tsx
```

Expected: all selected suites PASS.

- [ ] **Step 8: Update and run workspace Playwright coverage**

Replace empty/symmetric-dock expectations with persistent-rail and active-right-dock expectations.

Run:

```bash
npx playwright test e2e/editor-workspace-panels.spec.ts --workers=1
```

Expected: file PASS on strict Playwright port 3107.

- [ ] **Step 9: Commit**

```bash
git add src/features/editor/EditorPage.tsx src/features/editor/EditorWorkspacePanels.tsx src/features/editor/workspace/editorWorkspaceLayout.ts src/features/editor/workspace/editorWorkspaceLayout.test.ts src/app/AppShell.tsx src/index.css src/__tests__/editorDensityCleanup.test.tsx e2e/editor-workspace-panels.spec.ts
git commit -m "refactor: make UPID rail the path workspace anchor"
```

---

### Task 5: Workflow Header and Shared Density Polish

**Files:**
- Modify: `src/features/editor/EditorWorkflowMenuBar.tsx`
- Modify: `src/features/editor/__tests__/EditorWorkflowMenuBar.test.tsx`
- Modify: `src/features/editor/EditorHeaderBar.tsx`
- Modify: `src/features/dashboard/ProjectListPanel.tsx`
- Modify: `src/index.css`
- Modify: `src/__tests__/appFrontEndRedesign.test.tsx`
- Modify: `e2e/editor-layout.spec.ts`

**Interfaces:**
- Consumes: existing `EditorWorkflowMenuGroup[]`.
- Produces: same six categories and command callbacks with compact, keyboard-safe presentation.

- [ ] **Step 1: Write failing menu behavior tests**

Assert:

- enabled command descriptions appear once in a menu footer, not in every row;
- ArrowDown focuses the first enabled command;
- Escape closes the menu and returns focus to its summary;
- opening a second menu closes the first;
- outside pointer interaction closes the menu;
- disabled reason remains available through `aria-describedby` and title.

Use:

```ts
expect(container.querySelectorAll('[data-editor-workflow-description]')).toHaveLength(1);
expect(
  container.querySelector('[data-editor-workflow-command="machining.command"]')
    ?.textContent
).toBe('Machining command');
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- --run src/features/editor/__tests__/EditorWorkflowMenuBar.test.tsx src/__tests__/appFrontEndRedesign.test.tsx
```

Expected: current two-line bordered command cards violate the new assertions.

- [ ] **Step 3: Implement compact menu presentation**

Replace `details/summary` with a controlled button/menu implementation so focus return, Arrow-key movement, Escape, and outside-pointer closing have one explicit state owner.

Required classes/geometry:

- group label `text-[11px]`;
- menu `min-w-[220px] max-w-[300px]`;
- command row `min-h-[32px]`, one-line label, no individual border;
- one divider between rows;
- one compact footer description;
- viewport-aware left/right alignment.

- [ ] **Step 4: Polish shared density and dashboard overflow**

Update primary panel/tree/control labels to 11–12px where touched. Keep metadata/status at 9–10px. Remove nested panel shadows and redundant borders in the edited surfaces.

In `ProjectListPanel`, replace fixed row columns with responsive grid classes so metadata and actions stack below the desktop breakpoint without horizontal page overflow.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- --run src/features/editor/__tests__/EditorWorkflowMenuBar.test.tsx src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx
```

Expected: all selected suites PASS.

- [ ] **Step 6: Run focused browser layout test**

Add assertions that all six menus remain visible at 1024px, each open menu stays inside the viewport, and command rows are 30–34px tall.

Run:

```bash
npx playwright test e2e/editor-layout.spec.ts --workers=1
```

Expected: file PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/editor/EditorWorkflowMenuBar.tsx src/features/editor/__tests__/EditorWorkflowMenuBar.test.tsx src/features/editor/EditorHeaderBar.tsx src/features/dashboard/ProjectListPanel.tsx src/index.css src/__tests__/appFrontEndRedesign.test.tsx e2e/editor-layout.spec.ts
git commit -m "style: refine workbench workflow density"
```

---

### Task 6: Compact Rail and Workflow Drawers

**Files:**
- Modify: `src/features/editor/EditorUpidRail.tsx`
- Modify: `src/features/editor/__tests__/EditorUpidRail.test.tsx`
- Modify: `src/features/editor/EditorWorkspacePanels.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Modify: `e2e/editor-layout.spec.ts`

**Interfaces:**
- Consumes: rail mode/content and active workflow placement.
- Produces: explicit program-tree and workflow drawers below 768px.

- [ ] **Step 1: Write failing component tests**

Render compact mode and assert:

```ts
expect(screen.getByRole('button', { name: 'Open UPID rail' })).toBeTruthy();
expect(screen.getByRole('button', { name: 'Open active workflow' })).toBeTruthy();
```

Open the UPID drawer, then the workflow drawer, and assert they are mutually exclusive. Escape closes the active drawer and returns focus to its launcher.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- --run src/features/editor/__tests__/EditorUpidRail.test.tsx
```

Expected: drawer launchers and dialog state are missing.

- [ ] **Step 3: Implement drawer behavior**

Use semantic dialog/sheet behavior with:

```ts
type EditorCompactDrawer = 'upid' | 'workflow' | null;
```

The UPID launcher exists whenever a path project is active. The workflow launcher exists only while a workflow is active. Opening one closes the other. Do not unmount the workflow session when its drawer closes.

- [ ] **Step 4: Replace hidden-mobile CSS**

Remove the media rule that applies `display: none` to rails/docks. At widths below 768px, hide only the inline panel presentation and show its launcher/drawer representation.

- [ ] **Step 5: Run focused tests and build**

Run:

```bash
npm test -- --run src/features/editor/__tests__/EditorUpidRail.test.tsx src/__tests__/editorDensityCleanup.test.tsx
npm run build
```

Expected: tests and build PASS.

- [ ] **Step 6: Run compact Playwright coverage**

At 767×800:

- import a DXF;
- open the UPID drawer;
- choose Entry / lead-in;
- verify the active workflow drawer opens;
- close/reopen it without losing draft state;
- assert document width does not exceed 767px.

Run:

```bash
npx playwright test e2e/editor-layout.spec.ts --workers=1
```

Expected: file PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/editor/EditorUpidRail.tsx src/features/editor/__tests__/EditorUpidRail.test.tsx src/features/editor/EditorWorkspacePanels.tsx src/app/AppShell.tsx src/index.css e2e/editor-layout.spec.ts
git commit -m "feat: add compact UPID and workflow drawers"
```

---

### Task 7: End-to-End Program-Tree Workflows and Full Verification

**Files:**
- Create: `e2e/editor-upid-program-tree.spec.ts`
- Modify: `e2e/fixtures/workbench-cache.ts`

**Interfaces:**
- Consumes: completed program rail, tree routing, persistence, menu, and drawer behavior.
- Produces: real-browser proof of the required user workflows.

- [ ] **Step 1: Write the persistence journey**

Test:

1. import a two-contour DXF;
2. expand the second operation;
3. open Entry / lead-in from its tree action;
4. set and Save a straight entry;
5. save the project;
6. reload;
7. reopen the project;
8. assert the same operation/action/status and entry coordinates remain.

- [ ] **Step 2: Write the stop and dirty-transition journeys**

Test an existing stop deep link/update, then test Cancel, Discard, and Save when moving between tree actions with a dirty workflow. Assert Save creates one undo step.

- [ ] **Step 3: Write shell-regression journeys**

Cover:

- UPID export/download and clean browser-cache reimport retains program-tree order and source provenance;
- external `.nc` import/edit/save/reload/export still uses the machine-program editor;
- no path-editor rail or workflow change leaks into the machine-program layout.

- [ ] **Step 4: Run the new E2E file**

Confirm port 3107 is free:

```bash
ss -ltn '( sport = :3107 )'
```

Then run:

```bash
npx playwright test e2e/editor-upid-program-tree.spec.ts --workers=1
```

Expected: the completed Tasks 1–6 satisfy all new journeys and the file PASS.

- [ ] **Step 5: Run all focused editor/application tests**

Run:

```bash
npm test -- --run src/domain/upid/__tests__/upidProgramTree.test.ts src/features/editor/__tests__/EditorProgramTree.test.tsx src/features/editor/__tests__/EditorUpidRail.test.tsx src/features/editor/__tests__/EditorProgramStopsPanel.test.tsx src/features/editor/__tests__/EditorWorkflowMenuBar.test.tsx src/features/editor/editorProgramTreeActions.test.ts src/__tests__/editorPathNativeDraft.test.tsx src/__tests__/editorDensityCleanup.test.tsx
```

Expected: all selected tests PASS.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm test -- --run
npm run build
npx playwright test --workers=1
```

Expected: complete Vitest suite, production build, and serialized Playwright suite PASS with zero failures.

- [ ] **Step 7: Run the React best-practices review**

Review all changed TSX files for:

- one focused component per new file;
- hooks called unconditionally with complete dependency arrays;
- derived state not mirrored through effects;
- stable tree keys;
- semantic buttons/tree/dialog behavior;
- no inline identity-sensitive object literals passed to memoized children;
- typed event handlers and discriminated unions.

Apply minimal fixes and re-run the covering focused tests plus build.

- [ ] **Step 8: Commit**

```bash
git add e2e/editor-upid-program-tree.spec.ts e2e/fixtures/workbench-cache.ts src
git commit -m "test: verify UPID program workbench workflows"
```

---

## Completion Gate

Before reporting completion:

1. Compare the implementation line-by-line with `docs/superpowers/specs/2026-07-26-upid-program-workbench-ui-design.md`.
2. Run `git diff --check`.
3. Run the full Vitest suite, production build, and serialized Playwright suite fresh.
4. Start Vite on an explicitly checked unused strict port and use `agent-browser` in a named session to:
   - verify meaningful content and no error overlay;
   - inspect the Program rail at 1280×720 and 1024×720;
   - open every workflow menu;
   - edit a tree action and save it;
   - capture dashboard, default path editor, active workflow, and compact drawer screenshots;
   - inspect console and page errors;
   - close the browser and stop the server.
5. Dispatch a whole-branch code review and resolve every Critical/Important finding.
