# Actual app integration review

The icon branch includes `feature/parametric-cad-workbench` at `6e2113f`. It was first rebased onto `c36aa3b`, then merged the newer published capacity/storage/runtime checkpoint cleanly. Conflicts retained the latest CAD implementations; icon substitutions were applied afterward. CAD/domain implementations match the target branch. A literal/JSX-text comparison found only the intended text-icon, decorative accessibility and icon-layout substitutions, with control labels, data values and operation names preserved.

The current audit now uses the published 282-occurrence inventory instead of the historical 228-occurrence scout. All 282 originals resolve to their intended semantic icons, all eight dynamic slots remain rendered, and all 17 feature kinds remain mapped. There are 297 current references including 15 additional text/semantic icon references, with no Lucide imports, unresolved exports or semantic mismatches.

This audit also exposed a contextual inference error: the grid-snap control's enclosing JSX mentioned the nearby point-placement control, so a broad text match selected the point glyph. Matching the owning control's explicit accessible name now keeps `snap` and `circle-center` separate. Their independent regression expectations are retained. Runtime snapping behavior did not change.

## Luna browser review

- [CAD review](icon-review/actual-cad-luna-review.md) exercised a real XY sketch, rectangle profile, 10 mm Pad, selected feature tree, enabled/disabled tool controls, File menu, edge-treatment menu and view drawer. Native geometry rendered with a reported volume of 18,000 mm³.
- [Workbench review](actual-workbench-luna-review.md) exercised cache-first startup, settings, CAD navigation preferences and an actual controller-file import. Selected point-placement, clean-document Save/Undo/Redo disabling, file and help glyphs were inspected.
- [Catalog review](icon-review/actual-catalog-luna-review.md) inspected actual dark/light browser rendering at 14/16/20 pixels, smaller individual specimens, selection/disabled states, CAD/CAM search and category filtering. Root additionally checked the live DOM metrics.

The review used separate temporary browser tabs on the configured Playwright origin, `http://127.0.0.1:3107/wireedm-gcode-parser/`. The browser screenshots in `icon-review/actual-app/` are actual application captures. No competing 3777/3778 server was started. Review fixture data belongs to the isolated test origin; user workbench folders were not changed.

## Findings and decisions

The latest feature-tree warning still used a literal exclamation mark. It now renders the standard decorative Warning glyph while retaining the diagnostic's accessible name and row title. A scoped color rule preserves its warning color despite the tree's generic SVG styling. The extended diagnostic accessibility test passes.

The catalog's filtered count was ambiguous because complete comparison families remain visible. The catalog now explicitly states that filters apply to the individual cards and comparison rows show whole families. Root confirmed that explanation in the actual browser.

The Storage category keeps the conventional browser-cache/storage cylinder, which suits the cache-first default. The integration-map wording now reserves Folder Storage for folder-specific persistence controls. Making the whole category look folder-only would imply the wrong default.

Two optical limits were reviewed and retained: the imported-body marker is small at 14 pixels, but preserves the body projection and incoming arrow without crowding its facets; the combined edge-treatment menu uses the familiar fillet-family glyph, with a dropdown and an explicit round-or-bevel title. Its separate Fillet and Chamfer menu choices have distinct drawings. Neither finding justified adding detail to the compact toolbar.

Root verified the final live catalog has 134 cards, six comparison families, one 24-unit viewBox, one 1.75-unit stroke width, and actual CSS sizes of 12/14/15/16/20/24 plus the larger header specimen. The catalog remains open as the user-facing deliverable. No perfection or unlabelled universal-recognition claim is made.

## Latest CAD checkpoint follow-up

The published `8375c29` inventory preserves the same 282 occurrence IDs and eight dynamic slots. None of the actual UI icon call sites changed. CAD domain and controller implementations remain identical to the new target branch. Node 24.22.0 passes all 100 UI files / 1,034 tests with two workers, icon checks, geometry constraints, integration-map parity, release compatibility and production build checks. Root refreshed the actual catalog and checked CAD startup, the toolbar, feature tree and File menu on the rebuilt isolated preview. See [CAD screenshot](icon-review/actual-app/cad-root-8375c29.png) and [catalog screenshot](icon-review/actual-app/catalog-8375c29.png). Luna's follow-up interactive browser was unavailable; the earlier three interactive reviews cover the unchanged icon call sites.

## CAD precision and View-help follow-up

The `b0be1bc` merge conflicted in Canvas and Context Help. Resolution retained each complete target implementation and reapplied only action-icon imports and render symbols. The new `CadSketchProfileGeometry` component, placement/cache/local-coordinate helpers, domain files and controller behavior are identical to the target. Luna independently confirmed the resulting diffs contain only glyph substitutions in Canvas, Context Help and Command Dock. In the actual rebuilt app, Luna opened the View drawer and navigation help, then closed the drawer and confirmed the dialog and drawer controls disappeared while the CAD canvas remained mounted. No findings in the reviewed scope. Root refreshed the [catalog](icon-review/actual-app/catalog-b0be1bc.png) on the existing isolated preview; no server was started.

The latest 102-file UI/geometry batch has 1,052 passes and one stale datum assertion, recorded in the [verification summary](icon-review/actual-app/node24-b0be1bc-verification-summary.json). The parent CAD task is repairing that assertion and an initial Sketch Fit/tree-expansion ordering issue separately. This icon task changes neither. Icon/geometry/parity checks and the full production build pass.

## Repaired datum/Fit and gear-help checkpoint

Parent checkpoint 25b3994 merged cleanly. Its selected-tree expansion ordering, datum regression correction and gear-help local serialization are preserved. Luna independently reviewed the tree and confirmed the selected feature/branches synchronize before layout effects consume the DOM. CadGearHelp, actual profile geometry and the three parent regression test files are byte-identical to the target. The icon diff contains only glyph/map substitutions and the existing Warning badge. Node 24.22.0 passes all 104 UI/geometry files / 1,061 tests with two workers, plus icon/geometry/parity/release/build checks. The existing preview was rebuilt without server changes. The refreshed catalog was requested in the Codex panel; opening is queued while this task is hidden. No new screenshot is claimed for a hidden zero-width panel. The catalog geometry is unchanged from the preceding actual captures.

## Closed-area and depth checkpoint

The 6e2113f update merged as 6ef095d. Conflicts in Feature Editor and Viewport retained the complete target implementations before applying action glyph substitutions. Four added source usages now resolve, for 286/286 total, including the new area controls and the shifted repeated Check bindings. The fresh [Luna boundary review](icon-review/latest-cad-region-depth-icon-review.md) confirms picker ownership, cancellation/version checks, depth navigation locks, rust interaction colors and actual scene/help geometry are preserved. It caught 11 unintended X-axis label renames; the reviewer restored them and scanned all changed production TSX for further unintended text substitutions. Root added a permanent AST text-preservation guard and its focused regression self-check to icons:check. Current icon coverage, geometry, guard, integration-map and production build checks pass. Node 24.22.0 passes all 115 UI/geometry files / 1,161 tests with two workers, including region/depth suites. No app server was started or changed; actual-browser reviews from earlier checkpoints and the parent's fresh region/depth QA remain separate evidence.
