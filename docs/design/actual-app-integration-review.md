# Actual app integration review

The icon branch is rebased onto `feature/parametric-cad-workbench` at `c36aa3b`. Conflicts retained the latest CAD implementations; icon substitutions were applied afterward. CAD/domain implementations match the target branch. A literal/JSX-text comparison found only the intended text-icon, decorative accessibility and icon-layout substitutions, with control labels, data values and operation names preserved.

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
