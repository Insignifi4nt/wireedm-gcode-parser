# Wire EDM Front-End Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dashboard-plus-hidden-panels interface with a compact Workbench start screen and clearly differentiated Path Project and Machine Program workspaces while preserving every implemented domain behavior.

**Architecture:** Keep `useWorkbenchAppController` and all domain APIs as the behavioral boundary. Refactor only the React composition: a full-width application shell with unified settings/status, explicit start actions, document-context-aware editor chrome, useful default workspace panels, and advanced docking retained behind reliable controls. Add regression tests at each boundary before implementation and keep the two editor data models discriminated by `LoadedEditorProgram.model`.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, Lucide React, Vitest/jsdom, Playwright Chromium.

## Global Constraints

- Preserve all existing file types, domain calculations, persistence paths, editor commands, and generated program text.
- Browser-cache startup and one-off imports must work without folder permission.
- DXF projects remain UPID/path-native; generated G-code exists only at explicit export preview.
- `.gcode`, `.nc`, `.iso`, and `.txt` retain the existing cleanup, text-edit, parse, normalize, and export pipeline.
- Output extension remains a writing choice and must not alter generated text.
- Do not add feeds, physical machine connection, simulated machining, fake project data, or dead controls.
- Do not modify or stage `docs/superpowers/2026-07-08-bug-hunt-ledger.md`.

---

### Task 1: Lock the new product contexts and start actions with tests

**Files:**
- Create: `src/__tests__/appFrontEndRedesign.test.tsx`
- Create: `src/features/dashboard/StartWorkPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/DashboardHeader.tsx`
- Modify: `src/__tests__/appWorkbenchDashboard.test.tsx`
- Modify: `src/__tests__/appDxfProjects.test.tsx` (stale placeholder-copy assertion only)

**Interfaces:**
- Consumes: `WorkbenchAppController.handleImportDxfFile(file)`, `handleImportExternalProgram(file)`, and `handleOpenEditor()`.
- Produces: `StartWorkPanelProps` with explicit DXF, machine-program, and empty-program entry actions; Dashboard receives external-program import status/error and handler.

- [ ] **Step 1: Write failing start-screen and document-context tests**

Add focused tests that render the real application and assert the new contract:

```tsx
it('presents explicit Path Project and Machine Program entry points', async () => {
  window.showDirectoryPicker = undefined;
  await renderApp(context);

  expect(container.textContent).toContain('Workbench');
  expect(container.textContent).toContain('Import DXF as Path Project');
  expect(container.textContent).toContain('Open Machine Program');
  expect(container.textContent).toContain('.gcode, .nc, .iso, .txt');
  expect(container.textContent).not.toContain('Export preview only');
});

it('opens an imported posted file in the Machine Program workspace', async () => {
  window.showDirectoryPicker = undefined;
  await renderApp(context);
  const input = container.querySelector('input[aria-label="Machine program file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['G90\nG0 X0 Y0\nG1 X5 Y5'], 'sample.iso')]
  });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await flushAsync();
  expect(container.textContent).toContain('sample.iso');
  expect(container.querySelector('[data-editor-canvas-model="gcode"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `npm test -- --run src/__tests__/appFrontEndRedesign.test.tsx`

Expected: FAIL because `StartWorkPanel`, explicit copy, and direct posted-program import do not exist.

- [ ] **Step 3: Implement the explicit start actions**

Create a compact `StartWorkPanel` with two hidden inputs and three real actions:

```tsx
export interface StartWorkPanelProps {
  connected: boolean;
  dxfErrorMessage: string | null;
  dxfImporting: boolean;
  programErrorMessage: string | null;
  programImporting: boolean;
  onImportDxfFile: (file: File) => void | Promise<void>;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onOpenEditor: () => void;
}
```

Use labels `Import DXF as Path Project`, `Open Machine Program`, and `Open Editor`. Keep `aria-label="DXF file"` for the DXF input and use `aria-label="Machine program file"` for the posted-program input. Pass the controller's existing editor import handler/status/error into `DashboardPage` from `App.tsx`.

- [ ] **Step 4: Run focused application tests**

Run: `npm test -- --run src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx src/__tests__/editorImportExport.test.tsx`

Expected: PASS. Update only stale placeholder-copy assertions in
`appWorkbenchDashboard.test.tsx` and `appDxfProjects.test.tsx`; retain their
storage and behavior contracts.

- [ ] **Step 5: Commit the start-screen behavior**

```bash
git add src/App.tsx src/features/dashboard/DashboardPage.tsx src/features/dashboard/DashboardHeader.tsx src/features/dashboard/StartWorkPanel.tsx src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx src/__tests__/appDxfProjects.test.tsx
git commit -m "feat: clarify workbench document entry points"
```

### Task 2: Consolidate the application shell, persistent status, and settings

**Files:**
- Create: `src/app/MachineOutputSettingsPanel.tsx`
- Create: `src/app/workbenchSettings.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/WorkbenchSettingsDialog.tsx`
- Modify: `src/App.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Delete: `src/features/dashboard/WorkbenchSettingsPanel.tsx`
- Delete: `src/features/dashboard/dashboardSettings.ts`
- Modify: `src/__tests__/appWorkbenchDashboard.test.tsx`
- Modify: `src/__tests__/appFrontEndRedesign.test.tsx`
- Modify: `src/__tests__/appDxfProjects.test.tsx` (settings-relocation setup only)

