# Workbench Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current vanilla JS app as a reference and create a new client-only React/TypeScript workbench shell with only real cache/folder workbench and DXF import behavior exposed.

**Architecture:** Keep old code intact under `old_reference/current_app`. The root app becomes a static Vite React app with thin technical UI and typed workbench models for browser-cache-first storage, optional folder persistence, and header/body/footer G-code generation. UI controls are added only after the underlying API is implemented and tested.

**Tech Stack:** Vite, React, TypeScript, Tailwind CSS, shadcn/ui-compatible primitives, Vitest.

---

### Task 1: Preserve Current App

**Files:**
- Create: `old_reference/current_app/`
- Move/copy: current `src/`, `index.html`, `documentation/`, `scripts/`, and old app package/config files into `old_reference/current_app/`

- [ ] Move the current app source and supporting documentation into `old_reference/current_app`.
- [ ] Copy the old `package.json`, `package-lock.json`, `vite.config.js`, `README.md`, and `AGENTS.md` into the reference folder before replacing root config.
- [ ] Leave generated `dist/` out of the reference unless a later archival task explicitly needs it.

### Task 2: Create New Root React App

**Files:**
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`
- Create: `src/vite-env.d.ts`
- Modify: `index.html`
- Modify: `package.json`
- Modify: `vite.config.ts`
- Delete/replace: `vite.config.js`

- [ ] Configure React + TypeScript entrypoints.
- [ ] Add Tailwind CSS through the Vite plugin.
- [ ] Add an `@/*` alias for future shadcn/ui components.
- [ ] Keep the GitHub Pages base path for the current deployment target.

### Task 3: Add App Shell And Dashboard

**Files:**
- Create: `src/app/AppShell.tsx`
- Create: `src/features/dashboard/DashboardPage.tsx`

- [ ] Add Dashboard as the only active view.
- [ ] Use compact, technical UI: thin bars, small text, dense panels, restrained colors.
- [ ] Show no mock library rows and no dead navigation buttons.

### Task 4: Add Workbench Models

**Files:**
- Create: `src/domain/workbench/types.ts`
- Create: `src/domain/workbench/defaultProject.ts`
- Create: `src/domain/storage/fileSystemAccess.ts`
- Create: `src/domain/storage/workbenchStorage.ts`
- Create: `src/domain/storage/browserDirectoryAdapter.ts`
- Create: `src/domain/storage/connectWorkbenchDirectory.ts`
- Create: `src/domain/post/gcodeTemplates.ts`
- Test: `src/domain/workbench/__tests__/defaultProject.test.ts`
- Test: `src/domain/storage/__tests__/workbenchStorage.test.ts`
- Test: `src/domain/storage/__tests__/browserDirectoryAdapter.test.ts`
- Test: `src/domain/storage/__tests__/connectWorkbenchDirectory.test.ts`
- Test: `src/domain/storage/__tests__/browserCacheAdapter.test.ts`
- Test: `src/domain/storage/__tests__/connectCachedWorkbench.test.ts`
- Test: `src/domain/post/__tests__/gcodeTemplates.test.ts`

- [ ] Model cache-first workbench projects with optional folder persistence.
- [ ] Model persistent header/body/footer templates.
- [ ] Model output extension choice without changing body text.
- [ ] Add a local File System Access capability helper.
- [ ] Initialize browser cache or a selected workbench folder by writing `workbench.json`, persistent templates, and required directories.

### Task 5: Add DXF Import

**Files:**
- Create: `src/domain/dxf/types.ts`
- Create: `src/domain/dxf/parseDxf.ts`
- Create: `src/domain/dxf/dxfToGcode.ts`
- Create: `src/domain/dxf/importDxfProject.ts`
- Test: `src/domain/dxf/__tests__/parseDxf.test.ts`
- Test: `src/domain/dxf/__tests__/dxfToGcode.test.ts`
- Test: `src/domain/dxf/__tests__/importDxfProject.test.ts`

- [ ] Parse supported DXF entities: `LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE`.
- [ ] Convert supported entities into IJ body G-code without feed words.
- [ ] Store DXF source, generated body, generated program, project JSON, and manifest updates through the active storage adapter.

### Task 6: Verify Scaffold

**Commands:**
- `npm install`
- `npm test -- --run`
- `npm run build`

- [ ] Install dependencies.
- [ ] Run tests and confirm they pass.
- [ ] Build and confirm the static app compiles.
- [ ] Start the dev server and browser-smoke the dashboard if time allows.
