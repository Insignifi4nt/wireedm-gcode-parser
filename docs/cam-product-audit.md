# CAM product audit

This audit continues from the branch checkpoint in [the earlier review](2026-09-07-review.md). It is in progress. A previous passing test is supporting evidence, not proof that a tool meets the standards below. Each row needs a final disposition and current verification before this audit is complete.

## Acceptance standards

1. Geometry has priority. Use one canvas and clear pane boundaries. Permanent chrome must help the current task; source filenames, encoding and controller wrappers belong in their owning views.
2. Selection is explicit and consistent across the canvas and tree. Show the operation or geometry being edited, support correction, and explain unavailable actions.
3. Inspection does not edit the document. Measurement must produce dimensions, identify its references, snap within a screen-space tolerance, and distinguish exact geometry from free points.
4. Editing has one predictable transaction. Preview changes, validate inputs locally, commit one undoable change, and restore the opening state on cancel. Switching tools must not silently discard edits.
5. Tool panels show the next decision. Keep actions visible, avoid duplicate headings and generic prose, and disclose advanced or inapplicable choices only when needed.
6. CAM intent is visible. Make cutting direction, kept side, starts, leads, travel, threading, stops, inactive geometry and unresolved decisions distinguishable before export.
7. Export uses a saved revision and the exact machine setup. Validation identifies the operation and repair action; UI must not imply hardware validation or invent machine technology.
8. Keyboard, pointer and touch interactions have predictable focus and cancellation. Layout remains usable at supported viewport sizes without hiding essential actions.
9. Tests exercise results, geometry, persistence and real interactions. Remove dead code and redundant assertions while retaining meaningful regression coverage.

See the [CAM reference research](superpowers/2026-09-07-wire-edm-cam-usability-standards-research.md) for source links and the distinction between documented vendor behavior and our design decisions. These standards are project acceptance criteria, not claims of feature parity with another product.

## Feature inventory

Status: `pending` means the feature still needs the current audit, implementation decision and verification. `in progress` is not a pass. Related tools may share verification, but each remains accountable here.

| Feature or panel | Review focus and initial disposition | Status |
| --- | --- | --- |
| Shell header and storage indicator | Keep storage health and settings access; reduce redundant labels | pending |
| Application footer | Removed duplicated metadata; storage header/settings and library retain owning information. Shell/modal browser checks passed | verified |
| Editor status and canvas frame | Removed decorative frame and idle hints; wrapping status shows state, named contour/segment/entry/exit selection, actual units, actionable issues and fit warnings. Selection restoration guards pass in 83 editor integration tests. Further contextual refinements remain | in progress |
| Project library | Search, filters, sorting, empty/loading/failure states | pending |
| Project rename/delete/export | Validation, selection, persistence and recovery | pending |
| DXF import and confirmation | Units, layers, unsupported entities, reimport consequences | pending |
| UPID import/export | Validate complete document and preserve intent | pending |
| External machine-program import | G20/G21 now normalize preview geometry and contour metrics to mm; XY/IJ/R/G92 and mixed modes covered. Normal import/reopen browser test verifies physical scale. Unknown initial units remain unlabelled with a warning for late declarations. Cleanup and remaining display fidelity still need review | in progress |
| Browser-cache storage | Startup, failures, persistence and data isolation | pending |
| Optional folder storage | Explicit selection, reconnect, cancellation and switch behavior | pending |
| Machine package installation | Validation, activation, removal and useful summaries | pending |
| Source/machine setup | Make machine and unit decisions accessible without technical clutter | pending |
| Editor menus | Group by operator intent; remove overlapping entry points | pending |
| Workflow panels | Fixed off-screen desktop floating actions; duplicate headings, action placement and switching still need review | in progress |
| Save, cancel, undo and redo | Correct transaction boundaries for every mutating tool | pending |
| Program tree | Ready operations start collapsed; unresolved operation issues remain expanded. Readable event labels replace raw kind names. Fixed selected-child collapse reopening and kept keyboard focus on collapsed parent; broader operation summary/detail grouping remains | in progress |
| Geometry tree and contour tree | Determine whether duplicate tree panel should merge into rail | pending |
| Path summary and statistics | Merged into Statistics with one set of project counts, actual filename, dimensional units and explicit source geometry bounds. Source/topology disclosure retains provenance and exposes layer names. Selected-geometry detail simplification remains | in progress |
| Position panel | Removed duplicate cursor/snap display. Live coordinates remain in status; snap belongs to Construction points. Updated coordinate interaction and snap-toggle checks | removed |
| Geometry setup | Finished contour versus wire center, prerequisites and effects | pending |
| Move/rotate/mirror | Precise numeric fields, pivot, scope, preview and undo | pending |
| Contour setup | Direction, kept material, compensation and open contour behavior | pending |
| Contour start | Magnetic picking, exact split, closed/open behavior and review | pending |
| Initial wire position | New-project applied position updates marker/travel and survives save/reopen. Pending coordinates are explicit; geometry-linked choices still need the full usability pass | in progress |
| Entry/exit | Independent drafts, truthful review state, compact entry/exit navigator rows and correct travel inspection. Coincident leads blocked during editing and execution compilation; moving starts/reversing direction invalidates manual lead review. Clearance and derived contour-segment interactions remain | in progress |
| Cut sequence | Manual/automatic order, nesting dependencies and travel | pending |
| Between contours | Explicit defaults, project manual separation, active routes and readable sequence summaries. Browser save/reopen/override undo verified. Continuous-wire constraints and full lifecycle/export behavior remain | in progress |
| Machining participation | Geometry-bound entry/exit review, local validation, active-range lengths and contextual controls implemented. Range units, derived segment interactions and compensation usability remain | in progress |
| Program stops | Added direct Edit actions with pending-field protection and save/undo coverage. Execution tests verify linear/circular and partial-cut placement. Added enabled-stop canvas markers with stable screen size, edit updates and undo coverage; placement labels distinguish positioning from cutting entry. Add/edit modes now share fields and show one form at a time; guarded New stop focuses Placement. Broader lifecycle review remains | in progress |
| Endpoint topology | Expose repair-relevant facts; move raw topology detail behind disclosure | pending |
| Diagnostics | Fixed nested keyboard activation in navigator and selected-geometry diagnostic rows; Enter on an affected-geometry button no longer triggers the parent, and Space activates the focused row. Deduplication, prioritization and repair context remain | in progress |
| Measurement | Added read-only Measure with magnetic points, segment and contour dimensions, precision, pair/chain/fixed-reference modes, mouse/touch and zoom checks. Multi-entity inspection remains | in progress |
| Construction points | Retain explicit editing, separate from inspection. G-code insertion respects units/XY mode, preserves following modal cuts/arcs and avoids accumulated incremental rounding drift; 10 domain and 13 line-drawer tests/build pass. Constraint and panel usability review remains | in progress |
| Canvas selection and hover | Fixed endpoint highlight layering above start/end markers; browser regression passes. Overlap and selection filters remain | in progress |
| Canvas navigation | Fit, zoom anchor, pan, grid, scale and touch | pending |
| Canvas preview | Direction, leads, transitions, markers and execution consistency | pending |
| Text editor and line list | Editing, reorder/start, pin, selection and command preservation | pending |
| Controller export | Saved revision, setup selection, validation, generation and download | pending |
| Guide and onboarding | Concise task help, current labels and keyboard behavior | pending |
| Responsive layout/accessibility | Small viewports, focus, modal inertness and resize controls | pending |
| Code/test/documentation structure | Remove dead abstractions, extract coherent logic, update useful docs | pending |