**Interfaces:**
- Consumes: `ConnectedWorkbench`, `UpdateWorkbenchSettingsInput`, storage connection handler, settings status/error.
- Produces: one `WorkbenchSettingsDialog` with `storage` and `machine-output` sections plus `[data-app-status-bar]`.

- [ ] **Step 1: Write failing unified-settings and shell-status tests**

```tsx
it('keeps environment configuration in one settings surface', async () => {
  await renderApp(context);
  click(container.querySelector('button[aria-label="Open settings"]'));
  click(container.querySelector('button[aria-label="Machine & Output settings"]'));
  const dialog = container.querySelector('[role="dialog"][aria-label="Workbench settings"]');
  expect(dialog?.querySelector('input[aria-label="Machine profile name"]')).not.toBeNull();
  expect(dialog?.querySelector('textarea[aria-label="Header template"]')).not.toBeNull();
  expect(dialog?.querySelector('select[aria-label="Output extension"]')).not.toBeNull();
  expect(container.querySelector('[data-workbench-page] textarea[aria-label="Header template"]')).toBeNull();
});

it('shows storage, machine, output, and project state in the application status bar', async () => {
  await renderApp(context);
  const status = container.querySelector('[data-app-status-bar]');
  expect(status?.textContent).toContain('Browser cache');
  expect(status?.textContent).toContain('Default Wire EDM');
  expect(status?.textContent).toContain('.iso');
  expect(status?.textContent).toContain('0 projects');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx`

Expected: FAIL because machine/output settings still occupy the dashboard and there is no application status bar.

- [ ] **Step 3: Move the settings draft and form into the app layer**

Move `SettingsDraft`, `settingsDraftFromWorkbench`, and the existing validated submit mapping into `src/app/`. Keep the exact `UpdateWorkbenchSettingsInput` shape:

```ts
{
  header,
  footer,
  machineProfile: {
    ...activeWorkbench.activeMachineProfile,
    name,
    templates: { header, footer },
    output: { extension, customExtension, lineEnding },
    workArea: { widthMm, lengthMm }
  },
  output: { extension, customExtension, lineEnding }
}
```

- [ ] **Step 4: Build one settings dialog and a compact application status bar**

Add dialog navigation buttons with stable labels `Storage settings` and `Machine & Output settings`. Pass settings state/handler from `App` through `AppShell`. Remove the dashboard settings form. In `AppShell`, render `[data-app-status-bar]` with the active adapter label, machine profile name, normalized output extension, line ending, and project count.

Only render the contextual left rail when `railContent` exists; otherwise the Workbench page uses full width. Preserve the resizable/collapsible rail when an editor registers content.

- [ ] **Step 5: Update legacy tests for the new settings location**

Open Settings and select Machine & Output before querying its fields. Replace the old storage-rail collapse test with a full-width Workbench assertion and retain editor-rail tests in the editor suite.

- [ ] **Step 6: Run focused tests and build**

Run: `npm test -- --run src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx`

Run: `npm run build`

Expected: PASS; no TypeScript errors.

- [ ] **Step 7: Commit the unified shell and settings**

```bash
git add src/App.tsx src/app/AppShell.tsx src/app/WorkbenchSettingsDialog.tsx src/app/MachineOutputSettingsPanel.tsx src/app/workbenchSettings.ts src/features/dashboard/DashboardPage.tsx src/__tests__/appWorkbenchDashboard.test.tsx src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/appDxfProjects.test.tsx
git rm src/features/dashboard/WorkbenchSettingsPanel.tsx src/features/dashboard/dashboardSettings.ts
git commit -m "feat: unify workbench shell status and settings"
```

