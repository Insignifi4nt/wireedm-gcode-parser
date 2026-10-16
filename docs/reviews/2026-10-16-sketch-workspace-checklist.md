# Sketch mode and CAD workspace

Goal started 16 October 2026. Base `01e6380`, merged PR #14. Local branch `feature/sketch-workspace-polish`, with no remote upstream. User instruction: work locally, commit checkpoints, never push, create a PR, merge or deploy during this goal.

## Order and acceptance

- [x] Start a durable goal and a fresh local branch from merged main.
- [x] Replace the dashboard's three header selectors with one Filter button immediately right of Search. Preserve combined filtering, sorting, archive restore, keyboard dismissal and focus.
- [x] Record official CAD sketch references and an implementation/acceptance matrix.
- [ ] Reproduce and correct point/segment/profile picking and dragging. A free point must move independently of the whole closed contour.
- [ ] Establish stable geometry references and a coherent constraint model, including dimensions, degrees of freedom, conflicting/redundant constraints and cancellation.
- [ ] Complete direct editing across supported line, arc, circle, rectangle, slot, polygon and generated/reference geometry. Distinguish free and driven controls without misleading edit affordances.
- [ ] Complete the sketch tool and interaction inventory established by the research. Cover selection, snapping, construction/reference geometry, trim/extend/offset, transforms and other core sketch operations as supported by a consistent domain model.
- [ ] Keep human commands and agent operations equivalent, guarded, versioned, discoverable and documented.
- [ ] Verify complete part-building workflows, exact geometry, undo/redo, rejected edits, saves/reopens and downstream rebuilds. Test meaningful math and state invariants at shared application/domain operations; inspect interaction and visuals in the actual browser.
- [ ] Independently audit sketch mode against the original goal and source-backed scenarios. Investigate missing or weak evidence, rather than treating passing tests as completion.
- [ ] Only after the sketch audit is satisfied, continue interaction, shared-control and agent usability improvements across existing CAD tools.
- [ ] Final audit of the complete objective, local commits and evidence. No completion claim while required work remains.

## Initial findings

The canvas picker currently returns a profile ID. Selecting/dragging a boundary therefore translates its whole profile. The constraint module records explicit dimensions for primitive profile sizes and preserves expressions, but has no general point/segment relationship solver. Paths and polygons expose no dimension quantities. These are model and interaction gaps, not styling issues.

Research runs in parallel and will be recorded in `2026-10-16-sketch-workflow-reference.md`. The first implementation slice is the requested dashboard filter, followed by granular sketch selection and editing.

## Checkpoint: project filters and reference review

One shared Filter menu follows Search and contains state, source and sort radio groups. Combined filters, restore focus, keyboard navigation, Escape dismissal and menu ownership are preserved. Verified: 12 focused cases; TypeScript and shared UI standards; full production build; 3 Chromium journeys; Firefox archive/restore including widths 390–1705 px. Actual in-app browser appearance inspected; screenshot at tmp/sketch-project-filter.png. Icon integration inventory refreshed. No remote action.

Official source comparison and 22 sketch acceptance scenarios are recorded in 2026-10-16-sketch-workflow-reference.md. Granular editing and the rest of the sketch goal remain outstanding.

## Checkpoint: direct sketch grips

Implemented one shared `move-sketch-handle` operation and revision-scoped grip discovery. Polygon vertices and connected straight-path joints move independently; rectangle corners/sides resize with the opposite anchor fixed; circle center/radius and slot center are separate targets. Explicit sizes and exact expression scalars remain authoritative, including partially free axes. Existing profile translation remains available intentionally.

The canvas renders selectable grips, previews without persistence, snaps the target point to the grid, commits one undoable operation, and supports keyboard nudging. Escape, capture loss, version changes and existing workflow ownership keep their cancellation behavior. Locked grips cannot become whole-contour drags. Independent review found and fixed two real overlap bugs: selected-profile ownership and explicit SVG grip ownership.

Agents discover grips with `cad_inspect_sketch_handles` and edit through the same guarded batch operation. `cad_describe_edits` exposes full edit contracts on demand, keeping registration smaller while retaining complete execution validation. Public agent guide updated. No storage/schema migration or installed machine/post change.

Evidence: 130 focused existing/new geometry, picking, lifecycle and agent cases passed before the final overlap repair; the final picker/gesture slice passed 39 cases. TypeScript/shared UI checks and full production build passed. Actual Chromium workflow covers drag, Escape, Undo, keyboard edit, Save and reload. Actual in-app browser separately verified hand dragging and native WebMCP discovery/edit; screenshot `tmp/sketch-grip-edit.png`. Firefox and final build evidence are recorded below when complete. Review: `2026-10-16-sketch-grips-independent-review.md`.

This is a first slice, not completion of the selection or sketch goal. Remaining: persistent point/segment/relation identities, general constraint solving and diagnosis, editable arc joints and complete slot grips, segment/set/box selection and overlap chooser, useful geometry snapping, topology edit tools, and full end-to-end/independent acceptance audit. Also refine selected-point retention after an owned edit and show honest reasons for unavailable grips rather than calling unsupported arc edits constrained.

The solver reference recommends a bounded PlaneGCS trial rather than a handwritten nonlinear solver. Research/trial evidence is in `2026-10-16-sketch-solver-options.md`; no production dependency has been added yet.
Final grip checkpoint gates: full production build, documentation/source distribution checks and Firefox gesture/Undo/Save/reload journey pass. Firefox initially exposed an early test command before the versioned viewport was ready; the journey now awaits the public ready-reference signal, matching the documented agent contract. It also awaits the actual reopened workbench before reading its draft. No fixed delays or production guard bypasses were introduced. Both independent overlap findings are resolved.

## Checkpoint: arc joints, slot controls and point selection

Numeric arc joints now refit through their original analytic midpoint while preserving traversal and the major/minor branch. Shared line/arc and arc/arc endpoints stay closed; invalid or branch-changing edits reject atomically. Full-circle paths expose center/radius grips. Slots expose independent center, length, width and angle grips with symmetric local-axis sizing and existing expression/dimension drivers intact. Expression-driven arc refits remain explicitly unavailable until the general relation solver can preserve those drivers.

An owned point edit retains that point selection; Undo or an external revision clears the detail selection rather than switching to the entire contour. A hovered grip on another contour is visible before targeting. The cursor readout uses the existing precise quantity formatter, preserving small nonzero coordinates.

Evidence: 81 focused domain, picking and gesture cases; TypeScript and shared UI checks; complete production build including docs/source distributions. Two realistic Chromium and two Firefox journeys pass: point drag/cancel/Undo/keyboard/Save/reload, and slot sizing plus analytic arc-joint edit/Undo. Native in-app WebMCP seeded a disposable unsaved curve/slot sketch; a human-style keyboard grip edit verified changed size, point-only selection and measurement updates. Screenshot `tmp/sketch-slot-grips.png`; temporary tab closed without saving user data. No remote actions.

Constraint implementation now follows the graph-first integration plan, replacing the initial parallel-ID draft. A pinned PlaneGCS dependency and source packaging are prepared separately; browser worker, graph persistence, async ownership and user-facing relation tools are still in progress. Do not treat these foundations as completed sketch mode.
