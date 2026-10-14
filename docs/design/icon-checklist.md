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
