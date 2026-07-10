# Editor Density Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the editor header and Path Project panels while preserving direct primary-panel access and all existing editor behavior.

**Architecture:** Keep the existing editor state, panel registry, and callbacks. Change only React composition in the header, workspace toolbar, navigator panels, and measurement panel; lock the presentation contract with focused Vitest and Playwright coverage before each production edit.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Lucide React, Vitest/jsdom, Playwright Chromium.

## Global Constraints

- Preserve DXF parsing, UPID editing, selection, panel placement, save, export, and machine-program behavior.
- Keep Tree, Actions, Sequence, Transform, Diagnostics, Inspect, Measure, and Machine directly accessible at wide desktop widths.
- Keep Undo, Redo, and Save visibly labeled.
- Do not render Import Program in a Path Project; retain it for empty and machine-program contexts.
- A workspace panel owns the scrollbar for its primary row collection.
- Run affected tests, production build, and focused browser checks only; do not run the full test suite.
- Do not modify or stage `docs/superpowers/2026-07-08-bug-hunt-ledger.md`.

---

### Task 1: Compact the editor header without hiding primary panel access

**Files:**
- Create: `src/__tests__/editorDensityCleanup.test.tsx`
- Modify: `src/features/editor/EditorHeaderBar.tsx`
- Modify: `src/features/editor/EditorWorkspacePanels.tsx`
- Modify: `src/features/editor/__tests__/EditorWorkspacePanels.test.tsx`

**Interfaces:**
- Consumes: `EditorHeaderBarProps.documentContext`, existing `workspaceControls`, and each `EditorPanelMenuItem` placement callback.
- Produces: `[data-editor-document-identity]`, icon-only `[data-editor-panel-shortcut]` buttons, compact `summary[aria-label="Panels"]`, and context-specific program import chrome.

- [ ] **Step 1: Write failing header and workspace-toolbar tests**

Add a Path Project integration contract to `editorDensityCleanup.test.tsx`:

```tsx
it('keeps primary panels directly accessible in a compact Path Project header', async () => {
  window.showDirectoryPicker = undefined;
  enableAutoOpenEditorWorkspacePanels();
  await renderApp(context);
  const input = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([simpleLineDxf()], 'density-cleanup.dxf')]
  });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await flushAsync();

  const header = container.querySelector('[data-editor-context="path-project"]');
  expect(header?.querySelector('[data-editor-document-identity]')).not.toBeNull();
  expect(header?.querySelector('button[aria-label="Import Program"]')).toBeNull();
  expect(header?.querySelector('input[aria-label="G-code program file"]')).toBeNull();
  expect(header?.textContent).toContain('Undo');
  expect(header?.textContent).toContain('Redo');
  expect(header?.textContent).toContain('Save');
  expect(header?.querySelector('summary[aria-label="Panels"]')).not.toBeNull();

  const shortcuts = [...header!.querySelectorAll('[data-editor-panel-shortcut]')];
  expect(shortcuts).toHaveLength(8);
  for (const shortcut of shortcuts) {
    expect(shortcut.textContent).toBe('');
    expect(shortcut.getAttribute('title')).toMatch(/^(Show|Hide) /);
  }
});
```

Change the existing `EditorPanelToolbar` shortcut test to require eight empty-text icon buttons whose `aria-label` and `title` identify the full panel and current Show/Hide action. Keep the existing `editorImportExport.test.tsx` empty-program contract in the focused run; it already proves `Import Program` and `input[aria-label="G-code program file"]` remain present outside Path Projects.

- [ ] **Step 2: Run the focused tests and verify the intended failures**

Run:

```bash
npm test -- --run src/features/editor/__tests__/EditorWorkspacePanels.test.tsx src/__tests__/editorDensityCleanup.test.tsx src/__tests__/editorImportExport.test.tsx
```

Expected: FAIL because shortcuts still contain text, document identity uses two rows, the Panels summary is labeled Workspace, and Path Projects still render Import Program.

- [ ] **Step 3: Implement compact header composition**

In `EditorHeaderBar.tsx`:

```tsx
const canImportProgram = documentContext !== 'path-project';

<Button aria-label="Back to Dashboard" className="size-7 shrink-0 p-0" title="Return to Workbench">
  <ArrowLeft />
</Button>
<div className="flex min-w-0 flex-1 items-center gap-1.5" data-editor-document-identity>
  <h2 className="technical-value truncate text-[12px] font-semibold" title={titleTooltip ?? filePath}>
    {heading}
  </h2>
  <span className="shrink-0 border border-border bg-background/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
    {DOCUMENT_CONTEXT_LABELS[documentContext]}
  </span>
</div>
```