### Task 3: Recompose the Workbench project library and latest activity

**Files:**
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/DashboardHeader.tsx`
- Modify: `src/features/dashboard/ProjectListPanel.tsx`
- Modify: `src/features/dashboard/LatestDxfImportPanel.tsx`
- Modify: `src/features/dashboard/ProjectActionDialog.tsx`
- Modify: `src/__tests__/appWorkbenchDashboard.test.tsx`
- Modify: `src/__tests__/appDxfProjects.test.tsx`
- Modify: `e2e/app-shell.spec.ts`

**Interfaces:**
- Consumes: existing project index and mutation handlers; `latestImport` session state.
- Produces: `[data-workbench-page]`, a primary project-library region, restrained project actions, and latest activity only when real data exists.

- [ ] **Step 1: Add failing Workbench hierarchy tests**

Assert that the project library is primary, the empty state names both workflow types, latest activity is absent before an import, and destructive row actions remain accessible by name without dominating every row.

```tsx
expect(container.querySelector('[data-workbench-page]')).not.toBeNull();
expect(container.querySelector('[data-project-library]')).not.toBeNull();
expect(container.textContent).toContain('No projects yet');
expect(container.textContent).toContain('Path Project');
expect(container.textContent).toContain('Machine Program');
expect(container.textContent).not.toContain('Latest DXF Import');
```

- [ ] **Step 2: Run focused tests to confirm failure**

Run: `npm test -- --run src/__tests__/appWorkbenchDashboard.test.tsx src/__tests__/appDxfProjects.test.tsx`

Expected: FAIL on the new page/region markers and latest-activity condition.

- [ ] **Step 3: Implement the full-width Workbench composition**

Use a two-column desktop grid with project library first and start/activity second, collapsing to one scrollable column below 1180px. Keep search, filter, sort, Open, Rename, and Delete behavior. Display source labels as `Path Project` and `Machine Program`; retain source values in data attributes for tests and filtering.

Render `LatestDxfImportPanel` only when `latestImport` exists. Remove placeholder manifest/folder/posting copy and all configuration children.

- [ ] **Step 4: Update the browser smoke contract**

Change `e2e/app-shell.spec.ts` to assert the Workbench title, both start actions, project library, global status bar, and absence of fake project rows.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run src/__tests__/appWorkbenchDashboard.test.tsx src/__tests__/appDxfProjects.test.tsx`

Run: `npx playwright test e2e/app-shell.spec.ts --reporter=line`

Expected: PASS.

- [ ] **Step 6: Commit the Workbench page**

```bash
git add src/features/dashboard/DashboardPage.tsx src/features/dashboard/DashboardHeader.tsx src/features/dashboard/ProjectListPanel.tsx src/features/dashboard/LatestDxfImportPanel.tsx src/features/dashboard/ProjectActionDialog.tsx src/__tests__/appWorkbenchDashboard.test.tsx src/__tests__/appDxfProjects.test.tsx e2e/app-shell.spec.ts
git commit -m "feat: rebuild the workbench project start screen"
```

### Task 4: Make editor document context and primary commands persistent

**Files:**
- Create: `src/features/editor/EditorStatusBar.tsx`
- Modify: `src/features/editor/EditorHeaderBar.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/__tests__/appFrontEndRedesign.test.tsx`
- Modify: `src/__tests__/editorImportExport.test.tsx`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`

**Interfaces:**
- Consumes: `LoadedEditorProgram.model`, dirty signature, undo/redo stacks, save/export handlers, selection, cursor, metrics, diagnostics, and machine-fit result.
- Produces: `[data-editor-context="path-project|machine-program|empty-program"]`, visible Undo/Redo/Save/Export controls, and `[data-editor-status-bar]`.

- [ ] **Step 1: Write failing editor-context tests**

```tsx
expect(container.querySelector('[data-editor-context="path-project"]')).not.toBeNull();
expect(container.textContent).toContain('Path Project');
expect(container.querySelector('button[aria-label="Save active document"]')).not.toBeNull();
expect(container.querySelector('button[aria-label="Open Path Project export preview"]')).not.toBeNull();
expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain('Saved');
```

Repeat for an imported `.iso`, asserting `machine-program`, visible Program Lines, `Export normalized ISO`, and no Path Project export action.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- --run src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/editorImportExport.test.tsx src/__tests__/editorPathNativeDraft.test.tsx`

Expected: FAIL because context markers and persistent commands/status do not exist.

- [ ] **Step 3: Add context-aware header commands**

