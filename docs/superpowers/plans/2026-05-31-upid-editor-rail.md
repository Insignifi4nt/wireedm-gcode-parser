# UPID Editor Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move DXF-origin editing toward `DXF -> UPID -> hybrid CAD/CAM editor -> export preview -> G-code post`.

**Architecture:** Keep the existing path-intel document as the first UPID implementation while adding a path-native editor shell. The app shell keeps its collapsible Project Rail, but editor pages can replace the default storage summary with a UPID Path Navigator. G-code remains persisted/exported for compatibility, but DXF editing surfaces operate on the UPID/path document and only show posted text in an explicit export preview later.

**Tech Stack:** React, TypeScript, Vitest, Playwright, existing path-intel/path-editor domain modules.

---

## File Map

- Modify `src/app/AppShell.tsx`: support an editor-provided Project Rail override while preserving the default workbench rail for dashboard and non-editor states.
- Create `src/app/AppRailContext.tsx`: small context used by editor pages to register expanded/collapsed rail content.
- Create `src/features/editor/EditorPathNavigatorPanel.tsx`: UPID Path Navigator for contours, nested segments, related action groups, hover/snap toggles, and save/export actions.
- Modify `src/features/editor/EditorPage.tsx`: register the path navigator in the Project Rail for DXF/UPID projects, remove the path G-code panel from the right rail, and keep legacy G-code panels only for external posted programs.
- Modify `src/features/editor/EditorInspectorPanel.tsx`: make the right Inspector Rail focus on position, selected geometry, machine fit, and measurement/construction points.
- Modify `src/features/editor/EditorPreview.tsx`: expose path element hover events and render selected/hovered path elements independently of G-code line selection.
- Modify `src/domain/editor/previewGeometry.ts`: keep operation and segment identity available for preview paths.
- Add or update tests in `src/__tests__/appDxfProjects.test.tsx`: prove the path navigator is in the Project Rail, G-code is absent from the DXF editing rail, contours expand into segments, and canvas hover can drive navigator highlight.
- Add or update Playwright checks in `e2e/editor-existing-project.spec.ts`: prove the seeded editor opens with the Project Rail path navigator instead of the old posted-body panel.

## Task 1: Project Rail Override And Path Navigator Shell

- [ ] Write a failing Vitest case that imports a DXF and expects `[data-editor-project-rail]`, `[data-upid-path-navigator]`, nested contour rows, and no `[data-editor-posted-body-preview]`.
- [ ] Verify the test fails because the current UI still renders the path panel on the right and no editor Project Rail override exists.
- [ ] Add `AppRailContext` and wire `AppShell` to render override content in the existing collapsible rail.
- [ ] Add `EditorPathNavigatorPanel` with named nested containers: Project Rail, UPID Path Navigator, Contour Tree, Segment Stack, Path Action Bar, Hover Assist, Magnetic Snap.
- [ ] Register the panel from `EditorPage` whenever `pathDocumentDraft` exists.
- [ ] Remove the DXF path `EditorPathPlanPanel` from the right-side panel while leaving legacy G-code editor panels for posted external files.
- [ ] Run the focused Vitest case and make it pass.

## Task 2: UPID Naming Boundary

- [ ] Add a small UPID type/export boundary that names the current path document as `UniversalPathIntelligenceDocument` without migrating storage yet.
- [ ] Update visible DXF editor labels from generic "Path Operations" to "UPID Path Navigator" where the editing model is path-native.
- [ ] Keep persisted `project.pathPlanning.document` compatible in this slice, because storage migration should be separate and reversible.
- [ ] Add tests proving imported DXF projects still save/reopen path edits after the visible UPID rename.

## Task 3: Canvas Hover To Navigator Highlight

- [ ] Add state in `EditorPage` for hover assist enabled, magnetic snap preview enabled, hovered operation id, and hovered segment id.
- [ ] Add preview callbacks from `EditorPreview` path elements to update hovered operation/segment only when hover assist is enabled.
- [ ] Highlight the matching contour and segment rows in `EditorPathNavigatorPanel`.
- [ ] Add a failing Vitest case that mouse-enters a preview path and expects the matching navigator segment row to become highlighted.
- [ ] Implement the minimal preview event wiring and path row classes/data attributes to pass.

## Task 4: Magnetic Non-Existing Point Preview

- [ ] Add a hover preview model that reuses `constructMagnetizedPoint` or nearest path logic to show a candidate point before click.
- [ ] Make `Start Here` default to existing segment endpoints when magnetic snap is off.
- [ ] When magnetic snap is on, allow Start Here to split a line/arc/circle at the nearest non-existing point, matching the current click behavior.
- [ ] Render a temporary construction line and candidate point on the canvas for perpendicular/tangent modes.
- [ ] Add tests for hover preview visibility and click commit behavior.

## Verification Gates

- [ ] `npm test -- --run src/__tests__/appDxfProjects.test.tsx`
- [ ] `npm run build`
- [ ] `npm test -- --run`
- [ ] `npm run test:e2e`
- [ ] `git diff --check -- . ':!old_reference/**'`
- [ ] `git diff --stat -- old_reference`
