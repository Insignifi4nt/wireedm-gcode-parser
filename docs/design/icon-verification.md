# Icon verification

## Critical iteration after the first checkpoint

Grouped review covers all 134 current IDs. The integrated pass revises 35 drawings or adds explicit semantic entries, checks actual contour inset and arrow clearance, and reviews all 244 current references. Its decisions and limitations are in [critical-iteration-checkpoint.md](critical-iteration-checkpoint.md). The first-checkpoint browser screenshots below predate this pass; current SVG inspection uses offline actual-size rendering because the CAD task owns the app servers.

- Updated consumer verification passed all 72 React UI files, 716 tests. This includes the root application regression suites as well as app/component/feature consumers.
- All six SVG/catalog/accessibility tests, generated-file parity, 244 current reference resolutions and 1,964-row inventory reconciliation passed. The 34 targeted semantics and dynamic lead-direction check passed.
- The production TypeScript/Vite build, 30 hosted documentation pages, checks across 95 static documentation files, and pinned STEP/CAD source distributions passed. Existing Vite externalization and chunk-size warnings remain unrelated to the icon changes.
- The path-based checker passed eight matching inset sides at three units, closed contours, inside/clearance checks and exactly mirrored entry/exit arrows. Full dark/light sheets cover all six sizes without empty or clipped glyphs.

Reviewed 2026-10-14. Starting source: `c16a15e`. The final handoff inventory is reconciled separately with its own snapshot and source hashes in the crosswalk.

## Evidence

- Original SVG and generated catalog parity, XML syntax and allowed nodes/attributes are checked by `icons:check`. Six tests cover asset metrics/safety and real React accessibility, refs and handlers plus catalog filtering/theme behavior.
- `icons:review` renders every original glyph at 12, 14, 15, 16, 20 and 24 pixels and saves dark/light state sheets plus bounds/ink metrics. No empty or clipped assets were found.
- The built HTML catalog was inspected in the in-app browser. Its search produced the two Pocket family entries and its light-theme toggle changed the foreground/background state. The 14/16/20 px family rows show actual SVG CSS sizes, not generated raster suggestions.
- The first non-CAD integration checkpoint passed 11 UI files / 71 tests and TypeScript. Simulation view corrections subsequently passed their focused 4-test suite. The topology disclosure check passed 4 tests.
- A broad `src/app src/components src/features` run passed 126 files / 1,056 tests. One unchanged CAD kernel topology stress test exceeded its explicit 20-second timeout; the isolated retry also exceeded that timeout. No kernel, topology or domain implementation was changed to address this unrelated limit.
- Production TypeScript/Vite build, generated hosted documentation/link/schema checks and pinned STEP/CAD source distributions passed before the final text-symbol integration. Final checkpoint results are appended below.

## Review and release

Independent code review found the remaining UPID rail, program-tree and workflow-menu text symbols. Their corrections preserve names and handlers. It found no runtime, accessibility or API guard regression in the inspected substitutions. A stale Markdown crosswalk row was regenerated from corrected JSON.

This branch advances the app once to 0.0.698, following the concurrent CAD release 0.0.697. It changes no UPID/post/engine schema version, capabilities, events, installation, cache/folder storage, migration, saved revision or controller output contract. The draft PR is stacked on the CAD branch and requires its final base before merge; unpublished CAD implementation must retain its own review.

## Final checkpoint

- All 62 app/component/feature React UI test files passed, 542 tests. This scope covers actual icon consumers while excluding the unrelated native topology stress suite.
- The six icon asset/accessibility/catalog tests passed with 132 generated original glyphs.
- The final source audit resolves 228/228 starting-checkout imported references, both dynamic renderers and all 17 CAD feature-kind entries. Additional replacements of text-symbol controls are listed as new catalog references. No Lucide imports or unresolved catalog exports remain.
- Independent review corrected the compact Categories button's inline layout and diagnostic icon padding. Its 66 focused tests passed, with no remaining actionable findings. Exact section geometry has an empty diff.
- Production TypeScript/Vite, 30 hosted documentation pages and checks over 95 static files, and pinned STEP/CAD source distribution verification passed. SVG review sheets were regenerated at six sizes without clipping or empty glyphs.
- The handoff crosswalk now covers 1,964 rows, including 282 imported references, 214 imports and all 206 expanded variants. Its 155 renderer route relations are accounted for. Semantic regression checks validate all 17 feature-kind bindings, 20 toolbar calls and their linked parent variants; independent review found zero mismatches after correcting broad-container inference. The original snapshot is preserved in `docs/design/inventory/` with its SHA-256 and source manifest.
- Browser inspection also opened the cache-first dashboard and real CAD workspace with no folder permission. Actual 15 px toolbar pictures, disabled actions, labels and named-view controls rendered correctly. The saved [toolbar screenshot](icon-review/workbench-toolbar.jpg) records that state.