Extend `EditorHeaderBar` with:

```ts
documentContext: 'empty-program' | 'machine-program' | 'path-project';
hasUnsavedChanges: boolean;
isSaving: boolean;
undoAvailable: boolean;
redoAvailable: boolean;
onUndo: () => void;
onRedo: () => void;
onSave: () => void | Promise<void>;
onExport: (() => void) | null;
exportLabel: string | null;
```

Render a visible context badge and compact labeled/icon controls. Keep the existing file import and usage guide controls. Rename the return action visually to `Workbench` while retaining an accessible name containing `Dashboard` during the compatibility transition if legacy tests require it.

- [ ] **Step 4: Add the technical editor status bar**

Create a focused component that renders document type, Saved/Modified/Saving state, current selection summary, cursor X/Y, move/operation counts, diagnostics, machine profile, and machine-fit state from already-computed editor values. Do not add calculations.

- [ ] **Step 5: Add unsaved-navigation guards**

Wrap Back and replacement program import with `window.confirm('Discard unsaved changes?')` only when the active draft is modified. Add `beforeunload` while modified. Keep Save and same-document editing unchanged. Add tests with `vi.spyOn(window, 'confirm')` for cancel and confirm paths.

- [ ] **Step 6: Run focused tests and build**

Run: `npm test -- --run src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/editorImportExport.test.tsx src/__tests__/editorPathNativeDraft.test.tsx`

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit document context**

```bash
git add src/features/editor/EditorHeaderBar.tsx src/features/editor/EditorStatusBar.tsx src/features/editor/EditorPage.tsx src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/editorImportExport.test.tsx src/__tests__/editorPathNativeDraft.test.tsx
git commit -m "feat: differentiate editor document workspaces"
```

### Task 5: Replace empty default docks with useful Path and Program workspaces

**Files:**
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/EditorWorkspacePanels.tsx`
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorInspectorPanel.tsx`
- Modify: `src/features/editor/__tests__/EditorWorkspacePanels.test.tsx`
- Modify: `src/__tests__/appDxfProjects.test.tsx`
- Modify: `src/__tests__/editorImportExport.test.tsx`
- Modify: `e2e/editor-layout.spec.ts`
- Modify: `e2e/editor-workspace-panels.spec.ts`

**Interfaces:**
- Consumes: the existing 12 panel renderers and dock/floating controller.
- Produces: default placements `contour-tree -> docked-left`, `path-actions -> docked-right`, expanded docks for Path Projects, and expanded program/inspector rail for Machine Programs.

- [ ] **Step 1: Write failing default-layout tests**

For a DXF import, assert:

```tsx
expect(panel('contour-tree')).toHaveAttribute('data-editor-workspace-panel-placement', 'docked-left');
expect(panel('path-actions')).toHaveAttribute('data-editor-workspace-panel-placement', 'docked-right');
expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');
expect(rightDock).toHaveAttribute('data-editor-panel-dock-zone-collapsed', 'false');
```

For a posted program, assert the Program Lines panel is visible without clicking `Expand Inspector Rail`.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- --run src/__tests__/appDxfProjects.test.tsx src/__tests__/editorImportExport.test.tsx src/features/editor/__tests__/EditorWorkspacePanels.test.tsx`

Expected: FAIL because every path panel defaults hidden and both docks default collapsed.

- [ ] **Step 3: Add model-specific default placement helpers**

Initialize/reset panel state when `program?.filePath` and model change:

```ts
const PATH_DEFAULT_PLACEMENTS = createDefaultPanelRecord((id) =>
  id === 'contour-tree' ? 'docked-left' : id === 'path-actions' ? 'docked-right' : 'hidden'
);
const PATH_DEFAULT_DOCK_ORDERS = { left: ['contour-tree'], right: ['path-actions'] };
```

Expand the left/right docks once when a Path Project opens. Do not run the collapse/expand effect on every edited draft object. For `gcode-text` or the empty program workspace, keep the app rail absent and initialize the program inspector expanded.

- [ ] **Step 4: Make Workspace controls reliable and direct**

Change the panel summary click to `setMenuOpen(current => !current)`, close after selecting an item, and retain hover behavior. Rename the trigger from generic `Panels` to `Workspace`. Add direct quick buttons for Tree, Actions, Transform, Diagnostics, and Measure by reusing each panel controller's `onShow/onHide`; the categorized menu still exposes every panel.

- [ ] **Step 5: Restore the checked-in transform browser contracts**

In the Transform panel, render:

```tsx
<p data-upid-transform-document-placement-help>
  Move the active reference or selection center to X0 Y0, or enter a precise target.
