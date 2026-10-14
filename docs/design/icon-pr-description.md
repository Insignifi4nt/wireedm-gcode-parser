The workbench reused generic glyphs for different CAD operations and mixed them with text icons. This integrates 134 original SVGs and a typed React catalog onto the latest CAD work, with distinct operation, selection, sketch, persistence and editor meanings. All 282 published source usages and eight dynamic slots resolve, including the newer feature tree, command dock, sketch tools, relation controls and plugin/settings panels. Existing CAD implementations, control labels, handlers and guards are preserved.

Targets `feature/parametric-cad-workbench`, based on `c36aa3b`, for app 0.0.698 after CAD 0.0.697. The updated searchable catalog compares six related families and actual size/state specimens. Critical iterations repair closed contours, interior leads, exact offsets, shared body projection, small glyph crowding and semantic alias collisions. Three Luna subagents reviewed the actual integrated app: a real sketch and Pad, CAD menus and selected states, a controller-file import, settings and the dark/light catalog. Review also corrected the feature-tree warning badge and clarified filter scope.

Validation on Node 24.22.0: 100 React UI files / 1,028 tests with two workers; six SVG/catalog/accessibility tests; original-usage and dynamic-slot checks; exact geometry constraints; complete 1,962-row published inventory crosswalk; integration-map parity; TypeScript/Vite, hosted documentation/link/schema and pinned source-distribution checks. Browser evidence and decisions are in `docs/design/actual-app-integration-review.md`. The visible catalog is `icon-catalog/index.html`. Two unchanged large-document controller cases were load-sensitive at high concurrency and passed in isolation and the final full two-worker run; their code and timeouts were not changed.

Compatibility checklist:

- App release advances once to 0.0.698 after CAD 0.0.697; UPID, post schema and engine API versions are unchanged.
- Installed post schemas, machine-package capabilities, execution events, audit rules and installation stay compatible.
- Controller output, numbering, encoding, line endings, wrappers and feed behavior are unchanged.
- Browser-cache and folder storage, migrations, saved revisions and package snapshots are unchanged by this icon PR.
- UI and WebMCP operation checks, cancellation and version guards are preserved. CAD domain code matches the target branch.
- Compatibility record: `docs/releases/0.0.698.json`. No merge or controller-hardware verification is claimed.
