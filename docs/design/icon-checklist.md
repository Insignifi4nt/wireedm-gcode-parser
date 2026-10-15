# Original workbench icons

Branch: `design/original-workbench-icons`. Starting commit: `c16a15e`. CAD reference checkout is read-only.

- [x] Inspect current icon consumers and app colors/sizes.
- [x] Research official CAD geometry/action conventions.
- [x] Inspect official screenshots for CATIA, Onshape and SketchUp.
- [x] Explore three original visual directions with Image Gen and record a decision.
- [x] Finalize geometry, stroke, perspective and accessibility standard.
- [x] Read and reconcile the completed CAD inventory.
- [x] Author every required SVG and typed catalog.
- [x] Map every source usage, including shared glyphs with different meanings.
- [x] Build a searchable contact sheet with real SVGs and state/size specimens.
- [x] Inspect actual renders and revise weak silhouettes.
- [x] Validate XML, metrics, uniqueness, accessibility and catalog parity.
- [x] Integrate replacements in this checkout with existing guards intact.
- [x] Run focused UI tests, type check and build.
- [x] Reserve 0.0.698 after the concurrent CAD 0.0.697, once for this PR.
- [ ] Create PR with compatibility checklist and review evidence.

## Progress

2026-10-14, requested CAD integration and PR submission: icon commits are rebased onto the published `feature/parametric-cad-workbench` head `c36aa3b`. All new CAD consumers use the catalog; the current audit resolves 282 original usages and all eight dynamic slots. Three Luna agents completed actual-browser reviews. Catalog filter scope, the diagnostic warning glyph/color and grid-snap semantic inference were corrected. Node 24.22.0 checks pass with 100 UI files / 1,028 tests using two workers; focused icon/geometry/release and production build checks pass. The PR targets the CAD branch.

2026-10-14, final integration handoff: the concrete 134-icon set targets published CAD checkpoint `c36aa3b`. Its 1,962 inventory rows, 282 references, 206 expanded variants and 155 renderer relations reconcile with zero gaps. All eight dynamic slots and 95 referenced parent contracts are supplied in the integration map. Final review corrected three small projection/overdraw issues and numeric bounds serialization. Exact geometry, six icon tests and production build/docs/source-distribution checks pass. See `icon-final-handoff.md`. CAD source integration and publication remain outside this preparation checkpoint.

2026-10-14, critical iteration checkpoint: all 134 IDs have explicit grouped review coverage, and all 244 current imported references have semantic review. Thirty-five drawings were revised or added. Closed contour, exact inset, interior clearance and lead symmetry checks pass. Root rejected proposals that reduced differentiation or crowded small glyphs. The updated catalog compares CAD, selection/pattern, CAM, machine/transport, document/storage, and view/input families. Review evidence and integration limits are in `critical-iteration-checkpoint.md`; PR publication remains held.

2026-10-14, user-directed second design pass: PR creation is held while every family receives a critical geometric and semantic review. Lead placement, contour closure and consistency across related operations require further inspection. Earlier verification establishes implementation behavior, not final design acceptance.

2026-10-14: The external inventory has not appeared yet. Current CAD source uses the same cube for imported bodies, Pad, Pocket and Shell. Its generic copy and rotation symbols also represent patterns and mirror. Final mappings must use operation semantics rather than replacing each imported component name globally.

The user authorized independent design iteration and hand-authored final SVGs. This overrides the Product Design ideation workflow's selection pause and its generic preference for existing icon libraries.

Final checkpoint: 132 original glyphs, 282/282 external icon references and 214 imports mapped, all 206 expanded renderer variants and 155 route relations accounted for. The frozen handoff evidence has 1,964 inventory rows and source hashes for 451 files. Current checkout imported references reconcile 228/228, with 15 added replacements for text symbols and other semantic corrections. Newer CAD implementation is merge-forward scope, not copied code.

All 62 React UI files / 542 tests, six catalog/asset/accessibility tests, production build/docs/source-distribution checks and exact semantic mapping checks passed. Review fixed text-control layout, diagnostic SVG padding and broad-container semantic inference. The unrelated unchanged native topology stress timeout remains explicitly recorded. No main push or merge is authorized or performed.

2026-10-14, CAD checkpoint follow-up: PR #13 includes `8375c29`. Its exact published inventory covers 454 production files / 421 parsed files, with the same 282 occurrence IDs and eight slots. Current icon checks, crosswalk and integration-map parity pass. Node 24.22.0 passes all 100 UI files / 1,034 tests with two workers and the production build. CAD domain and controller files match the target branch; no UI icon call sites changed. Root refreshed the actual catalog and checked the CAD toolbar/File menu.

2026-10-14, precision/View-help follow-up: PR #13 includes `b0be1bc`. Canvas and Context Help conflicts preserve the target behavior plus original glyphs. Actual profile geometry is unchanged. Luna independently reviewed the diffs and actual drawer/help dismissal. Icon/geometry/parity/build checks pass; 102 UI/geometry files / 1,053 tests report 1,052 passes and one unchanged stale CAD datum assertion that the parent task is fixing separately.

2026-10-14, repaired CAD checkpoint: PR #13 includes 25b3994 through merge 8829044. Luna boundary review confirms tree expansion ordering, gear diagrams and parent regression tests are preserved. All 104 UI/geometry files / 1,061 tests pass on Node 24.22.0 with two workers; icon/geometry/parity/release/build checks pass. The earlier stale datum failure is resolved by the imported parent repair.

2026-10-15, closed-area/depth checkpoint: PR #13 includes 6e2113f through merge 6ef095d. All 286 source uses, eight slots, 208 variants and 96 parent contracts resolve. Luna reviewed the new region/depth boundary, restored 11 X-axis labels and verified other changed production TSX text. The permanent control-text guard passes. All 115 UI/geometry files / 1,161 tests pass on Node 24.22.0 with two workers, plus icon/geometry/parity/release/build checks. Domain, depth geometry/interaction/rust palette and help drawings match the target. No server changes.


2026-10-16, package integration: PR12 merged first at bfac856 and deployed. PR13 now integrates current main with @wire-edm/icons-react0.1.0, named/individual ESM and declaration exports, separate dynamic/catalog entries and an isolated packed-consumer check. All395files/4,161unitcases and55selected Chromium journeys pass, plus focused final editor/tree and package checks. The134drawing package covers309current imported references;285surviving historical uses resolve and the header badge is explicitly retired. Exact source, review, browser and compatibility evidence: docs/reviews/2026-10-16-icon-package-integration.md. No saved data or numerical modeling code changed.