## Verified changes and evidence

The checks below cover specific behavior, not completion of entire inventory rows. Commit history retains the implementation sequence and intermediate results.

| Area | Implemented behavior and verification |
| --- | --- |
| Shell and inspection | Removed redundant footer metadata, decorative canvas frame, Position panel and ambiguous path-item counting. Statistics combines project counts, source geometry bounds, units and provenance. Browser checks cover imported filename, 10 × 10 mm bounds, 40 mm cutting length, source layers and diagnostic navigation. |
| Measurement | Read-only magnetic measurement supports pair, chain and fixed-reference modes, precision, touch/free picks and contour dimensions. Domain checks cover analytic curved area and reversed/open boundaries; ambiguous contours omit area. Browser checks cover exact picks, zoom, non-mutation and stable controls after leaving the canvas. |
| Spatial index | Fixed quadratic scanning without relaxing the original timing limit. Exact-hit comparisons and deterministic read-count tests verify bounds rejection and cell traversal. |
| Program tree and diagnostics | Ready operations collapse by default; unresolved issues remain visible. Child selection/collapse retains focus. Nested diagnostic Enter no longer activates the parent; Space activates the row. A 10.004 mm snapped-endpoint regression verifies selection identity. |
| Initial wire and hover | The reported new-project initial-wire bug is covered through apply, preview, save and reopen in `e2e/editor-initial-wire-position.spec.ts`. `e2e/editor-measure.spec.ts` verifies geometry endpoint hover above coincident start/end markers. |
| Entry/exit | Independent drafts survive opposite-side application. Review labels reflect actual state. Coincident leads are rejected during editing and execution compilation. Moving a closed start or reversing direction invalidates manual lead review. Compact navigator rows select the correct lead; inspection uses active geometry and resolved positioning endpoints. |
| Program stops | Direct editing protects pending fields. Exact stop placement covers linear/circular travel, both directions and partial contours. Markers follow edits, retain screen size under zoom and disappear on undo. A 2 mm remaining stop on a 6 mm active cut lands at X=4; a 7 mm remaining stop is rejected. Successful addition no longer immediately reports a duplicate error. Add/edit share fields; the selected edit replaces the add form. New stop protects pending edits and transfers keyboard focus. The browser workflow covers edit, add-after-edit and undo; the rendered 1280 × 720 panel keeps Save/Cancel visible. |
| Participation | Entry/no-entry and exit confirmations use persisted geometry fingerprints, support revocation and invalidate on geometry/span changes, including interior corner edits with fixed lead endpoints. Import-description changes retain review. Older fingerprints require confirmation again. Local review works despite unrelated unresolved contours; global compilation remains blocked. Blank range fields are rejected. Active ranges show derived lengths, internal IDs are hidden, and compensation controls are contextual. |
| Partial travel and review | Source operation identity survives clicking derived travel. `e2e/editor-partial-exit.spec.ts` covers active exit coordinates, confirmation, save/reload and undo of revocation. Domain tests cover portable storage validation and compile-after-confirm. Derived totals include leads: 6 mm contour + 8 mm leads = 14 mm cutting; stop distances remain contour-only. |
| Floating panels | Desktop panels now use the same viewport bounds clamp as smaller layouts. The partial-exit browser test reproduced an unreachable Save button before the fix; it and all 23 layout scenarios pass afterward. |
| Between contours | Missing project threading intent displays an unset choice rather than Manual. Project manual separation can be edited without changing operation overrides; continuous defaults have a matching option. Routes skip excluded contours and use partial-cut endpoints; the first active contour uses Initial wire position. Unresolved routes leave destination selection available. 157 focused operation/panel/editor tests and build passed after routing changes. |
| Between Contours browser workflow | `e2e/editor-between-contours.spec.ts` verifies choosing an unset default, changing separation, retaining an automatic operation override while changing defaults, save/reopen, reverting to inheritance and undo. Plain-language sequence summaries replace raw mode codes. Rendered panel inspected in `tmp/cam-audit/10-between-contours.png`; panel tests and build passed. |
| External program units | Interpreter normalizes declared XY/IJ/R/G92 to mm and guards conversion overflow. Insertion converts back to active inches/metric and absolute/incremental coordinates, with 5 decimal places for inch output. Start rotation preserves uniform inch coordinates and declines mixed-unit, incremental-XY or absolute-IJ programs it cannot rewrite faithfully. 64 focused domain tests, 13 line-drawer tests, import/reopen browser test and build passed. |
| Threading execution | Strengthened execution tests from unordered event-presence checks to exact separation → positioning → rethreading order and endpoints. Automatic operation overrides supersede manual defaults and produce matching requirements. Continuous transitions emit continue/position without separation or rethreading. All 10 execution tests and build passed. Physical clearance and machine-specific lifecycle behavior remain separate review requirements. |

