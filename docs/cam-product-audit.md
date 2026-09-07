# CAM product audit

This audit continues from the branch checkpoint in [the earlier review](2026-09-07-review.md). Work is paused at the user’s request after the current batch. The overall audit remains incomplete; resume only when requested. A previous passing test is supporting evidence, not proof that a tool meets the standards below. Each row needs a final disposition and current verification before this audit is complete.

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
| Project library | Keep. Distinct loading/unavailable/empty/no-match states; Clear filters restores results. All five sort modes, combined case-insensitive search/source filters, DXF+UPID type grouping and busy action guards verified. Seven focused component/app tests and browser filter recovery pass | verified |
| Project rename/delete/export | Export failures produce retry guidance; shared busy guard prevents overlapping project actions. Rename/delete now trap/restore focus, isolate background controls and prevent pending dismissal/duplicate submit; failures permit retry. Controller/component tests, three modal browser scenarios and build pass. Rename shares single-line/length validation across UI and storage; Unicode and corrected drafts are supported (11 focused tests). All import paths share name validation and reject invalid names without writes. Deleted projects now retain source/revisions and can be restored after reload; 100 focused tests and the import/delete/reload/restore/open browser flow pass; independent recovery review found no defect (27 fault/catalog tests) | in progress |
| DXF import and confirmation | Units, layers, unsupported entities, reimport consequences | pending |
| UPID import/export | Validate complete document and preserve intent | pending |
| External machine-program import | G20/G21 now normalize preview geometry and contour metrics to mm; XY/IJ/R/G92 and mixed modes covered. Normal import/reopen browser test verifies physical scale. Unknown initial units remain unlabelled with a warning for late declarations. Decimal G92 offset commands survive cleanup unchanged. Unsupported planes/offset frames and intermediate G92 resets now warn through diagnostics; full coordinate-frame and non-XY simulation remain unsupported | in progress |
| Browser-cache storage | Damaged/missing directory metadata rebuilds from namespaced file paths without modifying project contents or manifest. Valid empty-folder entries are salvaged; 14 adapter/reconnection tests pass. Browser storage namespace now supplies shared lock identity across adapter names/instances (22 focused storage tests). Cross-tab fallback without Web Locks remains | in progress |
| Optional folder storage | Settings explains separate libraries and provides return to browser cache. Successful switching clears remembered folder selection; failed cache/preference writes retain the current folder and permit retry. IndexedDB preference reads/writes wait for transaction completion and close connections; aborted transactions propagate failure. 25 controller/storage tests, seven editor/settings browser scenarios and build pass. Broader persistence-failure review remains | in progress |
| Machine package installation | Stale previews clear when storage/libraries change; late validation results are ignored and former-workbench commits are rejected. 38 settings/controller/domain tests and build pass. Existing binding, stale-state, removal and rollback safeguards reviewed; summary usability remains | in progress |
| Source/machine setup | Make machine and unit decisions accessible without technical clutter | pending |
| Editor menus | Group by operator intent; remove overlapping entry points | pending |
| Workflow panels | Fixed off-screen desktop floating actions; duplicate headings, action placement and switching still need review | in progress |
| Save, cancel, undo and redo | Correct transaction boundaries for every mutating tool | pending |
| Program tree | Ready operations start collapsed; unresolved operation issues remain expanded. Readable event labels replace raw kind names. Fixed selected-child collapse reopening and kept keyboard focus on collapsed parent; broader operation summary/detail grouping remains | in progress |
| Geometry tree and contour tree | Determine whether duplicate tree panel should merge into rail | pending |
| Path summary and statistics | Merged into Statistics with one set of project counts, actual filename, dimensional units and explicit source geometry bounds. Source/topology disclosure retains provenance and exposes layer names. Selected-geometry detail simplification remains | in progress |
| Position panel | Removed duplicate cursor/snap display. Live coordinates remain in status; snap belongs to Construction points. Updated coordinate interaction and snap-toggle checks | removed |
| Geometry setup | Finished contour versus wire center, prerequisites and effects | pending |
| Move/rotate/mirror | Fixed reversed clockwise/counterclockwise actions and blank coordinates coercing to zero. Selected-scope isolation, center pivot, cancel, one-step undo/redo and saved coordinates verified in 88 integration tests; browser save/reload/reopen passes. Broader pivot usability remains | in progress |
| Contour setup | Direction, kept material, compensation and open contour behavior | pending |
| Contour start | Magnetic picking, exact split, closed/open behavior and review | pending |
| Initial wire position | New-project applied position updates marker/travel and survives save/reopen. Pending coordinates are explicit; geometry-linked choices still need the full usability pass | in progress |
| Entry/exit | Independent drafts, truthful review state, compact entry/exit navigator rows and correct travel inspection. Coincident leads blocked during editing and execution compilation; moving starts/reversing direction invalidates manual lead review. Source-intersection feedback now updates while editing coordinates; attachment contacts are excluded, overlaps/circular crossings covered by 10 domain/panel tests. Intersection feedback uses active partial attachments. Source/effective zero-length leads are rejected; circle-center entry clears pending fields. Independent repair and initial-wire lifecycle checks pass. Partial canvas normals now use active clipped endpoints and preserve source identity (11 inference and three picker lifecycle tests). Physical clearance remains | in progress |
| Cut sequence | Imported array order no longer overrides execution order during reorder or geometry edits. 73 domain tests and sequence lifecycle integration pass; build passes. Manual moves intentionally override automatic nesting. Rows now report active geometry plus leads, skip excluded travel and show unavailable metrics for blocked derivation/unresolved initial position (95 focused tests) | in progress |
| Between contours | Explicit defaults, project manual separation, active routes and readable sequence summaries. Browser save/reopen/override undo verified. Continuous-wire constraints and full lifecycle/export behavior remain | in progress |
| Machining participation | Geometry-bound entry/exit review, local validation, active-range lengths and contextual controls implemented. Percentage inputs show excluded millimeters and source origin (85 integration/component tests, partial-exit browser pass). Active preview spans select source geometry and exact range; clipped endpoints cannot edit original endpoints. Domain/component/browser regressions pass. Compensation usability remains | in progress |
| Program stops | Added direct Edit actions with pending-field protection and save/undo coverage. Execution tests verify linear/circular and partial-cut placement. Added enabled-stop canvas markers with stable screen size, edit updates and undo coverage; placement labels distinguish positioning from cutting entry. Add/edit modes now share fields and show one form at a time; guarded New stop focuses Placement. Broader lifecycle review remains | in progress |
| Endpoint topology | Expose repair-relevant facts; move raw topology detail behind disclosure | pending |
| Diagnostics | Fixed nested keyboard activation in navigator and selected-geometry diagnostic rows; Enter on an affected-geometry button no longer triggers the parent, and Space activates the focused row. Deduplication, prioritization and repair context remain | in progress |
| Measurement | Added read-only Measure with magnetic points, segment and contour dimensions, precision, pair/chain/fixed-reference modes, mouse/touch and zoom checks. Named A/B references and independent feature inspection added; shortest-distance/entity comparisons remain | in progress |
| Construction points | Retain explicit editing, separate from inspection. G-code insertion respects units/XY mode, preserves following modal cuts/arcs and avoids accumulated incremental rounding drift; 10 domain and 13 line-drawer tests/build pass. Constraint and panel usability review remains | in progress |
| Canvas selection and hover | Fixed endpoint highlight layering above start/end markers; browser regression passes. Overlap and selection filters remain | in progress |
| Canvas navigation | Fixed cursor-anchored wheel zoom, pinch centroid and continuation with one finger. 13 component and two browser tests cover anchors, clamping, fit and no document mutation. Tree keyboard events no longer trigger canvas commands; grid tooltips use actual units or disclose undeclared units. Focused keyboard/grid tests and final browser suite pass; broader accessibility review remains | in progress |
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
| Measurement | Read-only magnetic measurement supports pair, chain and fixed-reference modes, precision, touch/free picks and contour dimensions. Quadrant snapping includes arcs, limited to their actual clockwise/counterclockwise sweep. Named contour/segment references identify picks; Inspect A/B switches feature dimensions without replacing the measured pair. Four browser scenarios pass, including 10/6 mm circle diameters at a preserved 20 mm centre distance. Domain checks cover analytic curved area and reversed/open boundaries; ambiguous contours omit area. Browser checks cover exact picks, zoom, non-mutation and stable controls after leaving the canvas. |
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

