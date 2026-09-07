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
| Editor status and canvas frame | Removed decorative frame and idle hints; wrapping status shows state, selection, actual units, actionable issues and fit warnings. Further contextual refinements remain | in progress |
| Project library | Search, filters, sorting, empty/loading/failure states | pending |
| Project rename/delete/export | Validation, selection, persistence and recovery | pending |
| DXF import and confirmation | Units, layers, unsupported entities, reimport consequences | pending |
| UPID import/export | Validate complete document and preserve intent | pending |
| External machine-program import | Cleanup, comments/commands, units and display fidelity | pending |
| Browser-cache storage | Startup, failures, persistence and data isolation | pending |
| Optional folder storage | Explicit selection, reconnect, cancellation and switch behavior | pending |
| Machine package installation | Validation, activation, removal and useful summaries | pending |
| Source/machine setup | Make machine and unit decisions accessible without technical clutter | pending |
| Editor menus | Group by operator intent; remove overlapping entry points | pending |
| Workflow panels | Dock/float, duplicate headings, action visibility and switching | pending |
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
| Entry/exit | Geometry options, tangency, zero/invalid leads, clearance and preview | pending |
| Cut sequence | Manual/automatic order, nesting dependencies and travel | pending |
| Between contours | Thread/separate defaults and overrides, continuous-wire constraints | pending |
| Machining participation | Excluded spans, partial contour semantics and compensation | pending |
| Program stops | Boundaries, remaining-distance placement and preview | pending |
| Endpoint topology | Expose repair-relevant facts; move raw topology detail behind disclosure | pending |
| Diagnostics | Deduplicate, prioritize and navigate to exact repair context | pending |
| Measurement | Added read-only Measure with magnetic points, segment and contour dimensions, precision, pair/chain/fixed-reference modes, mouse/touch and zoom checks. Multi-entity inspection remains | in progress |
| Construction points | Retain explicit editing; separate from inspection; clarify constraints | pending |
| Canvas selection and hover | Fixed endpoint highlight layering above start/end markers; browser regression passes. Overlap and selection filters remain | in progress |
| Canvas navigation | Fit, zoom anchor, pan, grid, scale and touch | pending |
| Canvas preview | Direction, leads, transitions, markers and execution consistency | pending |
| Text editor and line list | Editing, reorder/start, pin, selection and command preservation | pending |
| Controller export | Saved revision, setup selection, validation, generation and download | pending |
| Guide and onboarding | Concise task help, current labels and keyboard behavior | pending |
| Responsive layout/accessibility | Small viewports, focus, modal inertness and resize controls | pending |
| Code/test/documentation structure | Remove dead abstractions, extract coherent logic, update useful docs | pending |

## Captured evidence

1. Editor idle, local `tmp/cam-audit/01-editor-before.png`: three bottom strips, horizontal status scrolling, repeated metadata, inset canvas, expanded low-level program events.
2. Measurement panel, local `tmp/cam-audit/02-measurement-before.png`: duplicate heading, point creation and CSV export but no distance result; inspection requires a mutating workflow. Disabled insertion is visible even in a path project where insertion is unavailable.
3. Working Measure tool, local `tmp/cam-audit/03-measurement-after.png`: magnetic endpoint pair measures exactly 10 mm with matching canvas annotation and panel results. Document remains saved. Construction is a separate editing command; its unavailable insertion action is hidden for path projects.
4. Compact program tree, local `tmp/cam-audit/04-program-tree-after.png`: ready operation details are collapsed, leaving source/setup and program order visible. Event details remain reachable by expansion; unresolved operation diagnostics expand automatically.
5. Contour measurement, local `tmp/cam-audit/05-profile-measurement.png`: disclosed boundary length, width, height and enclosed area in the docked Measure panel. Moving into the panel preserves the last preview so controls do not shift under the pointer.
6. Consolidated Statistics, local `tmp/cam-audit/06-consolidated-statistics.png`: project counts and dimensional scope appear once, with source/topology details disclosed below. The manual-decision breakdown includes compensation and hides unused categories.

Screenshots were captured and inspected during this audit. They establish layout findings; correctness requires domain and interaction checks as well.

## Additional findings to verify

- Raw G-code parsing currently has no unit field. Do not label its raw coordinate preview as millimeters until modal units and conversions are handled correctly.
- The legacy path-preview count helper mixes source bounds with entry endpoints and omits some transition moves. Statistics now uses explicit source geometry bounds; audit preview move counts against the execution trace before presenting them as complete machining statistics.
- Magnetic construction inference and measurement snapping have different selection rules. Measurement should prefer nearby semantic points and must not snap to distant geometry merely because it is the nearest available candidate.
- User regression: setting initial relative wire position on a new project did not update the preview start position and connection. Reproduce from new import, including the coordinate-setting behavior described as G902, and verify draft preview, save and reopen.
- User regression: hovering a geometry-tree start/end point can be obscured by the existing start/end marker. Hover and selected point indicators must render visibly above all semantic markers; retain the marker identity without hiding the interaction state.

## Current verification

- Shell/status changes: 93 focused unit tests and 13 browser scenarios passed, including raw-program and path-project diagnostic navigation.
- Measurement geometry APIs: 16 focused tests passed, including existing construction inference coverage.
- Measurement/guide/editor integration: 107 focused tests passed. Four browser scenarios cover exact magnetic picks, repeat modes, precision, zoom, touch/free picks, non-mutation, endpoint layering, and the initial-wire save/reopen regression.
- The full unit run found an obsolete footer-text assertion, removed while retaining actual catalog-data assertions, and a genuine spatial-index scaling failure. Disjoint level rejection and cheaper cell lookup fixed the quadratic scan. Exact-hit comparisons and deterministic read-count tests cover the fix; the timing limit was not relaxed.
- Current checkpoint: 104 test files and 994 unit tests passed; 57 browser tests passed, one optional external-workbench fixture skipped. Production build passed with the existing bundle-size warning. No branch merge was performed.
- Subsequent program-tree change: 86 focused component/editor tests, four browser workflow tests and the production build passed. A controlled-selection regression exercises select, expand, select child, collapse and keyboard re-expand with focus and selection retained.
- Contour measurement: 10 domain tests, three browser scenarios and the production build passed. Checks cover analytic curved area, reversed orientation, open/missing boundaries, rectangle dimensions and a stable disclosure target after the first pick. Leads and positioning moves are excluded; ambiguous or intersecting contours do not display an enclosed area.
- Position-panel removal: 98 focused tests and production build passed. The workspace browser run passed 17 scenarios; one encountered a page reset during concurrent documentation editing and passed on isolated rerun. Rendered View menu and Statistics inspected; cursor coordinates remain available in the status bar.
- Summary consolidation: 95 focused tests, three browser scenarios and production build passed. Browser assertions verify the imported filename, 10 × 10 mm geometry bounds, 40 mm cutting travel, topology disclosure and the actual DXF layer. Selection cross-highlighting and source-placement inspection remain covered.

## Next audit work

Review overlapping inspection panels next, including summary/statistics/position duplication and context-sensitive selection details. Complete multi-entity measurement inspection, then inspect each machining tool against the transaction, preview and validation standards. Continue through every remaining inventory row; these first fixes do not constitute completion of the whole-app goal.