### Verification checkpoints

- Latest broad unit run during unit normalization: **1,037 passed, one stale Start Here guidance assertion failed**, across 105 files. Updating that case to check unchanged program/state and the current guidance made all 13 line-drawer tests pass. Later overflow/precision checks passed in the 64-test domain set.
- Latest broad browser run: 57 passed, one optional external-workbench fixture skipped, one stale Statistics-summary click failed. Removing that obsolete setup step made both diagnostic scenarios pass. Later partial-exit and all 23 layout scenarios passed.
- Latest change (`a74b825`): 59 participation, execution, preview, inspection and stop tests passed. Production build passed with the existing bundle-size warning.
- Removed obsolete footer/Statistics DOM assertions while retaining catalog data, parsed statistics, import/edit/save/export, focus and geometry checks. No branch merge has occurred.

### Rendered inspection

Local screenshots in `tmp/cam-audit/` were inspected during the audit; they support layout findings rather than prove correctness.

| Files | Evidence |
| --- | --- |
| `01-editor-before.png`, `02-measurement-before.png` | Redundant chrome, nested canvas, expanded low-level events and measurement without distance results. |
| `03-measurement-after.png`, `05-profile-measurement.png` | Exact 10 mm measurement, contour dimensions and stable disclosure. |
| `04-program-tree-after.png`, `06-consolidated-statistics.png` | Collapsed ready operations and consolidated source/statistics disclosure. |
| `07-program-stop-marker.png` | Visible stop marker; its captured duplicate-message issue was subsequently fixed. Temporary project edits were discarded. |
| `08-compact-exit-row.png` | Compact exit row and matching selected canvas lead at 1355 × 900. |
| `11-program-stop-edit.png` | One active stop form, readable reasons and visible workflow actions. |
| `09-partial-exit-review.png` | Confirmable partial exit at 1280 × 720; collapsed active ranges leave Restore, Cancel and Save visible. Later range-length details are covered by component tests. |

## Outstanding work

- Complete every pending inventory row and assign a final keep/remove/merge/expand disposition with current evidence.
- Assess lead clearance/intersection diagnostics and source-contour review invalidation when local geometry changes without moving its endpoints; partial-contour fingerprints now cover this case.
- Resolve derived contour-segment selection/editing semantics, range-input units and remaining partial-compensation usability gaps.
- Finish multi-entity measurement, overlap selection and selection filters; retain screen-space snapping thresholds.
- Review remaining raw G-code coordinate-system and modal editing constraints; unit-aware preview and insertion are implemented.
- Simplify remaining duplicate inspection panels and tool headings.
- Broaden save/cancel/undo, keyboard/touch and rendered-layout verification as each tool is audited; then run final integration checks.

These remaining items preserve the original whole-app scope. Passing regressions above do not close the audit.