- Latest combined unit run: **1,164 passed across 115 files**, including all final batch changes.
- Latest combined browser run: **68 passed, one optional external-workbench fixture skipped** across the full suite. Covers editor navigation/layout, tool workflows, transforms, partial selection, measurement, import/export, settings and project restoration. This final run includes all committed batch changes.
- Focused changes additionally verified partial-span selection, navigation, transform lifecycle, import validation, machine-package scope and recovery. Robofil example post conformance passes. Production builds retain the existing bundle-size warning.
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
| `12-measure-feature-references.png` | Named picks and independent feature inspection; docked panel keeps Clear visible at 1280 × 720. |
| `13-partial-range.png` | Percentage inputs, source length and highlighted active span visible at 1600 × 1000. |
| `12-project-trash-reload.png`, `13-project-restored-editor.png` | Deleted-project recovery after reload and restored editor. |
| `11-program-stop-edit.png` | One active stop form, readable reasons and visible workflow actions. |
| `09-partial-exit-review.png` | Confirmable partial exit at 1280 × 720; collapsed active ranges leave Restore, Cancel and Save visible. Later range-length details are covered by component tests. |

## Outstanding work

- Complete every pending inventory row and assign a final keep/remove/merge/expand disposition with current evidence.
- Investigate cross-tab locking without Web Locks; namespace locks now coordinate browser-cache adapters within a realm, and independent recovery review passed. Imported-name validation and recoverable deletion are implemented. Storage switching now explains separate libraries and supports returning to cache; folder preferences wait for transaction commit, and corrupt cache-directory metadata recovers from intact files.
- Assess physical clearance and source-contour review invalidation when local geometry changes without moving its endpoints; partial-contour fingerprints now cover this case.
- Finish partial-compensation usability; source/span selection and percentage range inputs are implemented and verified.
- Finish multi-entity measurement, overlap selection and selection filters; retain screen-space snapping thresholds.
- Implement full raw G-code coordinate-frame/non-XY-plane handling if required: G18/G19, G52–G59 offsets, decimal G92 controls and intermediate G92 resets currently warn instead of claiming accurate physical preview. Unit-aware preview and insertion are implemented.
- Simplify remaining duplicate inspection panels and tool headings.
- Broaden save/cancel/undo, keyboard/touch and rendered-layout verification as each tool is audited; then run final integration checks.

These remaining items preserve the original whole-app scope. Passing regressions above do not close the audit.
