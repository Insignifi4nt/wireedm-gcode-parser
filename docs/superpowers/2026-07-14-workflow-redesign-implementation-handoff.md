# Workflow Redesign Implementation Handoff

Date: 2026-07-14

## Mandatory First Actions

1. Create an explicit Codex goal covering the approved Wire EDM workflow redesign and production-path capabilities in this handoff.
2. Read `AGENTS.md` and the complete interactive evaluation ledger at `docs/superpowers/2026-07-14-interactive-usability-evaluation.md` before editing code.
3. Inspect `git status` and preserve all existing user changes. Do not discard the Playwright documentation or evaluation files.
4. Convert the approved interaction architecture and production requirements into a formal design/specification and proportionate implementation plan before foundational edits. The user approved the explicit tool-session state-machine approach; do not reopen the already-settled state-machine-versus-fixed-workspaces decision.
5. Implement in coherent vertical slices with focused verification, then expand tests according to blast radius. Do not attempt a superficial one-pass UI shuffle.

## Goal

Turn the current feature-rich but flat editor into a reliable, guided CAD/CAM workflow system while preserving local-first behavior and existing geometry/post safety. The foundation is a central command registry plus one explicit active tool session with legal transitions, prerequisites, previews, conflict reasons, layered Escape/Back behavior, atomic commits, and global labelled Undo/Redo transactions.

Menus and submenus organize discovery and start workflows. Tool windows may float or dock on either side; left and right are equivalent panel docks, not semantic regions. Layout, dock order, floating size, and position should be persisted separately from active-tool state.

## Canonical Product Evidence

- Exhaustive interactive notes, approved decisions, UX defects, G92 semantics, entry/exit requirements, partial-contour production scope, and final browser results:
  - `docs/superpowers/2026-07-14-interactive-usability-evaluation.md`
- Existing related designs:
  - `docs/superpowers/specs/2026-07-10-wire-edm-front-end-redesign.md`
  - `docs/superpowers/specs/2026-07-10-contour-workbook-design.md`
  - `docs/superpowers/specs/2026-07-12-upid-correctness-export-safety-design.md`
  - `docs/superpowers/specs/2026-07-13-controller-compensation-machine-profiles-design.md`
  - `docs/superpowers/specs/2026-07-14-robofil-multicontour-route-v2-design.md`
- Existing implementation plans with historical intent and acceptance boundaries:
  - matching files under `docs/superpowers/plans/`.

The interactive evaluation ledger is newer evidence and overrides older UI grouping assumptions when they conflict. Existing post safety boundaries remain authoritative unless replaced by new machine evidence and tests.

## Real Acceptance Fixture and Saved State

- Source DXF:
  - Windows: `C:\Users\cristian\Documents\Catia\COGEME\Prisma\Prisma fixa 1 cog.dxf`
  - WSL: `/mnt/c/Users/cristian/Documents/Catia/COGEME/Prisma/Prisma fixa 1 cog.dxf`
- Saved folder-backed project:
  - `/mnt/c/Users/cristian/Documents/Wire_EDM_local/projects/prisma-fixa-1-cog-2026-07-14/project.json`
- Imported DXF copy:
  - `/mnt/c/Users/cristian/Documents/Wire_EDM_local/imports/prisma-fixa-1-cog-2026-07-14.dxf`
- Machine: verified `Charmilles Robofil 100 / Classic (v2 multi-contour candidate)`, 150 mm maximum width, 200 mm maximum length.
- Saved placed bounds observed at test end: X `-32.500..32.500`, Y `0.000..64.500`.
- Saved lead-ins:
  - Hole 2: `(-17.500, 24.900) → (-9.500, 24.900)`, circle-center, 8 mm;
  - Hole 1: `(17.500, 24.900) → (25.500, 24.900)`, circle-center, 8 mm;
  - Exterior test lead: `(32.500, -5.000) → (32.500, 0.000)`, manual point, 5 mm.
- Current export preview becomes structurally ready with 3 operations, 3 rapids, 29 cut moves, and 0 diagnostics, but it is not the desired production output because it hardcodes `G92 X0 Y0` and cuts all 22 exterior segments.

Do not overwrite or mutate the external fixture as a casual test setup. Copy it into an appropriate repository fixture or temporary test workbench when deterministic tests require it.

## Required Architecture and Workflows

### Command and tool-session foundation

- Central registry: command ID, menu path, scope, prerequisites, disabled reason, associated tool window, session factory, conflicts, preview, apply, cancel, and history label.
- Exactly one mutating tool session owns canvas interaction at a time. Passive panels may remain visible.
- Escape discards the latest provisional input or steps back before cancelling the entire tool.
- One completed workflow commits one labelled document-history transaction. Provisional correction uses Back/Reset/Escape, not competing per-tool history stacks.
- Conflicts are based on active editing tools, not mere panel visibility.

### UI information architecture

- Audit every visible control using the checklist in the evaluation ledger before moving or deleting it.
- Remove true duplicates such as operation reordering in Path Actions when Cut Sequence is the visible sequence-editing home.
- Keep document policy, selected-operation semantics, operation sequencing, entry/exit authoring, construction, view preferences, machine setup, and export as distinct workflows.
- Tooltips/focus help must explain target, prerequisites, effect, and next interaction consistently.
- Menus launch/focus tools; tools remember last placement and remain dockable left, right, or floating.

