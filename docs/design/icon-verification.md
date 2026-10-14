# Icon verification

## Integrated CAD branch and actual browser review

The branch now includes published CAD head `6e2113f` after integrating closed-area selection and physical depth controls and the PR targets `feature/parametric-cad-workbench`. Latest CAD implementations were retained during conflict resolution. The current audit resolves all 286 published original usages, eight dynamic slots and 17 feature kinds; 301 current references include 15 additional semantic/text-symbol replacements. No Lucide imports, unresolved exports or semantic mismatches remain.

Three Luna subagents reviewed the actual integrated browser app on the configured isolated Playwright origin. Their real sketch/Pad, feature-tree, menu, settings, controller-import, selected-state and dark/light catalog screenshots and decisions are linked in [actual-app-integration-review.md](actual-app-integration-review.md). Root verified the final catalog's live DOM metrics and filtering explanation. A diagnostic accessibility test covers the new feature-tree warning badge and its retained message.

Node 24.22.0 passes all 115 UI/geometry files and 1,161 tests with two workers, including the latest region-selection, depth-control and prior datum/Fit/gear cases. Six icon tests, exact icon geometry, integration-map parity, release compatibility and production TypeScript/Vite/documentation/pinned-source checks pass. The new AST control-text guard compares 23 changed CAD files against the published checkpoint and rejects icon-name substitutions in labels. [Current verification summary](icon-review/actual-app/node24-6e2113f-verification-summary.json) records exact counts. Earlier checkpoint summaries remain historical evidence.

## Published CAD checkpoint reconciliation

The earlier handoff targeted `c36aa3b50a30f82ded3508652d9e7917c69b6b59`, with exact published inventory bytes preserved under `inventory/checkpoints/c36aa3b/`. That checkpoint crosswalk had 1,962 rows because two excluded text candidates were removed; all 282 direct icon occurrences, 206 variants and 155 renderer relations remain covered. Source hashes cover 452 production files. Thirty-four exact semantic expectations, both lead variants, 17 feature mappings and all 20 tool calls pass. The concrete [integration map](icon-integration-map.md) also supplies every referenced renderer parent.

Final cross-family review corrected file-body slopes, Section View body consistency and redundant Boolean edges, and made numeric bounding-box evidence explicit. All 134 assets remain inside the viewBox at all six target sizes. The six focused asset/accessibility/catalog tests and actual-path geometry checks pass after these changes. See [icon-final-handoff.md](icon-final-handoff.md) for the final set and scope.

The production TypeScript/Vite build passes on the current CAD checkpoint, followed by 30 hosted documentation pages, checks across 95 static documentation files, and exact pinned STEP/CAD source-distribution verification. The current UI result is recorded above; earlier consumer checkpoints remain historical evidence. Integration-map `--check` passes for all assets, 282 direct usages, eight slots, 206 variants and 95 parent contracts.

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

## CAD precision and View-help checkpoint

The current `b0be1bc` inventory covers 455 production files / 422 parsed files and 1,964 crosswalk rows with zero gaps. All 282 occurrence IDs and eight dynamic slots remain present. Two new geometry rows stay outside action-icon replacement. CAD domain, local-coordinate helpers, profile geometry cache and controller files match the target. Conflict resolution preserves the entire target Canvas and Context Help implementations, with only typed glyph substitutions. Luna independently inspected those diffs and verified in the actual rebuilt app that closing the View drawer removes its navigation-help dialog.

## Datum, initial Fit and gear-help follow-up

PR #13 includes parent checkpoint 25b3994 through merge commit 8829044. Luna independently confirmed the tree expansion commits before initial Sketch Fit; only its existing action glyphs and warning badge differ from the target. Gear-help diagrams, the datum test, gear-help coordinate tests and initial-Fit tests are byte-identical to the target. All 104 current UI/geometry files / 1,061 tests pass. The earlier parent failure is resolved by the imported parent fix, with no separate CAD implementation in the icon task.

## Closed areas and physical depth controls

PR #13 includes 6e2113f through merge 6ef095d. The committed inventory covers 464 production files / 429 parsed files and 1,982 crosswalk rows, with 286 direct usages, eight dynamic slots, 208 variants, 156 renderer relations and 96 supplied parent contracts. All 41 exact semantic expectations pass. New closed-area controls reuse Select, Confirm and Close glyphs. Mathematical/help drawings and physical depth head/stem/guide geometry remain outside icon replacement. Domain, depth interaction logic, rust palette, picking overlays and their styles match the target exactly. Luna found and restored 11 accidentally renamed X-axis labels, then checked all changed production TSX for further unintended text changes. The permanent icon control-text guard catches that regression class. No app server was started or changed.