</p>
<dd data-upid-transform-source-extents>{formatDrawingExtents(pathDocument.source.drawing?.extents)}</dd>
<dd data-upid-transform-source-base>{formatPoint(pathDocument.source.drawing?.basePoint)}</dd>
```

Use the existing source metadata only; do not transform or scale it.

- [ ] **Step 6: Update layout and panel tests**

Adjust tests that assumed all panels were hidden. Helpers must only click controls whose aria-label begins with `Show`, so already-visible defaults remain untouched. Keep every docking/floating, transform, topology, diagnostic, selection, drag, and construction browser test.

- [ ] **Step 7: Run focused unit and browser tests**

Run: `npm test -- --run src/features/editor/__tests__/EditorWorkspacePanels.test.tsx src/__tests__/appDxfProjects.test.tsx src/__tests__/editorImportExport.test.tsx`

Run: `npx playwright test e2e/editor-layout.spec.ts e2e/editor-workspace-panels.spec.ts --reporter=line`

Expected: PASS, including the eight formerly failing browser cases.

- [ ] **Step 8: Commit the workspace defaults**

```bash
git add src/features/editor/EditorPage.tsx src/features/editor/EditorWorkspacePanels.tsx src/features/editor/EditorPathNavigatorPanel.tsx src/features/editor/EditorInspectorPanel.tsx src/features/editor/__tests__/EditorWorkspacePanels.test.tsx src/__tests__/appDxfProjects.test.tsx src/__tests__/editorImportExport.test.tsx e2e/editor-layout.spec.ts e2e/editor-workspace-panels.spec.ts
git commit -m "feat: provide task-focused editor workspaces"
```

### Task 6: Apply the restrained technical visual system and responsive behavior

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/WorkbenchSettingsDialog.tsx`
- Modify: `src/app/MachineOutputSettingsPanel.tsx`
- Modify: `src/features/dashboard/StartWorkPanel.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/ProjectListPanel.tsx`
- Modify: `src/features/dashboard/LatestDxfImportPanel.tsx`
- Modify: `src/features/editor/EditorHeaderBar.tsx`
- Modify: `src/features/editor/EditorStatusBar.tsx`
- Modify: `src/features/editor/EditorCanvasPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorInspectorPanel.tsx`
- Modify: `src/features/editor/EditorWorkspacePanels.tsx`
- Modify: `e2e/app-shell.spec.ts`
- Modify: `e2e/editor-layout.spec.ts`

**Interfaces:**
- Consumes: existing semantic colors/data attributes and layout state.
- Produces: consistent CSS tokens/classes, visible scrollbars in work regions, desktop-first three-region layout, and a usable one-column Workbench below 1180px.

- [ ] **Step 1: Add failing overflow and hierarchy assertions**

In Playwright, check 1440x900 and 1024x720:

```ts
await expect(page.locator('[data-workbench-page]')).toBeVisible();
expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
await expect(page.locator('[data-project-library]')).toBeVisible();
await expect(page.getByRole('button', { name: /Import DXF as Path Project/i })).toBeVisible();
```

For editor context, assert canvas, visible default rail, status bar, and primary header commands fit without horizontal document overflow.
Use deterministic browser-cache imports for these assertions so the 1024px editor checks cannot skip when an external workbench fixture is unavailable.

- [ ] **Step 2: Run the browser assertions and verify current failure where applicable**

Run: `npx playwright test e2e/app-shell.spec.ts e2e/editor-layout.spec.ts --reporter=line`

Expected: At least the new visual hierarchy/overflow assertions fail before styling is applied.

- [ ] **Step 3: Define the visual tokens and shared utility classes**

Update colors to a quiet graphite/cyan semantic palette, remove decorative body grid gradients, reserve monospace for technical values, and stop globally hiding scrollbars. Add focused classes for technical labels, panels, toolbars, status segments, form controls, focus-visible rings, and subtle work-region scrollbars.

- [ ] **Step 4: Apply density and responsive rules**

Use 28-32px controls, 11-13px labels/body, square/minimally rounded surfaces, single separators instead of nested card borders, restrained action color, and compact status areas. Make the Workbench columns collapse below 1180px. At 1024px, keep editor regions usable and expose side-region collapse controls. Avoid a generic mobile redesign.
Cap the default left/right editor tracks with CSS at the laptop breakpoint so the canvas remains at least 400px wide without overwriting user-resized state.

