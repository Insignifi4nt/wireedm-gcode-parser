# Portable UPID Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add machine-independent UPID path-project import and export through tested domain APIs and compact dashboard controls.

**Architecture:** Treat the existing versioned `WorkbenchUpidState` as the portable file and detach local identity on export. Extend project origins so both DXF and UPID projects use the path editor, while imported UPID projects bind the receiving workbench's active machine snapshot only in their local project container.

**Tech Stack:** React, TypeScript, Vitest, Vite, existing workbench storage adapters and download service.

## Global Constraints

- Preserve all UPID geometry and machining-intent fields without serializing a machine profile.
- Keep the existing DXF import as the primary dashboard action.
- Use a click-operated split menu for UPID import; do not rely on hover.
- Export only persisted project state from a share/forward-arrow icon at the far right of Project Library path-project rows, immediately after Delete; use no visible export text.
- Imported UPID always creates a new project identity and uses the active machine snapshot without mutating path intent.
- Do not add a ZIP dependency, backend, local helper, or raw-DXF payload.

---

### Task 1: Portable UPID Domain Contract

**Files:**
- Create: `src/domain/upid/portableUpidProject.ts`
- Create: `src/domain/upid/__tests__/portableUpidProject.test.ts`
- Modify: `src/domain/workbench/types.ts`
- Modify: `src/domain/storage/workbenchStorage.ts`
- Modify: `src/domain/upid/projectUpid.ts`
- Modify: `src/domain/editor/loadEditorProgram.ts`
- Modify: `src/domain/editor/saveEditorProgram.ts`

**Interfaces:**
- Produces: `exportPortableUpidProject(workbench, projectPath)` returning `{ fileName, text }`.
- Produces: `importPortableUpidProject(workbench, { fileName, text, now? })` returning `{ workbench, project, pathDocument }`.
- Extends `WorkbenchSourceKind` with `'upid'` and treats it as a path-project origin.

- [ ] **Step 1: Write failing export tests**

Assert that export reads persisted state, preserves lead/order/compensation intent, emits the versioned UPID state, omits machine/project container data, and removes `document.source.projectId` without mutating the stored project.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run src/domain/upid/__tests__/portableUpidProject.test.ts`

Expected: FAIL because `portableUpidProject` does not exist.

- [ ] **Step 3: Implement the minimal export API**

Parse the persisted project, validate it through `projectUpidDocument`, clone its UPID state, delete the clone's project identity, sanitize the project display name, and serialize formatted JSON.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --run src/domain/upid/__tests__/portableUpidProject.test.ts`

Expected: PASS for export cases.

- [ ] **Step 5: Write failing import tests**

Assert validation-before-write, unique identity, identity restamping, `upid` origin, no owned source files, active-machine snapshot binding, path-intent preservation, and manifest publication.

- [ ] **Step 6: Run the focused test and verify RED**

Run the Task 1 focused command and confirm failures identify missing import behavior.

- [ ] **Step 7: Implement import and path-origin support**

Add the `upid` origin, replace DXF-only UPID guards with a shared path-origin predicate, create the local project from the receiving workbench, stamp the new identity, write the project before publishing the manifest, and return the loadable path state.

- [ ] **Step 8: Run domain regressions**

Run: `npm test -- --run src/domain/upid/__tests__/portableUpidProject.test.ts src/domain/editor/__tests__/loadEditorProgram.test.ts src/domain/editor/__tests__/saveEditorProgram.test.ts`

Expected: all selected tests pass.

### Task 2: Application Services and Controller Flow

**Files:**
- Modify: `src/app/appServices.ts`
- Modify: `src/app/useWorkbenchAppController.ts`
- Modify: `src/domain/post/downloadProgramFile.ts` only if its generic text-download contract needs a type adjustment.
- Test: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes: portable import/export APIs from Task 1.
- Produces: dashboard callbacks for `onImportUpidFile` and `onExportUpidProject`.

- [ ] **Step 1: Write failing controller-level tests**

Assert that UPID file import updates the connected workbench, loads the returned path document, opens the editor, and reports failures without changing view. Assert that row export calls the portable export API and text downloader.

- [ ] **Step 2: Run the focused app test and verify RED**

Run: `npm test -- --run src/__tests__/appDxfProjects.test.tsx`

Expected: FAIL because UPID callbacks/services are absent.

- [ ] **Step 3: Add service and controller wiring**

Expose the two APIs through `AppServices`, implement operation locking and stale-operation guards consistent with DXF import, download exported JSON through `downloadTextFile`, and surface concise status toasts.

- [ ] **Step 4: Run the focused app test and verify GREEN**

Run the Task 2 focused command and confirm the new controller tests pass.

### Task 3: Dashboard Split Import and Row Export

**Files:**
- Modify: `src/features/dashboard/StartWorkPanel.tsx`
- Modify: `src/features/dashboard/ProjectListPanel.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/ProjectActionDialog.tsx`
- Test: `src/__tests__/appFrontEndRedesign.test.tsx`
- Test: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes: `onImportUpidFile(file)` and `onExportUpidProject(projectPath)`.
- Produces: accessible split-menu import control and path-only export buttons.

- [ ] **Step 1: Write failing component/app tests**

Assert that DXF remains the primary label, the chevron opens on click, the menu item triggers an `.upid.json,application/json` input, Escape/outside click dismisses the menu, and only `dxf`/`upid` rows show an accessible Export UPID share/forward-arrow icon after Delete.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `npm test -- --run src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/appDxfProjects.test.tsx`

Expected: FAIL because split import and export controls are absent.

- [ ] **Step 3: Implement the compact dashboard controls**

Build the DXF button and narrow chevron as a grouped control, manage an accessible click menu with keyboard/outside dismissal, add the hidden UPID file input, and add a textless share/forward-arrow icon action as the final action for path rows.

- [ ] **Step 4: Run focused UI tests and verify GREEN**

Run the Task 3 focused command and confirm all selected tests pass.

### Task 4: Full Regression and Build Verification

**Files:**
- Modify tests or implementation only for failures caused by this feature.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified repository state.

- [ ] **Step 1: Run storage, UPID, and dashboard regression tests**

Run: `npm test -- --run src/domain/storage src/domain/upid src/domain/editor src/__tests__/appDxfProjects.test.tsx src/__tests__/appFrontEndRedesign.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx`

Expected: all selected tests pass.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test -- --run`

Expected: zero failing tests.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 4: Review requirements and diff**

Confirm no machine data or raw DXF is in portable output, all persisted path intent is retained, imported identity is local, DXF behavior is unchanged, and UI actions are restricted to path projects.
