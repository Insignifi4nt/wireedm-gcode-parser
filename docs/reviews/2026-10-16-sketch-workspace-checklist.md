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

## Later solver precision work

- [ ] Improve ordinary oblique arc solving while retaining strict source closure and exact expression drivers. The current native equal-radius spoke relation passed 28 of 36 bounded review cases. It explicitly rejects native Success for radii 0.25 and 10 at centers (0,0) or (100,300), both traversal directions, with fixed center/start at 30°, fixed end X at 145° and free end Y seeded 20% above its intended relative value. Residuals around 3.63e-11/6.65e-11 mm exceed the existing 1e-12 gate. Do not hide these rejections by changing coordinates or loosening validation. Exact fixture formulas, limitations and evidence are in [the solver reference](2026-10-16-sketch-solver-options.md#production-adapter-foundation-and-remaining-arc-limit).

## Checkpoint: entity graph, constraints and awaited editing

New sketches can store stable point/entity identities, exact lines/arcs/circles and driving coincidence, horizontal/vertical, fixed point/axis and distance relations. One compiler provides material from simple closed cycles while retaining open, branched and crossing geometry without inventing faces. Graph region references record their actual source edges. Existing primitive/plugin profiles keep their original representation and expression text.

The pinned PlaneGCS worker is lazy and separate from the solid kernel. Preparation solves copies, independently checks world-mm residuals and complete part validity, then commits once after version, workflow, storage and cancellation checks. UI and WebMCP use that awaited operation. Forms, tree actions and drawing gestures retain ownership until acceptance; rejection preserves fields, and cancellation discards late results. Preview uses the same preparation and publishes a complete solved document, including correlated graph coordinates and measurements, without history or saves.

Graph data intentionally advances the CAD document to schema 2; ordinary legacy parts retain schema 1. Saving an upgraded existing part preserves and verifies its exact old bytes through the shared journal on cache and folder adapters. Reading or renaming never migrates a part. Installed machine packages, posts, UPID, engine APIs and old saved revisions are unchanged. Source distribution and replacement instructions accompany the new solver dependency.

Independent review fixed submitted edits being mutated during lazy initialization and ambiguous preview ownership when two sketches used the same local profile ID. Browser inspection also caught a fieldset wrapper breaking dimension form spacing; the row styling was corrected. Numerical conditioning proposals were rejected after they introduced regressions at other model extents; current strict arc rejections remain explicit. See the foundation review and solver reference for bounds.

Evidence so far: 1,155 focused CAD domain/storage/kernel/solver cases; 284 related controller/form/preview/gesture cases; the async tree/drawing review passed 157 cases (overlapping, not additive). Production build, source distributions, TypeScript and shared-control checks pass. Four production Chromium journeys cover free grips, slot/arc editing, a mixed legacy/graph linked-size preview with Cancel/Apply/Undo, and complete WebMCP constraints/solid/STEP/Save/reopen. Final Firefox, visual and async-review results follow below when finished.

All four journeys also pass in Firefox against the production build. The native in-app browser separately verified a linked width preview, exact measurement updates and Cancel; screenshot `tmp/sketch-solved-preview.png`. Disposable unsaved tabs were closed and real project records were untouched. Async review additionally reproduced and repaired immediate rejection leaving Canvas and direct Workbench command ownership stuck; unfinished failed drawing and name edits remain owned until corrected or cancelled. The bounded [async UI review](2026-10-16-sketch-async-ui-review.md) records 26 profile, 94 interaction/preview and 77 Workbench cases (overlapping the earlier counts).

This checkpoint does not complete sketch mode. Next: actual graph drawing and point/entity selection, relations/DOF/conflict UI and agent inspection, topology editing, arrangements/cells and an owned sketch transaction for editing consumed boundaries. The broad acceptance boxes remain open. Work stays local with no push, PR, merge or deployment.