- [ ] **Step 5: Capture and inspect screenshots**

Use Playwright to capture:

```text
/tmp/wireedm-redesign-workbench-1440.png
/tmp/wireedm-redesign-path-1440.png
/tmp/wireedm-redesign-program-1440.png
/tmp/wireedm-redesign-workbench-1024.png
/tmp/wireedm-redesign-path-1024.png
```

Inspect each for context clarity, clipping, empty docks, excessive borders, unreadable text, and visual competition with geometry/code. Fix issues before continuing.

- [ ] **Step 6: Run focused tests and build**

Run: `npm test -- --run src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx src/__tests__/appDxfProjects.test.tsx src/__tests__/editorImportExport.test.tsx`

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit the visual system**

```bash
git add src/index.css src/components/ui/button.tsx src/app/AppShell.tsx src/app/WorkbenchSettingsDialog.tsx src/app/MachineOutputSettingsPanel.tsx src/features/dashboard/StartWorkPanel.tsx src/features/dashboard/DashboardPage.tsx src/features/dashboard/ProjectListPanel.tsx src/features/dashboard/LatestDxfImportPanel.tsx src/features/editor/EditorHeaderBar.tsx src/features/editor/EditorStatusBar.tsx src/features/editor/EditorCanvasPanel.tsx src/features/editor/EditorPage.tsx src/features/editor/EditorPathNavigatorPanel.tsx src/features/editor/EditorInspectorPanel.tsx src/features/editor/EditorWorkspacePanels.tsx e2e/app-shell.spec.ts e2e/editor-layout.spec.ts
git commit -m "style: establish the technical workbench visual system"
```

### Task 7: Full regression and product review

**Files:**
- Modify only files required by failures discovered in this task.
- Verify: `docs/superpowers/specs/2026-07-10-wire-edm-front-end-redesign.md`

**Interfaces:**
- Consumes: the complete implementation and functionality inventory.
- Produces: a green test/build/browser baseline and documented evidence for every redesign success criterion.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm test -- --run`

Expected: `42+` files pass and all existing/new tests pass.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite build pass. The existing chunk-size warning may remain; no new build error is acceptable.

- [ ] **Step 3: Run the complete Chromium suite against the correct app**

Stop any manually started Vite server first, then run:

```bash
CI=1 npm run test:e2e -- --reporter=line
```

Expected: all runnable tests pass; real-workbench tests may skip only when their documented fixture folder is unavailable.

- [ ] **Step 4: Verify primary and alternative workflows manually in Playwright**

Check:

1. Empty browser cache and temporary-storage warning states.
2. DXF import → Path Project → select/edit/transform/save → export preview/download.
3. Machine-program import → line/group edit → normalize/save/export.
4. Project search/filter/sort/open/rename/delete.
5. Settings Storage and Machine & Output save/error states.
6. Dirty navigation cancel/confirm.
7. Workspace panel show/hide/float/dock/resize and reliable menu close.
8. Empty, loading, disabled, invalid, warning, error, disconnected-folder, and machine-too-large states.

- [ ] **Step 5: Compare against the functionality inventory**

Read each bullet under `Functionality Inventory and Regression Contract` in the design spec. For each item, identify its passing domain/UI/browser test or perform a direct browser check. Fix any unreachable or broken behavior before declaring completion.

- [ ] **Step 6: Review the application as one product**

At 1440x900 and 1024x720, confirm:

- document type is unmistakable;
- work is visually dominant;
- core commands are visible;
- settings do not dominate;
- no empty default dock remains;
- advanced panels remain discoverable;
- labels/values/scrollbars remain readable;
- no clipped essential control or accidental horizontal document overflow exists.

- [ ] **Step 7: Commit final integration fixes**

Stage each file changed by the evidence-based final fixes by its exact path, verify
`git diff --cached --name-only` contains no unrelated file, then run:

```bash
git commit -m "fix: complete workbench redesign regressions"
```

Skip staging and this commit when no final fixes were necessary.

## Plan Self-Review

- Every design-spec area maps to a task: entry/IA (Tasks 1 and 3), configuration (Task 2), context and safety (Task 4), editor organization (Task 5), visual/responsive system (Task 6), and complete preservation verification (Task 7).
- No domain parser, planner, storage file layout, machine calculation, or post generator is scheduled for redesign.
- All newly named props, data attributes, component paths, and default panel placements are defined before later tasks consume them.
- The plan contains no deferred placeholders; final-fix staging is intentionally restricted to files actually changed after evidence-based verification.
