# Actual catalog review: Luna

Reviewed 2026-10-14 in a private in-app browser tab at `http://127.0.0.1:3107/wireedm-gcode-parser/icon-catalog/` (1260 × 700 viewport). The tab was closed after restoring the catalog to dark theme, Family `All`, and an empty search.

I inspected the rendered 14, 16, and 20 px comparison rows for CAD operations, CAD targets and repetition, contours/CAM transfer, machine/simulation, documents/persistence, and view/input. I also inspected the CAD-only (28 icon) and CAM-only (12 icon) specimen grids, a `select` search under CAD (three results), and selected/disabled specimens in both themes. The accessible tree reported all 134 icons for `All`, 28 for CAD, 12 for CAM, and three for CAD + `select`.

## Findings

- The CAD operation glyphs read distinctly at 14 px and improve at 16/20 px. Pad/Pocket direction, fillet/chamfer corners, boolean variants, and linear/circular patterns hold up in the comparison rows. The face and edge selection cursors remain distinguishable at 14 px.
- `body` and `imported-body` are the closest CAD pair at 14 px. The small arrow above the imported cube is perceptible in the rendered row, but easy to miss during a quick scan; the difference becomes clearer at 20 px. Consider relocating the import marker to a cube side if rapid distinction is required. The source candidate is the `imported-body` path in `scripts/icon-source.mjs` (line 115).
- The CAM symbols reviewed read clearly at 14/16/20 px. Entry and exit arrows distinguish `lead-in` from `lead-out`; the directional symbols, planning geometry, and CAM transfer symbols remain identifiable in both themes.
- Selected specimens use a cyan outline, glyph, and fill in both themes. Disabled specimens remain visible, with the light theme reducing their contrast more strongly. The 12 px samples are the fragile end of the range, especially the sparse `select-edge` mark; the 14 px product comparison rows are noticeably safer.
- Search and Family filtering update the lower “All icon specimens” grid and count. The six comparison-family sections above it stay visible, so a result such as “3 icons” does not describe every icon still visible on the page. Consider labeling the count as applying to the specimen grid, or filtering the comparison sections too. The behavior is in the `filter()` function in `scripts/generate-icons.mjs`.

## SVG and metric inspection

The live CUA surface available to this reviewer provided screenshots and the accessibility tree, but no page-evaluation method; I could not query the live SVG DOM directly. The rendered appearance was cross-checked against the catalog generator and static metrics. `scripts/generate-icons.mjs` emits decorative SVGs with `aria-hidden="true"`, `focusable="false"`, their requested CSS `width`/`height`, a `0 0 24 24` viewBox, `fill="none"`, `stroke="currentColor"`, 1.75-unit strokes, and rounded caps/joins. The accessibility tree exposes the labeled search, family selector, theme button, specimen labels, and the note that icon-only controls need their own accessible names.

The existing `docs/design/icon-review/metrics.json` projection gives `body` 89 ink pixels at 14 px and `imported-body` 97; both have a 17.75-unit-wide bound. That modest 8-pixel difference is consistent with the visual observation that the import marker is subtle at the smallest product comparison size. These are the checked-in renderer projections, not measurements sampled from the live browser raster.

## Captures

- [Dark overview, top families](actual-app/catalog-luna-dark-top.png)
- [CAD family, full-size specimens](actual-app/catalog-luna-dark-cad-top.png)
- [CAD family, 12–24 px and states](actual-app/catalog-luna-dark-cad.png)
- [CAM family, 14/16/20 px](actual-app/catalog-luna-dark-cam.png)
- [Selected/disabled states in dark theme](actual-app/catalog-luna-dark-states.png)
- [Selected/disabled states in light theme](actual-app/catalog-luna-light-cam.png)
- [CAD search results with state samples](actual-app/catalog-luna-cad-search-states.png)