Remove the eyebrow and second title row. Place `workspaceControls` in a bordered command group before the document commands. Keep visible Undo, Redo, Save, and Export Preview labels. Guard the existing file input and Import Program button together with `canImportProgram`. Keep Controls icon-only with `aria-label="Open usage guide"`, `title="Controls"`, and no visible label.

- [ ] **Step 4: Implement semantic icon shortcuts and compact Panels menu**

In `EditorWorkspacePanels.tsx`, define the shortcut metadata with Lucide icons:

```tsx
const EDITOR_PANEL_SHORTCUTS = [
  { id: 'contour-tree', icon: ListTree },
  { id: 'path-actions', icon: MousePointer2 },
  { id: 'cut-sequence', icon: ListOrdered },
  { id: 'path-transform', icon: Move },
  { id: 'path-diagnostics', icon: TriangleAlert },
  { id: 'statistics', icon: Search },
  { id: 'measurement', icon: Ruler },
  { id: 'machine', icon: Settings2 }
] as const;
```

Render each shortcut as a square 28px button with only `<Icon aria-hidden="true" />`, `aria-label={`${action} ${panel.title} workspace panel`}`, and `title={`${action} ${panel.title}`}`. Keep `[data-editor-panel-shortcuts]` responsive and non-wrapping. Replace the visible Workspace summary text with `<PanelsTopLeft aria-hidden="true" />`, `aria-label="Panels"`, and `title="All workspace panels"`; keep the categorized menu content unchanged.

- [ ] **Step 5: Run the focused tests and verify green**

Run the same Vitest command from Step 2.

Expected: PASS with no failures.

- [ ] **Step 6: Commit the compact header**

```bash
git add src/features/editor/EditorHeaderBar.tsx src/features/editor/EditorWorkspacePanels.tsx src/features/editor/__tests__/EditorWorkspacePanels.test.tsx src/__tests__/editorDensityCleanup.test.tsx
git commit -m "fix: simplify editor header controls"
```

### Task 2: Replace persistent Contour Tree teaching chrome with hover help

**Files:**
- Modify: `src/__tests__/editorDensityCleanup.test.tsx`
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`

**Interfaces:**
- Consumes: existing tree selection, hover, expand/collapse, and panel-opening callbacks.
- Produces: `button[aria-label="Contour Tree help"]` and `[role="tooltip"][data-upid-contour-tree-tooltip]`; removes the persistent map/help/legend nodes.

- [ ] **Step 1: Add failing compact-tree assertions**

Extend the Path Project integration test:

```tsx
expect(document.querySelector('[data-upid-contour-tree-map]')).toBeNull();
expect(document.querySelector('[data-upid-contour-tree-help]')).toBeNull();
expect(document.querySelector('[data-upid-contour-tree-legend]')).toBeNull();

const helpButton = document.querySelector('button[aria-label="Contour Tree help"]');
const helpTooltip = document.querySelector('[data-upid-contour-tree-tooltip]');
expect(helpButton).not.toBeNull();
expect(helpButton?.getAttribute('aria-describedby')).toBe(helpTooltip?.id);
expect(helpTooltip?.textContent).toContain('cross-highlight the canvas');
expect(helpTooltip?.textContent).toContain('whole cut loop');
expect(helpTooltip?.textContent).toContain('Endpoint Topology');
```

- [ ] **Step 2: Run the integration test and verify red**

Run:

```bash
npm test -- --run src/__tests__/editorDensityCleanup.test.tsx
```

Expected: FAIL because the persistent map/help/legend still exist and the information control does not.

- [ ] **Step 3: Implement one hover/focus information control**

Import `Info` from Lucide. Delete the Tree Map card, explanatory paragraph, legend, and direct Endpoint Join Map launcher. Add this compact control to the real Contour Tree toolbar:

```tsx
<div className="group relative">
  <button
    aria-describedby="contour-tree-help-tooltip"
    aria-label="Contour Tree help"
    className="flex size-6 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    type="button"
  >
    <Info aria-hidden="true" className="size-3" />
  </button>
  <div
    className="pointer-events-none absolute left-0 top-7 z-30 hidden w-64 border border-border bg-popover p-2 text-[10px] normal-case leading-4 text-popover-foreground shadow-xl group-hover:block group-focus-within:block"
    data-upid-contour-tree-tooltip
    id="contour-tree-help-tooltip"
    role="tooltip"
  >
    Hover or select a row to cross-highlight the canvas. A contour is a whole cut loop made from ordered line or arc segments; each segment exposes start and end endpoint handles. Inspect joins in Endpoint Topology from Panels or Diagnostics.
  </div>