### Project coordinate setup and G92

- Geometry Placement positions the part in the program coordinate system.
- The operator physically establishes a matching part datum on the machine.
- Initial Wire Position declares the wire's current coordinates within that same system; it may be a starter-hole center, exterior approach, or another accessible point.
- G92 must be project/setup intent, not a machine-profile constant and not a geometry transform.
- A wrong G92 shifts the entire program into the wrong physical location, so export readiness must require reviewed, coherent initial-wire state.
- Support a semantic geometry-linked point and exact manual X/Y. Geometry-linked points follow transforms; uncertain manual points become stale/review-required after relevant transforms.
- The post and planned route must initialize from the same point. Suppress contradictory or meaningless initial movement when G92 already equals the first entry point.

### Entry and exit

- Replace the current compact Start/Pierce grouping with a configurable per-operation Entry/Exit workflow.
- Preserve current center-circle entry, add clear manual straight entry, and design extension points for validated length/angle, normal, tangent, curved, overlap, return, and controller-specific strategies.
- Do not claim unsupported strategies without Wire EDM and controller evidence.
- Model rough stock or require explicit operator review where finished geometry alone cannot validate a stock-crossing lead.
- Add editable geometric lead-out semantics; current Robofil v2 only performs modal `G39/G40` cancellation.
- Fix the Contour Tree bug that labels every lead as `Pierce / Center pierce cut`, including `manual-point` exterior leads.

### Partial-contour machining

- Preserve complete finished/source geometry while allowing whole segments or split sub-spans to be active-cut or inactive/reference-only.
- The Prisma production intent is both holes plus only the toothed top span. Left, bottom, and right exterior edges are already milled and must not be posted.
- Active spans can become intentional open operations with stable identity, direction, start/end, entry/exit, compensation/kept-side intent, order, metrics, and trace.
- Planner routes between configured exits and entries for open or closed operations.
- Intentional open machining must not be misdiagnosed as broken source topology.
- Re-enabling spans is lossless; source provenance and transformations survive.

### Construction and view behavior

- Move Perpendicular/Tangent into Measurement/Construction; today they create construction points and do not author toolpath leads.
- Separate hover cross-highlighting from magnetic/snap behavior. Snap options belong inside the active tool that consumes them.
- Resolve passive-event-listener console warnings in preview wheel/touch handling when touching that interaction layer.

### Machine Program editor

- Keep it as an exact-controller preview and fallback editor, but normal Path Project setup should not require manual post-editing.
- Review/upgrade it after the primary workflow work.
- Machine-program-to-UPID conversion is explicitly deferred until the user separately requests implementation. Do not include it in the active implementation scope.

## High-Value Code Areas

- UI/state: `src/features/editor/EditorPage.tsx`, `EditorPathNavigatorPanel.tsx`, `EditorPreview.tsx`, `EditorInspectorPanel.tsx`, `EditorWorkspacePanels.tsx`, `EditorUpidExportPreview.tsx`, `EditorHeaderBar.tsx`, `EditorStatusBar.tsx`.
- Path operations/planning: `src/domain/path-editor/pathDocumentOperations.ts`, `src/domain/path-intel/planOperations.ts`, `src/domain/path-intel/types.ts`.
- Compensation/entry validation: `src/domain/compensation/intent.ts`, `resolveControllerCompensation.ts`, `validateCompensatedExport.ts`, `robofilV2LeadValidation.ts`, `linearTransitionGeometry.ts`, `pathTangents.ts`.
- Post/project models: `src/domain/post/upidMachinePost.ts`, `src/domain/upid/projectUpid.ts`, `src/domain/workbench/types.ts`, editor load/save modules.

## High-Value Tests

- `src/domain/path-editor/__tests__/pathDocumentOperations.test.ts`
- `src/domain/compensation/__tests__/intent.test.ts`
- `src/domain/compensation/__tests__/resolveControllerCompensation.test.ts`
- `src/domain/compensation/__tests__/validateCompensatedExport.test.ts`
- `src/domain/compensation/__tests__/linearTransitionGeometry.test.ts`
- `src/domain/post/__tests__/upidMachinePost.test.ts`
- `src/domain/editor/__tests__/loadEditorProgram.test.ts`
- `src/domain/editor/__tests__/saveEditorProgram.test.ts`
- `src/__tests__/appDxfProjects.test.tsx`
- `src/features/editor/__tests__/EditorWorkspacePanels.test.tsx`
- `e2e/editor-layout.spec.ts`

Use focused tests for each vertical slice. Run `npm run build` and broader/full suites when foundational state, persistence, planning, posting, or shared project schemas change.

## Working-Tree and Browser Notes

- Expected documentation changes at handoff include `AGENTS.md`, `docs/playwright.md`, `docs/playwright-comet.md`, the evaluation ledger, and this handoff.
- `.playwright/` is untracked setup residue; inspect before deciding whether it belongs in version control.
- No Playwright browser sessions remain active. Comet was detached and the old Edge session was closed.
- Never store or repeat the Playwright extension token that appeared earlier in conversation history.