</div>
```

Keep root count, Expand All, Collapse All, the tree rows, and every existing tree callback.

- [ ] **Step 4: Run the integration test and verify green**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit the compact tree guidance**

```bash
git add src/features/editor/EditorPathNavigatorPanel.tsx src/__tests__/editorDensityCleanup.test.tsx
git commit -m "fix: move contour tree guidance to hover help"
```

### Task 3: Remove nested primary-list scrolling and verify layout

**Files:**
- Modify: `src/__tests__/editorDensityCleanup.test.tsx`
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorInspectorPanel.tsx`
- Modify: `e2e/editor-layout.spec.ts`

**Interfaces:**
- Consumes: existing Cut Sequence, Endpoint Topology, Diagnostics, Contour Tree, and Measurement row renderers.
- Produces: direct `[data-upid-cut-sequence][data-upid-cut-sequence-list]` rows and uncapped primary-list containers for topology, diagnostics, tree, and measurements.

- [ ] **Step 1: Add failing single-scroll assertions**

Extend `editorDensityCleanup.test.tsx` after auto-opening the workspace panels:

```tsx
const cutSequence = document.querySelector('[data-upid-cut-sequence-list]');
expect(cutSequence?.matches('[data-upid-cut-sequence]')).toBe(true);
expect(cutSequence?.className).not.toMatch(/max-h-|overflow-auto/);

for (const selector of [
  '[data-upid-contour-tree]',
  '[data-upid-endpoint-topology-list]',
  '[data-upid-diagnostics-list]'
]) {
  expect(document.querySelector(selector)?.className).not.toMatch(/max-h-|overflow-auto/);
}
```

After the existing measurement test adds its first point, assert the primary point list is uncapped:

```tsx
const measurementPointList = document.querySelector('[data-measurement-point-list]');
expect(measurementPointList).not.toBeNull();
expect(measurementPointList?.className).not.toMatch(/max-h-|overflow-auto/);
```

- [ ] **Step 2: Run the affected integration tests and verify red**

Run:

```bash
npm test -- --run src/__tests__/editorDensityCleanup.test.tsx src/__tests__/editorMeasurement.test.tsx
```

Expected: FAIL because the primary row collections still own capped nested scrollers.

- [ ] **Step 3: Flatten the primary workspace lists**

In `EditorPathNavigatorPanel.tsx`:

```tsx
<section className="-m-2" data-upid-cut-sequence data-upid-cut-sequence-list>
  {cutSequenceElements.map((pathElement) =>
    renderCutSequenceRow({
      hoveredPathElement,
      isSaving,
      onHoverPathElement,
      onMovePathOperation,
      onSelectPathElement,
      operationCount: cutSequenceElements.length,
      pathElement,
      selectedPathElement
    })
  )}
</section>
```

Remove the repeated Cut Sequence heading and nested list div. Remove `overflow-auto` from `[data-upid-contour-tree]`. Add stable selectors to the topology and diagnostics primary lists and remove their `max-h-32`/`max-h-48` plus `overflow-auto` classes. Retain their borders, empty states, rows, and callbacks.

In `EditorInspectorPanel.tsx`, add `data-measurement-point-list` and remove `max-h-24 overflow-auto` from the measurement row collection. Keep Parse Issues and compact transform point pickers bounded because they are secondary content.

- [ ] **Step 4: Run the affected Vitest files and verify green**

Run the Step 2 command, then run the Task 1 focused command once to cover all changed React boundaries.

Expected: PASS with no failures.

- [ ] **Step 5: Update and run the focused browser layout contract**

In `e2e/editor-layout.spec.ts`, remove Path Project Import Program from the 1024px essential controls list and explicitly assert it is absent. At 1440px, assert all eight shortcuts are visible, each shortcut width is at most 30px, and hovering one exposes its Show/Hide title. Hover `Contour Tree help` and assert the tooltip becomes visible. Open Cut Sequence and assert its primary list does not create a second vertical scrollbar.

Run:

```bash
npx playwright test e2e/editor-layout.spec.ts --grep "path editor keeps direct shortcuts"
```

Expected: PASS at 1440x900 and 1024x720.

- [ ] **Step 6: Run the production build**

Run:

```bash
npm run build
```

Expected: exit 0 with no TypeScript or Vite build errors.

- [ ] **Step 7: Perform final visual checks**

Open the imported DXF editor at 1708x874 and 1024x720. Confirm header grouping, tooltip placement, absence of Path Project import, Contour Tree density, and Cut Sequence use of the full floating-panel body. Correct only issues inside this design scope and repeat the focused tests/build after any correction.

- [ ] **Step 8: Commit the scrolling and layout fix**

```bash
git add src/features/editor/EditorPathNavigatorPanel.tsx src/features/editor/EditorInspectorPanel.tsx src/__tests__/editorDensityCleanup.test.tsx src/__tests__/editorMeasurement.test.tsx e2e/editor-layout.spec.ts
git commit -m "fix: remove nested editor panel scrolling"
```
